import { chromium } from 'playwright';
import { authenticator } from 'otplib';
import { sendSlackAuthAlert, resetAuthAlertState } from './slackAlert.js';

export const USER_DATA_DIR = process.env.FB_USER_DATA_DIR || '/app/browser_data';

/**
 * Parse cookie string (format: "c_user=...; xs=...;" or JSON) into Playwright cookie objects
 */
export function parseCookies(cookieInput, domain = '.facebook.com') {
  if (!cookieInput) return [];

  if (typeof cookieInput === 'string') {
    const trimmed = cookieInput.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        // Fall back to string parsing
      }
    }

    return trimmed
      .split(';')
      .map(pair => pair.trim())
      .filter(pair => pair.includes('='))
      .map(pair => {
        const idx = pair.indexOf('=');
        const name = pair.substring(0, idx).trim();
        const value = pair.substring(idx + 1).trim();
        return {
          name,
          value,
          domain,
          path: '/',
          secure: true,
          sameSite: 'Lax',
        };
      })
      .filter(c => c.name && c.value);
  }

  if (Array.isArray(cookieInput)) {
    return cookieInput.map(c => ({
      domain: c.domain || domain,
      path: c.path || '/',
      secure: c.secure !== undefined ? c.secure : true,
      ...c
    }));
  }

  return [];
}


const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,800'
];

