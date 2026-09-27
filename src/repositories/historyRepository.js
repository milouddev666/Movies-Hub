'use strict';

const { query } = require('../database/db');

async function upsertHistory({
  telegramId, posterId, posterType, episodeId,
  seasonTitle, episodeTitle, title, image, positionSec
}) {
  const sql = `
    INSERT INTO watch_history
      (telegram_id, poster_id, poster_type, episode_id, season_title, episode_title, title, image, position_sec, watched_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
    ON CONFLICT (telegram_id, poster_id, episode_id) DO UPDATE
      SET position_sec  = EXCLUDED.position_sec,
          watched_at    = NOW(),
          season_title  = EXCLUDED.season_title,
          episode_title = EXCLUDED.episode_title
    RETURNING *
  `;
  const res = await query(sql, [
    telegramId, posterId, posterType,
    episodeId || null, seasonTitle || null, episodeTitle || null,
    title, image || null, positionSec || 0
  ]);
  return res.rows[0];
}

async function getHistory(telegramId, limit = 20, offset = 0) {
  const sql = `
    SELECT * FROM watch_history
    WHERE telegram_id = $1
    ORDER BY watched_at DESC
    LIMIT $2 OFFSET $3
  `;
  const res = await query(sql, [telegramId, limit, offset]);
  return res.rows;
}

async function getLastWatched(telegramId, posterId) {
  const res = await query(
    `SELECT * FROM watch_history
     WHERE telegram_id=$1 AND poster_id=$2
     ORDER BY watched_at DESC LIMIT 1`,
    [telegramId, posterId]
  );
  return res.rows[0] || null;
}

module.exports = { upsertHistory, getHistory, getLastWatched };
