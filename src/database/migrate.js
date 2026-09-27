'use strict';

const { query } = require('./db');
const logger = require('../utils/logger');

const SQL_CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS users (
  telegram_id   BIGINT PRIMARY KEY,
  username      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id   BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  poster_id     INTEGER NOT NULL,
  poster_type   TEXT NOT NULL CHECK (poster_type IN ('movie', 'serie')),
  title         TEXT NOT NULL,
  image         TEXT,
  added_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (telegram_id, poster_id, poster_type)
);

CREATE TABLE IF NOT EXISTS watch_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id   BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  poster_id     INTEGER NOT NULL,
  poster_type   TEXT NOT NULL CHECK (poster_type IN ('movie', 'serie')),
  episode_id    INTEGER,
  season_title  TEXT,
  episode_title TEXT,
  title         TEXT NOT NULL,
  image         TEXT,
  position_sec  INTEGER DEFAULT 0,
  watched_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (telegram_id, poster_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_telegram ON favorites(telegram_id);
CREATE INDEX IF NOT EXISTS idx_history_telegram   ON watch_history(telegram_id);
CREATE INDEX IF NOT EXISTS idx_history_watched    ON watch_history(watched_at DESC);
`;

async function migrate() {
  try {
    await query(SQL_CREATE_TABLES);
    logger.info('DB', 'Migrations applied successfully');
  } catch (err) {
    logger.error('DB', `Migration failed: ${err.message}`);
    throw err;
  }
}

module.exports = { migrate };
