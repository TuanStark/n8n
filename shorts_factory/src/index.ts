import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { pool } from './db/pool';
import { PipelineRunner } from './workers/pipelineRunner';

const app = express();
app.use(cors());
app.use(express.json());

const runner = new PipelineRunner();

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

// 4. Human Approval Callback (Telegram / Webhook)
app.post('/api/approval/callback', async (req, res) => {
  const { approvalId, action, feedback } = req.body;
  console.log(`[API] Received approval callback: id=${approvalId}, action=${action}`);

  try {
    if (approvalId) {
      await pool.query(
        'UPDATE approval_requests SET status = $1, feedback_notes = $2, responded_at = NOW() WHERE id = $3',
        [action, feedback || null, approvalId]
      );
    }
    res.json({ success: true, action, status: 'RECORDED' });
  } catch (err: any) {
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

app.listen(config.port, () => {
  console.log(`[AI Shorts Factory] Worker Service running on port ${config.port}`);
});
