-- ==============================================================================
-- AI YOUTUBE SHORTS FACTORY ("Paper Theater World")
-- Dedicated Schema: shorts_factory
-- Complete isolation from all legacy workflows
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS shorts_factory;

-- 1. TOPIC BACKLOG
CREATE TABLE IF NOT EXISTS shorts_factory.topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL CHECK (category IN ('ancient_rome', 'ancient_greece', 'ancient_egypt')),
    historical_period VARCHAR(128) NOT NULL,
    concept_summary TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'IDEA' 
        CHECK (status IN ('IDEA', 'RESEARCHING', 'RESEARCH_READY', 'SCRIPTING', 'PRODUCING', 'PUBLISHED', 'ARCHIVED')),
    potential_score NUMERIC(4, 2) DEFAULT 8.00, -- 0.00 to 10.00
    source_origin VARCHAR(128) DEFAULT 'auto_ideation',
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shorts_topics_status ON shorts_factory.topics(status, category);
CREATE INDEX IF NOT EXISTS idx_shorts_topics_score ON shorts_factory.topics(potential_score DESC);

-- 2. RESEARCH DOCUMENTS & SOURCES
CREATE TABLE IF NOT EXISTS shorts_factory.research_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES shorts_factory.topics(id) ON DELETE CASCADE,
    historical_period VARCHAR(128) NOT NULL,
    key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
    timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
    important_people JSONB NOT NULL DEFAULT '[]'::jsonb,
    locations JSONB NOT NULL DEFAULT '[]'::jsonb,
    conflicts_detected JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence_score NUMERIC(3, 2) NOT NULL DEFAULT 1.00,
    raw_llm_response TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shorts_research_topic ON shorts_factory.research_documents(topic_id);

CREATE TABLE IF NOT EXISTS shorts_factory.research_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    research_id UUID NOT NULL REFERENCES shorts_factory.research_documents(id) ON DELETE CASCADE,
    source_title VARCHAR(255) NOT NULL,
    source_url TEXT,
    credibility_rating VARCHAR(32) DEFAULT 'HIGH',
    citation_text TEXT
);

-- 3. SCRIPTS
CREATE TABLE IF NOT EXISTS shorts_factory.scripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES shorts_factory.topics(id) ON DELETE CASCADE,
    research_id UUID NOT NULL REFERENCES shorts_factory.research_documents(id),
    version INT NOT NULL DEFAULT 1,
    hook_text TEXT NOT NULL,
    full_script TEXT NOT NULL,
    estimated_duration_sec NUMERIC(4, 1) NOT NULL,
    narration_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    facts_used JSONB NOT NULL DEFAULT '[]'::jsonb,
    hook_score NUMERIC(3, 1) DEFAULT 8.5,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shorts_scripts_status ON shorts_factory.scripts(status);

-- 4. VISUAL STYLE PROFILES (DNA)
CREATE TABLE IF NOT EXISTS shorts_factory.visual_style_profiles (
    id VARCHAR(64) PRIMARY KEY, -- e.g. 'paper-theater-v1'
    name VARCHAR(128) NOT NULL,
    global_positive_prompt TEXT NOT NULL,
    global_negative_prompt TEXT NOT NULL,
    camera_rules JSONB NOT NULL,
    lighting_rules JSONB NOT NULL,
    motion_rules JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. STORYBOARDS & SCENES
CREATE TABLE IF NOT EXISTS shorts_factory.storyboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    script_id UUID NOT NULL REFERENCES shorts_factory.scripts(id) ON DELETE CASCADE,
    style_profile_id VARCHAR(64) NOT NULL REFERENCES shorts_factory.visual_style_profiles(id),
    total_scenes INT NOT NULL,
    total_duration_sec NUMERIC(4, 1) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'GENERATING_ASSETS', 'READY_TO_RENDER', 'RENDERED', 'FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shorts_factory.scenes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storyboard_id UUID NOT NULL REFERENCES shorts_factory.storyboards(id) ON DELETE CASCADE,
    scene_index INT NOT NULL,
    duration_sec NUMERIC(3, 1) NOT NULL,
    narration_text TEXT NOT NULL,
    visual_description TEXT NOT NULL,
    characters JSONB NOT NULL DEFAULT '[]'::jsonb,
    location VARCHAR(255) NOT NULL,
    camera_movement VARCHAR(64) NOT NULL,
    motion_style VARCHAR(64) NOT NULL,
    transition_in VARCHAR(64) NOT NULL DEFAULT 'none',
    transition_out VARCHAR(64) NOT NULL DEFAULT 'cut',
    sound_effects JSONB DEFAULT '[]'::jsonb,
    positive_prompt TEXT NOT NULL,
    negative_prompt TEXT NOT NULL,
    generation_mode VARCHAR(32) NOT NULL DEFAULT '2.5D_STOP_MOTION'
        CHECK (generation_mode IN ('STATIC_CUTOUT', '2.5D_STOP_MOTION', 'FULL_AI_VIDEO')),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'GENERATING', 'READY', 'FAILED')),
    UNIQUE(storyboard_id, scene_index)
);
CREATE INDEX IF NOT EXISTS idx_shorts_scenes_storyboard ON shorts_factory.scenes(storyboard_id, scene_index);

