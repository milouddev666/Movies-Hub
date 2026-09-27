'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(process.cwd(), 'data');
const DB_FILE    = path.join(DATA_DIR, 'db.json');
const BAK_FILE   = path.join(DATA_DIR, 'db.backup.json');
const TMP_FILE   = path.join(DATA_DIR, 'db.tmp.json');

const EMPTY_DB = () => ({
  users:        {},
  favorites:    {},
  watchHistory: {},
  settings:     {},
  cache:        {},
});

// ── Ensure data dir exists ────────────────────────────────────────────────────
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── In-memory state (flushed to disk) ────────────────────────────────────────
let _db   = null;
let _dirty = false;
let _flushTimer = null;

// ── Load from disk ────────────────────────────────────────────────────────────
function loadFromDisk() {
  ensureDir();
  for (const file of [DB_FILE, BAK_FILE]) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        console.log(`[STORE] Loaded from ${path.basename(file)}`);
        return { ...EMPTY_DB(), ...parsed };
      }
    } catch (e) {
      console.warn(`[STORE] Could not parse ${path.basename(file)}: ${e.message}`);
    }
  }
  console.log('[STORE] Starting with empty database');
  return EMPTY_DB();
}

function getDb() {
  if (!_db) _db = loadFromDisk();
  return _db;
}

// ── Atomic write (tmp → rename) ───────────────────────────────────────────────
function flushToDisk() {
  if (!_dirty || !_db) return;
  ensureDir();
  try {
    const json = JSON.stringify(_db, null, 2);
    fs.writeFileSync(TMP_FILE, json, 'utf8');
    // backup current
    if (fs.existsSync(DB_FILE)) {
      try { fs.copyFileSync(DB_FILE, BAK_FILE); } catch (_) {}
    }
    fs.renameSync(TMP_FILE, DB_FILE);
    _dirty = false;
  } catch (err) {
    console.error(`[STORE] Flush failed: ${err.message}`);
  }
}

function scheduledFlush() {
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flushToDisk, 300);
}

function markDirty() {
  _dirty = true;
  scheduledFlush();
}

// ── Ensure flush on process exit ──────────────────────────────────────────────
process.on('exit',    flushToDisk);
process.on('SIGTERM', () => { flushToDisk(); process.exit(0); });
process.on('SIGINT',  () => { flushToDisk(); process.exit(0); });

// ── Public API ────────────────────────────────────────────────────────────────

function read()  { return getDb(); }

function write(data) {
  _db = { ...EMPTY_DB(), ...data };
  markDirty();
}

// ── Users ─────────────────────────────────────────────────────────────────────
function getUser(telegramId) {
  return getDb().users[String(telegramId)] || null;
}

function upsertUser({ telegramId, username, firstName, lastName }) {
  const db  = getDb();
  const id  = String(telegramId);
  const now = new Date().toISOString();
  db.users[id] = {
    telegramId,
    username:   username   || null,
    firstName:  firstName  || null,
    lastName:   lastName   || null,
    updatedAt:  now,
    createdAt:  db.users[id]?.createdAt || now,
  };
  markDirty();
  return db.users[id];
}

// ── Favorites ─────────────────────────────────────────────────────────────────
function getFavorites(telegramId) {
  const db  = getDb();
  const key = String(telegramId);
  return Object.values(db.favorites[key] || {})
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
}

function addFavorite({ telegramId, posterId, posterType, title, image }) {
  const db     = getDb();
  const userKey = String(telegramId);
  const itemKey = `${posterType}:${posterId}`;
  if (!db.favorites[userKey]) db.favorites[userKey] = {};
  db.favorites[userKey][itemKey] = {
    posterId, posterType, title,
    image:   image || null,
    addedAt: new Date().toISOString(),
  };
  markDirty();
  return db.favorites[userKey][itemKey];
}

function removeFavorite({ telegramId, posterId, posterType }) {
  const db      = getDb();
  const userKey = String(telegramId);
  const itemKey = `${posterType}:${posterId}`;
  const existed = !!(db.favorites[userKey]?.[itemKey]);
  if (existed) {
    delete db.favorites[userKey][itemKey];
    markDirty();
  }
  return existed;
}

function isFavorite({ telegramId, posterId, posterType }) {
  const db      = getDb();
  const userKey = String(telegramId);
  const itemKey = `${posterType}:${posterId}`;
  return !!(db.favorites[userKey]?.[itemKey]);
}

// ── Watch History ─────────────────────────────────────────────────────────────
function getWatchHistory(telegramId, limit = 20) {
  const db  = getDb();
  const key = String(telegramId);
  return Object.values(db.watchHistory[key] || {})
    .sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt))
    .slice(0, limit);
}

function addWatchHistory({
  telegramId, posterId, posterType,
  episodeId, seasonTitle, episodeTitle,
  title, image, positionSec,
}) {
  const db      = getDb();
  const userKey = String(telegramId);
  const itemKey = episodeId
    ? `${posterType}:${posterId}:ep:${episodeId}`
    : `${posterType}:${posterId}`;

  if (!db.watchHistory[userKey]) db.watchHistory[userKey] = {};

  db.watchHistory[userKey][itemKey] = {
    posterId, posterType,
    episodeId:    episodeId    || null,
    seasonTitle:  seasonTitle  || null,
    episodeTitle: episodeTitle || null,
    title, image: image || null,
    positionSec:  positionSec  || 0,
    watchedAt:    new Date().toISOString(),
  };
  markDirty();
  return db.watchHistory[userKey][itemKey];
}

module.exports = {
  read, write,
  getUser, upsertUser,
  getFavorites, addFavorite, removeFavorite, isFavorite,
  getWatchHistory, addWatchHistory,
  flushToDisk,
};
