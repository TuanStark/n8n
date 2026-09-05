import { getPersistentBrowserContext, ensureAuthenticated } from './auth.js';

/**
 * Cloak and sanitize URLs in comments to avoid Facebook spam & link filtering
 */
export function formatSafeCommentText(text) {
  if (!text) return '';
  return text.replace(/https?:\/\/([^\s]+)/gi, (match, url) => {
    let clean = url.replace(/\/$/, '');
    // e.g. company-plum-rho.vercel.app -> company-plum-rho . vercel . app
    clean = clean.replace(/\./g, ' . ');
    return `${clean} (bỏ dấu cách)`;
  });
}

/**
 * Post a comment to a Facebook Post using Persistent Browser Context
 */
export async function postCommentToFacebook({
  postUrl,
  commentText,
  cookieString = process.env.FB_COOKIE || '',
  timeoutMs = 45000
}) {
  if (!postUrl) {
    throw new Error('Missing postUrl');
  }
  if (!commentText) {
    throw new Error('Missing commentText');
  }

  // Ensure safe, un-shadowbannable comment content
  const sanitizedComment = formatSafeCommentText(commentText);

  // Ensure postUrl is an actual individual post URL, not a generic feed / group root
  if (!postUrl.includes('/posts/') && !postUrl.includes('/permalink/') && !postUrl.includes('story_fbid=') && !postUrl.match(/\d{10,}/)) {
    throw new Error(`Cannot comment: "${postUrl}" is not an individual post URL.`);
  }

  let context = null;
  let page = null;

  try {
    console.log('[Commenter] Attaching to Persistent Browser Context...');
    context = await getPersistentBrowserContext();
    page = await context.newPage();

    console.log(`[Commenter] Navigating directly to post: ${postUrl}`);
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Check if redirected to login
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      console.log('[Commenter] Detected login wall on post navigation, ensuring authentication...');
      const auth = await ensureAuthenticated(page, {
        cookieString,
        targetUrl: postUrl
      });
      if (!auth.authenticated) {
        throw new Error('Cannot comment: Facebook session is not authenticated.');
      }
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    }

    // Wait for page hydration
    await page.waitForTimeout(2500);

    // Dismiss any modal/dialogs if present
    try {
      const closeButtons = await page.$$('[aria-label="Đóng"], [aria-label="Close"], div[role="button"][aria-label*="close" i]');
      for (const btn of closeButtons) {
        await btn.click().catch(() => {});
      }
    } catch (_) {}

    // Scroll down slightly to bring comment box into view
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(1000);

    // ── Check if post already contains our comment/portfolio ─────────────────
    const pageContent = await page.evaluate(() => document.body.innerText || '');
    if (
      pageContent.includes('company-plum-rho') ||
      pageContent.includes('company-plum-rho . vercel . app') ||
      pageContent.includes('company-plum-rho.vercel.app') ||
      pageContent.includes('Đội ngũ kỹ thuật chuyên thiết kế & phát triển website')
    ) {
      console.log(`[Commenter] Post ${postUrl} ALREADY contains our comment / portfolio. Skipping duplicate comment.`);
      return {
        success: true,
        alreadyCommented: true,
        postUrl,
        comment: 'Bài viết đã có bình luận của bạn từ trước',
        timestamp: new Date().toISOString()
      };
    }

    // Common Facebook comment textbox selectors
    const commentSelectors = [
      'div[role="textbox"][contenteditable="true"]',
      'div[data-lexical-editor="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'div[aria-label*="Viết bình luận" i]',
      'div[aria-label*="Write a comment" i]',
      'div[aria-label*="Bình luận dưới tên" i]',
      'div[aria-label*="Comment as" i]',
      'form div[role="textbox"]',
      'textarea[aria-label*="bình luận" i]'
    ];

    let commentBox = null;
    for (const selector of commentSelectors) {
      try {
        commentBox = await page.$(selector);
        if (commentBox && await commentBox.isVisible()) {
          console.log(`[Commenter] Found comment box with selector: ${selector}`);
          break;
        }
      } catch (_) {}
    }

    if (!commentBox) {
      // Try to click "Viết bình luận" or comment action buttons to open comment input
      const clickTriggers = [
        'div[role="button"][aria-label*="Bình luận" i]',
        'div[role="button"][aria-label*="Comment" i]',
        'span[dir="auto"]:has-text("Viết bình luận")',
        'div[aria-label*="Viết câu trả lời" i]'
      ];
      for (const trig of clickTriggers) {
        try {
          const btn = await page.$(trig);
          if (btn && await btn.isVisible()) {
            console.log(`[Commenter] Clicking comment trigger button: ${trig}`);
            await btn.click().catch(() => {});
            await page.waitForTimeout(1500);
            break;
          }
        } catch (_) {}
      }

      // Re-scan comment selectors after trigger click
      for (const selector of commentSelectors) {
        try {
          commentBox = await page.$(selector);
          if (commentBox && await commentBox.isVisible()) {
            console.log(`[Commenter] Found comment box after trigger: ${selector}`);
            break;
          }
        } catch (_) {}
      }
    }

    if (!commentBox) {
      const pageDiagnostics = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('[role="button"], a[role="link"], [aria-label]'))
          .map(b => (b.getAttribute('aria-label') || b.innerText || '').trim())
          .filter(t => t.length > 0 && t.length < 50);
        const textboxes = Array.from(document.querySelectorAll('[role="textbox"], [contenteditable], textarea, input'))
          .map(t => ({
            tag: t.tagName,
            aria: t.getAttribute('aria-label'),
            role: t.getAttribute('role'),
            ce: t.getAttribute('contenteditable')
          }));
        return {
          title: document.title,
          url: window.location.href,
          sampleButtons: buttons.slice(0, 25),
          textboxes
        };
      }).catch(() => null);

      console.warn(`[Commenter] Comment textbox not found. Diagnostics:`, JSON.stringify(pageDiagnostics, null, 2));

      return {
        success: false,
        message: 'Khung bình luận không khả dụng (bài viết bị khóa comment hoặc tài khoản chưa tham gia nhóm)',
        postUrl,
        timestamp: new Date().toISOString()
      };
    }

    // Scroll into view & Focus
    await commentBox.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    await commentBox.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);

    // Type text smoothly
    console.log(`[Commenter] Typing comment content (sanitized safe text)...`);
    const lines = sanitizedComment.trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) {
        await page.keyboard.insertText(lines[i]);
      }
      if (i < lines.length - 1) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        await page.waitForTimeout(80);
      }
    }

    await page.waitForTimeout(800);

    // Submit comment
    console.log(`[Commenter] Submitting comment...`);
    await page.keyboard.press('Enter');

    // Also look for send/submit button if Enter alone doesn't trigger
    await page.waitForTimeout(1500);
    try {
      const sendButton = await page.$('div[aria-label*="Bình luận"][role="button"][tabindex="0"], div[aria-label*="Gửi"][role="button"], div[aria-label*="Send"][role="button"]');
      if (sendButton && await sendButton.isVisible()) {
        await sendButton.click().catch(() => {});
      }
    } catch (_) {}

    await page.waitForTimeout(2000);

    console.log(`[Commenter] Comment submitted successfully for post: ${postUrl}`);

    return {
      success: true,
      postUrl,
      comment: sanitizedComment.trim(),
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    console.error(`[Commenter Error]:`, err.message);
    throw err;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}
