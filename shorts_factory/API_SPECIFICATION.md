# 📚 AI Shorts Factory — REST API Specification (v2.0)
> **Tài liệu đặc tả kỹ thuật API dành cho Web Dashboard (React, Next.js, Vue) & Tích hợp Client**  
> Phiên bản: `2.0.0` | Kiến trúc: `Clean Architecture / Multi-Tenant` | Cổng dịch vụ: `4100`

---

## 1. Tổng quan & Cấu hình môi trường

* **Base URL Nội bộ (Server / Docker):** `http://127.0.0.1:4100` hoặc `http://shorts-factory-worker:4100`
* **Base URL Công khai (qua Reverse Proxy / Traefik):** `https://<domain-or-subdomain>/api/v2`
* **Content-Type:** `application/json; charset=utf-8`
* **CORS:** Đã kích hoạt cho mọi Origin (`Access-Control-Allow-Origin: *`)

---

## 2. Mô hình thực thể dữ liệu (Data Models / TypeScript Interfaces)

```typescript
// 1. Kênh YouTube & Cấu hình
export interface Channel {
  id: string;               // e.g. "channel_01_paper", "channel_02_tech", "channel_03_stoic"
  name: string;             // e.g. "Quantum Horizon (Tech & AI)"
  genre_key: string;        // e.g. "cyberpunk_tech"
  genre_name?: string;      // e.g. "Futuristic Cyberpunk & Tech Matrix"
  description?: string;
  default_privacy: 'private' | 'unlisted' | 'public';
  default_tags: string[];
  is_active: boolean;
  has_credentials: boolean; // true nếu đã liên kết Google OAuth2
  created_at: string;
}

// 2. Hồ sơ Phong cách Nghệ thuật & Prompt (Genre DNA)
export interface GenreProfile {
  id: string;               // e.g. "dark_stoic"
  name: string;             // e.g. "Dark Stoicism & Tactical Mindset"
  description: string;
  system_prompt_scriptwriter: string; // Prompt đạo diễn cho AGY CLI
  visual_style_prompt: string;        // Positive visual prompt
  visual_negative_prompt: string;     // Negative visual prompt
  tts_provider: 'msedge' | 'elevenlabs' | string;
  tts_voice_id: string;               // e.g. "en-US-AndrewNeural"
  soundscape_preset: string;          // e.g. "dark_ambient", "cyberpunk_synth"
  motion_engine_preset: string;       // e.g. "dramatic_slow_push"
}

// 3. Kết quả sản xuất video (Production Result)
export interface ProductionResult {
  channelId: string;
  channelName: string;
  genreKey: string;
  topicId: string;
  title: string;
  renderJobId: string;
  durationSec: number;
  fileSizeBytes: number;
  cloudinaryUrl: string;     // URL video trực tuyến trên Cloudinary CDN
  cloudinaryPublicId?: string;
  youtubeVideoId?: string;   // Có nếu publishYouTube = true
  youtubeUrl?: string;       // Link Shorts YouTube (https://youtube.com/shorts/...)
  qcResult: {
    overallStatus: 'PASS' | 'WARNING' | 'FAIL';
    styleAdherenceScore: number;
    rejectionReasons: string[];
  };
  purgedLocalDisk: boolean;  // Luôn true khi áp dụng chính sách Zero-Local
}
```

---

## 3. Chi tiết các Endpoint API

### 🟢 3.1. Quản lý Kênh (Channels Management)

#### `GET /api/v2/channels`
Lấy danh sách tất cả các kênh YouTube đã cấu hình trong hệ thống.

