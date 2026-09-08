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
    const system = `You are a Paper Theater Art Director. You create scenes for a YouTube Shorts channel that uses PAPER CUT SHADOW BOX DIORAMA style.

WHAT IS PAPER THEATER:
- A miniature 3D scene inside a box/frame made entirely of layered cut paper
- Characters are small paper figurines (NOT realistic humans)
- Background, middle-ground, and foreground are separate paper layers creating depth
- Warm light glows through the paper from behind
- Everything looks handcrafted, delicate, and magical — like a tiny world in a box
- Think of it as a tiny stage with paper puppets performing a scene

MANDATORY RULES:

1. NARRATION SYNC: The positive_prompt MUST visually depict EXACTLY what the narration_text is saying. If narration says "Caesar was stabbed", the image MUST show paper figurines of senators stabbing Caesar. NO DISCONNECTED IMAGERY.

2. PAPER THEATER STYLE: Every prompt must describe paper craft elements:
   - "tiny paper figurine of [character]" NOT "realistic [character]"
   - "layered paper cut background of [location]" NOT just "[location]"
   - "paper shadow box diorama frame" to ensure the box/frame is visible
   - "warm backlight glowing through paper edges"

3. SCENE VARIETY: Each scene must have different:
   - Composition (wide establishing / medium / detail close-up)
   - Color temperature (warm gold / cool blue / fiery red / soft purple)
   - Mood lighting direction

4. WELL-LIT: Characters must be clearly visible. No dark silhouettes.

POSITIVE PROMPT FORMAT (follow exactly):
"Paper theater shadow box diorama of [SCENE MATCHING NARRATION]. Tiny paper figurine of [character description] [action]. Layered paper cut [location] with [2-3 specific props]. [Color] warm backlight through paper edges. Handcrafted miniature paper art, visible paper texture and cut edges."

Return strictly valid JSON.`;

    const prompt = `Create 5 paper theater diorama scenes. CRITICAL: Each scene's image MUST match its narration text exactly.

Script: "${script.full_script}"
Duration: ${script.estimated_duration_sec}s
Segments: ${JSON.stringify(script.narration_segments)}

RULES:
- The positive_prompt describes what you SEE in the paper theater box
- The narration_text is what the voiceover SAYS at that moment
- They MUST describe the SAME event/moment
- Every prompt must include "paper theater", "paper figurine", "shadow box", "paper cut layers"
- Characters are PAPER FIGURINES, not real people

Output JSON:
{
  "total_scenes": 5,
  "total_duration_sec": 32.0,
  "scenes": [
    {
      "scene_index": 1,
      "duration_sec": 6.5,
      "narration_text": "exact narration text for this segment",
      "visual_description": "Paper theater scene of [what narration describes]",
      "characters": ["Character Name - paper figurine with specific clothes/colors"],
      "location": "Paper cut layered [specific location]",
      "camera_movement": "locked_static_camera",
      "motion_style": "smooth_cinematic",
      "sound_effects": ["paper_sliding", "soft_ambient"],
      "positive_prompt": "Paper theater shadow box diorama of [scene matching narration]. Tiny paper figurine of [character] [action]. Layered paper cut [location] with [props]. Warm golden backlight through paper edges. Handcrafted miniature paper art, visible paper texture.",
      "negative_prompt": "photorealistic, real human, realistic skin, photograph, CGI, 3D render, digital art, cartoon, anime, text, watermark",
      "video_prompt": "Smooth parallax camera through paper layers",
      "paper_asmr_cues": ["paper_slide", "soft_tap"]
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

