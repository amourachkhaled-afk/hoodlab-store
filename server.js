// HOODLAB server — static store + shared SQLite database + Stripe Checkout.
// Runs with plain Node 24+ (node:sqlite, no npm dependencies).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DIR = __dirname;
const PORT = Number(process.env.PORT || 4242);
const DATA = path.join(DIR, 'data');
const DB_FILE = process.env.DATA_DIR || path.join(DATA, 'shop.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

function loadEnv() {
  const f = path.join(DIR, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const rawKey = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_KEY = (/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(rawKey) && !/^(sk|rk)_(test|live)_x+$/.test(rawKey)) ? rawKey : '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL, category TEXT,
    color TEXT, featured INTEGER DEFAULT 0, description TEXT
  );
  CREATE TABLE IF NOT EXISTS orders (
    num TEXT PRIMARY KEY, date TEXT, customer TEXT, items TEXT, ship TEXT, total REAL, status TEXT
  );
`);
const SEED = [
  [1, 'Hoodie Noir Signature', 49.90, 'Classiques', '#20242b', 1, 'Coton épais 420g, coupe relax, impression discrète.'],
  [2, 'Hoodie Beige Premium', 54.90, 'Premium', '#c9b9a3', 1, 'Mélange coton bio, intérieur brossé, finitions renforcées.'],
  [3, 'Hoodie Orange Accent', 44.90, 'Classiques', '#ff5a1f', 1, 'Teinte vive, poche kangourou, cordons contrastés.'],
  [4, 'Hoodie Vert Sauge', 52.90, 'Premium', '#7d947e', 0, 'Color circulation, coupe oversize, doux au toucher.'],
  [5, 'Hoodie Gris Chiné', 39.90, 'Essentiels', '#8b8f96', 0, 'Léger et polyvalent, parfait pour tous les jours.'],
  [6, 'Hoodie Bleu Nuit', 57.90, 'Premium', '#24314d', 0, 'Édition limitée, broderie poitrine, tissu dense.'],
];
if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
  const ins = db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?)');
  for (const p of SEED) ins.run(...p);
}
const allProducts = () => db.prepare('SELECT * FROM products ORDER BY id').all().map(p => ({ ...p, featured: !!p.featured }));
const allOrders = () => db.prepare('SELECT * FROM orders ORDER BY date DESC, num DESC').all().map(o => ({
  ...o, customer: JSON.parse(o.customer || '{}'), items: JSON.parse(o.items || '[]'), ship: JSON.parse(o.ship || '{}')
}));

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));
function readBody(req) {
  return new Promise(resolve => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => resolve(raw)); });
}
async function stripe(pathname, params) {
  const r = await fetch('https://api.stripe.com/v1/' + pathname, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': crypto.randomUUID() },
    body: new URLSearchParams(params).toString(),
  });
  return { status: r.status, data: await r.json() };
}
function successPage(order) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Paiement confirmé</title></head><body><p>Confirmation du paiement…</p>
  <script>(function(){var o=${JSON.stringify(order)};fetch('/api/orders',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({num:o,status:'Payée'})}).finally(function(){location.replace('/#/commande/'+encodeURIComponent(o));});})();</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://' + req.headers.host);
    if (req.method === 'OPTIONS') return send(res, 204, '');

    if (u.pathname === '/api/config') return json(res, 200, { stripeEnabled: !!STRIPE_KEY, mode: /(sk|rk)_live/.test(STRIPE_KEY) ? 'live' : (STRIPE_KEY ? 'test' : 'mock'), database: 'sqlite' });

    if (u.pathname === '/api/products') {
      if (req.method === 'GET') return json(res, 200, allProducts());
      if (req.method === 'POST') {
        const p = JSON.parse(await readBody(req));
        const id = Number(p.id || Date.now());
        db.prepare('INSERT OR REPLACE INTO products VALUES (?,?,?,?,?,?,?)').run(id, p.name, Number(p.price), p.category || 'Essentiels', p.color || '#555b66', p.featured ? 1 : 0, p.description || '');
        return json(res, 200, { ok: true, id });
      }
    }

    if (u.pathname === '/api/orders') {
      if (req.method === 'GET') return json(res, 200, allOrders());
      if (req.method === 'POST') {
        const o = JSON.parse(await readBody(req));
        db.prepare('INSERT OR REPLACE INTO orders VALUES (?,?,?,?,?,?,?)').run(o.num, o.date, JSON.stringify(o.customer || {}), JSON.stringify(o.items || []), JSON.stringify(o.ship || {}), Number(o.total), o.status || 'En préparation');
        return json(res, 200, { ok: true, num: o.num });
      }
      if (req.method === 'PATCH') {
        const b = JSON.parse(await readBody(req));
        db.prepare('UPDATE orders SET status=? WHERE num=?').run(b.status, b.num);
        return json(res, 200, { ok: true });
      }
    }

    if (u.pathname === '/api/checkout' && req.method === 'POST') {
      const data = JSON.parse(await readBody(req) || '{}');
      const order = data.order;
      if (!order || !order.items || !order.items.length) return json(res, 400, { error: 'Panier vide' });
      db.prepare('INSERT OR REPLACE INTO orders VALUES (?,?,?,?,?,?,?)').run(order.num, order.date, JSON.stringify(order.customer || {}), JSON.stringify(order.items || []), JSON.stringify(order.ship || {}), Number(order.total), order.status || 'En préparation');
      const origin = process.env.PUBLIC_URL || ('http://' + req.headers.host);
      if (!STRIPE_KEY) return json(res, 200, { mode: 'mock', url: origin + '/#/paiement-mock/' + encodeURIComponent(order.num) });
      const params = {
        mode: 'payment', 'payment_method_types[0]': 'card',
        success_url: origin + '/success?order=' + encodeURIComponent(order.num) + '&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: origin + '/#/checkout', 'metadata[order_num]': order.num,
      };
      if (order.customer && order.customer.email) params.customer_email = order.customer.email;
      order.items.forEach((it, i) => {
        const p = it.product || {};
        params[`line_items[${i}][price_data][currency]`] = 'eur';
        params[`line_items[${i}][price_data][product_data][name]`] = (p.name || 'Produit').slice(0, 100);
        params[`line_items[${i}][price_data][unit_amount]`] = String(Math.round(Number(it.price || p.price || 0) * 100));
        params[`line_items[${i}][quantity]`] = String(it.qty || 1);
      });
      const r = await stripe('checkout/sessions', params);
      if (r.status >= 400) return json(res, 502, { error: 'Stripe: ' + ((r.data.error && r.data.error.message) || r.status) });
      return json(res, 200, { mode: 'stripe', url: r.data.url, sessionId: r.data.id });
    }

    if (u.pathname === '/success') return send(res, 200, successPage(u.searchParams.get('order') || ''), 'text/html; charset=utf-8');

    if (u.pathname === '/api/webhook' && req.method === 'POST') {
      const raw = await readBody(req);
      if (WEBHOOK_SECRET) {
        const sig = req.headers['stripe-signature'] || '';
        const t = (sig.match(/t=(\d+)/) || [])[1];
        const v1 = (sig.match(/v1=([a-f0-9]+)/i) || [])[1];
        const expected = t ? crypto.createHmac('sha256', WEBHOOK_SECRET).update(t + '.' + raw).digest('hex') : '';
        if (!v1 || !crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) return json(res, 400, { error: 'Signature invalide' });
      }
      const evt = JSON.parse(raw);
      if (evt.type === 'checkout.session.completed') {
        const num = evt.data.object.metadata && evt.data.object.metadata.order_num;
        if (num) db.prepare('UPDATE orders SET status=? WHERE num=?').run('Payée', num);
        console.log('[stripe] paiement confirmé:', num);
      }
      return json(res, 200, { received: true });
    }

    let file = u.pathname === '/' ? '/index.html' : u.pathname;
    file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
    const full = path.join(DIR, file);
    if (!full.startsWith(DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    send(res, 200, fs.readFileSync(full), types[path.extname(full)] || 'application/octet-stream');
  } catch (e) { console.error(e); json(res, 500, { error: String(e.message || e) }); }
});

server.listen(PORT, () => {
  console.log('HOODLAB → http://localhost:' + PORT);
  console.log('SQLite →', DB_FILE);
  console.log('Stripe:', STRIPE_KEY ? (/(sk|rk)_live/.test(STRIPE_KEY) ? 'LIVE' : 'TEST') : 'absent (mode simulation)');
});
