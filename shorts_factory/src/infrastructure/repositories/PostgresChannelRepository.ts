import { pool } from '../../db/pool';
import { Channel, ChannelCredentials } from '../../core/domain/Channel';
import { GenreProfile } from '../../core/domain/GenreProfile';
import { IChannelRepository } from '../../core/ports/IChannelRepository';

export class PostgresChannelRepository implements IChannelRepository {
  async getChannelById(channelId: string): Promise<Channel | null> {
    const query = `
      SELECT c.*, 
             cc.client_id, cc.client_secret, cc.refresh_token, cc.access_token, 
             cc.access_token_expires_at, cc.daily_quota_units_limit, 
             cc.quota_units_used_today, cc.quota_reset_at
      FROM channels c
      LEFT JOIN channel_credentials cc ON cc.channel_id = c.id
      WHERE c.id = $1
    `;
    const res = await pool.query(query, [channelId]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    let credentials: ChannelCredentials | undefined;
    if (row.client_id && row.refresh_token) {
      credentials = {
        clientId: row.client_id,
        clientSecret: row.client_secret,
        refreshToken: row.refresh_token,
        accessToken: row.access_token,
        accessTokenExpiresAt: row.access_token_expires_at,
        dailyQuotaLimit: row.daily_quota_units_limit || 10000,
        quotaUnitsUsedToday: row.quota_units_used_today || 0,
        quotaResetAt: row.quota_reset_at || new Date(),
      };
    }

    return {
      id: row.id,
      name: row.name,
      genreKey: row.genre_key,
      description: row.description,
      defaultPrivacy: row.default_privacy || 'unlisted',
      defaultTags: row.default_tags || [],
      isActive: row.is_active,
      credentials,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listActiveChannels(): Promise<Channel[]> {
    const query = `
      SELECT c.*, 
             cc.client_id, cc.client_secret, cc.refresh_token, cc.access_token, 
             cc.access_token_expires_at, cc.daily_quota_units_limit, 
             cc.quota_units_used_today, cc.quota_reset_at
      FROM channels c
      LEFT JOIN channel_credentials cc ON cc.channel_id = c.id
      WHERE c.is_active = TRUE
      ORDER BY c.created_at ASC
    `;
    const res = await pool.query(query);
    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      genreKey: row.genre_key,
      description: row.description,
      defaultPrivacy: row.default_privacy || 'unlisted',
      defaultTags: row.default_tags || [],
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getGenreProfile(genreKey: string): Promise<GenreProfile> {
    const res = await pool.query('SELECT * FROM genre_profiles WHERE id = $1', [genreKey]);
    if (res.rows.length === 0) {
      // Fallback
      return {
        id: genreKey,
        name: genreKey,
        systemPromptScriptwriter: 'You are an elite YouTube Shorts director. Fast-paced, punchy, high viral retention.',
        visualStylePrompt: '8k cinematic hyper-detailed octane render 9:16 vertical video',
        visualNegativePrompt: 'blurry, lowres, text, watermark, cartoon, bad anatomy',
        imageEngine: 'pollinations',
        ttsProvider: 'msedge',
        ttsVoiceId: 'en-US-GuyNeural',
        soundscapePreset: 'cinematic_boom',
        motionEnginePreset: 'smooth_pan_zoom',
        isActive: true,
      };
    }

    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      systemPromptScriptwriter: row.system_prompt_scriptwriter,
      hookFramework: row.hook_framework,
      visualStylePrompt: row.visual_style_prompt,
      visualNegativePrompt: row.visual_negative_prompt,
      colorPalettePreset: row.color_palette_preset,
      imageEngine: row.image_engine || 'pollinations',
      ttsProvider: row.tts_provider || 'msedge',
      ttsVoiceId: row.tts_voice_id || 'en-US-GuyNeural',
      soundscapePreset: row.soundscape_preset || 'cinematic_boom',
      subtitleStyle: row.subtitle_style,
      motionEnginePreset: row.motion_engine_preset || 'smooth_pan_zoom',
      isActive: row.is_active,
    };
  }

  async listGenreProfiles(): Promise<GenreProfile[]> {
    const res = await pool.query('SELECT * FROM genre_profiles ORDER BY created_at ASC');
    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      systemPromptScriptwriter: row.system_prompt_scriptwriter,
      hookFramework: row.hook_framework,
      visualStylePrompt: row.visual_style_prompt,
      visualNegativePrompt: row.visual_negative_prompt,
      imageEngine: row.image_engine,
      ttsProvider: row.tts_provider,
      ttsVoiceId: row.tts_voice_id,
      soundscapePreset: row.soundscape_preset,
      motionEnginePreset: row.motion_engine_preset,
      isActive: row.is_active,
    }));
  }

  async saveChannel(channel: Partial<Channel>): Promise<void> {
    if (!channel.id || !channel.name || !channel.genreKey) {
      throw new Error('Channel requires id, name, and genreKey');
    }

    await pool.query(
      `INSERT INTO channels (id, name, genre_key, description, default_privacy, default_tags, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         genre_key = EXCLUDED.genre_key,
         description = EXCLUDED.description,
         default_privacy = EXCLUDED.default_privacy,
         default_tags = EXCLUDED.default_tags,
         updated_at = NOW()`,
      [channel.id, channel.name, channel.genreKey, channel.description || null, channel.defaultPrivacy || 'unlisted', channel.defaultTags || []]
    );
  }

  async updateQuotaUsed(channelId: string, unitsAdded: number): Promise<void> {
    await pool.query(
      `UPDATE channel_credentials
       SET quota_units_used_today = quota_units_used_today + $1, updated_at = NOW()
       WHERE channel_id = $2`,
      [unitsAdded, channelId]
    );
  }
}