* **Response (200 OK):**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "id": "channel_01_paper",
      "name": "Paper Theater World (History)",
      "genre_key": "paper_history",
      "genre_name": "Paper Theater Ancient History",
      "default_privacy": "unlisted",
      "is_active": true,
      "has_credentials": true
    },
    {
      "id": "channel_02_tech",
      "name": "Quantum Horizon (Tech & AI)",
      "genre_key": "cyberpunk_tech",
      "genre_name": "Futuristic Cyberpunk & Tech Matrix",
      "default_privacy": "unlisted",
      "is_active": true,
      "has_credentials": false
    },
    {
      "id": "channel_03_stoic",
      "name": "Iron Mind (Dark Stoicism)",
      "genre_key": "dark_stoic",
      "genre_name": "Dark Stoicism & Tactical Mindset",
      "default_privacy": "unlisted",
      "is_active": true,
      "has_credentials": true
    }
  ]
}
```

---

#### `POST /api/v2/channels/configure`
Thêm mới hoặc cập nhật thông tin nhận diện kênh và gắn tài khoản Google OAuth2 độc lập.

* **Request Body:**
```json
{
  "id": "channel_04_mystery",
  "name": "Midnight Paradox (Science Mystery)",
  "genreKey": "cyberpunk_tech",
  "description": "Unveiling mind-bending scientific paradoxes",
  "defaultPrivacy": "unlisted",
  "defaultTags": ["science", "paradox", "shorts"],
  "credentials": {
    "clientId": "449942607582-xxxx.apps.googleusercontent.com",
    "clientSecret": "GOCSPX-xxxx",
    "refreshToken": "1//0gte8cYX6xxxx"
  }
}
```

* **Response (200 OK):**
```json
{
  "success": true,
  "message": "Channel channel_04_mystery configured successfully."
}
```

---

### 🎨 3.2. Quản lý Thể loại & Phong cách (Genre Profiles / Brand DNA)

#### `GET /api/v2/genres`
Lấy danh sách toàn bộ hồ sơ phong cách nghệ thuật, giọng đọc AI và đạo diễn AGY.

* **Response (200 OK):**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "id": "dark_stoic",
      "name": "Dark Stoicism & Tactical Mindset",
      "description": "Brutally honest ancient philosophy with dramatic chiaroscuro aesthetic",
      "tts_provider": "msedge",
      "tts_voice_id": "en-US-AndrewNeural",
      "soundscape_preset": "dark_ambient",
      "motion_engine_preset": "dramatic_slow_push",
      "visual_style_prompt": "dramatic noir chiaroscuro portrait, ancient Roman marble sculptures...",
      "visual_negative_prompt": "cartoon, anime, oversaturated colors, flat lighting..."
    }
  ]
}
```

---

### 🎬 3.3. Sản xuất Video (Production Pipeline)

#### `POST /api/v2/pipeline/produce`
Kích hoạt toàn bộ quy trình: **AGY Scriptwriting $\to$ Image Generation $\to$ Voiceover $\to$ FFmpeg Compositing $\to$ Cloudinary CDN Offload $\to$ (Tùy chọn) YouTube Publish $\to$ Zero-Local Purge**.

* **Request Body:**
```json
{
  "channelId": "channel_03_stoic",
  "content": {
    "title": "Bí quyết làm chủ cảm xúc của Marcus Aurelius",
    "category": "philosophy",
    "targetDurationSec": 45
  },
  "options": {
    "publishYouTube": false,
    "uploadCloudinary": true,
    "purgeLocalAfterUpload": true,
    "privacyStatus": "unlisted"
  }
}
```

* **Response (200 OK):**
```json
{
  "success": true,
  "message": "Video produced and processed successfully",
  "data": {
    "channelId": "channel_03_stoic",
    "channelName": "Iron Mind (Dark Stoicism)",
    "genreKey": "dark_stoic",
    "topicId": "a1b2c3d4-e5f6-7890",
    "title": "Bí quyết làm chủ cảm xúc của Marcus Aurelius",
    "durationSec": 43.5,
    "fileSizeBytes": 14285090,
    "cloudinaryUrl": "https://res.cloudinary.com/dz6k5kcol/video/upload/v1729750000/shorts_factory/channel_03_stoic/channel_03_stoic_a1b2c3d4.mp4",
    "youtubeVideoId": null,
    "youtubeUrl": null,
    "qcResult": {
      "overallStatus": "PASS",
      "technicalChecks": { "resolution": "1080x1920", "fps": 30 },
      "styleAdherenceScore": 0.98,
      "rejectionReasons": []
    },
    "purgedLocalDisk": true
  }
}
```

---

#### `POST /api/v2/pipeline/batch`
Sản xuất hàng loạt video cho nhiều kênh song song theo ma trận.

* **Request Body:**
```json
{
  "items": [
    {
      "channelId": "channel_02_tech",
      "content": { "title": "Sự trỗi dậy của Robot hình người 2026" },
      "options": { "publishYouTube": false }
    },
    {
      "channelId": "channel_03_stoic",
      "content": { "title": "Tại sao người mạnh mẽ luôn im lặng?" },
      "options": { "publishYouTube": false }
    }
  ]
}
```

