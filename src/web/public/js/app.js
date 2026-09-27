'use strict';

/* ─── Telegram WebApp SDK ──────────────────────────────────────────────────── */
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0f0f13');
  tg.setBackgroundColor('#0f0f13');
}

const INIT_DATA = tg?.initData || '';

/* ─── Utilities ─────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function toast(msg, ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

/* ─── Lazy image loading ─────────────────────────────────────────────────────── */
const imgObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const img = e.target;
    img.src = img.dataset.src || '';
    img.onload  = () => img.classList.add('loaded');
    img.onerror = () => { img.src = ''; img.style.background = '#22222e'; img.classList.add('loaded'); };
    imgObserver.unobserve(img);
  });
}, { rootMargin: '160px' });

function lazyImg(img) { imgObserver.observe(img); }

/* ─── API client (proxy through Render backend) ──────────────────────────────── */
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (INIT_DATA) headers['x-telegram-init-data'] = INIT_DATA;
  const res = await fetch('/api' + path, { headers, ...opts });

  // Backend returns 200 with error field for rate-limited/403 from dwapp.arabypros.com
  // This keeps the Mini App alive even when the content API is temporarily unavailable
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Attach the human-readable message if backend provided one
    const msg = body.message || body.error || `HTTP ${res.status}`;
    const err  = new Error(msg);
    err.status = res.status;
    err.code   = body.error;
    throw err;
  }

  // 200 but with error (rate-limited, forbidden from content API)
  if (body.error === 'api_rate_limited') {
    const err  = new Error(body.message || 'خدمة المحتوى مشغولة مؤقتاً');
    err.code   = 'api_rate_limited';
    err.status = 200;
    throw err;
  }

  return body;
}

const API = {
  home:       ()          => apiFetch('/home'),
  movies:     (qs = '')   => apiFetch('/movies' + qs),
  series:     (qs = '')   => apiFetch('/series' + qs),
  random:     (n = 20)    => apiFetch(`/random?limit=${n}`),
  search:     (q, pg = 0) => apiFetch(`/search?q=${encodeURIComponent(q)}&page=${pg}`),
  genres:     ()          => apiFetch('/genres'),
  seasons:    id          => apiFetch(`/serie/${id}/seasons`),
  movieSrc:   id          => apiFetch(`/movie/${id}/sources`),
  episodeSrc: id          => apiFetch(`/episode/${id}/sources`),
  favorites:  ()          => apiFetch('/favorites'),
  addFav:     body        => apiFetch('/favorites', { method: 'POST', body: JSON.stringify(body) }),
  removeFav:  (id, type)  => apiFetch(`/favorites/${id}?posterType=${type}`, { method: 'DELETE' }),
  addHistory: body        => apiFetch('/history', { method: 'POST', body: JSON.stringify(body) }),
};

/* ─── State ──────────────────────────────────────────────────────────────────── */
const state = {
  currentPage:    'pageHome',
  homeLoaded:     false,
  moviesLoaded:   false,
  seriesLoaded:   false,
  allMovies:      [],
  allSeries:      [],
  currentDetail:  null,
};

/* ─── Page navigation ────────────────────────────────────────────────────────── */
function showPage(pageId) {
  $$('.page').forEach(p => p.classList.remove('active'));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
  $(pageId).classList.add('active');
  state.currentPage = pageId;
  window.scrollTo(0, 0);

  if (pageId === 'pageHome'      && !state.homeLoaded)   loadHome();
  if (pageId === 'pageMovies'    && !state.moviesLoaded) loadMovies();
  if (pageId === 'pageSeries'    && !state.seriesLoaded) loadSeries();
  if (pageId === 'pageFavorites')                        loadFavorites();
}

$$('.nav-btn').forEach(btn =>
  btn.addEventListener('click', () => showPage(btn.dataset.page))
);

