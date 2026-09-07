import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  env: process.env.NODE_ENV || 'production',
  port: parseInt(process.env.PORT || '4100', 10),
  db: {
    host: process.env.POSTGRES_HOST || 'n8n-postgres',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'n8n',
    user: process.env.POSTGRES_USER || 'n8n',
    password: process.env.POSTGRES_PASSWORD || '',
    schema: 'shorts_factory',
  },
  redis: {
    host: process.env.REDIS_HOST || 'shorts-redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: 'gemini-3.8-flash',
  },
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    channelId: process.env.SLACK_CHANNEL_ID || '',
  },
  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || '',
    defaultPrivacy: process.env.YOUTUBE_DEFAULT_PRIVACY || 'unlisted',
  },
  storage: {
    baseDir: process.env.STORAGE_DIR || path.resolve(__dirname, '../../storage'),
    raw: path.resolve(process.env.STORAGE_DIR || '../../storage', 'raw'),
    layers: path.resolve(process.env.STORAGE_DIR || '../../storage', 'layers'),
    audio: path.resolve(process.env.STORAGE_DIR || '../../storage', 'audio'),
    subtitles: path.resolve(process.env.STORAGE_DIR || '../../storage', 'subtitles'),
    renders: path.resolve(process.env.STORAGE_DIR || '../../storage', 'renders'),
    textures: path.resolve(process.env.STORAGE_DIR || '../../storage', 'textures'),
  },
};
