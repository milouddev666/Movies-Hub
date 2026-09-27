'use strict';

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function movieDetail(movie) {
  const stars = movie.imdb ? `⭐ ${movie.imdb}/10` : '';
  const year = movie.year ? `📅 ${movie.year}` : '';
  const duration = movie.duration ? `⏱ ${movie.duration}` : '';
  const genre = movie.classification || '';
  const desc = movie.description
    ? movie.description.substring(0, 300) + (movie.description.length > 300 ? '...' : '')
    : '';

  return [
    `🎬 *${escapeMarkdown(movie.title)}*`,
    '',
    [year, stars, duration].filter(Boolean).join('  •  '),
    genre ? `🏷 ${escapeMarkdown(genre)}` : '',
    '',
    desc ? escapeMarkdown(desc) : '',
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .trim();
}

function serieDetail(serie) {
  const stars = serie.imdb ? `⭐ ${serie.imdb}/10` : '';
  const year = serie.year ? `📅 ${serie.year}` : '';
  const genre = serie.classification || '';
  const desc = serie.description
    ? serie.description.substring(0, 300) + (serie.description.length > 300 ? '...' : '')
    : '';

  return [
    `📺 *${escapeMarkdown(serie.title)}*`,
    '',
    [year, stars].filter(Boolean).join('  •  '),
    genre ? `🏷 ${escapeMarkdown(genre)}` : '',
    '',
    desc ? escapeMarkdown(desc) : '',
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .trim();
}

function episodeDetail(episode) {
  const duration = episode.duration ? `⏱ ${episode.duration}` : '';
  const desc = episode.description
    ? episode.description.substring(0, 200)
    : '';

  return [
    `▶️ *${escapeMarkdown(episode.title)}*`,
    duration,
    desc ? escapeMarkdown(desc) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function welcome(firstName) {
  const name = firstName ? ` ${firstName}` : '';
  return (
    `👋 *مرحبًا بك${escapeMarkdown(name)}\\!*\n\n` +
    `🎬 منصة الأفلام والمسلسلات\n\n` +
    `اختر ما تريد من القائمة أدناه:`
  );
}

function searchPrompt() {
  return '🔎 *البحث*\n\nأرسل اسم الفيلم أو المسلسل الذي تبحث عنه:';
}

function searchResults(query, count) {
  if (count === 0) {
    return `🔎 لا توجد نتائج لـ *${escapeMarkdown(query)}*\n\nجرّب كلمات مختلفة\\.`;
  }
  return `🔎 نتائج البحث عن *${escapeMarkdown(query)}*\n\nوُجد ${count} نتيجة:`;
}

function sourceNotAvailable() {
  return (
    '⚠️ *تعذّر تحميل مصادر التشغيل*\n\n' +
    'المصادر مشفرة ولا يتوفر حاليًا مفتاح فك التشفير\\.\n\n' +
    'جرّب لاحقًا أو افتح التطبيق للمشاهدة\\.'
  );
}

function apiError(detail) {
  return `⚠️ *حدث خطأ*\n\n${escapeMarkdown(detail || 'تعذّر الاتصال بالخادم')}\n\nحاول مجددًا لاحقًا\\.`;
}

function noFavorites() {
  return '❤️ *المفضلة*\n\nلم تضف أي محتوى للمفضلة بعد\\.';
}

function noHistory() {
  return '🕘 *سجل المشاهدة*\n\nلم تشاهد أي محتوى بعد\\.';
}

module.exports = {
  movieDetail,
  serieDetail,
  episodeDetail,
  welcome,
  searchPrompt,
  searchResults,
  sourceNotAvailable,
  apiError,
  noFavorites,
  noHistory,
};
