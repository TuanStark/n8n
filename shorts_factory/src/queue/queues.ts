import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';

export const redisConnection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('error', (err) => {
  console.error('[Redis] Connection Error:', err);
});

redisConnection.on('connect', () => {
  console.log('[Redis] Connected to shorts-factory-redis successfully.');
});

// Default Queue Options with Backoff and Retry
const defaultQueueOpts = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 86400, // keep 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 604800, // keep 7 days
    },
  },
};

export const topicQueue = new Queue('shorts:topic-queue', defaultQueueOpts);
export const researchQueue = new Queue('shorts:research-queue', defaultQueueOpts);
export const scriptQueue = new Queue('shorts:script-queue', defaultQueueOpts);
export const storyboardQueue = new Queue('shorts:storyboard-queue', defaultQueueOpts);
export const mediaQueue = new Queue('shorts:media-queue', defaultQueueOpts);
export const voiceQueue = new Queue('shorts:voice-queue', defaultQueueOpts);
export const renderQueue = new Queue('shorts:render-queue', defaultQueueOpts);
export const qcQueue = new Queue('shorts:qc-queue', defaultQueueOpts);
export const publishQueue = new Queue('shorts:publish-queue', defaultQueueOpts);
