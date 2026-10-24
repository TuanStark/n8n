export interface SubtitlePreset {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  shadow?: number;
  alignment?: number; // ASS alignment code (e.g. 2 for bottom-center)
  marginV?: number;
}

export interface GenreProfile {
  id: string; // e.g. 'paper_history', 'cyberpunk_tech', 'dark_stoic'
  name: string;
  description?: string;
  systemPromptScriptwriter: string;
  hookFramework?: Record<string, any>;
  visualStylePrompt: string;
  visualNegativePrompt: string;
  colorPalettePreset?: string[];
  imageEngine: string;
  ttsProvider: 'msedge' | 'elevenlabs' | string;
  ttsVoiceId: string;
  soundscapePreset: string;
  subtitleStyle?: SubtitlePreset;
  motionEnginePreset: string;
  isActive: boolean;
}