const BROWSER_OPTIONS = {
  viewport: { width: 1280, height: 800 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'vi-VN',
  timezoneId: 'Asia/Ho_Chi_Minh'
};

let sharedContext = null;
let launchLock = null;

/**
 * Launch or attach to a Persistent Browser Context (singleton instance persisted on disk)
 */
export async function getPersistentBrowserContext(customDir = null) {
  const dir = customDir || USER_DATA_DIR;

  if (sharedContext) {
    try {
      if (sharedContext.pages) {
        return sharedContext;
      }
    } catch (_) {
      sharedContext = null;
    }
  }

  if (launchLock) {
    return launchLock;
  }

  launchLock = (async () => {
    try {
      console.log(`[Browser] Attaching Persistent Context at ${dir}...`);
      sharedContext = await chromium.launchPersistentContext(dir, {
        headless: true,
        args: BROWSER_ARGS,
        ...BROWSER_OPTIONS
      });
      sharedContext.on('close', () => {
        console.log('[Browser] Persistent context closed.');
        sharedContext = null;
      });
      return sharedContext;
    } finally {
      launchLock = null;
    }
  })();

  return launchLock;
}

/**
 * Check if the current page/session is authenticated on Facebook
 */
export async function checkSessionStatus(page) {
  const currentUrl = page.url();
  const pageTitle = (await page.title().catch(() => '')) || '';

  const isLoginWall =
    currentUrl.includes('/login') ||
    currentUrl.includes('/checkpoint') ||
    pageTitle.includes('Đăng nhập') ||
    pageTitle.includes('Log in') ||
    pageTitle.includes('Log In');

  if (isLoginWall) {
    return {
      isLoggedIn: false,
      currentUrl,
      pageTitle,
      user: null
    };
  }

  // Verify profile presence if we are on a generic page
  const hasProfile = await page.evaluate(() => {
    const profileEl = document.querySelector(
      '[aria-label="Trang cá nhân của bạn"], [aria-label="Your profile"], [aria-label="Tài khoản"], [aria-label="Account"], [role="feed"], [role="navigation"]'
    );
    return Boolean(profileEl);
  }).catch(() => false);

  return {
    isLoggedIn: !isLoginWall && hasProfile,
    currentUrl,
    pageTitle,
    user: hasProfile ? 'Active Facebook User' : null
  };
}

/**
 * Perform automated login using Email + Password (+ optional 2FA TOTP secret)
 */
export async function performAutoLogin(page, credentials = {}) {
  const email = credentials.email || process.env.FB_EMAIL;
  const password = credentials.password || process.env.FB_PASSWORD;
  const twoFactorSecret = credentials.twoFactorSecret || process.env.FB_2FA_SECRET;

  if (!email || !password) {
    console.log('[Auth] No FB_EMAIL and FB_PASSWORD configured for auto-login.');
    return { success: false, reason: 'Missing credentials' };
  }

  console.log(`[Auth] Attempting automated Facebook login for account: ${email.substring(0, 3)}***`);

  try {
    // 1. Navigate to Facebook Login page
    await page.goto('https://www.facebook.com/login.php', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    await page.waitForTimeout(2500);

    // 2. Dismiss cookie consent / banners
    try {
      const consentSelectors = [
        '[data-cookiebanner="accept_button"]',
        'button[title*="Allow"]',
        'button[title*="Accept"]',
        'button[title*="Chấp nhận"]',
        'button:has-text("Allow all cookies")',
        'button:has-text("Chấp nhận tất cả cookie")',
        'button:has-text("Cho phép tất cả cookie")',
        'div[role="button"][aria-label*="Đóng" i]',
        'div[role="button"][aria-label*="Close" i]'
      ];
      for (const sel of consentSelectors) {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          await btn.click().catch(() => { });
          await page.waitForTimeout(1000);
        }
      }
    } catch (_) { }

    // 3. Find and fill Email / Phone
    const emailSelectors = [
      'input[name="email"]',
      'input[id="email"]',
      'input[type="email"]',
      'input[type="text"]',
      'input[autocomplete="username"]',
      'input[placeholder*="Email" i]',
      'input[placeholder*="di động" i]',
      'input[placeholder*="phone" i]'
    ];

    let emailInput = null;
    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          emailInput = el;
          break;
        }
      } catch (_) { }
    }

    if (emailInput) {
      await emailInput.click({ force: true }).catch(() => { });
      await emailInput.fill('');
      await emailInput.fill(email);
      console.log('[Auth] Filled email/phone field.');
    } else {
      console.log('[Auth] Email field not visible (might be on password-only re-auth screen).');
    }

    // 4. Find and fill Password
    const passSelectors = [
      'input[name="pass"]',
      'input[id="pass"]',
      'input[type="password"]',
      'input[autocomplete="current-password"]',
      'input[placeholder*="Mật khẩu" i]',
      'input[placeholder*="Password" i]'
    ];

    let passInput = null;
    for (const sel of passSelectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          passInput = el;
          break;
        }
      } catch (_) { }
    }

    if (passInput) {
      await passInput.click({ force: true }).catch(() => { });
      await passInput.fill('');
      await passInput.fill(password);
      console.log('[Auth] Filled password field.');
    } else {
      throw new Error('Could not find password input on Facebook login page.');
    }

    await page.waitForTimeout(500);

    // 5. Submit Login
    const submitSelectors = [
      'button[name="login"]',
      'button[id="loginbutton"]',
      'button[type="submit"]',
      'div[aria-label*="Đăng nhập" i][role="button"]',
      'div[aria-label*="Log in" i][role="button"]',
      'input[type="submit"]'
    ];

    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          await btn.click({ force: true });
          submitted = true;
          break;
        }
      } catch (_) { }
    }

    if (!submitted) {
      await page.keyboard.press('Enter');
    }

    console.log('[Auth] Submitted login credentials, waiting for response...');
    await page.waitForNavigation({ timeout: 20000 }).catch(() => { });
    await page.waitForTimeout(4000);

    // 6. Handle Checkpoints (Save Browser, Location verification, Was this you?, Approvals, 2FA)
    let currentUrl = page.url();
    if (currentUrl.includes('checkpoint') || currentUrl.includes('two_step_verification')) {
      console.log('[Auth] Checkpoint screen detected on Facebook. Attempting automated resolution...');

      const checkpointBodyText = await page.evaluate(() => (document.body.innerText || '').substring(0, 800)).catch(() => '');
      console.log('[Auth Checkpoint Message]:\n' + checkpointBodyText);

      // Loop up to 4 times to click through multi-step confirmation checkpoints
      for (let step = 0; step < 4; step++) {
        await page.waitForTimeout(2500);
        currentUrl = page.url();
        if (!currentUrl.includes('checkpoint') && !currentUrl.includes('two_step_verification')) {
          console.log('[Auth] Successfully resolved and exited checkpoint screen!');
          break;
        }

        // Check if there is an OTP/2FA code input
        const otpSelectors = [
          'input[name="approvals_code"]',
          'input[type="number"]',
          'input[type="text"][autocomplete*="one-time-code"]',
          'input[id="approvals_code"]',
          'input[placeholder*="Mã" i]',
          'input[placeholder*="Code" i]'
        ];

        let otpInput = null;
        for (const sel of otpSelectors) {
          try {
            const el = await page.$(sel);
            if (el && await el.isVisible()) {
              otpInput = el;
              break;
            }
          } catch (_) { }
        }

        if (otpInput) {
          if (twoFactorSecret) {
            console.log('[Auth] Generating 2FA TOTP code from secret...');
            const token = authenticator.generate(twoFactorSecret.replace(/\s+/g, '').toUpperCase());
            console.log(`[Auth] 2FA code generated: ${token}`);
            await otpInput.fill(token);
          } else {
            console.warn('[Auth] OTP code input detected on page, but FB_2FA_SECRET is not configured in .env.');
          }
        }

        // Click any confirmation / continue / remember buttons on checkpoint
        const checkpointBtns = [
          'button[type="submit"]',
          'button[id="checkpointSubmitButton"]',
          'button:has-text("Tiếp tục")',
          'button:has-text("Continue")',
          'button:has-text("Đây là tôi")',
          'button:has-text("This was me")',
          'button:has-text("Lưu trình duyệt")',
          'button:has-text("Save Browser")',
          'input[type="submit"]',
          'div[role="button"][aria-label*="Tiếp tục" i]'
        ];

        let clicked = false;
        for (const btnSel of checkpointBtns) {
          try {
            const btn = await page.$(btnSel);
            if (btn && await btn.isVisible()) {
              console.log(`[Auth] Clicking checkpoint action button: ${btnSel}`);
              await btn.click({ force: true }).catch(() => { });
              clicked = true;
              await page.waitForTimeout(3000);
              break;
            }
          } catch (_) { }
        }

        if (!clicked) {
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);
        }
      }
    }

    // 7. Verify final login status
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const status = await checkSessionStatus(page);
    if (status.isLoggedIn) {
      console.log('[Auth] 🎉 Automated Facebook login SUCCEEDED! Session stored in persistent disk.');
      resetAuthAlertState();
      return { success: true, message: 'Login successful' };
    } else {
      console.error(`[Auth Error] Login attempt finished but still not authenticated. Current URL: ${status.currentUrl}`);
      return { success: false, reason: `Login finished at ${status.currentUrl}` };
    }
  } catch (err) {
    console.error(`[Auth Error] Failed to auto-login:`, err.message);
    return { success: false, reason: err.message };
  }
}

