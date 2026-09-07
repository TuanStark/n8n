import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface VideoClipParams {
  storyboardId: string;
  sceneIndex: number;
  imagePath: string;
  videoPrompt: string;
  durationSec: number;
  paperAsmrCues?: string[];
}

export interface VideoClipResult {
  clipPath: string;
  durationSec: number;
  provider: 'AI_VIDEO' | 'STOP_MOTION_PHYSICS';
}

export class VideoProvider {
  private rendersDir: string;

  constructor() {
    this.rendersDir = config.storage.renders;
    if (!fs.existsSync(this.rendersDir)) {
      fs.mkdirSync(this.rendersDir, { recursive: true });
    }
  }

  /**
   * Generates or prepares a video clip according to the Universal Video Prompt
   */
  async prepareSceneVideo(params: VideoClipParams): Promise<VideoClipResult> {
    const outputPath = path.join(
      this.rendersDir,
      `clip_${params.storyboardId}_scene_${params.sceneIndex}.mp4`
    );

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
      return {
        clipPath: outputPath,
        durationSec: params.durationSec,
        provider: 'AI_VIDEO',
      };
    }

    // When external AI Video APIs (Kling, Runway, Hailuo, Wan 2.1) are configured,
    // they can be seamlessly called here using params.imagePath & params.videoPrompt.
    // Otherwise, we return status to use our local Stop-Motion Physics & ASMR engine.
    return {
      clipPath: outputPath,
      durationSec: params.durationSec,
      provider: 'STOP_MOTION_PHYSICS',
    };
  }
}
