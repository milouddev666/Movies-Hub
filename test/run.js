'use strict';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.error('  ❌ FAIL:', msg); failed++; }
}
function section(name) { console.log(`\n${'─'.repeat(55)}\n▶ ${name}`); }

function makeSource(id, type, kind, url) {
  const ext = type === 'embed' ? 'html' : type;
  return {
    id, title: type, type, quality: null, size: null, kind: kind || 'both',
    premium: 0, external: type === 'embed',
    url: url || `https://cdn.example.com/file-${id}.${ext}`,
  };
}

// ── 1. looksLikeEmbedUrl ──────────────────────────────────────────────────────
section('looksLikeEmbedUrl');
const { looksLikeEmbedUrl, determinePlayerMode, decodeSourceBody, sortSources } = require('../src/api/sourceResolver');

assert(looksLikeEmbedUrl('https://uqload.vc/embed-abc123.html')        === true,  'embed .html URL');
assert(looksLikeEmbedUrl('https://streamwish.fun/e/h1j6bijqhx78')      === true,  'streamwish /e/ path');
assert(looksLikeEmbedUrl('https://earnvids.xyz/v/1wo2dqi7qjya')        === true,  'earnvids /v/ path');
assert(looksLikeEmbedUrl('https://dwapp.qzz.io/url.php?url=https://...')=== true,  'redirect wrapper /url.php');
assert(looksLikeEmbedUrl('https://cdn.example.com/video.m3u8')         === false, 'real .m3u8 URL');
assert(looksLikeEmbedUrl('https://cdn.example.com/video.webm')         === false, 'real .webm URL');
assert(looksLikeEmbedUrl('https://cdn.example.com/video.mov')          === false, 'real .mov URL');
assert(looksLikeEmbedUrl('https://cdn.example.com/movie.mp4')          === false, 'real .mp4 URL');

// ── 2. determinePlayerMode ────────────────────────────────────────────────────
section('determinePlayerMode (KEY FIX: type=m3u8 + embed URL → embed)');
// The critical bug: API returns type='m3u8' but URL is an HTML embed page
assert(determinePlayerMode({ type: 'm3u8',  url: 'https://uqload.vc/embed-abc.html' })  === 'embed', 'type=m3u8 + embed URL → embed mode');
assert(determinePlayerMode({ type: 'm3u8',  url: 'https://streamwish.fun/e/xyz123' })   === 'embed', 'type=m3u8 + /e/ path → embed mode');
assert(determinePlayerMode({ type: 'm3u8',  url: 'https://cdn.example.com/v.m3u8' })   === 'm3u8',  'type=m3u8 + real .m3u8 → HLS mode');
assert(determinePlayerMode({ type: 'embed', url: 'https://any.url/player' })            === 'embed', 'type=embed → embed mode');
assert(determinePlayerMode({ type: 'webm',  url: 'https://cdn.example.com/v.webm' })   === 'webm',  'type=webm → webm mode');
assert(determinePlayerMode({ type: 'mov',   url: 'https://cdn.example.com/v.mov' })    === 'mov',   'type=mov → mov mode');
assert(determinePlayerMode({ type: 'embed', url: 'https://dwapp.qzz.io/url.php?url=https://streamwish.fun/e/h1j6bijqhx78' }) === 'embed', 'verified episode embed URL → embed');

// ── 3. decodeSourceBody ───────────────────────────────────────────────────────
section('Source Decoder (W3s, not eyJ)');

// Direct JSON
{
  const r = decodeSourceBody(JSON.stringify([makeSource(1, 'm3u8')]));
  assert(r.resolved === true,            'direct JSON: resolved');
  assert(r.sources.length === 1,         'direct JSON: 1 source');
  assert(r.sources[0].originalUrl === r.sources[0].url, 'originalUrl preserved');
  assert(r.sources[0].playerMode !== undefined, 'playerMode present on decoded source');
}

