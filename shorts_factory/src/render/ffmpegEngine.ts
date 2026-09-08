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
  cameraMovement?: string;
  videoPrompt?: string;
  paperAsmrCues?: string[];
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
   * Generates a neutral textured paper cutout fallback placeholder
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

    const cmd = `ffmpeg -y -f lavfi -i color=c=0xD5C4A1:s=1080x1920:d=1 \
      -vf "drawbox=x=80:y=120:w=920:h=1680:color=0x282828@0.7:t=fill,drawbox=x=110:y=150:w=860:h=1620:color=0xFBF1C7@0.9:t=fill,drawtext=font='DejaVu Sans':text='PAPER THEATER - SCENE ${sceneIndex}':fontcolor=0x282828:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2" \
      -frames:v 1 "${placeholderPath}"`;

    try {
      await execAsync(cmd);
    } catch (err) {
      console.warn(`[FFmpegEngine] Failed to generate label placeholder, creating raw fallback`, err);
      fs.writeFileSync(placeholderPath, Buffer.alloc(100));
    }

    return placeholderPath;
  }

  /**
   * Generates procedural tactile Paper ASMR soundscape (paper sliding, friction, soft knocks)
   */
  async generatePaperAsmrSoundscape(durationSec: number, outputPath: string): Promise<string> {
    const dur = Math.max(5, Math.ceil(durationSec));

    // Synthesize layered paper friction (pink noise filtered) + cardboard resonance (brown noise)
    const cmd = `ffmpeg -y \
      -f lavfi -i "anoisesrc=c=pink:r=48000:a=0.08" \
      -f lavfi -i "anoisesrc=c=brown:r=48000:a=0.04" \
      -filter_complex "[0:a]bandpass=f=2200:width_type=h:w=1400,volume=1.2[paper];[1:a]lowpass=f=550,volume=0.6[thud];[paper][thud]amix=inputs=2[asmr]" \
      -map "[asmr]" \
      -t ${dur} \
      "${outputPath}"`;

    try {
      await execAsync(cmd);
    } catch (err) {
      console.warn(`[FFmpegEngine] Failed to synthesize ASMR soundscape, creating silent track fallback`, err);
      // Fallback silence
      const silentCmd = `ffmpeg -y -f lavfi -i "anullsrc=r=48000:cl=mono" -t ${dur} "${outputPath}"`;
      await execAsync(silentCmd).catch(() => {});
    }

    return outputPath;
  }

  /**
   * Renders YouTube Shorts adhering to Master Stop-Motion rules (12fps, locked camera, vignette, paper ASMR)
   */
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

    console.log(`[FFmpegEngine] 🎬 Starting 60FPS Silky Smooth Cinematic Render for ${shortId} (${scenes.length} scenes)...`);

    try {
      const fps = 60; // 60 FPS for silky-smooth motion and fluid transitions
      const transitionDuration = 0.6; // 0.6s smooth crossfade/slide
      const asmrAudioPath = path.join(rendersDir, `paper_asmr_34s.mp3`);
      
      // Ensure tactile ASMR soundscape bed is ready
      const totalEstimatedSec = scenes.reduce((acc, s) => acc + s.durationSec, 0) + 2;
      if (!fs.existsSync(asmrAudioPath) || fs.statSync(asmrAudioPath).size < 1000) {
        console.log(`[FFmpegEngine] 🎧 Generating tactile Paper ASMR soundscape track (${totalEstimatedSec}s)...`);
        await this.generatePaperAsmrSoundscape(Math.max(34, totalEstimatedSec), asmrAudioPath);
      }

      // Build FFmpeg inputs and filter complex
      const inputArgs: string[] = ['-y'];
      const filterLines: string[] = [];
      let currentOffset = 0;

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const isLast = i === scenes.length - 1;
        const sceneDuration = isLast ? scene.durationSec : scene.durationSec + transitionDuration;
        const totalFrames = Math.round(sceneDuration * fps);

        inputArgs.push('-loop', '1', '-t', sceneDuration.toFixed(2), '-i', scene.imagePath);

        // Diverse cinematic camera motions — each scene feels different
        let motionFilter: string;
        const scaleUp = 1350; // ~25% overscan for more dramatic movement
        const scaleH = Math.round(scaleUp * (1920 / 1080));
        if (i % 5 === 0) {
          // Slow dramatic ZOOM INTO character face (center-weighted)
          motionFilter = `scale='1080*(1+0.12*n/${totalFrames})':'-1':eval=frame,crop=1080:1920`;
        } else if (i % 5 === 1) {
          // Smooth HORIZONTAL PAN left-to-right
          motionFilter = `scale=${scaleUp}:${scaleH},crop=1080:1920:x='(in_w-out_w)*(n/${totalFrames})':y='(in_h-out_h)/2'`;
        } else if (i % 5 === 2) {
          // VERTICAL TILT UP (reveal from bottom to top)
          motionFilter = `scale=${scaleUp}:${scaleH},crop=1080:1920:x='(in_w-out_w)/2':y='(in_h-out_h)*(1-n/${totalFrames})'`;
        } else if (i % 5 === 3) {
          // DIAGONAL DRIFT (top-left to bottom-right) — cinematic slide
          motionFilter = `scale=${scaleUp}:${scaleH},crop=1080:1920:x='(in_w-out_w)*(n/${totalFrames})':y='(in_h-out_h)*(n/${totalFrames})'`;
        } else {
          // PULL-BACK zoom out (dramatic reveal)
          motionFilter = `scale='1080*(1.12-0.12*n/${totalFrames})':'-1':eval=frame,crop=1080:1920`;
        }

        filterLines.push(`[${i}:v]${motionFilter},fps=${fps},setsar=1[v${i}]`);
      }

      // Chain xfade transitions between consecutive scenes
      const transitions = ['fade', 'smoothleft', 'fade', 'fade', 'smoothup'];
      let lastStream = 'v0';

      for (let i = 0; i < scenes.length - 1; i++) {
        currentOffset += scenes[i].durationSec;
        const nextStream = `v${i + 1}`;
        const outStream = `x${i + 1}`;
        const trans = transitions[i % transitions.length];
        filterLines.push(
          `[${lastStream}][${nextStream}]xfade=transition=${trans}:duration=${transitionDuration}:offset=${currentOffset.toFixed(2)}[${outStream}]`
        );
        lastStream = outStream;
      }

      // Add cinematic color grading, soft vignette, letterbox, and subtitles
      let finalVideoNode = lastStream;
      const colorGrading = [
        'eq=contrast=1.08:brightness=0.02:saturation=1.15',  // Slight contrast + saturation boost
        'colorbalance=rs=0.04:gs=0.01:bs=-0.03:rh=0.02:gh=0.0:bh=-0.02',  // Warm tone shift
        'vignette=PI/3.5',  // Subtle vignette (softer than before)
      ].join(',');

      if (subtitleAssPath && fs.existsSync(subtitleAssPath)) {
        const escapedAss = subtitleAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        filterLines.push(
          `[${lastStream}]${colorGrading},drawbox=y=0:w=iw:h=40:color=black@0.85:t=fill,drawbox=y=ih-40:w=iw:h=40:color=black@0.85:t=fill,ass='${escapedAss}'[vout]`
        );
        finalVideoNode = 'vout';
      } else {
        filterLines.push(
          `[${lastStream}]${colorGrading},drawbox=y=0:w=iw:h=40:color=black@0.85:t=fill,drawbox=y=ih-40:w=iw:h=40:color=black@0.85:t=fill[vout]`
        );
        finalVideoNode = 'vout';
      }

      // Audio inputs: Narration (index = scenes.length), ASMR (index = scenes.length + 1)
      const voiceIdx = scenes.length;
      const asmrIdx = scenes.length + 1;
      inputArgs.push('-i', audioPath);
      inputArgs.push('-i', asmrAudioPath);

      filterLines.push(`[${voiceIdx}:a]volume=1.0[voice]`);
      filterLines.push(`[${asmrIdx}:a]volume=0.16[asmr_a]`);
      filterLines.push(
        `[voice][asmr_a]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-14:LRA=7:tp=-1[aout]`
      );

      const assembleCmd = `ffmpeg ${inputArgs.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')} \
        -filter_complex "${filterLines.join(';')}" \
        -map "[${finalVideoNode}]" -map "[aout]" \
        -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p \
        -c:a aac -b:a 192k -ar 48000 \
        "${outputPath}"`;

      console.log(`[FFmpegEngine] Assembling final 60FPS smooth master short: ${outputPath}`);
      await execAsync(assembleCmd);
      console.log(`[FFmpegEngine] ✅ 60FPS Render complete! Duration: ${scenes.reduce((a, b) => a + b.durationSec, 0)}s`);

      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });

      const stats = fs.statSync(outputPath);
      const checksum = this.calculateSha256(outputPath);

      // Measure duration with ffprobe
      const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`;
      const { stdout: durStdout } = await execAsync(probeCmd);
      const measuredDuration = parseFloat(durStdout.trim()) || 30.0;

      console.log(
        `[FFmpegEngine] ✅ Render complete! Duration: ${measuredDuration}s, Size: ${(
          stats.size /
          1024 /
          1024
        ).toFixed(2)}MB`
      );

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
