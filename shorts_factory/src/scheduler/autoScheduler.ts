import cron from 'node-cron';
import { pool } from '../db/pool';
import { GeminiProvider } from '../providers/geminiProvider';
import { MultiChannelPipelineRunner, ProductionResult } from '../workers/multiChannelPipelineRunner';

interface ActiveChannelInfo {
  id: string;
  name: string;
  genre_key: string;
  default_privacy: string;
}

export class AutoScheduler {
  private multiRunner: MultiChannelPipelineRunner;
  private gemini: GeminiProvider;
  private cronExpression: string;
  private timezone: string;
  private isEnabled: boolean;
  private task: cron.ScheduledTask | null = null;
  private isRunningNow: boolean = false;
  private lastRunAt: string | null = null;
  private lastRunResult: any = null;
  private channelTurnIndex: number = 0;

  constructor(multiRunner: MultiChannelPipelineRunner) {
    this.multiRunner = multiRunner;
    this.gemini = new GeminiProvider();
    // Default: 11:30 AM and 6:30 PM Eastern Time (America/New_York)
    this.cronExpression = process.env.AUTO_SCHEDULE_CRON || '30 11,18 * * *';
    this.timezone = process.env.AUTO_SCHEDULE_TIMEZONE || 'America/New_York';
    this.isEnabled = process.env.AUTO_SCHEDULE_ENABLED !== 'false';
  }

  start(): void {
    if (!this.isEnabled) {
      console.log('[MultiChannelScheduler] Automated scheduler is disabled by config (AUTO_SCHEDULE_ENABLED=false).');
      return;
    }

    console.log('======================================================================');
    console.log('[MultiChannelScheduler] 🚀 Autonomous Multi-Channel Shorts Scheduler Initialized!');
    console.log(`[MultiChannelScheduler] Timezone: ${this.timezone}`);
    console.log(`[MultiChannelScheduler] Schedule Pattern: "${this.cronExpression}"`);
    console.log(`[MultiChannelScheduler] ⏰ Slot 1: 11:30 AM EST (Tier-1 Midday Mobile Browsing | 22:30 VN Time)`);
    console.log(`[MultiChannelScheduler] ⏰ Slot 2: 06:30 PM EST (Tier-1 Evening Primetime | 05:30 VN Time next day)`);
    console.log('======================================================================');

    this.task = cron.schedule(
      this.cronExpression,
      async () => {
        if (this.isRunningNow) {
          console.warn('[MultiChannelScheduler] Previous video pipeline is still running. Skipping this trigger.');
          return;
        }

        console.log(`\n[MultiChannelScheduler] ⏰ Scheduled trigger firing at ${new Date().toISOString()}...`);
        this.isRunningNow = true;
        this.lastRunAt = new Date().toISOString();

        try {
          const result = await this.executeNextChannelPipeline();
          this.lastRunResult = {
            success: true,
            channelId: result.channelId,
            channelName: result.channelName,
            topicTitle: result.title,
            youtubeUrl: result.youtubeUrl,
            timestamp: new Date().toISOString(),
          };
          console.log(`[MultiChannelScheduler] ✅ Successfully produced for ${result.channelName}: "${result.title}"`);
          if (result.youtubeUrl) {
            console.log(`[MultiChannelScheduler] 🔗 Live Shorts URL: ${result.youtubeUrl}`);
          }
        } catch (err: any) {
          console.error('[MultiChannelScheduler] ❌ Scheduled pipeline execution failed:', err);
          this.lastRunResult = {
            success: false,
            error: err.message,
            timestamp: new Date().toISOString(),
          };
        } finally {
          this.isRunningNow = false;
        }
      },
      {
        scheduled: true,
        timezone: this.timezone,
      }
    );
  }

