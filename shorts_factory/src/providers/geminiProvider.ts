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
  }[];
}

export class GeminiProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
  }

  private async callGemini(prompt: string, systemInstruction?: string, retries = 3): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    
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

    for (let attempt = 1; attempt <= retries; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      }

      const errText = await response.text();
      if ((response.status === 503 || response.status === 429) && attempt < retries) {
        console.warn(`[Gemini API] Got status ${response.status} (attempt ${attempt}/${retries}). Retrying in ${attempt * 2000}ms...`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        continue;
      }

      throw new Error(`[Gemini API Error ${response.status}]: ${errText}`);
    }

    return '{}';
  }

  private safeJsonParse<T>(raw: string): T {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      // Fix bad escaped characters like \a, \(, \)
      const sanitized = cleaned.replace(/\\([^"\\/bfnrtu])/g, '$1');
      return JSON.parse(sanitized) as T;
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
    const system = `You are a Master Diorama Art Director & Storyboard Artist for "Paper Theater World".
Every scene takes place in a physical, miniature handcrafted paper theater diorama.
Characters are textured paper cutouts with stop-motion brass brad joints.
Lighting is theatrical diorama spotlight with soft paper cast shadows.
Every visual prompt must incorporate the global paper craft style tokens.
Split the script into 4–7 coherent scenes.
Return strictly valid JSON.`;

    const prompt = `Convert this script into 4-7 detailed visual scenes for Paper Theater diorama animation:
Script: "${script.full_script}"
Duration: ${script.estimated_duration_sec}s
Segments: ${JSON.stringify(script.narration_segments)}

Global Style Positive tokens to blend into every positive_prompt:
"${styleProfile.global_positive}"

Global Negative tokens:
"${styleProfile.global_negative}"

Output JSON schema:
{
  "total_scenes": 5,
  "total_duration_sec": 35.0,
  "scenes": [
    {
      "scene_index": 1,
      "duration_sec": 6.0,
      "narration_text": "text for this scene",
      "visual_description": "detailed scene description",
      "characters": ["character names with paper attire details"],
      "location": "location diorama set",
      "camera_movement": "slow_push_in | pan_left | fixed_proscenium",
      "motion_style": "stop_motion_12fps",
      "sound_effects": ["paper_rustle", "ambient_distant_trumpets"],
      "positive_prompt": "prompt incorporating papercraft tokens and scene action",
      "negative_prompt": "negative prompt tokens"
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
}
