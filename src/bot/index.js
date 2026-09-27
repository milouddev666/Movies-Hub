'use strict';

const TelegramBot = require('node-telegram-bot-api');
const config      = require('../config');
const logger      = require('../utils/logger');
const apiClient   = require('../api/apiClient');
const sourceResolver = require('../api/sourceResolver');
const keyboards   = require('./keyboards');
const messages    = require('./messages');
const store       = require('../storage/jsonStore');

let bot = null;
const awaitingSearch = new Map();

function createBot(useWebhook = false) {
  if (bot) return bot;
  bot = new TelegramBot(config.telegram.botToken, useWebhook ? { webHook: false } : { polling: true });
  logger.info('BOT', `Created (${useWebhook ? 'webhook' : 'polling'} mode)`);
  registerHandlers(bot);
  return bot;
}

function getBot() { return bot; }

// ── Helpers ───────────────────────────────────────────────────────────────────
async function answerCb(query, text = '') {
  try { await bot.answerCallbackQuery(query.id, { text }); } catch (_) {}
}

function norm(data) {
  if (Array.isArray(data))           return data;
  if (Array.isArray(data?.data))     return data.data;
  if (Array.isArray(data?.seasons))  return data.seasons;
  if (Array.isArray(data?.results))  return data.results;
  return [];
}

function ensureUser(from) {
  if (!from) return;
  try { store.upsertUser({ telegramId: from.id, username: from.username, firstName: from.first_name, lastName: from.last_name }); }
  catch (_) {}
}

// ── Show movie detail ──────────────────────────────────────────────────────────
async function showMovie(chatId, movieId) {
  try {
    const data = await apiClient.getMovies({ filter: 0, sort: 'created', flag: 0 });
    let movie  = norm(data).find(m => String(m.id) === String(movieId));
    if (!movie) {
      // try posters endpoint
      const pd = await apiClient.getPosters({ filter: 0, sort: 'views', direction: 0 });
      movie = norm(pd).find(m => String(m.id) === String(movieId));
    }
    if (!movie) { await bot.sendMessage(chatId, messages.apiError('الفيلم غير موجود')); return; }
    const text = messages.movieDetail(movie);
    const kb   = keyboards.movieDetail(movie.id);
    if (movie.image) {
      await bot.sendPhoto(chatId, movie.image, { caption: text, parse_mode: 'MarkdownV2', reply_markup: kb });
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', reply_markup: kb });
    }
  } catch (e) {
    logger.error('BOT', `showMovie: ${e.message}`);
    await bot.sendMessage(chatId, messages.apiError());
  }
}

// ── Show serie detail ──────────────────────────────────────────────────────────
async function showSerie(chatId, serieId) {
  try {
    const data = await apiClient.getSeries({ filter: 0, sort: 'created', flag: 0 });
    const serie = norm(data).find(s => String(s.id) === String(serieId));
    if (!serie) { await bot.sendMessage(chatId, messages.apiError('المسلسل غير موجود')); return; }
    const text = messages.serieDetail(serie);
    const kb   = keyboards.serieDetail(serie.id);
    if (serie.image) {
      await bot.sendPhoto(chatId, serie.image, { caption: text, parse_mode: 'MarkdownV2', reply_markup: kb });
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', reply_markup: kb });
    }
  } catch (e) {
    logger.error('BOT', `showSerie: ${e.message}`);
    await bot.sendMessage(chatId, messages.apiError());
  }
}

