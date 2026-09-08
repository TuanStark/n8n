import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface SubtitleEvent {
  startSec: number;
  endSec: number;
  text: string;
}

export class AssSubtitleBuilder {
  private formatTimestamp(sec: number): string {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = Math.floor(sec % 60);
    const centis = Math.floor((sec % 1) * 100);

    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
  }

  generateAssFile(events: SubtitleEvent[], filename: string): string {
    const subtitleDir = config.storage.subtitles;
    if (!fs.existsSync(subtitleDir)) {
      fs.mkdirSync(subtitleDir, { recursive: true });
    }

    const filePath = path.join(subtitleDir, `${filename}.ass`);

    // Premium subtitle styles with modern typography:
    // - Smaller font (52px) positioned in lower third
    // - Soft shadow (no hard outline) for readability
    // - Mixed case for natural reading
    // - Semi-transparent dark background pill
    const header = `[Script Info]
Title: Paper Theater World Shorts Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,52,&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,1.5,0,3,2,0,2,80,80,320,1
Style: Highlight,Arial,56,&H0000D4FF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,1.5,0,3,2,0,2,80,80,320,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const fadeInMs = 150;
    const fadeOutMs = 100;

    const dialogues = events
      .map((e) => {
        const start = this.formatTimestamp(e.startSec);
        const end = this.formatTimestamp(e.endSec);
        // Keep natural mixed case (no more ALL CAPS), add fade-in/out animation
        const cleanText = e.text.replace(/\r?\n/g, ' ').trim();
        return `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\fad(${fadeInMs},${fadeOutMs})\\b1}${cleanText}`;
      })
      .join('\n');

    fs.writeFileSync(filePath, header + dialogues, 'utf-8');
    return filePath;
  }
}
