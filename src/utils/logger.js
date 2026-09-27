'use strict';
const isDev = process.env.NODE_ENV !== 'production';

function sanitize(s) {
  return String(s)
    .replace(/BOT_TOKEN[=:]\S+/gi,    'BOT_TOKEN=[REDACTED]')
    .replace(/API_KEY_PATH[=:]\S+/gi, 'API_KEY_PATH=[REDACTED]')
    .replace(/CLIENT_UUID[=:]\S+/gi,  'CLIENT_UUID=[REDACTED]');
}

function log(level, tag, msg) {
  const ts   = new Date().toISOString();
  const safe = sanitize(msg);
  if (isDev) { console.log(`${ts} [${level}] [${tag}] ${safe}`); }
  else        { console.log(JSON.stringify({ ts, level, tag, msg: safe })); }
}

module.exports = {
  info:  (tag, msg) => log('INFO',  tag, msg),
  warn:  (tag, msg) => log('WARN',  tag, msg),
  error: (tag, msg) => log('ERROR', tag, msg),
  debug: (tag, msg) => { if (isDev) log('DEBUG', tag, msg); },
};
