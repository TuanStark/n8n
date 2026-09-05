-- ====================================================================
-- SHOPEE AFFILIATE AUTOMATION MACHINE - DATABASE SCHEMA
-- Brand: Nhà Có Món Hay ("Những món nhỏ, cuộc sống tiện hơn")
-- Target: PostgreSQL 16
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 1. BẢNG CẤU HÌNH HỆ THỐNG (SYSTEM CONFIG)
CREATE TABLE IF NOT EXISTS affiliate_system_config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial system configuration
INSERT INTO affiliate_system_config (key, value, description)
VALUES 
(
    'hunter_rules',
    '{
        "min_rating": 4.7,
        "min_sold": 100,
        "min_commission_rate": 5.0,
        "min_price": 40000,
        "max_price": 450000,
        "allowed_shop_types": ["OFFICIAL_MALL", "PREFERRED", "PREFERRED_PLUS"],
        "target_keywords": ["tiện ích", "nhà cửa", "thông minh", "đồ gia dụng", "decor", "sắp xếp", "bếp"],
        "repost_cooldown_days": 14
    }'::jsonb,
    'Quy tắc phễu lọc cành cứng cho Shopee Product Hunter'
),
(
    'scoring_weights',
    '{
        "commission_yield": 0.25,
        "social_proof": 0.20,
        "problem_solving": 0.20,
        "impulse_price": 0.15,
        "content_potential": 0.10,
        "policy_safety": 0.10,
        "approval_threshold": 75.0
    }'::jsonb,
    'Trọng số mô hình chấm điểm sản phẩm AI'
),
(
    'publishing_schedule',
    '{
        "daily_slots": ["08:30", "11:45", "17:15", "20:30"],
        "max_posts_per_day": 4,
        "min_interval_minutes": 180,
        "simulation_mode": true
    }'::jsonb,
    'Lịch trình xuất bản lên Facebook Page Nhà Có Món Hay'
),
(
    'bandit_angle_weights',
    '{
        "PROBLEM_SOLUTION": 0.35,
        "CURIOSITY": 0.25,
        "WORTH_IT": 0.20,
        "BEFORE_AFTER": 0.10,
        "LIFE_HACK": 0.10
    }'::jsonb,
    'Trọng số phân bổ góc nội dung của Multi-Armed Bandit Optimizer'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;

