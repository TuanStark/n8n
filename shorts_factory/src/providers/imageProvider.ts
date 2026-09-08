import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';

const execAsync = promisify(exec);

export interface SceneImageParams {
  storyboardId: string;
  sceneIndex: number;
  category: string;
  visualDescription: string;
  characters?: string[];
  location?: string;
  positivePrompt?: string;
  narrationText?: string;  // The actual narration for this scene — ensures image matches voiceover
}

/**
 * Category-specific color palettes for cohesive visual storytelling
 */
const CATEGORY_PALETTES: Record<string, string> = {
  ancient_rome:
    'Rich crimson red, antique gold, warm ivory parchment, deep bronze, dark mahogany brown',
  ancient_greece:
    'Mediterranean azure blue, pristine white marble, olive green, terracotta orange, soft gold',
  ancient_egypt:
    'Desert sand gold, deep turquoise, lapis lazuli blue, warm amber, obsidian black accents',
};

/**
 * The style anchor — placed FIRST in prompt so AI models prioritize this style.
 * Pollinations/Flux pays most attention to the beginning of the prompt.
 */
const STYLE_ANCHOR =
  'Paper theater diorama, multi-layered paper cut shadow box with 5 depth layers, handcrafted miniature paper figures, visible paper texture and cut edges, warm golden backlight glowing through paper layers, soft spotlight, tiny paper craft characters';

/**
 * Strong negative prompt to block common failure modes
 */
const NEGATIVE_PROMPT =
  'photorealistic, real photograph, real human skin, realistic face, CGI, 3D render, glossy, plastic, digital painting, oil painting, watercolor, cartoon, anime, abstract, glass, crystal, modern, text, watermark, logo';

export class ImageProvider {
  private rawStorageDir: string;

  constructor() {
    this.rawStorageDir = config.storage.raw;
    if (!fs.existsSync(this.rawStorageDir)) {
      fs.mkdirSync(this.rawStorageDir, { recursive: true });
    }
  }

  /**
   * Builds a prompt with STYLE FIRST, then scene content that matches narration.
   * This ensures Pollinations/Flux generates paper theater style AND matches the voiceover.
   */
  private buildScenePrompt(params: SceneImageParams): string {
    const palette = CATEGORY_PALETTES[params.category] || CATEGORY_PALETTES.ancient_rome;

    // Extract the core scene description
    let sceneContent = (params.positivePrompt || params.visualDescription || '').trim();

    if (!sceneContent) {
      const charStr = params.characters?.length ? params.characters.join(' and ') : 'a historical figure';
      const locStr = params.location || 'an ancient setting';
      sceneContent = `${charStr} in ${locStr}`;
    }

    // If narration text is available, weave it into the prompt for content matching
    let narrationHint = '';
    if (params.narrationText) {
      // Extract key nouns/actions from narration to ensure visual matches voiceover
      narrationHint = ` depicting the moment: "${params.narrationText.slice(0, 120)}"`;
    }

    // CRITICAL: Style goes FIRST so Pollinations/Flux prioritizes paper theater look
    // Then scene content so it matches the narration
    const prompt = `${STYLE_ANCHOR}, ${palette}, ${sceneContent}${narrationHint}. No text, no watermark.`;

    return prompt;
  }

  /**
   * Generates a 9:16 vertical visual artwork for a scene
   */
  async generateSceneImage(params: SceneImageParams): Promise<string> {
    const filename = `scene_${params.storyboardId}_${params.sceneIndex}.jpg`;
    const outputPath = path.join(this.rawStorageDir, filename);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
      console.log(`[ImageProvider] Scene ${params.sceneIndex} artwork already exists at ${outputPath}`);
      return outputPath;
    }

    const scenePrompt = this.buildScenePrompt(params);

    console.log(`[ImageProvider] 🎨 Generating Scene ${params.sceneIndex} artwork...`);
    console.log(`[ImageProvider] Prompt: "${scenePrompt.slice(0, 150)}..." (${scenePrompt.length} chars)`);

    // 1. Try Google Gemini Image Models first
    if (config.gemini.apiKey) {
      const geminiResult = await this.tryGeminiImageGeneration(scenePrompt, outputPath, params.sceneIndex);
      if (geminiResult) return geminiResult;
    }

    // 2. Try Pollinations AI fallback
    const pollinationsResult = await this.tryPollinationsGeneration(scenePrompt, outputPath, params.sceneIndex);
    if (pollinationsResult) return pollinationsResult;

