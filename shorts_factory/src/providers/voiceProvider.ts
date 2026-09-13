import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';

const execAsync = promisify(exec);

export interface VoiceGenerationResult {
  audioPath: string;
  durationSec: number;
  provider: string;
  fileSizeBytes: number;
}

export class VoiceProvider {
  private elevenApiKey: string;
  private voiceId: string;

  constructor() {
    this.elevenApiKey = config.elevenlabs.apiKey;
    this.voiceId = config.elevenlabs.voiceId;
  }

  private splitIntoChunks(text: string, maxLen = 100): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;

      if ((currentChunk + ' ' + trimmed).trim().length <= maxLen) {
        currentChunk = (currentChunk + ' ' + trimmed).trim();
      } else {
        if (currentChunk) chunks.push(currentChunk);
        // If single sentence exceeds maxLen, split on words
        if (trimmed.length > maxLen) {
          const words = trimmed.split(' ');
          let subChunk = '';
          for (const word of words) {
            if ((subChunk + ' ' + word).trim().length <= maxLen) {
              subChunk = (subChunk + ' ' + word).trim();
            } else {
              if (subChunk) chunks.push(subChunk);
              subChunk = word;
            }
          }
          if (subChunk) chunks.push(subChunk);
          currentChunk = '';
        } else {
          currentChunk = trimmed;
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  async generateVoice(text: string, outputFilename: string): Promise<VoiceGenerationResult> {
    const audioDir = config.storage.audio;
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const outputPath = path.join(audioDir, `${outputFilename}.mp3`);

    // 1. Primary: ElevenLabs if configured
    if (this.elevenApiKey && this.elevenApiKey.trim() !== '') {
      try {
        console.log(`[VoiceProvider] Synthesizing narration via ElevenLabs (${this.voiceId})...`);
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.elevenApiKey,
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.75,
              similarity_boost: 0.85,
              style: 0.35,
              use_speaker_boost: true,
            },
          }),
        });

        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(outputPath, buffer);
          const stats = fs.statSync(outputPath);
          
          const wordCount = text.split(/\s+/).length;
          const estimatedDuration = Math.max(3, (wordCount / 150) * 60);

          return {
            audioPath: outputPath,
            durationSec: parseFloat(estimatedDuration.toFixed(2)),
            provider: 'elevenlabs',
            fileSizeBytes: stats.size,
          };
        }
        console.warn(`[VoiceProvider] ElevenLabs returned ${res.status}, using Google TTS fallback.`);
      } catch (err) {
        console.warn('[VoiceProvider] ElevenLabs call failed, falling back to Google TTS:', err);
      }
    }

    // 2. High-Quality Neural TTS: Microsoft Edge TTS (en-US-ChristopherNeural)
    try {
      console.log(`[VoiceProvider] Synthesizing cinematic narration via Microsoft Edge TTS Neural (en-US-ChristopherNeural)...`);
      const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
      const tts = new MsEdgeTTS();
      await tts.setMetadata('en-US-ChristopherNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      
      const tempDir = path.join(audioDir, `edge_${Date.now()}_${Math.random().toString(36).substring(7)}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const edgeRes = await tts.toFile(tempDir, text, { rate: '+4%' });
      const generatedAudioPath = edgeRes.audioFilePath || path.join(tempDir, 'audio.mp3');

      if (fs.existsSync(generatedAudioPath) && fs.statSync(generatedAudioPath).size > 1000) {
        fs.copyFileSync(generatedAudioPath, outputPath);
        fs.rmSync(tempDir, { recursive: true, force: true });

        const stats = fs.statSync(outputPath);
        const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`;
        const { stdout: durStdout } = await execAsync(probeCmd);
        const duration = parseFloat(durStdout.trim()) || 32.0;

        console.log(`[VoiceProvider] ✅ Microsoft Edge TTS Neural synthesized successfully (${duration}s, ${(stats.size / 1024).toFixed(1)} KB)`);

        return {
          audioPath: outputPath,
          durationSec: parseFloat(duration.toFixed(2)),
          provider: 'msedge_tts_christopher_neural',
          fileSizeBytes: stats.size,
        };
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (err: any) {
      console.warn('[VoiceProvider] Microsoft Edge TTS failed, falling back to Google TTS:', err?.message || err);
    }

    // 3. Fallback: Google Translate TTS with sentence-level chunking
    console.log(`[VoiceProvider] Synthesizing narration via Google TTS chunked engine...`);
    try {
      const chunks = this.splitIntoChunks(text, 100);
      const audioBuffers: Buffer[] = [];

      for (const chunk of chunks) {
        const encodedText = encodeURIComponent(chunk);
        const gttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=en&client=tw-ob`;
        
        const gttsRes = await fetch(gttsUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (gttsRes.ok) {
          const buf = Buffer.from(await gttsRes.arrayBuffer());
          audioBuffers.push(buf);
        }
      }

      if (audioBuffers.length > 0) {
        const finalBuffer = Buffer.concat(audioBuffers);
        fs.writeFileSync(outputPath, finalBuffer);
        const stats = fs.statSync(outputPath);

        // Probe exact duration with ffprobe
        const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`;
        const { stdout: durStdout } = await execAsync(probeCmd);
        const duration = parseFloat(durStdout.trim()) || 30.0;

        return {
          audioPath: outputPath,
          durationSec: parseFloat(duration.toFixed(2)),
          provider: 'google_tts_chunked',
          fileSizeBytes: stats.size,
        };
      }
    } catch (err) {
      console.warn('[VoiceProvider] Chunked Google TTS failed, using synthetic audio fallback:', err);
    }

    // 3. Fallback: Synthetic speech / ambient tone via FFmpeg
    console.log(`[VoiceProvider] Generating synthetic diorama audio bed via FFmpeg...`);
    const wordCount = text.split(/\s+/).length;
    const dur = Math.max(15, Math.round((wordCount / 140) * 60));
    const fallbackCmd = `ffmpeg -y -f lavfi -i "sine=frequency=220:duration=${dur}" -c:a libmp3lame -b:a 128k "${outputPath}"`;
    await execAsync(fallbackCmd);

    const stats = fs.statSync(outputPath);
    return {
      audioPath: outputPath,
      durationSec: dur,
      provider: 'ffmpeg_synthetic_fallback',
      fileSizeBytes: stats.size,
    };
  }
}