/* ─── Card builder ───────────────────────────────────────────────────────────── */
function buildCard(item, onclick) {
  const el    = document.createElement('div');
  el.className = 'card';
  el.setAttribute('role', 'button');
  el.tabIndex = 0;

  const imgSrc = item.image || '';
  const imdb   = item.imdb  ? `⭐${item.imdb}` : '';
  const badge  = item.type === 'serie' ? 'مسلسل' : 'فيلم';

  el.innerHTML = `
    <div class="card-img-wrap">
      <img class="card-img lazy" data-src="${esc(imgSrc)}" alt="${esc(item.title)}">
      ${imdb ? `<div class="card-badge">${imdb}</div>` : ''}
      <div class="card-type-badge">${badge}</div>
    </div>
    <div class="card-info">
      <div class="card-title">${esc(item.title)}</div>
      ${item.year ? `<div class="card-year">${item.year}</div>` : ''}
    </div>`;

  const img = el.querySelector('.card-img');
  if (imgSrc) lazyImg(img);

  const click = () => onclick(item);
  el.addEventListener('click', click);
  el.addEventListener('keydown', e => e.key === 'Enter' && click());
  return el;
}

/* ─── Skeleton rows ──────────────────────────────────────────────────────────── */
function skeletonRow(containerId) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    s.className = 'card skeleton-card';
    s.innerHTML = '<div class="card-img-wrap skeleton" style="height:var(--card-h)"></div>';
    el.appendChild(s);
  }
}

function skeletonGrid(containerId) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('div');
    s.className = 'skeleton';
    s.style.cssText = 'height:200px;border-radius:12px';
    el.appendChild(s);
  }
}

/* ─── HOME page ──────────────────────────────────────────────────────────────── */
async function loadHome() {
  state.homeLoaded = true;
  skeletonRow('latestMoviesRow');
  skeletonRow('latestSeriesRow');
  skeletonRow('randomMoviesRow');

  const [homeRes, moviesRes, seriesRes, randomRes] = await Promise.allSettled([
    API.home(),
    API.movies(),
    API.series(),
    API.random(12),
  ]);

  // Hero: first poster from home (graceful — don't fail if home errors)
  const homeData = homeRes.status === 'fulfilled' ? homeRes.value : null;
  const posters  = homeData?.first?.posters || [];
  if (posters.length > 0) buildHero(posters[0]);
  else $('heroSection').innerHTML = '';

  // Latest movies (show retry notice if rate-limited, don't blank the page)
  if (moviesRes.status === 'fulfilled') {
    const movies = moviesRes.value?.movies || [];
    state.allMovies = movies;
    buildRow('latestMoviesRow', movies.slice(0, 16), openDetail);
  } else {
    showRowError('latestMoviesRow', moviesRes.reason);
  }

  // Latest series
  if (seriesRes.status === 'fulfilled') {
    const series = seriesRes.value?.series || [];
    state.allSeries = series;
    buildRow('latestSeriesRow', series.slice(0, 16), openDetail);
  } else {
    showRowError('latestSeriesRow', seriesRes.reason);
  }

  // Random movies
  if (randomRes.status === 'fulfilled') {
    buildRow('randomMoviesRow', randomRes.value?.movies || [], openDetail);
  } else {
    showRowError('randomMoviesRow', randomRes.reason);
  }
}

function buildHero(item) {
  const sec = $('heroSection');
  if (!item) { sec.innerHTML = ''; return; }
  const img = item.cover || item.image || '';
  sec.innerHTML = `
    <img class="hero-img" src="${esc(img)}" alt="${esc(item.title)}" onerror="this.style.display='none'">
    <div class="hero-grad"></div>
    <div class="hero-info">
      <div class="hero-title">${esc(item.title)}</div>
      <div class="hero-meta">${item.year || ''} ${item.classification || ''}</div>
      <button class="hero-play-btn" id="heroPlayBtn">▶️ تفاصيل</button>
    </div>`;
  $('heroPlayBtn').addEventListener('click', () => openDetail(item));
}

function buildRow(rowId, items, onclick) {
  const row = $(rowId);
  if (!row) return;
  row.innerHTML = '';
  if (!items || items.length === 0) {
    row.innerHTML = '<p style="color:var(--text3);font-size:.8rem;padding:8px 0">لا يوجد محتوى</p>';
    return;
  }
  items.forEach(item => row.appendChild(buildCard(item, onclick)));
}

