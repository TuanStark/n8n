import { getPersistentBrowserContext, ensureAuthenticated } from './auth.js';
import fs from 'fs';
import path from 'path';

/**
 * Publish an organic post to a Facebook Group, Page, or Feed with optional image attachment
 */
export async function publishFacebookPost({
  postText,
  targetUrl = '',
  imagePath = '',
  cookieString = process.env.FB_COOKIE || '',
  timeoutMs = 60000
}) {
  if (!postText) {
    throw new Error('Missing postText');
  }

  let destinationUrl = targetUrl;
  if (!destinationUrl) {
    const configuredGroups = (process.env.FB_GROUP_URLS || process.env.FB_GROUP_URL || '').split(',').map(s => s.trim()).filter(Boolean);
    destinationUrl = configuredGroups[0] || 'https://www.facebook.com/groups/1998083910206781/';
  }

  // Determine image to attach
  let attachmentImage = imagePath;
  if (!attachmentImage) {
    const defaultAsset = '/app/assets/stark_web_showcase.jpg';
    if (fs.existsSync(defaultAsset)) {
      attachmentImage = defaultAsset;
    }
  }

  const sanitizedText = postText.trim();

  let context = null;
  let page = null;

  try {
    console.log(`[Poster] Attaching to persistent browser context...`);
    context = await getPersistentBrowserContext();
    page = await context.newPage();

    // 1. Ensure authenticated session first (inject cookies)
    const auth = await ensureAuthenticated(page, {
      cookieString,
      targetUrl: destinationUrl
    });

    if (!auth.authenticated) {
      throw new Error('Cannot publish post: Facebook session is not authenticated.');
    }

    console.log(`[Poster] Navigating to destination: ${destinationUrl}`);
    await page.goto(destinationUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Wait for hydration
    await page.waitForTimeout(4000);

    // Dismiss any modal/dialogs if already open
    try {
      const closeButtons = await page.$$('[aria-label="Đóng"], [aria-label="Close"], div[role="button"][aria-label*="close" i]');
      for (const btn of closeButtons) {
        await btn.click().catch(() => {});
      }
    } catch (_) {}

    // Scroll down slightly to ensure post box is in view
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(1500);

    // 2. Click the trigger to open the "Tạo bài viết" modal dialog
    console.log(`[Poster] Looking for create post trigger...`);
    const triggerSelectors = [
      'div[role="button"]:has-text("Bạn viết gì đi...")',
      'span:has-text("Bạn viết gì đi...")',
      'div[role="button"]:has-text("Bạn đang nghĩ gì thế?")',
      'span:has-text("Bạn đang nghĩ gì thế?")',
      'div[role="button"]:has-text("Tạo bài viết")',
      'span:has-text("Tạo bài viết")',
      'div[role="button"][aria-label*="Tạo bài viết" i]',
      'div[role="button"][aria-label*="Create a post" i]',
      'div[role="button"][aria-label*="Write something" i]'
    ];

    let clickedTrigger = false;
    for (const sel of triggerSelectors) {
      try {
        const trigger = await page.$(sel);
        if (trigger && await trigger.isVisible()) {
          console.log(`[Poster] Clicking trigger: ${sel}`);
          await trigger.click({ force: true });
          clickedTrigger = true;
          break;
        }
      } catch (_) {}
    }

    if (!clickedTrigger) {
      // Fallback by text matching
      clickedTrigger = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('[role="button"], span, div'));
        const target = buttons.find(b => b.innerText && (b.innerText.includes('Bạn viết gì đi') || b.innerText.includes('Bạn đang nghĩ gì') || b.innerText.includes('Tạo bài viết')));
        if (target) {
          const btn = target.closest('[role="button"]') || target;
          btn.click();
          return true;
        }
        return false;
      });
      console.log(`[Poster] Evaluated fallback click result: ${clickedTrigger}`);
    }

    // 3. Wait for the modal dialog ("Tạo bài viết")
    console.log(`[Poster] Waiting for post creation dialog...`);
    try {
      await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
      console.log(`[Poster] Modal dialog opened successfully!`);
    } catch (_) {
      console.warn(`[Poster] Timed out waiting for div[role="dialog"], checking document...`);
    }

    // 4. Find the contenteditable textbox and TYPE TEXT FIRST
    const editorSelectors = [
      'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
      'div[role="dialog"] div[contenteditable="true"]',
      'div[role="dialog"] div[data-lexical-editor="true"]',
      'div[role="dialog"] div[role="textbox"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]'
    ];

    let editorBox = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      for (const sel of editorSelectors) {
        try {
          const el = await page.$(sel);
          if (el && await el.isVisible()) {
            editorBox = el;
            console.log(`[Poster] Found editor box: ${sel}`);
            break;
          }
        } catch (_) {}
      }
      if (editorBox) break;
      await page.waitForTimeout(1000);
    }

    if (!editorBox) {
      throw new Error('Khung soạn thảo bài viết không khả dụng trên Facebook.');
    }

    // Focus textbox
    await editorBox.scrollIntoViewIfNeeded().catch(() => {});
    await editorBox.click({ force: true });
    await page.waitForTimeout(600);

    // Type the post content line by line
    console.log(`[Poster] Typing post content (${sanitizedText.length} chars)...`);
    const lines = sanitizedText.trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) {
        await page.keyboard.insertText(lines[i]);
      }
      if (i < lines.length - 1) {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        await page.waitForTimeout(40);
      }
    }

    await page.waitForTimeout(2000);

    // 5. Attach Image AFTER typing text
    if (attachmentImage && fs.existsSync(attachmentImage)) {
      console.log(`[Poster] Attaching image: ${attachmentImage}`);
      try {
        let fileInput = await page.$('div[role="dialog"] input[type="file"][accept*="image"], div[role="dialog"] input[type="file"], input[type="file"]');
        if (!fileInput) {
          const photoBtnSelectors = [
            'div[role="dialog"] div[role="button"][aria-label*="Ảnh/video" i]',
            'div[role="dialog"] div[aria-label="Ảnh/video"]',
            'div[role="dialog"] div[role="button"]:has-text("Ảnh/video")',
            'div[role="dialog"] div[aria-label*="Thêm ảnh" i]'
          ];
          for (const pSel of photoBtnSelectors) {
            try {
              const pBtn = await page.$(pSel);
              if (pBtn && await pBtn.isVisible()) {
                console.log(`[Poster] Clicking Photo button: ${pSel}`);
                await pBtn.click({ force: true });
                await page.waitForTimeout(1500);
                break;
              }
            } catch (_) {}
          }
          fileInput = await page.$('div[role="dialog"] input[type="file"], input[type="file"]');
        }

        if (fileInput) {
          console.log(`[Poster] Setting input files for image attachment...`);
          await fileInput.setInputFiles(attachmentImage);
          await page.waitForTimeout(3500);
          console.log(`[Poster] Image attached successfully!`);
        } else {
          console.warn(`[Poster Warning] Could not find file input for photo upload.`);
        }
      } catch (imgErr) {
        console.warn(`[Poster Warning] Failed to attach image:`, imgErr.message);
      }
    }

    await page.waitForTimeout(2000);

    // 6. Find and click the "Đăng" (Post) button
    const postButtonSelectors = [
      'div[role="dialog"] div[role="button"][aria-label="Đăng"]',
      'div[role="dialog"] div[aria-label="Đăng"]',
      'div[role="dialog"] div[role="button"]:has-text("Đăng")',
      'div[role="dialog"] div[role="button"][aria-label="Post"]',
      'div[role="dialog"] div[aria-label="Post"]',
      'div[role="dialog"] div[role="button"]:has-text("Post")',
      'div[role="dialog"] div[role="button"]:has-text("Tiếp")',
      'div[aria-label="Đăng"][role="button"]',
      'div[role="button"]:has-text("Đăng")'
    ];

    let postBtnClicked = false;
    for (const sel of postButtonSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible()) {
          const ariaDisabled = await btn.getAttribute('aria-disabled');
          if (ariaDisabled === 'true') {
            console.log(`[Poster] Post button is disabled, waiting...`);
            await page.waitForTimeout(2500);
          }
          console.log(`[Poster] Clicking Post button: ${sel}`);
          await btn.click({ force: true });
          postBtnClicked = true;
          break;
        }
      } catch (_) {}
    }

    if (!postBtnClicked) {
      // Fallback click on any button inside dialog with text "Đăng"
      postBtnClicked = await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]') || document.body;
        const btns = Array.from(dialog.querySelectorAll('[role="button"], button'));
        const postBtn = btns.find(b => b.innerText && b.innerText.trim() === 'Đăng' || b.getAttribute('aria-label') === 'Đăng');
        if (postBtn) {
          postBtn.click();
          return true;
        }
        return false;
      });
      console.log(`[Poster] Evaluated fallback post button click: ${postBtnClicked}`);
    }

    if (!postBtnClicked) {
      throw new Error('Không tìm thấy nút "Đăng" trên hộp thoại bài viết Facebook.');
    }

    // 7. Wait for submission and dialog to detach
    console.log(`[Poster] Waiting for post to finish publishing...`);
    try {
      await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 25000 });
      console.log(`[Poster] Post dialog closed successfully!`);
    } catch (_) {
      console.log(`[Poster] Dialog detach check ended.`);
    }

    await page.waitForTimeout(3000);
    console.log(`[Poster] 🎉 Post published successfully to: ${destinationUrl}`);

    return {
      success: true,
      message: 'Đã đăng bài viết thành công lên Facebook',
      destinationUrl,
      hasImage: Boolean(attachmentImage && fs.existsSync(attachmentImage)),
      postText: sanitizedText,
      timestamp: new Date().toISOString()
    };

  } catch (err) {
    console.error(`[Poster Error]:`, err.message);
    throw err;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}
