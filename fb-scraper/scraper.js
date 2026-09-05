import { parseCookies } from './auth.js';
import { getPersistentBrowserContext, ensureAuthenticated, checkSessionStatus } from './auth.js';
import { resetAuthAlertState } from './slackAlert.js';

export { parseCookies };

/**
 * Scrape a single group page using an active Playwright page
 */
async function scrapeSingleGroupPage(page, groupUrl, maxPosts, timeoutMs) {
  const items = [];
  let targetUrl = groupUrl.trim();
  if (!targetUrl.includes('sorting_setting=')) {
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${separator}sorting_setting=CHRONOLOGICAL`;
  }

  console.log(`[Scraper] Navigating to: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

  // Wait a bit for dynamic feed hydration
  await page.waitForTimeout(3500);

  // Check for login wall / session expiry
  const currentUrl = page.url();
  const pageTitle = (await page.title().catch(() => '')) || '';
  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') || pageTitle.includes('Đăng nhập') || pageTitle.includes('Log in')) {
    console.error(`[Scraper Auth Error] ⚠️ Facebook Session is INVALID! Navigating to "${groupUrl}" was redirected to: ${currentUrl} (Title: "${pageTitle}").`);
    return [];
  }

  // Click away any close/dismiss popups if present
  try {
    const closeButtons = await page.$$('[aria-label="Đóng"], [aria-label="Close"], div[role="button"][aria-label*="close" i]');
    for (const btn of closeButtons) {
      await btn.click().catch(() => {});
    }
  } catch (_) {}

  // Scroll down 2-3 times to load sufficient posts
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(1500);
  }

  // Extract posts from DOM
  const extractedData = await page.evaluate(({ maxCount, defaultUrl }) => {
    const list = [];
    const seenIds = new Set();

    // Extract group ID from URL (e.g. 1998083910206781)
    const groupMatch = defaultUrl.match(/groups\/([0-9a-zA-Z_.-]+)/);
    const groupId = groupMatch ? groupMatch[1] : '';

    // Find feed container or fallback to articles
    const feed = document.querySelector('[role="feed"]');
    const feedUnits = feed ? Array.from(feed.children) : Array.from(document.querySelectorAll('[role="article"]'));

    for (const unit of feedUnits) {
      if (list.length >= maxCount) break;

      // 1. Extract Post Link & Post ID
      let postUrl = '';
      let postId = '';

      const links = Array.from(unit.querySelectorAll('a[href]'));
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        const match = href.match(/(?:groups\/[0-9a-zA-Z_.-]+\/posts\/|permalink\/|multi_permalinks=|\/posts\/)([0-9]{10,})/);
        if (match && match[1]) {
          postId = match[1];
          postUrl = groupId ? `https://www.facebook.com/groups/${groupId}/posts/${postId}/` : href.split('?')[0];
          break;
        }
      }

      // Check alternative patterns if postId still not found
      if (!postId) {
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          if (href.includes('story_fbid=') || (href.includes('/posts/') && !href.includes('user/'))) {
            const m = href.match(/[0-9]{10,}/);
            if (m) {
              postId = m[0];
              postUrl = groupId ? `https://www.facebook.com/groups/${groupId}/posts/${postId}/` : `https://www.facebook.com/posts/${postId}/`;
              break;
            }
          }
        }
      }

      // If no valid individual post ID / URL, skip
      if (!postId || !postUrl) continue;
      if (seenIds.has(postId)) continue;
      seenIds.add(postId);

      // 2. Extract Author Name
      let authorName = 'Người dùng Facebook';
      const headings = Array.from(unit.querySelectorAll('h2, h3, h4, strong, a[role="link"]'));
      for (const h of headings) {
        const t = (h.innerText || '').trim();
        if (t && t.length > 2 && t.length < 40 && !t.includes('Facebook') && !t.includes('Theo dõi') && !t.includes('giờ') && !t.includes('phút') && !t.includes('ngày')) {
          authorName = t;
          break;
        }
      }

      // 3. Extract Message Text (exclude comments)
      const msgContainers = Array.from(unit.querySelectorAll('[dir="auto"], [data-ad-preview="message"], [data-ad-rendering-role="story_message"]'));
      const textParts = [];
      for (const mc of msgContainers) {
        if (mc.closest('ul') || mc.closest('ol') || mc.closest('[aria-label*="Bình luận"]') || mc.closest('[aria-label*="Comment"]')) continue;
        if (mc.closest('h2, h3, h4, [role="button"]') && mc !== unit) continue;
        const t = (mc.innerText || '').trim();
        if (t && t.length > 10 && !textParts.includes(t)) {
          textParts.push(t);
        }
      }
      const text = textParts.join('\n').trim();

      // Skip posts with too little content
      if (!text || text.length < 15) continue;

      // 4. Extract Timestamp
      let postTime = new Date().toISOString();
      const timeAbbr = unit.querySelector('abbr, [aria-label*="phút"], [aria-label*="giờ"], [aria-label*="ngày"], [aria-label*="hôm"]');
      if (timeAbbr) {
        const rawTime = timeAbbr.getAttribute('aria-label') || timeAbbr.getAttribute('title') || timeAbbr.innerText || '';
        if (rawTime) {
          postTime = new Date().toISOString();
        }
      }

      list.push({
        postId: postId,
        id: postId,
        text: text,
        message: text,
        authorName: authorName,
        username: authorName,
        time: postTime,
        createdAt: postTime,
        url: postUrl,
        permalink: postUrl
      });
    }

    return list;
  }, { maxCount: maxPosts, defaultUrl: targetUrl });

  return extractedData;
}