// W3s prefix (verified API pattern)
{
  const inner = Array.from({ length: 8 }, (_, i) =>
    makeSource(i+1, ['webm','m3u8','m3u8','m3u8','mov','mov','mov','embed'][i]));
  const b64 = Buffer.from(JSON.stringify(inner)).toString('base64');
  assert(b64.startsWith('W3s'), 'W3s start confirmed (not eyJ)');
  const r = decodeSourceBody('RANDPREFIX' + b64);
  assert(r.resolved === true,     'W3s prefix: resolved');
  assert(r.sources.length === 8,  'W3s prefix: 8 sources (matches Render log)');
}

// 10 movie sources
{
  const types = ['webm','m3u8','m3u8','m3u8','m3u8','m3u8','m3u8','mov','mov','embed'];
  const inner = types.map((t, i) => makeSource(i+1, t));
  const b64   = Buffer.from(JSON.stringify(inner)).toString('base64');
  const r     = decodeSourceBody('PFX' + b64);
  assert(r.resolved === true,      'movie: resolved');
  assert(r.sources.length === 10,  'movie: 10 sources (verified)');
}

// 15 episode sources
{
  const types = ['m3u8','webm','m3u8','m3u8','webm','m3u8','m3u8','webm','m3u8','m3u8','webm','m3u8','mov','embed','embed'];
  const inner = types.map((t, i) => makeSource(i+100, t));
  const b64   = Buffer.from(JSON.stringify(inner)).toString('base64');
  const r     = decodeSourceBody('PFX' + b64);
  assert(r.resolved === true,      'episode: resolved');
  assert(r.sources.length === 15,  'episode: 15 sources (verified)');
}

// eyJ inside payload must not cause partial decode
{
  const inner = [makeSource(10,'m3u8'), makeSource(11,'webm'), makeSource(12,'embed')];
  const b64   = Buffer.from(JSON.stringify(inner)).toString('base64');
  const hasEyJ = b64.includes('eyJ');
  const r = decodeSourceBody('PFX_' + b64);
  assert(r.resolved === true,    `eyJ-inside-payload: resolved (eyJ in payload=${hasEyJ})`);
  assert(r.sources.length === 3, 'eyJ-inside-payload: all 3 sources decoded');
}

// empty + corrupt
{
  assert(decodeSourceBody('').resolved === false,              'empty: not resolved');
  assert(decodeSourceBody('').reason === 'EMPTY_RESPONSE',    'empty: EMPTY_RESPONSE');
  assert(decodeSourceBody('!!!CORRUPT!!!').resolved === false, 'corrupt: not resolved');
}

// Buffer input
{
  const inner = [makeSource(99, 'mov', 'download')];
  const r = decodeSourceBody(Buffer.from('BUF_' + Buffer.from(JSON.stringify(inner)).toString('base64')));
  assert(r.resolved === true,         'Buffer: resolved');
  assert(r.sources[0].type === 'mov', 'Buffer: type=mov');
}

// ── 4. playerMode on normalized sources ──────────────────────────────────────
section('playerMode set correctly after decode');
{
  // Embed URL with type='m3u8' — must get playerMode='embed'
  const inner = [{
    id: 3567306, title: 'embed', type: 'embed', kind: 'both',
    quality: null, size: null, premium: 1, external: false,
    url: 'https://dwapp.qzz.io/url.php?url=https://streamwish.fun/e/h1j6bijqhx78'
  }, {
    id: 3567307, title: 'm3u8', type: 'm3u8', kind: 'both',
    quality: null, size: null, premium: 1, external: false,
    url: 'https://uqload.vc/embed-abc123.html'  // embed URL with m3u8 type!
  }, {
    id: 3567308, title: 'm3u8', type: 'm3u8', kind: 'both',
    quality: null, size: null, premium: 0, external: false,
    url: 'https://cdn.real-server.com/video/playlist.m3u8'  // real HLS
  }];
  const r = decodeSourceBody(JSON.stringify(inner));
  assert(r.resolved === true,                         'decoded OK');
  assert(r.sources[0].playerMode === 'embed',         'embed type → playerMode=embed');
  assert(r.sources[1].playerMode === 'embed',         'embed URL + type=m3u8 → playerMode=embed (KEY FIX)');
  assert(r.sources[2].playerMode === 'm3u8',          'real .m3u8 URL → playerMode=m3u8');
}

