'use strict';

/**
 * sourceResolver.js
 *
 * VERIFIED 2026-09-25:
 *   movie_id=31673   → 10 sources (webm, m3u8×6, mov×2, embed)
 *   episode_id=4867  → 15 sources (m3u8, webm, mov, embed×2...)
 *
 * Decoder algorithm (DO NOT CHANGE):
 *   1. JSON.parse directly
 *   2. Find W3s or W1s marker → slice → strip non-Base64 → decode → JSON.parse
 *   3. Fallback: longest Base64 block
 *   ❌ NEVER use eyJ as start marker (it appears inside the payload)
 *
 * Player mode determination:
 *   The URL itself decides the player mode, NOT the type field alone.
 *   Many sources have type='m3u8' but the URL is an embed/HTML page.
 *   looksLikeEmbedUrl() detects this and overrides to 'embed' player mode.
 */

const logger = require('../utils/logger');

// ── Validation ────────────────────────────────────────────────────────────────
function isValidSource(s) {
  return s !== null && typeof s === 'object'
    && typeof s.id  === 'number'
    && typeof s.url === 'string'
    && s.url.length > 0;
}

function extractArray(parsed) {
  if (Array.isArray(parsed)          && parsed.every(isValidSource)) return parsed;
  if (Array.isArray(parsed?.sources) && parsed.sources.every(isValidSource)) return parsed.sources;
  if (Array.isArray(parsed?.data)    && parsed.data.every(isValidSource)) return parsed.data;
  return null;
}

// ── Detect whether a URL is actually an embed/HTML page ───────────────────────
// This is the KEY fix: type='m3u8' doesn't mean the URL is a .m3u8 manifest.
// Known embed URL patterns from verified API responses:
//   https://uqload.vc/embed-xxxx.html
//   https://streamwish.fun/e/xxxx
//   https://earnvids.xyz/v/xxxx
//   https://dwapp.qzz.io/url.php?url=...
//   Any URL ending in .html or containing /embed/ /e/ /v/ path segments
function looksLikeEmbedUrl(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  // Explicit HTML pages
  if (u.endsWith('.html') || u.endsWith('.htm')) return true;
  // Known embed path patterns
  if (/\/embed[-/]/.test(u))    return true;
  if (/\/e\/[a-z0-9]+/.test(u)) return true;
  if (/\/v\/[a-z0-9]+/.test(u)) return true;
  // Redirect wrapper (dwapp.qzz.io/url.php?url=...)
  if (u.includes('/url.php'))   return true;
  // Streaming site short paths (no file extension, no m3u8)
  if (!u.includes('.m3u8') && !u.includes('.webm') && !u.includes('.mov') && !u.includes('.mp4')) {
    // If URL path has no recognisable media extension, treat as embed
    const path = u.split('?')[0];
    const parts = path.split('/');
    const last = parts[parts.length - 1] || '';
    if (last && !last.includes('.') && parts.length >= 3) {
      // Short alphanumeric slug like /e/h1j6bijqhx78 or /embed/abc
      if (/^[a-z0-9]{6,}$/i.test(last)) return true;
    }
  }
  return false;
}

// ── Determine player mode from source (type + URL) ────────────────────────────
// Returns: 'm3u8' | 'webm' | 'mov' | 'mp4' | 'embed'
function determinePlayerMode(src) {
  const type = (src.type || '').toLowerCase().trim();
  const url  = src.url || '';

  // If URL looks like an embed page → always use iframe player, regardless of type
  if (looksLikeEmbedUrl(url)) return 'embed';

  // type field drives mode for direct media files
  if (type === 'embed')  return 'embed';
  if (type === 'm3u8')   return 'm3u8';
  if (type === 'webm')   return 'webm';
  if (type === 'mov')    return 'mov';
  if (type === 'mp4')    return 'mp4';

  // Fallback: sniff from URL extension
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  if (ext === 'm3u8')  return 'm3u8';
  if (ext === 'webm')  return 'webm';
  if (ext === 'mov')   return 'mov';
  if (ext === 'mp4')   return 'mp4';

  return 'embed'; // safest fallback: render in iframe
}

// ── classifySource (for sorting/display — keeps original type label) ───────────
function classifySource(src) {
  const type = (src.type || '').toLowerCase();
  const url  = (src.url  || '').toLowerCase();
  if (type === 'm3u8' || url.includes('.m3u8'))  return 'm3u8';
  if (type === 'embed' || url.includes('embed')) return 'embed';
  if (type === 'webm'  || url.endsWith('.webm')) return 'webm';
  if (type === 'mov'   || url.endsWith('.mov'))  return 'mov';
  if (type === 'mp4'   || url.endsWith('.mp4'))  return 'mp4';
  return type || 'unknown';
}

// ── Normalize raw API source ──────────────────────────────────────────────────
function normalizeSource(raw) {
  const type   = (raw.type || raw.title || '').toLowerCase().trim();
  const src    = { type, url: raw.url || '' };
  const pMode  = determinePlayerMode(src);
  return {
    id:          raw.id,
    title:       raw.title    || type,
    type,
    quality:     raw.quality  || null,
    size:        raw.size     || null,
    kind:        raw.kind     || 'both',
    premium:     Number(raw.premium) || 0,
    external:    Boolean(raw.external),
    url:         raw.url,
    originalUrl: raw.url,
    sourceClass: classifySource(src),
    playerMode:  pMode,           // ← what the player should actually use
  };
}

