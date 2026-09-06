#!/bin/bash
# ==============================================================================
# YouTube Refresh Token Helper Tool for Shorts Factory
# ==============================================================================

cd /opt/n8n/shorts_factory || exit 1

echo "Starting YouTube OAuth Helper Tool..."

docker run --rm -it \
  --network n8n-prod_n8n_internal \
  -p 4199:4199 \
  -v /opt/n8n/shorts_factory:/app \
  -w /app \
  node:20-bookworm-slim \
  node scripts/get_youtube_token.js
