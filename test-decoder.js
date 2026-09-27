/**
 * test-decoder.js
 *
 * اختبار مستقل لـ decodeSourceBody
 * الاستخدام:
 *   node test-decoder.js
 *
 * يتصل بالـ API الحقيقي ويطبع نتيجة decode لـ:
 *   - movie_id  = 31673  (يتوقع 10 مصادر)
 *   - episode_id = 4867  (يتوقع 15 مصدرًا)
 */
'use strict';

require('dotenv').config();

const axios          = require('axios');
const config         = require('./src/config');
const { decodeSourceBody, sortSources } = require('./src/api/sourceResolver');

const BASE    = config.api.baseUrl;
const KEY     = config.api.keyPath;
const UUID    = config.api.clientUuid;
const UA      = config.api.userAgent;

function suffix() { return `/${KEY}/${UUID}/`; }

async function testSource(label, url) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ Testing ${label}`);
  console.log(`  URL: ${BASE}${url}`);

  let rawBody;
  try {
    const res = await axios.get(`${BASE}${url}`, {
      headers:           { 'User-Agent': UA, 'Accept-Encoding': 'gzip' },
      responseType:      'text',
      transformResponse: [d => d],
      timeout:           15000,
    });
    rawBody = res.data;
    console.log(`  HTTP Status   : ${res.status}`);
    console.log(`  Content-Type  : ${res.headers['content-type'] || 'n/a'}`);
    console.log(`  Body length   : ${rawBody.length} chars`);
    console.log(`  Body preview  : ${rawBody.slice(0, 100).replace(/\n/g, '\\n')}`);
  } catch (err) {
    console.error(`  ❌ HTTP request failed: ${err.message}`);
    return;
  }

  const result = decodeSourceBody(rawBody);

  if (!result.resolved) {
    console.error(`  ❌ Decode failed: ${result.reason}`);
    return;
  }

  const sorted = sortSources(result.sources);
  console.log(`\n  ✅ SOURCE DECODE SUCCESS`);
  console.log(`  SOURCE COUNT : ${result.sources.length}`);
  console.log(`  SOURCE TYPES : ${result.sources.map(s => s.type).join(', ')}`);
  console.log('\n  Sorted sources:');
  sorted.forEach((s, i) => {
    console.log(`    [${i + 1}] id=${s.id}  type=${s.type}  kind=${s.kind}  quality=${s.quality || 'null'}  class=${s.sourceClass}`);
    console.log(`         url=${s.url.slice(0, 80)}${s.url.length > 80 ? '...' : ''}`);
  });
}

async function run() {
  console.log('=== Source Decoder Test ===');
  console.log(`API: ${BASE}`);

  await testSource(
    'Movie 31673',
    `/api/movie/source/by/31673${suffix()}`
  );

  await testSource(
    'Episode 4867',
    `/api/episode/source/by/4867${suffix()}`
  );

  console.log(`\n${'═'.repeat(60)}`);
  console.log('Test complete.');
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