function showRowError(rowId, err) {
  const row = $(rowId);
  if (!row) return;
  const isRateLimit = err?.code === 'api_rate_limited' || err?.status === 403;
  row.innerHTML = `<div style="color:var(--text3);font-size:.8rem;padding:8px 0;white-space:nowrap">
    ${isRateLimit ? '⏳ المحتوى مشغول مؤقتاً — ' : '⚠️ خطأ مؤقت — '}
    <button onclick="showPage(state.currentPage)" style="color:var(--accent);background:none;border:none;cursor:pointer;font-size:.8rem">إعادة المحاولة</button>
  </div>`;
}

/* ─── MOVIES page ────────────────────────────────────────────────────────────── */
async function loadMovies() {
  state.moviesLoaded = true;
  skeletonGrid('moviesGrid');
  try {
    const data = await API.movies();
    const list = data?.movies || [];
    state.allMovies = list;
    const grid = $('moviesGrid');
    grid.innerHTML = '';
    list.forEach(m => grid.appendChild(buildCard(m, openDetail)));
  } catch (err) {
    const isRateLimit = err?.code === 'api_rate_limited';
    $('moviesGrid').innerHTML = `
      <div style="color:var(--text2);padding:28px;text-align:center">
        <div style="font-size:2rem;margin-bottom:8px">${isRateLimit ? '⏳' : '⚠️'}</div>
        <p>${isRateLimit ? 'خدمة المحتوى مشغولة مؤقتاً' : esc(err.message)}</p>
        <button onclick="state.moviesLoaded=false;loadMovies()" style="margin-top:12px;padding:8px 20px;border-radius:50px;background:var(--accent);color:#fff;border:none;cursor:pointer;font-size:.85rem">إعادة المحاولة</button>
      </div>`;
  }
}

/* ─── SERIES page ────────────────────────────────────────────────────────────── */
async function loadSeries() {
  state.seriesLoaded = true;
  skeletonGrid('seriesGrid');
  try {
    const data = await API.series();
    const list = data?.series || [];
    state.allSeries = list;
    const grid = $('seriesGrid');
    grid.innerHTML = '';
    list.forEach(s => grid.appendChild(buildCard(s, openDetail)));
  } catch (err) {
    const isRateLimit = err?.code === 'api_rate_limited';
    $('seriesGrid').innerHTML = `
      <div style="color:var(--text2);padding:28px;text-align:center">
        <div style="font-size:2rem;margin-bottom:8px">${isRateLimit ? '⏳' : '⚠️'}</div>
        <p>${isRateLimit ? 'خدمة المحتوى مشغولة مؤقتاً' : esc(err.message)}</p>
        <button onclick="state.seriesLoaded=false;loadSeries()" style="margin-top:12px;padding:8px 20px;border-radius:50px;background:var(--accent);color:#fff;border:none;cursor:pointer;font-size:.85rem">إعادة المحاولة</button>
      </div>`;
  }
}

/* ─── SEARCH ──────────────────────────────────────────────────────────────────── */
// Header search overlay
$('headerSearchBtn').addEventListener('click', openSearchOverlay);
$('searchClose').addEventListener('click',    closeSearchOverlay);

function openSearchOverlay() {
  $('searchOverlay').classList.add('open');
  setTimeout(() => $('searchInput').focus(), 80);
}
function closeSearchOverlay() {
  $('searchOverlay').classList.remove('open');
  $('searchInput').value = '';
  $('searchGrid').innerHTML = '';
  $('searchEmpty').hidden = true;
}

let overlayAbort = null;
const doOverlaySearch = debounce(async q => {
  $('searchGrid').innerHTML = '';
  $('searchEmpty').hidden = true;
  if (!q.trim()) return;
  if (overlayAbort) overlayAbort.abort();
  overlayAbort = new AbortController();
  try {
    const data = await API.search(q, 0);
    const results = data?.results || [];
    $('searchEmpty').hidden = results.length > 0;
    results.forEach(item => {
      $('searchGrid').appendChild(buildCard(item, i => {
        closeSearchOverlay();
        openDetail(i);
      }));
    });
  } catch (e) { if (e.name !== 'AbortError') console.warn('search', e.message); }
}, 420);

$('searchInput').addEventListener('input', e => doOverlaySearch(e.target.value));

