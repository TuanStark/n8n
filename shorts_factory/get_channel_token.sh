#!/bin/bash
# ==============================================================================
# YouTube Multi-Channel Refresh Token Helper Tool for Shorts Factory
# Usage:
#   ./get_channel_token.sh [channel_id]
# Examples:
#   ./get_channel_token.sh channel_02_tech
#   ./get_channel_token.sh channel_03_stoic
# ==============================================================================

cd /opt/n8n/shorts_factory || exit 1

docker run --rm -it \
  --network host \
  -v /opt/n8n/shorts_factory:/app \
  -w /app \
  shorts-factory-stack-shorts-worker:latest \
  node scripts/get_channel_token.js "$@"
