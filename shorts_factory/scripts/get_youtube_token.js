const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Path to .env file
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
  console.log(`\n✅ Successfully saved ${key} into ${envPath}!`);
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

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('       YOUTUBE REFRESH TOKEN GENERATOR (Shorts Factory)       ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const env = loadEnv();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  let clientId = env.YOUTUBE_CLIENT_ID;
  let clientSecret = env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || clientId.trim() === '') {
    clientId = await question('👉 Enter your YOUTUBE_CLIENT_ID: ');
    clientId = clientId.trim();
    if (clientId) updateEnv('YOUTUBE_CLIENT_ID', clientId);
  } else {
    console.log(`ℹ️ Using YOUTUBE_CLIENT_ID from .env: ${clientId.slice(0, 15)}...`);
  }

  if (!clientSecret || clientSecret.trim() === '') {
    clientSecret = await question('👉 Enter your YOUTUBE_CLIENT_SECRET: ');
    clientSecret = clientSecret.trim();
    if (clientSecret) updateEnv('YOUTUBE_CLIENT_SECRET', clientSecret);
  } else {
    console.log(`ℹ️ Using YOUTUBE_CLIENT_SECRET from .env: ${clientSecret.slice(0, 6)}...`);
  }

  if (!clientId || !clientSecret) {
    console.error('\n❌ Error: Both Client ID and Client Secret are required!');
    rl.close();
    process.exit(1);
  }

  const PORT = 4199;
  const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

  // Scopes for YouTube Upload and Channel access
  const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube',
  ].join(' ');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(SCOPES)}&` +
    `access_type=offline&` +
    `prompt=consent`;

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('📌 STEP 1: Ensure your Google Cloud Console has this Redirect URI:');
  console.log(`   ${REDIRECT_URI}`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log('📌 STEP 2: Open this URL in your web browser:');
  console.log(`\n${authUrl}\n`);
  console.log('───────────────────────────────────────────────────────────────');

  let server;

  // Handler for authorization code
  async function handleCode(code) {
    console.log('\n⏳ Exchanging authorization code with Google for tokens...');
    try {
      const tokens = await exchangeCodeForTokens(clientId, clientSecret, code, REDIRECT_URI);
      
      console.log('\n🎉 SUCCESS! Received OAuth Tokens from Google:');
      console.log('───────────────────────────────────────────────────────────────');
      if (tokens.refresh_token) {
        console.log(`🔑 YOUTUBE_REFRESH_TOKEN:\n${tokens.refresh_token}\n`);
        updateEnv('YOUTUBE_REFRESH_TOKEN', tokens.refresh_token);
        console.log('✅ Updated .env automatically!');
      } else {
        console.warn('⚠️ Warning: No refresh_token returned.');
        console.warn('This happens if consent was previously granted without prompt=consent.');
        console.warn('Revoke app access at https://myaccount.google.com/permissions and run again.');
      }
      console.log('───────────────────────────────────────────────────────────────');
    } catch (err) {
      console.error('\n❌ Token Exchange Failed:', err.message);
    } finally {
      if (server) server.close();
      rl.close();
      process.exit(0);
    }
  }

  // Start local listener
  server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    if (reqUrl.pathname === '/oauth2callback') {
      const code = reqUrl.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <div style="font-family:sans-serif; text-align:center; padding:50px;">
            <h1 style="color:#2e7d32;">✅ Authorization Successful!</h1>
            <p>You can close this tab and return to your terminal.</p>
          </div>
        `);
        await handleCode(code);
      } else {
        const error = reqUrl.searchParams.get('error');
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>❌ Authorization Failed: ${error}</h1>`);
        console.error('\n❌ Google returned error:', error);
      }
    }
  });

  server.listen(PORT, () => {
    console.log(`🎧 Listening locally on http://localhost:${PORT}/oauth2callback`);
  });

  console.log('\n📌 STEP 3:');
  console.log('   • Option A: If your browser can reach localhost:4199, it will capture it automatically.');
  console.log('   • Option B: If browsing from remote, paste the full redirected URL (or code) below:');

  const pasted = await question('\n👉 Paste redirect URL or Code here (or press Enter if using Option A): ');
  const trimmedPasted = pasted.trim();

  if (trimmedPasted) {
    let code = trimmedPasted;
    if (trimmedPasted.includes('code=')) {
      const parsed = new URL(trimmedPasted.startsWith('http') ? trimmedPasted : `http://dummy/?${trimmedPasted}`);
      code = parsed.searchParams.get('code') || trimmedPasted;
    }
    await handleCode(code);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