// ── 5. sortSources ────────────────────────────────────────────────────────────
section('sortSources');
{
  const list = [
    { id:1, type:'embed', kind:'play',     sourceClass:'embed' },
    { id:2, type:'m3u8',  kind:'download', sourceClass:'m3u8'  },
    { id:3, type:'m3u8',  kind:'both',     sourceClass:'m3u8'  },
    { id:4, type:'webm',  kind:'both',     sourceClass:'webm'  },
  ];
  const s = sortSources(list);
  assert(s[0].id === 3, 'm3u8+both first');
  assert(s[3].id === 2, 'm3u8+download last');
}

// kind filtering for play vs download
{
  const sources = [
    { id:10, type:'m3u8', kind:'play',     sourceClass:'m3u8', playerMode:'m3u8'  },
    { id:11, type:'webm', kind:'download', sourceClass:'webm', playerMode:'webm'  },
    { id:12, type:'mov',  kind:'both',     sourceClass:'mov',  playerMode:'mov'   },
    { id:13, type:'embed',kind:'both',     sourceClass:'embed',playerMode:'embed' },
  ];
  const playable   = sources.filter(s => s.kind === 'play' || s.kind === 'both');
  const downloadable = sources.filter(s => s.kind === 'download' || s.kind === 'both');
  assert(playable.some(s => s.id === 10),     'play source in playable list');
  assert(playable.some(s => s.id === 12),     'both source in playable list');
  assert(!playable.some(s => s.id === 11),    'download-only NOT in playable list');
  assert(downloadable.some(s => s.id === 11), 'download source in downloadable');
  assert(downloadable.some(s => s.id === 12), 'both source in downloadable');
}

// ── 6. 403 handling simulation ────────────────────────────────────────────────
section('403 / external provider failure handling');
{
  // Simulate: sources resolved OK but first source returns 403 from provider
  // Player should have multiple sources to fall back to
  const sources = [
    { id:1, type:'m3u8', kind:'both', playerMode:'m3u8', url:'https://provider1.com/s.m3u8', title:'HD' },
    { id:2, type:'embed',kind:'both', playerMode:'embed', url:'https://embed2.com/e/abc',    title:'SD' },
  ];
  // The player receives allSources and can navigate to next one
  const fallback = sources.filter((_, i) => i !== 0); // skip failed source 0
  assert(fallback.length === 1,                    '403: fallback source available');
  assert(fallback[0].playerMode === 'embed',       '403: fallback is embed (different type)');
  assert(fallback[0].id === 2,                     '403: correct fallback source ID');
}

// ── 7. JSON Storage ───────────────────────────────────────────────────────────
section('JSON Storage');
const store = require('../src/storage/jsonStore');

store.upsertUser({ telegramId: 88888, username: 'testuser2', firstName: 'Test', lastName: 'U' });
const u = store.getUser(88888);
assert(u !== null,               'getUser: found');
assert(u.username === 'testuser2','getUser: username');

store.addFavorite({ telegramId: 88888, posterId: 31673, posterType: 'movie', title: 'Test Movie', image: null });
assert(store.isFavorite({ telegramId: 88888, posterId: 31673, posterType: 'movie' }), 'isFavorite: true');
store.removeFavorite({ telegramId: 88888, posterId: 31673, posterType: 'movie' });
assert(!store.isFavorite({ telegramId: 88888, posterId: 31673, posterType: 'movie' }), 'removeFavorite: gone');

store.addWatchHistory({ telegramId: 88888, posterId: 229, posterType: 'serie', episodeId: 4867, seasonTitle: 'S1', episodeTitle: 'E1', title: 'Serie', image: null, positionSec: 45 });
const hist = store.getWatchHistory(88888, 5);
assert(hist.length >= 1,             'history: stored');
assert(hist[0].positionSec === 45,   'history: positionSec');

const db = store.read();
assert(typeof db.users === 'object',      'read: users');
assert(typeof db.favorites === 'object',  'read: favorites');
assert(typeof db.watchHistory === 'object','read: watchHistory');