/**
 * Scrape latest posts from one or multiple Facebook Group URLs using Persistent Browser Profile
 */
export async function scrapeFacebookGroup({
  groupUrl,
  groupUrls,
  cookieString = process.env.FB_COOKIE || '',
  maxPosts = 15,
  timeoutMs = 60000
}) {
  let context = null;
  const allPosts = [];
  const globalSeenIds = new Set();

  // Normalize group URLs into array
  let urls = [];
  if (groupUrls) {
    if (Array.isArray(groupUrls)) {
      urls = groupUrls;
    } else if (typeof groupUrls === 'string') {
      urls = groupUrls.split(',').map(u => u.trim()).filter(Boolean);
    }
  } else if (groupUrl) {
    if (Array.isArray(groupUrl)) {
      urls = groupUrl;
    } else if (typeof groupUrl === 'string') {
      urls = groupUrl.split(',').map(u => u.trim()).filter(Boolean);
    }
  }

  if (urls.length === 0) {
    throw new Error('No valid Facebook Group URLs provided');
  }

  let page = null;

  try {
    console.log('[Scraper] Attaching to Persistent Browser Context...');
    context = await getPersistentBrowserContext();
    page = await context.newPage();

    // Ensure session is authenticated (Persistent profile -> Cookies -> Auto-login)
    const auth = await ensureAuthenticated(page, {
      cookieString,
      targetUrl: urls[0]
    });

    if (!auth.authenticated) {
      console.warn('[Scraper] Aborting scrape: Session is not authenticated.');
      return [];
    }

    for (const url of urls) {
      try {
        console.log(`[Scraper] Scraping group: ${url}`);
        const groupPosts = await scrapeSingleGroupPage(page, url, maxPosts, timeoutMs);
        for (const p of groupPosts) {
          if (!globalSeenIds.has(p.postId)) {
            globalSeenIds.add(p.postId);
            allPosts.push(p);
          }
        }
      } catch (groupErr) {
        console.error(`[Scraper Error] Failed to scrape group ${url}:`, groupErr.message);
      }
    }

    console.log(`[Scraper] Total extracted ${allPosts.length} posts across ${urls.length} groups.`);
    if (allPosts.length > 0) {
      resetAuthAlertState();
    }
    return allPosts;

  } catch (err) {
    console.error(`[Scraper Global Error]:`, err);
    throw err;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}
