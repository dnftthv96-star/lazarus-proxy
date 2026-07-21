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
    if (!tokenData.access_token) return res.send('<pre>Auth failed</pre>');
    const token = tokenData.access_token;

    const output = [];
    
    // Get one recent order with ALL fields to find expeditor
    output.push('=== SEARCHING FOR EXPEDITOR FIELDS ===');
    const ordRes = await fetch(`${BASE}/api/orders/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({form_order_api_filter:{dateFrom:'2026-07-01',dateTo:'2026-07-16'},perPage:2})
    });
    const ordData = await ordRes.json();
    const orders = ordData.data || [];
    
    if (orders[0]) {
      const o = orders[0];
      output.push('Order: ' + (o.order_code_referral || o.id));
      output.push('');
      
      // Show ALL fields that might relate to expeditor/logistician
      for (const [k, v] of Object.entries(o)) {
        const kl = k.toLowerCase();
        if (kl.includes('expedi') || kl.includes('logist') || kl.includes('forward') || 
            kl.includes('user') || kl.includes('manager') || kl.includes('person') ||
            kl.includes('agent') || kl.includes('responsible') || kl.includes('assign') ||
            kl.includes('employee') || kl.includes('worker') || kl.includes('handler')) {
          output.push('  ' + k + ': ' + JSON.stringify(v));
        }
      }
      
      output.push('');
      output.push('=== ALL FIELD NAMES ===');
      output.push(Object.keys(o).join(', '));
      
      // Also get all-info for this order
      output.push('');
      output.push('=== /all-info EXPEDITOR FIELDS ===');
      try {
        const allRes = await fetch(`${BASE}/api/orders/${o.id}/all-info`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const allData = await allRes.json();
        const info = allData.data || allData;
        
        for (const [k, v] of Object.entries(info)) {
          const kl = k.toLowerCase();
          if (kl.includes('expedi') || kl.includes('logist') || kl.includes('forward') || 
              kl.includes('user') || kl.includes('manager') || kl.includes('person') ||
              kl.includes('agent') || kl.includes('responsible') || kl.includes('assign') ||
              kl.includes('trip') || kl.includes('additional')) {
            output.push('  ' + k + ': ' + JSON.stringify(v).substring(0, 300));
          }
        }
      } catch(e) {
        output.push('  all-info error: ' + e.message);
      }
    }

    res.send('<pre style="font-size:12px;background:#111;color:#0f0;padding:20px;white-space:pre-wrap;line-height:1.6;">' + output.join('\n') + '</pre>');
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