// Bottom-nav search page
let pageAbort = null;
const doPageSearch = debounce(async q => {
  $('pageSearchGrid').innerHTML = '';
  $('pageSearchEmpty').hidden = false;
  if (!q.trim()) return;
  if (pageAbort) pageAbort.abort();
  pageAbort = new AbortController();
  try {
    const data = await API.search(q, 0);
    const results = data?.results || [];
    $('pageSearchEmpty').hidden = results.length > 0;
    results.forEach(item => $('pageSearchGrid').appendChild(buildCard(item, openDetail)));
  } catch (e) { if (e.name !== 'AbortError') console.warn('page-search', e.message); }
}, 420);

$('pageSearchInput').addEventListener('input', e => doPageSearch(e.target.value));

/* ─── FAVORITES page ──────────────────────────────────────────────────────────── */
async function loadFavorites() {
  $('favoritesGrid').innerHTML = '';
  $('favEmpty').hidden = true;
  try {
    const data = await API.favorites();
    const favs = data?.favorites || [];
    if (favs.length === 0) { $('favEmpty').hidden = false; return; }
    favs.forEach(f => {
      $('favoritesGrid').appendChild(buildCard(
        { id: f.poster_id, type: f.poster_type, title: f.title, image: f.image },
        openDetail
      ));
    });
  } catch (_) {
    $('favEmpty').hidden = false;
  }
}

/* ─── DETAIL SHEET ───────────────────────────────────────────────────────────── */
function openDetail(item) {
  state.currentDetail = item;

  $('detailTitle').textContent = item.title || '';
  $('detailDesc').textContent  = item.description || '';
  $('detailPoster').src = item.image || '';
  $('detailCover').src  = item.cover || item.image || '';
  $('detailPoster').alt = item.title || '';
  $('detailCover').alt  = item.title || '';

  // Meta chips
  const meta = $('detailMeta');
  meta.innerHTML = '';
  const chip = (txt, cls = '') => {
    const s = document.createElement('span');
    s.className = `meta-tag ${cls}`;
    s.textContent = txt;
    meta.appendChild(s);
  };
  if (item.year)           chip(item.year);
  if (item.imdb)           chip(`⭐ ${item.imdb}`, 'gold');
  if (item.duration)       chip(`⏱ ${item.duration}`);
  if (item.classification) item.classification.split(/[,،]/).slice(0, 3).forEach(g => chip(g.trim()));

  // Actions
  const actions = $('detailActions');
  actions.innerHTML = '';

  if (item.type !== 'serie') {
    const watchBtn = document.createElement('button');
    watchBtn.className = 'action-btn action-primary';
    watchBtn.textContent = '▶️ مشاهدة';
    watchBtn.addEventListener('click', () => fetchSources(item, 'movie', 'play'));
    actions.appendChild(watchBtn);

    const dlBtn = document.createElement('button');
    dlBtn.className = 'action-btn action-secondary';
    dlBtn.textContent = '⬇️ تحميل';
    dlBtn.addEventListener('click', () => fetchSources(item, 'movie', 'download'));
    actions.appendChild(dlBtn);
  }

  // Fav button
  const favBtn = document.createElement('button');
  favBtn.className = 'action-btn action-fav';
  favBtn.textContent = '❤️ إضافة للمفضلة';
  favBtn.dataset.active = 'false';
  favBtn.addEventListener('click', () => toggleFav(item, favBtn));
  actions.appendChild(favBtn);

  // Seasons (series only)
  const seasonsWrap = $('seasonsWrap');
  seasonsWrap.hidden   = item.type !== 'serie';
  seasonsWrap.innerHTML = '';
  if (item.type === 'serie') {
    seasonsWrap.innerHTML = '<div class="skeleton" style="height:44px;border-radius:8px;margin-top:12px"></div>';
    loadSeasons(item.id, seasonsWrap, item);
  }

  // Open sheet
  $('detailSheet').classList.add('open');
  $('detailSheet').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  $('detailSheet').classList.remove('open');
  $('detailSheet').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  state.currentDetail = null;
}

$('detailClose').addEventListener('click', closeDetail);
$('detailBackdrop').addEventListener('click', closeDetail);

