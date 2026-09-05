# HƯỚNG DẪN VẬN HÀNH: SHOPEE AFFILIATE AUTOMATION MACHINE
**Brand:** Nhà Có Món Hay  
**Positioning:** "Những món nhỏ, cuộc sống tiện hơn"  
**Niche:** Đồ gia dụng thông minh / Tiện ích đời sống  

---

## 1. Cấu trúc Thư mục Hệ thống
Hệ thống được tổ chức hoàn chỉnh tại `/opt/n8n/`:

```text
/opt/n8n/
├── affiliate_engine/              # Module lõi xử lý API và AI
│   ├── shopee_engine.js           # Shopee GraphQL API & HMAC-SHA256 Signer (Bảo lưu cho API)
│   ├── meta_engine.js             # Meta Graph API v20.0 Multi-photo & Comment
│   ├── ai_engine.js               # Gemini AI (Scorer, Copywriter, QA, Bandit, Link Enricher)
│   ├── orchestrator.js            # Điều phối chu trình tự động (Hỗ trợ cả Manual Links & API)
│   └── package.json               # Dependencies (pg, v.v.)
│
├── affiliate_workflows/           # 6 Workflow n8n sản xuất
│   ├── WF01_Shopee_Product_Hunter_and_Scorer.json   # Luồng Tương lai: Săn tự động qua Shopee API
│   ├── WF01B_Shopee_Manual_Link_Intake.json         # Luồng Hiện tại: Nạp 20 link thủ công hàng ngày
│   ├── WF02_Content_Factory_and_QA_Guard.json       # Sản xuất bài viết & gắn link tiếp thị
│   ├── WF03_Publishing_Queue_and_FB_Publisher.json  # Đăng bài kèm ảnh lên Fanpage
│   ├── WF04_Analytics_Conversion_Reconciler.json    # Đối soát đơn hàng hoa hồng
│   └── WF05_AI_Optimizer_and_Slack_Reporter.json    # Báo cáo doanh thu hàng ngày qua Slack Bot
│
├── init_affiliate_schema.sql      # Schema PostgreSQL 16 hoàn chỉnh
├── .env.affiliate.example         # File mẫu cấu hình biến môi trường
└── README_AFFILIATE_SETUP.md      # Hướng dẫn này
```

---

## 2. Vận Hành Hiện Tại: Nạp 20 Link Sản Phẩm Mỗi Ngày (Chưa Cần API)

Khi chưa có Shopee Open API, bạn có thể gửi 20 link sản phẩm mỗi ngày qua 3 cách cực kỳ thuận tiện:

### Cách 1: Qua Giao Diện Web Form n8n (Khuyên dùng trên Điện Thoại / Máy Tính)
1. Mở trình duyệt truy cập:
   👉 **`https://n8n.miniappify.vn/form/shopee-links`**
2. Dán danh sách 20 link vào ô nhập liệu.
3. Nhấn nút **"Gửi Danh Sách Sản Phẩm"**. Hệ thống sẽ tự động giải mã thông tin, AI chấm điểm và lập tức chuyển sang tạo bài viết.

### Cách 2: Qua Lệnh Dòng Lệnh CLI Trực Tiếp Trên Server
```bash
# Dán trực tiếp danh sách link (phân tách bởi khoảng trắng hoặc dấu phẩy):
docker exec -w /home/node/.n8n/affiliate_engine -u root n8n-prod-n8n node orchestrator.js --import-links "https://shopee.vn/... https://shopee.vn/..."

# Hoặc tạo sẵn 1 file txt chứa 20 link (mỗi dòng 1 link) rồi nạp vào:
docker exec -w /home/node/.n8n/affiliate_engine -u root n8n-prod-n8n node orchestrator.js --import-file /home/node/.n8n/daily_links.txt

# Chạy trọn gói cả chu trình Nạp link -> Tạo bài -> Xếp hàng đăng:
docker exec -w /home/node/.n8n/affiliate_engine -u root n8n-prod-n8n node orchestrator.js --manual-cycle "https://shopee.vn/..."
```

### Cách 3: Qua Webhook HTTP API (Dành cho Tự động hóa / Postman / App thứ 3)
```bash
curl -X POST https://n8n.miniappify.vn/webhook/shopee-daily-intake \
  -H "Content-Type: application/json" \
  -d '{"links": "https://shopee.vn/link-1\nhttps://shopee.vn/link-2"}'
```