// ── Base64 decoder helpers ────────────────────────────────────────────────────
function tryParse(text) {
  try {
    const p = JSON.parse(text.trim());
    return extractArray(p);
  } catch (_) { return null; }
}

// W3s = '[{' in Base64, W1s = '[[' in Base64 — these are the correct markers
function findArrayPayload(text) {
  for (const marker of ['W3s', 'W1s', 'Ww']) {
    const idx = text.indexOf(marker);
    if (idx === -1) continue;
    const candidate = text.slice(idx).replace(/[^A-Za-z0-9+/=]/g, '');
    if (candidate.length < 20) continue;
    logger.debug('SOURCE', `Marker "${marker}" at idx=${idx}, len=${candidate.length}`);
    return candidate;
  }
  return null;
}

function findLongestBase64(text) {
  const chunks = text.match(/[A-Za-z0-9+/]{40,}={0,2}/g);
  if (!chunks) return null;
  return chunks.reduce((a, b) => b.length > a.length ? b : a, '');
}

function decodeCandidate(candidate) {
  let decoded;
  try { decoded = Buffer.from(candidate, 'base64').toString('utf8'); }
  catch (e) { logger.warn('SOURCE', `Base64 decode error: ${e.message}`); return null; }
  return tryParse(decoded);
}

// ── Main decoder (DO NOT CHANGE ALGORITHM) ────────────────────────────────────
function decodeSourceBody(rawBody) {
  const text = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : String(rawBody || '');

  logger.info('SOURCE', 'SOURCE RESPONSE RECEIVED');
  logger.debug('SOURCE', `len=${text.length} preview="${text.slice(0, 80).replace(/\n/g, '\\n')}"`);

  if (!text.trim()) {
    logger.warn('SOURCE', 'EMPTY_RESPONSE');
    return { resolved: false, sources: null, reason: 'EMPTY_RESPONSE', raw: text };
  }

  // Step 1: direct JSON
  const direct = tryParse(text);
  if (direct && direct.length > 0) {
    const normalized = direct.map(normalizeSource);
    logger.info('SOURCE', `SOURCE DECODE SUCCESS (direct JSON) count=${normalized.length}`);
    logger.info('SOURCE', `SOURCE TYPES: ${normalized.map(s => s.type).join(', ')}`);
    logger.info('SOURCE', `PLAYER MODES: ${normalized.map(s => s.playerMode).join(', ')}`);
    return { resolved: true, sources: normalized, reason: null, raw: text };
  }

  // Step 2: W3s/W1s marker
  const arrayPayload = findArrayPayload(text);
  if (arrayPayload) {
    const arr = decodeCandidate(arrayPayload);
    if (arr && arr.length > 0) {
      const normalized = arr.map(normalizeSource);
      logger.info('SOURCE', `SOURCE DECODE SUCCESS (W3s/W1s→JSON) count=${normalized.length}`);
      logger.info('SOURCE', `SOURCE TYPES: ${normalized.map(s => s.type).join(', ')}`);
      logger.info('SOURCE', `PLAYER MODES: ${normalized.map(s => s.playerMode).join(', ')}`);
      return { resolved: true, sources: normalized, reason: null, raw: text };
    }
  }

  // Step 3: longest Base64 fallback
  const longest = findLongestBase64(text);
  if (longest) {
    const arr = decodeCandidate(longest);
    if (arr && arr.length > 0) {
      const normalized = arr.map(normalizeSource);
      logger.info('SOURCE', `SOURCE DECODE SUCCESS (longest-b64→JSON) count=${normalized.length}`);
      logger.info('SOURCE', `SOURCE TYPES: ${normalized.map(s => s.type).join(', ')}`);
      logger.info('SOURCE', `PLAYER MODES: ${normalized.map(s => s.playerMode).join(', ')}`);
      return { resolved: true, sources: normalized, reason: null, raw: text };
    }
  }

  logger.warn('SOURCE', `SOURCE_DECODE_FAILED len=${text.length}`);
  return { resolved: false, sources: null, reason: 'SOURCE_DECODE_FAILED', raw: text };
}

// ── Sort sources for UI ───────────────────────────────────────────────────────
// Priority for PLAY: embed(known-playable) > m3u8 > webm > mov > unknown > embed(uncertain)
// kind: both(3) > play(2) > download(1)
function sortSources(sources) {
  if (!Array.isArray(sources)) return [];
  const K = { both: 3, play: 2, download: 1 };
  const C = { m3u8: 5, mp4: 4, webm: 3, mov: 2, unknown: 1, embed: 4 }; // embed high — iframe always works
  return [...sources].sort((a, b) => {
    const kd = (K[b.kind] ?? 0) - (K[a.kind] ?? 0);
    if (kd !== 0) return kd;
    return (C[b.sourceClass] ?? 1) - (C[a.sourceClass] ?? 1);
  });
}

module.exports = {
  decodeSourceBody,
  classifySource,
  determinePlayerMode,
  looksLikeEmbedUrl,
  sortSources,
  normalizeSource,
  resolve: (raw) => decodeSourceBody(raw),
};
