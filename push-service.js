// Picture notifications ("push"): readers allow alerts once, then get a pop-up with the story picture when you publish.
const crypto = require('crypto');
const express = require('express');
let webpush = null;
try { webpush = require('web-push'); } catch (e) { /* run: npm install web-push */ }
let team = null;
try { team = require('./team-service'); } catch (e) { /* optional */ }

const SITE = 'https://wavzo.com.ng';
const BIN_ID = '6aa50e3aac6210605ac3c542';
const DB_BASE = 'https://wavzo-db.dakudinamoses.workers.dev/v3/b/' + BIN_ID;
const MASTER = () => process.env.WZ_DB_KEY || '';
const PUB = () => process.env.WZ_VAPID_PUBLIC || '';
const PRIV = () => process.env.WZ_VAPID_PRIVATE || '';
const ready = () => !!(webpush && PUB() && PRIV());
let configured = false;
function setup() { if (!ready()) return false; if (!configured) { webpush.setVapidDetails('mailto:hello@wavzo.com.ng', PUB(), PRIV()); configured = true; } return true; }
const J = express.json({ limit: '30kb' });
const MAX_SUBS = 3000, MAX_PER_HOUR = 6;

async function dbGet(key) {
  const r = await fetch(DB_BASE + '/latest', { headers: { 'X-Master-Key': key || 'public' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('database read failed (' + r.status + ')');
  const j = await r.json(), doc = j && j.record;
  if (!doc || typeof doc !== 'object') throw new Error('database returned empty data');
  return doc;
}
async function dbPut(doc, key) {
  const r = await fetch(DB_BASE, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Master-Key': key }, body: JSON.stringify(doc), signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error('database save failed (' + r.status + ')');
}

const subs = new Map(), removed = new Set(), notified = new Set(), hourly = [], log = [];
let dirty = false, lastSent = 0, started = false;
const say = (m) => { log.unshift({ t: Date.now(), m }); log.length = Math.min(log.length, 25); console.log('Push: ' + m); };
const clip = (s, n) => { s = String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '\u2026' : s; };
function bigImg(u) {
  u = String(u || '').trim().replace(/&amp;/g, '&');
  if (!/^https?:\/\//i.test(u)) return '';
  const m = u.match(/^(https?:\/\/res\.cloudinary\.com\/[^\/]+\/image\/upload\/)(.*)$/);
  if (m) return m[1] + 'c_fill,g_auto,w_720,h_360,f_jpg,q_auto/' + m[2];
  if (u.indexOf(SITE) === 0) return u;
  return 'https://wsrv.nl/?url=' + encodeURIComponent(u) + '&w=720&h=360&fit=cover&output=jpg&q=80';
}
function payloadFor(p, extra) {
  return { title: clip(p.title, 90), body: extra || clip(p.excerpt || p.content, 140), url: SITE + '/posts/' + String(p.slug).replace(/[^\w.%-]/g, '') + '.html?utm_source=push',
    image: bigImg(p.coverImage), icon: SITE + '/images/wavzo-icon-192.png', badge: SITE + '/images/wavzo-favicon-32.png', tag: 'post-' + p.slug };
}

// ---- keeping the list of subscribed devices (stored in your database, capped so it stays small) ----
async function loadSubs() {
  try {
    const doc = await dbGet('public');
    (doc.pushSubs || []).forEach((a) => { if (Array.isArray(a) && a[0] && !subs.has(a[0])) subs.set(a[0], { endpoint: a[0], keys: { p256dh: a[1], auth: a[2] }, t: a[3] || 0 }); });
  } catch (e) { say('Could not load subscribers: ' + e.message); }
}
async function flush() {
  if (!dirty || !MASTER()) return;
  try {
    const doc = await dbGet(MASTER()), all = new Map();
    (doc.pushSubs || []).forEach((a) => { if (Array.isArray(a) && a[0] && !removed.has(a[0])) all.set(a[0], a); });
    subs.forEach((s) => all.set(s.endpoint, [s.endpoint, s.keys.p256dh, s.keys.auth, s.t]));
    removed.forEach((e) => all.delete(e));
    doc.pushSubs = [...all.values()].sort((a, b) => (b[3] || 0) - (a[3] || 0)).slice(0, MAX_SUBS);
    await dbPut(doc, MASTER());
    dirty = false; removed.clear();
  } catch (e) { say('Could not save subscribers: ' + e.message); }
}
function addSub(s) {
  const e = String((s && s.endpoint) || ''), k = (s && s.keys) || {};
  if (!/^https:\/\//.test(e) || e.length > 700 || !/^[\w-]{60,100}={0,2}$/.test(String(k.p256dh || '')) || !/^[\w-]{10,40}={0,2}$/.test(String(k.auth || ''))) return false;
  if (!subs.has(e) && subs.size >= MAX_SUBS) return false;
  subs.set(e, { endpoint: e, keys: { p256dh: k.p256dh, auth: k.auth }, t: Date.now() }); removed.delete(e); dirty = true;
  return true;
}

async function sendTo(list, payload) {
  if (!setup()) return { sent: 0, failed: 0, msg: 'Push is not set up on the server' };
  const body = JSON.stringify(payload);
  let sent = 0, failed = 0, i = 0;
  const work = async () => {
    while (i < list.length) {
      const s = list[i++];
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 21600, urgency: 'high' }); sent++; }
      catch (e) { failed++; if (e && (e.statusCode === 404 || e.statusCode === 410)) { subs.delete(s.endpoint); removed.add(s.endpoint); dirty = true; } }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(25, list.length)) }, work));
  return { sent, failed };
}
const sendAll = (payload) => sendTo([...subs.values()], payload);

// called when new posts appear: one notification at most, and no more than 6 an hour
async function notifyNew(posts, doc) {
  const c = Object.assign({ enabled: true, auto: false }, (doc && doc.push) || {});
  if (!c.enabled || !setup() || !subs.size) return;
  const fresh = (posts || []).filter((p) => p && p.slug && !notified.has(p.slug));
  fresh.forEach((p) => notified.add(p.slug));
  if (notified.size > 600) [...notified].slice(0, 200).forEach((x) => notified.delete(x));
  const el = fresh.filter((p) => p.coverImage && (c.auto || !p.auto)).sort((a, b) => (+b.createdAt || 0) - (+a.createdAt || 0));
  if (!el.length) return;
  const now = Date.now();
  while (hourly.length && now - hourly[0] > 3600e3) hourly.shift();
  if (hourly.length >= MAX_PER_HOUR) { say('Hourly limit reached, skipped "' + clip(el[0].title, 40) + '"'); return; }
  hourly.push(now);
  const r = await sendAll(payloadFor(el[0], el.length > 1 ? '+' + (el.length - 1) + ' more new stories on WAVZO' : ''));
  lastSent = now; say('Sent "' + clip(el[0].title, 40) + '" to ' + r.sent + ' device(s)' + (r.failed ? ', ' + r.failed + ' failed' : ''));
}

function register(app) {
  const owner = (req) => { const k = MASTER(), h = String(req.get('x-master-key') || ''); return !!k && h.length === k.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(k)); };
  const rate = new Map();
  app.get('/api/push/key', (req, res) => res.set('Cache-Control', 'public, max-age=300').json({ key: ready() ? PUB() : '' }));
  app.post('/api/push/subscribe', J, (req, res) => {
    const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim(), n = Date.now(), t = (rate.get(ip) || []).filter((x) => n - x < 3600e3);
    if (t.length >= 30) return res.status(429).json({ ok: false });
    t.push(n); rate.set(ip, t);
    res.json({ ok: ready() && addSub(req.body) });
  });
  app.post('/api/push/unsubscribe', J, (req, res) => {
    const e = String((req.body && req.body.endpoint) || '');
    if (subs.delete(e)) { removed.add(e); dirty = true; }
    res.json({ ok: true });
  });
  app.get('/admin/push/status', (req, res) => {
    if (!owner(req)) return res.status(MASTER() ? 401 : 400).json({ ok: false, keySet: !!MASTER() });
    res.set('Cache-Control', 'no-store').json({ ok: true, library: !!webpush, keys: !!(PUB() && PRIV()), ready: ready(), subs: subs.size, lastSent, log: log.slice(0, 10) });
  });
  app.post('/admin/push/test', J, async (req, res) => {
    if (!owner(req)) return res.status(401).json({ ok: false });
    const s = req.body || {};
    if (!/^https:\/\//.test(String(s.endpoint || ''))) return res.status(400).json({ ok: false, msg: 'Turn on notifications on this device first.' });
    const r = await sendTo([{ endpoint: s.endpoint, keys: s.keys || {} }], { title: 'WAVZO test', body: 'Picture notifications are working \uD83C\uDF89', url: SITE + '/', image: SITE + '/images/wavzo-og-image.png', icon: SITE + '/images/wavzo-icon-192.png', tag: 'wz-test' });
    res.json({ ok: r.sent > 0, msg: r.msg || (r.sent ? 'Sent' : 'The device refused it') });
  });
  app.post('/admin/push/notify', J, async (req, res) => {
    try {
      let allowed = owner(req);
      if (!allowed && team && (req.get('authorization') || '')) allowed = !!(await team.userFromRequest(req));
      if (!allowed) return res.status(401).json({ ok: false });
      const slug = String((req.body && req.body.slug) || ''), doc = await dbGet('public'), p = (doc.posts || []).find((x) => x.slug === slug);
      if (!p) return res.status(404).json({ ok: false, msg: 'Post not found.' });
      if (notified.has('manual:' + slug) && Date.now() - lastSent < 60000) return res.json({ ok: true, sent: 0, msg: 'Already sent a moment ago.' });
      notified.add('manual:' + slug); notified.add(slug);
      const r = await sendAll(payloadFor(p));
      lastSent = Date.now(); say('Sent "' + clip(p.title, 40) + '" to ' + r.sent + ' device(s) (manual)');
      res.json({ ok: true, sent: r.sent, failed: r.failed, msg: r.msg });
    } catch (e) { res.status(502).json({ ok: false, msg: e.message }); }
  });
}
function start() {
  if (started) return; started = true;
  loadSubs();
  setInterval(flush, 60000).unref();
}
module.exports = { register, start, notifyNew, addSub, payloadFor, bigImg, _subs: subs, _flush: flush };
