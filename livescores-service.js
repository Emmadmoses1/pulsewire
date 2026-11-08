// Live scores: one shared, cached copy for every visitor, and the first scores are already inside the page.
const fs = require('fs');
const path = require('path');
const UP = 'https://wavzo-db.dakudinamoses.workers.dev/football';
const cache = new Map(), inflight = new Map();
let lastAsked = 0;

const today = () => new Date().toISOString().slice(0, 10);
function ttlFor(qs) {
  const p = new URLSearchParams(qs), t = p.get('type');
  if (t === 'live') return 15000;
  if (t === 'details') return 20000;
  const d = p.get('date') || today();
  return d < today() ? 3600000 : d > today() ? 600000 : 120000;
}
function clean(q) {
  const t = String(q.type || 'live');
  if (!['live', 'date', 'details'].includes(t)) return null;
  const p = new URLSearchParams({ type: t });
  if (t === 'date') { const d = String(q.date || today()); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null; p.set('date', d); }
  if (t === 'details') { const id = String(q.id || ''); if (!/^[\w-]{1,40}$/.test(id)) return null; p.set('id', id); }
  return p.toString();
}
async function get(qs) {
  const c = cache.get(qs), ttl = ttlFor(qs);
  if (c && Date.now() - c.t < ttl) return c;
  if (inflight.has(qs)) return c || inflight.get(qs);          // everyone shares one request; old data is served meanwhile
  const p = (async () => {
    try {
      const r = await fetch(UP + '?' + qs, { signal: AbortSignal.timeout(9000) });
      const text = await r.text();
      if (r.ok) { const e = { t: Date.now(), status: 200, text }; cache.set(qs, e); return e; }
      return c || { t: Date.now(), status: r.status, text };
    } catch (e) { if (c) return c; throw e; }
    finally { inflight.delete(qs); }
  })();
  inflight.set(qs, p);
  return c || p;
}
function register(app) {
  app.get('/api/football', async (req, res) => {
    const qs = clean(req.query);
    if (!qs) return res.status(400).json({ ok: false, error: 'bad request' });
    lastAsked = Date.now();
    try {
      const e = await get(qs);
      res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + Math.round(ttlFor(qs) / 2000) + ', stale-while-revalidate=60' }).status(e.status).send(e.text);
    } catch (err) { res.status(502).json({ ok: false, error: 'scores unavailable' }); }
  });
  app.get('/livescores.html', async (req, res, next) => {
    try {
      let html = fs.readFileSync(path.join(__dirname, 'livescores.html'), 'utf8');
      let inject = '';
      try {
        const e = await Promise.race([get('type=live'), new Promise((r) => setTimeout(() => r(null), 2500))]);
        if (e && e.status === 200) { JSON.parse(e.text); inject = '<script>window.__LS=' + e.text.replace(/</g, '\\u003c') + ';</script>'; }
      } catch (x) { /* page still works without it */ }
      res.set('Cache-Control', 'public, max-age=15').type('html').send(html.split('<!--SSR:LS-->').join(inject));
    } catch (e) { next(); }
  });
  // keep the live list warm while people are watching
  setInterval(() => { if (Date.now() - lastAsked < 5 * 60000) get('type=live').catch(() => {}); }, 15000).unref();
}
module.exports = { register, _get: get, _clean: clean };
