import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', async (client) => {
  await client.query(`SET search_path TO ${config.db.schema}, public`);
});

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected client error:', err);
});
