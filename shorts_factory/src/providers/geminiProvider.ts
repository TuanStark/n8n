import { config } from '../config';

export interface ResearchOutput {
  historical_period: string;
  key_facts: string[];
  timeline: { year: string; event: string }[];
  important_people: { name: string; role: string }[];
  locations: string[];
  conflicts_detected: string[];
  confidence_score: number;
}

export interface ScriptOutput {
  hook_headline?: string;
  hook_text: string;
  full_script: string;
  estimated_duration_sec: number;
  hook_score: number;
  character_anchor?: string;
  setting_anchor?: string;
  narration_segments: {
    segment_index: number;
    text: string;
    estimated_sec: number;
    visual_intent: string;
    subclip_timing?: string;
  }[];
  facts_used: string[];
}

export interface StoryboardOutput {
  total_scenes: number;
  total_duration_sec: number;
  character_anchor?: string;
  setting_anchor?: string;
  scenes: {
    scene_index: number;
    duration_sec: number;
    narration_text: string;
    visual_description: string;
    characters: string[];
    location: string;
    camera_movement: string;
    motion_style: string;
    sound_effects: string[];
    positive_prompt: string;
    negative_prompt: string;
    video_prompt: string;
    paper_asmr_cues: string[];
  }[];
}

export class GeminiProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
  }

  private async callGemini(prompt: string, systemInstruction?: string): Promise<string> {
    // 1. Primary Engine: Google Antigravity CLI Bridge (Google AI Ultra)
    if (config.agy.bridgeUrl) {
      try {
        const agyRes = await fetch(`${config.agy.bridgeUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            systemInstruction,
            jsonMode: true,
            timeoutSec: 150,
          }),
        });

        if (agyRes.ok) {
          const resData: any = await agyRes.json();
          if (resData.success && resData.text) {
            console.log(`[AgyProvider] ✅ Generated response via AGY Engine (${resData.text.length} chars)`);
            return resData.cleaned || resData.text;
          }
          console.warn(`[AgyProvider] AGY Bridge returned non-success:`, resData.error);
        } else {
          console.warn(`[AgyProvider] AGY Bridge returned HTTP ${agyRes.status}`);
        }
      } catch (agyErr: any) {
        console.warn(`[AgyProvider] AGY Bridge connection error: ${agyErr.message}`);
      }
    }

    // 2. Secondary Safety Fallback: Google AI Studio API
    if (this.apiKey) {
      console.warn(`[AgyProvider] Falling back to legacy Gemini API...`);
      const body: any = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.95,
          responseMimeType: 'application/json',
        },
      };

      if (systemInstruction) {
        body.systemInstruction = {
          parts: [{ text: systemInstruction }],
        };
      }

      const models = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-pro-latest'];

      for (const model of models) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });

            if (response.ok) {
              const data = await response.json();
              return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            }

            const errBody = await response.text().catch(() => '');
            if (response.status === 429 || response.status === 404) {
              console.warn(`[Gemini API] Model ${model} returned ${response.status}: ${errBody.slice(0, 100)}. Trying next model...`);
              break;
            }

            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
          } catch (err: any) {
            console.warn(`[Gemini API] Network error on model ${model}: ${err.message}`);
          }
        }
      }
    }

    throw new Error(`[AgyProvider] Both AGY Bridge and fallback Gemini API failed to generate response.`);
  }

  private safeJsonParse<T>(raw: string): T {
    let cleaned = raw.trim();

    // 1. Extract block between ```json ... ``` or ``` ... ``` if present
    const matchBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (matchBlock) {
      cleaned = matchBlock[1].trim();
    } else {
      // 2. Otherwise find the outermost JSON structure { ... } or [ ... ]
      const firstBrace = cleaned.indexOf('{');
      const firstBracket = cleaned.indexOf('[');
      let startIdx = -1;
      if (firstBrace !== -1 && firstBracket !== -1) {
        startIdx = Math.min(firstBrace, firstBracket);
      } else {
        startIdx = Math.max(firstBrace, firstBracket);
      }

      const lastBrace = cleaned.lastIndexOf('}');
      const lastBracket = cleaned.lastIndexOf(']');
      const endIdx = Math.max(lastBrace, lastBracket);

      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        cleaned = cleaned.slice(startIdx, endIdx + 1).trim();
      }
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      // Fix bad escaped characters like \a, \(, \)
      const sanitized = cleaned.replace(/\\([^"\\/bfnrtu])/g, '$1');
      try {
        return JSON.parse(sanitized) as T;
      } catch (err2) {
        // Strip trailing commas before } or ]
        const noTrailingCommas = sanitized.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(noTrailingCommas) as T;
      }
    }
  }

  async researchHistoricalTopic(title: string, category: string, period: string): Promise<ResearchOutput> {
    const system = `You are a Senior Historical Researcher and Fact-Checking Engine for documentary YouTube Shorts.
You verify facts meticulously. Never invent historical claims. Detect conflicts and note uncertainties.
Return strictly a valid JSON object matching the requested schema.`;

    const prompt = `Research the historical topic: "${title}"
Category: ${category}
Historical Period: ${period}

Output JSON schema:
{
  "historical_period": "string",
  "key_facts": ["fact 1", "fact 2", "fact 3"],
  "timeline": [{"year": "string", "event": "string"}],
  "important_people": [{"name": "string", "role": "string"}],
  "locations": ["string"],
  "conflicts_detected": ["any popular myths or conflicting historical sources"],
  "confidence_score": 0.95
}`;

    const raw = await this.callGemini(prompt, system);
    return this.safeJsonParse<ResearchOutput>(raw);
  }

  async generateShortsScript(title: string, research: ResearchOutput, targetDurationSec = 34): Promise<ScriptOutput> {
    const system = `You are an Elite YouTube Shorts Scriptwriter and Retention Strategist directing scripts for the premier historical channel ("Paper Theater World").
Audience: Skeptical, lightning-fast scrollers aged 18–35 (US, UK, Canada, Australia) who crave gritty historical psychology, high tactical tension, and counter-intuitive truths.

MASTER 20-SECOND RETENTION HOOK ARCHITECTURE (THE RAPID-FIRE LOCK-IN):
Research shows 70% of viewers drop off before second 20 if the hook is weak, pacing is slow, or clickbait is empty. To dominate retention:
- Pacing must be RAPID: 7 to 8 short narration segments (2.0 to 4.5 seconds each), NEVER staying on one visual for more than 4 seconds!
- Divide the 0–20s window into 5 crisp, accelerating beats:

1. TIER 1: THE DISRUPTOR (0–2.8s) - PATTERN INTERRUPT
   - Shatter expectations or expose cognitive dissonance in the first sentence.
   - FORBIDDEN BANNED CLICHÉS: "Did you know", "In ancient Rome/Egypt", "Have you ever wondered", "Meet [Name]", "Imagine", "This is the story of", "History tells us".
   - REQUIRED: Cold open plunged into visceral conflict or an inverted common myth.
   - HOOK HEADLINE: Generate a punchy 3-5 word ALL-CAPS headline for the on-screen papercraft banner (e.g., "ROME'S DEADLIEST WEAPON", "THE FORBIDDEN POISON", "MURDER OF A GOD-KING").

2. TIER 2: THE AGONY & HIGH STAKES (2.8–5.5s) - EMOTIONAL TENSION
   - Escalate stakes immediately. What was on the brink of total annihilation, public execution, or empire-wide collapse? Show the lethal trap.

3. TIER 3: THE POINT OF NO RETURN (5.5–8.5s) - THE DANGEROUS CHOICE
   - The desperate decision made in the shadows. No turning back.

4. TIER 4: THE FORBIDDEN SECRET (8.5–13.0s) - THE CURIOSITY LOCK
   - The bizarre tactical secret or unexplainable method that forces the viewer to keep watching.

5. TIER 5: THE TACTICAL EXECUTION (13.0–18.0s) - THE INVISIBLE STRIKE
   - Sensory, tactile details of how the fatal act was committed.

6. TIER 6: THE VISCERAL CLIMAX (18.0–23.0s) - THE SHOCKING PAYOFF
   - High information density, concrete nouns, and active verbs. The historic revelation.

7. TIER 7: THE GRIM AFTERMATH (23.0–28.0s) - THE CRUEL IRONY
   - The twist of fate or brutal price paid.

8. TIER 8: THE SEAMLESS INFINITE LOOP (28.0–34.0s) - ALGORITHM CATALYST
   - Connect grammatically or conceptually back to the 1st second, creating an addictive infinite replay loop that boosts the algorithm.

CADENCE & WORD COUNT:
- Total words: 85–100 spoken words (~150-160 WPM, duration 32–34s).
- Must output EXACTLY 7 or 8 narration segments.

Return strictly valid JSON.`;

    const prompt = `Generate a master viral YouTube Shorts script for historical topic: "${title}".
Target duration: ${targetDurationSec} seconds.
Research Data:
${JSON.stringify(research, null, 2)}

Output JSON schema:
{
  "hook_headline": "3-5 WORDS ALL-CAPS FOR SCREEN BANNER",
  "hook_text": "string (the punchy Tier-1 opening sentence)",
  "full_script": "string (complete spoken narration, 85-100 words)",
  "estimated_duration_sec": 33.5,
  "hook_score": 9.8,
  "narration_segments": [
    { "segment_index": 1, "text": "Tier 1: Disruptor sentence (0-2.8s)", "estimated_sec": 2.8, "visual_intent": "Explosive hero visual" },
    { "segment_index": 2, "text": "Tier 2: High stakes sentence (2.8-5.5s)", "estimated_sec": 2.7, "visual_intent": "Tension and stakes escalation" },
    { "segment_index": 3, "text": "Tier 3: Point of no return (5.5-8.5s)", "estimated_sec": 3.0, "visual_intent": "Dangerous shadow choice" },
    { "segment_index": 4, "text": "Tier 4: Forbidden secret (8.5-13.0s)", "estimated_sec": 4.5, "visual_intent": "The central mystery visual" },
    { "segment_index": 5, "text": "Tier 5: Tactical execution (13.0-18.0s)", "estimated_sec": 5.0, "visual_intent": "Tactile assassination act" },
    { "segment_index": 6, "text": "Tier 6: Visceral climax (18.0-23.0s)", "estimated_sec": 5.0, "visual_intent": "Fatal consequence" },
    { "segment_index": 7, "text": "Tier 7: Grim aftermath (23.0-28.0s)", "estimated_sec": 5.0, "visual_intent": "Irony of fate" },
    { "segment_index": 8, "text": "Tier 8: Infinite loop closing (28.0-33.5s)", "estimated_sec": 5.5, "visual_intent": "Closing paradox connecting to second 1" }
  ],
  "facts_used": ["fact 1", "fact 2"]
}`;

    const raw = await this.callGemini(prompt, system);
    return this.safeJsonParse<ScriptOutput>(raw);
  }

  async generateStoryboard(
    script: ScriptOutput,
    styleProfile: { global_positive: string; global_negative: string }
  ): Promise<StoryboardOutput> {
    const system = `You are an Elite Editorial Art Director, Paper Engineer, Stop-Motion Designer, and Visual Storytelling Director for high-budget handcrafted paper stop-motion historical Shorts ("Paper Theater World").

MISSION:
Convert each narration segment into a breathtaking, museum-quality handcrafted paper sculpture scene.
Create EXACTLY ${script.narration_segments.length} scenes corresponding 1-to-1 with the narration segments.

THINKING PROCESS & CORE PHILOSOPHY:
- Never visualize every word literally. Visualize the CORE IDEA and striking VISUAL METAPHOR.
- Think like a Paper Engineer constructing physical art from 500 sheets of cardstock, NOT a 2D digital illustrator.
- Pacing is RAPID: Each scene lasts 2.0s to 4.5s. Quick, captivating visual cuts!

STRICT COMPOSITION RULE (THE 70/20/10 RULE):
1. 70% ONE HERO OBJECT: Every scene must feature ONE dominant, unforgettable hero paper sculpture (e.g. A massive shattered Spartan hoplite shield revealing a hidden iron dagger; an Imperial Roman laurel crown made of decaying cardstock; a towering paper guillotine slicing parchment). Never compete with the hero object.
2. 20% SUPPORTING OBJECTS: Maximum 2–3 supporting objects that add narrative meaning. Nothing random, no decorative clutter.
3. 10% BACKGROUND & GENEROUS NEGATIVE SPACE: Custom thematic background with large clean breathing room.

ABSOLUTE ZERO-DUPLICATION MANDATE (STRICT VARIETY):
- Every single scene (1 to ${script.narration_segments.length}) MUST feature a COMPLETELY DIFFERENT, UNIQUE Hero Object, distinct historical artifact, and distinct visual metaphor.
- ABSOLUTELY FORBIDDEN: NEVER repeat or reuse the same object, person, mask, weapon, or scroll across multiple scenes in the same short! Each scene must be a fresh, surprising visual discovery. If Scene 1 is a Pharaoh golden mask, Scene 2 must be towering temple pillars, Scene 3 a bronze dagger, Scene 4 a papyrus trial scroll, Scene 5 an embalming vessel, etc. No scene may duplicate another.

PAPER CONSTRUCTION RULES (MUST REVEAL IN EVERY SCENE):
- Every visible object must reveal: 30–100 individually cut paper layers, visible cardstock thickness, laser-cut edges, raw paper fibers, stacked contour slices, recessed paper layers, handcrafted glue joints, and deep shadow gaps between layers.
- Materials: thick cardstock, handmade paper, kraft paper, matte construction paper, watercolor paper.
- ABSOLUTELY FORBIDDEN: NEVER show a canvas, display board, poster, tabletop, outer box frame, or picture frame. The ENTIRE WORLD itself must be made from paper.
- LIGHTING: Soft museum lighting, top-left directional spotlight casting deep dimensional ambient shadows between paper layers to emphasize relief depth.

POSITIVE PROMPT FORMAT (MUST FOLLOW THIS EXACT STRUCTURE AND END WITH THIS SIGNATURE):
"[HERO OBJECT DESCRIPTION with 30-100 stacked cut paper layers and visual metaphor]. [2-3 SUPPORTING OBJECTS with paper construction details]. [MINIMAL BACKGROUND with generous negative space]. [LIGHTING & PALETTE: Top-left directional light, deep dimensional shadows]. Every object must appear physically handcrafted from individually cut paper pieces, with dramatic stacked cardstock layers, visible paper thickness, exposed cut edges, deep shadow separation, and realistic handcrafted paper textures. Every visible surface must reveal layer-after-layer paper construction. The composition must remain clean, minimal, and editorial with generous negative space. No flat surfaces. No digital illustration. No clutter. Premium handcrafted stop-motion paper aesthetic. Masterpiece. Ultra-detailed. 8K. No text. No logos. No watermark."

NEGATIVE PROMPT:
"cartoon, anime, 3d cgi render, glossy plastic, flat vector, digital painting, smooth airbrush, photorealistic human skin, photograph, frame, border, outer box, display box, tabletop, text, watermark, logo, blurry, cluttered, noisy background"

Return strictly valid JSON matching the requested schema.`;

    const prompt = `Create exactly ${script.narration_segments.length} master handcrafted paper stop-motion scenes for this historical script.
Hook Headline: "${script.hook_headline || ''}"
Script: "${script.full_script}"
Duration: ${script.estimated_duration_sec}s
Segments: ${JSON.stringify(script.narration_segments)}

CRITICAL REQUIREMENTS:
- Create EXACTLY ${script.narration_segments.length} scenes (matching each segment index 1 to ${script.narration_segments.length}).
- Each scene must have ONE clear Hero Object (70% of frame) representing the visual metaphor of that segment.
- Avoid clutter: maximum 2-3 supporting paper objects, large clean negative space.
- Specify paper engineering: stacked cardstock layers, laser-cut edges, kraft/construction paper textures, deep shadow gaps.
- Absolutely NO outer frames, NO display boxes, NO tabletop borders.
- The positive_prompt must end with the required signature.

Output JSON:
{
  "total_scenes": ${script.narration_segments.length},
  "total_duration_sec": ${script.estimated_duration_sec},
  "scenes": [
    {
      "scene_index": 1,
      "duration_sec": 2.8,
      "narration_text": "narration text for segment 1",
      "visual_description": "Handcrafted layered cardstock sculpture of [Hero Object metaphor]",
      "characters": ["Hero Subject details"],
      "location": "Layered cardstock location with negative space",
      "camera_movement": "stepped_stop_motion_push_in",
      "motion_style": "tangible_stop_motion_12fps",
      "sound_effects": ["cinematic_sub_bass_boom", "paper_friction"],
      "positive_prompt": "Handcrafted paper sculpture of [Hero Object with 40-60 stacked paper layers, visible cardstock thickness and laser-cut edges]. [2 supporting paper elements]. Layered paper background with generous clean negative space. Top-left museum lighting with deep ambient shadows between paper layers. Every object must appear physically handcrafted from individually cut paper pieces, with dramatic stacked cardstock layers, visible paper thickness, exposed cut edges, deep shadow separation, and realistic handcrafted paper textures. Every visible surface must reveal layer-after-layer paper construction. The composition must remain clean, minimal, and editorial with generous negative space. No flat surfaces. No digital illustration. No clutter. Premium handcrafted stop-motion paper aesthetic. Masterpiece. Ultra-detailed. 8K. No text. No logos. No watermark.",
      "negative_prompt": "cartoon, anime, 3d cgi render, glossy plastic, flat vector, digital painting, smooth airbrush, photorealistic human skin, photograph, frame, border, outer box, display box, tabletop, text, watermark, logo, blurry, cluttered, noisy background",
      "video_prompt": "Handcrafted stop-motion paper-cut animation at 12fps cadence.",
      "paper_asmr_cues": ["cardstock_slide", "paper_friction"]
    }
  ]
}`;

    const raw = await this.callGemini(prompt, system);
    return this.safeJsonParse<StoryboardOutput>(raw);
  }

  async evaluateVisionQC(sceneDescriptions: string[], keyframeSummary: string): Promise<{
    style_adherence: number;
    character_consistency: boolean;
    historical_plausibility: boolean;
    rejection_reasons: string[];
    decision: 'PASS' | 'WARNING' | 'FAIL';
  }> {
    const prompt = `Review this storyboard execution against Paper Theater World standards:
Scenes: ${JSON.stringify(sceneDescriptions)}
Execution: ${keyframeSummary}

Check:
1. Paper craft diorama aesthetic consistency (score 0.0 to 1.0)
2. Character visual continuity across scenes
3. Historical period plausibility (no modern items or digital glitches)

Output JSON:
{
  "style_adherence": 0.94,
  "character_consistency": true,
  "historical_plausibility": true,
  "rejection_reasons": [],
  "decision": "PASS"
}`;

    const raw = await this.callGemini(prompt);
    return this.safeJsonParse(raw);
  }

  async ideateHistoricalTopics(count: number = 5): Promise<Array<{
    title: string;
    category: 'ancient_rome' | 'ancient_greece' | 'ancient_egypt';
    historical_period: string;
    concept_summary: string;
    potential_score: number;
  }>> {
    const system = `You are a Lead Content Strategist for an elite YouTube Shorts channel ("Paper Theater World").
Target audience: Western / Tier-1 (US, UK, CA, AU) history enthusiasts who love dramatic, untold, dark, or surprising historical events in Ancient Rome, Ancient Greece, and Ancient Egypt.
Every topic MUST have a powerful psychological hook, zero clichés (no "Did you know"), and high debate potential.`;

    const prompt = `Generate ${count} compelling historical topics for YouTube Shorts.
Return JSON strictly in this structure:
{
  "topics": [
    {
      "title": "Punchy title under 70 characters",
      "category": "ancient_rome",
      "historical_period": "Late Roman Republic (49 BC)",
      "concept_summary": "1-2 sentences summarizing the dramatic angle and myth debunked",
      "potential_score": 9.4
    }
  ]
}
Valid categories: ancient_rome, ancient_greece, ancient_egypt.`;

    const raw = await this.callGemini(prompt, system);
    const data = this.safeJsonParse<{ topics: any[] }>(raw);
    return data.topics || [];
  }

  /**
   * FlowKit-Inspired Dynamic Script Synthesis with Retention Story Arc & Infinite Loop Outro
   */
  async generateDynamicScript(
    title: string,
    genreSystemPrompt: string,
    userPrompt?: string,
    targetDurationSec = 34
  ): Promise<ScriptOutput> {
    const system = genreSystemPrompt || `You are an Elite YouTube Shorts Scriptwriter, Visual Director, and Retention Strategist.
Your scripts follow the proven Hook-Retain-Reward-Loop architecture:
1. 0-3s DISRUPTOR HOOK: Extreme pattern interrupt. Never ask generic questions. Make a bold, counter-intuitive psychological statement.
2. 3-10s ESCALATING TENSION: Establish high stakes. Why ordinary thinking fails.
3. 10-22s REVELATION / CORE TRUTH: The profound tactical rule, secret, or breakthrough.
4. 22-28s MASTER APPLICATION: How the emperor, warrior, or genius executed this with unflinching resolve.
5. 28-34s INFINITE LOOP OUTRO: The final sentence must seamlessly and grammatically connect directly back into the opening hook, multiplying replay retention.`;

    const prompt = `Generate a master viral YouTube Shorts script for topic: "${title}".
Tone / Strategic instructions: ${userPrompt || 'Deliver an unforgettable, high-retention 30-34s video script.'}
Target duration: ${targetDurationSec} seconds.

MANDATORY RULES:
- Word count: 85 to 110 words total (timed precisely for ~30-34s narration).
- Include a "character_anchor" (detailed physical description of the primary protagonist/historical figure to maintain visual identity across all scenes).
- Include a "setting_anchor" (detailed physical description of the primary environment/world).
- SEGMENT 1 (0-3s) must be an irresistible Disruptor Hook.
- THE FINAL SEGMENT must be an INFINITE LOOP CLOSING (its final words must lead naturally and grammatically back into Segment 1).

Output JSON schema:
{
  "hook_headline": "3-5 WORDS ALL-CAPS FOR SCREEN BANNER",
  "hook_text": "string (the punchy opening sentence)",
  "full_script": "string (complete spoken narration, 85-110 words)",
  "estimated_duration_sec": 33.5,
  "hook_score": 9.6,
  "character_anchor": "Highly detailed physical description of main subject (face, beard, age, eyes, armor/attire, color accents)",
  "setting_anchor": "Highly detailed environment description (materials, architecture, atmospheric lighting, mood)",
  "narration_segments": [
    { "segment_index": 1, "text": "Disruptor sentence (0-3s)", "estimated_sec": 3.0, "visual_intent": "Hero hook visual", "subclip_timing": "0-3s: immediate punch" },
    { "segment_index": 2, "text": "High stakes sentence", "estimated_sec": 3.5, "visual_intent": "Stakes visual", "subclip_timing": "3-6.5s: tension rises" },
    { "segment_index": 3, "text": "Intrigue sentence", "estimated_sec": 4.0, "visual_intent": "Core mystery", "subclip_timing": "6.5-10.5s: deep conflict" },
    { "segment_index": 4, "text": "Revelation sentence", "estimated_sec": 4.5, "visual_intent": "Revelation visual", "subclip_timing": "10.5-15s: the rule unveiled" },
    { "segment_index": 5, "text": "Action sentence", "estimated_sec": 4.5, "visual_intent": "Action detail", "subclip_timing": "15-19.5s: philosophy in action" },
    { "segment_index": 6, "text": "Climax sentence", "estimated_sec": 5.0, "visual_intent": "Climax payoff", "subclip_timing": "19.5-24.5s: the emperor stands" },
    { "segment_index": 7, "text": "Loop bridge sentence (leading back to start)", "estimated_sec": 5.0, "visual_intent": "Infinite loop closing", "subclip_timing": "24.5-29.5s: loop closure" }
  ],
  "facts_used": ["key psychological/historical point 1", "point 2"]
}`;

    const raw = await this.callGemini(prompt, system);
    return this.safeJsonParse<ScriptOutput>(raw);
  }

  /**
   * FlowKit-Inspired Dynamic Storyboard Generator with Entity/Character Anchoring & Cinematic Camera Grammar
   */
  async generateDynamicStoryboard(
    script: ScriptOutput,
    visualStylePrompt: string,
    visualNegativePrompt: string
  ): Promise<StoryboardOutput> {
    const system = `You are an Elite Visual Storytelling Director, Director of Photography, and AI Cinematographer.
Visual Style DNA: "${visualStylePrompt}"
Negative Constraint: "${visualNegativePrompt}"

FLOWKIT CINEMATIC RULES:
1. CHARACTER & ENTITY CONSISTENCY:
   - Primary Subject Anchor: ${script.character_anchor || 'A powerful central protagonist'}.
   - Every scene featuring this subject MUST carry over their exact facial features, age, clothing, and materials so that the character looks 100% consistent across all scenes!
2. CINEMATIC CAMERA MOVEMENTS:
   - Use dynamic cinematic movements: "slow_push_in", "low_angle_hero_shot", "over_the_shoulder_tracking", "macro_extreme_close_up", "slow_orbit_pan", "high_angle_diminishing".
3. LIGHTING & ATMOSPHERE:
   - Specify atmospheric lighting: volumetric fog, deep chiaroscuro shadows, warm amber candlelight, rim lighting, 35mm film grain, 9:16 vertical composition.
4. ZERO CLUTTER:
   - Focus on ONE hero subject or metaphor per frame. Clean composition with generous breathing room.`;

    const prompt = `Storyboard this script (${script.narration_segments.length} segments):
Full Script: ${script.full_script}
Character Anchor: ${script.character_anchor || 'Historical protagonist'}
Setting Anchor: ${script.setting_anchor || 'Moody historical setting'}
Segments:
${JSON.stringify(script.narration_segments, null, 2)}

For each segment (1 to ${script.narration_segments.length}), create a vivid, cinematic 9:16 vertical scene.
Each positive_prompt must integrate:
[Core action/metaphor of this moment] + [Character Anchor consistency] + [Location Anchor] + [Camera angle & movement] + [Lighting & atmosphere] + [Visual Style DNA].
End each positive_prompt with: "Masterpiece, 8K, highly detailed, dramatic lighting, 9:16 vertical composition, sharp focus, no text, no watermark, no logos."

Output JSON schema:
{
  "total_scenes": ${script.narration_segments.length},
  "total_duration_sec": ${script.estimated_duration_sec},
  "character_anchor": "${script.character_anchor || ''}",
  "setting_anchor": "${script.setting_anchor || ''}",
  "scenes": [
    {
      "scene_index": 1,
      "duration_sec": 4.0,
      "narration_text": "narration for this segment",
      "visual_description": "concise description of the visual metaphor",
      "characters": ["character details"],
      "location": "scene setting",
      "camera_movement": "slow_push_in",
      "motion_style": "cinematic_dolly",
      "sound_effects": ["cinematic_bass_drop", "ambient_wind"],
      "positive_prompt": "vivid detailed prompt with character anchor, camera, lighting, and style DNA",
      "negative_prompt": "${visualNegativePrompt || 'blurry, low quality, cartoon, modern items, watermark, text'}",
      "video_prompt": "0-3s: slow cinematic push in on subject with subtle head turn and atmospheric dust floating",
      "paper_asmr_cues": []
    }
  ]
}`;

    const raw = await this.callGemini(prompt, system);
    return this.safeJsonParse<StoryboardOutput>(raw);
  }

  /**
   * FlowKit-Inspired Multi-Genre Topic Ideator with High-Hook Psychology
   */
  async ideateTopicsForGenre(genreKey: string, count: number = 5): Promise<Array<{
    title: string;
    category: string;
    historical_period?: string;
    concept_summary: string;
    potential_score: number;
    target_audience: string;
  }>> {
    let genrePersona = '';

    if (genreKey === 'dark_stoic') {
      genrePersona = `You are a Lead Content Strategist for an elite Dark Stoicism & Mental Fortitude channel ("Iron Mind").
Target audience: Driven individuals, entrepreneurs, and thinkers seeking brutal psychological resilience, emotional self-mastery, and ancient Roman/Greek tactical philosophy (Marcus Aurelius, Seneca, Epictetus).
Topics must be controversial, direct, and expose harsh psychological truths without platitudes.`;
    } else if (genreKey === 'cyberpunk_tech') {
      genrePersona = `You are a Lead Tech Futurist and Content Strategist for an elite Cyberpunk & Next-Gen AI channel ("Quantum Horizon").
Target audience: Tech innovators, software engineers, and futurists fascinated by bleeding-edge AI agents, quantum breakthroughs, neural implants, and dark tech ethics.`;
    } else {
      genrePersona = `You are a Lead Historical Storytelling Strategist for an elite ancient history Shorts channel ("Paper Theater World").
Target audience: History enthusiasts who love dramatic, untold, or surprising events in Ancient Rome, Ancient Greece, and Ancient Egypt.`;
    }

    const prompt = `Generate ${count} compelling, viral YouTube Shorts topics for genre: "${genreKey}".
Requirements:
- Punchy, high-CTR title under 70 characters with strong curiosity gap.
- Concept summary explaining the core psychological or dramatic hook.
- Potential viral score (8.5 to 9.9).

Output JSON:
{
  "topics": [
    {
      "title": "Short punchy title under 70 chars",
      "category": "${genreKey}",
      "historical_period": "Historical era or Modern era",
      "concept_summary": "1-2 sentences summarizing the dramatic angle and psychological paradox",
      "potential_score": 9.5,
      "target_audience": "Audience description"
    }
  ]
}`;

    const raw = await this.callGemini(prompt, genrePersona);
    const data = this.safeJsonParse<{ topics: any[] }>(raw);
    return data.topics || [];
  }
}

export const AgyProvider = GeminiProvider;
export type AgyProvider = GeminiProvider;

