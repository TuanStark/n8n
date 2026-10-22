#!/usr/bin/env python3
import sys
import os
import urllib.request
import urllib.parse
import json
import re

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
    if len(sys.argv) < 3:
        print("Usage: python3 exchange_channel_code.py <channel_id> '<CODE_OR_REDIRECT_URL>'")
        sys.exit(1)

    channel_id = sys.argv[1].strip()
    raw_input = sys.argv[2].strip()
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
    sanitized_key = channel_id.upper().replace("-", "_").replace(".", "_")
    client_id = env.get(f"YOUTUBE_{sanitized_key}_CLIENT_ID") or env.get("YOUTUBE_CLIENT_ID")
    client_secret = env.get(f"YOUTUBE_{sanitized_key}_CLIENT_SECRET") or env.get("YOUTUBE_CLIENT_SECRET")
    redirect_uri = "http://localhost:4199/oauth2callback"

    if not client_id or not client_secret:
        print(f"❌ Error: Client ID or Secret missing for channel {channel_id}")
        sys.exit(1)

    print(f"⏳ Exchanging authorization code with Google for {channel_id}...")
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
        sys.exit(1)

    print(f"🎉 Success! Received refresh_token: {refresh_token[:15]}...")
    target_key = f"YOUTUBE_{sanitized_key}_REFRESH_TOKEN"
    update_env(target_key, refresh_token)

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
                print(f"📺 Verified YouTube Channel: [{channel_name}] (ID: {items[0]['id']})")
    except Exception as e:
        print(f"⚠️ Could not verify channel: {e}")

    # Update database directly via curl or API
    try:
        payload = json.dumps({
            "id": channel_id,
            "name": channel_name if 'channel_name' in locals() else channel_id,
            "genreKey": "dark_stoic" if "stoic" in channel_id else ("cyberpunk_tech" if "tech" in channel_id else "paper_history"),
            "credentials": {
                "clientId": client_id,
                "clientSecret": client_secret,
                "refreshToken": refresh_token
            }
        }).encode("utf-8")
        api_req = urllib.request.Request(
            "http://localhost:4100/api/v2/channels/configure",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(api_req) as api_resp:
            print(f"✅ Saved credentials to database for channel [{channel_id}]!")
    except Exception as e:
        print(f"⚠️ Note on DB update: {e}")

    print(f"\n✨ Channel [{channel_id}] is fully configured and ready!")

if __name__ == "__main__":
    main()