### 💡 Định dạng Link Khuyên Dùng
Bạn có thể nhập link theo một trong các định dạng sau:
1. **Dạng chuẩn nhất (Đảm bảo 100% nhận hoa hồng thật):**
   ```text
   [Link Gốc Shopee] | [Link Rút Gọn Tiếp Thị Bạn Tự Tạo] | [Giá (tuỳ chọn)]
   ```
   *Ví dụ:*
   `https://shopee.vn/Hop-Dung-Giay-Ve-Sinh-i.188445942.23849791480 | https://s.shopee.vn/8A9bCdEfg | 85000`
   *(Link rút gọn bạn lấy từ mục **Tạo Link Tùy Chỉnh** trên [affiliate.shopee.vn](https://affiliate.shopee.vn) hoặc nút Chia sẻ trên App Shopee)*.

2. **Dạng đơn giản:**
   Dán trực tiếp danh sách link sản phẩm Shopee hoặc link `https://s.shopee.vn/...` (1 link mỗi dòng). Hệ thống dùng Gemini AI tự động chuẩn hóa tên sản phẩm tiếng Việt, suy luận tính năng và định giá thị trường.

---

## 3. Vận Hành Tương Lai: Chuyển Sang Tự Động Hoàn Toàn Bằng Shopee Open API

Toàn bộ mã nguồn Shopee GraphQL API, chữ ký HMAC-SHA256 và workflow tự động săn sản phẩm **được bảo lưu nguyên vẹn 100%** trong hệ thống.

Khi tài khoản Shopee Affiliate Open API của bạn được phê duyệt:
1. Truy cập [https://affiliate.shopee.vn/open_api](https://affiliate.shopee.vn/open_api) lấy `App ID` và `App Secret`.
2. Mở file `/opt/n8n/.env` thêm 2 dòng:
   ```env
   SHOPEE_APP_ID=your_app_id
   SHOPEE_APP_SECRET=your_app_secret
   ```
3. Khởi động lại n8n:
   ```bash
   cd /opt/n8n && docker compose restart n8n
   ```
4. Vào giao diện n8n bật toggle **Active** cho workflow `WF01_Shopee_Product_Hunter_and_Scorer`.
$\rightarrow$ Hệ thống sẽ ngay lập tức tự động quét sản phẩm Hot, chấm điểm AI, tự động sinh ShortLink kèm SubID tracking đa tầng và đối soát doanh thu mà không cần bạn phải dán link thủ công nữa!

---

## 4. Kiểm Thử Nhanh Các Chức Năng (CLI Commands)

```bash
# 1. Thử nạp 1 link sản phẩm thủ công:
docker exec -w /home/node/.n8n/affiliate_engine -u root n8n-prod-n8n node orchestrator.js --import-links "https://shopee.vn/Hop-Dung-Giay-Ve-Sinh-i.188445942.23849791480 | https://s.shopee.vn/8A9bCdEfg | 85000"

# 2. Sinh bài viết Facebook AI và kiểm duyệt chất lượng QA:
docker exec -w /home/node/.n8n/affiliate_engine -u root n8n-prod-n8n node orchestrator.js --generate

# 3. Xuất bản bài viết đến hạn lên Fanpage:
docker exec -w /home/node/.n8n/affiliate_engine -u root n8n-prod-n8n node orchestrator.js --publish

# 4. Xem báo cáo tổng quan ngày:
docker exec -w /home/node/.n8n/affiliate_engine -u root n8n-prod-n8n node -e "const O = require('./orchestrator'); new O().getDailySummary().then(console.log);"
```

---

## 5. Import Workflows vào Giao Diện n8n
1. Mở giao diện n8n tại: `https://n8n.miniappify.vn`
2. Vào mục **Workflows** $\rightarrow$ **Add Workflow** $\rightarrow$ **Import from File**.
3. Import 6 file workflow trong thư mục `/opt/n8n/affiliate_workflows/`:
   - `WF01B_Shopee_Manual_Link_Intake.json` (**Bật Active** để nhận link qua Form/Webhook)
   - `WF01_Shopee_Product_Hunter_and_Scorer.json` (Để sẵn, bật khi có API)
   - `WF02_Content_Factory_and_QA_Guard.json` (**Bật Active**)
   - `WF03_Publishing_Queue_and_FB_Publisher.json` (**Bật Active**)
   - `WF04_Analytics_Conversion_Reconciler.json` (**Bật Active**)
   - `WF05_AI_Optimizer_and_Slack_Reporter.json` (**Bật Active**)
