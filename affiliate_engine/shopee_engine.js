/**
 * SHOPEE AFFILIATE OPEN API ENGINE
 * Brand: Nhà Có Món Hay
 * Documentation: Shopee Affiliate Open Platform (GraphQL over HTTPS POST)
 */

const crypto = require('crypto');

class ShopeeAffiliateEngine {
  constructor(config = {}) {
    this.appId = config.appId || process.env.SHOPEE_APP_ID || '';
    this.appSecret = config.appSecret || process.env.SHOPEE_APP_SECRET || '';
    this.baseUrl = config.baseUrl || 'https://open-api.affiliate.shopee.vn/graphql';
    this.isSimulation = !this.appId || !this.appSecret || config.simulation === true;
  }

  /**
   * Tính toán chữ ký HMAC-SHA256 chuẩn Shopee Affiliate Open Platform
   * Header: Authorization: SHA256 Credential={appId}, Timestamp={timestamp}, Signature={signature}
   */
  generateAuthHeader(payloadString, timestamp = null) {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    const factor = `${this.appId}${ts}${payloadString}${this.appSecret}`;
    const signature = crypto.createHmac('sha256', this.appSecret).update(factor).digest('hex');

    return {
      'Content-Type': 'application/json',
      'Authorization': `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${signature}`
    };
  }

