/**
 * STORY COMPOSITOR 9:16 ENGINE
 * Brand: Nhà Có Món Hay ("Những món nhỏ, cuộc sống tiện hơn")
 * Tech Stack: Node.js + Sharp (libvips) + Vector SVG Typography
 * Resolution: 1080 x 1920 (Standard Vertical 9:16 Full Screen)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class StoryCompositor {
  constructor(options = {}) {
    this.width = options.width || 1080;
    this.height = options.height || 1920;
    this.brandName = options.brandName || 'NHÀ CÓ MÓN HAY';
    this.brandTagline = options.brandTagline || 'Những món nhỏ, cuộc sống tiện hơn';
  }

  /**
   * Escape ký tự đặc biệt cho SVG XML
   */
  _escapeXml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Tự động chia dòng văn bản để vừa khung hình SVG
   */
  _wrapText(text, maxCharsPerLine = 26) {
    if (!text) return [];
    const words = String(text).trim().split(/\s+/);
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
        currentLine = (currentLine + ' ' + word).trim();
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }

  /**
   * Tải ảnh từ URL hoặc đọc từ file cục bộ
   */
  async _loadImageBuffer(imageInput) {
    if (!imageInput) return null;

    if (Buffer.isBuffer(imageInput)) {
      return imageInput;
    }

    if (typeof imageInput === 'string') {
      if (fs.existsSync(imageInput)) {
        return fs.readFileSync(imageInput);
      }
      if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
        try {
          const res = await fetch(imageInput, { signal: AbortSignal.timeout(15000) });
          if (res.ok) {
            const arrBuffer = await res.arrayBuffer();
            return Buffer.from(arrBuffer);
          }
        } catch (err) {
          console.warn(`[STORY_COMPOSITOR] Failed to fetch image (${imageInput}): ${err.message}`);
        }
      }
    }
    return null;
  }

  /**
   * Tạo Story 9:16 hoàn chỉnh chuẩn studio
   * @param {Object} params
   * @param {string|Buffer} params.sourceImage - Đường dẫn ảnh sản phẩm hoặc URL
   * @param {string} params.productName - Tên sản phẩm
   * @param {string} params.hookText - Tiêu đề gây sốc / tò mò
   * @param {string} params.subText - Câu bổ trợ / nỗi đau
   * @param {string|number} params.price - Giá sản phẩm (VD: "69.000đ")
   * @param {string|number} params.originalPrice - Giá gốc
   * @param {number} params.discountPercent - % Giảm giá
   * @param {number} params.rating - Điểm đánh giá (VD: 4.9)
   * @param {string} params.soldCount - Số lượng đã bán (VD: "2.8k+")
   * @param {string} params.ctaText - Kêu gọi hành động ("👉 XEM BÀI VIẾT TRÊN TRANG")
   * @param {string} params.theme - 'ORANGE' | 'CYAN' | 'EMERALD' | 'PURPLE'
   * @param {string} params.outputPath - Nơi lưu file đầu ra
   */
  async composeStory({
    sourceImage,
    productName = 'Món Đồ Tiện Ích Thông Minh',
    hookText = 'GIẢI PHÁP GỌN GÀNG CHO NGÔI NHÀ CỦA BẠN!',
    subText = 'Bấm xem ngay bài viết chi tiết trên Page để lấy link săn sale nhé!',
    price = '',
    originalPrice = '',
    discountPercent = 0,
    rating = 4.9,
    soldCount = '1.2k+',
    ctaText = '👉 BẤM XEM BÀI VIẾT TRÊN TRANG',
    theme = 'ORANGE',
    outputPath = null
  }) {
    const rawBuffer = await this._loadImageBuffer(sourceImage);

    // Bảng màu theo theme
    const colorThemes = {
      ORANGE: {
        primary: '#FF6B00',
        secondary: '#FFA726',
        accent: '#FFD54F',
        darkBg: '#1A0F07'
      },
      CYAN: {
        primary: '#00B4D8',
        secondary: '#48CAE4',
        accent: '#90E0EF',
        darkBg: '#05161E'
      },
      EMERALD: {
        primary: '#10B981',
        secondary: '#34D399',
        accent: '#A7F3D0',
        darkBg: '#061C14'
      },
      PURPLE: {
        primary: '#8B5CF6',
        secondary: '#A78BFA',
        accent: '#DDD6FE',
        darkBg: '#140A26'
      }
    };
    const currentTheme = colorThemes[theme] || colorThemes.ORANGE;

    // 1. Tạo hình nền mờ nghệ thuật (Blurred Ambient Background 1080x1920)
    let backgroundPipeline;
    if (rawBuffer) {
      backgroundPipeline = sharp(rawBuffer)
        .resize(this.width, this.height, { fit: 'cover' })
        .blur(45)
        .modulate({ brightness: 0.55, saturation: 1.3 });
    } else {
      // Fallback nền gradient đơn sắc nếu không có ảnh gốc
      backgroundPipeline = sharp({
        create: {
          width: this.width,
          height: this.height,
          channels: 4,
          background: { r: 18, g: 22, b: 34, alpha: 1 }
        }
      });
    }

    const backgroundBuffer = await backgroundPipeline.png().toBuffer();

    // 2. Xử lý ảnh Hero sản phẩm trung tâm (880 x 780 px với bo góc mềm mại)
    const heroW = 900;
    const heroH = 760;
    const heroRadius = 36;

    let heroBuffer = null;
    if (rawBuffer) {
      // Bo tròn góc bằng SVG mask
      const roundedCornerMask = Buffer.from(`
        <svg width="${heroW}" height="${heroH}">
          <rect x="0" y="0" width="${heroW}" height="${heroH}" rx="${heroRadius}" ry="${heroRadius}" fill="#FFFFFF"/>
        </svg>
      `);

      const croppedHero = await sharp(rawBuffer)
        .resize(heroW, heroH, { fit: 'cover', position: 'center' })
        .composite([{ input: roundedCornerMask, blend: 'dest-in' }])
        .png()
        .toBuffer();

      // Thêm viền trắng mỏng và shadow cho card sản phẩm
      const borderSvg = Buffer.from(`
        <svg width="${heroW}" height="${heroH}">
          <rect x="2" y="2" width="${heroW - 4}" height="${heroH - 4}" rx="${heroRadius}" ry="${heroRadius}" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-opacity="0.9"/>
        </svg>
      `);

      heroBuffer = await sharp(croppedHero)
        .composite([{ input: borderSvg, blend: 'over' }])
        .png()
        .toBuffer();
    }

    // 3. Chuẩn bị Typography và Vector Layer (SVG Overlay)
    const hookLines = this._wrapText(hookText, 22).slice(0, 3);
    const subLines = this._wrapText(subText, 34).slice(0, 2);

    const numPrice = Number(price);
    const numOriginal = Number(originalPrice);
    const formattedPrice = !isNaN(numPrice) && numPrice > 0 
      ? Math.round(numPrice).toLocaleString('vi-VN') + 'đ' 
      : (price ? String(price) : '');
    const formattedOriginal = !isNaN(numOriginal) && numOriginal > 0 
      ? Math.round(numOriginal).toLocaleString('vi-VN') + 'đ' 
      : (originalPrice ? String(originalPrice) : '');

    const hookY = 1240;
    const hookSvgLines = hookLines.map((line, idx) => {
      const y = hookY + idx * 56;
      return `<text x="540" y="${y}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="44" font-weight="900" fill="#FFFFFF" stroke="#000000" stroke-width="4" paint-order="stroke fill">${this._escapeXml(line)}</text>`;
    }).join('\n');

    const subY = hookY + hookLines.length * 56 + 10;
    const subSvgLines = subLines.map((line, idx) => {
      const y = subY + idx * 36;
      return `<text x="540" y="${y}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="#E2E8F0">${this._escapeXml(line)}</text>`;
    }).join('\n');

    // Clean emojis from text inputs so they don't depend on system emoji fonts
    const cleanCtaText = (ctaText || 'XEM BÀI VIẾT TRÊN TRANG').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();

    // Badge Giảm giá nếu có
    const discountSvg = discountPercent > 0 ? `
      <g transform="translate(100, 395)">
        <rect x="0" y="0" width="130" height="54" rx="27" fill="#EF4444" />
        <text x="65" y="36" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Roboto, sans-serif" font-size="26" font-weight="900" fill="#FFFFFF">-${discountPercent}%</text>
      </g>
    ` : '';

    // Badge Rating & Lượt bán với vector Star
    const ratingSvg = `
      <g transform="translate(710, 395)">
        <rect x="0" y="0" width="190" height="54" rx="27" fill="#000000" fill-opacity="0.65" stroke="#FFFFFF" stroke-width="2" stroke-opacity="0.3"/>
        <!-- Vector Star -->
        <polygon points="26,16 29.5,23.5 38,24.5 31.8,30.5 33.5,39 26,34.8 18.5,39 20.2,30.5 14,24.5 22.5,23.5" fill="#FBBF24"/>
        <text x="110" y="36" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Roboto, sans-serif" font-size="22" font-weight="800" fill="#FBBF24">${rating} | ${soldCount}</text>
      </g>
    `;

    // Khối Giá & CTA Sticker
    const priceDisplaySvg = formattedPrice ? `
      <g transform="translate(160, 1460)">
        <rect x="0" y="0" width="760" height="60" rx="30" fill="#000000" fill-opacity="0.55" />
        <text x="380" y="42" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Roboto, sans-serif" font-size="30" font-weight="800" fill="#FEF08A">
          GIÁ ƯU ĐÃI: <tspan font-size="36" font-weight="900" fill="#FACC15">${this._escapeXml(formattedPrice)}</tspan>
          ${formattedOriginal ? `<tspan font-size="24" font-weight="500" fill="#94A3B8" text-decoration="line-through"> (${this._escapeXml(formattedOriginal)})</tspan>` : ''}
        </text>
      </g>
    ` : '';

    // CTA Button chính với vector right-pointing arrow
    const ctaY = formattedPrice ? 1545 : 1485;
    const ctaSvg = `
      <g transform="translate(100, ${ctaY})">
        <defs>
          <linearGradient id="ctaGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${currentTheme.primary}" />
            <stop offset="100%" stop-color="${currentTheme.secondary}" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <!-- Nút CTA viền phát sáng -->
        <rect x="0" y="0" width="880" height="100" rx="50" fill="url(#ctaGrad)" filter="url(#glow)"/>
        <rect x="4" y="4" width="872" height="92" rx="46" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-opacity="0.5"/>
        
        <!-- Vector Arrow on right side of CTA button -->
        <g transform="translate(790, 28)">
          <circle cx="22" cy="22" r="22" fill="#FFFFFF" fill-opacity="0.25"/>
          <path d="M14 22 h16 M22 15 l7 7 -7 7" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </g>

        <text x="420" y="62" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="34" font-weight="900" fill="#FFFFFF" letter-spacing="1">
          ${this._escapeXml(cleanCtaText)}
        </text>
      </g>
    `;

    // Toàn bộ SVG Layout hoàn chỉnh
    const overlaySvg = Buffer.from(`
      <svg width="${this.width}" height="${this.height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <!-- Gradient tối che phủ trên dưới để tăng tương phản chữ -->
          <linearGradient id="vignette" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.80" />
            <stop offset="25%" stop-color="#000000" stop-opacity="0.25" />
            <stop offset="60%" stop-color="#000000" stop-opacity="0.30" />
            <stop offset="85%" stop-color="#000000" stop-opacity="0.85" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.95" />
          </linearGradient>
          <linearGradient id="goldText" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#FDE047" />
            <stop offset="100%" stop-color="#F59E0B" />
          </linearGradient>
        </defs>

        <!-- Lớp Vignette làm dịu nền -->
        <rect x="0" y="0" width="${this.width}" height="${this.height}" fill="url(#vignette)" />

        <!-- 1. HEADER THƯƠNG HIỆU (Y = 240 - 340, tránh Safe Zone trên) -->
        <g transform="translate(100, 240)">
          <!-- Logo Pill -->
          <rect x="0" y="0" width="880" height="96" rx="48" fill="#000000" fill-opacity="0.55" stroke="#FFFFFF" stroke-width="2" stroke-opacity="0.25"/>
          
          <!-- Vector House Icon -->
          <circle cx="56" cy="48" r="30" fill="${currentTheme.primary}" />
          <path d="M47 56 v-10 h18 v10 h6 v-12 l-15 -12 -15 12 v12 z" fill="#FFFFFF"/>
          
          <text x="105" y="42" font-family="-apple-system, BlinkMacSystemFont, Roboto, sans-serif" font-size="28" font-weight="900" fill="#FFFFFF" letter-spacing="1">
            ${this._escapeXml(this.brandName)}
          </text>
          <text x="105" y="72" font-family="-apple-system, BlinkMacSystemFont, Roboto, sans-serif" font-size="20" font-weight="500" fill="#94A3B8">
            ${this._escapeXml(this.brandTagline)}
          </text>
          
          <!-- Pill nhỏ góc phải: HOT DEAL với vector flame -->
          <rect x="670" y="24" width="186" height="48" rx="24" fill="${currentTheme.primary}" fill-opacity="0.3" stroke="${currentTheme.primary}" stroke-width="2" />
          <path d="M700 48 c-4 0 -7 -3 -7 -7 c0 -3 2 -5 4 -7 c0.5 1 1 2 2 3 c1 -2 2 -4 2 -6 c3 1 5 4 5 7 c0 4 -3 7 -6 7 z" fill="#EF4444"/>
          <text x="765" y="56" text-anchor="middle" font-family="-apple-system, Roboto, sans-serif" font-size="20" font-weight="900" fill="${currentTheme.accent}">HOT DEAL</text>
        </g>

        <!-- 2. BADGE TRÊN CARD SẢN PHẨM -->
        ${discountSvg}
        ${ratingSvg}

        <!-- 3. KHỐI HOOK TEXT TẠO CẢM XÚC (Y = 1220+) -->
        <g transform="translate(70, 1180)">
          <rect x="0" y="0" width="940" height="230" rx="32" fill="#000000" fill-opacity="0.65" stroke="#FFFFFF" stroke-width="2" stroke-opacity="0.2"/>
        </g>
        ${hookSvgLines}
        ${subSvgLines}

        <!-- 4. KHỐI GIÁ BÁN & CTA STICKER -->
        ${priceDisplaySvg}
        ${ctaSvg}

        <!-- 5. CHỈ DẪN CUỐI MÀN HÌNH (Gần mép Safe Zone dưới) -->
        <text x="540" y="1720" text-anchor="middle" font-family="-apple-system, Roboto, sans-serif" font-size="22" font-weight="600" fill="#94A3B8">
          • Số lượng deal có hạn • Bấm xem bài viết trên trang ngay •
        </text>
      </svg>
    `);

    // 4. Ghép toàn bộ layer với Sharp
    const compositeLayers = [];

    // Layer 1: Hero image đặt tại (X=90, Y=370)
    if (heroBuffer) {
      compositeLayers.push({
        input: heroBuffer,
        left: 90,
        top: 370
      });
    }

    // Layer 2: Vector Overlay (Header, Badges, Hook text, CTA)
    compositeLayers.push({
      input: overlaySvg,
      left: 0,
      top: 0
    });

    const finalImagePipeline = sharp(backgroundBuffer)
      .composite(compositeLayers)
      .jpeg({ quality: 90, mozjpeg: true });

    if (outputPath) {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await finalImagePipeline.toFile(outputPath);
      return {
        outputPath,
        width: this.width,
        height: this.height,
        fileSize: fs.statSync(outputPath).size
      };
    }

    const outputBuffer = await finalImagePipeline.toBuffer();
    return {
      buffer: outputBuffer,
      width: this.width,
      height: this.height,
      fileSize: outputBuffer.length
    };
  }
}

module.exports = StoryCompositor;
