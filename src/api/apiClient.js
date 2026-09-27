'use strict';

const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * apiClient.js
 *
 * ALL HTTP requests go to dwapp.arabypros.com ONLY.
 * NO requests are ever made to external source/video URLs.
 * Source URLs are decoded and returned to the frontend as data — never fetched.
 *
 * [ERROR] [WEB] 403 was caused by:
 *   - getMovies / getSeries / getPosters / getRandomMovies / getRoles
 *     having NO cache key → sending a new HTTP request to dwapp.arabypros.com
 *     on EVERY Mini App page load. Under repeated rapid requests the API
 *     returned 403 (rate-limit / IP throttle).
 *
 * Fix: ALL list endpoints now have a cache key.
 * Cache TTL: 5 min for lists, 10 min for static (genres/years).
 */

// ── In-memory cache ───────────────────────────────────────────────────────────
const cache = new Map();

function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > e.ttl) { cache.delete(k); return null; }
  return e.data;
}

function cacheSet(k, data, ttlMs = 5 * 60 * 1000) {
  cache.set(k, { ts: Date.now(), data, ttl: ttlMs });
}

// ── Axios instance ── only talks to dwapp.arabypros.com ──────────────────────
const client = axios.create({
  baseURL: config.api.baseUrl,  // https://dwapp.arabypros.com
  timeout: 15000,
  headers: {
    'User-Agent':      config.api.userAgent, // okhttp/4.12.0
    'Accept-Encoding': 'gzip',
  },
  decompress: true,
});

// ── Retry: only on network errors and 5xx (NOT on 403/404) ───────────────────
async function req(axCfg, retries = 2) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      return await client(axCfg);
    } catch (err) {
      last = err;
      const st = err.response?.status;
      // Log every request failure with URL host for diagnosis (no secrets)
      if (st) {
        const host = new URL(config.api.baseUrl).hostname;
        logger.warn('API', `HTTP ${st} from ${host} — ${axCfg.url}`);
      }
      // Only retry on network/5xx — break immediately on 4xx (except 429)
      if (st && st < 500 && st !== 429) break;
      if (i < retries) {
        const ms = 500 * Math.pow(2, i);
        logger.warn('API', `Retry ${i + 1}/${retries} in ${ms}ms`);
        await new Promise(r => setTimeout(r, ms));
      }
    }
  }
  throw last;
}

function suf() {
  return `/${config.api.keyPath}/${config.api.clientUuid}/`;
}

// ── getJson: fetch JSON from dwapp.arabypros.com ──────────────────────────────
// IMPORTANT: url is ALWAYS a relative path (e.g. /api/movie/...)
// It is combined with baseURL (dwapp.arabypros.com) by axios.
// This function NEVER fetches external source/video URLs.
async function getJson(url, cacheKey, ttlMs) {
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) { logger.debug('API', `Cache HIT: ${cacheKey}`); return hit; }
  }

  // Log what we're requesting (no secrets in the path shown externally)
  logger.debug('API', `WEB REQUEST method=GET url=${url} host=${new URL(config.api.baseUrl).hostname}`);

  const res = await req({
    method: 'GET', url,
    responseType: 'text',
    transformResponse: [d => d],  // prevent axios auto-JSON-parse
  });

  let data;
  try { data = JSON.parse(res.data); }
  catch (e) { throw new Error(`JSON parse failed for ${url}: ${e.message}`); }

  if (cacheKey) cacheSet(cacheKey, data, ttlMs);
  return data;
}

// getRaw: for source endpoints — returns raw text body, NOT JSON
// NEVER fetches video/embed URLs — only /api/movie/source/by/... and /api/episode/source/by/...
async function getRaw(url) {
  logger.debug('API', `WEB REQUEST method=GET url=${url} host=${new URL(config.api.baseUrl).hostname}`);
  const res = await req({
    method: 'GET', url,
    responseType: 'text',
    transformResponse: [d => d],
  });
  return res.data;
}

// ── API endpoints ─────────────────────────────────────────────────────────────