* **Response (200 OK):**
```json
{
  "success": true,
  "total": 2,
  "succeeded": 2,
  "failed": 0,
  "data": [ /* mảng kết quả của từng video */ ],
  "errors": []
}
```

---

### 👁️ 3.4. Kiểm duyệt & Phê duyệt Video (Human-in-the-Loop)

#### `GET /api/topics`
Lấy danh sách các video đã tạo, điểm tiềm năng viral và trạng thái.

* **Response (200 OK):**
```json
{
  "success": true,
  "count": 15,
  "data": [
    {
      "id": "e0b240b3-d345-4e38-951c-32b00517ba65",
      "title": "Nghệ thuật kiểm soát tâm trí của Marcus Aurelius",
      "category": "dark_stoic",
      "potential_score": 95,
      "status": "PUBLISHED"
    }
  ]
}
```

---

#### `POST /api/approval/callback`
Phê duyệt video đưa lên YouTube Public, yêu cầu làm lại, hoặc hủy bỏ.

* **Request Body:**
```json
{
  "shortId": "e0b240b3-d345-4e38-951c-32b00517ba65",
  "action": "APPROVE", 
  "feedback": "Kịch bản và hình ảnh rất đạt, chuyển sang chế độ Public"
}
```
*Ghi chú về `action`:*
* `APPROVE`: Đặt video trên YouTube từ unlisted $\to$ **Public**, đổi status sang `PUBLISHED`.
* `REGENERATE`: Đổi status về `IDEA` để hệ thống tự render lại.
* `DISCARD`: Hủy bỏ video và dọn rác.

* **Response (200 OK):**
```json
{
  "success": true,
  "action": "PUBLISHED",
  "videoId": "dQw4w9WgXcQ",
  "youtubeUrl": "https://youtube.com/shorts/dQw4w9WgXcQ"
}
```

---

### ⏱️ 3.5. Tự động hóa Lịch trình (Auto-Scheduler)

#### `GET /api/schedule`
Kiểm tra cấu hình tự động sản xuất theo cron matrix.

* **Response (200 OK):**
```json
{
  "success": true,
  "schedule": {
    "enabled": true,
    "cronExpression": "0 10,18 * * *",
    "timezone": "Asia/Ho_Chi_Minh",
    "nextRun": "2026-10-24T18:00:00.000Z",
    "lastExecutedChannel": "channel_01_paper"
  }
}
```

#### `POST /api/v2/schedule/trigger`
Kích hoạt chạy luân phiên ngay lập tức cho 1 kênh hoặc kênh kế tiếp trong vòng xoay.

* **Request Body:**
```json
{
  "channelId": "channel_02_tech"
}
```

---

### 🩺 3.6. Kiểm tra Sức khỏe Hệ thống (Health & Status)

#### `GET /health`
Kiểm tra kết nối Database, Worker và thư mục Storage.

* **Response (200 OK):**
```json
{
  "status": "ok",
  "service": "shorts-factory-worker",
  "env": "production",
  "database": "connected",
  "dbTime": "2026-10-24T08:25:00.000Z",
  "storage": {
    "rendersExist": true
  }
}
```

---

## 4. Gợi ý cấu trúc Component cho Frontend Dashboard

Dành cho bạn khi code giao diện (React / Next.js / TailwindCSS):

1. **Dashboard Home (`/`)**:
   * Thẻ thống kê: Tổng số kênh, số video đã sản xuất hôm nay, số video chờ duyệt.
   * Quick Action: Form tạo video nhanh (`channelId`, `title`, nút *Bắt đầu Render*).
2. **Quản lý Kênh (`/channels`)**:
   * Danh sách Grid Card các kênh: Logo, Thể loại (Genre), Trạng thái OAuth Google, Quota hôm nay.
   * Modal cấu hình kênh mới & nhập Google OAuth tokens.
3. **Phòng chiếu & Duyệt Video (`/studio`)**:
   * Video Player xem trực tiếp từ `cloudinaryUrl`.
   * Bảng thông tin: Thời lượng, kịch bản trích dẫn, điểm QC.
   * Nhóm nút bấm: **✅ Duyệt & Đăng Public** / **🔄 Làm lại** / **🗑️ Xóa**.
4. **Hồ sơ Thể loại (`/genres`)**:
   * Xem và chỉnh sửa Prompt đạo diễn AGY cho từng phong cách nghệ thuật.
