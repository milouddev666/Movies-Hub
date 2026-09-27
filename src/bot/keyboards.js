'use strict';

const config = require('../config');

const keyboards = {
  mainMenu(webAppUrl) {
    const url = webAppUrl || config.telegram.webAppUrl;
    return {
      inline_keyboard: [
        [
          { text: '🎬 الأفلام', callback_data: 'movies:0' },
          { text: '📺 المسلسلات', callback_data: 'series:0' },
        ],
        [
          { text: '🔎 البحث', callback_data: 'search_prompt' },
          { text: '🆕 الأحدث', callback_data: 'latest' },
        ],
        [
          { text: '🔥 الأكثر مشاهدة', callback_data: 'popular' },
          { text: '🎲 عشوائي', callback_data: 'random' },
        ],
        [
          { text: '❤️ المفضلة', callback_data: 'favorites' },
          { text: '🕘 السجل', callback_data: 'history' },
        ],
        url
          ? [{ text: '🌐 فتح التطبيق', web_app: { url } }]
          : [],
      ].filter(row => row.length > 0),
    };
  },

  movieDetail(movieId, webAppUrl) {
    const url = webAppUrl || config.telegram.webAppUrl;
    return {
      inline_keyboard: [
        [{ text: '▶️ مشاهدة', callback_data: `watch:movie:${movieId}` }],
        [{ text: '⬇️ تحميل', callback_data: `download:movie:${movieId}` }],
        [{ text: '❤️ إضافة للمفضلة', callback_data: `fav:add:movie:${movieId}` }],
        [
          { text: '🔗 مشاركة', callback_data: `share:movie:${movieId}` },
          { text: '🔙 رجوع', callback_data: 'movies:0' },
        ],
        url
          ? [{ text: '📱 فتح في التطبيق', web_app: { url: `${url}?type=movie&id=${movieId}` } }]
          : [],
      ].filter(row => row.length > 0),
    };
  },

  serieDetail(serieId) {
    return {
      inline_keyboard: [
        [{ text: '🎬 اختيار الموسم', callback_data: `seasons:${serieId}` }],
        [{ text: '❤️ إضافة للمفضلة', callback_data: `fav:add:serie:${serieId}` }],
        [{ text: '🔙 رجوع', callback_data: 'series:0' }],
      ],
    };
  },

  seasonsList(seasons, serieId) {
    const rows = seasons.map((s) => [
      { text: `📅 ${s.title}`, callback_data: `episodes:${serieId}:${s.id}` },
    ]);
    rows.push([{ text: '🔙 رجوع', callback_data: `serie:${serieId}` }]);
    return { inline_keyboard: rows };
  },

  episodesList(episodes, serieId, seasonId, page = 0) {
    const PAGE_SIZE = 8;
    const start = page * PAGE_SIZE;
    const slice = episodes.slice(start, start + PAGE_SIZE);

    const rows = slice.map((ep) => [
      { text: `▶ ${ep.title}`, callback_data: `episode:${ep.id}` },
    ]);

    const nav = [];
    if (page > 0) nav.push({ text: '◀️ السابق', callback_data: `episodes:${serieId}:${seasonId}:${page - 1}` });
    if (start + PAGE_SIZE < episodes.length) nav.push({ text: 'التالي ▶️', callback_data: `episodes:${serieId}:${seasonId}:${page + 1}` });
    if (nav.length) rows.push(nav);
    rows.push([{ text: '🔙 المواسم', callback_data: `seasons:${serieId}` }]);

    return { inline_keyboard: rows };
  },

  episodeDetail(episodeId, serieId, seasonId) {
    return {
      inline_keyboard: [
        [{ text: '▶️ مشاهدة', callback_data: `watch:episode:${episodeId}` }],
        [{ text: '⬇️ تحميل', callback_data: `download:episode:${episodeId}` }],
        [{ text: '🔙 الحلقات', callback_data: `episodes:${serieId}:${seasonId}` }],
      ],
    };
  },

  sourceQuality(sources, type, contentId) {
    if (!sources || sources.length === 0) {
      return {
        inline_keyboard: [
          [{ text: '⚠️ لا توجد مصادر متاحة', callback_data: 'noop' }],
          [{ text: '🔙 رجوع', callback_data: `${type}:${contentId}` }],
        ],
      };
    }

    const rows = sources.map((src) => {
      const label = src.quality
        ? `${src.quality} — ${src.type}`
        : src.title || src.type || 'مصدر';
      const kindIcon = src.kind === 'download' ? '⬇️' : '▶️';
      return [
        {
          text: `${kindIcon} ${label}`,
          callback_data: `play_src:${type}:${contentId}:${src.id}`,
        },
      ];
    });

    rows.push([{ text: '🔙 رجوع', callback_data: `${type}:${contentId}` }]);
    return { inline_keyboard: rows };
  },

  backToMain() {
    return {
      inline_keyboard: [[{ text: '🏠 الرئيسية', callback_data: 'main_menu' }]],
    };
  },

  moviesList(movies, page = 0) {
    const PAGE_SIZE = 5;
    const start = page * PAGE_SIZE;
    const slice = movies.slice(start, start + PAGE_SIZE);

    const rows = slice.map((m) => [
      {
        text: `🎬 ${m.title} (${m.year || ''}) ⭐${m.imdb || ''}`,
        callback_data: `movie:${m.id}`,
      },
    ]);

    const nav = [];
    if (page > 0) nav.push({ text: '◀️', callback_data: `movies:${page - 1}` });
    if (start + PAGE_SIZE < movies.length) nav.push({ text: '▶️', callback_data: `movies:${page + 1}` });
    if (nav.length) rows.push(nav);
    rows.push([{ text: '🔙 الرئيسية', callback_data: 'main_menu' }]);

    return { inline_keyboard: rows };
  },

  seriesList(series, page = 0) {
    const PAGE_SIZE = 5;
    const start = page * PAGE_SIZE;
    const slice = series.slice(start, start + PAGE_SIZE);

    const rows = slice.map((s) => [
      {
        text: `📺 ${s.title} (${s.year || ''}) ⭐${s.imdb || ''}`,
        callback_data: `serie:${s.id}`,
      },
    ]);

    const nav = [];
    if (page > 0) nav.push({ text: '◀️', callback_data: `series:${page - 1}` });
    if (start + PAGE_SIZE < series.length) nav.push({ text: '▶️', callback_data: `series:${page + 1}` });
    if (nav.length) rows.push(nav);
    rows.push([{ text: '🔙 الرئيسية', callback_data: 'main_menu' }]);

    return { inline_keyboard: rows };
  },

  searchResults(results, query) {
    if (!results || results.length === 0) {
      return {
        inline_keyboard: [
          [{ text: '🔎 بحث جديد', callback_data: 'search_prompt' }],
          [{ text: '🏠 الرئيسية', callback_data: 'main_menu' }],
        ],
      };
    }

    const rows = results.slice(0, 8).map((item) => {
      const icon = item.type === 'serie' ? '📺' : '🎬';
      return [
        {
          text: `${icon} ${item.title} (${item.year || ''})`,
          callback_data: item.type === 'serie' ? `serie:${item.id}` : `movie:${item.id}`,
        },
      ];
    });

    rows.push([
      { text: '🔎 بحث جديد', callback_data: 'search_prompt' },
      { text: '🏠 الرئيسية', callback_data: 'main_menu' },
    ]);

    return { inline_keyboard: rows };
  },
};

module.exports = keyboards;
