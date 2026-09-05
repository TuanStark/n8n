/**
 * AI AGENT ENGINE - SHOPEE AFFILIATE AUTOMATION
 * Brand: Nhà Có Món Hay ("Những món nhỏ, cuộc sống tiện hơn")
 * Powered by Google Gemini API
 */

class GeminiAffiliateAIEngine {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
    this.model = config.model || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  async _callGemini(systemInstruction, userPrompt, temperature = 0.3) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is missing');
    }

    const candidateModels = Array.from(new Set([
      this.model,
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-flash-latest',
      'gemini-2.5-flash',
      'gemini-3-flash-preview',
      'gemini-3.5-flash'
    ]));

    let lastError = null;
    for (const modelName of candidateModels) {
      try {
        const url = `${this.baseUrl}/${modelName}:generateContent?key=${this.apiKey}`;
        const payload = {
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }]
            }
          ],
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature,
            responseMimeType: 'application/json'
          }
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          const err = new Error(`Gemini API error [${response.status}] on ${modelName}: ${errText}`);
          err.status = response.status;
          throw err;
        }

        const data = await response.json();
        const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawContent) {
          throw new Error(`Empty response from Gemini model ${modelName}`);
        }
        return JSON.parse(rawContent);
      } catch (err) {
        lastError = err;
        if (err.status === 429) {
          console.warn(`[GEMINI_QUOTA] ${modelName} rate-limited. Waiting 5s before next candidate...`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error('All Gemini model candidates exhausted.');
  }

  /**
   * 1. AGENT CHẤM ĐIỂM SẢN PHẨM (AI PRODUCT SCORER)
   */
  async scoreProduct(product, options = {}) {
    const systemInstruction = `You are a Senior E-commerce Merchandiser and Consumer Psychologist specializing in Shopee Vietnam.
Evaluate products for the Facebook Page "Nhà Có Món Hay" (Target: Home improvement, smart gadgets, space saving, convenient living).

Evaluate 4 qualitative criteria (0 to 100):
1. problem_utility_score: Does it solve a real, annoying household pain point?
2. impulse_factor_score: Is the price attractive and decision frictionless for 25-45 age adults?
3. visual_potential_score: Can it be demonstrated compellingly via photo carousel or before/after?
4. safety_score: Is it safe from high refund/damage rates, counterfeit risks, or policy violations?

Output JSON schema:
{
  "problem_utility_score": number,
  "impulse_factor_score": number,
  "visual_potential_score": number,
  "safety_score": number,
  "recommended_angle": "PROBLEM_SOLUTION" | "CURIOSITY" | "WORTH_IT" | "BEFORE_AFTER" | "LIFE_HACK",
  "key_pain_point": string,
  "key_benefit": string,
  "decision": "ACCEPTED" | "REJECTED",
  "reason": string
}`;

    const prompt = `Evaluate this product for "Nhà Có Món Hay":
Product Name: ${product.product_name || product.productName}
Price: ${product.price} VND
Rating: ${product.rating_star || product.ratingStar} / 5.0
Historical Sold: ${product.historical_sold || product.sales}
Shop Type: ${product.shop_type || product.shopType}
Specs: ${JSON.stringify(product.raw_specs || product.rawSpecs || {})}`;

    const result = await this._callGemini(systemInstruction, prompt, 0.2);

    // Tính điểm tổng hợp theo công thức đa yếu tố
    // Trọng số: Comm (0.25), Social proof (0.20), Utility (0.20), Price (0.15), Visual (0.10), Safety (0.10)
    const price = Number(product.price);
    const commRate = Number(product.commission_rate || product.commissionRate || 8);
    const estComm = (price * commRate) / 100;
    const sold = Number(product.historical_sold || product.sales || 100);
    const rating = Number(product.rating_star || product.ratingStar || 4.8);

    const s1_comm = Math.min(100, (estComm / 35000) * 100);
    const s2_social = Math.min(100, (Math.log10(Math.max(sold, 10)) / 4) * 60 + (rating - 4.5) * 80);
    const s3_utility = result.problem_utility_score || 70;
    const s4_price = price >= 50000 && price <= 250000 ? 100 : (price <= 400000 ? 75 : 50);
    const s5_visual = result.visual_potential_score || 70;
    const s6_safety = result.safety_score || 85;

    const compositeScore = Math.round(
      0.25 * s1_comm +
      0.20 * s2_social +
      0.20 * s3_utility +
      0.15 * s4_price +
      0.10 * s5_visual +
      0.10 * s6_safety
    );

    const threshold = (options && options.threshold) || (product.intake_source === 'MANUAL_LINK' ? 65 : 75);
    return {
      ...result,
      composite_score: compositeScore,
      is_qualified: compositeScore >= threshold && result.decision === 'ACCEPTED'
    };
  }

  /**
   * 2. AGENT SẢN XUẤT NỘI DUNG (AI CONTENT FACTORY)
   */
  async generateContent(product, angle = 'PROBLEM_SOLUTION') {
    const systemInstruction = `You are the chief copywriter for the Facebook Page "Nhà Có Món Hay" (Positioning: "Những món nhỏ, cuộc sống tiện hơn").
Tone of Voice:
- Conversational, warm, observant, authentic, like a trusted friend sharing a genuine household discovery.
- Absolutely NO hard-sell buzzwords (NO: "SALE SẬP SÀN", "XẢ KHO", "MUA NGAY", "CƠ HỘI DUY NHẤT").
- DO NOT put any external URLs in the post caption (Facebook will penalize reach).
- Always end with a subtle, friendly CTA pointing to the First Comment.
- Output length: 130 - 200 words. Max 3 emojis in entire caption.

Angle Rules:
- PROBLEM_SOLUTION: Highlight a relatable messy/annoying household friction -> introduce the neat solution.
- CURIOSITY: Express genuine surprise at how clever and handy the gadget is.
- WORTH_IT: Balanced review format: 2 big pros and 1 minor caveat, concluding why it's worth every penny.
- BEFORE_AFTER: Paint a clear contrast between chaos before and satisfying order after.
- LIFE_HACK: Frame it as a smart space-saving or time-saving habit.

Output JSON schema:
{
  "angle": "${angle}",
  "hook": string,
  "body": string,
  "cta": string,
  "full_caption": string,
  "first_comment": string,
  "image_prompt": string
}`;

    const prompt = `Write a high-converting Facebook post for "Nhà Có Món Hay" using angle [${angle}]:
Product Name: ${product.product_name || product.productName}
Price: ${product.price.toLocaleString('vi-VN')} đ
Rating: ${product.rating_star || product.ratingStar} sao (${(product.historical_sold || product.sales).toLocaleString('vi-VN')} đã bán)
Key Specs & Highlights: ${JSON.stringify(product.raw_specs || product.rawSpecs || {})}
Shop Type: ${product.shop_type || product.shopType}`;

    return await this._callGemini(systemInstruction, prompt, 0.4);
  }

  /**
   * 3. AGENT KIỂM DUYỆT CHẤT LƯỢNG & CHÍNH SÁCH (AI QA INSPECTOR)
   */
  async inspectQuality(content, product) {
    const systemInstruction = `You are a strict Social Media Compliance Auditor and Fact-Checking Quality Controller for the brand "Nhà Có Món Hay".
Review the draft post against the product specs and Facebook organic community guidelines.

Important Strategy Context:
- Inviting users to check the First Comment or comment section for links/details is the APPROVED standard publishing strategy for this page. Do NOT penalize or reject for mentioning the comment section.
- External Link Rule: The main caption (full_caption) must NOT contain direct http:// or https:// URLs. (URLs belong exclusively in the first comment).

Evaluation Criteria:
1. Factual Accuracy & Hallucination check: Does the text fabricate specs, materials, or features not in official data?
2. Meta Community Policy: Are there prohibited medical claims, counterfeit brand claims, scam patterns, or aggressive clickbait?
3. External Link check: Ensure NO raw http/https URL is present in full_caption.
4. Tone compliance: Is it polite, genuine, helpful, and natural Vietnamese?
Realistic social proof numbers (high ratings, purchases, Mall quality) in first comment are acceptable and expected for affiliate engagement.

Output JSON schema:
{
  "pass": boolean,
  "qa_score": number (0 - 100),
  "hallucination_detected": boolean,
  "policy_risk": "LOW" | "MEDIUM" | "HIGH",
  "criticism": string,
  "required_adjustments": string
}`;

    const prompt = `Inspect this post:
Caption:
${content.full_caption}

First Comment:
${content.first_comment}

Official Product Data:
Name: ${product.product_name || product.productName}
Price: ${product.price}
Rating: ${product.rating_star || 4.9}
Sold: ${product.historical_sold || 2500}
Shop Type: ${product.shop_type || 'OFFICIAL_MALL'}
Specs: ${JSON.stringify(product.raw_specs || product.rawSpecs || {})}`;

    return await this._callGemini(systemInstruction, prompt, 0.1);
  }

  /**
   * 4. AGENT TỐI ƯU HÓA TRỌNG SỐ (AI BANDIT OPTIMIZER)
   */
  async optimizeBandit(performanceHistory) {
    const systemInstruction = `You are an Algorithmic Growth Specialist.
Analyze the 14-day conversion history across content angles and recommend updated distribution weights using Epsilon-Greedy (80% exploitation of top angles, 20% exploration).

Output JSON schema:
{
  "angle_weights": {
    "PROBLEM_SOLUTION": number,
    "CURIOSITY": number,
    "WORTH_IT": number,
    "BEFORE_AFTER": number,
    "LIFE_HACK": number
  },
  "summary_reasoning": string,
  "top_performing_angle": string
}`;

    const prompt = `Historical Performance Dataset:
${JSON.stringify(performanceHistory, null, 2)}
Normalize weights so that the sum equals 1.00.`;

    return await this._callGemini(systemInstruction, prompt, 0.2);
  }

  /**
   * 5. LÀM GIÀU DỮ LIỆU SẢN PHẨM TỪ LINK/SLUG THỦ CÔNG (KHI CHƯA CÓ SHOPEE API)
   */
  async enrichProductFromSlug(slugOrName, rawUrl = '') {
    const systemInstruction = `You are a Shopee Vietnam Product Data Specialist.
Given a raw product URL or product slug extracted from a Shopee URL, extract and standardize the product details for the Facebook Page "Nhà Có Món Hay" (Smart home gadgets / household convenience / living hacks).

Output JSON schema:
{
  "product_name": string (standardized natural Vietnamese title, concise, clean, remove shop prefixes),
  "estimated_price": number (realistic retail price in VND between 45000 and 390000),
  "rating_star": number (between 4.80 and 4.95),
  "historical_sold": number (estimated sold count between 600 and 6500),
  "commission_rate": number (estimated between 7.5 and 14.0),
  "shop_type": "OFFICIAL_MALL" | "PREFERRED" | "NORMAL",
  "shop_name": string,
  "key_features": string[],
  "raw_specs": {
    "material": string,
    "installation": string,
    "dimensions": string,
    "highlight": string
  }
}`;

    const prompt = `Standardize this product info:
Input Slug/Title: ${slugOrName}
Raw URL: ${rawUrl}`;

    try {
      return await this._callGemini(systemInstruction, prompt, 0.2);
    } catch (err) {
      console.warn('[AI_ENRICH_FALLBACK] Error calling Gemini:', err.message);
      const cleanName = (slugOrName || 'Sản phẩm tiện ích gia đình')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        product_name: cleanName,
        estimated_price: 99000,
        rating_star: 4.88,
        historical_sold: 1250,
        commission_rate: 9.5,
        shop_type: 'PREFERRED',
        shop_name: 'Gia Dụng Tiện Ích Mall',
        key_features: ['Thiết kế thông minh', 'Lắp đặt dễ dàng không khoan đục', 'Tiết kiệm không gian'],
        raw_specs: {
          material: 'Thép sơn tĩnh điện / Nhựa ABS cao cấp',
          installation: 'Dán tường siêu dính chịu tải tốt',
          dimensions: 'Nhỏ gọn, vừa vặn không gian gia đình',
          highlight: 'Giải quyết triệt để sự bừa bộn trong nhà'
        }
      };
    }
  }

  /**
   * 6. AGENT TẠO BỘ ẢNH SẢN PHẨM UGC CHÂN THỰC BẰNG AI (AUTHENTIC SMARTPHONE MULTI-PHOTO)
   * Tạo 2-3 góc chụp đời thật (iPhone unboxing, cận cảnh chi tiết, đang sử dụng thực tế)
   */
  async generateProductImages(product, count = 3) {
    const productName = product.product_name || product.productName || 'Đồ Gia Dụng Tiện Ích';

    const systemPrompt = `You are an authentic Vietnamese Social Media Reviewer taking real-life, unedited smartphone photos of actual household products.
Generate ${count} distinct English visual prompts for authentic smartphone photography of this product.

CRITICAL REALISM RULES:
- Style: Candid smartphone photo, shot on iPhone 15 camera, natural ambient indoor lighting in a realistic Vietnamese home or apartment.
- Raw unedited look, natural reflections, realistic everyday textures, subtle imperfections.
- ABSOLUTELY NOT a 3D render, NOT CGI, NOT glossy digital illustration, NOT a sterile studio 3D model, NO floating icons, NO text.
- Must accurately depict the real physical product shape, material, and colors from the Vietnamese title.

Góc chụp cần tạo:
1. photo_overview: Góc chụp mở hộp / đặt trên bàn gỗ phòng khách đời thực, góc nhìn tự nhiên từ trên xuống hoặc chéo.
2. photo_closeup: Góc chụp cận cảnh chi tiết (nút bấm, màn hình LED, vân chất liệu, đường viền, cổng cắm thật).
3. photo_in_use: Góc chụp thực tế khi đang cầm trên tay hoặc đang dùng trong phòng sinh hoạt hàng ngày.

Output JSON schema:
{
  "photos": [
    { "type": "overview", "prompt": string },
    { "type": "closeup", "prompt": string },
    { "type": "in_use", "prompt": string }
  ]
}`;

    let photoPrompts = [];
    try {
      const res = await this._callGemini(systemPrompt, `Product: ${productName}`, 0.4);
      if (res && Array.isArray(res.photos) && res.photos.length > 0) {
        photoPrompts = res.photos.slice(0, count);
      }
    } catch (_) {}

    if (photoPrompts.length === 0) {
      const clean = productName.replace(/[^\w\s]/gi, ' ').trim().slice(0, 100);
      photoPrompts = [
        { type: 'overview', prompt: `candid smartphone photo of ${clean} on a wooden table, shot on iPhone, natural window daylight, authentic Vietnamese home, NOT 3D render, raw photo` },
        { type: 'closeup', prompt: `close up macro smartphone photo of ${clean} showing real plastic and metal texture, buttons and details, natural ambient lighting, genuine unedited photo` },
        { type: 'in_use', prompt: `candid in-use smartphone photo of ${clean} being used in a casual living room, natural daylight, real life perspective, authentic review photo` }
      ].slice(0, count);
    }

    const fs = require('fs');
    const path = require('path');
    const cacheDir = '/home/node/.n8n/generated_images';
    if (!fs.existsSync(cacheDir)) {
      try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
    }

    const generatedImages = [];
    for (let i = 0; i < photoPrompts.length; i++) {
      const p = photoPrompts[i];
      const cleanPrompt = p.prompt.replace(/[^\w\s,.-]/gi, ' ').trim().slice(0, 320);
      const seed = Math.floor(Math.random() * 900000) + 100000;
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1080&height=1080&nologo=true&seed=${seed}&model=turbo`;
      
      const localFilePath = path.join(cacheDir, `prod_${seed}.jpg`);
      try {
        console.log(`[AI_IMAGE] Pre-downloading photo ${i + 1}/${photoPrompts.length} (${p.type})...`);
        const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(localFilePath, buf);
        }
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.warn(`[AI_IMAGE_CACHE_WARN] Error caching image ${i + 1}: ${err.message}`);
      }

      generatedImages.push({
        url: fs.existsSync(localFilePath) ? localFilePath : url,
        type: p.type,
        prompt: cleanPrompt,
        seed
      });
    }

    return generatedImages;
  }

  // Alias tương thích ngược
  async generateProductImage(product, customPrompt = '') {
    const list = await this.generateProductImages(product, 1);
    return {
      imageUrl: list[0]?.url,
      prompt: list[0]?.prompt,
      seed: list[0]?.seed
    };
  }
}

module.exports = GeminiAffiliateAIEngine;
