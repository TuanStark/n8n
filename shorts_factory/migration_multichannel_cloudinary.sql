-- ==============================================================================
-- MULTI-CHANNEL & MULTI-GENRE & CLOUDINARY MIGRATION
-- Non-breaking migration: 100% backward compatible with existing pipeline
-- ==============================================================================

-- 1. DROP RESTRICTIVE CATEGORY CHECK CONSTRAINT
ALTER TABLE shorts_factory.topics DROP CONSTRAINT IF EXISTS topics_category_check;

-- 2. CREATE GENRE PROFILES TABLE
CREATE TABLE IF NOT EXISTS shorts_factory.genre_profiles (
    id VARCHAR(64) PRIMARY KEY, -- e.g. 'paper_history', 'cyberpunk_tech', 'dark_stoic'
    name VARCHAR(128) NOT NULL,
    description TEXT,
    system_prompt_scriptwriter TEXT NOT NULL,
    hook_framework JSONB NOT NULL DEFAULT '{}'::jsonb,
    visual_style_prompt TEXT NOT NULL,
    visual_negative_prompt TEXT NOT NULL,
    color_palette_preset JSONB NOT NULL DEFAULT '[]'::jsonb,
    image_engine VARCHAR(64) NOT NULL DEFAULT 'pollinations',
    tts_provider VARCHAR(32) NOT NULL DEFAULT 'msedge',
    tts_voice_id VARCHAR(128) NOT NULL DEFAULT 'en-US-ChristopherNeural',
    soundscape_preset VARCHAR(64) NOT NULL DEFAULT 'cinematic_boom',
    subtitle_style JSONB NOT NULL DEFAULT '{}'::jsonb,
    motion_engine_preset VARCHAR(64) NOT NULL DEFAULT 'stop_motion_12fps',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. CREATE CHANNELS TABLE
CREATE TABLE IF NOT EXISTS shorts_factory.channels (
    id VARCHAR(64) PRIMARY KEY, -- e.g. 'channel_01_paper', 'channel_02_tech', 'channel_03_stoic'
    name VARCHAR(255) NOT NULL,
    genre_key VARCHAR(64) NOT NULL REFERENCES shorts_factory.genre_profiles(id),
    description TEXT,
    default_privacy VARCHAR(32) NOT NULL DEFAULT 'unlisted' CHECK (default_privacy IN ('private', 'unlisted', 'public')),
    default_tags TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. CREATE CHANNEL CREDENTIALS TABLE
CREATE TABLE IF NOT EXISTS shorts_factory.channel_credentials (
    channel_id VARCHAR(64) PRIMARY KEY REFERENCES shorts_factory.channels(id) ON DELETE CASCADE,
    client_id VARCHAR(255) NOT NULL,
    client_secret VARCHAR(255) NOT NULL,
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    access_token_expires_at TIMESTAMPTZ,
    daily_quota_units_limit INT NOT NULL DEFAULT 10000,
    quota_units_used_today INT NOT NULL DEFAULT 0,
    quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. EXTEND EXISTING TABLES SAFELY
ALTER TABLE shorts_factory.topics 
    ADD COLUMN IF NOT EXISTS channel_id VARCHAR(64) REFERENCES shorts_factory.channels(id),
    ADD COLUMN IF NOT EXISTS genre_id VARCHAR(64) REFERENCES shorts_factory.genre_profiles(id),
    ADD COLUMN IF NOT EXISTS custom_prompt_override TEXT;

ALTER TABLE shorts_factory.media_assets 
    ADD COLUMN IF NOT EXISTS cloudinary_url TEXT,
    ADD COLUMN IF NOT EXISTS cloudinary_public_id VARCHAR(255);

ALTER TABLE shorts_factory.render_jobs 
    ADD COLUMN IF NOT EXISTS cloudinary_url TEXT,
    ADD COLUMN IF NOT EXISTS cloudinary_public_id VARCHAR(255);

ALTER TABLE shorts_factory.youtube_videos 
    ADD COLUMN IF NOT EXISTS channel_id VARCHAR(64) REFERENCES shorts_factory.channels(id);

CREATE INDEX IF NOT EXISTS idx_shorts_topics_channel ON shorts_factory.topics(channel_id);
CREATE INDEX IF NOT EXISTS idx_shorts_yt_channel ON shorts_factory.youtube_videos(channel_id);

-- 6. SEED CORE GENRE PROFILES
INSERT INTO shorts_factory.genre_profiles (
    id, name, description, system_prompt_scriptwriter, visual_style_prompt, visual_negative_prompt, 
    tts_provider, tts_voice_id, soundscape_preset, motion_engine_preset
) VALUES 
(
    'paper_history',
    'Paper Theater Ancient History',
    'Tactile layered papercraft stop-motion uncovering intense historical secrets and psychology',
    'You are an Elite YouTube Shorts Scriptwriter directing scripts for "Paper Theater World". Pacing is rapid (7-8 segments, 2.5-4s each). Bold sensory historical hooks without clichés like "Did you know". Focus on high tactical tension and grim human psychology.',
    'layered papercraft art, authentic paper theater, crafted entirely from stacked cut-out cardstock layers, precision laser-cut paper edges, physical relief, deep drop shadows between paper layers, raw paper fibers, dramatic museum directional lighting, cinematic paper stop-motion aesthetic, no pedestals, no frames',
    'pedestal, plinth, stand, base, cartoon, anime, manga, 3d cgi render, glossy plastic, flat vector, digital painting, photorealistic human skin, photograph, frame, border, text, watermark, logo, blurry',
    'msedge',
    'en-US-GuyNeural',
    'paper_asmr',
    'stop_motion_12fps'
),
(
    'cyberpunk_tech',
    'Futuristic Cyberpunk & Tech Matrix',
    'High-energy, hyper-modern AI, robotics and quantum computing breakthroughs with intense sci-fi aesthetics',
    'You are a Visionary Tech & AI Futurist creating viral YouTube Shorts for next-gen developers and innovators. Fast-paced, punchy, intellectual yet adrenaline-pumping. Break down complex breakthroughs into visceral revelations in 30 seconds.',
    'hyper-detailed 3D cinematic sci-fi render, octane render, unreal engine 5, cyberpunk neon aesthetics, glowing holographic wireframes, volumetric volumetric lighting, anamorphic lens flare, dark brushed titanium textures, sleek futuristic circuitry, 8k raytracing',
    'vintage, papercraft, cartoon, flat drawing, lowres, blurry, oversaturated pastel, messy anatomy, watermark, text',
    'msedge',
    'en-US-ChristopherNeural',
    'cyberpunk_synth',
    'smooth_pan_zoom'
),
(
    'dark_stoic',
    'Dark Stoicism & Tactical Mindset',
    'Brutally honest ancient philosophy, stoic wisdom, and warrior psychology with dramatic chiaroscuro aesthetic',
    'You are a Master of Stoic Philosophy and Tactical Psychology. You deliver hard, uncomfortable truths that command immediate respect. Piercing, deep, introspective tone. Every sentence cuts like a razor blade. No motivational fluff.',
    'dramatic noir chiaroscuro portrait, ancient Roman and Greek weathered marble sculptures with lifelike eyes, golden cracks (kintsugi style), intense single-source rim light, heavy dark shadows, atmospheric dust motes, museum masterpiece, photorealistic 8k',
    'happy, cartoon, anime, oversaturated colors, flat lighting, childish, modern clothing, text, logo, blurry',
    'msedge',
    'en-US-AndrewNeural',
    'dark_ambient',
    'dramatic_slow_push'
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    system_prompt_scriptwriter = EXCLUDED.system_prompt_scriptwriter,
    visual_style_prompt = EXCLUDED.visual_style_prompt,
    visual_negative_prompt = EXCLUDED.visual_negative_prompt,
    tts_voice_id = EXCLUDED.tts_voice_id,
    soundscape_preset = EXCLUDED.soundscape_preset;

-- 7. SEED INITIAL 3 CHANNELS
INSERT INTO shorts_factory.channels (id, name, genre_key, description, default_privacy, default_tags)
VALUES 
(
    'channel_01_paper',
    'Paper Theater World (History)',
    'paper_history',
    'Default legacy channel for ancient history papercraft stop-motion shorts',
    'unlisted',
    ARRAY['Shorts', 'history', 'papertheater', 'ancienthistory']
),
(
    'channel_02_tech',
    'Quantum Horizon (Tech & AI)',
    'cyberpunk_tech',
    'High-tech cutting edge AI and futuristic breakthroughs',
    'unlisted',
    ARRAY['Shorts', 'technology', 'ai', 'cyberpunk', 'futuretech']
),
(
    'channel_03_stoic',
    'Iron Mind (Dark Stoicism)',
    'dark_stoic',
    'Stoic philosophy, mental mastery and warrior mindset',
    'unlisted',
    ARRAY['Shorts', 'stoicism', 'philosophy', 'mindset', 'darkstoic']
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    genre_key = EXCLUDED.genre_key,
    description = EXCLUDED.description;

-- Update existing topics to default to channel_01_paper if null
UPDATE shorts_factory.topics 
SET channel_id = 'channel_01_paper', genre_id = 'paper_history'
WHERE channel_id IS NULL;