// Seasons accordion
async function loadSeasons(serieId, wrap, serieItem) {
  try {
    const data    = await API.seasons(serieId);
    const seasons = data?.seasons || [];
    wrap.innerHTML = '';
    if (seasons.length === 0) {
      wrap.innerHTML = '<p style="color:var(--text2);font-size:.85rem;padding:8px 0">لا توجد مواسم</p>';
      return;
    }
    seasons.forEach((season, si) => {
      const item = document.createElement('div');
      item.className = 'season-item';

      const hdr = document.createElement('div');
      hdr.className = 'season-header' + (si === 0 ? ' open' : '');
      hdr.innerHTML = `<span>${esc(season.title)}</span><span class="season-chevron">▼</span>`;

      const epList = document.createElement('div');
      epList.className = 'episodes-list';
      if (si === 0) epList.style.display = 'block';

      (season.episodes || []).forEach((ep, ei) => {
        const epEl = document.createElement('div');
        epEl.className = 'episode-item';
        epEl.innerHTML = `
          <div class="episode-num">${ei + 1}</div>
          <div class="episode-info">
            <div class="episode-title">${esc(ep.title || `الحلقة ${ei + 1}`)}</div>
            ${ep.duration ? `<div class="episode-dur">⏱ ${esc(ep.duration)}</div>` : ''}
          </div>
          <span class="episode-play">▶</span>`;
        epEl.addEventListener('click', () => watchEpisode(ep, season, serieItem));
        epList.appendChild(epEl);
      });

      hdr.addEventListener('click', () => {
        const isOpen = hdr.classList.toggle('open');
        epList.style.display = isOpen ? 'block' : 'none';
      });

      item.appendChild(hdr);
      item.appendChild(epList);
      wrap.appendChild(item);
    });
  } catch (err) {
    wrap.innerHTML = `<p style="color:var(--text2);font-size:.85rem">⚠️ ${esc(err.message)}</p>`;
  }
}

async function watchEpisode(ep, season, serieItem) {
  // Log to watch history
  try {
    await API.addHistory({
      posterId:     serieItem?.id,
      posterType:   'serie',
      episodeId:    ep.id,
      seasonTitle:  season?.title,
      episodeTitle: ep.title,
      title:        serieItem?.title || '',
      image:        serieItem?.image || '',
      positionSec:  0,
    });
  } catch (_) {}

  // Fetch sources for this episode
  const fakeItem = { id: ep.id, type: 'episode' };
  fetchSources(fakeItem, 'episode', 'play');
}

/* ─── SOURCE QUALITY SHEET ───────────────────────────────────────────────────── */
function openQualitySheet()  {
  $('qualitySheet').classList.add('open');
  $('qualitySheet').setAttribute('aria-hidden', 'false');
}
function closeQualitySheet() {
  $('qualitySheet').classList.remove('open');
  $('qualitySheet').setAttribute('aria-hidden', 'true');
}
$('qualityCancel').addEventListener('click',  closeQualitySheet);
$('qualityOverlay').addEventListener('click', closeQualitySheet);

