/**
 * Slack Alert Manager for Facebook Scraper
 * Sends notifications to Slack when Facebook session/cookie expires or auth errors occur.
 * Includes throttling to prevent spamming Slack on every 5-minute cron run.
 */

const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown between alerts
let lastAuthAlertTime = 0;
let hasActiveAuthError = false;

/**
 * Send Slack alert when FB session/cookie is expired or redirected to login
 */
export async function sendSlackAuthAlert({
  groupUrl = '',
  currentUrl = '',
  pageTitle = '',
  reason = 'Phiên đăng nhập Facebook hết hạn hoặc cookie không hợp lệ',
  force = false
} = {}) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;

  if (!token || !channel) {
    console.warn('[Slack Alert] SLACK_BOT_TOKEN or SLACK_CHANNEL_ID not set. Skipping Slack notification.');
    return false;
  }

  const now = Date.now();
  if (!force && lastAuthAlertTime > 0 && now - lastAuthAlertTime < ALERT_COOLDOWN_MS) {
    const elapsedMinutes = Math.round((now - lastAuthAlertTime) / 60000);
    console.log(`[Slack Alert] Auth alert throttled (last sent ${elapsedMinutes}m ago). Next alert possible in ${Math.round((ALERT_COOLDOWN_MS - (now - lastAuthAlertTime)) / 60000)}m.`);
    return false;
  }

  const formattedTime = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false
  });

  const payload = {
    channel,
    unfurl_links: false,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚨 [CẢNH BÁO] Cookie Facebook đã hết hạn!',
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*⏰ Thời gian phát hiện:*\n${formattedTime}`
          },
          {
            type: 'mrkdwn',
            text: `*📍 Tình trạng:*\nBị chuyển hướng Login / Checkpoint`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🔗 Nhóm mục tiêu:* <${groupUrl || 'https://www.facebook.com'}|${groupUrl || 'Facebook Group'}>\n*➡️ Chuyển hướng đến:* \`${currentUrl || 'https://www.facebook.com/login'}\`\n*📄 Tiêu đề trang:* ${pageTitle ? `"${pageTitle}"` : 'Facebook'}`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⚠️ *Ảnh hưởng:* Toàn bộ tiến trình quét bài viết và tương tác tự động đang bị tạm dừng do Facebook yêu cầu đăng nhập.\n\n💡 *Cách xử lý nhanh:*\n1. Mở Facebook trên trình duyệt và copy chuỗi cookie mới (\`c_user\`, \`xs\`, \`datr\`, \`sb\`, \`fr\`).\n2. Cập nhật biến \`FB_COOKIE\` trong file \`/opt/n8n/.env\` trên server.\n3. Chạy lệnh: \`docker compose up -d --force-recreate fb-scraper\` để kích hoạt lại.`
        }
      }
    ]
  };

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    const resData = await res.json();
    if (resData.ok) {
      lastAuthAlertTime = now;
      hasActiveAuthError = true;
      console.log(`[Slack Alert] ⚠️ Sent auth expiry alert to Slack channel: ${channel}`);
      return true;
    } else {
      console.error(`[Slack Alert Error] Failed to post message to Slack:`, resData.error);
      return false;
    }
  } catch (err) {
    console.error(`[Slack Alert Error] Network error when sending to Slack:`, err.message);
    return false;
  }
}

/**
 * Reset alert throttle state when scraping succeeds
 */
export function resetAuthAlertState() {
  if (hasActiveAuthError) {
    console.log('[Slack Alert] FB session recovered / Scraping successful. Resetting auth alert throttle state.');
  }
  hasActiveAuthError = false;
  lastAuthAlertTime = 0;
}
