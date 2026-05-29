const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function init() {
  const db = getPool();

  // Run each statement separately — pg doesn't reliably execute multi-statement queries
  await db.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email          TEXT UNIQUE NOT NULL,
      name           TEXT,
      password_hash  TEXT,
      google_id      TEXT UNIQUE,
      avatar_url     TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS recording_logs (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type                  TEXT NOT NULL CHECK (type IN ('thoughts', 'tasks')),
      duration_ms           INTEGER,
      transcript_word_count INTEGER,
      num_outputs           INTEGER,
      processing_time_ms    INTEGER,
      had_error             BOOLEAN NOT NULL DEFAULT FALSE,
      error_message         TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_rl_user_id    ON recording_logs(user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_rl_created_at ON recording_logs(created_at)`);

  console.log('Database ready');
}

module.exports = { getPool, init };