async function fetchSources(item, type, mode) {
  const list = $('qualityList');
  list.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text2)">⏳ جاري تحميل المصادر...</p>';
  openQualitySheet();

  try {
    const data = type === 'episode'
      ? await API.episodeSrc(item.id)
      : await API.movieSrc(item.id);

    if (!data?.resolved || !data.sources?.length) {
      list.innerHTML = `
        <div style="text-align:center;padding:28px;color:var(--text2)">
          <div style="font-size:2.5rem;margin-bottom:10px">⚠️</div>
          <p style="font-weight:600;margin-bottom:6px">المصادر غير متاحة حاليًا</p>
          <p style="font-size:.8rem">${esc(data?.reason || 'SOURCE_FORMAT_NOT_DECODED')}</p>
        </div>`;
      return;
    }

    const filtered = mode === 'download'
      ? data.sources.filter(s => s.kind === 'download' || s.kind === 'both')
      : data.sources.filter(s => s.kind === 'play'     || s.kind === 'both');

    if (filtered.length === 0) {
      list.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text2)">لا توجد مصادر لهذا الخيار</p>';
      return;
    }

    list.innerHTML = '';
    const title = document.createElement('p');
    title.style.cssText = 'text-align:center;color:var(--text2);font-size:.8rem;padding:0 16px 8px';
    title.textContent = mode === 'download' ? 'اختر جودة التحميل' : 'اختر مصدر المشاهدة';
    list.appendChild(title);

    // All playable sources (for fallback cycling in player)
    const playSources = data.sources.filter(s => s.kind === 'play' || s.kind === 'both');

    filtered.forEach((src, idx) => {
      const el = document.createElement('div');
      el.className = 'quality-item';

      // Label: quality if available, else title, else type
      const labelText = src.quality
        ? src.quality
        : (src.title && src.title !== src.type ? src.title : (src.type || 'مصدر'));

      // Sub-label: show actual player mode so user knows what they're getting
      const pMode   = src.playerMode || src.type || '';
      const modeLabel = {
        'm3u8':  'HLS بث مباشر',
        'embed': 'مشغل مدمج',
        'webm':  'WebM فيديو',
        'mov':   'QuickTime',
        'mp4':   'MP4 فيديو',
      }[pMode] || pMode.toUpperCase();
      const subText = [modeLabel, src.size ? `${Math.round(src.size / 1048576)} MB` : '']
        .filter(Boolean).join(' · ');

      el.innerHTML = `
        <div>
          <div class="quality-label">${mode === 'download' ? '⬇️' : '▶️'} ${esc(labelText)}</div>
          ${subText ? `<div class="quality-sub">${esc(subText)}</div>` : ''}
        </div>
        <div style="color:var(--text3)">›</div>`;

      el.addEventListener('click', () => {
        closeQualitySheet();
        if (mode === 'download') {
          openExternal(src.url);
        } else {
          // Pass all play sources for fallback cycling in player
          const srcIdx = playSources.indexOf(src);
          goToPlayer(src, type, item.id, playSources, srcIdx >= 0 ? srcIdx : 0);
        }
      });

      list.appendChild(el);
    });

  } catch (err) {
    list.innerHTML = `<p style="text-align:center;padding:24px;color:var(--danger)">⚠️ ${esc(err.message)}</p>`;
  }
}

function openExternal(url) {
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

/**
 * goToPlayer — navigate to player.html with full source context
 *
 * Passes:
 *   - srcUrl, srcType: the raw API values
 *   - playerMode: the RESOLVED player mode (m3u8/webm/mov/embed) from resolver
 *     This is the critical fix: embed URLs with type='m3u8' get playerMode='embed'
 *   - srcKind, srcTitle: metadata
 *   - sources: JSON array of all playable sources for fallback
 *   - srcIdx: index of selected source in sources array
 */
function goToPlayer(src, contentType, contentId, allSources, srcIdx) {
  // Log what we're sending (no secrets)
  try {
    const host = new URL(src.url).hostname;
    console.log(`[APP] SOURCE SELECTED type=${src.type} playerMode=${src.playerMode} kind=${src.kind} host=${host}`);
  } catch (_) {}

  const params = new URLSearchParams({
    srcUrl:     src.url,
    srcType:    src.type       || '',
    playerMode: src.playerMode || src.type || '',  // ← KEY: use resolved player mode
    srcKind:    src.kind       || 'both',
    srcTitle:   src.title      || src.type || '',
    type:       contentType,
    id:         String(contentId),
    srcIdx:     String(srcIdx || 0),
    sources:    encodeURIComponent(JSON.stringify(allSources || [])),
  });
  window.location.href = `/player.html?${params.toString()}`;
}

/* ─── FAVORITES toggle ───────────────────────────────────────────────────────── */
async function toggleFav(item, btn) {
  const isActive = btn.dataset.active === 'true';
  const type = item.type === 'serie' ? 'serie' : 'movie';
  try {
    if (isActive) {
      await API.removeFav(item.id, type);
      btn.dataset.active = 'false';
      btn.className = 'action-btn action-fav';
      btn.textContent = '❤️ إضافة للمفضلة';
      toast('تمت الإزالة من المفضلة');
    } else {
      await API.addFav({ posterId: item.id, posterType: type, title: item.title, image: item.image || '' });
      btn.dataset.active = 'true';
      btn.className = 'action-btn action-fav active';
      btn.textContent = '💔 إزالة من المفضلة';
      toast('❤️ تمت الإضافة للمفضلة');
    }
  } catch (_) {
    toast('⚠️ تعذّر الحفظ');
  }
}

/* ─── Boot ───────────────────────────────────────────────────────────────────── */
showPage('pageHome');
