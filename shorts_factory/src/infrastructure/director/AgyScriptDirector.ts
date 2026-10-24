import { IScriptDirector, DirectorialScript } from '../../core/ports/IScriptDirector';
import { GenreProfile } from '../../core/domain/GenreProfile';
import { config } from '../../config';

export class AgyScriptDirector implements IScriptDirector {
  private bridgeUrl: string;

  constructor() {
    this.bridgeUrl = config.agy.bridgeUrl;
  }

  async generateScriptForChannel(
    topic: string,
    genre: GenreProfile,
    customInstructions?: string
  ): Promise<DirectorialScript> {
    console.log(`[AgyScriptDirector] 🎬 Generating directorial script via AGY Engine for genre "${genre.name}"...`);

    const systemInstruction = `
${genre.systemPromptScriptwriter}

CRITICAL FORMAT REQUIREMENT:
You must output a single valid JSON object strictly matching this schema:
{
  "title": "Compelling Title under 60 chars",
  "hook_headline": "Visual on-screen title banner",
  "target_duration_sec": 45,
  "full_script": "Complete spoken transcript",
  "scenes": [
    {
      "scene_index": 1,
      "duration_sec": 4.5,
      "narration_text": "Spoken sentence for this scene",
      "visual_description": "Detailed scene description",
      "camera_movement": "push_in",
      "positive_prompt": "${genre.visualStylePrompt}, [Subject and action]",
      "negative_prompt": "${genre.visualNegativePrompt}"
    }
  ],
  "narration_segments": [
    { "text": "Segment text", "estimated_sec": 4.0 }
  ]
}
`.trim();

    const prompt = `
Topic: "${topic}"
Channel Genre: "${genre.name}"
${customInstructions ? `Special Instructions: ${customInstructions}` : ''}

Generate an irresistible, viral YouTube Shorts script with 7-9 high-retention scenes.
`.trim();

    let scriptJson: any = null;

    if (this.bridgeUrl) {
      try {
        const res = await fetch(`${this.bridgeUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            systemInstruction,
            jsonMode: true,
            timeoutSec: 150,
          }),
        });

        if (res.ok) {
          const body: any = await res.json();
          if (body.success && body.data) {
            scriptJson = body.data;
          } else if (body.cleaned) {
            try {
              scriptJson = JSON.parse(body.cleaned);
            } catch (err) {
              console.warn('[AgyScriptDirector] JSON parse fallback failed:', err);
            }
          }
        }
      } catch (bridgeErr: any) {
        console.warn(`[AgyScriptDirector] AGY Bridge call failed (${bridgeErr.message}), falling back...`);
      }
    }

    if (!scriptJson || !scriptJson.scenes || !Array.isArray(scriptJson.scenes)) {
      // Fallback deterministic structure
      console.warn('[AgyScriptDirector] Generating fallback structured script.');
      scriptJson = {
        title: topic,
        hook_headline: topic.toUpperCase(),
        target_duration_sec: 40,
        full_script: `Discover the untold reality behind ${topic}. Everything you thought you knew is about to change. Watch closely until the very end.`,
        scenes: [
          {
            scene_index: 1,
            duration_sec: 5.0,
            narration_text: `Discover the untold reality behind ${topic}.`,
            visual_description: `Cinematic dramatic establishing visual for ${topic}`,
            camera_movement: 'push_in',
            positive_prompt: `${genre.visualStylePrompt}, dramatic mystery opening of ${topic}`,
            negative_prompt: genre.visualNegativePrompt,
          },
          {
            scene_index: 2,
            duration_sec: 5.0,
            narration_text: `Everything you thought you knew is about to change.`,
            visual_description: `Revealing intense climax moment of ${topic}`,
            camera_movement: 'pan_right',
            positive_prompt: `${genre.visualStylePrompt}, epic revelation about ${topic}`,
            negative_prompt: genre.visualNegativePrompt,
          },
          {
            scene_index: 3,
            duration_sec: 5.0,
            narration_text: `Watch closely until the very end.`,
            visual_description: `Philosophical concluding frame for ${topic}`,
            camera_movement: 'slow_zoom',
            positive_prompt: `${genre.visualStylePrompt}, memorable closing portrait of ${topic}`,
            negative_prompt: genre.visualNegativePrompt,
          },
        ],
        narration_segments: [
          { text: `Discover the untold reality behind ${topic}.`, estimated_sec: 5.0 },
          { text: `Everything you thought you knew is about to change.`, estimated_sec: 5.0 },
          { text: `Watch closely until the very end.`, estimated_sec: 5.0 },
        ],
      };
    }

    return {
      title: scriptJson.title || topic,
      hookHeadline: scriptJson.hook_headline || scriptJson.title || topic,
      targetDurationSec: scriptJson.target_duration_sec || 45,
      fullScript: scriptJson.full_script || '',
      scenes: (scriptJson.scenes || []).map((sc: any, idx: number) => ({
        sceneIndex: sc.scene_index || idx + 1,
        durationSec: sc.duration_sec || 4.5,
        narrationText: sc.narration_text || '',
        visualDescription: sc.visual_description || '',
        location: sc.location,
        cameraMovement: sc.camera_movement || 'push_in',
        soundEffects: sc.sound_effects || [],
        positivePrompt: sc.positive_prompt || `${genre.visualStylePrompt}, ${sc.visual_description}`,
        negativePrompt: sc.negative_prompt || genre.visualNegativePrompt,
      })),
      narrationSegments: scriptJson.narration_segments || [
        { text: scriptJson.full_script || topic, estimatedSec: 40 },
      ],
    };
  }
}
