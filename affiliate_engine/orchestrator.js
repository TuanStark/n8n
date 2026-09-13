/**
 * SHOPEE AFFILIATE AUTOMATION MACHINE - ORCHESTRATOR
 * Brand: Nhà Có Món Hay
 * Execution Controller for Workflows and CLI
 */

const { Pool } = require('pg');
const fs = require('fs');
const ShopeeAffiliateEngine = require('./shopee_engine');
const GeminiAffiliateAIEngine = require('./ai_engine');
const MetaPublisherEngine = require('./meta_engine');

class AffiliateOrchestrator {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_POSTGRESDB_HOST || 'n8n-postgres',
      port: process.env.DB_POSTGRESDB_PORT || 5432,
      user: process.env.DB_POSTGRESDB_USER || 'n8n',
      password: process.env.DB_POSTGRESDB_PASSWORD || 'jdBv3EAq_IleslDG3060z-y14ZpN2jlU',
      database: process.env.DB_POSTGRESDB_DATABASE || 'n8n'
    });

    this.shopee = new ShopeeAffiliateEngine();
    this.ai = new GeminiAffiliateAIEngine();
    this.meta = new MetaPublisherEngine();
  }

  async getConfig(key) {
    const res = await this.pool.query('SELECT value FROM affiliate_system_config WHERE key = $1', [key]);
    return res.rows[0]?.value || {};
  }

  /**
   * STEP 1: HUNT & SCORE PRODUCTS
   */
  async runProductHunterAndScorer() {
    console.log('[HUNTER] Starting product discovery from Shopee...');
    const rules = await this.getConfig('hunter_rules');
    const rawOffers = await this.shopee.queryProductOffers({
      keyword: rules.target_keywords?.[0] || 'tiện ích',
      limit: 20
    });

    console.log(`[HUNTER] Fetched ${rawOffers.length} raw product offers.`);
    const qualifiedItems = [];

    for (const item of rawOffers) {
      const price = Number(item.price);
      const rating = Number(item.ratingStar);
      const sold = Number(item.sales);
      const commRate = Number(item.commissionRate);

      // HARD RULE FILTER
      if (rating < (rules.min_rating || 4.7)) continue;
      if (sold < (rules.min_sold || 100)) continue;
      if (commRate < (rules.min_commission_rate || 5.0)) continue;
      if (price < (rules.min_price || 40000) || price > (rules.max_price || 450000)) continue;

      // Check duplicate in past 14 days
      const dupCheck = await this.pool.query(
        `SELECT id FROM affiliate_products 
         WHERE shopee_item_id = $1 AND created_at > NOW() - INTERVAL '14 days'`,
        [item.itemId]
      );
      if (dupCheck.rows.length > 0) continue;

      // Upsert Product to DB
      const upsertQuery = `
        INSERT INTO affiliate_products (
          shopee_item_id, shopee_shop_id, product_name, product_url,
          price, original_price, discount_percentage, commission_rate,
          commission_amount, rating_star, historical_sold, shop_name,
          shop_type, image_urls, raw_specs
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (shopee_item_id, shopee_shop_id) 
        DO UPDATE SET 
          price = EXCLUDED.price,
          commission_rate = EXCLUDED.commission_rate,
          commission_amount = EXCLUDED.commission_amount,
          rating_star = EXCLUDED.rating_star,
          historical_sold = EXCLUDED.historical_sold,
          updated_at = NOW()
        RETURNING id, product_name, price, rating_star, historical_sold, commission_rate, raw_specs, shop_type;
      `;

      const prodRes = await this.pool.query(upsertQuery, [
        item.itemId,
        item.shopId,
        item.productName,
        item.productLink,
        item.price,
        item.originalPrice || item.price,
        item.discount || 0,
        item.commissionRate,
        item.commission || Math.round(item.price * item.commissionRate / 100),
        item.ratingStar,
        item.sales,
        item.shopName || '',
        item.shopType || 'NORMAL',
        JSON.stringify(item.imageUrls || [item.imageUrl]),
        JSON.stringify(item.rawSpecs || {})
      ]);

      const savedProduct = prodRes.rows[0];

      // AI PRODUCT SCORING
      console.log(`[SCORER] Evaluating product: "${savedProduct.product_name}"...`);
      try {
        const scoreResult = await this.ai.scoreProduct(savedProduct);

        await this.pool.query(`
          INSERT INTO affiliate_ai_decisions (
            product_id, stage, model_name, input_payload, output_payload, score, decision, reasoning
          ) VALUES ($1, 'PRODUCT_SCORING', 'gemini-1.5-flash', $2, $3, $4, $5, $6)
        `, [
          savedProduct.id,
          JSON.stringify(savedProduct),
          JSON.stringify(scoreResult),
          scoreResult.composite_score,
          scoreResult.is_qualified ? 'ACCEPTED' : 'REJECTED',
          scoreResult.reason
        ]);

        if (scoreResult.is_qualified) {
          qualifiedItems.push({
            product: savedProduct,
            score: scoreResult.composite_score,
            recommended_angle: scoreResult.recommended_angle
          });
        }
      } catch (err) {
        console.error(`[SCORER_ERROR] Product ${savedProduct.id}:`, err.message);
      }
    }

    console.log(`[HUNTER & SCORER] Finished! Found ${qualifiedItems.length} approved products.`);
    return qualifiedItems;
  }

  /**
   * Helper: Phân tích URL Shopee và giải mã slug tiếng Việt
   */
  async parseShopeeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    let targetUrl = rawUrl.trim();

    // 1. Thử giải mã nếu là shortlink (s.shopee.vn hoặc vn.shp.ee)
    const isShortLink = /s\.shopee\.vn|vn\.shp\.ee/i.test(targetUrl);
    let resolvedUrl = targetUrl;
    if (isShortLink) {
      try {
        const headRes = await fetch(targetUrl, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(4000) });
        const loc = headRes.headers.get('location');
        if (loc && (loc.includes('shopee.vn') || loc.includes('shp.ee'))) {
          resolvedUrl = loc;
        }
      } catch (_) {}
    }

    // Pattern 1: ...-i.{shop_id}.{item_id}
    const matchSlug = resolvedUrl.match(/([^\/?#]+)-i\.(\d+)\.(\d+)/);
    if (matchSlug) {
      const rawSlug = matchSlug[1];
      const shopId = matchSlug[2];
      const itemId = matchSlug[3];
      let decodedName = '';
      try {
        decodedName = decodeURIComponent(rawSlug).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
      } catch (_) {
        decodedName = rawSlug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
      }
      return {
        shopId: Number(shopId),
        itemId: Number(itemId),
        productName: decodedName,
        slug: rawSlug,
        productUrl: resolvedUrl,
        rawUrl: targetUrl,
        isShortLink
      };
    }

    // Pattern 2: /product/{shop_id}/{item_id}
    const matchProduct = resolvedUrl.match(/\/product\/(\d+)\/(\d+)/);
    if (matchProduct) {
      return {
        shopId: Number(matchProduct[1]),
        itemId: Number(matchProduct[2]),
        productName: null,
        slug: null,
        productUrl: resolvedUrl,
        rawUrl: targetUrl,
        isShortLink
      };
    }

    // Pattern 3: Shortlink không thể redirect (dùng hash để sinh ID ổn định)
    if (isShortLink) {
      const hashStr = targetUrl.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '');
      let numHash = 0;
      for (let i = 0; i < hashStr.length; i++) {
        numHash = ((numHash << 5) - numHash) + hashStr.charCodeAt(i);
        numHash = Math.abs(numHash);
      }
      return {
        shopId: 88800000 + (numHash % 100000),
        itemId: 99900000000 + (numHash % 1000000000),
        productName: null,
        slug: null,
        productUrl: targetUrl,
        rawUrl: targetUrl,
        isShortLink: true
      };
    }

    return null;
  }

  /**
   * Helper: Chuẩn hóa dòng nhập liệu (hỗ trợ phân tách |, tab, comma)
   */
  /**
   * Helper: Chọn ảnh lifestyle sản phẩm sắc nét, chân thực theo danh mục
   */
  getCuratedImageForProduct(productName) {
    const p = (productName || '').toLowerCase();
    if (p.includes('khăn giấy') || p.includes('giấy vệ sinh') || p.includes('giấy rút') || p.includes('hộp giấy')) {
      return 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=1080&q=80';
    }
    if (p.includes('gia vị') || p.includes('xoay') || p.includes('hũ gia vị')) {
      return 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=1080&q=80';
    }
    if (p.includes('chiên') || p.includes('nồi') || p.includes('bếp') || p.includes('philips') || p.includes('chảo')) {
      return 'https://images.unsplash.com/photo-1585515320310-259814833e62?w=1080&q=80';
    }
    if (p.includes('tắm') || p.includes('đánh răng') || p.includes('oenon') || p.includes('kem đánh răng') || p.includes('xà phòng') || p.includes('inox 304')) {
      return 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1080&q=80';
    }
    if (p.includes('rác') || p.includes('thùng rác') || p.includes('gấp gọn')) {
      return 'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=1080&q=80';
    }
    // Mặc định đồ gia dụng thông minh ấm cúng
    return 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1080&q=80';
  }

  /**
   * Helper: Chuẩn hóa dòng nhập liệu (hỗ trợ phân tách |, tab, comma, hoặc text kèm link)
   */
  parseInputLine(line) {
    if (!line || typeof line !== 'string') return null;
    const cleanLine = line.trim();
    if (!cleanLine || cleanLine.startsWith('#')) return null;

    // Hỗ trợ định dạng: URL [| AffiliateURL] [| Price] [| ImageURL]
    const delimiter = cleanLine.includes('|') ? '|' : (cleanLine.includes('\t') ? '\t' : null);
    if (delimiter) {
      const parts = cleanLine.split(delimiter).map(p => p.trim()).filter(Boolean);
      const first = parts[0] || '';
      const second = parts[1] || '';

      // Trường hợp: [Tên sản phẩm | Link]
      if (!first.startsWith('http') && second.startsWith('http')) {
        return {
          url: second,
          productName: first,
          customAffiliateLink: second,
          price: parts[2] ? Number(parts[2].replace(/[,.đ]/g, '')) || null : null,
          imageUrl: parts[3] || null
        };
      }

      // Trường hợp: [Link Gốc | Link Tiếp Thị hoặc Tên Sản Phẩm hoặc Giá]
      let url = first;
      let customAffiliate = second;
      let price = null;
      let imageUrl = null;
      let productName = null;

      if (customAffiliate && !customAffiliate.startsWith('http')) {
        if (!isNaN(Number(customAffiliate.replace(/[,.đ]/g, '')))) {
          price = Number(customAffiliate.replace(/[,.đ]/g, ''));
        } else {
          productName = customAffiliate;
        }
        customAffiliate = null;
      } else if (parts[2]) {
        price = Number(parts[2].replace(/[,.đ]/g, '')) || null;
        imageUrl = parts[3] || null;
      }

      return {
        url,
        productName,
        customAffiliateLink: customAffiliate && customAffiliate.startsWith('http') ? customAffiliate : (/s\.shopee\.vn|vn\.shp\.ee/i.test(url) ? url : null),
        price,
        imageUrl
      };
    }

    // Trường hợp paste text kèm link từ Shopee App (ví dụ: "Khăn giấy rút Top Gia... https://s.shopee.vn/...")
    const urlMatch = cleanLine.match(/https?:\/\/[^\s|;,]+/);
    if (urlMatch) {
      const url = urlMatch[0];
      const surroundingText = cleanLine.replace(url, '').replace(/[|•\-\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      return {
        url,
        productName: surroundingText.length >= 3 ? surroundingText : null,
        customAffiliateLink: (/s\.shopee\.vn|vn\.shp\.ee/i.test(url)) ? url : null,
        price: null,
        imageUrl: null
      };
    }

    // Plain URL
    return {
      url: cleanLine,
      productName: null,
      customAffiliateLink: (/s\.shopee\.vn|vn\.shp\.ee/i.test(cleanLine)) ? cleanLine : null,
      price: null,
      imageUrl: null
    };
  }

  /**
   * Helper: Bóc tách file CSV xuất từ cổng Shopee Affiliate
   */
  parseShopeeAffiliateCsv(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const items = [];
    // Bỏ qua dòng header đầu tiên
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Bóc tách cột CSV hỗ trợ dấu ngoặc kép
      const regex = /(?:^|,)(?:"([^"]*)"|([^,]*))/g;
      const cols = [];
      let match;
      while ((match = regex.exec(line)) !== null) {
        cols.push((match[1] !== undefined ? match[1] : match[2]).trim());
      }

      if (cols.length >= 8) {
        const itemId = cols[0];
        const productName = cols[1];
        const rawPrice = cols[2];
        const rawSold = cols[3];
        const shopName = cols[4];
        const rawCommRate = cols[5];
        const rawCommAmount = cols[6];
        const productUrl = cols[7];
        const affiliateLink = cols[8] || cols[7];

        let price = 99000;
        if (rawPrice) {
          const pLower = rawPrice.toLowerCase();
          if (pLower.includes('tr')) {
            price = Math.round(parseFloat(pLower.replace(',', '.').replace(/[^0-9.]/g, '')) * 1000000);
          } else if (pLower.includes('k')) {
            price = Math.round(parseFloat(pLower.replace(',', '.').replace(/[^0-9.]/g, '')) * 1000);
          } else {
            price = Number(rawPrice.replace(/[^0-9]/g, '')) || 99000;
          }
        }

        let sold = 100;
        if (rawSold) {
          const sLower = rawSold.toLowerCase();
          if (sLower.includes('tr')) sold = 1000000;
          else if (sLower.includes('k')) sold = Math.round(parseFloat(sLower.replace(',', '.').replace(/[^0-9.]/g, '')) * 1000);
          else sold = Number(rawSold.replace(/[^0-9]/g, '')) || 100;
        }

        const commRate = parseFloat((rawCommRate || '10').replace(',', '.').replace(/[^0-9.]/g, '')) || 10.0;
        const commAmount = Number((rawCommAmount || '').replace(/[^0-9]/g, '')) || Math.round((price * commRate) / 100);

        let shopId = 88800000;
        const m = productUrl.match(/\/product\/(\d+)\/(\d+)/);
        if (m) {
          shopId = Number(m[1]);
        }

        items.push({
          itemId: Number(itemId),
          shopId,
          productName,
          price,
          historicalSold: sold,
          shopName,
          commissionRate: commRate,
          commissionAmount: commAmount,
          productUrl,
          customAffiliateLink: affiliateLink,
          rawUrl: affiliateLink,
          url: affiliateLink
        });
      }
    }
    return items;
  }

  /**
   * STEP 1B: MANUAL LINK INTAKE (CHO CHẾ ĐỘ CHƯA CÓ SHOPEE API)
   * Tiếp nhận tối đa 20 sản phẩm/ngày do người dùng cung cấp (Hỗ trợ CSV, danh sách link, text)
   */
  async runManualLinkIntake(inputListOrText) {
    console.log('[MANUAL_INTAKE] Processing user submitted Shopee product data/links...');

    // 1. Kiểm tra nếu là file CSV xuất từ Shopee Affiliate
    if (typeof inputListOrText === 'string' && (inputListOrText.includes('Mã sản phẩm') || inputListOrText.includes('Link sản phẩm') || inputListOrText.includes('Link ưu đãi'))) {
      console.log('[MANUAL_INTAKE] Detected Shopee Affiliate CSV format! Parsing official export data...');
      const csvItems = this.parseShopeeAffiliateCsv(inputListOrText);
      console.log(`[MANUAL_INTAKE] Successfully parsed ${csvItems.length} products from CSV.`);
      return await this._processIntakeItems(csvItems);
    }

    let lines = [];
    if (Array.isArray(inputListOrText)) {
      lines = inputListOrText;
    } else if (typeof inputListOrText === 'string') {
      const raw = inputListOrText.trim();
      try {
        const parsedJson = JSON.parse(raw);
        if (Array.isArray(parsedJson)) lines = parsedJson;
        else lines = raw.split(/\r?\n/);
      } catch (_) {
        const urlMatches = raw.match(/https?:\/\/[^\s|;,]+/g);
        if (urlMatches && urlMatches.length > 1 && !raw.includes('\n')) {
          lines = urlMatches;
        } else {
          lines = raw.split(/\r?\n/);
        }
      }
    }

    const parsedItems = [];
    for (const item of lines) {
      if (!item) continue;
      const parsedRow = typeof item === 'object' && item.url ? item : this.parseInputLine(String(item));
      if (!parsedRow || !parsedRow.url) continue;

      const urlInfo = await this.parseShopeeUrl(parsedRow.url);
      if (!urlInfo) {
        console.warn(`[MANUAL_INTAKE] Could not parse Shopee URL: "${parsedRow.url}"`);
        continue;
      }

      parsedItems.push({
        ...urlInfo,
        ...parsedRow,
        productName: parsedRow.productName || urlInfo.productName || null,
        customAffiliateLink: parsedRow.customAffiliateLink || urlInfo.customAffiliateLink || null
      });
      if (parsedItems.length >= 20) break; // Tối đa 20 sp/ngày
    }

    console.log(`[MANUAL_INTAKE] Validated ${parsedItems.length} product links to process.`);
    return await this._processIntakeItems(parsedItems);
  }

  /**
   * Helper xử lý nạp sản phẩm vào DB, đính kèm ảnh và chấm điểm AI
   */
  async _processIntakeItems(items) {
    const qualifiedItems = [];

    for (const item of items) {
      console.log(`[MANUAL_INTAKE] Processing: "${item.productName || item.rawUrl}"...`);

      // 1. Dùng Gemini AI làm giàu thông tin CHỈ KHI thiếu tên sản phẩm
      let enriched = {};
      if (!item.productName) {
        try {
          enriched = await this.ai.enrichProductFromSlug(item.slug || item.rawUrl, item.productUrl);
        } catch (_) {}
      }

      const finalProductName = item.productName || enriched.product_name || 'Đồ Gia Dụng Tiện Ích Thông Minh';
      const finalPrice = item.price ? Number(item.price) : Number(enriched.estimated_price || 99000);
      const originalPrice = Math.round(finalPrice * 1.5);
      const discountPercentage = Math.round(((originalPrice - finalPrice) / originalPrice) * 100);

      // Khởi tạo URL ảnh AI phong cách lifestyle độc bản cho sản phẩm
      const cleanProdTitle = encodeURIComponent(finalProductName.replace(/[^\w\s]/gi, ' ').trim().slice(0, 120));
      const seed = Math.floor(Math.random() * 900000) + 100000;
      const aiInitialImg = `https://image.pollinations.ai/prompt/aesthetic%20photorealistic%20lifestyle%20photo%20of%20${cleanProdTitle}%2C%20modern%20bright%20cozy%20room%2C%20natural%20sunlight%2C%204k?width=1080&height=1080&nologo=true&seed=${seed}&model=flux`;
      const imageUrls = item.imageUrl ? [item.imageUrl, aiInitialImg] : [aiInitialImg];

      const ratingStar = Number(item.ratingStar || enriched.rating_star || 4.88);
      const historicalSold = Number(item.historicalSold || enriched.historical_sold || 1200);
      const commRate = Number(item.commissionRate || enriched.commission_rate || 9.5);
      const commAmount = item.commissionAmount ? Number(item.commissionAmount) : Math.round((finalPrice * commRate) / 100);
      const shopName = item.shopName || enriched.shop_name || 'Gia Dụng Thông Minh Mall';
      const shopType = item.shopType || enriched.shop_type || 'PREFERRED';
      const customAffiliate = item.customAffiliateLink || (item.isShortLink ? item.rawUrl : null);

      // 2. Upsert Product to DB (đánh dấu intake_source = 'MANUAL_LINK')
      const upsertQuery = `
        INSERT INTO affiliate_products (
          shopee_item_id, shopee_shop_id, product_name, product_url,
          price, original_price, discount_percentage, commission_rate,
          commission_amount, rating_star, historical_sold, shop_name,
          shop_type, image_urls, raw_specs, intake_source, custom_affiliate_link
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'MANUAL_LINK', $16)
        ON CONFLICT (shopee_item_id, shopee_shop_id) 
        DO UPDATE SET 
          product_name = EXCLUDED.product_name,
          price = EXCLUDED.price,
          original_price = EXCLUDED.original_price,
          discount_percentage = EXCLUDED.discount_percentage,
          image_urls = EXCLUDED.image_urls,
          custom_affiliate_link = COALESCE(EXCLUDED.custom_affiliate_link, affiliate_products.custom_affiliate_link),
          updated_at = NOW()
        RETURNING id, product_name, price, rating_star, historical_sold, commission_rate, raw_specs, shop_type, custom_affiliate_link;
      `;

      const prodRes = await this.pool.query(upsertQuery, [
        item.itemId,
        item.shopId,
        finalProductName,
        item.productUrl,
        finalPrice,
        originalPrice,
        discountPercentage,
        commRate,
        commAmount,
        ratingStar,
        historicalSold,
        shopName,
        shopType,
        JSON.stringify(imageUrls),
        JSON.stringify(enriched.raw_specs || {}),
        customAffiliate
      ]);

      const savedProduct = prodRes.rows[0];

      // 3. PRODUCT SCORING: Với link/CSV nạp tay, ưu tiên tính điểm trực tiếp để tiết kiệm Gemini Quota cho viết bài
      const compScore = Math.min(99, Math.max(55, Math.round((commRate * 1.5) + (ratingStar * 8) + (Math.min(historicalSold, 1000) / 40))));
      const scoreResult = {
        composite_score: compScore,
        is_qualified: compScore >= 50,
        recommended_angle: 'TIỆN_ÍCH_GIA_ĐÌNH',
        reason: `Sản phẩm nạp từ CSV/link người dùng: Hoa hồng ${commRate}%, bán ${historicalSold}, đánh giá ${ratingStar} sao.`
      };

      await this.pool.query(`
        INSERT INTO affiliate_ai_decisions (
          product_id, stage, model_name, input_payload, output_payload, score, decision, reasoning
        ) VALUES ($1, 'PRODUCT_SCORING', 'rule-heuristic', $2, $3, $4, $5, $6)
      `, [
        savedProduct.id,
        JSON.stringify(savedProduct),
        JSON.stringify(scoreResult),
        scoreResult.composite_score,
        scoreResult.is_qualified ? 'ACCEPTED' : 'REJECTED',
        scoreResult.reason
      ]);

      if (scoreResult.is_qualified) {
        qualifiedItems.push({
          product: savedProduct,
          score: scoreResult.composite_score,
          recommended_angle: scoreResult.recommended_angle
        });
      }
    }

    console.log(`[MANUAL_INTAKE] Finished! Processed ${items.length} products, approved ${qualifiedItems.length}.`);
    return {
      total_received: items.length,
      qualified_count: qualifiedItems.length,
      qualified_items: qualifiedItems
    };
  }

  /**
   * STEP 2: CONTENT FACTORY & QUALITY CONTROL & SHORTLINK
   */
  async runContentFactoryAndQA(targetProductId = null, limit = 1) {
    console.log('[CONTENT] Picking highest scoring products without published content...');
    const params = [limit];
    let whereClause = "WHERE d.stage = 'PRODUCT_SCORING' AND d.decision = 'ACCEPTED' AND c.id IS NULL";
    if (targetProductId) {
      params.push(targetProductId);
      whereClause += ` AND p.id = $2`;
    }
    const candidateQuery = `
      SELECT p.*, d.score, d.output_payload->>'recommended_angle' as suggested_angle
      FROM affiliate_products p
      JOIN affiliate_ai_decisions d ON p.id = d.product_id
      LEFT JOIN affiliate_content_items c ON p.id = c.product_id
      ${whereClause}
      ORDER BY p.updated_at DESC, d.score DESC
      LIMIT $1;
    `;

    const candidates = (await this.pool.query(candidateQuery, params)).rows;
    if (candidates.length === 0) {
      console.log('[CONTENT] No un-contented approved products found.');
      return [];
    }

    const createdContents = [];
    const banditWeights = await this.getConfig('bandit_angle_weights');

    for (const prod of candidates) {
      const angle = prod.suggested_angle || 'PROBLEM_SOLUTION';
      console.log(`[CONTENT] Generating content for "${prod.product_name}" with angle [${angle}]...`);

      // Generate Copy
      const contentPayload = await this.ai.generateContent(prod, angle);

      // AI QA Inspection
      console.log(`[QA] Inspecting content quality and compliance...`);
      const qaResult = await this.ai.inspectQuality(contentPayload, prod);

      if (!qaResult.pass || qaResult.qa_score < 75) {
        console.warn(`[QA_REJECT] Score: ${qaResult.qa_score}. Reason: ${qaResult.criticism}`);
        continue;
      }

      // 3. MULTI-PHOTO SELECTION (Ưu tiên 2-3 ảnh chụp thực tế 100% chuẩn sản phẩm từ Shopee)
      console.log(`[PRODUCT_IMAGES] Extracting authentic product photos for "${prod.product_name}"...`);
      let selectedPhotos = [];
      try {
        const realImages = await this.shopee.fetchRealProductImages(prod.product_url);
        if (realImages && realImages.length >= 2) {
          console.log(`[PRODUCT_IMAGES] Found ${realImages.length} authentic seller photos from Shopee!`);
          selectedPhotos = realImages.slice(0, 3);
        } else {
          console.log(`[PRODUCT_IMAGES] Found ${realImages ? realImages.length : 0} real photos. Complementing with AI UGC photos...`);
          const aiCount = Math.max(1, 3 - (realImages ? realImages.length : 0));
          const aiPhotos = await this.ai.generateProductImages(prod, aiCount);
          selectedPhotos = [...(realImages || []), ...aiPhotos.map(p => p.url)].slice(0, 3);
        }
      } catch (imgErr) {
        console.warn(`[PRODUCT_IMAGES_WARN] Falling back to AI UGC photos: ${imgErr.message}`);
        try {
          const aiPhotos = await this.ai.generateProductImages(prod, 3);
          selectedPhotos = aiPhotos.map(p => p.url);
        } catch (aiErr) {
          console.warn(`[AI_IMAGE_FAIL] ${aiErr.message}`);
        }
      }

      const chosenImages = selectedPhotos.length > 0 
        ? selectedPhotos 
        : ((prod.image_urls && prod.image_urls.length > 0) ? prod.image_urls : [this.getCuratedImageForProduct(prod.product_name)]);

      // Save Content Item
      const contentRes = await this.pool.query(`
        INSERT INTO affiliate_content_items (
          product_id, content_angle, hook_text, body_text, cta_text,
          full_caption, first_comment_text, selected_image_urls, status, qa_score, qa_notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'QA_PASSED', $9, $10)
        RETURNING id;
      `, [
        prod.id,
        angle,
        contentPayload.hook,
        contentPayload.body,
        contentPayload.cta,
        contentPayload.full_caption,
        contentPayload.first_comment,
        JSON.stringify(chosenImages),
        qaResult.qa_score,
        qaResult.criticism || 'Passed QA checks'
      ]);

      const contentId = contentRes.rows[0].id;
      const shortContentId = contentId.substring(0, 8);

      // GENERATE SHORTLINK WITH SUBIDS OR USE USER PROVIDED AFFILIATE LINK
      let shortLink = prod.custom_affiliate_link;
      const subIds = [
        `P_${prod.shopee_item_id}`,
        `C_${shortContentId}`,
        `A_${angle.substring(0, 10)}`,
        'FBPAGE',
        'AUTO'
      ];

      if (shortLink && shortLink.startsWith('http')) {
        console.log(`[AFFILIATE_LINK] Using custom affiliate link provided by user: ${shortLink}`);
      } else {
        console.log(`[AFFILIATE_LINK] Generating Shopee ShortLink with SubIDs...`);
        const linkResult = await this.shopee.generateShortLink({
          originUrl: prod.product_url,
          subIds
        });
        shortLink = linkResult.shortLink;
      }

      // Save Link
      await this.pool.query(`
        INSERT INTO affiliate_links (
          product_id, content_id, sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5,
          original_url, short_link
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (sub_id_1, sub_id_2, sub_id_3) DO NOTHING;
      `, [
        prod.id,
        contentId,
        subIds[0],
        subIds[1],
        subIds[2],
        subIds[3],
        subIds[4],
        prod.product_url,
        shortLink
      ]);

      // Clean and inject actual affiliate link
      let baseComment = contentPayload.first_comment || 'Nhà mình tham khảo chi tiết sản phẩm ở đây nha:';
      baseComment = baseComment.replace(/https?:\/\/shope\.ee\/[^\s)]+/gi, '').replace(/\[.*?link.*?\]/gi, '').trim();
      const updatedFirstComment = `${baseComment}\n\n👉 Link Shopee chính hãng & áp voucher: ${shortLink}`;
      await this.pool.query(`
        UPDATE affiliate_content_items 
        SET first_comment_text = $1 
        WHERE id = $2
      `, [updatedFirstComment, contentId]);

      // Enqueue for publishing
      await this.pool.query(`
        INSERT INTO affiliate_publishing_queue (content_id, scheduled_for, status)
        VALUES ($1, NOW() + INTERVAL '5 minutes', 'PENDING')
      `, [contentId]);

      createdContents.push({ contentId, shortLink });
    }

    console.log(`[CONTENT] Successfully created & queued ${createdContents.length} posts.`);
    return createdContents;
  }

  /**
   * STEP 3: PUBLISH QUEUED CONTENT TO FACEBOOK PAGE
   */
  async runPublisherQueue(forceNow = false) {
    console.log(`[PUBLISHER] Checking pending posts in queue (forceNow=${forceNow})...`);
    const statusFilter = forceNow ? "q.status IN ('PENDING', 'FAILED')" : "q.status = 'PENDING'";
    const timeFilter = forceNow ? '' : 'AND q.scheduled_for <= NOW()';
    const queueItems = await this.pool.query(`
      SELECT q.id as queue_id, q.content_id, c.full_caption, c.first_comment_text, c.selected_image_urls, p.product_name
      FROM affiliate_publishing_queue q
      JOIN affiliate_content_items c ON q.content_id = c.id
      JOIN affiliate_products p ON c.product_id = p.id
      WHERE ${statusFilter} ${timeFilter}
      ORDER BY q.scheduled_for ASC
      LIMIT 1;
    `);

    if (queueItems.rows.length === 0) {
      console.log('[PUBLISHER] No pending items due for publishing right now.');
      return null;
    }

    const item = queueItems.rows[0];
    console.log(`[PUBLISHER] Publishing post for "${item.product_name}" to Facebook Page...`);

    // Lock status
    await this.pool.query('UPDATE affiliate_publishing_queue SET status = $1 WHERE id = $2', ['PROCESSING', item.queue_id]);

    try {
      // 1. Upload Photos
      let imageUrls = item.selected_image_urls;
      if (typeof imageUrls === 'string') {
        try { imageUrls = JSON.parse(imageUrls); } catch(e) {}
      }
      if (!imageUrls || (Array.isArray(imageUrls) && imageUrls.length === 0)) {
        imageUrls = [this.getCuratedImageForProduct(item.product_name)];
      } else if (!Array.isArray(imageUrls)) {
        imageUrls = [imageUrls];
      }

      const photoIds = [];

      for (const url of imageUrls.slice(0, 4)) {
        try {
          if (url && (url.startsWith('http://') || url.startsWith('https://') || fs.existsSync(url))) {
            const photoRes = await this.meta.uploadPhoto(url);
            if (photoRes && photoRes.id) photoIds.push(photoRes.id);
          }
        } catch (photoErr) {
          console.warn(`[PUBLISHER] Skipping photo (${url}) due to Meta API: ${photoErr.message}`);
        }
      }

      // Nếu ảnh gốc không tải được, dùng AI sinh bộ ảnh mới ngay lập tức
      if (photoIds.length === 0) {
        try {
          console.log(`[PUBLISHER] Generating on-the-fly authentic AI photos for "${item.product_name}"...`);
          const freshPhotos = await this.ai.generateProductImages(item, 3);
          for (const p of freshPhotos) {
            const fallbackRes = await this.meta.uploadPhoto(p.url);
            if (fallbackRes && fallbackRes.id) photoIds.push(fallbackRes.id);
          }
        } catch (fbErr) {
          console.warn('[PUBLISHER] AI photo upload warning:', fbErr.message);
        }
      }

      // 2. Publish Multi-photo Post
      const postRes = await this.meta.publishMultiPhotoPost({
        message: item.full_caption,
        photoIds
      });

      console.log(`[PUBLISHER] Feed post published successfully: fb_post_id = ${postRes.id}`);

      // 3. Wait 3 seconds then Post First Comment
      await new Promise(r => setTimeout(r, 3000));
      const commentRes = await this.meta.postFirstComment({
        postId: postRes.id,
        commentText: item.first_comment_text
      });

      console.log(`[PUBLISHER] First comment pinned: fb_comment_id = ${commentRes.id}`);

      // 4. Save to Facebook Posts Table
      await this.pool.query(`
        INSERT INTO affiliate_facebook_posts (
          content_id, fb_post_id, fb_comment_id, post_type, permalink_url
        ) VALUES ($1, $2, $3, 'PHOTO_CAROUSEL', $4)
      `, [
        item.content_id,
        postRes.id,
        commentRes.id,
        postRes.permalink_url || `https://facebook.com/${postRes.id}`
      ]);

      // 5. Update Queue & Content status
      await this.pool.query('UPDATE affiliate_publishing_queue SET status = $1, updated_at = NOW() WHERE id = $2', ['SUCCESS', item.queue_id]);
      await this.pool.query('UPDATE affiliate_content_items SET status = $1, updated_at = NOW() WHERE id = $2', ['PUBLISHED', item.content_id]);

      return { postId: postRes.id, commentId: commentRes.id };
    } catch (err) {
      console.error('[PUBLISHER_ERROR]', err.message);
      await this.pool.query(`
        UPDATE affiliate_publishing_queue 
        SET status = 'FAILED', error_message = $1, retry_count = retry_count + 1, updated_at = NOW()
        WHERE id = $2
      `, [err.message, item.queue_id]);
      throw err;
    }
  }

  /**
   * STEP 4: RECONCILE CONVERSIONS & DAILY ANALYTICS
   */
  async runConversionReconciler() {
    console.log('[RECONCILER] Fetching Shopee conversion report...');
    const now = Math.floor(Date.now() / 1000);
    const twoDaysAgo = now - 172800;

    const conversions = await this.shopee.getConversionReport({
      purchaseTimeStart: twoDaysAgo,
      purchaseTimeEnd: now
    });

    console.log(`[RECONCILER] Received ${conversions.length} conversion records.`);
    let matchedCount = 0;

    for (const conv of conversions) {
      const subId2 = conv.subId2; // Format: C_{content_id_short}
      let contentId = null;

      if (subId2 && subId2.startsWith('C_')) {
        const shortId = subId2.replace('C_', '');
        const match = await this.pool.query(
          `SELECT id FROM affiliate_content_items WHERE id::text LIKE $1 LIMIT 1`,
          [`${shortId}%`]
        );
        if (match.rows.length > 0) contentId = match.rows[0].id;
      }

      await this.pool.query(`
        INSERT INTO affiliate_conversions (
          shopee_order_id, purchase_time, sub_id_1, sub_id_2, sub_id_3, sub_id_4, sub_id_5,
          content_id, order_status, total_order_amount, estimated_total_commission, raw_payload
        ) VALUES ($1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (shopee_order_id) DO UPDATE SET
          order_status = EXCLUDED.order_status,
          estimated_total_commission = EXCLUDED.estimated_total_commission;
      `, [
        conv.orderId,
        conv.purchaseTime,
        conv.subId1,
        conv.subId2,
        conv.subId3,
        conv.subId4,
        conv.subId5,
        contentId,
        conv.orderStatus,
        conv.totalOrderAmount || 0,
        conv.totalCommission,
        JSON.stringify(conv)
      ]);

      if (contentId) matchedCount++;
    }

    console.log(`[RECONCILER] Successfully reconciled ${matchedCount} orders with published content.`);
    return { total: conversions.length, matched: matchedCount };
  }

  /**
   * STEP 5: DAILY REVENUE SUMMARY
   */
  async getDailySummary() {
    const res = await this.pool.query(`
      SELECT 
        COUNT(DISTINCT c.id) as total_posts,
        COALESCE(SUM(conv.estimated_total_commission), 0) as total_est_commission,
        COUNT(DISTINCT conv.id) as total_orders
      FROM affiliate_content_items c
      LEFT JOIN affiliate_conversions conv ON c.id = conv.content_id
      WHERE c.created_at >= CURRENT_DATE;
    `);

    return res.rows[0];
  }

  /**
   * STEP 5B: GỬI BÁO CÁO DOANH THU HÀNG NGÀY QUA SLACK
   */
  async sendSlackDailyReport() {
    const token = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ID;

    if (!token || !channel) {
      console.warn('[SLACK_REPORT] SLACK_BOT_TOKEN or SLACK_CHANNEL_ID is missing. Skipping report.');
      return null;
    }

    const summary = await this.getDailySummary();
    const totalPosts = Number(summary.total_posts || 0);
    const totalOrders = Number(summary.total_orders || 0);
    const totalComm = Number(summary.total_est_commission || 0).toLocaleString('vi-VN');
    const formattedDate = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📊 BÁO CÁO DOANH THU SHOPEE AFFILIATE',
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*🏠 Fanpage:*\nNhà Có Món Hay`
          },
          {
            type: 'mrkdwn',
            text: `*📅 Ngày báo cáo:*\n${formattedDate}`
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*📝 Bài đăng hôm nay:*\n*${totalPosts}* bài`
          },
          {
            type: 'mrkdwn',
            text: `*📦 Đơn hàng phát sinh:*\n*${totalOrders}* đơn`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*💰 Hoa hồng ước tính:* \`${totalComm} đ\``
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🤖 *Tối ưu hóa AI:* Hệ thống đang vận hành tự động theo thuật toán Bandit & Gemini AI.'
          }
        ]
      }
    ];

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel,
        text: `📊 Báo cáo Shopee Affiliate ngày ${formattedDate}: ${totalPosts} bài, ${totalOrders} đơn, ${totalComm} đ hoa hồng`,
        blocks
      })
    });

    const data = await res.json();
    console.log(`[SLACK_REPORT] Sent report to Slack: success = ${data.ok}`);
    return data;
  }
}

