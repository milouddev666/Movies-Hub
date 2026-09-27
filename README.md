# 🎬 درامي — بوت أفلام ومسلسلات على Telegram

منصة Telegram متكاملة لمشاهدة وتحميل الأفلام والمسلسلات، مع Mini App حديث وبوت احترافي.

---

## 📋 المتطلبات

- Node.js 18+
- PostgreSQL (على Render أو محليًا)
- Telegram Bot Token (من @BotFather)
- خدمة Render للنشر

---

## 🚀 التشغيل المحلي

### 1. تثبيت المتطلبات

```bash
npm install
```

### 2. إعداد متغيرات البيئة

```bash
cp .env.example .env
```

ثم عدّل `.env` بالقيم الصحيحة:

```env
BOT_TOKEN=your_telegram_bot_token
WEBHOOK_URL=                         # اتركه فارغًا للتطوير المحلي
WEBAPP_URL=http://localhost:3000/app
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://user:pass@localhost:5432/aldrama3
API_BASE_URL=https://dwapp.arabypros.com
API_KEY_PATH=4F5A9C3D9A86FA54EACEDDD635185
CLIENT_UUID=d506abfd-9fe2-4b71-b979-feff21bcad13
APP_PACKAGE=com.alam.aldrama3
REDIRECT_BASE_URL=https://dwapp.qzz.io
VALIDATION_BASE_URL=https://test.arabypros.com
TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p
```

### 3. تشغيل التطبيق

```bash
npm start
```

سيبدأ البوت في وضع Polling تلقائيًا عند `NODE_ENV=development`.

---

## ☁️ النشر على Render

### 1. إنشاء قاعدة البيانات

في Render Dashboard:
1. **New** → **PostgreSQL**
2. اختر اسمًا مثل `aldrama3-db`
3. انسخ `Internal Database URL`

### 2. إنشاء Web Service

1. **New** → **Web Service**
2. اربط مستودع GitHub
3. اضبط الإعدادات:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`

### 3. إضافة متغيرات البيئة

في Environment Variables أضف:

| المتغير | القيمة |
|---------|--------|
| `BOT_TOKEN` | توكن البوت من @BotFather |
| `WEBHOOK_URL` | `https://YOUR-SERVICE.onrender.com` |
| `WEBAPP_URL` | `https://YOUR-SERVICE.onrender.com/app` |
| `BASE_URL` | `https://YOUR-SERVICE.onrender.com` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | الرابط من PostgreSQL على Render |
| `API_BASE_URL` | `https://dwapp.arabypros.com` |
| `API_KEY_PATH` | `4F5A9C3D9A86FA54EACEDDD635185` |
| `CLIENT_UUID` | `d506abfd-9fe2-4b71-b979-feff21bcad13` |
| `APP_PACKAGE` | `com.alam.aldrama3` |
| `REDIRECT_BASE_URL` | `https://dwapp.qzz.io` |
| `VALIDATION_BASE_URL` | `https://test.arabypros.com` |
| `TMDB_IMAGE_BASE_URL` | `https://image.tmdb.org/t/p` |

### 4. الـ Webhook

عند النشر على Render مع `NODE_ENV=production` و `WEBHOOK_URL`، يُضبط الـ webhook تلقائيًا.

للإعداد اليدوي:
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://YOUR-SERVICE.onrender.com/telegram/webhook
```

---

## 🤖 ربط البوت بالـ Mini App

1. افتح @BotFather
2. `/mybots` → اختر بوتك → **Bot Settings** → **Menu Button**
3. اضبط URL: `https://YOUR-SERVICE.onrender.com/app`

---

## 📱 أوامر البوت

| الأمر | الوظيفة |
|-------|---------|
| `/start` | القائمة الرئيسية |
| `/movies` | تصفح الأفلام |
| `/series` | تصفح المسلسلات |
| `/search` | البحث |
| `/latest` | الأحدث |
| `/random` | فيلم عشوائي |
| `/favorites` | المفضلة |
| `/history` | سجل المشاهدة |
| `/help` | المساعدة |

---

## 🔍 اختبار الوظائف

```bash
# Health check
curl https://YOUR-SERVICE.onrender.com/health

# API home
curl https://YOUR-SERVICE.onrender.com/api/home

# API search
curl "https://YOUR-SERVICE.onrender.com/api/search?q=action"

# API movies
curl https://YOUR-SERVICE.onrender.com/api/movies

# API series
curl https://YOUR-SERVICE.onrender.com/api/series
```

---

## ⚠️ ملاحظة حول مصادر التشغيل

بناءً على ملف `movies_api_complete_ai_spec.md`، استجابات source API تُعاد كبيانات Base64/binary مشفرة. النظام يحاول فك التشفير بعدة طرق، وإذا تعذّر ذلك يُظهر رسالة واضحة بدلًا من الانهيار.

إذا أصبحت خوارزمية فك التشفير معلومة، يمكن إضافتها في:
```javascript
// في src/api/sourceResolver.js
sourceResolver.setDecoder(async (buffer) => {
  // أضف خوارزمية فك التشفير هنا
  return decodedSources;
});
```

---

## 🗂️ هيكل المشروع

```
src/
├── index.js              ← نقطة الدخول الرئيسية
├── config.js             ← كل الإعدادات من .env
├── api/
│   ├── apiClient.js      ← كل اتصالات API الخارجي
│   └── sourceResolver.js ← معالج مصادر الفيديو
├── bot/
│   ├── index.js          ← بوت Telegram الكامل
│   ├── keyboards.js      ← Inline keyboards
│   └── messages.js       ← رسائل البوت
├── database/
│   ├── db.js             ← PostgreSQL pool
│   └── migrate.js        ← إنشاء الجداول
├── repositories/
│   ├── userRepository.js
│   ├── favoritesRepository.js
│   └── historyRepository.js
├── utils/
│   └── logger.js         ← Logger آمن (لا يكشف أسرار)
└── web/
    ├── routes.js          ← API endpoints الداخلية للـ Mini App
    └── public/
        ├── index.html     ← Mini App الرئيسية
        ├── player.html    ← مشغل الفيديو
        ├── css/app.css    ← تصميم كامل RTL Dark Mode
        └── js/app.js      ← منطق Mini App
```
