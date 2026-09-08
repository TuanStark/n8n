import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { pool } from './db/pool';
import { PipelineRunner } from './workers/pipelineRunner';
import { AutoScheduler } from './scheduler/autoScheduler';
import { YouTubePublisher } from './publish/youtubePublisher';

const app = express();
app.use(cors());
app.use(express.json());

const runner = new PipelineRunner();
const scheduler = new AutoScheduler(runner);
const youtube = new YouTubePublisher();
scheduler.start();

// 1. Health check endpoint
app.get('/health', async (req, res) => {
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
        console.warn(`[API] No YouTube video found for topic ${topicId}`);
        return res.json({ success: true, action, status: 'NO_VIDEO_FOUND' });
      }
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

app.listen(config.port, () => {
  console.log(`[AI Shorts Factory] Worker Service running on port ${config.port}`);
});