const apiClient = {
  // GET /api/first/{key}/{uuid}/  — home channels/posters
  // Cache: 5 min (changes rarely within a session)
  async getFirst() {
    return getJson(`/api/first${suf()}`, 'first', 5 * 60 * 1000);
  },

  // GET /api/genre/all/{key}/{uuid}/
  // Cache: 30 min (genres are static)
  async getGenres() {
    return getJson(`/api/genre/all${suf()}`, 'genres', 30 * 60 * 1000);
  },

  // GET /api/years/all/{key}/{uuid}/
  // Cache: 30 min
  async getYears() {
    return getJson(`/api/years/all${suf()}`, 'years', 30 * 60 * 1000);
  },

  // GET /api/movie/random/{limit}/{key}/{uuid}/
  // Cache: 2 min (changes on each call by design, but throttle repeated calls)
  async getRandomMovies(limit = 20) {
    return getJson(`/api/movie/random/${limit}${suf()}`, `random:${limit}`, 2 * 60 * 1000);
  },

  // GET /api/movie/by/filtres/{filter}/{sort}/{flag}/{key}/{uuid}/
  // Cache: 5 min per filter combination
  // FIX: was missing cache key → caused repeated 403s under load
  async getMovies({ filter = 0, sort = 'created', flag = 0 } = {}) {
    const cacheKey = `movies:${filter}:${sort}:${flag}`;
    return getJson(`/api/movie/by/filtres/${filter}/${sort}/${flag}${suf()}`, cacheKey, 5 * 60 * 1000);
  },

  // GET /api/serie/by/filtres/{filter}/{sort}/{flag}/{key}/{uuid}/
  // Cache: 5 min per filter combination
  // FIX: was missing cache key → caused repeated 403s under load
  async getSeries({ filter = 0, sort = 'created', flag = 0 } = {}) {
    const cacheKey = `series:${filter}:${sort}:${flag}`;
    return getJson(`/api/serie/by/filtres/${filter}/${sort}/${flag}${suf()}`, cacheKey, 5 * 60 * 1000);
  },

  // GET /api/poster/by/filtres/{filter}/{sort}/{direction}/{key}/{uuid}/
  // Cache: 5 min
  // FIX: was missing cache key → caused repeated 403s under load
  async getPosters({ filter = 0, sort = 'views', direction = 0 } = {}) {
    const cacheKey = `posters:${filter}:${sort}:${direction}`;
    return getJson(`/api/poster/by/filtres/${filter}/${sort}/${direction}${suf()}`, cacheKey, 5 * 60 * 1000);
  },

  // GET /api/search/{query}/{page}/{key}/{uuid}/
  // Cache: 3 min per query (search results can change)
  async search(query, page = 0) {
    const q        = encodeURIComponent((query || '').trim());
    const cacheKey = `search:${q}:${page}`;
    return getJson(`/api/search/${q}/${page}${suf()}`, cacheKey, 3 * 60 * 1000);
  },

  // GET /api/role/by/poster/{poster_id}/{key}/{uuid}/
  // Cache: 10 min (cast rarely changes)
  // FIX: was missing cache key
  async getRoles(posterId) {
    return getJson(`/api/role/by/poster/${posterId}${suf()}`, `roles:${posterId}`, 10 * 60 * 1000);
  },

  // GET /api/season/by/serie/{serie_id}/{key}/{uuid}/
  // Cache: 10 min
  async getSeasons(serieId) {
    return getJson(`/api/season/by/serie/${serieId}${suf()}`, `seasons:${serieId}`, 10 * 60 * 1000);
  },

  // GET /api/movie/source/by/{movie_id}/{key}/{uuid}/
  // Returns raw body — decodeSourceBody() handles it — NO video URL is fetched
  // Cache: 2 min (source URLs can expire)
  async getMovieSources(movieId) {
    const cacheKey = `msrc:${movieId}`;
    const cached = cacheGet(cacheKey);
    if (cached) { logger.debug('API', `Cache HIT: ${cacheKey}`); return cached; }
    const raw = await getRaw(`/api/movie/source/by/${movieId}${suf()}`);
    cacheSet(cacheKey, raw, 2 * 60 * 1000);
    return raw;
  },

  // GET /api/episode/source/by/{episode_id}/{key}/{uuid}/
  // Returns raw body — decodeSourceBody() handles it — NO video URL is fetched
  // Cache: 2 min
  async getEpisodeSources(episodeId) {
    const cacheKey = `esrc:${episodeId}`;
    const cached = cacheGet(cacheKey);
    if (cached) { logger.debug('API', `Cache HIT: ${cacheKey}`); return cached; }
    const raw = await getRaw(`/api/episode/source/by/${episodeId}${suf()}`);
    cacheSet(cacheKey, raw, 2 * 60 * 1000);
    return raw;
  },

  // POST /api/episode/add/view/{key}/{uuid}/
  // Response is a plain number like "4147" — this is expected, not an error
  async addEpisodeView(episodeId) {
    const url = `/api/episode/add/view${suf()}`;
    logger.debug('API', `WEB REQUEST method=POST url=${url} host=${new URL(config.api.baseUrl).hostname}`);
    try {
      const res = await req({
        method: 'POST', url,
        data: `id=${episodeId}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        responseType: 'text',
        transformResponse: [d => d],
      });
      return res.data;
    } catch (e) {
      logger.warn('API', `addEpisodeView non-fatal: ${e.message}`);
      return null;
    }
  },

  // GET /api/version/check/{app_version}/{variant}/{key}/{uuid}/
  async checkVersion(appVersion = 33, variant = 0) {
    try {
      return getJson(`/api/version/check/${appVersion}/${variant}${suf()}`, `version:${appVersion}`, 60 * 60 * 1000);
    } catch (e) {
      if (e.response?.status === 304) return { status: 'not_modified' };
      logger.warn('API', `checkVersion non-fatal: ${e.message}`);
      return null;
    }
  },

  // Expose cache clear for testing
  _clearCache() { cache.clear(); },
};

module.exports = apiClient;