/**
 * Ensure the browser context is authenticated before scraping or commenting.
 * 1. Checks current persistent session.
 * 2. If invalid, tries applying FB_COOKIE into the persistent context.
 * 3. If still invalid, tries auto-login with FB_EMAIL / FB_PASSWORD.
 * 4. If all fails, sends Slack alert.
 */
export async function ensureAuthenticated(page, { cookieString = process.env.FB_COOKIE || '', targetUrl = '' } = {}) {
  // 1. Ingest cookies into context if available
  if (cookieString) {
    const cookies = parseCookies(cookieString);
    if (cookies.length > 0) {
      await page.context().addCookies(cookies).catch(() => {});
    }
  }

  // 2. Check if current page is already loaded and valid
  const currentUrl = page.url();
  if (currentUrl && currentUrl.includes('facebook.com') && !currentUrl.includes('about:blank')) {
    const status = await checkSessionStatus(page);
    if (!status.isLoggedIn) {
      if (process.env.FB_EMAIL && process.env.FB_PASSWORD) {
        console.log('[Auth] Session expired. Initiating automatic credential login...');
        const autoLoginResult = await performAutoLogin(page);
        if (autoLoginResult.success) {
          return { authenticated: true, method: 'auto_login' };
        }
      }
      await sendSlackAuthAlert({
        reason: 'Phiên đăng nhập Facebook hết hạn hoặc bị điều hướng Login',
        targetUrl: targetUrl || currentUrl,
        pageUrl: status.currentUrl,
        pageTitle: status.pageTitle
      });
      return { authenticated: false, reason: 'Session expired' };
    }
  }

  return { authenticated: true, method: 'cookies_applied' };
}
