const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BASE = 'https://lazarus.4logist.com';

// Debug - try different date filter formats
app.get('/debug', async (req, res) => {
  try {
    const fs = require('fs');
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const cid = html.match(/const CLIENT_ID\s*=\s*'([^']+)'/)[1];
    const cs  = html.match(/const CLIENT_SECRET\s*=\s*'([^']+)'/)[1];
    const un  = html.match(/const USERNAME\s*=\s*'([^']+)'/)[1];
    const pw  = html.match(/const PASSWORD\s*=\s*'([^']+)'/)[1];

    // Get token
    const tokenRes = await fetch(`${BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=password&client_id=${cid}&client_secret=${cs}&username=${encodeURIComponent(un)}&password=${encodeURIComponent(pw)}`
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.send('<pre>Auth failed: ' + JSON.stringify(tokenData) + '</pre>');
    const token = tokenData.access_token;

    async function tryFilter(label, body) {
      try {
        const r = await fetch(`${BASE}/api/orders/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify(body)
        });
        const d = await r.json();
        const orders = d.data || d || [];
        const count = Array.isArray(orders) ? orders.length : '?';
        const firstDate = Array.isArray(orders) && orders[0] ? (orders[0].freight_date || orders[0].created || 'no date') : 'empty';
        const lastDate = Array.isArray(orders) && orders[orders.length-1] ? (orders[orders.length-1].freight_date || orders[orders.length-1].created || 'no date') : 'empty';
        return `${label}: ${count} orders | first: ${firstDate} | last: ${lastDate}`;
      } catch(e) {
        return `${label}: ERROR - ${e.message}`;
      }
    }

    const results = [];
    
    // Try different filter parameter names
    results.push(await tryFilter('1. No filter (limit 500)', {limit:500}));
    results.push(await tryFilter('2. dateFrom/dateTo', {dateFrom:'01.06.2026',dateTo:'15.07.2026',limit:500}));
    results.push(await tryFilter('3. date_from/date_to', {date_from:'01.06.2026',date_to:'15.07.2026',limit:500}));
    results.push(await tryFilter('4. freightDateFrom/To', {freightDateFrom:'01.06.2026',freightDateTo:'15.07.2026',limit:500}));
    results.push(await tryFilter('5. freight_date_from/to', {freight_date_from:'01.06.2026',freight_date_to:'15.07.2026',limit:500}));
    results.push(await tryFilter('6. createdFrom/To', {createdFrom:'01.06.2026',createdTo:'15.07.2026',limit:500}));
    results.push(await tryFilter('7. created_from/to', {created_from:'01.06.2026',created_to:'15.07.2026',limit:500}));
    results.push(await tryFilter('8. ISO dates', {dateFrom:'2026-06-01',dateTo:'2026-07-15',limit:500}));
    results.push(await tryFilter('9. freight_date ISO', {freight_date_from:'2026-06-01',freight_date_to:'2026-07-15',limit:500}));
    results.push(await tryFilter('10. filter nested', {filter:{dateFrom:'01.06.2026',dateTo:'15.07.2026'},limit:500}));
    results.push(await tryFilter('11. offset 0', {offset:0,limit:500}));
    results.push(await tryFilter('12. page/perPage', {page:1,perPage:500}));
    results.push(await tryFilter('13. order desc + limit', {order:'desc',limit:10}));
    results.push(await tryFilter('14. sort created desc', {sort:'created',direction:'desc',limit:10}));
    results.push(await tryFilter('15. orderBy created desc', {orderBy:'created',orderDir:'DESC',limit:10}));

    // Also get dataInfo from first request
    const fullRes = await fetch(`${BASE}/api/orders/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({limit:5})
    });
    const fullData = await fullRes.json();

    res.send('<pre style="font-size:13px;background:#111;color:#0f0;padding:20px;white-space:pre-wrap;line-height:1.8;">' +
      'DATE FILTER TEST RESULTS:\n' +
      '=========================\n\n' +
      results.join('\n') +
      '\n\n=========================\n' +
      'dataInfo: ' + JSON.stringify(fullData.dataInfo, null, 2) +
      '</pre>');

  } catch (e) {
    res.send('<pre>Error: ' + e.message + '\n' + e.stack + '</pre>');
  }
});

// Proxy
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
