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
 * Adheres strictly to the Master Editorial Paper Stop-Motion standard.
 */
const STYLE_ANCHOR =
  'layered papercraft art, authentic paper theater, crafted entirely from stacked cut-out cardstock layers, precision laser-cut paper edges, physical relief, tangible paper thickness, deep drop shadows between paper layers, raw paper fibers and paper texture, top-down relief on textured cardstock background, dramatic museum directional lighting, cinematic paper stop-motion aesthetic, clean composition with generous negative space, no frames, no pedestals';

/**
 * Strong negative prompt to block pedestals, plinths, flat illustration, 3D CGI, cartoons, frames, and anime
 */
const NEGATIVE_PROMPT =
  'pedestal, plinth, stand, base, wooden stand, display stand, platform, tabletop, desk surface, cutting mat, floor, cartoon, anime, manga, 3d cgi render, glossy plastic, flat vector, digital painting, smooth airbrush, photorealistic human skin, photograph, frame, border, outer box, display box, diorama box, poster, canvas, modern elements, text, watermark, logo, blurry, cluttered, noisy background';

export class ImageProvider {
  private rawStorageDir: string;

  constructor() {
    this.rawStorageDir = config.storage.raw;
    if (!fs.existsSync(this.rawStorageDir)) {
      fs.mkdirSync(this.rawStorageDir, { recursive: true });
    }
  }

  /**
   * Constructs the full image prompt by merging scene-specific details with the master style anchor.
   * Places the Hero Subject FIRST so diffusion models anchor on the visual metaphor immediately.
   */
  buildScenePrompt(params: SceneImageParams): string {
    const palette = CATEGORY_PALETTES[params.category] || CATEGORY_PALETTES.ancient_rome;

    // Extract the core scene description
    let sceneContent = (params.positivePrompt || params.visualDescription || '').trim();

    if (!sceneContent) {
      const charStr = params.characters?.length ? params.characters.join(' and ') : 'a historical hero';
      const locStr = params.location || 'an ancient setting';
      sceneContent = `${charStr} in ${locStr}`;
    }

    // If narration text is available, weave it into the prompt for content matching
    let narrationHint = '';
    if (params.narrationText && !sceneContent.toLowerCase().includes(params.narrationText.slice(0, 30).toLowerCase())) {
      narrationHint = ` Visual concept for moment: "${params.narrationText.slice(0, 100)}".`;
    }

    // Hero Object & Metaphor FIRST so diffusion models anchor on the subject immediately
    return `still life layered papercraft art of ${sceneContent}. ${STYLE_ANCHOR}, ${palette} color palette.${narrationHint} Every object must appear physically handcrafted from individually cut paper pieces with visible cardstock thickness and shadow separation. Masterpiece, 8K, no text, no watermark, no pedestal.`;
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
                  text: `Generate a vertical 9:16 aspect ratio image of this premium handcrafted editorial paper sculpture.\nStyle: Authentic physical paper-cut sculpture with 30-100 stacked cardstock contour layers, deep shadow gaps between layers, visible paper thickness, raw paper fibers, and soft top-left museum lighting.\nComposition: Clean, minimal editorial composition featuring ONE dominant Hero Object (70% of frame), minimal background with generous negative space.\nABSOLUTELY FORBIDDEN: Do NOT draw a frame, outer border, display box, tabletop, or cartoonish drawings. The entire image must be the paper craft world itself.\n\nScene details: ${prompt}`,
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
          const encodedPrompt = encodeURIComponent(prompt.slice(0, 1800));
          const encodedNegative = encodeURIComponent(NEGATIVE_PROMPT);
          const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1792&model=${model}&nologo=true&seed=${seed}&negative=${encodedNegative}`;

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
