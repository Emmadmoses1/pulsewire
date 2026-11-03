// Automatic posting: reads the trusted news feeds on the server and publishes new stories
// that have a picture, even when nobody is logged in to the admin page.
const crypto = require('crypto');
const rss = require('./rss-service');

const BIN_ID = '6aa50e3aac6210605ac3c542';
const DB_BASE = 'https://wavzo-db.dakudinamoses.workers.dev/v3/b/' + BIN_ID;
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const KEY = () => process.env.WZ_DB_KEY || '';
const DEFAULTS = { enabled: false, every: 20, perRun: 3, maxPerDay: 30, maxChars: 1500, maxAgeHours: 36, cats: ['NEWS', 'SPORTS', 'ENTERTAINMENT', 'TRENDING'] };
const POST_CAT = { GIST: 'ENTERTAINMENT' };

const events = [];
let lastRun = 0, running = false, started = false;
const health = {};
function say(m) { events.unshift({ t: Date.now(), m }); events.length = Math.min(events.length, 40); console.log('Autopost: ' + m); }

async function dbGet(key) {
  const r = await fetch(DB_BASE + '/latest', { headers: { 'X-Master-Key': key || 'public' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('database read failed (' + r.status + ')');
  const j = await r.json();
  const doc = j && j.record;
  if (!doc || typeof doc !== 'object') throw new Error('database returned empty data, stopped so nothing is overwritten');
  doc.posts = doc.posts || [];
  return doc;
}
async function dbPut(doc, key) {
  const r = await fetch(DB_BASE, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Master-Key': key }, body: JSON.stringify(doc), signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error('database save failed (' + r.status + ')');
}

// ---- same article layout the admin page produces ----
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function linkify(s) {
  return s.replace(/(https?:\/\/[^\s<]+)/g, (u) => {
    const clean = u.replace(/[),.!?]+$/, ''), trail = u.slice(clean.length);
    return '<a href="' + clean + '" target="_blank" rel="noopener nofollow">' + clean + '</a>' + trail;
  });
}
function formatArticle(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p, i) => {
    const m = p.match(/^Source:\s*(.+?)\s*\|\s*(\S+)$/i);
    if (m) return '<p class="article-source"><a class="read-more-btn" href="' + esc(m[2]) + '" target="_blank" rel="noopener nofollow">Read the full story at ' + esc(m[1]) + ' &rarr;</a></p>';
    const safe = linkify(esc(p));
    if (i === 0) {
      const cut = p.search(/[.!?]\s/);
      if (cut > 10 && cut < 220) return '<p><strong>' + linkify(esc(p.slice(0, cut + 1))) + '</strong>' + linkify(esc(p.slice(cut + 1))) + '</p>';
      return '<p><strong>' + safe + '</strong></p>';
    }
    return '<p>' + safe + '</p>';
  }).join('\n');
}
function trimText(t, max) {
  t = String(t || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const k = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (k > max * 0.5 ? cut.slice(0, k + 1) : cut.replace(/\s+\S*$/, '') + '\u2026').trim();
}
async function imageOk(url) {
  const get = async (range) => {
    const h = { 'User-Agent': UA, Accept: 'image/*,*/*' };
    if (range) h.Range = 'bytes=0-2047';
    const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(7000), redirect: 'follow' });
    try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) { /* ignore */ }
    return r;
  };
  try {
    let r = await get(true);
    if (r.status !== 200 && r.status !== 206) r = await get(false);
    const ct = r.headers.get('content-type') || '';
    return (r.status === 200 || r.status === 206) && (/^image\//i.test(ct) || (/octet-stream/i.test(ct) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)));
  } catch (e) { return false; }
}
// Many feeds only give a two-line summary. Read the story page itself and keep its paragraphs.
async function articleText(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(9000), redirect: 'follow' });
    if (!r.ok) return '';
    let html = (await r.text()).slice(0, 900000);
    html = html.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ');
    const art = html.match(/<article[\s\S]*?<\/article>/i);
    const zone = art ? art[0] : html, paras = [], re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m, len = 0;
    while ((m = re.exec(zone))) {
      const t = rss.htmlToText(m[1]).replace(/\s+/g, ' ').trim();
      if (t.length < 60) continue;
      if (/^(read also|also read|related|advertisement|subscribe|follow us|click here|copyright|sign up|share this|photo:|image:|source:|\u00a9)/i.test(t)) continue;
      if (/cookie|privacy policy|all rights reserved/i.test(t) && t.length < 220) continue;
      paras.push(t); len += t.length;
      if (len > 5000) break;
    }
    return paras.join('\n\n');
  } catch (e) { return ''; }
}
function interleave(lists, n) {
  const out = [];
  for (let i = 0; out.length < n; i++) {
    let added = false;
    for (const l of lists) { if (l[i]) { out.push(l[i]); added = true; if (out.length >= n) break; } }
    if (!added) break;
  }
  return out;
}

