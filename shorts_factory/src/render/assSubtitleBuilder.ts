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

  /**
   * Chunks a segment text into natural spoken phrases (3-5 words) with proportional timing
   */
  private chunkSegment(event: SubtitleEvent): { startSec: number; endSec: number; text: string }[] {
    const words = event.text.replace(/\r?\n/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length <= 5) {
      return [event];
    }

    const phrases: string[] = [];
    const maxWordsPerPhrase = 4;
    for (let i = 0; i < words.length; i += maxWordsPerPhrase) {
      phrases.push(words.slice(i, i + maxWordsPerPhrase).join(' '));
    }

    const totalChars = phrases.reduce((sum, p) => sum + p.length, 0);
    const duration = Math.max(0.5, event.endSec - event.startSec);
    let curStart = event.startSec;

    return phrases.map((phrase, idx) => {
      const isLast = idx === phrases.length - 1;
      const phraseDur = isLast ? (event.endSec - curStart) : (duration * (phrase.length / totalChars));
      const chunkStart = curStart;
      const chunkEnd = isLast ? event.endSec : curStart + phraseDur;
      curStart = chunkEnd;
      return {
        startSec: parseFloat(chunkStart.toFixed(2)),
        endSec: parseFloat(chunkEnd.toFixed(2)),
        text: phrase,
      };
    });
  }

  generateAssFile(events: SubtitleEvent[], filename: string, hookHeadline?: string): string {
    const subtitleDir = config.storage.subtitles;
    if (!fs.existsSync(subtitleDir)) {
      fs.mkdirSync(subtitleDir, { recursive: true });
    }

    const filePath = path.join(subtitleDir, `${filename}.ass`);

    // High-Retention ASS Subtitle Styles:
    // 1. HookBanner: Displayed dead-center (Alignment 5) in 0-3s in glowing gold/amber cardstock 3D font
    // 2. Default: Kinetic modern captions (Alignment 2) in lower-third with clean thick outline for 100% legibility on mobile
    const header = `[Script Info]
Title: Paper Theater World Shorts Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: HookBanner,DejaVu Sans,72,&H002BD4FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,105,105,2,0,1,5,4,5,60,60,960,1
Style: Default,DejaVu Sans,58,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,1.2,0,1,4,3,2,60,60,340,1
Style: Highlight,DejaVu Sans,62,&H002BD4FF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,1.2,0,1,4,3,2,60,60,340,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const dialogueLines: string[] = [];

    // 1. Display Giant Hook Headline in dead center during first 2.8 seconds
    if (hookHeadline && hookHeadline.trim().length > 0) {
      const bannerText = hookHeadline.toUpperCase().trim();
      dialogueLines.push(
        `Dialogue: 1,0:00:00.00,0:00:02.80,HookBanner,,0,0,0,,{\\fad(80,150)\\b1}${bannerText}`
      );
    }

    // 2. Chunk narration segments into rapid, digestible 3-5 word kinetic captions
    for (const ev of events) {
      const chunks = this.chunkSegment(ev);
      for (const chunk of chunks) {
        const start = this.formatTimestamp(chunk.startSec);
        const end = this.formatTimestamp(chunk.endSec);
        const cleanText = chunk.text.trim();
        dialogueLines.push(
          `Dialogue: 0,${start},${end},Default,,0,0,0,,{\\fad(60,60)\\b1}${cleanText}`
        );
      }
    }

    fs.writeFileSync(filePath, header + dialogueLines.join('\n'), 'utf-8');
    console.log(`[AssSubtitleBuilder] ✅ Generated ASS subtitle file with Hook Banner: ${filePath}`);
    return filePath;
  }
}
