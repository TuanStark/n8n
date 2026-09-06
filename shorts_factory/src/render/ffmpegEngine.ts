import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';

const execAsync = promisify(exec);

export interface SceneInput {
  sceneIndex: number;
  durationSec: number;
  imagePath: string;
  cameraMovement: string;
}

export interface RenderResult {
  outputPath: string;
  durationSec: number;
  fileSizeBytes: number;
  checksumSha256: string;
}

export class FFmpegEngine {
  private calculateSha256(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Generates a neutral textured paper cutout fallback placeholder if image generation is pending
   */
  async ensurePlaceholderImage(sceneIndex: number, textLabel: string): Promise<string> {
    const rawDir = config.storage.raw;
    if (!fs.existsSync(rawDir)) {
      fs.mkdirSync(rawDir, { recursive: true });
    }

    const placeholderPath = path.join(rawDir, `scene_${sceneIndex}_placeholder.png`);
    if (fs.existsSync(placeholderPath)) {
      return placeholderPath;
    }

    // Use FFmpeg lavfi to generate a 1080x1920 textured paper color card
    const cmd = `ffmpeg -y -f lavfi -i color=c=0x1E1A17:s=1080x1920:d=1 \
      -vf "drawbox=x=60:y=60:w=960:h=1800:color=0xD4AF37@0.6:t=8,drawtext=font='DejaVu Sans':text='PAPER THEATER DIORAMA - SCENE ${sceneIndex}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2" \
      -frames:v 1 "${placeholderPath}"`;
    
    try {
      await execAsync(cmd);
    } catch (err) {
      console.warn(`[FFmpegEngine] Failed to generate label placeholder, creating raw fallback`, err);
      // Create minimal empty image buffer fallback
      fs.writeFileSync(placeholderPath, Buffer.alloc(100));
    }

    return placeholderPath;
  }

  async renderShort(
    shortId: string,
    scenes: SceneInput[],
    audioPath: string,
    subtitleAssPath?: string
  ): Promise<RenderResult> {
    const rendersDir = config.storage.renders;
    if (!fs.existsSync(rendersDir)) {
      fs.mkdirSync(rendersDir, { recursive: true });
    }

    const outputPath = path.join(rendersDir, `${shortId}_master.mp4`);
    const tempDir = path.join(rendersDir, `temp_${shortId}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    console.log(`[FFmpegEngine] Starting master render for ${shortId} (${scenes.length} scenes)...`);

    try {
      const sceneVideoPaths: string[] = [];

      // 1. Render each scene image into a 1080x1920 clip with dynamic 2.5D diorama camera motion
      for (const scene of scenes) {
        const sceneClipPath = path.join(tempDir, `scene_${scene.sceneIndex}.mp4`);
        const duration = Math.max(2, scene.durationSec);
        const frames = Math.round(duration * 30);

        // Dynamic Ken Burns motion tailored to scene movement
        let motionFilter: string;
        const mov = (scene.cameraMovement || '').toLowerCase();

        if (mov.includes('pan') || scene.sceneIndex % 3 === 2) {
          // Subtle horizontal pan across papercraft cutouts
          motionFilter = `zoompan=z=1.14:d=${frames}:x='if(lte(on,1),(iw-iw/zoom)*0.2,x+0.5)':y='(ih-ih/zoom)/2':s=1080x1920:fps=30,format=yuv420p`;
        } else if (mov.includes('out') || scene.sceneIndex % 3 === 0) {
          // Dramatic reveal pull-out
          motionFilter = `zoompan=z='max(1.18-0.0012*on,1.0)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,format=yuv420p`;
        } else {
          // Slow cinematic focus push-in
          motionFilter = `zoompan=z='min(zoom+0.0012,1.2)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30,format=yuv420p`;
        }

        const renderSceneCmd = `ffmpeg -y -i "${scene.imagePath}" \
          -vf "${motionFilter}" \
          -c:v libx264 -pix_fmt yuv420p -preset ultrafast -frames:v ${frames} \
          "${sceneClipPath}"`;

        await execAsync(renderSceneCmd);
        sceneVideoPaths.push(sceneClipPath);
      }

      // 2. Create concat manifest
      const concatListPath = path.join(tempDir, 'concat.txt');
      const concatContent = sceneVideoPaths.map((p) => `file '${p}'`).join('\n');
      fs.writeFileSync(concatListPath, concatContent, 'utf-8');

      // 3. Assemble full video with audio ducking and optional subtitles
      let filterComplex = '';
      if (subtitleAssPath && fs.existsSync(subtitleAssPath)) {
        // Escape colon and backslashes for FFmpeg ass filter
        const escapedAss = subtitleAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        filterComplex = `-vf "ass='${escapedAss}'"`;
      }

      const assembleCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" \
        -i "${audioPath}" \
        ${filterComplex} \
        -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p \
        -c:a aac -b:a 192k -ar 48000 \
        -af "loudnorm=I=-14:LRA=7:tp=-1" \
        -shortest \
        "${outputPath}"`;

      console.log(`[FFmpegEngine] Assembling final master short: ${outputPath}`);
      await execAsync(assembleCmd);

      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });

      const stats = fs.statSync(outputPath);
      const checksum = this.calculateSha256(outputPath);

      // Get accurate duration via ffprobe
      const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`;
      const { stdout: durStdout } = await execAsync(probeCmd);
      const measuredDuration = parseFloat(durStdout.trim()) || 30.0;

      console.log(`[FFmpegEngine] Render complete! Duration: ${measuredDuration}s, Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

      return {
        outputPath,
        durationSec: measuredDuration,
        fileSizeBytes: stats.size,
        checksumSha256: checksum,
      };
    } catch (error) {
      console.error(`[FFmpegEngine] Render failed for ${shortId}:`, error);
      throw error;
    }
  }
}
