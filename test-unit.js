'use strict';
const { decodeSourceBody, sortSources } = require('./src/api/sourceResolver');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✅', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

function makeSource(id, type, kind) {
  const ext = type === 'embed' ? 'html' : type;
  return {
    id, title: type, type, quality: null, size: null,
    kind: kind || 'both', premium: 0, external: type === 'embed',
    url: 'https://cdn.example.com/file-' + id + '.' + ext
  };
}

// ── Test 1: direct JSON ──────────────────────────────────────────────────────
console.log('\nTest 1: direct JSON');
const r1 = decodeSourceBody(JSON.stringify([makeSource(1, 'm3u8')]));
assert(r1.resolved === true,           'resolved');
assert(r1.sources.length === 1,        '1 source');
assert(r1.sources[0].type === 'm3u8', 'type=m3u8');
assert(r1.sources[0].originalUrl === r1.sources[0].url, 'originalUrl preserved');

// ── Test 2: prefix + W3s Base64 (real pattern from the API) ─────────────────
console.log('\nTest 2: prefix + W3s Base64 payload');
const inner2 = [
  makeSource(4140292, 'm3u8',  'both'),
  makeSource(4140293, 'webm',  'download'),
  makeSource(4140294, 'embed', 'play'),
];
const b64_2 = Buffer.from(JSON.stringify(inner2)).toString('base64');
assert(b64_2.startsWith('W3s'), 'payload starts with W3s (encodes "[{")');
const r2 = decodeSourceBody('XPREFIX_17CHARS' + b64_2);
assert(r2.resolved === true,           'resolved');
assert(r2.sources.length === 3,        '3 sources');
assert(r2.sources[0].type === 'm3u8', 'first=m3u8');
assert(r2.sources[2].type === 'embed','last=embed');

// ── Test 3: 10-source movie mock (movie_id=31673 pattern) ───────────────────
console.log('\nTest 3: 10-source movie mock');
const types3 = ['webm','m3u8','m3u8','m3u8','m3u8','m3u8','m3u8','mov','mov','embed'];
const inner3 = types3.map((t, i) => makeSource(i + 1, t));
const b64_3  = Buffer.from(JSON.stringify(inner3)).toString('base64');
const r3     = decodeSourceBody('PREFIX_STUFF_' + b64_3);
assert(r3.resolved === true,    'resolved');
assert(r3.sources.length === 10,'10 sources');

// ── Test 4: 15-source episode mock (episode_id=4867 pattern) ────────────────
console.log('\nTest 4: 15-source episode mock');
const types4 = ['m3u8','webm','m3u8','m3u8','webm','m3u8','m3u8','webm','m3u8','m3u8','webm','m3u8','mov','embed','embed'];
const inner4 = types4.map((t, i) => makeSource(i + 100, t));
const b64_4  = Buffer.from(JSON.stringify(inner4)).toString('base64');
const r4     = decodeSourceBody('RANDOMPFX' + b64_4);
assert(r4.resolved === true,    'resolved');
assert(r4.sources.length === 15,'15 sources');

// ── Test 5: empty body ───────────────────────────────────────────────────────
console.log('\nTest 5: empty body');
const r5 = decodeSourceBody('');
assert(r5.resolved === false,           'not resolved');
assert(r5.reason === 'EMPTY_RESPONSE', 'reason=EMPTY_RESPONSE');

// ── Test 6: corrupt body ─────────────────────────────────────────────────────
console.log('\nTest 6: corrupt body');
const r6 = decodeSourceBody('!!!NOT_VALID_ANYTHING!!!');
assert(r6.resolved === false,                  'not resolved');
assert(r6.reason === 'SOURCE_DECODE_FAILED',  'reason=SOURCE_DECODE_FAILED');

// ── Test 7: sortSources ──────────────────────────────────────────────────────
// Sort order: kind first (both=3 > play=2 > download=1), then class (m3u8=5 > webm=3 > embed=0)
// id:3 m3u8+both  → first  (kind=3, class=5)
// id:4 webm+both  → second (kind=3, class=3)
// id:1 embed+play → third  (kind=2, class=0) — play > download by kind
// id:2 m3u8+dl    → last   (kind=1, class=5)
console.log('\nTest 7: sortSources');
const unsorted = [
  { id:1, type:'embed', kind:'play',     sourceClass:'embed' },
  { id:2, type:'m3u8',  kind:'download', sourceClass:'m3u8'  },
  { id:3, type:'m3u8',  kind:'both',     sourceClass:'m3u8'  },
  { id:4, type:'webm',  kind:'both',     sourceClass:'webm'  },
];
const sorted = sortSources(unsorted);
assert(sorted[0].id === 3,  'm3u8+both is first');
assert(sorted[1].id === 4,  'webm+both is second');
assert(sorted[2].id === 1,  'embed+play is third (play > download by kind)');
assert(sorted[3].id === 2,  'm3u8+download is last');

// ── Test 8: eyJ appears inside payload (the exact bug we fixed) ─────────────
console.log('\nTest 8: eyJ inside payload — must not cause partial decode');
const inner8 = [
  makeSource(10, 'm3u8',  'both'),
  makeSource(11, 'm3u8',  'both'),
  makeSource(12, 'embed', 'play'),
];
const b64_8 = Buffer.from(JSON.stringify(inner8)).toString('base64');
// eyJ appears inside b64_8 — we must still decode the whole thing correctly
const hasEyJ = b64_8.includes('eyJ');
if (hasEyJ) {
  console.log('  ℹ️  eyJ confirmed inside payload at idx=' + b64_8.indexOf('eyJ'));
}
const r8 = decodeSourceBody('DATA_PFX_' + b64_8);
assert(r8.resolved === true,           'resolved despite eyJ inside payload');
assert(r8.sources.length === 3,        '3 sources decoded correctly');
assert(r8.sources[0].type === 'm3u8', 'first source=m3u8');

// ── Test 9: Buffer input ─────────────────────────────────────────────────────
console.log('\nTest 9: Buffer input');
const inner9  = [makeSource(99, 'mov', 'download')];
const b64_9   = Buffer.from(JSON.stringify(inner9)).toString('base64');
const bufBody = Buffer.from('BUF_PREFIX' + b64_9, 'utf8');
const r9      = decodeSourceBody(bufBody);
assert(r9.resolved === true,          'resolved from Buffer');
assert(r9.sources[0].type === 'mov', 'type=mov');

// ── Test 10: sourceClass mapping ────────────────────────────────────────────
console.log('\nTest 10: sourceClass mapping');
const inner10 = [
  makeSource(200, 'm3u8'),
  makeSource(201, 'embed'),
  makeSource(202, 'webm'),
  makeSource(203, 'mov'),
];
const r10 = decodeSourceBody(JSON.stringify(inner10));
assert(r10.resolved === true,                    'resolved');
assert(r10.sources[0].sourceClass === 'm3u8',  'class=m3u8');
assert(r10.sources[1].sourceClass === 'embed', 'class=embed');
assert(r10.sources[2].sourceClass === 'webm',  'class=webm');
assert(r10.sources[3].sourceClass === 'mov',   'class=mov');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
if (failed === 0) {
  console.log('✅ All ' + passed + ' assertions passed');
} else {
  console.error('❌ ' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
