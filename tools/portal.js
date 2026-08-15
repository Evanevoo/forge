#!/usr/bin/env node
'use strict';
/**
 * Forge Owner Portal — the vendor's side of the product.
 *
 *   npm run portal
 *
 * Issues licence keys, shows what you've sold, and edits the few numbers on the
 * landing page that change (price, buy link, download link).
 *
 * Security notes, because this process can mint licences:
 *   · binds to 127.0.0.1 only — never reachable from the network
 *   · every request needs the token printed at startup, so another program on
 *     this machine can't drive it by guessing the port
 *   · the signing key is read per-request and never sent to the browser
 *
 * No dependencies. Node's standard library only.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { formatKey, verifyKey } = require('../src/license');

const KEY_DIR = path.join(os.homedir(), '.forge-signing');
const PRIVATE_PATH = path.join(KEY_DIR, 'private.pem');
const SALES_LOG = path.join(KEY_DIR, 'sales.jsonl');
const SETTINGS = path.join(KEY_DIR, 'portal.json');

const TOKEN = crypto.randomBytes(16).toString('hex');
const PORT = Number(process.env.FORGE_PORTAL_PORT || 4321);

/* ----------------------------------------------------------------- data -- */

const readSettings = () => {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (_) {
    return { price: 30, currency: 'CAD', buyUrl: '', downloadUrl: '', sitePath: '' };
  }
};
const writeSettings = (s) => {
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2), 'utf8');
  return s;
};

