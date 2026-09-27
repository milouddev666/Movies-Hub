'use strict';

const { query } = require('../database/db');

async function addFavorite({ telegramId, posterId, posterType, title, image }) {
  const sql = `
    INSERT INTO favorites (telegram_id, poster_id, poster_type, title, image)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (telegram_id, poster_id, poster_type) DO NOTHING
    RETURNING *
  `;
  const res = await query(sql, [telegramId, posterId, posterType, title, image || null]);
  return res.rows[0] || null;
}

async function removeFavorite({ telegramId, posterId, posterType }) {
  const sql = `
    DELETE FROM favorites
    WHERE telegram_id=$1 AND poster_id=$2 AND poster_type=$3
    RETURNING id
  `;
  const res = await query(sql, [telegramId, posterId, posterType]);
  return res.rows.length > 0;
}

async function getFavorites(telegramId, limit = 30, offset = 0) {
  const sql = `
    SELECT * FROM favorites
    WHERE telegram_id = $1
    ORDER BY added_at DESC
    LIMIT $2 OFFSET $3
  `;
  const res = await query(sql, [telegramId, limit, offset]);
  return res.rows;
}

async function isFavorite({ telegramId, posterId, posterType }) {
  const res = await query(
    'SELECT id FROM favorites WHERE telegram_id=$1 AND poster_id=$2 AND poster_type=$3',
    [telegramId, posterId, posterType]
  );
  return res.rows.length > 0;
}

module.exports = { addFavorite, removeFavorite, getFavorites, isFavorite };