  /**
   * Truy vấn danh sách sản phẩm Hot từ Shopee Affiliate
   * GraphQL Query: productOfferV2
   */
  async queryProductOffers({ page = 1, limit = 20, keyword = 'tiện ích gia đình', sortType = 2, listType = 0 } = {}) {
    if (this.isSimulation) {
      return this._getMockProductOffers(keyword, limit);
    }

    const query = `
      query GetProductOffers($page: Int, $limit: Int, $keyword: String, $sortType: Int, $listType: Int) {
        productOfferV2(page: $page, limit: $limit, keyword: $keyword, sortType: $sortType, listType: $listType) {
          nodes {
            itemId
            shopId
            productName
            productLink
            imageUrl
            price
            priceMin
            priceMax
            originalPrice
            discount
            commissionRate
            commission
            sales
            ratingStar
            shopName
            shopType
          }
          pageInfo {
            page
            limit
            total
          }
        }
      }
    `;

    const payload = JSON.stringify({
      query,
      variables: { page, limit, keyword, sortType, listType }
    });

    const headers = this.generateAuthHeader(payload);
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: payload
    });

    if (!response.ok) {
      throw new Error(`Shopee API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.errors) {
      throw new Error(`Shopee GraphQL Error: ${JSON.stringify(data.errors)}`);
    }

    return data.data.productOfferV2.nodes;
  }

  /**
   * Tạo Affiliate ShortLink có gắn SubID đa tầng
   * GraphQL Mutation: generateShortLink
   */
  async generateShortLink({ originUrl, subIds = [] }) {
    // subIds max 5 items: [subId1, subId2, subId3, subId4, subId5]
    const cleanSubIds = subIds.slice(0, 5).map(s => String(s).substring(0, 50));

    if (this.isSimulation) {
      const mockHash = crypto.createHash('md5').update(originUrl + cleanSubIds.join('_')).digest('hex').substring(0, 7);
      return {
        shortLink: `https://s.shopee.vn/${mockHash}`,
        subIds: cleanSubIds
      };
    }

    const query = `
      mutation GenerateShortLink($input: ShortLinkInput!) {
        generateShortLink(input: $input) {
          shortLink
        }
      }
    `;

    const payload = JSON.stringify({
      query,
      variables: {
        input: {
          originUrl,
          subIds: cleanSubIds
        }
      }
    });

    const headers = this.generateAuthHeader(payload);
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: payload
    });

    if (!response.ok) {
      throw new Error(`Shopee API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.errors) {
      throw new Error(`Shopee GraphQL Error: ${JSON.stringify(data.errors)}`);
    }

    return {
      shortLink: data.data.generateShortLink.shortLink,
      subIds: cleanSubIds
    };
  }

  /**
   * Truy vấn Báo cáo Đơn hàng & Hoa hồng
   * GraphQL Query: conversionReport
   */
  async getConversionReport({ purchaseTimeStart, purchaseTimeEnd, page = 1, limit = 50 } = {}) {
    if (this.isSimulation) {
      return this._getMockConversions(limit);
    }

    const query = `
      query GetConversionReport($purchaseTimeStart: Int!, $purchaseTimeEnd: Int!, $page: Int, $limit: Int) {
        conversionReport(purchaseTimeStart: $purchaseTimeStart, purchaseTimeEnd: $purchaseTimeEnd, page: $page, limit: $limit) {
          nodes {
            orderId
            orderStatus
            purchaseTime
            totalCommission
            sellerCommission
            shopeeCommission
            subId1
            subId2
            subId3
            subId4
            subId5
            items {
              itemId
              itemName
              itemPrice
              qty
              commission
            }
          }
        }
      }
    `;

    const payload = JSON.stringify({
      query,
      variables: { purchaseTimeStart, purchaseTimeEnd, page, limit }
    });

    const headers = this.generateAuthHeader(payload);
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: payload
    });

    if (!response.ok) {
      throw new Error(`Shopee API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.errors) {
      throw new Error(`Shopee GraphQL Error: ${JSON.stringify(data.errors)}`);
    }

    return data.data.conversionReport.nodes;
  }

  /**
   * Dữ liệu mô phỏng sát thực tế cho Niche "Nhà Có Món Hay"
   */
  _getMockProductOffers(keyword, limit) {
    const mockCatalog = [
      {
        itemId: 23901827361,
        shopId: 88127364,
        productName: 'Kệ treo nắp vung xoong nồi và thớt gắn tường thông minh không cần khoan đục',
        productLink: 'https://shopee.vn/product/88127364/23901827361',
        imageUrl: 'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lstt02k7u02la3',
        price: 79000,
        originalPrice: 135000,
        discount: 41,
        commissionRate: 11.5,
        commission: 9085,
        sales: 4820,
        ratingStar: 4.88,
        shopName: 'Gia Dụng Thông Minh Ecoco Mall',
        shopType: 'OFFICIAL_MALL',
        imageUrls: [
          'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lstt02k7u02la3',
          'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lstt02k7vgj112',
          'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lstt02k7wx3ha4'
        ],
        rawSpecs: {
          material: 'Thép carbon không gỉ cao cấp phủ sơn tĩnh điện',
          installation: 'Keo dán tường siêu chịu lực Sealant Fix tải trọng 15kg',
          dimensions: '26cm x 15cm x 6cm',
          highlight: 'Khay hứng nước thừa có thể tháo rời vệ sinh sạch sẽ'
        }
      },
      {
        itemId: 19823746501,
        shopId: 44928172,
        productName: 'Đèn LED thanh cảm ứng chuyển động gắn góc tối tủ bếp và tủ quần áo sạc pin Type-C',
        productLink: 'https://shopee.vn/product/44928172/19823746501',
        imageUrl: 'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lsi3746182736',
        price: 119000,
        originalPrice: 210000,
        discount: 43,
        commissionRate: 9.8,
        commission: 11662,
        sales: 8940,
        ratingStar: 4.91,
        shopName: 'Baseus Official Home Store',
        shopType: 'OFFICIAL_MALL',
        imageUrls: [
          'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lsi3746182736',
          'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lsi3746199823'
        ],
        rawSpecs: {
          sensor: 'Cảm biến hồng ngoại PIR góc quét 120 độ tự bật khi có người',
          battery: '1200mAh sạc nhanh Type-C dùng liên tục 60 ngày ở chế độ Auto',
          mounting: 'Nam châm hít từ tính tiện tháo gỡ mang đi sạc',
          lightColor: 'Vàng ấm 3000K bảo vệ mắt'
        }
      },
      {
        itemId: 31092847562,
        shopId: 19283746,
        productName: 'Hộp đựng ổ cắm dây điện chống cháy giấu dây đa năng nắp gỗ decor bàn làm việc',
        productLink: 'https://shopee.vn/product/19283746/31092847562',
        imageUrl: 'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lsm9283746519',
        price: 85000,
        originalPrice: 150000,
        discount: 43,
        commissionRate: 10.2,
        commission: 8670,
        sales: 3200,
        ratingStar: 4.85,
        shopName: 'Decor Nhà Đẹp Preferred',
        shopType: 'PREFERRED',
        imageUrls: [
          'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lsm9283746519',
          'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-lsm9283746520'
        ],
        rawSpecs: {
          material: 'Nhựa ABS nguyên sinh chống cháy + nắp vân gỗ tự nhiên',
          ventilation: 'Các khe rãnh tản nhiệt ở đáy tránh nóng ổ điện',
          dimensions: '30cm x 13cm x 11cm vừa khít các loại ổ cắm dài'
        }
      }
    ];

    return mockCatalog.slice(0, limit);
  }

  _getMockConversions(limit) {
    return [
      {
        orderId: `VN${Date.now()}A1`,
        orderStatus: 'COMPLETED',
        purchaseTime: Math.floor(Date.now() / 1000) - 3600,
        totalCommission: 18170,
        subId1: 'P_23901827361',
        subId2: 'C_simulated_01',
        subId3: 'A_PROB_SOL',
        subId4: 'FBPAGE',
        subId5: 'T_1130'
      }
    ];
  }

  /**
   * Trích xuất các ảnh thực tế chất lượng cao từ trang sản phẩm Shopee
   * Đảm bảo ảnh đăng lên giống 100% sản phẩm thật của nhà bán
   */
  async fetchRealProductImages(productUrl) {
    if (!productUrl || !productUrl.startsWith('http')) return [];
    try {
      const res = await fetch(productUrl, {
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.html)'
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) return [];
      const html = await res.text();
      const matches = html.match(/https:\/\/down-vn\.img\.susercontent\.com\/file\/[a-zA-Z0-9_-]+/g);
      if (!matches) return [];

      // Lọc bỏ ảnh trùng lặp
      const unique = [...new Set(matches)];
      // Lọc bỏ ảnh banner/icon hệ thống thường dùng chung
      const cleanImages = unique.filter(url => !url.includes('msawilmxwtttb5') && !url.includes('svg'));
      return cleanImages.slice(0, 4);
    } catch (err) {
      console.warn(`[SHOPEE_IMG] Could not extract images for ${productUrl}: ${err.message}`);
      return [];
    }
  }
}

module.exports = ShopeeAffiliateEngine;