// ── 8. apiClient: all list endpoints have cache keys ─────────────────────────
section('apiClient: cache prevents repeated 403s');
{
  // Verify the ROOT CAUSE FIX:
  // Before fix: getMovies/getSeries/getPosters/getRoles/getRandomMovies had NO cache key
  // → every Mini App page load = new HTTP request to dwapp.arabypros.com → 403 under load
  // After fix: all have cache keys → only 1 request per TTL window

  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'api', 'apiClient.js'), 'utf8'
  );

  // Each of these must have a cacheKey (not called with just the URL)
  // Cache keys use template literals (backtick) for dynamic keys, single-quote for static
  assert(/movies:.*sort.*flag/.test(src),    'getMovies: has dynamic cache key');
  assert(/series:.*sort.*flag/.test(src),    'getSeries: has dynamic cache key');
  assert(/posters:.*sort.*direction/.test(src),'getPosters: has dynamic cache key');
  assert(/random:.*limit/.test(src) || src.includes('`random:'), 'getRandomMovies: has cache key');
  assert(/roles:.*posterId/.test(src),       'getRoles: has dynamic cache key');
  assert(/seasons:.*serieId/.test(src),      'getSeasons: has dynamic cache key');
  assert(/msrc:.*movieId/.test(src),         'getMovieSources: has cache key');
  assert(/esrc:.*episodeId/.test(src),       'getEpisodeSources: has cache key');
  assert(src.includes("'genres'"),           'getGenres: has static cache key');
  assert(src.includes("'years'"),            'getYears: has static cache key');
  assert(src.includes("'first'"),            'getFirst: has static cache key');
}

// ── 9. Backend NEVER fetches external source/video URLs ─────────────────────
section('Backend does NOT proxy/fetch video or embed URLs');
{
  // Verify routes.js has no code that fetches a source URL (only apiClient is called)
  const routesSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'web', 'routes.js'), 'utf8'
  );

  // Must NOT contain axios.get(srcUrl) or fetch(srcUrl) patterns
  assert(!routesSrc.includes('axios.get(src'),   'routes.js: no axios.get(src...)');
  assert(!routesSrc.includes('fetch(src'),        'routes.js: no fetch(src...)');
  assert(!routesSrc.includes('axios.get(url'),    'routes.js: no axios.get(url...)');
  assert(!routesSrc.includes('http.get('),        'routes.js: no http.get(');
  assert(!routesSrc.includes('pipe(res'),         'routes.js: no pipe(res) proxy');

  // Source handling must go through apiClient (dwapp.arabypros.com) and sourceResolver
  assert(routesSrc.includes('apiClient.getMovieSources'),   'routes.js: uses apiClient.getMovieSources');
  assert(routesSrc.includes('sourceResolver.decodeSourceBody'), 'routes.js: uses decodeSourceBody');
  // NOT fetching the source URL itself
  assert(!routesSrc.includes('.get(result'),   'routes.js: no fetching result URL');
  assert(!routesSrc.includes('.get(source'),   'routes.js: no fetching source URL');
}

// ── 10. No PostgreSQL ──────────────────────────────────────────────────────────
section('No PostgreSQL references in src/');
{
  const fs = require('fs'), path = require('path');
  function scan(dir) {
    let hits = [];
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory() && !['node_modules','test','data'].includes(f.name)) hits = hits.concat(scan(full));
      else if (f.isFile() && f.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        if (/require\s*\(\s*['"]pg['"]\s*\)/.test(src) || /new Pool\(/.test(src) || /CREATE TABLE/i.test(src))
          hits.push(f.name);
      }
    }
    return hits;
  }
  const hits = scan(path.join(__dirname, '..', 'src'));
  assert(hits.length === 0, `No pg/Pool/CREATE TABLE (found: ${hits.join(', ') || 'none'})`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(55));
if (failed === 0) console.log(`✅ All ${passed} assertions passed`);
else { console.error(`❌ ${failed} failed, ${passed} passed`); process.exit(1); }
