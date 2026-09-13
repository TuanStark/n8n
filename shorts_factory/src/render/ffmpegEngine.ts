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
   * Generates procedural cinematic soundscape (0:00 Sub-Bass Boom, Whoosh Impact, Tension Riser, and tactile Paper ASMR)
   */
  async generateCinematicSoundscape(durationSec: number, outputPath: string): Promise<string> {
    const dur = Math.max(5, Math.ceil(durationSec));

    // Synthesize rich multi-layered cinematic audio bed:
    // 0. Sub-Bass Impact Boom (exponential pitch-decaying 65Hz sine wave at 0:00)
    // 1. Whoosh Sweep (bandpassed pink noise burst at 0:00)
    // 2. Suspense Heartbeat / Tension Riser (120 BPM pulse between 2s and 18s)
    // 3. Pink noise bandpassed (sliding paper friction & surface texture)
    // 4. Brown noise lowpassed (dense cardboard knock & resonance)
    // 5. White noise highpassed (crisp laser-cut cardstock grain)
    const cmd = `ffmpeg -y \
      -f lavfi -i "aevalsrc='sin(2*PI*65*exp(-1.8*t)*t)*exp(-2.0*t)':s=48000:d=3" \
      -f lavfi -i "anoisesrc=c=pink:r=48000:a=0.15" \
      -f lavfi -i "aevalsrc='sin(2*PI*120*t)*exp(-30*mod(t,0.5))*gte(t,2)*lte(t,18)':s=48000:d=${dur}" \
      -f lavfi -i "anoisesrc=c=pink:r=48000:a=0.07" \
      -f lavfi -i "anoisesrc=c=brown:r=48000:a=0.05" \
      -f lavfi -i "anoisesrc=c=white:r=48000:a=0.015" \
      -filter_complex "[0:a]volume=1.8[boom];[1:a]bandpass=f=1200:w=800,afade=t=in:st=0:d=0.05,afade=t=out:st=0.2:d=0.8,volume=1.3[whoosh];[2:a]lowpass=f=250,volume=0.32[heartbeat];[3:a]bandpass=f=2400:w=1500,volume=0.85[paper];[4:a]lowpass=f=450,volume=0.55[thud];[5:a]highpass=f=3500,volume=0.45[grain];[boom][whoosh][heartbeat][paper][thud][grain]amix=inputs=6[cinematic_bed]" \
      -map "[cinematic_bed]" \
      -t ${dur} \
      -c:a libmp3lame \
      "${outputPath}"`;

    try {
      await execAsync(cmd);
      console.log(`[FFmpegEngine] ✅ Generated multi-layer cinematic soundscape (${dur}s): ${outputPath}`);
    } catch (err) {
      console.warn(`[FFmpegEngine] Failed to synthesize cinematic soundscape, creating silent track fallback`, err);
      const silentCmd = `ffmpeg -y -f lavfi -i "anullsrc=r=48000:cl=mono" -t ${dur} -c:a libmp3lame "${outputPath}"`;
      await execAsync(silentCmd).catch(() => {});
    }

    return outputPath;
  }

  /**
   * Renders YouTube Shorts adhering to Master Stop-Motion rules (stepped 12fps cadence on twos, micro-jitter, paper transitions, paper ASMR)
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

    console.log(`[FFmpegEngine] 🎬 Starting Master Tactile Paper Stop-Motion Render for ${shortId} (${scenes.length} scenes)...`);

    try {
      // 24 FPS timeline with stepped evaluation on "twos" (12fps discrete steps) for genuine stop-motion texture
      const fps = 24;
      const transitionDuration = 0.35; // 0.35s crisp cardstock slide / razor-cut wipe
      const cinematicAudioPath = path.join(rendersDir, `cinematic_soundscape_${shortId}.mp3`);
      
      // Ensure multi-layer cinematic soundscape bed is ready
      const totalEstimatedSec = scenes.reduce((acc, s) => acc + s.durationSec, 0) + 2;
      console.log(`[FFmpegEngine] 🎧 Generating multi-layer Cinematic Soundscape bed (${totalEstimatedSec}s)...`);
      await this.generateCinematicSoundscape(Math.max(34, totalEstimatedSec), cinematicAudioPath);

      // Build FFmpeg inputs and filter complex
      const inputArgs: string[] = ['-y'];
      const filterLines: string[] = [];
      let currentOffset = 0;

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const isLast = i === scenes.length - 1;
        const sceneDuration = isLast ? scene.durationSec : scene.durationSec + transitionDuration;
        const totalFrames = Math.max(1, Math.round(sceneDuration * fps));
        const halfFrames = Math.max(1, Math.round(totalFrames / 2));

        inputArgs.push('-loop', '1', '-t', sceneDuration.toFixed(2), '-i', scene.imagePath);

        // Tactile Stop-Motion Movements:
        // - Discrete stepped zoom/pan calculated on twos (floor(n/2))
        // - Micro-jitter displacement to simulate authentic physical cardstock vibration
        let motionFilter: string;
        const scaleUpW = 1200;
        const scaleUpH = 2133;
        const motionType = i % 5;
        const preCrop = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;

        if (motionType === 0) {
          // 1. Stepped Hero Push-In: Dramatic zoom into the 70% Hero Sculpture
          motionFilter = `${preCrop},scale='1080*(1+0.07*floor(n/2)/${halfFrames})':'-1':eval=frame,crop=1080:1920:x='(in_w-out_w)/2 + (mod(floor(n/2)*7, 5) - 2)*0.9':y='(in_h-out_h)/2 + (mod(floor(n/2)*11, 5) - 2)*0.9'`;
        } else if (motionType === 1) {
          // 2. Stepped Horizontal Track: Reveal stacked paper cardstock layers left-to-right
          motionFilter = `scale=${scaleUpW}:${scaleUpH}:force_original_aspect_ratio=increase,crop=${scaleUpW}:${scaleUpH},crop=1080:1920:x='(in_w-out_w)*(floor(n/2)/${halfFrames}) + (mod(floor(n/2)*5, 5) - 2)*0.8':y='(in_h-out_h)/2 + (mod(floor(n/2)*7, 5) - 2)*0.8'`;
        } else if (motionType === 2) {
          // 3. Stepped Vertical Scan: Ascend through contour slices from bottom to top
          motionFilter = `scale=${scaleUpW}:${scaleUpH}:force_original_aspect_ratio=increase,crop=${scaleUpW}:${scaleUpH},crop=1080:1920:x='(in_w-out_w)/2 + (mod(floor(n/2)*11, 5) - 2)*0.8':y='(in_h-out_h)*(1 - floor(n/2)/${halfFrames}) + (mod(floor(n/2)*13, 5) - 2)*0.8'`;
        } else if (motionType === 3) {
          // 4. Stepped Pull-Back: Reveal the monumental complete paper relief
          motionFilter = `${preCrop},scale='1080*(1.07-0.07*floor(n/2)/${halfFrames})':'-1':eval=frame,crop=1080:1920:x='(in_w-out_w)/2 + (mod(floor(n/2)*9, 5) - 2)*0.9':y='(in_h-out_h)/2 + (mod(floor(n/2)*13, 5) - 2)*0.9'`;
        } else {
          // 5. Hero Relief Focus: Locked camera with subtle organic stop-motion paper breathing
          motionFilter = `scale=1110:1973:force_original_aspect_ratio=increase,crop=1110:1973,crop=1080:1920:x='(in_w-out_w)/2 + (mod(floor(n/2)*7, 7) - 3)*1.0':y='(in_h-out_h)/2 + (mod(floor(n/2)*11, 7) - 3)*1.0'`;
        }

        filterLines.push(`[${i}:v]${motionFilter},fps=${fps},setsar=1[v${i}]`);
      }

      // Chain tactile cardstock transitions between consecutive scenes:
      // Real paper slide-ins, razor-cut wipes, and cardboard crop reveals (NO mushy dissolved crossfades)
      const transitions = ['slideleft', 'slideright', 'wipeleft', 'wiperight', 'slideup', 'rectcrop'];
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

      // Authentic tactile papercraft color grading:
      // Enhanced cardstock depth, warm museum directional lighting, cast shadow richness, subtle vignette
      let finalVideoNode = lastStream;
      const colorGrading = [
        'eq=contrast=1.12:brightness=0.01:saturation=1.10',
        'colorbalance=rs=0.03:gs=0.01:bs=-0.02:rh=0.02:gh=0.0:bh=-0.01',
        'vignette=PI/3.8',
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

      // Audio inputs: Narration (index = scenes.length), Cinematic Soundscape (index = scenes.length + 1)
      const voiceIdx = scenes.length;
      const sfxIdx = scenes.length + 1;
      inputArgs.push('-i', audioPath);
      inputArgs.push('-i', cinematicAudioPath);

      filterLines.push(`[${voiceIdx}:a]volume=1.05[voice]`);
      filterLines.push(`[${sfxIdx}:a]volume=0.38[sfx_bed]`);
      filterLines.push(
        `[voice][sfx_bed]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-14:LRA=7:tp=-1[aout]`
      );

      const assembleCmd = `ffmpeg ${inputArgs.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')} \
        -filter_complex "${filterLines.join(';')}" \
        -map "[${finalVideoNode}]" -map "[aout]" \
        -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p \
        -c:a aac -b:a 192k -ar 48000 \
        "${outputPath}"`;

      console.log(`[FFmpegEngine] Assembling final tactile paper stop-motion master short: ${outputPath}`);
      await execAsync(assembleCmd);
      console.log(`[FFmpegEngine] ✅ Tactile Paper Stop-Motion Render complete! Duration: ${scenes.reduce((a, b) => a + b.durationSec, 0)}s`);

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
