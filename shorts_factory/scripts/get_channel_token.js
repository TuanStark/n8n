const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.resolve(__dirname, '../.env');

function loadEnv() {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      env[key] = val;
    }
  });
  return env;
}

function updateEnv(key, value) {
  if (!fs.existsSync(envPath)) return;
  let content = fs.readFileSync(envPath, 'utf-8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(envPath, content, 'utf-8');
  console.log(`✅ Saved ${key} in .env`);
}

async function exchangeCodeForTokens(clientId, clientSecret, code, redirectUri) {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google OAuth error: ${JSON.stringify(data)}`);
  }
  return data;
}

async function verifyChannel(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      const item = data.items?.[0];
      if (item) {
        return {
          title: item.snippet?.title || 'Unknown Channel',
          id: item.id || '',
        };
      }
    }
  } catch (e) {
    // Non-fatal
  }
  return null;
}

async function saveToDatabase(channelId, clientId, clientSecret, refreshToken) {
  try {
    const res = await fetch('http://localhost:4100/api/v2/channels/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: channelId,
        name: channelId === 'channel_02_tech' ? 'Quantum Horizon (Tech & AI)' : (channelId === 'channel_03_stoic' ? 'Iron Mind (Dark Stoicism)' : channelId),
        genreKey: channelId === 'channel_02_tech' ? 'cyberpunk_tech' : (channelId === 'channel_03_stoic' ? 'dark_stoic' : 'paper_history'),
        credentials: {
          clientId,
          clientSecret,
          refreshToken,
        },
      }),
    });
    if (res.ok) {
      console.log(`✅ Successfully updated database credentials for channel [${channelId}]!`);
    } else {
      const errText = await res.text();
      console.warn(`⚠️ Warning: Could not update DB directly via API: ${errText}`);
    }
  } catch (err) {
    console.warn(`⚠️ Warning: Could not reach worker API at http://localhost:4100: ${err.message}`);
  }
}

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       YOUTUBE MULTI-CHANNEL OAUTH TOKEN SETUP TOOL                ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const env = loadEnv();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  // 1. Channel Selection
  let channelId = process.argv[2];
  if (!channelId) {
    console.log('Chọn kênh bạn muốn cấp quyền YouTube:');
    console.log('  [1] channel_02_tech   (Quantum Horizon - Tech & AI Shorts)');
    console.log('  [2] channel_03_stoic  (Iron Mind - Dark Stoicism Shorts)');
    console.log('  [3] channel_01_paper  (Paper Theater World - Cập nhật lại)');
    console.log('  [4] Nhập kênh tùy chỉnh khác\n');

    const choice = (await question('👉 Lựa chọn [1/2/3/4]: ')).trim();
    if (choice === '1' || choice === 'channel_02_tech') {
      channelId = 'channel_02_tech';
    } else if (choice === '2' || choice === 'channel_03_stoic') {
      channelId = 'channel_03_stoic';
    } else if (choice === '3' || choice === 'channel_01_paper') {
      channelId = 'channel_01_paper';
    } else {
      channelId = (await question('👉 Nhập ID định danh kênh (ví dụ: channel_04_gaming): ')).trim();
    }
  }

  if (!channelId) {
    console.error('❌ Channel ID không hợp lệ.');
    rl.close();
    process.exit(1);
  }

  console.log(`\n🎯 Đang thiết lập cho kênh: [${channelId}]`);

  // 2. Client ID & Client Secret
  const channelKey = channelId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const specificClientId = env[`YOUTUBE_${channelKey}_CLIENT_ID`];
  const specificClientSecret = env[`YOUTUBE_${channelKey}_CLIENT_SECRET`];

  const defaultClientId = specificClientId || env.YOUTUBE_CLIENT_ID || '';
  const defaultClientSecret = specificClientSecret || env.YOUTUBE_CLIENT_SECRET || '';

  console.log('\n--- BƯỚC 1: CLIENT ID & CLIENT SECRET ---');
  if (specificClientId) {
    console.log(`ℹ️ Đã tìm thấy Client ID riêng cho kênh [${channelId}] trong .env: ${defaultClientId.slice(0, 25)}...`);
  } else {
    console.log('💡 Gợi ý: Bạn có thể dùng chung Client ID & Secret từ Google Cloud của kênh 1!');
    if (defaultClientId) {
      console.log(`Mặc định hiện tại: ${defaultClientId.slice(0, 20)}...`);
    }
  }

  let clientId = (await question(`👉 Nhấn Enter để dùng mặc định (hoặc nhập Client ID mới): `)).trim();
  if (!clientId) clientId = defaultClientId;

  let clientSecret = (await question(`👉 Nhấn Enter để dùng mặc định (hoặc nhập Client Secret mới): `)).trim();
  if (!clientSecret) clientSecret = defaultClientSecret;

  if (!clientId || !clientSecret) {
    console.error('❌ Thiếu Client ID hoặc Client Secret!');
    rl.close();
    process.exit(1);
  }

  const PORT = 4199;
  const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
  const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube',
  ].join(' ');

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(SCOPES)}&` +
    `access_type=offline&` +
    `prompt=consent`;

  console.log('\n--- BƯỚC 2: CẤP QUYỀN TRÊN GOOGLE ---');
  console.log('1. Mở link bên dưới trên trình duyệt:');
  console.log(`\n🔗 ${authUrl}\n`);
  console.log('2. Đăng nhập đúng tài khoản Google quản lý kênh YouTube tương ứng.');
  console.log('3. Chọn đúng KÊNH YOUTUBE bạn muốn cấp quyền.');
  console.log('4. Nhấn "Tiếp tục" / "Cho phép" cho đến khi hoàn tất.');

  let server;

  async function handleCode(code) {
    console.log('\n⏳ Đang gửi mã Code xác thực lên Google để lấy Refresh Token...');
    try {
      const tokens = await exchangeCodeForTokens(clientId, clientSecret, code, REDIRECT_URI);
      const refreshToken = tokens.refresh_token;

      if (!refreshToken) {
        console.warn('⚠️ Google không trả về refresh_token mới (do đã cấp quyền trước đó).');
        console.warn('Vui lòng thu hồi quyền tại https://myaccount.google.com/permissions rồi thử lại.');
        return;
      }

      console.log('\n🎉 THÀNH CÔNG! ĐÃ LẤY ĐƯỢC TOKEN!');
      console.log('─────────────────────────────────────────────────────────────');
      console.log(`🔑 REFRESH TOKEN:\n${refreshToken}\n`);

      // Verify channel
      if (tokens.access_token) {
        const verified = await verifyChannel(tokens.access_token);
        if (verified) {
          console.log(`📺 Kênh YouTube đã liên kết: [${verified.title}] (ID: ${verified.id})`);
        }
      }

      // Save to .env
      const envKey = `YOUTUBE_${channelId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_REFRESH_TOKEN`;
      updateEnv(envKey, refreshToken);

      const envClientKey = `YOUTUBE_${channelId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_CLIENT_ID`;
      updateEnv(envClientKey, clientId);

      const envSecretKey = `YOUTUBE_${channelId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_CLIENT_SECRET`;
      updateEnv(envSecretKey, clientSecret);

      // Save to database
      await saveToDatabase(channelId, clientId, clientSecret, refreshToken);

      console.log('─────────────────────────────────────────────────────────────');
      console.log(`✨ Kênh [${channelId}] đã sẵn sàng sản xuất và tự động đăng video!`);
    } catch (err) {
      console.error('\n❌ Thất bại:', err.message);
    } finally {
      if (server) server.close();
      rl.close();
      process.exit(0);
    }
  }

  // Local listener
  server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    if (reqUrl.pathname === '/oauth2callback') {
      const code = reqUrl.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <div style="font-family:sans-serif; text-align:center; padding:60px;">
            <h1 style="color:#2e7d32;">✅ Cấp quyền thành công cho [${channelId}]!</h1>
            <p>Bạn có thể đóng tab này và quay lại cửa sổ dòng lệnh.</p>
          </div>
        `);
        await handleCode(code);
      } else {
        const error = reqUrl.searchParams.get('error');
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>❌ Cấp quyền thất bại: ${error}</h1>`);
      }
    }
  });

  server.listen(PORT, () => {
    console.log(`\n🎧 Đang chờ phản hồi tại http://localhost:${PORT}/oauth2callback...`);
  });

  console.log('\n--- BƯỚC 3: XÁC THỰC MÃ CODE ---');
  console.log('• Nếu trình duyệt chạy trên máy chủ này, Google sẽ tự chuyển tiếp về port 4199.');
  console.log('• Nếu mở trình duyệt trên máy tính khác, sau khi Google chuyển hướng về trang lỗi (hoặc localhost:4199),');
  console.log('  hãy COPY toàn bộ đường link (hoặc đoạn code=...) và DÁN vào dưới đây:');

  const pasted = await question('\n👉 Dán link chuyển hướng hoặc mã Code vào đây (hoặc để trống nếu chờ tự động): ');
  const trimmed = pasted.trim();
  if (trimmed) {
    let code = trimmed;
    if (trimmed.includes('code=')) {
      const parsed = new URL(trimmed.startsWith('http') ? trimmed : `http://dummy/?${trimmed}`);
      code = parsed.searchParams.get('code') || trimmed;
    }
    await handleCode(code);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
