import { GenreProfile } from '../domain/GenreProfile';

export interface ScriptScene {
  sceneIndex: number;
  durationSec: number;
  narrationText: string;
  visualDescription: string;
  location?: string;
  cameraMovement?: string;
  soundEffects?: string[];
  positivePrompt?: string;
  negativePrompt?: string;
}

export interface DirectorialScript {
  title: string;
  hookHeadline: string;
  targetDurationSec: number;
  fullScript: string;
  scenes: ScriptScene[];
  narrationSegments: { text: string; estimatedSec: number }[];
}

export interface IScriptDirector {
  generateScriptForChannel(
    topic: string,
    genre: GenreProfile,
    customInstructions?: string
  ): Promise<DirectorialScript>;
}