// ── Get and display sources ────────────────────────────────────────────────────
async function showSources(chatId, type, id, mode) {
  try {
    const raw    = type === 'episode'
      ? await apiClient.getEpisodeSources(id)
      : await apiClient.getMovieSources(id);
    const result = sourceResolver.decodeSourceBody(raw);

    if (!result.resolved || !result.sources?.length) {
      await bot.sendMessage(chatId, messages.sourceNotAvailable(), { reply_markup: keyboards.backToMain() });
      return;
    }

    const sorted = sourceResolver.sortSources(result.sources);
    const list   = mode === 'download'
      ? sorted.filter(s => s.kind === 'download' || s.kind === 'both')
      : sorted.filter(s => s.kind === 'play' || s.kind === 'both');

    if (!list.length) {
      await bot.sendMessage(chatId, '⚠️ لا توجد مصادر لهذا الخيار\\.', { parse_mode: 'MarkdownV2', reply_markup: keyboards.backToMain() });
      return;
    }

    const webAppUrl = config.telegram.webAppUrl;
    if (mode === 'play' && webAppUrl) {
      const best   = list.find(s => s.sourceClass !== 'embed') || list[0];
      const p      = new URLSearchParams({ srcUrl: best.url, srcType: best.sourceClass, type, id: String(id) });
      const pUrl   = `${webAppUrl}/player.html?${p.toString()}`;
      const label  = best.quality || best.title || best.type || 'auto';
      const rows   = [[{ text: '▶️ شاهد الآن', web_app: { url: pUrl } }]];
      if (list.length > 1) rows.push([{ text: '⚙️ اختيار الجودة', callback_data: `quality:${type}:${id}` }]);
      await bot.sendMessage(chatId,
        `▶️ *جاهز للمشاهدة*\n\nالجودة: ${label}\nالمصادر: ${result.sources.length}`,
        { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: rows } }
      );
    } else {
      await bot.sendMessage(chatId, mode === 'download' ? '⬇️ *اختر الجودة*' : '🎬 *اختر المصدر*', {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboards.sourceQuality(list, type, id),
      });
    }
  } catch (e) {
    logger.error('BOT', `showSources: ${e.message}`);
    await bot.sendMessage(chatId, messages.apiError());
  }
}

