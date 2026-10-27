import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
  stylePromptOverride?: string;
  negativePromptOverride?: string;
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
  private sessionHashes: Set<string> = new Set<string>();
  private static lastPollinationsCallTime: number = 0;

  constructor() {
    this.rawStorageDir = config.storage.raw;
    if (!fs.existsSync(this.rawStorageDir)) {
      fs.mkdirSync(this.rawStorageDir, { recursive: true });
    }
  }

  /**
   * Resets session hash set for a new video pipeline run to ensure zero duplication
   */
  resetSessionHashes(): void {
    this.sessionHashes.clear();
  }

  private calculateFileHash(filePath: string): string {
    try {
      const buffer = fs.readFileSync(filePath);
      return crypto.createHash('md5').update(buffer).digest('hex');
    } catch {
      return '';
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

    // If custom style override is provided, keep prompt focused and under 200 chars for diffusion stability
    if (params.stylePromptOverride) {
      if (sceneContent.length > 120) {
        return sceneContent.slice(0, 200);
      }
      return `${sceneContent}, ${params.stylePromptOverride}`.slice(0, 200);
    }

    // Default: Hero Object & Metaphor FIRST so diffusion models anchor on the subject immediately
    return `still life layered papercraft art of ${sceneContent}. ${STYLE_ANCHOR}, ${palette} color palette.${narrationHint} Every object must appear physically handcrafted from individually cut paper pieces with visible cardstock thickness and shadow separation. Masterpiece, 8K, no text, no watermark, no pedestal.`;
  }

  /**
   * Generates a 9:16 vertical visual artwork for a scene with strict duplicate prevention
   */
  async generateSceneImage(params: SceneImageParams): Promise<string> {
    const filename = `scene_${params.storyboardId}_${params.sceneIndex}.jpg`;
    const outputPath = path.join(this.rawStorageDir, filename);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
      const existingHash = this.calculateFileHash(outputPath);
      if (existingHash && !this.sessionHashes.has(existingHash)) {
        this.sessionHashes.add(existingHash);
        console.log(`[ImageProvider] Scene ${params.sceneIndex} artwork already exists at ${outputPath} (Hash: ${existingHash.slice(0, 8)})`);
        return outputPath;
      }
      console.warn(`[ImageProvider] ⚠️ Existing file ${outputPath} matches a duplicate hash in this video! Deleting and re-generating fresh image...`);
      try { fs.unlinkSync(outputPath); } catch {}
    }

    const scenePrompt = this.buildScenePrompt(params);

    console.log(`[ImageProvider] 🎨 Generating Scene ${params.sceneIndex} artwork...`);
    console.log(`[ImageProvider] Prompt: "${scenePrompt.slice(0, 150)}..." (${scenePrompt.length} chars)`);

    let finalPath: string | null = null;

    // 1. Primary: High-fidelity free diffusion models (Sana, FLUX)
    finalPath = await this.tryPollinationsGeneration(scenePrompt, outputPath, params.sceneIndex);

    // 2. Secondary fallback: Gemini Image Models if configured
    if (!finalPath && config.gemini.apiKey) {
      finalPath = await this.tryGeminiImageGeneration(scenePrompt, outputPath, params.sceneIndex);
    }

    // 3. Last resort: genre-aware visual fallback
    if (!finalPath) {
      console.warn(`[ImageProvider] AI endpoints throttled. Using curated genre visual fallback...`);
      finalPath = await this.generateGenreAwareFallback(params, outputPath);
    }

    // STRICT ANTI-DUPLICATION VERIFICATION:
    let hash = this.calculateFileHash(finalPath);
    if (hash && this.sessionHashes.has(hash)) {
      console.warn(`[ImageProvider] Duplicate hash for Scene ${params.sceneIndex}. Selecting variant...`);
      finalPath = await this.generateGenreAwareFallback(params, outputPath);
      hash = this.calculateFileHash(finalPath);
    }

    if (hash) {
      this.sessionHashes.add(hash);
    }

    return finalPath;
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
                  text: `Generate a vertical 9:16 aspect ratio cinematic image.\nComposition: 9:16 vertical smartphone composition with dramatic lighting, generous negative space, sharp focus, masterpiece.\nABSOLUTELY FORBIDDEN: Do NOT draw a frame, outer border, display box, cartoon, or modern watermarks.\n\nScene details: ${prompt}`,
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
   * Pollinations AI generation with rate-limit cooldown and retry-with-backoff
   */
  private async tryPollinationsGeneration(
    prompt: string,
    outputPath: string,
    sceneIndex: number
  ): Promise<string | null> {
    const pollenKey = process.env.POLLINATIONS_API_KEY || process.env.POLLEN_API_KEY || '';
    const modelsToTry = ['', 'flux'];
    const maxRounds = 2;

    for (let round = 0; round < maxRounds; round++) {
      for (const model of modelsToTry) {
        // Enforce Pollinations 45s free rate limit cooldown between calls if no API key is provided
        if (!pollenKey && ImageProvider.lastPollinationsCallTime > 0) {
          const elapsedSec = (Date.now() - ImageProvider.lastPollinationsCallTime) / 1000;
          if (elapsedSec < 46) {
            const waitSec = Math.ceil(46 - elapsedSec);
            console.log(`[ImageProvider] ⏳ Pollinations rate limit cooldown: waiting ${waitSec}s before Scene ${sceneIndex}...`);
            await new Promise((r) => setTimeout(r, waitSec * 1000));
          }
        }

        try {
          console.log(`[ImageProvider] Trying Pollinations (model: ${model || 'default/sana'}, round ${round + 1})...`);

          const seed = Math.floor(Math.random() * 9999999);
          // Keep prompt compact (< 180 chars) to avoid Cloudflare/Pollinations 414 URI Too Long or 500 error
          const cleanPrompt = prompt.replace(/[^\w\s,.:;-]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 180);
          const encodedPrompt = encodeURIComponent(cleanPrompt);
          const modelParam = model ? `&model=${model}` : '';
          const keyParam = pollenKey ? `&key=${pollenKey}` : '';
          const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=768&height=1344${modelParam}&nologo=true&seed=${seed}${keyParam}`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

          const headers: Record<string, string> = { 'User-Agent': 'ShortsFactoryMultiChannel/2.0' };
          if (pollenKey) {
            headers['Authorization'] = `Bearer ${pollenKey}`;
          }

          const response = await fetch(url, {
            signal: controller.signal,
            headers,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > 5000) {
              fs.writeFileSync(outputPath, buffer);
              ImageProvider.lastPollinationsCallTime = Date.now();
              console.log(
                `[ImageProvider] ✅ Scene ${sceneIndex} generated via Pollinations/${model || 'default'} (${(buffer.length / 1024).toFixed(1)} KB)`
              );
              await this.ensureStandardResolution(outputPath);
              return outputPath;
            }
          } else if (response.status === 402) {
            const errJson: any = await response.json().catch(() => ({}));
            const errMsg = errJson?.error?.message || '';
            const retryMatch = errMsg.match(/Retry after (\d+)s/i);
            const waitSec = retryMatch ? parseInt(retryMatch[1], 10) : 46;
            console.warn(`[ImageProvider] Pollinations 402 Rate Limit: ${errMsg || 'Free limit reached'}. Waiting ${waitSec}s...`);
            await new Promise((r) => setTimeout(r, (waitSec + 1) * 1000));
          } else if (response.status === 429) {
            console.warn(`[ImageProvider] Pollinations returned 429 (rate limit). Pausing 5s...`);
            await new Promise((r) => setTimeout(r, 5000));
          } else {
            console.warn(`[ImageProvider] Pollinations ${model || 'default'} returned HTTP ${response.status}`);
          }
        } catch (err: any) {
          console.warn(`[ImageProvider] Pollinations ${model || 'default'} error: ${err.message}`);
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
   * Generates a genre-aware visual using curated assets library with dynamic variation
   */
  private async generateGenreAwareFallback(
    params: SceneImageParams,
    outputPath: string
  ): Promise<string> {
    const assetsBase = path.join(path.dirname(this.rawStorageDir), 'assets');
    const targetDir = path.join(assetsBase, params.category || 'paper_history');

    let candidateFiles: string[] = [];

    // 1. Look in the requested category directory
    if (fs.existsSync(targetDir)) {
      candidateFiles = fs
        .readdirSync(targetDir)
        .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
        .map((f) => path.join(targetDir, f));
    }

    // 2. If no files in category, gather all images across all asset categories
    if (candidateFiles.length === 0 && fs.existsSync(assetsBase)) {
      const subdirs = fs.readdirSync(assetsBase);
      for (const sub of subdirs) {
        const subPath = path.join(assetsBase, sub);
        if (fs.statSync(subPath).isDirectory()) {
          const files = fs
            .readdirSync(subPath)
            .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
            .map((f) => path.join(subPath, f));
          candidateFiles.push(...files);
        }
      }
    }

    // 3. Select candidate with hash-based rotation and apply dynamic FFmpeg variation
    if (candidateFiles.length > 0) {
      const hashStr = crypto
        .createHash('sha256')
        .update(`${params.storyboardId}_${params.sceneIndex}_${params.visualDescription || ''}`)
        .digest('hex');

      const chosenIndex = parseInt(hashStr.slice(0, 8), 16) % candidateFiles.length;
      const chosenFile = candidateFiles[chosenIndex];

      // Subtle dynamic color & mood grading so no two scenes/videos are visually identical
      const seedNum = parseInt(hashStr.slice(8, 14), 16);
      const contrast = (0.95 + (seedNum % 10) * 0.01).toFixed(2);
      const brightness = (-0.02 + ((seedNum >> 4) % 5) * 0.01).toFixed(2);
      const saturation = (0.93 + ((seedNum >> 8) % 15) * 0.01).toFixed(2);

      const cmd = `ffmpeg -y -i "${chosenFile}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation},vignette=PI/4.5" -q:v 2 "${outputPath}"`;

      try {
        await execAsync(cmd);
        console.log(
          `[ImageProvider] ✅ Using styled curated artwork for Scene ${params.sceneIndex} from ${path.basename(chosenFile)} (Var: c=${contrast}, s=${saturation})`
        );
        return outputPath;
      } catch (cmdErr) {
        console.warn(`[ImageProvider] Error applying dynamic style to asset, falling back to direct copy:`, cmdErr);
        try {
          fs.copyFileSync(chosenFile, outputPath);
          await this.ensureStandardResolution(outputPath);
          return outputPath;
        } catch (copyErr) {
          console.warn(`[ImageProvider] Error copying asset:`, copyErr);
        }
      }
    }

    // 4. Absolute last resort: create a rich golden-bronze papercraft texture backdrop
    const cmd = `ffmpeg -y -f lavfi -i color=c=0x2b1d0c:s=1080x1920:d=1 \
      -vf "noise=c1s=15:c0f=u,vignette=PI/3" \
      -frames:v 1 "${outputPath}"`;

    try {
      await execAsync(cmd);
      console.log(`[ImageProvider] Generated warm parchment backdrop for Scene ${params.sceneIndex}`);
    } catch (err) {
      console.error(`[ImageProvider] Fallback creation failed:`, err);
    }

    return outputPath;
  }
}
