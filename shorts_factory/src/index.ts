import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { pool } from './db/pool';
import { PipelineRunner } from './workers/pipelineRunner';
import { MultiChannelPipelineRunner } from './workers/multiChannelPipelineRunner';
import { GenreService } from './services/genreService';
import { AutoScheduler } from './scheduler/autoScheduler';
import { YouTubePublisher } from './publish/youtubePublisher';

const app = express();
app.use(cors());
app.use(express.json());

const runner = new PipelineRunner();
const multiRunner = new MultiChannelPipelineRunner();
const genreService = new GenreService();
const scheduler = new AutoScheduler(runner);
const youtube = new YouTubePublisher();
scheduler.start();

// 1. Health check endpoint (accepts both GET and POST for testing)
app.all('/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT NOW() as db_time');
    res.json({
      status: 'ok',
      service: 'shorts-factory-worker',
      env: config.env,
      database: 'connected',
      dbTime: dbCheck.rows[0].db_time,
      storage: {
        rendersExist: fs.existsSync(config.storage.renders),
      },
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// 2. Trigger automated production pipeline
app.post('/api/pipeline/start', async (req, res) => {
  const { topicId } = req.body;
  console.log(`[API] Received /api/pipeline/start request for topicId: ${topicId || 'AUTO_SELECT'}`);

  try {
    // Run pipeline asynchronously or synchronously based on caller preference
    const result = await runner.runFullPipelineForTopic(topicId);
    res.json({
      success: true,
      message: 'Pipeline executed successfully',
      data: result,
    });
  } catch (err: any) {
    console.error('[API] Pipeline execution error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// 3. List Topics
app.get('/api/topics', async (req, res) => {
  try {
    const query = 'SELECT id, title, category, historical_period, potential_score, status FROM topics ORDER BY potential_score DESC';
    const result = await pool.query(query);
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Human Approval Callback (Slack / Webhook)
app.post('/api/approval/callback', async (req, res) => {
  const { approvalId, action, feedback, shortId } = req.body;
  console.log(`[API] Received approval callback: id=${approvalId || shortId}, action=${action}`);

  try {
    // Update approval request status in DB
    if (approvalId) {
      await pool.query(
        'UPDATE approval_requests SET status = $1, feedback_notes = $2, responded_at = NOW() WHERE id = $3',
        [action, feedback || null, approvalId]
      );
    }

    const topicId = shortId || approvalId;

    if (action === 'APPROVE' && topicId) {
      // Find the YouTube video for this topic and make it PUBLIC
      const ytResult = await pool.query(
        'SELECT youtube_video_id FROM youtube_videos WHERE topic_id = $1 ORDER BY created_at DESC LIMIT 1',
        [topicId]
      );

      if (ytResult.rows.length > 0 && ytResult.rows[0].youtube_video_id) {
        const videoId = ytResult.rows[0].youtube_video_id;
        console.log(`[API] Approving video — setting YouTube ${videoId} to PUBLIC...`);

        await youtube.setVideoPublic(videoId);

        // Update DB records
        await pool.query(
          "UPDATE youtube_videos SET privacy_status = 'public' WHERE topic_id = $1",
          [topicId]
        );
        await pool.query(
          "UPDATE topics SET status = 'PUBLISHED' WHERE id = $1",
          [topicId]
        );

        console.log(`[API] ✅ Video ${videoId} is now PUBLIC and PUBLISHED!`);
        return res.json({ success: true, action: 'PUBLISHED', videoId, youtubeUrl: `https://youtube.com/shorts/${videoId}` });
      } else {
        // Fallback: Check if rendered master video exists on disk
        const renderPath = path.join(config.storage.renders, `${topicId}_master.mp4`);
        if (fs.existsSync(renderPath)) {
          console.log(`[API] Master video found on disk at ${renderPath}. Attempting direct YouTube upload as PUBLIC...`);
          const topicRes = await pool.query(
            `SELECT t.id, t.title, t.category, sc.full_script, r.id as render_job_id
             FROM topics t
             LEFT JOIN scripts sc ON sc.topic_id = t.id
             LEFT JOIN storyboards sb ON sb.script_id = sc.id
             LEFT JOIN render_jobs r ON r.storyboard_id = sb.id
             WHERE t.id = $1
             ORDER BY r.created_at DESC LIMIT 1`,
            [topicId]
          );

          if (topicRes.rows.length > 0) {
            const row = topicRes.rows[0];
            try {
              const uploadRes = await youtube.uploadShort(renderPath, {
                title: row.title,
                description: row.full_script || row.title,
                category: row.category || 'history',
                privacyStatus: 'public',
              });

              await pool.query(
                `INSERT INTO youtube_videos (
                  topic_id, render_job_id, youtube_video_id, title, description, tags, privacy_status, upload_status
                ) VALUES ($1, $2, $3, $4, $5, $6, 'public', 'UPLOADED')`,
                [
                  topicId,
                  row.render_job_id,
                  uploadRes.videoId,
                  uploadRes.title.slice(0, 100),
                  row.full_script || row.title,
                  ['Shorts', 'history', 'papertheater', row.category || 'history'],
                ]
              );

              await pool.query("UPDATE topics SET status = 'PUBLISHED' WHERE id = $1", [topicId]);
              console.log(`[API] ✅ Fallback upload succeeded: ${uploadRes.youtubeUrl}`);
              return res.json({
                success: true,
                action: 'PUBLISHED',
                videoId: uploadRes.videoId,
                youtubeUrl: uploadRes.youtubeUrl,
              });
            } catch (uploadErr: any) {
              console.error(`[API] Fallback YouTube upload failed:`, uploadErr.message);
              return res.status(500).json({
                success: false,
                action: 'UPLOAD_FAILED',
                error: uploadErr.message,
              });
            }
          }
        }

        console.warn(`[API] No YouTube video found and no render file for topic ${topicId}`);
        return res.json({ success: false, action, status: 'NO_VIDEO_FOUND' });
      }
    } else if (action === 'REGENERATE' && topicId) {
      await pool.query("UPDATE topics SET status = 'IDEA' WHERE id = $1", [topicId]);
      console.log(`[API] Video for topic ${topicId} reset to IDEA for regeneration.`);
      return res.json({ success: true, action: 'REGENERATED' });
    } else if (action === 'DISCARD' && topicId) {
      await pool.query("UPDATE topics SET status = 'DISCARDED' WHERE id = $1", [topicId]);
      console.log(`[API] Video for topic ${topicId} discarded.`);
      return res.json({ success: true, action: 'DISCARDED' });
    }

    res.json({ success: true, action, status: 'RECORDED' });
  } catch (err: any) {
    console.error(`[API] Approval callback error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Video Preview Stream
app.get('/api/preview/:filename', (req, res) => {
  const filePath = path.join(config.storage.renders, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// 6. Schedule inspection endpoint
app.get('/api/schedule', (req, res) => {
  res.json({
    success: true,
    schedule: scheduler.getStatus(),
  });
});

// ==============================================================================
// V2 MULTI-CHANNEL, MULTI-GENRE & CLOUDINARY API
// ==============================================================================

// 7. List all configured channels
app.get('/api/v2/channels', async (req, res) => {
  try {
    const channels = await genreService.listChannels();
    res.json({ success: true, count: channels.length, data: channels });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. List all genre profiles
app.get('/api/v2/genres', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM genre_profiles ORDER BY created_at ASC');
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Register or update a channel and its credentials
app.post('/api/v2/channels/configure', async (req, res) => {
  const { id, name, genreKey, description, defaultPrivacy, defaultTags, credentials } = req.body;
  if (!id || !name || !genreKey) {
    return res.status(400).json({ success: false, error: 'Missing required fields: id, name, genreKey' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO channels (id, name, genre_key, description, default_privacy, default_tags, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         genre_key = EXCLUDED.genre_key,
         description = EXCLUDED.description,
         default_privacy = EXCLUDED.default_privacy,
         default_tags = EXCLUDED.default_tags,
         updated_at = NOW()`,
      [id, name, genreKey, description || null, defaultPrivacy || 'unlisted', defaultTags || []]
    );

    if (credentials?.clientId && credentials?.clientSecret && credentials?.refreshToken) {
      await client.query(
        `INSERT INTO channel_credentials (channel_id, client_id, client_secret, refresh_token, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (channel_id) DO UPDATE SET
           client_id = EXCLUDED.client_id,
           client_secret = EXCLUDED.client_secret,
           refresh_token = EXCLUDED.refresh_token,
           updated_at = NOW()`,
        [id, credentials.clientId, credentials.clientSecret, credentials.refreshToken]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `Channel ${id} configured successfully.` });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// 10. Multi-Channel Video Production Trigger (Ad-hoc or Persisted Channel)
app.post('/api/v2/pipeline/produce', async (req, res) => {
  const payload = req.body;
  console.log(`[API V2] Received /api/v2/pipeline/produce request:`, {
    channelId: payload.channelId || payload.channelConfig?.id || 'channel_01_paper',
    title: payload.content?.title,
    genre: payload.channelConfig?.genreKey,
  });

  if (!payload.content?.title) {
    return res.status(400).json({ success: false, error: 'Missing required field: content.title' });
  }

  try {
    const result = await multiRunner.produceShort(payload);
    res.json({
      success: true,
      message: 'Video produced and processed successfully',
      data: result,
    });
  } catch (err: any) {
    console.error('[API V2] Production error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// 11. Multi-Channel Batch Execution (Runs across multiple channels)
app.post('/api/v2/pipeline/batch', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items array is required and must not be empty' });
  }

  console.log(`[API V2] Received batch production request for ${items.length} videos...`);
  const results: any[] = [];
  const errors: any[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      console.log(`[API V2 Batch] Processing item ${i + 1}/${items.length}: "${item.content?.title}" for channel "${item.channelId || item.channelConfig?.id}"...`);
      const resItem = await multiRunner.produceShort(item);
      results.push(resItem);
    } catch (err: any) {
      console.error(`[API V2 Batch] Error on item ${i + 1}:`, err.message);
      errors.push({ index: i, title: item.content?.title, error: err.message });
    }
  }

  res.json({
    success: errors.length === 0,
    total: items.length,
    succeeded: results.length,
    failed: errors.length,
    data: results,
    errors,
  });
});

app.listen(config.port, () => {
  console.log(`[AI Shorts Factory] Worker Service running on port ${config.port}`);
});