-- 6. MEDIA ASSETS & GENERATION JOBS
CREATE TABLE IF NOT EXISTS shorts_factory.media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id UUID REFERENCES shorts_factory.scenes(id) ON DELETE SET NULL,
    asset_type VARCHAR(32) NOT NULL CHECK (asset_type IN ('IMAGE_LAYER', 'VIDEO_CLIP', 'VOICE_TRACK', 'SFX', 'MUSIC', 'SUBTITLE')),
    storage_path TEXT NOT NULL,
    mime_type VARCHAR(64) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    duration_sec NUMERIC(4, 2),
    checksum_sha256 VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shorts_factory.generation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id UUID REFERENCES shorts_factory.scenes(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    model_version VARCHAR(64) NOT NULL,
    prompt_payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'TIMED_OUT')),
    cost_usd NUMERIC(6, 4) DEFAULT 0.0000,
    duration_ms INT,
    provider_task_id VARCHAR(255),
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shorts_gen_jobs_status ON shorts_factory.generation_jobs(status, provider);

-- 7. VOICE PROFILES
CREATE TABLE IF NOT EXISTS shorts_factory.voice_profiles (
    id VARCHAR(64) PRIMARY KEY,
    provider VARCHAR(64) NOT NULL DEFAULT 'elevenlabs',
    provider_voice_id VARCHAR(128) NOT NULL,
    speaking_rate NUMERIC(3, 2) DEFAULT 1.05,
    pitch NUMERIC(3, 2) DEFAULT 1.00,
    stability NUMERIC(3, 2) DEFAULT 0.75,
    similarity_boost NUMERIC(3, 2) DEFAULT 0.85,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 8. RENDER JOBS
CREATE TABLE IF NOT EXISTS shorts_factory.render_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storyboard_id UUID NOT NULL REFERENCES shorts_factory.storyboards(id) ON DELETE CASCADE,
    output_resolution VARCHAR(32) NOT NULL DEFAULT '1080x1920',
    fps INT NOT NULL DEFAULT 30,
    video_codec VARCHAR(32) NOT NULL DEFAULT 'libx264',
    audio_codec VARCHAR(32) NOT NULL DEFAULT 'aac',
    status VARCHAR(32) NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'RENDERING', 'COMPLETED', 'FAILED')),
    render_duration_sec NUMERIC(5, 2),
    output_asset_id UUID REFERENCES shorts_factory.media_assets(id),
    error_log TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. QC REPORTS & APPROVAL REQUESTS
CREATE TABLE IF NOT EXISTS shorts_factory.qc_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    render_job_id UUID NOT NULL REFERENCES shorts_factory.render_jobs(id) ON DELETE CASCADE,
    overall_status VARCHAR(16) NOT NULL CHECK (overall_status IN ('PASS', 'WARNING', 'FAIL')),
    technical_checks JSONB NOT NULL,
    content_checks JSONB NOT NULL,
    ai_vision_checks JSONB NOT NULL,
    rejection_reasons JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shorts_factory.approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(32) NOT NULL CHECK (entity_type IN ('SCRIPT', 'STORYBOARD', 'FINAL_VIDEO')),
    entity_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'TIMEOUT_EXPIRED')),
    reviewer_channel VARCHAR(64) DEFAULT 'telegram_bot',
    reviewer_id VARCHAR(128),
    feedback_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ
);

