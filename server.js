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

    const output = [];

    // Load July orders
    const ordRes = await fetch(`${BASE}/api/orders/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({form_order_api_filter:{dateFrom:'2026-07-01',dateTo:'2026-07-16'},perPage:500})
    });
    const ordData = await ordRes.json();
    const orders = ordData.data || [];

    // Find L01747 and L01746
    const targets = ['L01747','L01746','L01748','L01733'];
    
    for (const target of targets) {
      const order = orders.find(o => (o.order_code_referral || o.order_code) === target);
      if (order) {
        output.push(`=== ${target} (id: ${order.id}) - ALL NUMERIC FIELDS ===`);
        
        // Show all fields that have numeric values or contain 'freight','cost','price','rate','amount'
        for (const [k, v] of Object.entries(order)) {
          if (typeof v === 'number' || (typeof v === 'string' && !isNaN(v) && v !== '' && v.length < 20)) {
            output.push(`  ${k}: ${v}`);
          }
          if (typeof k === 'string' && (k.includes('freight') || k.includes('cost') || k.includes('price') || k.includes('rate') || k.includes('amount') || k.includes('profit') || k.includes('margin') || k.includes('sum') || k.includes('total') || k.includes('client') || k.includes('base'))) {
            output.push(`  ${k}: ${JSON.stringify(v)}`);
          }
        }
        
        output.push('');
        
        // Also get all-info
        output.push(`=== ${target} - /all-info ===`);
        try {
          const allRes = await fetch(`${BASE}/api/orders/${order.id}/all-info`, {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const allData = await allRes.json();
          const info = allData.data || allData;
          
          // Show all numeric/financial fields
          for (const [k, v] of Object.entries(info)) {
            if (typeof v === 'number' || (typeof k === 'string' && (k.includes('freight') || k.includes('cost') || k.includes('price') || k.includes('rate') || k.includes('amount') || k.includes('profit') || k.includes('margin') || k.includes('sum') || k.includes('total') || k.includes('base') || k.includes('client')))) {
              output.push(`  ${k}: ${JSON.stringify(v)}`);
            }
          }
        } catch(e) {
          output.push('  all-info error: ' + e.message);
        }
        output.push('');
      } else {
        output.push(`=== ${target}: NOT FOUND ===`);
      }
    }

    res.send('<pre style="font-size:12px;background:#111;color:#0f0;padding:20px;white-space:pre-wrap;line-height:1.6;">' + output.join('\n') + '</pre>');
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