function readSales() {
  try {
    return fs.readFileSync(SALES_LOG, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(Boolean)
      .reverse();
  } catch (_) { return []; }
}

function mint({ name, email, note, expires }) {
  if (!fs.existsSync(PRIVATE_PATH)) {
    throw new Error('No signing key yet. Run:  npm run license -- --keygen');
  }
  if (!name && !email) throw new Error('A name or an email is required.');

  const payload = { v: 1, name: name || null, email: email || null, iat: Date.now(), id: crypto.randomUUID() };
  if (note) payload.note = note;
  if (expires) {
    const t = Date.parse(expires);
    if (Number.isNaN(t)) throw new Error('Could not read that expiry date. Use YYYY-MM-DD.');
    payload.exp = t;
  }
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signature = crypto.sign(null, Buffer.from(b64, 'utf8'),
    crypto.createPrivateKey(fs.readFileSync(PRIVATE_PATH)));
  const key = formatKey(payload, signature);

  // Catch a key/public-key mismatch here rather than in a customer's inbox.
  const check = verifyKey(key);

  const price = readSettings().price;
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.appendFileSync(SALES_LOG, JSON.stringify({ ...payload, key, price, mintedAt: new Date().toISOString() }) + '\n');
  return { key, verified: check.valid, verifyReason: check.reason || null, payload };
}

/** Patch the price / links into the landing page, in place. */
function applyToSite(settings) {
  const file = settings.sitePath;
  if (!file) throw new Error('Set the path to your landing page index.html first.');
  if (!fs.existsSync(file)) throw new Error('No file at ' + file);
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  const money = '$' + settings.price;

  html = html.replace(/(<[^>]*data-price[^>]*>)([^<]*)(<)/g, (m, a, _b, c) => a + money + c);

  // Rewrite href inside any tag carrying the marker attribute. Doing it in two
  // steps rather than one regex, because the attribute may appear before or
  // after href and a single pattern silently matches neither.
  const setHref = (markup, marker, url) => markup.replace(
    new RegExp('<a\\b[^>]*\\b' + marker + '\\b[^>]*>', 'g'),
    (tag) => (/href="/.test(tag) ? tag.replace(/href="[^"]*"/, 'href="' + url + '"') : tag.replace('<a', '<a href="' + url + '"')),
  );
  if (settings.buyUrl) html = setHref(html, 'data-buy', settings.buyUrl);
  if (settings.downloadUrl) html = setHref(html, 'data-download', settings.downloadUrl);

  if (html !== before) fs.writeFileSync(file, html, 'utf8');
  return { changed: html !== before, file };
}

function checklist(settings) {
  const sales = readSales();
  const exeDir = path.join(__dirname, '..', 'dist');
  let exe = null;
  try { exe = fs.readdirSync(exeDir).find((f) => /portable.*\.exe$/i.test(f)) || null; } catch (_) { /* none */ }
  return [
    { done: fs.existsSync(PRIVATE_PATH), label: 'Signing key generated', hint: 'npm run license -- --keygen' },
    { done: !!exe, label: 'Portable .exe built', hint: 'npm run dist' },
    { done: !!settings.downloadUrl, label: 'Download link set', hint: 'Where customers get the .exe' },
    { done: !!settings.buyUrl, label: 'Buy link set', hint: 'PayPal.Me link or checkout URL' },
    { done: !!settings.sitePath, label: 'Landing page located', hint: 'Path to index.html so the portal can update it' },
    { done: sales.length > 0, label: 'First sale', hint: 'Mint a key when the money lands' },
  ];
}

/* ------------------------------------------------------------------ web -- */

function json(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.searchParams.get('t') !== TOKEN && req.headers['x-forge-token'] !== TOKEN) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('Forbidden — open the URL printed in your terminal.');
  }

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      const html = PAGE.replace('__TOKEN__', TOKEN);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const settings = readSettings();
      const sales = readSales();
      const revenue = sales.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
      return json(res, 200, {
        settings, sales, revenue,
        hasKey: fs.existsSync(PRIVATE_PATH),
        checklist: checklist(settings),
        salesLog: SALES_LOG,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/mint') {
      return json(res, 200, mint(await readBody(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const next = writeSettings({ ...readSettings(), ...(await readBody(req)) });
      return json(res, 200, next);
    }
    if (req.method === 'POST' && url.pathname === '/api/publish') {
      return json(res, 200, applyToSite(readSettings()));
    }
    if (req.method === 'GET' && url.pathname === '/api/export.csv') {
      const rows = [['minted', 'name', 'email', 'price', 'note', 'id']]
        .concat(readSales().map((s) => [s.mintedAt, s.name || '', s.email || '', s.price ?? '', s.note || '', s.id]));
      const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
      res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="forge-sales.csv"' });
      return res.end(csv);
    }
    res.writeHead(404); res.end();
  } catch (err) {
    json(res, 400, { error: err.message });
  }
});

/* ----------------------------------------------------------------- page -- */

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Forge — Owner Portal</title><style>
:root{--bg:#0f1115;--panel:#161a21;--panel2:#1c212a;--line:#262d38;--text:#e6e9ef;--muted:#8b95a7;--accent:#ff8b3d;--ok:#4ec98a;--err:#f2685f;
--mono:ui-monospace,"Cascadia Mono",Consolas,monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:14px/1.55 "Segoe UI",system-ui,sans-serif;padding:26px}
.wrap{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
h1{font-size:19px;font-weight:650}h1 span{color:var(--accent)}
.sub{color:var(--muted);font-size:13px}
.grid{display:grid;gap:16px}@media(min-width:900px){.grid.g2{grid-template-columns:1fr 1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:11px;overflow:hidden}
.card h2{font-size:14px;font-weight:620;padding:12px 15px;border-bottom:1px solid var(--line);background:var(--panel2)}
.body{padding:15px;display:flex;flex-direction:column;gap:11px}
label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--muted)}
input{background:#0d1015;border:1px solid var(--line);border-radius:7px;padding:8px 10px;color:var(--text);font:inherit;font-size:13px;width:100%}
input:focus{outline:none;border-color:var(--accent)}
.row{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
button{background:#232a35;color:var(--text);border:1px solid var(--line);border-radius:7px;padding:8px 13px;font:inherit;font-size:13px;cursor:pointer}
button:hover{background:#2b3441}
button.primary{background:var(--accent);border-color:var(--accent);color:#1a1005;font-weight:620}
.stat{display:flex;gap:26px;flex-wrap:wrap}
.stat div b{display:block;font-size:26px;font-weight:680;letter-spacing:-.02em}
.stat div span{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:9px 15px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;background:var(--panel2)}
td.k{font-family:var(--mono);font-size:11px;color:var(--muted);max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.keyout{background:#0d1015;border:1px solid var(--accent);border-radius:8px;padding:12px;font-family:var(--mono);font-size:11.5px;word-break:break-all}
.msg{font-size:12.5px;min-height:1em}.msg.bad{color:var(--err)}.msg.good{color:var(--ok)}
ul.check{list-style:none;display:flex;flex-direction:column;gap:8px}
ul.check li{display:grid;grid-template-columns:20px 1fr;gap:8px;font-size:13px}
ul.check .m{color:var(--ok)}ul.check .m.no{color:var(--muted)}
ul.check small{display:block;color:var(--muted);font-size:11.5px;font-family:var(--mono)}
.warn{background:rgba(242,104,95,.09);border-left:2px solid var(--err);padding:8px 11px;border-radius:4px;font-size:12.5px;color:#ffb4ae}
</style></head><body><div class="wrap">
<header><h1><span>◆</span> Forge Owner Portal</h1><span class="sub" id="where"></span></header>
<div id="nokey"></div>

<div class="card"><h2>Sales</h2><div class="body">
  <div class="stat">
    <div><b id="sCount">0</b><span>licences issued</span></div>
    <div><b id="sRev">$0</b><span>gross revenue</span></div>
    <div><b id="sLast">—</b><span>most recent</span></div>
  </div>
  <div class="row"><button onclick="location.href='/api/export.csv?t=__TOKEN__'">Export CSV</button>
  <span class="sub" id="logPath"></span></div>
</div>
<table><thead><tr><th>Minted</th><th>Customer</th><th>Price</th><th>Note</th><th>Key</th></tr></thead><tbody id="rows"></tbody></table>
</div>

<div class="grid g2">
  <div class="card"><h2>Issue a licence</h2><div class="body">
    <label>Name<input id="mName" placeholder="Jane Smith"/></label>
    <label>Email<input id="mEmail" placeholder="jane@example.com"/></label>
    <label>Note <span class="sub">payment reference — e-transfer id, PayPal txn</span><input id="mNote" placeholder="PayPal 8XY…"/></label>
    <label>Expires <span class="sub">blank = never</span><input id="mExp" placeholder="YYYY-MM-DD"/></label>
    <div class="row"><button class="primary" onclick="doMint()">Mint key</button>
      <button onclick="copyKey()" id="btnCopy" style="display:none">Copy</button></div>
    <div class="msg" id="mMsg"></div>
    <div class="keyout" id="mKey" style="display:none"></div>
  </div></div>

  <div class="card"><h2>Website</h2><div class="body">
    <label>Price<input id="pPrice" type="number" min="0"/></label>
    <label>Buy link <span class="sub">PayPal.Me or checkout URL</span><input id="pBuy" placeholder="https://paypal.me/you/30"/></label>
    <label>Download link<input id="pDown" placeholder="https://…/Forge-1.0.0-portable.exe"/></label>
    <label>Landing page file<input id="pSite" placeholder="C:\\Users\\you\\forge-site\\index.html"/></label>
    <div class="row"><button onclick="save()">Save</button><button class="primary" onclick="publish()">Save &amp; update site</button></div>
    <div class="msg" id="pMsg"></div>
  </div></div>
</div>

<div class="card"><h2>Before you sell</h2><div class="body"><ul class="check" id="check"></ul></div></div>
</div>
<script>
const T='__TOKEN__';
const $=id=>document.getElementById(id);
const api=(p,o={})=>fetch(p+(p.includes('?')?'&':'?')+'t='+T,{headers:{'content-type':'application/json','x-forge-token':T},...o}).then(r=>r.json());
let lastKey='';

async function load(){
  const s=await api('/api/state');
  $('sCount').textContent=s.sales.length;
  $('sRev').textContent='$'+s.revenue.toLocaleString();
  $('sLast').textContent=s.sales[0]?new Date(s.sales[0].mintedAt).toLocaleDateString():'—';
  $('logPath').textContent=s.salesLog;
  $('rows').innerHTML=s.sales.map(x=>'<tr><td>'+new Date(x.mintedAt).toLocaleString()+'</td><td>'+
    ((x.name||'')+(x.email?'<br><span class="sub">'+x.email+'</span>':''))+'</td><td>'+(x.price!=null?'$'+x.price:'')+
    '</td><td>'+(x.note||'')+'</td><td class="k">'+x.key.slice(0,42)+'…</td></tr>').join('')
    || '<tr><td colspan="5" class="sub" style="padding:18px 15px">No licences issued yet.</td></tr>';
  $('pPrice').value=s.settings.price??30; $('pBuy').value=s.settings.buyUrl||'';
  $('pDown').value=s.settings.downloadUrl||''; $('pSite').value=s.settings.sitePath||'';
  $('check').innerHTML=s.checklist.map(c=>'<li><span class="m'+(c.done?'':' no')+'">'+(c.done?'●':'○')+
    '</span><div>'+c.label+'<small>'+c.hint+'</small></div></li>').join('');
  $('nokey').innerHTML = s.hasKey ? '' :
    '<div class="warn">No signing key yet — you cannot issue licences. Run <b>npm run license -- --keygen</b>, paste the printed public key into src/license.js, then reload this page.</div>';
}
async function doMint(){
  $('mMsg').className='msg'; $('mMsg').textContent='minting…';
  const r=await api('/api/mint',{method:'POST',body:JSON.stringify({
    name:$('mName').value.trim(),email:$('mEmail').value.trim(),
    note:$('mNote').value.trim(),expires:$('mExp').value.trim()})});
  if(r.error){$('mMsg').className='msg bad';$('mMsg').textContent=r.error;return;}
  lastKey=r.key; $('mKey').style.display='block'; $('mKey').textContent=r.key;
  $('btnCopy').style.display='inline-block';
  $('mMsg').className='msg '+(r.verified?'good':'bad');
  $('mMsg').textContent=r.verified?'Key verified against the public key in src/license.js — safe to send.'
    :'WARNING: this key does not verify ('+r.verifyReason+'). Do not send it.';
  load();
}
function copyKey(){navigator.clipboard.writeText(lastKey);$('mMsg').className='msg good';$('mMsg').textContent='copied';}
async function save(){
  const r=await api('/api/settings',{method:'POST',body:JSON.stringify({
    price:Number($('pPrice').value)||0,buyUrl:$('pBuy').value.trim(),
    downloadUrl:$('pDown').value.trim(),sitePath:$('pSite').value.trim()})});
  $('pMsg').className='msg good';$('pMsg').textContent='saved';load();return r;
}
async function publish(){
  await save();
  const r=await api('/api/publish',{method:'POST'});
  $('pMsg').className='msg '+(r.error?'bad':'good');
  $('pMsg').textContent=r.error?r.error:(r.changed?'Landing page updated — '+r.file:'Landing page already matched these values.');
}
load();
</script></body></html>`;

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/?t=' + TOKEN;
  console.log('\n  Forge Owner Portal\n');
  console.log('    ' + url + '\n');
  if (!fs.existsSync(PRIVATE_PATH)) {
    console.log('  No signing key yet — run:  npm run license -- --keygen\n');
  }
  console.log('  Local only. Stop it with Ctrl+C.\n');
});
