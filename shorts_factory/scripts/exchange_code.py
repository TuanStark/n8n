#!/usr/bin/env python3
import sys
import os
import urllib.request
import urllib.parse
import json
import re
import subprocess

ENV_FILE = "/opt/n8n/shorts_factory/.env"

def load_env():
    env = {}
    if not os.path.exists(ENV_FILE):
        return env
    with open(ENV_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("'\"")
    return env

def update_env(key, value):
    with open(ENV_FILE, "r") as f:
        content = f.read()
    pattern = rf"^{key}=.*$"
    if re.search(pattern, content, flags=re.MULTILINE):
        new_content = re.sub(pattern, f"{key}={value}", content, flags=re.MULTILINE)
    else:
        new_content = content + f"\n{key}={value}\n"
    with open(ENV_FILE, "w") as f:
        f.write(new_content)
    print(f"✅ Updated {key} in {ENV_FILE}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 exchange_code.py '<CODE_OR_REDIRECT_URL>'")
        sys.exit(1)

    raw_input = sys.argv[1].strip()
    code = raw_input

    # Extract code if full URL was pasted
    if "code=" in raw_input:
        if raw_input.startswith("http"):
            parsed = urllib.parse.urlparse(raw_input)
            params = urllib.parse.parse_qs(parsed.query)
            code = params.get("code", [raw_input])[0]
        else:
            query = raw_input.split("?", 1)[-1] if "?" in raw_input else raw_input
            params = urllib.parse.parse_qs(query)
            code = params.get("code", [raw_input])[0]

    env = load_env()
    client_id = env.get("YOUTUBE_CLIENT_ID")
    client_secret = env.get("YOUTUBE_CLIENT_SECRET")
    redirect_uri = "http://localhost:4199/oauth2callback"

    if not client_id or not client_secret:
        print("❌ Error: YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET missing from .env")
        sys.exit(1)

    print(f"⏳ Exchanging authorization code for tokens...")
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    try:
        with urllib.request.urlopen(req) as resp:
            tokens = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8")
        print(f"❌ Failed to exchange code: HTTP {e.code} - {err}")
        sys.exit(1)

    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")

    if not refresh_token:
        print("⚠️ Warning: No refresh_token returned by Google!")
        print("Google only returns refresh_token on the first authorization or when prompt=consent is used.")
        print("Full response:", json.dumps(tokens, indent=2))
        sys.exit(1)

    print(f"🎉 Success! Received refresh_token: {refresh_token[:15]}...")
    update_env("YOUTUBE_REFRESH_TOKEN", refresh_token)

    # Test YouTube API call
    yt_req = urllib.request.Request(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        headers={"Authorization": f"Bearer {access_token}"}
    )
    try:
        with urllib.request.urlopen(yt_req) as yt_resp:
            yt_data = json.loads(yt_resp.read().decode("utf-8"))
            items = yt_data.get("items", [])
            if items:
                channel_name = items[0]["snippet"]["title"]
                print(f"📺 Verified YouTube Channel: {channel_name} (ID: {items[0]['id']})")
            else:
                print("⚠️ Connected to YouTube, but no channel found for this Google account.")
    except Exception as e:
        print(f"⚠️ Could not verify channel: {e}")

    # Restart shorts-factory-worker
    print("🔄 Restarting docker container shorts-factory-worker...")
    subprocess.run(["docker", "restart", "shorts-factory-worker"], check=True)
    print("✅ All done! shorts-factory-worker restarted with new token.")

if __name__ == "__main__":
    main()
