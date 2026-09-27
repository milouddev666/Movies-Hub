'use strict';

const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

let pool = null;

function getPool() {
  if (!pool) {
    if (!config.database.url) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString: config.database.url,
      ssl: config.server.nodeEnv === 'production'
        ? { rejectUnauthorized: false }
        : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      logger.error('DB', `Pool error: ${err.message}`);
    });
  }
  return pool;
}

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await getPool().query(text, params);
    logger.debug('DB', `Query OK (${Date.now() - start}ms): ${text.substring(0, 60)}`);
    return res;
  } catch (err) {
    logger.error('DB', `Query failed: ${err.message} — ${text.substring(0, 60)}`);
    throw err;
  }
}

module.exports = { query, getPool };