async function runOnce(manual) {
  if (running) return { ok: false, msg: 'A run is already in progress' };
  running = true;
  try {
    const key = KEY();
    if (!key) { say('Missing WZ_DB_KEY. Add it in Render > Environment (same password as the admin page).'); return { ok: false, msg: 'Server is missing WZ_DB_KEY' }; }
    let doc = await dbGet(key);
    const cfg = Object.assign({}, DEFAULTS, doc.autopost || {});
    if (!cfg.enabled && !manual) return { ok: true, msg: 'Auto-posting is switched off' };
    const today = doc.posts.filter((p) => p.auto && (+p.createdAt || 0) > Date.now() - 864e5).length;
    const want = Math.min(cfg.perRun, Math.max(0, cfg.maxPerDay - today));
    if (want <= 0) { say('Daily limit reached (' + today + '/' + cfg.maxPerDay + ')'); return { ok: true, msg: 'Daily limit reached' }; }

    const posted = rss.postedSets(doc), lists = [];
    const st = { found: 0, old: 0, dup: 0, short: 0, noPic: 0 };
    for (const cat of cfg.cats) {
      let data;
      try { data = await rss.getCategory(cat, false); } catch (e) { say('Feeds failed for ' + cat + ': ' + e.message); continue; }
      const total = (rss._FEEDS[cat] || []).length, working = new Set(data.items.map((x) => x.source)).size;
      health[cat] = { total, ok: working, failed: data.failed || [] };
      lists.push(data.items.filter((it) => {
        if (!it.title || !it.link) return false;
        st.found++;
        if (it.pub && Date.now() - it.pub > cfg.maxAgeHours * 36e5) { st.old++; return false; }
        if (posted.links.has(rss.normLink(it.link)) || posted.titles.has(rss.normTitle(it.title))) { st.dup++; return false; }
        return true;
      }).map((it) => ({ cat, it })));
    }
    const chosen = [];
    for (const { cat, it } of interleave(lists, want * 5)) {
      if (chosen.length >= want) break;
      let text = it.fullContent || it.excerpt || '';
      if (text.length < 700) { const t2 = await articleText(it.link); if (t2.length > text.length) text = t2; }
      if (text.length < 300) { st.short++; continue; }
      let img = it.image;
      if (!img) { try { img = await rss.ogImage(it.link); } catch (e) { img = null; } }
      if (!img) { st.noPic++; continue; }
      img = String(img).replace(/&amp;/g, '&');
      if (!(await imageOk(img))) { st.noPic++; continue; }
      chosen.push({ cat, it, img, text });
    }
    const summary = 'Checked ' + st.found + ' stories: ' + st.old + ' too old, ' + st.dup + ' already posted, ' + st.short + ' too short, ' + st.noPic + ' without a working picture, ' + chosen.length + ' ready';
    say(summary);
    if (!chosen.length) return { ok: true, msg: 'Nothing new to post', summary };

    doc = await dbGet(key); // read again right before saving, so nothing you posted meanwhile is lost
    const p2 = rss.postedSets(doc), d = new Date();
    const dateTag = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const date = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const added = [];
    chosen.forEach(({ cat, it, img, text }, k) => {
      if (p2.links.has(rss.normLink(it.link)) || p2.titles.has(rss.normTitle(it.title))) return;
      const body = trimText(text, cfg.maxChars);
      const base = it.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 8).join('-');
      const post = {
        title: it.title, slug: base + '-' + dateTag + '-' + crypto.randomBytes(2).toString('hex'),
        category: (cfg.gistCat && cat === 'GIST') ? cfg.gistCat : (POST_CAT[cat] || cat),
        excerpt: ((it.excerpt && it.excerpt.length > 60) ? it.excerpt : body.replace(/\s+/g, ' ')).slice(0, 200), content: formatArticle(body + '\n\nSource: ' + it.source + ' | ' + it.link),
        coverImage: img, musicFile: null, videoFile: null, date, createdAt: Date.now() + k, sourceUrl: it.link, source: it.source, auto: true
      };
      doc.posts.push(post); added.push(post);
    });
    if (!added.length) { say('Everything was already posted'); return { ok: true, msg: 'Already posted' }; }
    await dbPut(doc, key);
    say('Posted ' + added.length + ': ' + added.map((p) => p.title.slice(0, 45)).join(' | '));
    return { ok: true, posted: added.length, titles: added.map((p) => p.title), summary };
  } catch (e) {
    say('Error: ' + e.message);
    return { ok: false, msg: e.message };
  } finally { running = false; lastRun = Date.now(); }
}

