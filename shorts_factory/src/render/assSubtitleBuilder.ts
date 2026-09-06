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

    const header = `[Script Info]
Title: Paper Theater World Shorts Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: DioramaTitle,DejaVu Sans,68,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,2,0,1,5,4,2,60,60,420,1
Style: DioramaHighlight,DejaVu Sans,72,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,105,105,2,0,1,6,5,2,60,60,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const dialogues = events.map((e) => {
      const start = this.formatTimestamp(e.startSec);
      const end = this.formatTimestamp(e.endSec);
      const cleanText = e.text.replace(/\r?\n/g, ' ').toUpperCase();
      return `Dialogue: 0,${start},${end},DioramaTitle,,0,0,0,,{\\b1\\an2}${cleanText}`;
    }).join('\n');

    fs.writeFileSync(filePath, header + dialogues, 'utf-8');
    return filePath;
  }
}
