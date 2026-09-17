-- ====================================================================
-- MIGRATION: ADD STORY SUPPORT TO SHOPEE AFFILIATE AUTOMATION
-- Facebook & Instagram Story Engine
-- Target: PostgreSQL 16
-- ====================================================================

-- 1. Mở rộng affiliate_publishing_queue để hỗ trợ các kênh phân phối khác nhau (FEED, STORY, REEL)
ALTER TABLE affiliate_publishing_queue 
ADD COLUMN IF NOT EXISTS target_type VARCHAR(30) DEFAULT 'FEED' 
CHECK (target_type IN ('FEED', 'STORY', 'REEL'));

ALTER TABLE affiliate_publishing_queue 
ADD COLUMN IF NOT EXISTS story_media_url TEXT;

ALTER TABLE affiliate_publishing_queue 
ADD COLUMN IF NOT EXISTS parent_post_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_affiliate_queue_target ON affiliate_publishing_queue(target_type, status);

-- 2. Bảng quản lý chi tiết Story đã xuất bản
CREATE TABLE IF NOT EXISTS affiliate_facebook_stories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_id UUID REFERENCES affiliate_content_items(id) ON DELETE SET NULL,
    story_fb_id VARCHAR(100) NOT NULL UNIQUE,
    media_type VARCHAR(20) NOT NULL DEFAULT 'IMAGE', -- 'IMAGE' | 'VIDEO'
    story_asset_path TEXT NOT NULL,
    hook_text TEXT,
    cta_type VARCHAR(50) DEFAULT 'VIEW_FEED_POST',
    feed_post_id VARCHAR(100),
    published_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    status VARCHAR(30) DEFAULT 'ACTIVE', -- 'ACTIVE', 'EXPIRED', 'FAILED'
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fb_stories_status ON affiliate_facebook_stories(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_fb_stories_feed_post ON affiliate_facebook_stories(feed_post_id);
