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
}

const MANDATORY_PAPER_SUFFIX =
  'Every object must appear physically handcrafted from individually cut paper pieces, with dramatic stacked cardstock layers, visible paper thickness, exposed cut edges, deep shadow separation, and realistic handcrafted paper textures. Every visible surface must reveal layer-after-layer paper construction. The composition must remain clean, minimal, and editorial with generous negative space. No flat surfaces. No digital illustration. No clutter. Premium handcrafted stop-motion paper aesthetic. Masterpiece. Ultra-detailed. 8K. No text. No logos. No watermark.';

export class ImageProvider {
  private rawStorageDir: string;

  constructor() {
    this.rawStorageDir = config.storage.raw;
    if (!fs.existsSync(this.rawStorageDir)) {
      fs.mkdirSync(this.rawStorageDir, { recursive: true });
    }
  }

  /**
   * Generates a 9:16 vertical visual artwork for a scene following the Master GPT Prompt rules
   */
  async generateSceneImage(params: SceneImageParams): Promise<string> {
    const filename = `scene_${params.storyboardId}_${params.sceneIndex}.jpg`;
    const outputPath = path.join(this.rawStorageDir, filename);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
      console.log(`[ImageProvider] Scene ${params.sceneIndex} artwork already exists at ${outputPath}`);
      return outputPath;
    }

    // Build the master prompt without truncation
    let fullPrompt = (params.positivePrompt || params.visualDescription || '').trim();
    if (!fullPrompt) {
      fullPrompt = `Handcrafted paper stop-motion miniature diorama of ${params.category.replace('_', ' ')}, ${params.location || 'ancient arena'}`;
    }

    // Ensure mandatory suffix is present
    if (!fullPrompt.includes('Every object must appear physically handcrafted')) {
      fullPrompt = `${fullPrompt}. ${MANDATORY_PAPER_SUFFIX}`;
    }

    // Craft anchors ensuring genuine paper theater rather than 3D wax
    const craftAnchorPrompt = `Kirigami layered paper cut art, physical layered cardstock papercraft diorama, ${fullPrompt}, borderless paper art, no frame, no shadowbox, no wooden box, no 3D digital render`;

    console.log(`[ImageProvider] 🎨 Generating Papercraft Master Artwork for Scene ${params.sceneIndex}...`);
    console.log(`[ImageProvider] Prompt preview: "${craftAnchorPrompt.slice(0, 120)}..." (Length: ${craftAnchorPrompt.length} chars)`);

    // 1. Try Google Gemini Image Models first if apiKey is set
    if (config.gemini.apiKey) {
      const geminiImageModels = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image'];
      for (const gModel of geminiImageModels) {
        try {
          const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${config.gemini.apiKey}`;
          const gRes = await fetch(gUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: craftAnchorPrompt }] }],
              generationConfig: { responseModalities: ['IMAGE'] },
            }),
          });
          if (gRes.ok) {
            const gData = await gRes.json();
            const parts = gData.candidates?.[0]?.content?.parts || [];
            for (const p of parts) {
              if (p.inlineData && p.inlineData.data) {
                const imgBuf = Buffer.from(p.inlineData.data, 'base64');
                if (imgBuf.length > 5000) {
                  fs.writeFileSync(outputPath, imgBuf);
                  console.log(`[ImageProvider] ✅ Scene ${params.sceneIndex} generated via ${gModel} (${(imgBuf.length / 1024).toFixed(1)} KB)`);
                  await this.ensureStandardResolution(outputPath);
                  return outputPath;
                }
              }
            }
          }
        } catch (gErr: any) {
          // Fall through to next model
        }
      }
    }

    // 2. Try Pollinations AI with Flux models and generous 45s timeout
    const modelsToTry = ['flux', 'flux-realism', 'turbo'];
    for (const model of modelsToTry) {
      try {
        console.log(`[ImageProvider] Requesting AI generation via Pollinations (model: ${model})...`);
        const seed = Math.floor(Math.random() * 9999999);
        const encodedPrompt = encodeURIComponent(craftAnchorPrompt);
        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=720&height=1280&model=${model}&nologo=true&seed=${seed}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'PaperTheaterShortsFactory/2.0' },
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > 5000) {
            fs.writeFileSync(outputPath, buffer);
            console.log(
              `[ImageProvider] ✅ Scene ${params.sceneIndex} artwork successfully generated with ${model} (${(buffer.length / 1024).toFixed(1)} KB)`
            );
            // Ensure proper 1080x1920 scaling
            await this.ensureStandardResolution(outputPath);
            return outputPath;
          }
        } else {
          console.warn(`[ImageProvider] Model ${model} returned HTTP ${response.status}`);
        }
      } catch (err: any) {
        console.warn(`[ImageProvider] Attempt with model ${model} failed (${err.message}). Trying next...`);
      }
    }

    // 2. High-aesthetic Procedural Papercraft Fallback (in case of total network blackout)
    console.warn(`[ImageProvider] AI generation endpoints unreachable. Generating procedural papercraft layered backdrop...`);
    return await this.generateProceduralPapercraftFallback(params, outputPath);
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
  private async generateProceduralPapercraftFallback(params: SceneImageParams, outputPath: string): Promise<string> {
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
