#!/bin/bash
# ==============================================================================
# AI Shorts Factory - Storage Cleanup Script
# Prunes older rendered files and raw test artifacts to prevent storage overload.
# Retains the last 3 published videos for reference.
# ==============================================================================

set -e

STORAGE_DIR="/opt/n8n/shorts_factory/storage"
RENDERS_DIR="$STORAGE_DIR/renders"
RAW_DIR="$STORAGE_DIR/raw"
AUDIO_DIR="$STORAGE_DIR/audio"
SUBS_DIR="$STORAGE_DIR/subtitles"

echo "=== [1/4] Starting Storage Cleanup ==="
echo "Initial Storage usage:"
du -sh "$STORAGE_DIR"/* || true

# 1. Clean up obsolete test / temporary files
echo ""
echo "=== [2/4] Removing obsolete test artifacts ==="
rm -f "$RAW_DIR"/test_*
rm -f "$RENDERS_DIR"/test_*
rm -f "$RENDERS_DIR"/*_master_smooth.mp4
rm -f "$RENDERS_DIR"/cleo_frame_*.jpg
echo "Deleted test files."

# 2. Query top 3 most recent published topic IDs from PostgreSQL
echo ""
echo "=== [3/4] Fetching recent published topic IDs from Postgres ==="
KEEP_IDS=$(docker exec n8n-prod-postgres psql -U n8n -d n8n -t -A -c \
  "SELECT topic_id FROM shorts_factory.youtube_videos ORDER BY created_at DESC LIMIT 3;")

echo "Topics to KEEP on disk:"
echo "$KEEP_IDS"

# 3. Prune published video renders older than top 3
echo ""
echo "=== [4/4] Pruning older published master renders & audio ==="

# Get all published topic IDs from Postgres
PUBLISHED_IDS=$(docker exec n8n-prod-postgres psql -U n8n -d n8n -t -A -c \
  "SELECT topic_id FROM shorts_factory.youtube_videos;")

DELETED_COUNT=0
for topic_id in $PUBLISHED_IDS; do
  # Check if in KEEP_IDS
  if echo "$KEEP_IDS" | grep -q "$topic_id"; then
    echo "Keeping master render for recent topic: $topic_id"
  else
    # Remove render
    if [ -f "$RENDERS_DIR/${topic_id}_master.mp4" ]; then
      rm -f "$RENDERS_DIR/${topic_id}_master.mp4"
      DELETED_COUNT=$((DELETED_COUNT + 1))
    fi
    # Remove audio
    rm -f "$AUDIO_DIR/topic_${topic_id}_narration.mp3"
    # Remove subtitles
    rm -f "$SUBS_DIR/short_${topic_id}_subs.ass"
  fi
done

# Prune old scene frames for older storyboards (older than 2 days)
find "$RAW_DIR" -type f -name "scene_*.jpg" -mtime +2 -delete 2>/dev/null || true

echo "Pruned $DELETED_COUNT older video render files and associated assets."
echo ""
echo "=== Cleanup Completed Successfully ==="
echo "Final Storage usage:"
du -sh "$STORAGE_DIR"/* || true
df -h "$STORAGE_DIR"
