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
   * 2. AGENT SẢN XUẤT NỘI DUNG (AI CONTENT FACTORY) - NÂNG CẤP VIRAL SOCIAL COPYWRITING
   */
  async generateContent(product, angle = 'PROBLEM_SOLUTION') {
    const validAngles = ['PROBLEM_SOLUTION', 'CURIOSITY', 'WORTH_IT', 'BEFORE_AFTER', 'LIFE_HACK'];
    const chosenAngle = validAngles.includes(angle) ? angle : validAngles[Math.floor(Math.random() * validAngles.length)];

    const systemInstruction = `Bạn là Copywriter triệu view kiêm Reviewer đồ gia dụng & đời sống thực chiến số 1 cho kênh Facebook "Nhà Có Món Hay" (Định vị: "Những món nhỏ, cuộc sống tiện hơn").
Mục tiêu cốt lõi: Viết bài chia sẻ sản phẩm cuốn hút tột bậc, khiến người dùng Facebook phải DỪNG NGÓN TAY LƯỚT (Scroll-Stopping) ngay trong 3 giây đầu tiên, đọc mê mẩn từng câu chữ và lập tức tò mò muốn bấm xuống bình luận để lấy link săn sale.

🎯 BẢN SẮC & GIỌNG ĐIỆU (TONE OF VOICE):
- Tự nhiên, hóm hỉnh, chân thực 100% như một người bạn thân sành sỏi công nghệ/tiện ích đang ngồi trà đá chia sẻ thật lòng.
- Dùng ngôn ngữ đời sống hiện đại, giàu nhạc điệu, giàu cảm xúc của người Việt trẻ (nhỏ mà có võ, chim ưng dã man, nhàn tênh, êm ru, cứu cánh, hời thực sự, nhẹ cả người, khác bọt, đáng từng xu, hời xỉu...).
- TUYỆT ĐỐI KHÔNG viết theo giọng văn mẫu AI sáo rỗng, cấm các câu mở đầu tẻ nhạt như: "Hôm nay trời oi bức...", "Dạo này nhà mình...", "Hôm nay mình xin giới thiệu...", "Góc thú vị cuối tuần...", "Nếu bạn đang tìm kiếm...".
- TUYỆT ĐỐI KHÔNG dùng từ ngữ bán hàng giật gân rẻ tiền: "SALE SẬP SÀN", "XẢ KHO GIÁ SỐC", "MUA NGAY KẺO LỠ".
- TUYỆT ĐỐI KHÔNG chèn bất kỳ đường link http/https nào trong nội dung bài (Facebook sẽ bóp tương tác nặng nề).

🔥 BỘ KHUNG HOOK THÔI MIÊN (BẮT BUỘC CHỌN 1 TRONG CÁC DẠNG NÀY ĐỂ MỞ ĐẦU):
Dòng 1-2 PHẢI là một "cú đấm thị giác" (Pattern Interrupt), tạo cảm giác tò mò cực độ hoặc đánh trúng tim đen:
- Mẫu 1 (Tưởng dởm ai ngờ đỉnh / Tự nhận sai lầm): "Tưởng lại thêm một món mua về phí tiền trên mạng, ai ngờ nó lại là thứ cứu rỗi [căn bếp / giấc ngủ / mùa hè] của mình..."
- Mẫu 2 (Nỗi đau oái oăm / Tình huống trớ trêu): "Ai từng trải qua cái cảnh [tình huống cực kỳ bực mình, chi tiết] thì mới thấm nó ức chế đến mức nào..."
- Mẫu 3 (Khen ngợi độc lạ): "Người nào nghĩ ra cái thiết kế này xứng đáng được nhận 10 điểm tinh tế vì quá hiểu tâm lý người lười/người dùng!"
- Mẫu 4 (Thách thức ngược / Cảnh báo): "Đừng dại mua cái này nếu không muốn bị cả nhà tranh nhau dùng hoặc bạn bè đến chơi hỏi xin link liên tục!"
- Mẫu 5 (So sánh số tiền vs Giá trị): "Bỏ ra chưa tới [số tiền - ví dụ: cốc trà sữa / 2 bát phở] mà giải quyết dứt điểm cái cực hình bấy lâu nay..."
- Mẫu 6 (Phản trực giác / Nghi ngờ): "Thấy trên mạng hot rần rần tưởng lùa gà, mua về test thử mới thấy nó ở cái tầm khác bọt hoàn toàn..."

📖 CẤU TRÚC BÀI VIẾT (THOÁNG MẮT, DỄ LƯỚT TRÊN SMARTPHONE):
1. DÒNG HOOK: 1 câu duy nhất, cực kỳ ngắn, giật sự chú ý. Xuống dòng tạo khoảng trống ngay.
2. CÂU CHUYỆN & CẢM GIÁC SƯỚNG (3-4 đoạn ngắn, mỗi đoạn 1-2 câu):
   - Đưa người đọc vào đúng khoảnh khắc thực tế (cái nóng 12h trưa, đống dây nhợ rối tung, căn bếp chật chội ám mùi mỡ...).
   - "Show, Don't Just Tell": Đừng liệt kê thông số kỹ thuật khô khan (mAh, W, cm), hãy diễn tả CẢM GIÁC THỰC TẾ khi dùng (gió thốc vào mát lạnh tê tái, tiếng thu trong veo sạch bách còi xe, 5 giây bấm nút là nhàn tênh).
3. ĐIỂM TRỪ NHỎ TẠO NIỀM TIN (BẮT BUỘC 1 CHI TIẾT CHÂN THÀNH):
   - Nêu thật lòng 1 điểm trừ nhẹ (ví dụ: "Nấc to nhất hơi có tiếng gió vù vù nhẹ", "Vỏ bóng nên hơi bám vân tay xíu lau qua là bóng loáng", "Mới bóc hộp hơi có mùi nhựa mới tầm 15 phút là bay hết"). Chi tiết này làm người đọc tin 100% đây là trải nghiệm người thật.
4. KẾT LUẬN & CTA DUYÊN DÁNG (CALL TO ACTION):
   - Chốt lại độ "đáng tiền" so với công sức tiết kiệm được.
   - Thôi thúc tò mò hoặc hướng dẫn xuống bình luận đầu tiên lấy link chính hãng kèm mã giảm (Ví dụ: "Bác nào cũng đang ngứa mắt với cảnh đấy thì em để sẵn link shop Mall chính hãng em săn được ở bình luận đầu tiên nha, đợt này đang có mã giảm giá áp vào rẻ tê tái luôn!").
5. BÌNH LUẬN ĐẦU TIÊN (FIRST COMMENT):
   - Thân thiện, tâm lý, dặn dò mọi người nhớ lưu voucher giảm giá của shop + mã Freeship Extra trước khi bấm chốt đơn.

Độ dài: 150 - 240 từ. Dùng từ 4 - 6 icon emoji sinh động, đặt đúng chỗ nhấn nhá.

Output JSON schema:
{
  "angle": "${chosenAngle}",
  "hook": string,
  "body": string,
  "cta": string,
  "full_caption": string,
  "first_comment": string,
  "image_prompt": string
}`;

    const angleGuidance = {
      'PROBLEM_SOLUTION': 'Tập trung sâu vào nỗi đau ức chế, bực bội hàng ngày mà ai cũng gặp -> Sản phẩm xuất hiện giải phóng hoàn toàn nỗi đau đó.',
      'CURIOSITY': 'Tập trung vào tâm lý nghi ngờ ban đầu ("tưởng đồ chơi vô dụng/lùa gà") -> Quá trình đập hộp trải nghiệm bất ngờ vì tính năng quá thông minh.',
      'WORTH_IT': 'Đặt lên bàn cân kinh tế: So sánh số tiền bỏ ra (vài chục đến hơn trăm nghìn) với giá trị to lớn và thời gian công sức tiết kiệm được.',
      'BEFORE_AFTER': 'Tạo độ tương phản cực gắt giữa cảnh đời "trước khi mua" (chật vật, bực mình, mất thời gian) và "sau khi có nó" (nhàn tênh, tươm tất, thư thái).',
      'LIFE_HACK': 'Chia sẻ như một mẹo vặt đỉnh cao của dân sành sỏi, một món đồ ít ai ngờ tới nhưng dùng một lần là không thể sống thiếu.'
    };

    const prompt = `Viết bài chia sẻ cực kỳ cuốn hút cho sản phẩm sau theo góc tiếp cận [${chosenAngle}]:
Định hướng góc [${chosenAngle}]: ${angleGuidance[chosenAngle] || angleGuidance['PROBLEM_SOLUTION']}

Thông tin sản phẩm:
- Tên sản phẩm: ${product.product_name || product.productName}
- Giá bán ưu đãi: ${product.price ? product.price.toLocaleString('vi-VN') : '99.000'} đ
- Uy tín: ${product.rating_star || product.ratingStar || 4.9} sao (${(product.historical_sold || product.sales || 1000).toLocaleString('vi-VN')} lượt mua thành công)
- Loại shop: ${product.shop_type || product.shopType || 'Shopee Mall chính hãng'}
- Thông số & Tính năng nổi bật: ${JSON.stringify(product.raw_specs || product.rawSpecs || {})}

YÊU CẦU ĐẶC BIỆT: Dòng mở đầu (hook) phải cực kỳ giật gân, cuốn hút, đọc là muốn bấm đọc tiếp ngay. Văn phong trẻ trung, dí dỏm, chân thực 100%!`;

    return await this._callGemini(systemInstruction, prompt, 0.8);
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
- Natural, engaging, colloquial, witty, and emotionally expressive Vietnamese social copy is HIGHLY ENCOURAGED. Do NOT penalize humor, slang, or punchy colloquial phrasing.

Evaluation Criteria:
1. Factual Accuracy & Hallucination check: Does the text fabricate specs, materials, or features not in official data?
2. Meta Community Policy: Are there prohibited medical claims, counterfeit brand claims, scam patterns, or aggressive clickbait?
3. External Link check: Ensure NO raw http/https URL is present in full_caption.
4. Tone compliance: Is it engaging, relatable, genuine, and natural Vietnamese?
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
   * Phân tích chính xác vật thể thực tế sang tiếng Anh và sinh 2-3 góc ảnh đời thực (Flux Model)
   */
  async generateProductImages(product, count = 3) {
    const productName = product.product_name || product.productName || 'Đồ Gia Dụng Tiện Ích';

    const systemPrompt = `You are a professional Product Visual Director and Commercial Photographer for E-commerce.
Analyze the Vietnamese product title and specifications to identify:
1. Exact physical object in English (clear, unambiguous noun phrase, e.g. "portable rechargeable neck fan", "biodegradable black garbage bag rolls", "wireless lavalier clip-on microphone with furry windshield").
2. Physical visual attributes (exact materials like matte ABS plastic/brushed aluminum, colors, shapes, distinct features like LED battery display, buttons, clips, ports).
3. Generate ${count} distinct English visual prompts for the Flux image generation model to produce hyper-realistic, candid smartphone photos shot on an iPhone 15 camera.

CRITICAL REALISM & ANTI-AI RULES:
- Style: Candid smartphone photo, shot on iPhone 15, 35mm lens, natural depth of field, real life imperfections, subtle dust or ambient reflections.
- Natural ambient indoor daylight from a window in a contemporary Vietnamese apartment or home.
- ABSOLUTELY NOT a 3D render, NOT CGI, NOT a glossy digital illustration, NOT a sterile studio 3D mockup, NO floating graphics, NO text overlays, NO fake glowing rings.
- The object must look 100% like a real tangible consumer product manufactured for sale.

3 Photo Perspectives:
1. type: "overview" -> Candid flat lay or casual tabletop shot on a natural wooden table, realistic home setting, natural daylight.
2. type: "closeup" -> Macro close-up on physical details, tactile buttons, plastic/metal texture, seams, LED display, genuine unedited smartphone macro.
3. type: "in_use" -> Authentic lifestyle action shot of the product being actively used in a real household or everyday setting by real hands.

Output JSON schema:
{
  "english_product_name": string,
  "visual_features": string,
  "photos": [
    { "type": "overview", "prompt": string },
    { "type": "closeup", "prompt": string },
    { "type": "in_use", "prompt": string }
  ]
}`;

    let photoPrompts = [];
    try {
      const res = await this._callGemini(systemPrompt, `Product: ${productName}\nSpecs: ${JSON.stringify(product.raw_specs || product.rawSpecs || {})}`, 0.3);
      if (res && Array.isArray(res.photos) && res.photos.length > 0) {
        photoPrompts = res.photos.slice(0, count);
      }
    } catch (err) {
      console.warn('[AI_IMAGE_PROMPT_WARN]', err.message);
    }

    if (photoPrompts.length === 0) {
      const clean = productName.replace(/[^\w\s]/gi, ' ').trim().slice(0, 80);
      photoPrompts = [
        { type: 'overview', prompt: `Candid smartphone photo shot on iPhone 15, unedited raw photo of ${clean} on a natural wooden coffee table, soft morning window daylight, realistic Vietnamese apartment, authentic UGC, no CGI, no 3D render` },
        { type: 'closeup', prompt: `Macro close-up smartphone photo shot on iPhone 15 of ${clean}, detailed view of physical buttons, matte plastic and metal textures, natural ambient lighting, genuine unedited product shot` },
        { type: 'in_use', prompt: `Candid lifestyle photo shot on iPhone 15, real hands using ${clean} in a cozy living room, authentic everyday moment, natural lighting, realistic household perspective` }
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
      const cleanPrompt = p.prompt.replace(/[^\w\s,.-]/gi, ' ').trim().slice(0, 350);
      const seed = Math.floor(Math.random() * 900000) + 100000;
      // Dùng model=flux để đạt độ phân giải cao và chân thực tối đa
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1080&height=1080&nologo=true&seed=${seed}&model=flux`;
      
      const localFilePath = path.join(cacheDir, `prod_${seed}.jpg`);
      try {
        console.log(`[AI_IMAGE] Pre-downloading photo ${i + 1}/${photoPrompts.length} (${p.type}) [Flux Model]...`);
        const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(localFilePath, buf);
        }
        await new Promise(r => setTimeout(r, 2000));
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