  /**
   * Retrieves active channels that have YouTube credentials configured
   */
  async getActiveChannels(): Promise<ActiveChannelInfo[]> {
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT c.id, c.name, c.genre_key, c.default_privacy
        FROM channels c
        JOIN channel_credentials cc ON cc.channel_id = c.id
        WHERE c.is_active = true
        ORDER BY c.created_at ASC
      `);
      return res.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Ensures the topic backlog for a specific channel and genre is replenished
   */
  async ensureChannelTopicBacklog(channelId: string, genreKey: string): Promise<void> {
    const client = await pool.connect();
    try {
      const res = await client.query(
        "SELECT COUNT(*) as count FROM topics WHERE channel_id = $1 AND status = 'IDEA'",
        [channelId]
      );
      const ideaCount = parseInt(res.rows[0].count, 10);
      console.log(`[MultiChannelScheduler] Channel "${channelId}" (${genreKey}) idea backlog: ${ideaCount}`);

      if (ideaCount < 3) {
        console.log(`[MultiChannelScheduler] Backlog low for ${channelId}. Auto-ideating 4 fresh high-hook topics...`);
        
        // Fetch recently created/used topic titles to avoid duplicating concepts
        const existingRes = await client.query(
          "SELECT title FROM topics WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 60",
          [channelId]
        );
        const existingTitles = existingRes.rows.map((r: any) => r.title);

        const newTopics = await this.gemini.ideateTopicsForGenre(genreKey, 4, existingTitles);

        let insertedCount = 0;
        for (const t of newTopics) {
          const cleanTitle = (t.title || '').trim();
          if (!cleanTitle) continue;

          // Check if this title or very similar already exists in DB
          const duplicateCheck = await client.query(
            "SELECT id FROM topics WHERE channel_id = $1 AND LOWER(TRIM(title)) = LOWER($2)",
            [channelId, cleanTitle]
          );

          if (duplicateCheck.rows.length > 0) {
            console.log(`[MultiChannelScheduler] ⚠️ Skipping duplicate topic title: "${cleanTitle}"`);
            continue;
          }

          await client.query(
            `INSERT INTO topics (
              title, category, historical_period, concept_summary, status, potential_score, channel_id, genre_id, source_origin
            ) VALUES ($1, $2, $3, $4, 'IDEA', $5, $6, $7, 'auto_scheduler')`,
            [
              cleanTitle,
              t.category,
              t.historical_period || 'Classic',
              t.concept_summary,
              t.potential_score || 9.2,
              channelId,
              genreKey,
            ]
          );
          insertedCount++;
        }
        console.log(`[MultiChannelScheduler] Backlog replenished with ${insertedCount} unique topics for ${channelId}.`);
      }
    } catch (err: any) {
      console.error(`[MultiChannelScheduler] Topic backlog error for ${channelId}:`, err.message);
    } finally {
      client.release();
    }
  }

  /**
   * Selects the next channel in round-robin and executes a complete video production & publish cycle
   */
  async executeNextChannelPipeline(): Promise<ProductionResult> {
    const channels = await this.getActiveChannels();
    if (channels.length === 0) {
      throw new Error('No active channels with configured credentials found.');
    }

    // Pick channel by round-robin rotation
    const channel = channels[this.channelTurnIndex % channels.length];
    this.channelTurnIndex++;

    return this.executePipelineForChannel(channel.id);
  }

  /**
   * Executes a complete production & publish cycle for a specific channel
   */
  async executePipelineForChannel(channelId: string): Promise<ProductionResult> {
    const client = await pool.connect();
    let topicToRun: { id: string; title: string; concept_summary: string; category: string } | null = null;
    let genreKey = 'paper_history';

    try {
      const chRes = await client.query('SELECT genre_key, name FROM channels WHERE id = $1', [channelId]);
      if (chRes.rows.length > 0) {
        genreKey = chRes.rows[0].genre_key;
      }

      // 1. Replenish backlog if low
      await this.ensureChannelTopicBacklog(channelId, genreKey);

      // 2. Fetch top scoring IDEA for this channel
      const topicRes = await client.query(
        `SELECT id, title, concept_summary, category
         FROM topics
         WHERE channel_id = $1 AND status = 'IDEA'
         ORDER BY potential_score DESC, created_at ASC
         LIMIT 1`,
        [channelId]
      );

      if (topicRes.rows.length > 0) {
        topicToRun = topicRes.rows[0];
      }
    } finally {
      client.release();
    }

    if (!topicToRun) {
      throw new Error(`No available IDEA topics found for channel ${channelId}`);
    }

    console.log(`[MultiChannelScheduler] Selected Topic for ${channelId}: "${topicToRun.title}"`);

    // 3. Produce and Publish Short
    return await this.multiRunner.produceShort({
      channelId,
      topicId: topicToRun.id,
      content: {
        title: topicToRun.title,
        prompt: topicToRun.concept_summary,
        category: topicToRun.category,
      },
      options: {
        publishYouTube: true,
        uploadCloudinary: true,
        privacyStatus: 'public',
      },
    });
  }

  getStatus() {
    return {
      enabled: this.isEnabled,
      cronExpression: this.cronExpression,
      timezone: this.timezone,
      slots: [
        { name: 'US Lunch Break', timeEST: '11:30 AM EST', timeVN: '22:30 PM ICT', target: 'Tier-1 Midday Mobile Browsing' },
        { name: 'US Prime Time', timeEST: '06:30 PM EST', timeVN: '05:30 AM ICT (+1)', target: 'Tier-1 Evening Leisure & Commute' },
      ],
      isCurrentlyRunning: this.isRunningNow,
      lastRunAt: this.lastRunAt,
      lastRunResult: this.lastRunResult,
      channelTurnIndex: this.channelTurnIndex,
    };
  }
}