-- 2. BẢNG SẢN PHẨM (AFFILIATE_PRODUCTS)
CREATE TABLE IF NOT EXISTS affiliate_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shopee_item_id BIGINT NOT NULL,
    shopee_shop_id BIGINT NOT NULL,
    product_name VARCHAR(500) NOT NULL,
    product_url TEXT NOT NULL,
    category_id VARCHAR(100),
    category_name VARCHAR(255),
    price NUMERIC(15, 2) NOT NULL,
    original_price NUMERIC(15, 2),
    discount_percentage INT DEFAULT 0,
    commission_rate NUMERIC(5, 2) NOT NULL,
    commission_amount NUMERIC(15, 2) NOT NULL,
    rating_star NUMERIC(3, 2) NOT NULL,
    historical_sold INT NOT NULL DEFAULT 0,
    shop_name VARCHAR(255),
    shop_type VARCHAR(50),
    image_urls JSONB NOT NULL DEFAULT '[]',
    raw_specs JSONB DEFAULT '{}',
    intake_source VARCHAR(50) DEFAULT 'AUTO_API', -- 'AUTO_API' or 'MANUAL_LINK'
    custom_affiliate_link TEXT,                   -- Direct affiliate shortlink provided by user
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_affiliate_shopee_item UNIQUE (shopee_item_id, shopee_shop_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_item_shop ON affiliate_products(shopee_item_id, shopee_shop_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_products_rating_sold ON affiliate_products(rating_star DESC, historical_sold DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_products_created ON affiliate_products(created_at DESC);

-- 3. BẢNG ĐÁNH GIÁ AI (AFFILIATE_AI_DECISIONS)
CREATE TABLE IF NOT EXISTS affiliate_ai_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES affiliate_products(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL, -- 'PRODUCT_SCORING', 'CONTENT_QA', 'OPTIMIZER'
    model_name VARCHAR(100) NOT NULL,
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    input_payload JSONB NOT NULL DEFAULT '{}',
    output_payload JSONB NOT NULL DEFAULT '{}',
    score NUMERIC(5, 2),
    decision VARCHAR(50) NOT NULL, -- 'ACCEPTED', 'REJECTED', 'NEEDS_REVISION'
    reasoning TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_affiliate_ai_decisions_product ON affiliate_ai_decisions(product_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_ai_decisions_stage ON affiliate_ai_decisions(stage);

-- 4. BẢNG BÀI VIẾT NỘI DUNG (AFFILIATE_CONTENT_ITEMS)
CREATE TABLE IF NOT EXISTS affiliate_content_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES affiliate_products(id) ON DELETE CASCADE,
    content_angle VARCHAR(50) NOT NULL, -- 'PROBLEM_SOLUTION', 'CURIOSITY', 'WORTH_IT', 'BEFORE_AFTER', 'LIFE_HACK'
    hook_text TEXT NOT NULL,
    body_text TEXT NOT NULL,
    cta_text TEXT NOT NULL,
    full_caption TEXT NOT NULL,
    first_comment_text TEXT NOT NULL,
    selected_image_urls JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(50) DEFAULT 'DRAFT', -- 'DRAFT', 'QA_PASSED', 'QA_FAILED', 'QUEUED', 'PUBLISHED', 'ARCHIVED'
    qa_score NUMERIC(5, 2),
    qa_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_affiliate_content_status ON affiliate_content_items(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_content_product ON affiliate_content_items(product_id);

-- 5. BẢNG AFFILIATE LINKS VÀ SUBID MAPPING
CREATE TABLE IF NOT EXISTS affiliate_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES affiliate_products(id) ON DELETE CASCADE,
    content_id UUID REFERENCES affiliate_content_items(id) ON DELETE SET NULL,
    sub_id_1 VARCHAR(50) NOT NULL, -- Product Identifier: P_{shopee_item_id}
    sub_id_2 VARCHAR(50) NOT NULL, -- Content Identifier: C_{content_id_short}
    sub_id_3 VARCHAR(50),          -- Angle Identifier: A_{angle_code}
    sub_id_4 VARCHAR(50) DEFAULT 'FBPAGE', -- Channel
    sub_id_5 VARCHAR(50),          -- Slot / Extra
    original_url TEXT NOT NULL,
    short_link TEXT NOT NULL,      -- https://s.shopee.vn/...
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_affiliate_subids UNIQUE (sub_id_1, sub_id_2, sub_id_3)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_links_sub2 ON affiliate_links(sub_id_2);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_product ON affiliate_links(product_id);

-- 6. HÀNG ĐỢI XUẤT BẢN (AFFILIATE_PUBLISHING_QUEUE)
CREATE TABLE IF NOT EXISTS affiliate_publishing_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_id UUID NOT NULL REFERENCES affiliate_content_items(id) ON DELETE CASCADE,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_affiliate_queue_status_sched ON affiliate_publishing_queue(status, scheduled_for);

-- 7. BẢNG BÀI ĐĂNG FACEBOOK (AFFILIATE_FACEBOOK_POSTS)
CREATE TABLE IF NOT EXISTS affiliate_facebook_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_id UUID NOT NULL REFERENCES affiliate_content_items(id) ON DELETE CASCADE,
    fb_post_id VARCHAR(100) NOT NULL UNIQUE,
    fb_comment_id VARCHAR(100),
    post_type VARCHAR(50) NOT NULL DEFAULT 'PHOTO_CAROUSEL', -- 'PHOTO_CAROUSEL', 'SINGLE_IMAGE', 'VIDEO', 'REEL'
    published_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    permalink_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_affiliate_fb_posts_post_id ON affiliate_facebook_posts(fb_post_id);

-- 8. BẢNG ĐƠN HÀNG VÀ CHUYỂN ĐỔI (AFFILIATE_CONVERSIONS)
CREATE TABLE IF NOT EXISTS affiliate_conversions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shopee_order_id VARCHAR(100) NOT NULL,
    purchase_time TIMESTAMP WITH TIME ZONE NOT NULL,
    sub_id_1 VARCHAR(50),
    sub_id_2 VARCHAR(50),
    sub_id_3 VARCHAR(50),
    sub_id_4 VARCHAR(50),
    sub_id_5 VARCHAR(50),
    content_id UUID REFERENCES affiliate_content_items(id) ON DELETE SET NULL,
    product_id UUID REFERENCES affiliate_products(id) ON DELETE SET NULL,
    order_status VARCHAR(50) NOT NULL, -- 'COMPLETED', 'PENDING', 'CANCELLED'
    total_order_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    estimated_total_commission NUMERIC(15, 2) NOT NULL DEFAULT 0,
    actual_commission NUMERIC(15, 2) DEFAULT 0,
    raw_payload JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_affiliate_shopee_order UNIQUE (shopee_order_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_sub2 ON affiliate_conversions(sub_id_2);
CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_time ON affiliate_conversions(purchase_time);

-- 9. BẢNG ANALYTICS TỔNG HỢP THEO NGÀY (AFFILIATE_ANALYTICS_DAILY)
CREATE TABLE IF NOT EXISTS affiliate_analytics_daily (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    facebook_post_id UUID REFERENCES affiliate_facebook_posts(id) ON DELETE CASCADE,
    content_id UUID NOT NULL REFERENCES affiliate_content_items(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    reach INT DEFAULT 0,
    impressions INT DEFAULT 0,
    engagement INT DEFAULT 0,
    clicks INT DEFAULT 0,
    orders_count INT DEFAULT 0,
    total_gmv NUMERIC(15, 2) DEFAULT 0,
    total_commission NUMERIC(15, 2) DEFAULT 0,
    epc NUMERIC(10, 4) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_affiliate_post_metric_date UNIQUE (content_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_analytics_date ON affiliate_analytics_daily(metric_date);
CREATE INDEX IF NOT EXISTS idx_affiliate_analytics_content ON affiliate_analytics_daily(content_id);
