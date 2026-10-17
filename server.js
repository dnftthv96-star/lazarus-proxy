// Lazarus — Живой дашборд (старый). Все доступы хранятся только здесь, на сервере.
// Браузер получает от сервера только данные и только после ввода пароля.
// Репозиторий на GitHub должен быть Private.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(express.json());

// ---------- ДОСТУПЫ ----------
const BASE          = 'https://lazarus.4logist.com';
const CLIENT_ID     = process.env.LOGIST_CLIENT_ID     || '1bjgh8arbb1coccosockkkc4sskwoc4gos8koggos04kc0w484';
const CLIENT_SECRET = process.env.LOGIST_CLIENT_SECRET || '65uax2lgcko48cwkg4c00cg080g8ks8484wc4k04ssgoksk0sg';
const USERNAME      = process.env.LOGIST_USERNAME      || 'Artjom_H';
const PASSWORD      = process.env.LOGIST_PASSWORD      || 'LazarusAH2025';
const DASH_PASSWORD = process.env.DASHBOARD_PASSWORD   || '5858';   // пароль на сайт

// Google Таблицы (CSV). Видны только серверу.
const SHEET_CSV_URLS = {
  all:     'https://docs.google.com/spreadsheets/d/e/2PACX-1vRGaJ9psIimNc-Zc6_hPIcm2JHaAomf3sfHM2Z6NPqRKr-1N4yV8KY0-vVsNXFmsaZZxn0Cfw96uw2r/pub?gid=688805559&single=true&output=csv',
  nogrohe: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRGaJ9psIimNc-Zc6_hPIcm2JHaAomf3sfHM2Z6NPqRKr-1N4yV8KY0-vVsNXFmsaZZxn0Cfw96uw2r/pub?gid=1446776803&single=true&output=csv',
  grohe:   'https://docs.google.com/spreadsheets/d/e/2PACX-1vRGaJ9psIimNc-Zc6_hPIcm2JHaAomf3sfHM2Z6NPqRKr-1N4yV8KY0-vVsNXFmsaZZxn0Cfw96uw2r/pub?gid=2001779062&single=true&output=csv',
  plan:    'https://docs.google.com/spreadsheets/d/e/2PACX-1vRO65na9Yg8lkkUfMMm4pJKG4jhg-_CgMsFVOXoQVQ9X-OrZtPI2ml5vZkdvGfnE6xICyrsa1UgdSg7/pub?gid=1774379741&single=true&output=csv'
};

// ---------- ПАРОЛЬ НА САЙТ (проверка на сервере, вход запоминается на 30 дней) ----------
const AUTH_TOKEN = crypto.createHash('sha256').update('lazarus-live:' + DASH_PASSWORD).digest('hex');
function isAuthed(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)lz_live=([a-f0-9]+)/);
  return !!m && m[1] === AUTH_TOKEN;
}
app.post('/login', (req, res) => {
  if (String((req.body && req.body.password) || '') !== DASH_PASSWORD) return res.status(401).json({ error: 'Неверный пароль' });
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `lz_live=${AUTH_TOKEN}; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; SameSite=Lax${secure}`);
  res.json({ ok: true });
});
app.get('/auth-check', (req, res) => res.json({ ok: isAuthed(req) }));
const needAuth = (req, res, next) => isAuthed(req) ? next() : res.status(401).json({ error: 'auth' });

// ---------- 4LOGIST: токен получает сервер сам ----------
let token = null;
async function getToken() {
  const r = await fetch(`${BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=password&client_id=${encodeURIComponent(CLIENT_ID)}&client_secret=${encodeURIComponent(CLIENT_SECRET)}&username=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('4logist: не удалось авторизоваться');
  token = d.access_token;
  return token;
}
// Разрешены только запросы чтения списков: api/orders/list, api/users/list, api/clients/list
app.post('/proxy/api/:entity/list', needAuth, async (req, res) => {
  if (!['orders', 'users', 'clients'].includes(req.params.entity)) return res.status(403).json({ error: 'forbidden' });
  const url = `${BASE}/api/${req.params.entity}/list`;
  try {
    const call = async () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || await getToken()) }, body: JSON.stringify(req.body || {}) });
    let r = await call();
    if (r.status === 401) { token = null; r = await call(); }
    res.status(r.status).type('application/json').send(await r.text());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Google Таблицы ----------
app.get('/proxy-sheet/:sheet', needAuth, async (req, res) => {
  const url = SHEET_CSV_URLS[req.params.sheet];
  if (!url) return res.status(404).json({ error: 'Нет такой таблицы' });
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Sheet fetch failed: ' + r.status);
    res.type('text/csv; charset=utf-8').send(await r.text());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Отдаём только страницу. Остальные файлы (server.js и т.д.) наружу не отдаются.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