async function tick() {
  try {
    if (!KEY()) return;
    const doc = await dbGet('public').catch(() => null);
    const cfg = Object.assign({}, DEFAULTS, (doc && doc.autopost) || {});
    if (!cfg.enabled) return;
    if (Date.now() - lastRun < cfg.every * 6e4 - 2e4) return;
    await runOnce(false);
  } catch (e) { say('Scheduler error: ' + e.message); }
}
function start() {
  if (started) return;
  started = true;
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 5 * 60 * 1000);
}
function register(app) {
  const authed = (req) => {
    const k = KEY(), h = String(req.get('x-master-key') || '');
    return !!k && h.length === k.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(k));
  };
  app.get('/admin/autopost/status', (req, res) => {
    if (!KEY()) return res.json({ keySet: false });
    if (!authed(req)) return res.status(401).json({ keySet: true, ok: false });
    res.set('Cache-Control', 'no-store').json({ keySet: true, ok: true, running, lastRun, health, events: events.slice(0, 15) });
  });
  app.get('/admin/autopost/feeds', async (req, res) => {
    if (!authed(req)) return res.status(401).json({ ok: false });
    const out = {};
    for (const cat of Object.keys(rss._FEEDS)) {
      try {
        const d = await rss.getCategory(cat, true), names = [...new Set(d.items.map((x) => x.source))];
        out[cat] = { ok: names, failed: d.failed || [], total: (rss._FEEDS[cat] || []).length };
        health[cat] = { total: out[cat].total, ok: names.length, failed: out[cat].failed };
      } catch (e) { out[cat] = { ok: [], failed: [String(e.message)], total: 0 }; }
    }
    res.json({ ok: true, cats: out });
  });
  app.post('/admin/autopost/run', async (req, res) => {
    if (!KEY()) return res.status(400).json({ ok: false, msg: 'Server is missing WZ_DB_KEY' });
    if (!authed(req)) return res.status(401).json({ ok: false, msg: 'Wrong key. WZ_DB_KEY on the server must equal your admin password.' });
    res.json(await runOnce(true));
  });
}
module.exports = { register, start, runOnce, formatArticle, trimText, _events: events };
