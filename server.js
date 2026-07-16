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
    const cid = html.match(/const CLIENT_ID\s*=\s*'([^']+)'/)[1];
    const cs  = html.match(/const CLIENT_SECRET\s*=\s*'([^']+)'/)[1];
    const un  = html.match(/const USERNAME\s*=\s*'([^']+)'/)[1];
    const pw  = html.match(/const PASSWORD\s*=\s*'([^']+)'/)[1];

    const tokenRes = await fetch(`${BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=password&client_id=${cid}&client_secret=${cs}&username=${encodeURIComponent(un)}&password=${encodeURIComponent(pw)}`
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.send('<pre>Auth failed</pre>');
    const token = tokenData.access_token;

    async function tryFilter(label, contentType, body) {
      try {
        const r = await fetch(`${BASE}/api/orders/list`, {
          method: 'POST',
          headers: { 'Content-Type': contentType, 'Authorization': 'Bearer ' + token },
          body: body
        });
        const d = await r.json();
        const orders = d.data || d || [];
        const count = Array.isArray(orders) ? orders.length : '?';
        const total = d.dataInfo ? d.dataInfo.amountItems : '?';
        return `${label}: ${count} on page, ${total} total`;
      } catch(e) {
        return `${label}: ERROR - ${e.message}`;
      }
    }

    const results = [];
    
    // Try form-urlencoded with Symfony format
    results.push(await tryFilter(
      '1. form-urlencoded + YYYY-MM-DD',
      'application/x-www-form-urlencoded',
      'form_order_api_filter[dateFrom]=2026-07-01&form_order_api_filter[dateTo]=2026-07-16&perPage=5'
    ));

    results.push(await tryFilter(
      '2. form-urlencoded + DD.MM.YYYY',
      'application/x-www-form-urlencoded',
      'form_order_api_filter[dateFrom]=01.07.2026&form_order_api_filter[dateTo]=16.07.2026&perPage=5'
    ));

    results.push(await tryFilter(
      '3. JSON nested object',
      'application/json',
      JSON.stringify({form_order_api_filter:{dateFrom:'2026-07-01',dateTo:'2026-07-16'},perPage:5})
    ));

    results.push(await tryFilter(
      '4. JSON nested DD.MM.YYYY',
      'application/json',
      JSON.stringify({form_order_api_filter:{dateFrom:'01.07.2026',dateTo:'16.07.2026'},perPage:5})
    ));

    results.push(await tryFilter(
      '5. JSON flat brackets YYYY-MM-DD',
      'application/json',
      JSON.stringify({'form_order_api_filter[dateFrom]':'2026-07-01','form_order_api_filter[dateTo]':'2026-07-16',perPage:5})
    ));

    results.push(await tryFilter(
      '6. JSON flat brackets DD.MM.YYYY',
      'application/json',
      JSON.stringify({'form_order_api_filter[dateFrom]':'01.07.2026','form_order_api_filter[dateTo]':'16.07.2026',perPage:5})
    ));

    results.push(await tryFilter(
      '7. form-urlencoded loadingDate',
      'application/x-www-form-urlencoded',
      'form_order_api_filter[loadingDate]=2026-07-01&form_order_api_filter[unloadingDate]=2026-07-16&perPage=5'
    ));

    results.push(await tryFilter(
      '8. No filter baseline',
      'application/json',
      JSON.stringify({perPage:5})
    ));

    // Also check user 31
    results.push('');
    results.push('=== USER 31 CHECK ===');
    try {
      const u31 = await fetch(`${BASE}/api/users/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({perPage:500,page:0})
      });
      const u31data = await u31.json();
      const users = u31data.data || u31data || [];
      const total_users = u31data.dataInfo ? u31data.dataInfo.amountItems : '?';
      results.push('Total users: ' + total_users + ', loaded: ' + (Array.isArray(users)?users.length:'?'));
      if (Array.isArray(users)) {
        const user31 = users.find(u => u.id === 31);
        results.push('User 31: ' + (user31 ? JSON.stringify(user31).substring(0,300) : 'NOT FOUND in loaded page'));
        results.push('All user IDs: ' + users.map(u=>u.id+':'+u.name).join(', '));
      }
    } catch(e) {
      results.push('User check error: ' + e.message);
    }

    res.send('<pre style="font-size:13px;background:#111;color:#0f0;padding:20px;white-space:pre-wrap;line-height:2;">' + results.join('\n') + '</pre>');

  } catch (e) {
    res.send('<pre>Error: ' + e.message + '</pre>');
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
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(text);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
