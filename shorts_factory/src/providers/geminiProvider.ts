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

    const models = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'];

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

  async generateShortsScript(title: string, research: ResearchOutput, targetDurationSec = 35): Promise<ScriptOutput> {
    const system = `You are a World-Class YouTube Shorts Scriptwriter for a top-tier international history channel ("Paper Theater World") targeting native English audiences (US, UK, Canada, Australia).
Audience: Skeptical, fast-scrolling, intelligent viewers aged 18–35 who love history, dark psychological twists, and tactical grit.

STRICT TIER-1 VIRALITY RULES:
1. THE 2-SECOND RULE: The first sentence MUST be an explosive pattern interrupt or contrarian truth.
   - BANNED: "Did you know", "In ancient Rome", "Have you ever wondered", "Meet Julius Caesar", "Imagine", "This is the story".
   - REQUIRED: Immediate cold open with visceral conflict or cognitive dissonance (e.g., "Everything you were taught about Sparta is a lie.").
2. PACING & CADENCE:
   - High information density: 80–100 words total (target duration 30–35s).
   - Short, punchy, active verbs. Eliminate all filler adjectives and passive voice.
   - Rhythm: BBC Documentary meets high-tension thriller (Dan Carlin style).
3. 5-PHASE NARRATIVE ARC:
   - Phase 1: HOOK (0–3s): Shocking contrarian statement.
   - Phase 2: THE TRAP (3–10s): The brutal reality / impossible dilemma.
   - Phase 3: THE GAMBLE (10–20s): The desperate, audacious move.
   - Phase 4: THE TWIST (20–28s): The unexpected historical truth.
   - Phase 5: SEAMLESS LOOP & COMMENT BAIT (28–34s): End on a sharp moral dilemma or provocative question that seamlessly connects back to the opening hook for infinite replays, while driving fierce debates in the comment section.

Return strictly valid JSON.`;

    const prompt = `Generate a viral YouTube Shorts script for topic: "${title}".
Target duration: ${targetDurationSec} seconds.
Research Data:
${JSON.stringify(research, null, 2)}

Output JSON schema:
{
  "hook_text": "string (the punchy 1st sentence)",
  "full_script": "string (complete spoken narration)",
  "estimated_duration_sec": 35.0,
  "hook_score": 9.2,
  "narration_segments": [
    {
      "segment_index": 1,
      "text": "sentence 1",
      "estimated_sec": 5.0,
      "visual_intent": "visual scene intent"
    }
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
    const system = `You are an Elite Editorial Art Director, Paper Engineer, Stop-Motion Designer, Motion Graphics Director, and Visual Storytelling Expert.
Your job is to convert the YouTube Shorts narration into 4–6 high-budget handcrafted paper stop-motion scenes, matching premium editorial motion graphics (like Vox, Luxury Editorial, Apple Keynote).

THINKING PROCESS FOR EVERY SCENE:
1. What is the core message and visual metaphor of this narration segment?
2. ONE HERO OBJECT: Dominates 70% of the composition (never compete with hero object).
3. SUPPORTING OBJECTS: Maximum 2–3 supporting objects (20% of composition).
4. BACKGROUND: Clean, minimal matching custom background (10% composition). Never crowded, generous negative space.
5. NO RANDOM OBJECTS: Never add random arrows, circles, stars, icons, or decorations.
6. PHYSICAL PAPER CRAFT RULES:
   - Everything built entirely from thick cardstock, handmade paper, kraft paper, matte construction paper, watercolor paper, corrugated cardboard.
   - Every object reveals 30–100 individually cut paper layers, visible cardstock thickness, laser-cut edges, paper fibers, stacked contour slices, recessed paper layers, handcrafted glue joints, deep shadow gaps.
   - NEVER SHOW canvas, display board, poster, tabletop, frame. The entire world itself is made of layered paper.
   - Lighting: Soft museum lighting, top-left directional light, deep ambient shadows between paper layers.

MANDATORY IMAGE PROMPT (positive_prompt):
Every scene's positive_prompt must describe Concept, Composition (70/20/10), Background, Color palette, and Lighting, and MUST END WITH this exact text:
"Every object must appear physically handcrafted from individually cut paper pieces, with dramatic stacked cardstock layers, visible paper thickness, exposed cut edges, deep shadow separation, and realistic handcrafted paper textures. Every visible surface must reveal layer-after-layer paper construction. The composition must remain clean, minimal, and editorial with generous negative space. No flat surfaces. No digital illustration. No clutter. Premium handcrafted stop-motion paper aesthetic. Masterpiece. Ultra-detailed. 8K. No text. No logos. No watermark."

UNIVERSAL VIDEO PROMPT (video_prompt):
Every scene's video_prompt must specify:
- Duration: 5–10 seconds.
- Camera: Locked camera 100%. No zoom, pan, tilt, rotation, orbit, dolly, shake. Single continuous static shot.
- 0–7 seconds (Layer-by-Layer Assembly): Background paper -> backdrop -> architecture/ground -> hero subject assembly -> supporting pieces. Each layer slides gently, drops naturally, tiny handcrafted paper bounce, casting realistic layered shadows.
- 7–10 seconds (Living Paper Poster): Everything stays in original position. Only subtle stop-motion movement (micro-blinking, breathing, gentle hair/cloth flutter, paper shadows shift, tiny stop-motion jitter).
- Audio ASMR Cues: Cardstock sliding, paper friction, soft taps, cardboard sounds, quiet studio ambience.

Return strictly valid JSON.`;

    const prompt = `Deconstruct this historical script into 4-6 master paper stop-motion scenes:
Script: "${script.full_script}"
Duration: ${script.estimated_duration_sec}s
Segments: ${JSON.stringify(script.narration_segments)}

Output JSON schema:
{
  "total_scenes": 5,
  "total_duration_sec": 32.0,
  "scenes": [
    {
      "scene_index": 1,
      "duration_sec": 6.0,
      "narration_text": "text for this scene",
      "visual_description": "dramatic editorial visual concept",
      "characters": ["character names"],
      "location": "paper theater diorama location",
      "camera_movement": "locked_static_camera",
      "motion_style": "handcrafted_stop_motion_12fps",
      "sound_effects": ["paper_sliding", "cardstock_friction", "soft_paper_tap"],
      "positive_prompt": "Complete cinematic image prompt ending with the mandatory papercraft ending suffix",
      "negative_prompt": "(worst quality:1.4), photorealistic humans, 3d cgi render, glossy plastic, smooth digital painting, flat vector, cartoon, anime, canvas, poster board, tabletop, modern elements, watermark, logo, text",
      "video_prompt": "Transform the provided image into a 10-second premium handcrafted stop-motion editorial paper-cut animation. Locked camera 100%. 0-7s: Layer-by-layer assembly... 7-10s: Living paper poster...",
      "paper_asmr_cues": ["cardstock_slide", "paper_friction", "soft_tap"]
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

