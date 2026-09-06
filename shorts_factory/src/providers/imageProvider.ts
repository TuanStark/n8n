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

export class ImageProvider {
  private rawStorageDir: string;

  constructor() {
    this.rawStorageDir = config.storage.raw;
    if (!fs.existsSync(this.rawStorageDir)) {
      fs.mkdirSync(this.rawStorageDir, { recursive: true });
    }
  }

  /**
   * Generates a 9:16 vertical visual artwork for a scene (AI Papercraft or Classical Historical Art)
   */
  async generateSceneImage(params: SceneImageParams): Promise<string> {
    const filename = `scene_${params.storyboardId}_${params.sceneIndex}.jpg`;
    const outputPath = path.join(this.rawStorageDir, filename);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
      console.log(`[ImageProvider] Scene ${params.sceneIndex} artwork already exists at ${outputPath}`);
      return outputPath;
    }

    // Compose rich prompt for AI generation
    const styleAnchors = [
      'handcrafted miniature paper theater diorama',
      'layered cut paper sculpture',
      'dramatic chiaroscuro lighting',
      'miniature stage set',
      'macro photography',
      '9:16 vertical ratio',
    ].join(', ');

    const subject = (params.positivePrompt || params.visualDescription || `${params.category} historical scene`).replace(/["\n\r]/g, ' ').slice(0, 140);
    const fullPrompt = `${subject}, ${styleAnchors}`;

    console.log(`[ImageProvider] 🎨 Requesting AI artwork for Scene ${params.sceneIndex}: "${subject.slice(0, 60)}..."`);

    // 1. Try Pollinations AI with short timeout (8s)
    try {
      const seed = Math.floor(Math.random() * 999999);
      const encodedPrompt = encodeURIComponent(fullPrompt);
      const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=720&height=1280&model=flux&nologo=true&seed=${seed}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'PaperTheaterShortsFactory/1.0' },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 5000) {
          fs.writeFileSync(outputPath, buffer);
          console.log(`[ImageProvider] ✅ Scene ${params.sceneIndex} AI artwork generated (${(buffer.length / 1024).toFixed(1)} KB)`);
          return outputPath;
        }
      }
    } catch (err: any) {
      console.log(`[ImageProvider] AI generation unavailable (${err.message}). Fetching authentic museum art...`);
    }

    // 2. Fetch authentic classical historical museum artwork from Wikimedia Commons
    console.log(`[ImageProvider] 🏛️ Fetching authentic classical museum artwork for Scene ${params.sceneIndex}...`);
    const categoryName = params.category.replace('_', ' ');
    const charName = params.characters?.[0];

    let wikiUrl: string | null = null;
    if (charName) {
      wikiUrl = await this.searchWikimediaArtwork(`${charName} ${categoryName}`, params.sceneIndex);
    }
    if (!wikiUrl) {
      wikiUrl = await this.searchWikimediaArtwork(`${categoryName} painting`, params.sceneIndex);
    }
    if (!wikiUrl) {
      wikiUrl = await this.searchWikimediaArtwork(`${categoryName} history`, params.sceneIndex);
    }

    if (wikiUrl) {
      try {
        console.log(`[ImageProvider] Downloading museum artwork for Scene ${params.sceneIndex}: ${wikiUrl}`);
        const imgRes = await fetch(wikiUrl, {
          headers: { 'User-Agent': 'PaperTheaterWorldBot/1.0 (educational-shorts-bot)' },
        });
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          if (buffer.length > 5000) {
            fs.writeFileSync(outputPath, buffer);
            console.log(`[ImageProvider] ✅ Scene ${params.sceneIndex} historical artwork downloaded (${(buffer.length / 1024).toFixed(1)} KB)`);
            return outputPath;
          }
        }
      } catch (err: any) {
        console.warn(`[ImageProvider] Wikimedia download error:`, err.message);
      }
    }

    // 3. Last Fallback: Generate decorative paper diorama card
    console.warn(`[ImageProvider] Generating decorative diorama fallback for Scene ${params.sceneIndex}`);
    return await this.generateDecorativeFallback(params, outputPath);
  }

  private async searchWikimediaArtwork(query: string, sceneIndex: number = 1): Promise<string | null> {
    try {
      const cleanQuery = query.replace(/["'\n\r]/g, ' ').trim();
      const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(cleanQuery)}&gsrlimit=15&prop=imageinfo&iiprop=url&iiurlwidth=1080&format=json`;

      const res = await fetch(url, {
        headers: { 'User-Agent': 'PaperTheaterWorldBot/1.0 (educational-shorts-bot)' },
      });
      if (!res.ok) return null;

      const data = await res.json();
      if (!data.query?.pages) return null;

      const validUrls: string[] = [];
      for (const pageId of Object.keys(data.query.pages)) {
        const info = data.query.pages[pageId].imageinfo?.[0];
        const imgUrl = info?.thumburl || info?.url || '';
        const cleanPath = imgUrl.split('?')[0].toLowerCase();
        if (
          (cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg') || cleanPath.endsWith('.png')) &&
          !cleanPath.includes('icon') &&
          !cleanPath.includes('flag') &&
          !cleanPath.includes('map') &&
          !cleanPath.includes('logo') &&
          !cleanPath.includes('coat_of_arms')
        ) {
          validUrls.push(imgUrl);
        }
      }

      if (validUrls.length === 0) return null;
      // Distribute across scenes
      const selectedIndex = (sceneIndex - 1) % validUrls.length;
      return validUrls[selectedIndex];
    } catch (e) {
      return null;
    }
  }

  private async generateDecorativeFallback(params: SceneImageParams, outputPath: string): Promise<string> {
    const categoryLabel = params.category.toUpperCase().replace('_', ' ');
    const sceneText = `SCENE ${params.sceneIndex}`;

    const cmd = `ffmpeg -y -f lavfi -i color=c=0x1E1712:s=1080x1920:d=1 \
      -vf "drawbox=x=40:y=40:w=1000:h=1840:color=0xD4AF37@0.8:t=8,drawbox=x=60:y=60:w=960:h=1800:color=0xD4AF37@0.4:t=3,drawtext=font='DejaVu Sans':text='PAPER THEATER WORLD':fontcolor=0xD4AF37:fontsize=52:x=(w-text_w)/2:y=700,drawtext=font='DejaVu Sans':text='${categoryLabel} • ${sceneText}':fontcolor=0xE5D0AC:fontsize=40:x=(w-text_w)/2:y=820" \
      -frames:v 1 "${outputPath}"`;

    try {
      await execAsync(cmd);
      console.log(`[ImageProvider] Generated decorative diorama card at ${outputPath}`);
    } catch (err) {
      const dummyJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
      fs.writeFileSync(outputPath, dummyJpeg);
    }

    return outputPath;
  }
}