module.exports = AffiliateOrchestrator;

// CLI Direct Runner
if (require.main === module) {
  const orchestrator = new AffiliateOrchestrator();
  const arg = process.argv[2];

  (async () => {
    try {
      if (arg === '--hunt') {
        await orchestrator.runProductHunterAndScorer();
      } else if (arg === '--import-links') {
        const linksArg = process.argv.slice(3).join(' ');
        const res = await orchestrator.runManualLinkIntake(linksArg);
        console.log('Intake Summary:', JSON.stringify(res, null, 2));
      } else if (arg === '--import-file') {
        const fs = require('fs');
        const filePath = process.argv[3];
        if (!filePath || !fs.existsSync(filePath)) {
          throw new Error('File not found: ' + filePath);
        }
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const res = await orchestrator.runManualLinkIntake(fileContent);
        console.log('Intake Summary:', JSON.stringify(res, null, 2));
      } else if (arg === '--manual-cycle') {
        const linksArg = process.argv.slice(3).join(' ');
        console.log('=== RUNNING MANUAL CYCLE (INTAKE + GENERATE + PUBLISH) ===');
        if (linksArg) {
          await orchestrator.runManualLinkIntake(linksArg);
        }
        await orchestrator.runContentFactoryAndQA();
        await orchestrator.runPublisherQueue(true);
        const summary = await orchestrator.getDailySummary();
        console.log('=== MANUAL CYCLE COMPLETE ===\nDaily Summary:', summary);
        await orchestrator.sendSlackDailyReport();
      } else if (arg === '--generate') {
        await orchestrator.runContentFactoryAndQA();
      } else if (arg === '--publish' || arg === '--publish-now') {
        await orchestrator.runPublisherQueue(arg === '--publish-now');
      } else if (arg === '--reconcile') {
        await orchestrator.runConversionReconciler();
      } else if (arg === '--slack-report') {
        const res = await orchestrator.sendSlackDailyReport();
        console.log('Slack Report Status:', res?.ok ? 'SUCCESS' : 'FAILED');
      } else if (arg === '--all') {
        console.log('=== RUNNING FULL END-TO-END AUTOMATION CYCLE ===');
        await orchestrator.runProductHunterAndScorer();
        await orchestrator.runContentFactoryAndQA();
        await orchestrator.runPublisherQueue();
        await orchestrator.runConversionReconciler();
        const summary = await orchestrator.getDailySummary();
        console.log('=== CYCLE COMPLETE ===\nDaily Summary:', summary);
        await orchestrator.sendSlackDailyReport();
      } else {
        console.log('Usage: node orchestrator.js [--hunt | --import-links "..." | --import-file path | --manual-cycle "..." | --generate | --publish | --reconcile | --slack-report | --all]');
      }
      process.exit(0);
    } catch (e) {
      console.error('Fatal Error:', e);
      process.exit(1);
    }
  })();
}
