const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BASE = 'https://lazarus.4logist.com';

// Debug endpoint - shows raw API response structure
app.get('/debug', async (req, res) => {
  try {
    // Read credentials from index.html (same as dashboard uses)
    const fs = require('fs');
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    
    const cidMatch = html.match(/const CLIENT_ID\s*=\s*'([^']+)'/);
    const csMatch  = html.match(/const CLIENT_SECRET\s*=\s*'([^']+)'/);
    const unMatch  = html.match(/const USERNAME\s*=\s*'([^']+)'/);
    const pwMatch  = html.match(/const PASSWORD\s*=\s*'([^']+)'/);
    
    if (!cidMatch || !csMatch || !unMatch || !pwMatch) {
      return res.send('<pre>Could not read credentials from index.html</pre>');
    }

    // Get token
    const tokenBody = `grant_type=password&client_id=${cidMatch[1]}&client_secret=${csMatch[1]}&username=${encodeURIComponent(unMatch[1])}&password=${encodeURIComponent(pwMatch[1])}`;
    const tokenRes = await fetch(`${BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });
    const tokenData = await tokenRes.json();
    
    if (!tokenData.access_token) {
      return res.send('<pre>Auth failed: ' + JSON.stringify(tokenData, null, 2) + '</pre>');
    }

    // Fetch 1 order
    const ordersRes = await fetch(`${BASE}/api/orders/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + tokenData.access_token
      },
      body: JSON.stringify({ dateFrom: '2026-06-01', dateTo: '2026-06-30', limit: 2 })
    });
    const ordersData = await ordersRes.json();

    res.send('<pre style="font-size:12px;background:#111;color:#0f0;padding:20px;white-space:pre-wrap;word-wrap:break-word;">' + 
      'TOP-LEVEL KEYS: ' + JSON.stringify(Object.keys(ordersData)) + '\n\n' +
      'FULL RESPONSE (first 5000 chars):\n' + 
      JSON.stringify(ordersData, null, 2).substring(0, 5000) + 
      '</pre>');

  } catch (e) {
    res.send('<pre>Error: ' + e.message + '</pre>');
  }
});

// Proxy all API requests
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

// Serve dashboard
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