    // 3. Last resort: procedural fallback
    console.warn(`[ImageProvider] All AI endpoints failed. Generating procedural fallback...`);
    return await this.generateProceduralPapercraftFallback(params, outputPath);
  }

  /**
   * Gemini Image Generation with proper configuration
   */
  private async tryGeminiImageGeneration(
    prompt: string,
    outputPath: string,
    sceneIndex: number
  ): Promise<string | null> {
    const geminiImageModels = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];

    for (const gModel of geminiImageModels) {
      try {
        const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${config.gemini.apiKey}`;

        const requestBody: any = {
          contents: [
            {
              parts: [
                {
                  text: `Generate a vertical 9:16 aspect ratio image of the following scene. The image must clearly show recognizable characters and a specific location. Do NOT create abstract art.\n\nScene: ${prompt}\n\nIMPORTANT: Show clear, recognizable paper-cut characters with visible faces, clothing details, and body poses. The scene must tell a story visually.`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['IMAGE'],
          },
        };

        const gRes = await fetch(gUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (gRes.ok) {
          const gData = await gRes.json();
          const parts = gData.candidates?.[0]?.content?.parts || [];
          for (const p of parts) {
            if (p.inlineData && p.inlineData.data) {
              const imgBuf = Buffer.from(p.inlineData.data, 'base64');
              if (imgBuf.length > 5000) {
                fs.writeFileSync(outputPath, imgBuf);
                console.log(
                  `[ImageProvider] ✅ Scene ${sceneIndex} generated via ${gModel} (${(imgBuf.length / 1024).toFixed(1)} KB)`
                );
                await this.ensureStandardResolution(outputPath);
                return outputPath;
              }
            }
          }
        } else {
          const errText = await gRes.text().catch(() => '');
          console.warn(`[ImageProvider] Gemini ${gModel} returned HTTP ${gRes.status}: ${errText.slice(0, 200)}`);
        }
      } catch (gErr: any) {
        console.warn(`[ImageProvider] Gemini ${gModel} error: ${gErr.message}`);
      }
    }

    return null;
  }

  /**
   * Pollinations AI fallback with focused prompts and retry-with-backoff
   */
  private async tryPollinationsGeneration(
    prompt: string,
    outputPath: string,
    sceneIndex: number
  ): Promise<string | null> {
    const modelsToTry = ['flux', 'flux-realism', 'turbo'];
    const maxRounds = 2; // Try all models twice with backoff between rounds

    for (let round = 0; round < maxRounds; round++) {
      if (round > 0) {
        console.log(`[ImageProvider] ⏳ Waiting 12s before retry round ${round + 1}...`);
        await new Promise((r) => setTimeout(r, 12000));
      }

      for (const model of modelsToTry) {
        try {
          console.log(`[ImageProvider] Trying Pollinations (model: ${model}, round ${round + 1})...`);

          const seed = Math.floor(Math.random() * 9999999);
          const encodedPrompt = encodeURIComponent(prompt);
          const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1792&model=${model}&nologo=true&seed=${seed}`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

          const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'PaperTheaterShortsFactory/3.0' },
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > 5000) {
              fs.writeFileSync(outputPath, buffer);
              console.log(
                `[ImageProvider] ✅ Scene ${sceneIndex} generated via Pollinations/${model} (${(buffer.length / 1024).toFixed(1)} KB)`
              );
              await this.ensureStandardResolution(outputPath);
              return outputPath;
            }
          } else {
            console.warn(`[ImageProvider] Pollinations ${model} returned HTTP ${response.status}`);
          }
        } catch (err: any) {
          console.warn(`[ImageProvider] Pollinations ${model} failed: ${err.message}`);
        }
      }
    }

    return null;
  }

  /**
   * Ensures output image matches exact 1080x1920 vertical format for YouTube Shorts
   */
  private async ensureStandardResolution(imagePath: string): Promise<void> {
    try {
      const tempPath = `${imagePath}.scaled.jpg`;
      const cmd = `ffmpeg -y -i "${imagePath}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" -q:v 2 "${tempPath}"`;
      await execAsync(cmd);
      if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 2000) {
        fs.renameSync(tempPath, imagePath);
      }
    } catch (e) {
      // Non-fatal if scaling fails
    }
  }

  /**
   * Generates a realistic layered paper diorama backdrop with texture and ambient shadows if AI offline
   */
  private async generateProceduralPapercraftFallback(
    params: SceneImageParams,
    outputPath: string
  ): Promise<string> {
    const cmd = `ffmpeg -y -f lavfi -i color=c=0xD5C4A1:s=1080x1920:d=1 \
      -vf "drawbox=x=60:y=100:w=960:h=1720:color=0x3C3836@0.7:t=fill,drawbox=x=90:y=130:w=900:h=1660:color=0xFBF1C7@0.9:t=fill,drawbox=x=120:y=160:w=840:h=1600:color=0xEBDBB2@0.95:t=fill,noise=c1s=8:c0f=u" \
      -frames:v 1 "${outputPath}"`;

    try {
      await execAsync(cmd);
      console.log(`[ImageProvider] Generated procedural papercraft backdrop at ${outputPath}`);
    } catch (err) {
      const dummyJpeg = Buffer.from(
        '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
        'base64'
      );
      fs.writeFileSync(outputPath, dummyJpeg);
    }

    return outputPath;
  }
}