// ── Register all handlers ─────────────────────────────────────────────────────
function registerHandlers(bot) {

  // /start
  bot.onText(/\/start/, async msg => {
    ensureUser(msg.from);
    await bot.sendMessage(msg.chat.id, messages.welcome(msg.from?.first_name), {
      parse_mode: 'MarkdownV2', reply_markup: keyboards.mainMenu(),
    });
  });

  // /movies
  bot.onText(/\/movies/, async msg => {
    ensureUser(msg.from);
    try {
      const list = norm(await apiClient.getMovies({ filter: 0, sort: 'created', flag: 0 }));
      await bot.sendMessage(msg.chat.id, `🎬 *الأفلام*`, { parse_mode: 'MarkdownV2', reply_markup: keyboards.moviesList(list, 0) });
    } catch (e) { await bot.sendMessage(msg.chat.id, messages.apiError()); }
  });

  // /series
  bot.onText(/\/series/, async msg => {
    ensureUser(msg.from);
    try {
      const list = norm(await apiClient.getSeries({ filter: 0, sort: 'created', flag: 0 }));
      await bot.sendMessage(msg.chat.id, `📺 *المسلسلات*`, { parse_mode: 'MarkdownV2', reply_markup: keyboards.seriesList(list, 0) });
    } catch (e) { await bot.sendMessage(msg.chat.id, messages.apiError()); }
  });

  // /search
  bot.onText(/\/search/, async msg => {
    ensureUser(msg.from);
    awaitingSearch.set(msg.from.id, true);
    await bot.sendMessage(msg.chat.id, messages.searchPrompt(), { parse_mode: 'MarkdownV2' });
  });

  // /latest
  bot.onText(/\/latest/, async msg => {
    ensureUser(msg.from);
    try {
      const list = norm(await apiClient.getMovies({ filter: 0, sort: 'created', flag: 0 }));
      await bot.sendMessage(msg.chat.id, `🆕 *الأحدث*`, { parse_mode: 'MarkdownV2', reply_markup: keyboards.moviesList(list.slice(0, 20), 0) });
    } catch (e) { await bot.sendMessage(msg.chat.id, messages.apiError()); }
  });

  // /random
  bot.onText(/\/random/, async msg => {
    ensureUser(msg.from);
    try {
      const list = norm(await apiClient.getRandomMovies(20));
      if (!list.length) return;
      const m = list[Math.floor(Math.random() * list.length)];
      await showMovie(msg.chat.id, m.id);
    } catch (e) { await bot.sendMessage(msg.chat.id, messages.apiError()); }
  });

  // /favorites
  bot.onText(/\/favorites/, async msg => {
    ensureUser(msg.from);
    const favs = store.getFavorites(msg.from.id);
    if (!favs.length) { await bot.sendMessage(msg.chat.id, messages.noFavorites(), { parse_mode: 'MarkdownV2' }); return; }
    const rows = favs.map(f => [{ text: `${f.posterType === 'serie' ? '📺' : '🎬'} ${f.title}`, callback_data: `${f.posterType}:${f.posterId}` }]);
    rows.push([{ text: '🏠 الرئيسية', callback_data: 'main_menu' }]);
    await bot.sendMessage(msg.chat.id, '❤️ *المفضلة*', { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: rows } });
  });

  // /history
  bot.onText(/\/history/, async msg => {
    ensureUser(msg.from);
    const history = store.getWatchHistory(msg.from.id, 10);
    if (!history.length) { await bot.sendMessage(msg.chat.id, messages.noHistory(), { parse_mode: 'MarkdownV2' }); return; }
    const rows = history.map(h => [{ text: `${h.posterType === 'serie' ? '📺' : '🎬'} ${h.title}${h.episodeTitle ? ` — ${h.episodeTitle}` : ''}`, callback_data: `${h.posterType}:${h.posterId}` }]);
    rows.push([{ text: '🏠 الرئيسية', callback_data: 'main_menu' }]);
    await bot.sendMessage(msg.chat.id, '🕘 *سجل المشاهدة*', { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: rows } });
  });

  // /help
  bot.onText(/\/help/, async msg => {
    const t = '/start \\- الرئيسية\n/movies \\- الأفلام\n/series \\- المسلسلات\n/search \\- البحث\n/latest \\- الأحدث\n/random \\- عشوائي\n/favorites \\- المفضلة\n/history \\- السجل';
    await bot.sendMessage(msg.chat.id, `📋 *الأوامر*\n\n${t}`, { parse_mode: 'MarkdownV2' });
  });

  // Plain text → search
  bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    ensureUser(msg.from);
    const userId = msg.from?.id;
    const chatId = msg.chat.id;
    const q      = msg.text.trim();
    if (awaitingSearch.get(userId)) {
      awaitingSearch.delete(userId);
      if (!q) return;
      try {
        const results = norm(await apiClient.search(q, 0));
        await bot.sendMessage(chatId, messages.searchResults(q, results.length), { parse_mode: 'MarkdownV2', reply_markup: keyboards.searchResults(results) });
      } catch (_) { await bot.sendMessage(chatId, messages.apiError()); }
      return;
    }
    if (q.length >= 2) {
      try {
        const results = norm(await apiClient.search(q, 0));
        if (results.length) {
          await bot.sendMessage(chatId, messages.searchResults(q, results.length), { parse_mode: 'MarkdownV2', reply_markup: keyboards.searchResults(results) });
        }
      } catch (_) {}
    }
  });

  // Callback queries
  bot.on('callback_query', async query => {
    const data   = query.data || '';
    const chatId = query.message?.chat?.id;
    const userId = query.from?.id;
    if (!chatId) return;
    ensureUser(query.from);
    await answerCb(query);

    if (data === 'main_menu') {
      await bot.sendMessage(chatId, messages.welcome(query.from?.first_name), { parse_mode: 'MarkdownV2', reply_markup: keyboards.mainMenu() });
      return;
    }
    if (data === 'search_prompt') {
      awaitingSearch.set(userId, true);
      await bot.sendMessage(chatId, messages.searchPrompt(), { parse_mode: 'MarkdownV2' });
      return;
    }
    if (data === 'latest') {
      try {
        const list = norm(await apiClient.getMovies({ filter: 0, sort: 'created', flag: 0 }));
        await bot.sendMessage(chatId, '🆕 *الأحدث*', { parse_mode: 'MarkdownV2', reply_markup: keyboards.moviesList(list.slice(0, 20), 0) });
      } catch (_) { await bot.sendMessage(chatId, messages.apiError()); }
      return;
    }
    if (data === 'popular') {
      try {
        const list = norm(await apiClient.getPosters({ filter: 0, sort: 'views', direction: 0 }));
        await bot.sendMessage(chatId, '🔥 *الأكثر مشاهدة*', { parse_mode: 'MarkdownV2', reply_markup: keyboards.moviesList(list, 0) });
      } catch (_) { await bot.sendMessage(chatId, messages.apiError()); }
      return;
    }
    if (data === 'random') {
      try {
        const list = norm(await apiClient.getRandomMovies(20));
        if (list.length) await showMovie(chatId, list[Math.floor(Math.random() * list.length)].id);
      } catch (_) { await bot.sendMessage(chatId, messages.apiError()); }
      return;
    }
    if (data === 'favorites') {
      const favs = store.getFavorites(userId);
      if (!favs.length) { await bot.sendMessage(chatId, messages.noFavorites(), { parse_mode: 'MarkdownV2' }); return; }
      const rows = favs.map(f => [{ text: `${f.posterType === 'serie' ? '📺' : '🎬'} ${f.title}`, callback_data: `${f.posterType}:${f.posterId}` }]);
      rows.push([{ text: '🏠 الرئيسية', callback_data: 'main_menu' }]);
      await bot.sendMessage(chatId, '❤️ *المفضلة*', { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: rows } });
      return;
    }
    if (data === 'history') {
      const hist = store.getWatchHistory(userId, 10);
      if (!hist.length) { await bot.sendMessage(chatId, messages.noHistory(), { parse_mode: 'MarkdownV2' }); return; }
      const rows = hist.map(h => [{ text: `${h.posterType === 'serie' ? '📺' : '🎬'} ${h.title}${h.episodeTitle ? ` — ${h.episodeTitle}` : ''}`, callback_data: `${h.posterType}:${h.posterId}` }]);
      rows.push([{ text: '🏠 الرئيسية', callback_data: 'main_menu' }]);
      await bot.sendMessage(chatId, '🕘 *سجل المشاهدة*', { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: rows } });
      return;
    }

    // movies:{page}
    if (data.startsWith('movies:')) {
      const page = parseInt(data.split(':')[1] || '0', 10);
      try {
        const list = norm(await apiClient.getMovies({ filter: 0, sort: 'created', flag: 0 }));
        await bot.sendMessage(chatId, '🎬 *الأفلام*', { parse_mode: 'MarkdownV2', reply_markup: keyboards.moviesList(list, page) });
      } catch (_) { await bot.sendMessage(chatId, messages.apiError()); }
      return;
    }
    // series:{page}
    if (data.startsWith('series:')) {
      const page = parseInt(data.split(':')[1] || '0', 10);
      try {
        const list = norm(await apiClient.getSeries({ filter: 0, sort: 'created', flag: 0 }));
        await bot.sendMessage(chatId, '📺 *المسلسلات*', { parse_mode: 'MarkdownV2', reply_markup: keyboards.seriesList(list, page) });
      } catch (_) { await bot.sendMessage(chatId, messages.apiError()); }
      return;
    }
    // movie:{id}
    if (/^movie:\d+$/.test(data)) { await showMovie(chatId, data.split(':')[1]); return; }
    // serie:{id}
    if (/^serie:\d+$/.test(data)) { await showSerie(chatId, data.split(':')[1]); return; }

    // seasons:{serieId}
    if (data.startsWith('seasons:')) {
      const serieId = data.split(':')[1];
      try {
        const seasons = norm(await apiClient.getSeasons(serieId));
        if (!seasons.length) { await bot.sendMessage(chatId, '📅 لا توجد مواسم\\.', { parse_mode: 'MarkdownV2' }); return; }
        await bot.sendMessage(chatId, '📅 *اختر الموسم*', { parse_mode: 'MarkdownV2', reply_markup: keyboards.seasonsList(seasons, serieId) });
      } catch (_) { await bot.sendMessage(chatId, messages.apiError()); }
      return;
    }
    // episodes:{serieId}:{seasonId}[:{page}]
    if (data.startsWith('episodes:')) {
      const [, serieId, seasonId, pg = '0'] = data.split(':');
      const page = parseInt(pg, 10);
      try {
        const seasons = norm(await apiClient.getSeasons(serieId));
        const season  = seasons.find(s => String(s.id) === String(seasonId));
        if (!season) { await bot.sendMessage(chatId, messages.apiError('الموسم غير موجود')); return; }
        const eps = season.episodes || [];
        await bot.sendMessage(chatId, `📺 *${season.title}* — ${eps.length} حلقة`, {
          parse_mode: 'MarkdownV2',
          reply_markup: keyboards.episodesList(eps, serieId, seasonId, page),
        });
      } catch (_) { await bot.sendMessage(chatId, messages.apiError()); }
      return;
    }
    // episode:{episodeId}
    if (/^episode:\d+$/.test(data)) {
      const epId = data.split(':')[1];
      await bot.sendMessage(chatId, `▶️ *الحلقة*`, { parse_mode: 'MarkdownV2', reply_markup: keyboards.episodeDetail(epId, 0, 0) });
      return;
    }
    // watch:{type}:{id}
    if (data.startsWith('watch:')) {
      const [, type, id] = data.split(':');
      await bot.sendMessage(chatId, '⏳ جاري تحميل المصادر\\.\\.\\.', { parse_mode: 'MarkdownV2' });
      if (type === 'episode') { try { await apiClient.addEpisodeView(id); } catch (_) {} }
      await showSources(chatId, type, id, 'play');
      return;
    }
    // download:{type}:{id}
    if (data.startsWith('download:')) {
      const [, type, id] = data.split(':');
      await bot.sendMessage(chatId, '⏳ جاري البحث عن رابط تحميل\\.\\.\\.', { parse_mode: 'MarkdownV2' });
      await showSources(chatId, type, id, 'download');
      return;
    }
    // quality:{type}:{id}
    if (data.startsWith('quality:')) {
      const [, type, id] = data.split(':');
      await showSources(chatId, type, id, 'play');
      return;
    }
    // fav:add:{type}:{id}
    if (data.startsWith('fav:add:')) {
      const [, , type, id] = data.split(':');
      try {
        let title = `محتوى #${id}`, image = null;
        try {
          const list = norm(type === 'serie' ? await apiClient.getSeries() : await apiClient.getMovies());
          const found = list.find(x => String(x.id) === String(id));
          if (found) { title = found.title; image = found.image; }
        } catch (_) {}
        store.addFavorite({ telegramId: userId, posterId: parseInt(id, 10), posterType: type, title, image });
        await answerCb(query, '❤️ تمت الإضافة للمفضلة');
      } catch (_) { await answerCb(query, '⚠️ فشل الحفظ'); }
      return;
    }
    if (data === 'noop') return;
  });

  bot.on('polling_error', err => logger.error('BOT', `Polling: ${err.message}`));
  bot.on('webhook_error', err => logger.error('BOT', `Webhook: ${err.message}`));
}

module.exports = { createBot, getBot };
