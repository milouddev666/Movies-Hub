'use strict';

const { query } = require('../database/db');

async function upsertUser({ telegramId, username, firstName, lastName }) {
  const sql = `
    INSERT INTO users (telegram_id, username, first_name, last_name, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (telegram_id) DO UPDATE
      SET username   = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          last_name  = EXCLUDED.last_name,
          updated_at = NOW()
    RETURNING *
  `;
  const res = await query(sql, [telegramId, username || null, firstName || null, lastName || null]);
  return res.rows[0];
}

async function getUserById(telegramId) {
  const res = await query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
  return res.rows[0] || null;
}

module.exports = { upsertUser, getUserById };
