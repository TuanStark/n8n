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
  narration_segments: {
    segment_index: number;
    text: string;
    estimated_sec: number;
    visual_intent: string;
  }[];
  facts_used: string[];
}

export interface StoryboardOutput {
  total_scenes: number;
  total_duration_sec: number;
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

    const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

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

          if (response.status === 429) {
            console.warn(`[Gemini API] Model ${model} reached quota limit (429). Switching to next model...`);
            break; // Try next model immediately
          }

          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        } catch (err: any) {
          console.warn(`[Gemini API] Network error on model ${model}: ${err.message}`);
        }
      }
    }

    throw new Error(`[Gemini API] All models (gemini-3-flash, gemini-2.5-flash, gemini-2.5-flash-lite) failed or exhausted quota.`);
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
}

