import { config } from '../config';

export interface SlackNotificationPayload {
  shortId: string;
  title: string;
  category: string;
  durationSec: number;
  overallStatus: 'PASS' | 'WARNING' | 'FAIL';
  styleAdherenceScore: number;
  rejectionReasons: string[];
  outputPath: string;
  youtubeUrl?: string;
}

export class SlackNotifier {
  private botToken: string;
  private channelId: string;

  constructor() {
    this.botToken = config.slack.botToken;
    this.channelId = config.slack.channelId;
  }

  async sendQcReport(data: SlackNotificationPayload): Promise<void> {
    if (!this.botToken || !this.channelId) {
      console.warn('[SlackNotifier] SLACK_BOT_TOKEN or SLACK_CHANNEL_ID not configured. Skipping Slack notification.');
      return;
    }

    const statusIcon = data.overallStatus === 'PASS' ? '✅ PASS' : data.overallStatus === 'WARNING' ? '⚠️ WARNING' : '❌ FAIL';
    const adherencePct = (data.styleAdherenceScore * 100).toFixed(0);

    const fields: any[] = [
      { type: 'mrkdwn', text: `*Topic:*\n${data.title}` },
      { type: 'mrkdwn', text: `*Category:*\n${data.category.toUpperCase()}` },
      { type: 'mrkdwn', text: `*Duration:*\n${data.durationSec.toFixed(1)}s (1080x1920 9:16)` },
      { type: 'mrkdwn', text: `*QC Decision:*\n${statusIcon}` },
      { type: 'mrkdwn', text: `*Style Adherence:*\n${adherencePct}% (Papercraft Diorama)` },
      { type: 'mrkdwn', text: `*Output File:*\n\`${data.outputPath}\`` },
    ];

    if (data.youtubeUrl) {
      fields.push({
        type: 'mrkdwn',
        text: `*YouTube Shorts:*\n<${data.youtubeUrl}|▶️ Watch Video>`,
      });
    }

    const blocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🎬 [Paper Theater World] New Short Video Ready',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields,
      },
    ];

    if (data.rejectionReasons.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚠️ Quality Issues Detected:*\n• ${data.rejectionReasons.join('\n• ')}`,
        },
      });
    }

    const actionElements: any[] = [];
    if (data.youtubeUrl) {
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: '▶️ Watch on YouTube', emoji: true },
        url: data.youtubeUrl,
        style: 'primary',
      });
    }

    actionElements.push(
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ Approve', emoji: true },
        value: JSON.stringify({ action: 'APPROVE', shortId: data.shortId }),
        action_id: 'approve_short',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '🔄 Regenerate', emoji: true },
        value: JSON.stringify({ action: 'REGENERATE', shortId: data.shortId }),
        action_id: 'regenerate_short',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '❌ Discard', emoji: true },
        style: 'danger',
        value: JSON.stringify({ action: 'DISCARD', shortId: data.shortId }),
        action_id: 'discard_short',
      }
    );

    // Add interactive action buttons
    blocks.push({
      type: 'actions',
      elements: actionElements,
    });

    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({
          channel: this.channelId,
          blocks,
          text: `🎬 [Paper Theater World] Short Rendered: "${data.title}" - Status: ${statusIcon}`,
        }),
      });

      const resJson = await response.json();
      if (!resJson.ok) {
        console.error('[SlackNotifier] Slack API Error:', resJson.error);
      } else {
        console.log(`[SlackNotifier] Successfully dispatched QC notification to Slack channel ${this.channelId}`);
      }
    } catch (err) {
      console.error('[SlackNotifier] Failed to send Slack notification:', err);
    }
  }
}
