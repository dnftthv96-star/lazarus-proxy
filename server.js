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

    async function apiPost(path2, body) {
      const r = await fetch(`${BASE}/${path2}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
      return r.json();
    }

    const output = [];

    // 1. Get first client
    output.push('=== CLIENTS (first 2) ===');
    const cliRes = await apiPost('api/clients/list', { perPage: 2, page: 0 });
    const clients = cliRes.data || cliRes || [];
    if (Array.isArray(clients) && clients[0]) {
      output.push(JSON.stringify(clients[0], null, 2).substring(0, 1500));
    } else {
      output.push('Clients response: ' + JSON.stringify(cliRes).substring(0, 500));
    }

    // 2. Get first user
    output.push('\n=== USERS (first 2) ===');
    const usrRes = await apiPost('api/users/list', { perPage: 2, page: 0 });
    const users = usrRes.data || usrRes || [];
    if (Array.isArray(users) && users[0]) {
      output.push(JSON.stringify(users[0], null, 2).substring(0, 1000));
    } else {
      output.push('Users response: ' + JSON.stringify(usrRes).substring(0, 500));
    }

    // 3. Get recent orders (last page)
    output.push('\n=== RECENT ORDERS (last page) ===');
    const totalRes = await apiPost('api/orders/list', { perPage: 1, page: 0 });
    const totalItems = totalRes.dataInfo ? totalRes.dataInfo.amountItems : 0;
    output.push('Total orders: ' + totalItems);
    
    // Get last 5 orders
    const lastPage = Math.floor((totalItems - 1) / 5);
    const recentRes = await apiPost('api/orders/list', { perPage: 5, page: lastPage });
    const recentOrders = recentRes.data || [];
    
    output.push('Last page (' + lastPage + '):');
    recentOrders.forEach(o => {
      output.push(`  ID:${o.id} code:${o.order_code_referral||o.order_code} freight_date:${o.freight_date} created:${o.created} createdAt:${o.createdAt} client_id:${o.client_id} user_id:${o.user_id} freight:${o.freight} profit:${o.profit}`);
    });

    // 4. Get one full order info for L01754 or latest
    output.push('\n=== FULL ORDER INFO (latest) ===');
    if (recentOrders.length > 0) {
      const lastId = recentOrders[recentOrders.length - 1].id;
      const fullRes = await fetch(`${BASE}/api/orders/${lastId}/all-info`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const fullData = await fullRes.json();
      const fullOrder = fullData.data || fullData;
      output.push(JSON.stringify(fullOrder, null, 2).substring(0, 2000));
    }

    res.send('<pre style="font-size:12px;background:#111;color:#0f0;padding:20px;white-space:pre-wrap;word-wrap:break-word;">' + output.join('\n') + '</pre>');

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
