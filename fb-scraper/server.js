import express from 'express';
import { scrapeFacebookGroup } from './scraper.js';
import { publishFacebookPost } from './poster.js';
import { postCommentToFacebook } from './commenter.js';
import { getPersistentBrowserContext, checkSessionStatus, performAutoLogin, ensureAuthenticated } from './auth.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Check current authentication status of persistent profile
app.get('/auth/status', async (req, res) => {
  let context = null;
  try {
    context = await getPersistentBrowserContext();
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const status = await checkSessionStatus(page);

    return res.json({
      success: true,
      hasEmailConfigured: Boolean(process.env.FB_EMAIL),
      has2FAConfigured: Boolean(process.env.FB_2FA_SECRET),
      hasCookieConfigured: Boolean(process.env.FB_COOKIE),
      ...status
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
});

// Trigger manual or credential-based login to refresh persistent session
app.post('/auth/login', async (req, res) => {
  const { email, password, twoFactorSecret, cookie } = req.body || {};
  let context = null;

  try {
    context = await getPersistentBrowserContext();
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    if (cookie) {
      const auth = await ensureAuthenticated(page, { cookieString: cookie });
      return res.json({
        success: auth.authenticated,
        method: 'cookie',
        status: auth
      });
    }

    const loginResult = await performAutoLogin(page, { email, password, twoFactorSecret });
    return res.json(loginResult);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
});

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const { groupUrl, groupUrls, maxPosts = 15, cookie } = req.body;

  const targetGroupUrls = groupUrls || groupUrl || process.env.FB_GROUP_URLS || process.env.FB_GROUP_URL;
  if (!targetGroupUrls) {
    return res.status(400).json({
      error: 'Missing required field: groupUrl or groupUrls'
    });
  }

  const cookieString = cookie || process.env.FB_COOKIE || '';

  console.log(`[API] Received scrape request for: ${JSON.stringify(targetGroupUrls)} (max per group: ${maxPosts})`);

  try {
    const posts = await scrapeFacebookGroup({
      groupUrls: targetGroupUrls,
      cookieString,
      maxPosts: Number(maxPosts) || 15
    });

    return res.json(posts);
  } catch (error) {
    console.error(`[API Error] Failed to scrape:`, error.message);
    return res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Auto-comment endpoint
app.post('/comment', async (req, res) => {
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {}
  }

  const postUrl = body.postUrl || body.permalink || body.url || '';
  const commentText = body.commentText || body.ai_comment || body.comment || body.text || body.message || '';
  const cookieString = body.cookie || process.env.FB_COOKIE || '';

  if (!postUrl || !commentText) {
    return res.status(400).json({
      error: 'Missing required fields: postUrl and commentText'
    });
  }

  console.log(`[API] Received comment request for post: ${postUrl}`);

  try {
    const result = await postCommentToFacebook({
      postUrl,
      commentText,
      cookieString
    });

    return res.json(result);
  } catch (error) {
    console.error(`[API Error] Failed to comment:`, error.message);
    return res.json({
      success: false,
      error: error.message
    });
  }
});

// Auto-post organic post endpoint
app.post('/post', async (req, res) => {
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {}
  }

  const postText = body.postText || body.text || body.content || body.message || body.body || '';
  const targetUrl = body.targetUrl || body.groupUrl || body.url || '';
  const imagePath = body.imagePath || body.image || '';
  const cookieString = body.cookie || process.env.FB_COOKIE || '';

  if (!postText) {
    return res.status(400).json({
      error: 'Missing required field: postText (or text/content)'
    });
  }

  console.log(`[API] Received publish post request for destination: ${targetUrl || 'default group'}`);

  try {
    const result = await publishFacebookPost({
      postText,
      targetUrl,
      imagePath,
      cookieString
    });

    return res.json(result);
  } catch (error) {
    console.error(`[API Error] Failed to publish post:`, error.message);
    return res.json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] fb-scraper microservice listening on http://0.0.0.0:${PORT}`);
});
