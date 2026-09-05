-- S.T.A.R.K AI GROWTH INTELLIGENCE PLATFORM — DATABASE INITIALIZATION SCHEMA (v1.0)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Market Signals (Raw Ingested Data)
CREATE TABLE IF NOT EXISTS market_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(50) NOT NULL,
    source_url TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    cleaned_text TEXT NOT NULL,
    category VARCHAR(100),
    confidence_score NUMERIC(5,2) DEFAULT 80.0,
    detected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_signals_source_date ON market_signals(source, detected_at DESC);

-- 2. Trends (Classified Market Trends)
CREATE TABLE IF NOT EXISTS trends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic VARCHAR(255) NOT NULL,
    classification VARCHAR(50) NOT NULL, -- 'EMERGING', 'GROWING', 'STABLE', 'DECLINING', 'DEAD'
    growth_rate_pct NUMERIC(6,2) DEFAULT 0,
    search_volume_index INT DEFAULT 0,
    commercial_intent_score NUMERIC(5,2) DEFAULT 50.0,
    stark_relevance_score NUMERIC(5,2) DEFAULT 50.0,
    trend_score NUMERIC(5,2) NOT NULL,
    first_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trends_score ON trends(trend_score DESC);

-- 3. Customer Pain Points
CREATE TABLE IF NOT EXISTS pain_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_name VARCHAR(150) NOT NULL,
    industry VARCHAR(100) NOT NULL,
    pain_description TEXT NOT NULL,
    signals_count INT DEFAULT 1,
    urgency_level VARCHAR(20) DEFAULT 'MEDIUM',
    evidence_examples JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Opportunities (Core Engine)
CREATE TABLE IF NOT EXISTS opportunities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    market VARCHAR(50) DEFAULT 'VN',
    target_audience TEXT NOT NULL,
    target_industry VARCHAR(100),
    core_problem TEXT NOT NULL,
    trend_score NUMERIC(5,2) NOT NULL,
    commercial_score NUMERIC(5,2) NOT NULL,
    competition_gap_score NUMERIC(5,2) NOT NULL,
    opportunity_score NUMERIC(5,2) NOT NULL,
    recommended_offer TEXT NOT NULL,
    recommended_channel VARCHAR(50) NOT NULL,
    estimated_deal_value_vnd NUMERIC(15,2) DEFAULT 50000000,
    status VARCHAR(50) DEFAULT 'IDENTIFIED',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(opportunity_score DESC);

-- 5. Content Repository (Max 2 posts/day guardrail)
CREATE TABLE IF NOT EXISTS content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    channel VARCHAR(50) NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    hook TEXT NOT NULL,
    body TEXT NOT NULL,
    call_to_action TEXT NOT NULL,
    creative_brief JSONB DEFAULT '{}'::jsonb,
    quality_score NUMERIC(5,2) DEFAULT 80.0,
    scheduled_for TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'DRAFT',
    published_post_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_content_channel_date ON content(channel, published_at);

-- 6. Campaigns (Ad Strategy Proposals)
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    objective VARCHAR(50) NOT NULL,
    target_audience_spec JSONB NOT NULL,
    ad_copies JSONB NOT NULL,
    proposed_daily_budget_vnd NUMERIC(15,2) NOT NULL,
    max_total_budget_vnd NUMERIC(15,2) NOT NULL,
    expected_cpl_vnd NUMERIC(15,2),
    status VARCHAR(50) DEFAULT 'PROPOSED',
    approved_by VARCHAR(100),
    approved_at TIMESTAMPTZ,
    platform_campaign_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 7. Ad Metrics (Time-Series)
CREATE TABLE IF NOT EXISTS ad_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    recorded_date DATE NOT NULL,
    impressions INT DEFAULT 0,
    clicks INT DEFAULT 0,
    spend_vnd NUMERIC(15,2) DEFAULT 0,
    leads_count INT DEFAULT 0,
    ctr NUMERIC(5,2) DEFAULT 0,
    cpc_vnd NUMERIC(15,2) DEFAULT 0,
    cpl_vnd NUMERIC(15,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, recorded_date)
);

-- 8. Leads & ICP Scoring
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    source VARCHAR(50) NOT NULL,
    full_name VARCHAR(150),
    company_name VARCHAR(200),
    email VARCHAR(150),
    phone VARCHAR(50),
    website_url TEXT,
    industry VARCHAR(100),
    project_requirements TEXT,
    estimated_budget_vnd NUMERIC(15,2),
    lead_score INT CHECK (lead_score >= 0 AND lead_score <= 100),
    classification VARCHAR(20) DEFAULT 'WARM',
    sales_brief JSONB DEFAULT '{}'::jsonb,
    crm_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(lead_score DESC);

-- 9. Conversions (Sales Closed & Revenue)
CREATE TABLE IF NOT EXISTS conversions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    deal_name VARCHAR(255) NOT NULL,
    deal_value_vnd NUMERIC(15,2) NOT NULL,
    services_contracted TEXT[],
    closed_at TIMESTAMPTZ NOT NULL,
    roi_multiple NUMERIC(6,2),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 10. Knowledge Documents (Self-learning repository)
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 11. Audit Logs (Human-in-the-Loop & System Actions)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    performed_by VARCHAR(100) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
