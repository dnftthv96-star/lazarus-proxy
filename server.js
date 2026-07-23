const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BASE = 'https://lazarus.4logist.com';

app.get('/debug', async (req, res) => {
  try {
    const fs = require('fs');
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const cid = html.match(/(?:const|var)\s+CLIENT_ID\s*=\s*'([^']+)'/)[1];
    const cs  = html.match(/(?:const|var)\s+CLIENT_SECRET\s*=\s*'([^']+)'/)[1];
    const un  = html.match(/(?:const|var)\s+USERNAME\s*=\s*'([^']+)'/)[1];
    const pw  = html.match(/(?:const|var)\s+PASSWORD\s*=\s*'([^']+)'/)[1];

    const tokenRes = await fetch(`${BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=password&client_id=${cid}&client_secret=${cs}&username=${encodeURIComponent(un)}&password=${encodeURIComponent(pw)}`
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.send('<pre>Auth failed: ' + JSON.stringify(tokenData) + '</pre>');
    const token = tokenData.access_token;

    const output = [];

    // Грузим все заказы страницами (без фильтра по дате)
    output.push('=== ЗАГРУЖАЕМ ВСЕ ЗАКАЗЫ ===');
    let allOrders = [], page = 0, total = 9999;
    while (allOrders.length < total && page < 20) {
      const r = await fetch(`${BASE}/api/orders/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ perPage: 500, page })
      });
      const d = await r.json();
      const batch = d.data || [];
      if (d.dataInfo && d.dataInfo.amountItems) total = d.dataInfo.amountItems;
      if (!batch.length) break;
      allOrders = allOrders.concat(batch);
      page++;
    }
    output.push('Всего загружено: ' + allOrders.length + ' заказов');
    output.push('');

    // Собираем все уникальные значения поля status с точным JSON
    output.push('=== ВСЕ УНИКАЛЬНЫЕ СТАТУСЫ (точный JSON из API) ===');
    const statusMap = {};
    for (const o of allOrders) {
      const raw = JSON.stringify(o.status);
      statusMap[raw] = (statusMap[raw] || 0) + 1;
    }
    const sorted = Object.entries(statusMap).sort((a, b) => b[1] - a[1]);
    for (const [raw, cnt] of sorted) {
      output.push('  ' + cnt + 'x  →  ' + raw);
    }

    // Отдельно показываем примеры заказов где статус содержит "last" или "work"
    output.push('');
    output.push('=== ПРИМЕРЫ ЗАКАЗОВ СО СТАТУСОМ СОДЕРЖАЩИМ "last" ===');
    const lastOrders = allOrders.filter(o => JSON.stringify(o.status).toLowerCase().includes('last'));
    output.push('Найдено: ' + lastOrders.length);
    for (const o of lastOrders.slice(0, 3)) {
      output.push('  order_code_referral=' + o.order_code_referral +
                  '  status=' + JSON.stringify(o.status) +
                  '  status_id=' + o.status_id);
    }

    res.send('<pre style="font-size:13px;background:#111;color:#0f0;padding:20px;white-space:pre-wrap;line-height:1.8;">' + output.join('\n') + '</pre>');
  } catch (e) {
    res.send('<pre>Error: ' + e.message + '\n' + e.stack + '</pre>');
  }
});

app.all('/proxy/*', async (req, res) => {
  const apiPath = req.params[0];
  const url = `${BASE}/${apiPath}`;
  try {
    const headers = { 'Content-Type': req.headers['content-type'] || 'application/json' };
    if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
    const options = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      options.body = req.headers['content-type']?.includes('urlencoded')
        ? new URLSearchParams(req.body).toString()
        : JSON.stringify(req.body);
    }
    const r = await fetch(url, options);
    const text = await r.text();
    res.status(r.status);
    r.headers.forEach((v, k) => {
      if (!['content-encoding','transfer-encoding','connection'].includes(k)) res.setHeader(k, v);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(text);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
