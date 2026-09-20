import { pool } from '../db/pool';

export interface GenreProfile {
  id: string;
  name: string;
  description?: string;
  system_prompt_scriptwriter: string;
  hook_framework?: Record<string, any>;
  visual_style_prompt: string;
  visual_negative_prompt: string;
  color_palette_preset?: string[];
  image_engine?: string;
  tts_provider: string;
  tts_voice_id: string;
  soundscape_preset: 'paper_asmr' | 'cyberpunk_synth' | 'dark_ambient' | 'cinematic_boom' | string;
  subtitle_style?: Record<string, any>;
  motion_engine_preset: string;
}

export interface ChannelWithGenre {
  id: string;
  name: string;
  genre_key: string;
  description?: string;
  default_privacy: 'private' | 'unlisted' | 'public';
  default_tags: string[];
  is_active: boolean;
  genre: GenreProfile;
}

export class GenreService {
  // Built-in fallback presets in case database is cold or being initialized
  private static DEFAULT_PRESETS: Record<string, GenreProfile> = {
    paper_history: {
      id: 'paper_history',
      name: 'Paper Theater Ancient History',
      system_prompt_scriptwriter:
        'You are an Elite YouTube Shorts Scriptwriter directing scripts for "Paper Theater World". Pacing is rapid (7-8 segments, 2.5-4s each). Bold sensory historical hooks without clichés like "Did you know". Focus on high tactical tension and grim human psychology.',
      visual_style_prompt:
        'layered papercraft art, authentic paper theater, crafted entirely from stacked cut-out cardstock layers, precision laser-cut paper edges, physical relief, deep drop shadows between paper layers, raw paper fibers, dramatic museum directional lighting, cinematic paper stop-motion aesthetic, no pedestals, no frames',
      visual_negative_prompt:
        'pedestal, plinth, stand, base, cartoon, anime, manga, 3d cgi render, glossy plastic, flat vector, digital painting, photorealistic human skin, photograph, frame, border, text, watermark, logo, blurry',
      tts_provider: 'msedge',
      tts_voice_id: 'en-US-GuyNeural',
      soundscape_preset: 'paper_asmr',
      motion_engine_preset: 'stop_motion_12fps',
    },
    cyberpunk_tech: {
      id: 'cyberpunk_tech',
      name: 'Futuristic Cyberpunk & Tech Matrix',
      system_prompt_scriptwriter:
        'You are a Visionary Tech & AI Futurist creating viral YouTube Shorts for next-gen developers and innovators. Fast-paced, punchy, intellectual yet adrenaline-pumping. Break down complex breakthroughs into visceral revelations in 30 seconds.',
      visual_style_prompt:
        'hyper-detailed 3D cinematic sci-fi render, octane render, unreal engine 5, cyberpunk neon aesthetics, glowing holographic wireframes, volumetric lighting, anamorphic lens flare, dark brushed titanium textures, sleek futuristic circuitry, 8k raytracing',
      visual_negative_prompt:
        'vintage, papercraft, cartoon, flat drawing, lowres, blurry, oversaturated pastel, messy anatomy, watermark, text',
      tts_provider: 'msedge',
      tts_voice_id: 'en-US-ChristopherNeural',
      soundscape_preset: 'cyberpunk_synth',
      motion_engine_preset: 'smooth_pan_zoom',
    },
    dark_stoic: {
      id: 'dark_stoic',
      name: 'Dark Stoicism & Tactical Mindset',
      system_prompt_scriptwriter:
        'You are a Master of Stoic Philosophy and Tactical Psychology. You deliver hard, uncomfortable truths that command immediate respect. Piercing, deep, introspective tone. Every sentence cuts like a razor blade. No motivational fluff.',
      visual_style_prompt:
        'dramatic noir chiaroscuro portrait, ancient Roman and Greek weathered marble sculptures with lifelike eyes, golden cracks (kintsugi style), intense single-source rim light, heavy dark shadows, atmospheric dust motes, museum masterpiece, photorealistic 8k',
      visual_negative_prompt:
        'happy, cartoon, anime, oversaturated colors, flat lighting, childish, modern clothing, text, logo, blurry',
      tts_provider: 'msedge',
      tts_voice_id: 'en-US-AndrewNeural',
      soundscape_preset: 'dark_ambient',
      motion_engine_preset: 'dramatic_slow_push',
    },
  };

  /**
   * Get GenreProfile by genre key from DB with fallback
   */
  async getGenre(genreKey: string): Promise<GenreProfile> {
    try {
      const res = await pool.query('SELECT * FROM genre_profiles WHERE id = $1', [genreKey]);
      if (res.rows.length > 0) {
        return res.rows[0] as GenreProfile;
      }
    } catch (err: any) {
      console.warn(`[GenreService] Could not fetch genre from DB (${err.message}), using fallback.`);
    }

    return GenreService.DEFAULT_PRESETS[genreKey] || GenreService.DEFAULT_PRESETS.paper_history;
  }

  /**
   * Get Channel configuration with its attached GenreProfile
   */
  async getChannel(channelId: string): Promise<ChannelWithGenre | null> {
    try {
      const res = await pool.query(
        `SELECT c.*, 
                g.name as genre_name, 
                g.system_prompt_scriptwriter, 
                g.visual_style_prompt, 
                g.visual_negative_prompt, 
                g.tts_provider, 
                g.tts_voice_id, 
                g.soundscape_preset, 
                g.motion_engine_preset
         FROM channels c
         LEFT JOIN genre_profiles g ON c.genre_key = g.id
         WHERE c.id = $1`,
        [channelId]
      );

      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          id: row.id,
          name: row.name,
          genre_key: row.genre_key,
          description: row.description,
          default_privacy: row.default_privacy || 'unlisted',
          default_tags: row.default_tags || [],
          is_active: row.is_active,
          genre: {
            id: row.genre_key,
            name: row.genre_name || row.genre_key,
            system_prompt_scriptwriter: row.system_prompt_scriptwriter,
            visual_style_prompt: row.visual_style_prompt,
            visual_negative_prompt: row.visual_negative_prompt,
            tts_provider: row.tts_provider || 'msedge',
            tts_voice_id: row.tts_voice_id || 'en-US-GuyNeural',
            soundscape_preset: row.soundscape_preset || 'cinematic_boom',
            motion_engine_preset: row.motion_engine_preset || 'stop_motion_12fps',
          },
        };
      }
    } catch (err: any) {
      console.warn(`[GenreService] Error fetching channel ${channelId}:`, err.message);
    }
    return null;
  }

  /**
   * List all available channels
   */
  async listChannels(): Promise<any[]> {
    const res = await pool.query(
      `SELECT c.id, c.name, c.genre_key, c.default_privacy, c.is_active, 
              g.name as genre_name,
              CASE WHEN cc.refresh_token IS NOT NULL AND cc.refresh_token != '' THEN true ELSE false END as has_credentials
       FROM channels c
       LEFT JOIN genre_profiles g ON c.genre_key = g.id
       LEFT JOIN channel_credentials cc ON cc.channel_id = c.id
       ORDER BY c.created_at ASC`
    );
    return res.rows;
  }
}
