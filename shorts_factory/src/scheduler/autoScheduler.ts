import cron from 'node-cron';
import { pool } from '../db/pool';
import { GeminiProvider } from '../providers/geminiProvider';
import { PipelineRunner } from '../workers/pipelineRunner';

export class AutoScheduler {
  private runner: PipelineRunner;
  private gemini: GeminiProvider;
  private cronExpression: string;
  private timezone: string;
  private isEnabled: boolean;
  private task: cron.ScheduledTask | null = null;
  private isRunningNow: boolean = false;
  private lastRunAt: string | null = null;
  private lastRunResult: any = null;

  constructor(runner: PipelineRunner) {
    this.runner = runner;
    this.gemini = new GeminiProvider();
    // Default: 11:30 AM and 6:30 PM Eastern Time (America/New_York)
    this.cronExpression = process.env.AUTO_SCHEDULE_CRON || '30 11,18 * * *';
    this.timezone = process.env.AUTO_SCHEDULE_TIMEZONE || 'America/New_York';
    this.isEnabled = process.env.AUTO_SCHEDULE_ENABLED !== 'false';
  }

  start(): void {
    if (!this.isEnabled) {
      console.log('[AutoScheduler] Automated scheduler is disabled by config (AUTO_SCHEDULE_ENABLED=false).');
      return;
    }

    console.log('======================================================================');
    console.log('[AutoScheduler] 🚀 Autonomous 2x Daily Shorts Scheduler Initialized!');
    console.log(`[AutoScheduler] Timezone: ${this.timezone}`);
    console.log(`[AutoScheduler] Schedule Pattern: "${this.cronExpression}"`);
    console.log(`[AutoScheduler] ⏰ Slot 1: 11:30 AM EST (US Lunchtime Peak | 22:30 VN Time)`);
    console.log(`[AutoScheduler] ⏰ Slot 2: 06:30 PM EST (US Evening Primetime | 05:30 VN Time next day)`);
    console.log('======================================================================');

    this.task = cron.schedule(
      this.cronExpression,
      async () => {
        if (this.isRunningNow) {
          console.warn('[AutoScheduler] Previous video pipeline is still running. Skipping this trigger.');
          return;
        }

        console.log(`\n[AutoScheduler] ⏰ Scheduled trigger firing at ${new Date().toISOString()}...`);
        this.isRunningNow = true;
        this.lastRunAt = new Date().toISOString();

        try {
          // 1. Ensure topics backlog is healthy
          await this.ensureTopicBacklog();

          // 2. Execute full video pipeline
          const result = await this.runner.runFullPipelineForTopic();
          this.lastRunResult = {
            success: true,
            topicTitle: result.title,
            youtubeUrl: result.youtubeUrl,
            timestamp: new Date().toISOString(),
          };
          console.log(`[AutoScheduler] ✅ Successfully produced and published video: ${result.title}`);
          if (result.youtubeUrl) {
            console.log(`[AutoScheduler] 🔗 Live Shorts URL: ${result.youtubeUrl}`);
          }
        } catch (err: any) {
          console.error('[AutoScheduler] ❌ Scheduled pipeline execution failed:', err);
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

  private async ensureTopicBacklog(): Promise<void> {
    const client = await pool.connect();
    try {
      const res = await client.query("SELECT COUNT(*) as count FROM topics WHERE status = 'IDEA'");
      const ideaCount = parseInt(res.rows[0].count, 10);
      console.log(`[AutoScheduler] Current available topics in backlog: ${ideaCount}`);

      if (ideaCount < 3) {
        console.log(`[AutoScheduler] Backlog low (< 3). Auto-ideating 5 new high-hook topics with Gemini...`);
        const newTopics = await this.gemini.ideateHistoricalTopics(5);
        for (const t of newTopics) {
          await client.query(
            `INSERT INTO topics (
              title, category, historical_period, concept_summary, status, potential_score, source_origin
            ) VALUES ($1, $2, $3, $4, 'IDEA', $5, 'auto_scheduler')
            ON CONFLICT DO NOTHING`,
            [
              t.title,
              t.category,
              t.historical_period,
              t.concept_summary,
              t.potential_score || 9.0,
            ]
          );
        }
        console.log(`[AutoScheduler] Backlog replenished with ${newTopics.length} fresh historical topics.`);
      }
    } catch (err) {
      console.error('[AutoScheduler] Topic backlog replenish warning:', err);
    } finally {
      client.release();
    }
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
    };
  }
}