-- 10. YOUTUBE VIDEOS & ANALYTICS
CREATE TABLE IF NOT EXISTS shorts_factory.youtube_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES shorts_factory.topics(id),
    render_job_id UUID NOT NULL REFERENCES shorts_factory.render_jobs(id),
    youtube_video_id VARCHAR(64) UNIQUE,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    privacy_status VARCHAR(32) NOT NULL DEFAULT 'private'
        CHECK (privacy_status IN ('private', 'unlisted', 'public')),
    scheduled_publish_time TIMESTAMPTZ,
    upload_status VARCHAR(32) NOT NULL DEFAULT 'QUEUED'
        CHECK (upload_status IN ('QUEUED', 'UPLOADING', 'UPLOADED', 'PUBLISHED', 'FAILED')),
    quota_units_used INT NOT NULL DEFAULT 1600,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shorts_factory.analytics_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    youtube_video_id VARCHAR(64) NOT NULL REFERENCES shorts_factory.youtube_videos(youtube_video_id) ON DELETE CASCADE,
    views INT NOT NULL DEFAULT 0,
    likes INT NOT NULL DEFAULT 0,
    comments INT NOT NULL DEFAULT 0,
    shares INT NOT NULL DEFAULT 0,
    watch_time_sec NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
    average_view_duration_sec NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
    retention_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.0,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shorts_analytics_vid ON shorts_factory.analytics_snapshots(youtube_video_id, captured_at DESC);

-- 11. AUDIT & IDEMPOTENCY TRACKER
CREATE TABLE IF NOT EXISTS shorts_factory.automation_jobs (
    id VARCHAR(128) PRIMARY KEY,
    workflow_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- ==============================================================================
-- INITIAL SEED DATA
-- ==============================================================================

-- Seed Visual Style Profile (Paper Theater v1)
INSERT INTO shorts_factory.visual_style_profiles (
    id, name, global_positive_prompt, global_negative_prompt, camera_rules, lighting_rules, motion_rules
) VALUES (
    'paper-theater-v1',
    'Handmade Miniature Paper Diorama v1',
    '(masterpiece, best quality:1.2), handcrafted miniature paper theater diorama, layered cut paper art, corrugated cardboard textures, folded paper silhouette, intricate physical paper cutout, stop-motion animation aesthetic, miniature depth of field, tilt-shift lens, dramatic chiaroscuro diorama lighting, historical authenticity, soft paper edge shadows, 8k resolution, cinematic composition',
    '(worst quality, low quality:1.4), (photorealistic humans:1.3), 3d cgi render, glossy plastic, smooth digital painting, cartoon, anime, deformed hands, modern elements, watermark, logo, text, blurry edges, oversaturated digital glow, shiny reflections',
    '{"angle": "proscenium_front", "lens": "tilt_shift_50mm", "depth_of_field": "shallow", "movement": "subtle_motorized_pan"}'::jsonb,
    '{"key_light": "warm_amber_3200k", "fill_light": "cool_ambient_5600k", "shadows": "hard_cast_paper_shadows"}'::jsonb,
    '{"fps": 12, "cadence": "posterized_stop_motion", "joints": "brass_paper_fasteners"}'::jsonb
) ON CONFLICT (id) DO NOTHING;

-- Seed Voice Profile
INSERT INTO shorts_factory.voice_profiles (
    id, provider, provider_voice_id, speaking_rate, pitch, stability, similarity_boost
) VALUES (
    'ancient_historian_m1',
    'elevenlabs',
    'pNInz6obpgDQGcFmaJgB', -- Adam / Deep Documentary Narrator
    1.05,
    1.00,
    0.75,
    0.85
) ON CONFLICT (id) DO NOTHING;

-- Seed Initial High-Potential Topics
INSERT INTO shorts_factory.topics (
    title, category, historical_period, concept_summary, potential_score
) VALUES 
(
    'The True Reason Julius Caesar Crossed the Rubicon',
    'ancient_rome',
    'Late Roman Republic (49 BC)',
    'Caesar was not just invading Rome for power; he was facing catastrophic political trials and financial ruin if he laid down his arms.',
    9.50
),
(
    'The Spartan 300: What Really Happened at Thermopylae',
    'ancient_greece',
    'Greco-Persian Wars (480 BC)',
    'Leonidas did not fight alone; over 1,000 Thebans, Thespians, and allied Greeks stayed and died with the Spartans.',
    9.20
),
(
    'The Curse of Tutankhamun: Fact vs Victorian Myth',
    'ancient_egypt',
    'New Kingdom (18th Dynasty)',
    'How British tabloids created a supernatural curse to cover up Lord Carnarvon dying from an infected mosquito bite.',
    9.40
) ON CONFLICT DO NOTHING;
