// Team accounts: extra admins sign in with email + password and get their own author profile.
// Passwords are scrambled (scrypt) with a secret that is NOT in your database, so a copy of the database cannot be cracked.
const crypto = require('crypto');
const express = require('express');

const BIN_ID = '6aa50e3aac6210605ac3c542';
const DB_BASE = 'https://wavzo-db.dakudinamoses.workers.dev/v3/b/' + BIN_ID;
const MASTER = () => process.env.WZ_DB_KEY || '';
const SECRET = () => process.env.WZ_TEAM_SECRET || '';
const hm = (label) => crypto.createHmac('sha256', SECRET()).update(label).digest();
const J = express.json({ limit: '14mb' });

async function dbGet(key) {
  const r = await fetch(DB_BASE + '/latest', { headers: { 'X-Master-Key': key || 'public' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('database read failed (' + r.status + ')');
  const j = await r.json(), doc = j && j.record;
  if (!doc || typeof doc !== 'object') throw new Error('database returned empty data, stopped so nothing is overwritten');
  doc.posts = doc.posts || []; doc.songs = doc.songs || []; doc.artists = doc.artists || []; doc.authors = doc.authors || []; doc.team = doc.team || [];
  return doc;
}
async function dbPut(doc, key) {
  const r = await fetch(DB_BASE, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Master-Key': key }, body: JSON.stringify(doc), signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error('database save failed (' + r.status + ')');
}

// ---- passwords, emails, tokens ----
const emailKey = (e) => crypto.createHmac('sha256', hm('email')).update(String(e).trim().toLowerCase()).digest('hex');
const hashPw = (pw, saltHex) => crypto.scryptSync(String(pw), Buffer.concat([Buffer.from(saltHex, 'hex'), hm('pw')]), 64, { N: 16384, r: 8, p: 1 }).toString('hex');
const maskEmail = (e) => { const [a, b] = String(e).trim().toLowerCase().split('@'); return (a.slice(0, 2) + '***@' + (b || '')); };
const b64u = (b) => Buffer.from(b).toString('base64url');
function signToken(payload) { const p = b64u(JSON.stringify(payload)); return p + '.' + crypto.createHmac('sha256', hm('token')).update(p).digest('base64url'); }
function readToken(tok) {
  const [p, sig] = String(tok || '').split('.');
  if (!p || !sig || !SECRET()) return null;
  const want = crypto.createHmac('sha256', hm('token')).update(p).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o && o.exp > Date.now() ? o : null; } catch (e) { return null; }
}
const bearer = (req) => String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
const isOwner = (req) => { const k = MASTER(), h = String(req.get('x-master-key') || ''); return !!k && h.length === k.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(k)); };
const pub = (u) => ({ id: u.id, name: u.name, title: u.title || '', bio: u.bio || '', photo: u.photo || '', role: u.role, active: u.active !== false, emailMask: u.emailMask, created: u.created });

// ---- login attempts: 5 tries per 10 minutes per person ----
const tries = new Map();
function tooMany(k, max) { const n = Date.now(), t = (tries.get(k) || []).filter((x) => n - x < 600000); tries.set(k, t); return t.length >= (max || 5); }
const noteTry = (k) => { const t = tries.get(k) || []; t.push(Date.now()); tries.set(k, t); };
const ipOf = (req) => String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

// ---- safe merging, so two people saving at the same time never wipe each other out ----
const KEYS = { posts: (p) => p.slug, songs: (s) => s.id || s.slug, artists: (a) => a.id || a.slug };
function merge3(base, cur, inc, keyFn) {
  const bm = new Map((base || []).map((x) => [keyFn(x), x])), cm = new Map((cur || []).map((x) => [keyFn(x), x])), im = new Map((inc || []).map((x) => [keyFn(x), x]));
  const out = new Map(cm);
  for (const [k, v] of im) { const b = bm.get(k); if (!b || JSON.stringify(b) !== JSON.stringify(v)) out.set(k, v); }
  for (const k of bm.keys()) if (!im.has(k)) out.delete(k);
  const res = [], seen = new Set();
  for (const x of (cur || [])) { const k = keyFn(x); if (out.has(k) && !seen.has(k)) { res.push(out.get(k)); seen.add(k); } }
  for (const x of (inc || [])) { const k = keyFn(x); if (out.has(k) && !seen.has(k)) { res.push(out.get(k)); seen.add(k); } }
  return res;
}
const snaps = new Map();
const hashOf = (d) => crypto.createHash('sha1').update(JSON.stringify([d.posts, d.songs, d.artists])).digest('hex');
function keepSnap(d) { const h = hashOf(d); snaps.set(h, { t: Date.now(), posts: d.posts, songs: d.songs, artists: d.artists }); for (const [k, v] of snaps) if (Date.now() - v.t > 1800000) snaps.delete(k); while (snaps.size > 8) snaps.delete(snaps.keys().next().value); return h; }
const SECRETS = ['team', 'pushSubs', 'autopost', 'push'];
const OWNER_FIELDS = ['authorId', 'authorName', 'authorPhoto', 'authorBio', 'pinned', 'auto', 'sourceUrl', 'source', 'createdBy'];

function applyEditorSave(cur, snap, inc, user) {
  const next = Object.assign({}, cur);
  for (const k of ['posts', 'songs', 'artists']) if (Array.isArray(inc[k])) next[k] = merge3(snap[k], cur[k], inc[k], KEYS[k]);
  const before = new Map((cur.posts || []).map((p) => [p.slug, p]));
  next.posts = next.posts.map((p) => {
    const old = before.get(p.slug), q = Object.assign({}, p);
    if (!old) { // a new post: it is stamped with the editor's own name, whatever the page says
      delete q.pinned; delete q.auto; delete q.sourceUrl; delete q.source;
      q.authorId = user.id; q.authorName = user.name; q.createdBy = user.id;
      if (user.photo) q.authorPhoto = user.photo; else delete q.authorPhoto;
      const bio = ((user.title ? user.title + '. ' : '') + (user.bio || '')).trim(); if (bio) q.authorBio = bio; else delete q.authorBio;
      return q;
    }
    for (const f of OWNER_FIELDS) { if (f in old) q[f] = old[f]; else delete q[f]; }
    return q;
  });
  return next;
}

function register(app) {
  const need = (res) => { if (!SECRET()) { res.status(400).json({ ok: false, msg: 'Server is missing WZ_TEAM_SECRET (see the setup steps).' }); return true; } if (!MASTER()) { res.status(400).json({ ok: false, msg: 'Server is missing WZ_DB_KEY.' }); return true; } return false; };
  app.get('/admin/team/status', (req, res) => res.json({ secretSet: !!SECRET(), keySet: !!MASTER() }));

  app.post('/admin/team/login', J, async (req, res) => {
    if (need(res)) return;
    const email = String((req.body && req.body.email) || '').trim().toLowerCase(), pw = String((req.body && req.body.password) || '');
    const k = ipOf(req) + '|' + email;
    if (tooMany(k, 5) || tooMany(ipOf(req) + '|*', 30)) return res.status(429).json({ ok: false, msg: 'Too many tries. Wait 10 minutes.' });
    try {
      const doc = await dbGet(MASTER()), ek = emailKey(email);
      const u = doc.team.find((x) => x.emailKey === ek);
      const salt = u ? u.salt : crypto.randomBytes(16).toString('hex'), got = hashPw(pw, salt); // always do the work, so timing reveals nothing
      const ok = !!u && u.active !== false && u.hash.length === got.length && crypto.timingSafeEqual(Buffer.from(u.hash), Buffer.from(got));
      if (!ok) { noteTry(k); noteTry(ipOf(req) + '|*'); return res.status(401).json({ ok: false, msg: 'Wrong email or password.' }); }
      res.json({ ok: true, token: signToken({ id: u.id, exp: Date.now() + 12 * 3600e3 }), user: pub(u) });
    } catch (e) { res.status(502).json({ ok: false, msg: 'Could not reach the database. Try again.' }); }
  });

  async function who(req, res) {
    if (need(res)) return null;
    const t = readToken(bearer(req));
    if (!t) { res.status(401).json({ ok: false, msg: 'Please sign in again.' }); return null; }
    const doc = await dbGet(MASTER()), u = doc.team.find((x) => x.id === t.id && x.active !== false);
    if (!u) { res.status(401).json({ ok: false, msg: 'This account is no longer active.' }); return null; }
    return { doc, u };
  }
  app.get('/admin/team/db', async (req, res) => {
    try {
      const w = await who(req, res); if (!w) return;
      const out = {}; for (const k of Object.keys(w.doc)) if (!SECRETS.includes(k)) out[k] = w.doc[k];
      res.set('Cache-Control', 'no-store').json({ ok: true, doc: out, base: keepSnap(w.doc), me: pub(w.u) });
    } catch (e) { res.status(502).json({ ok: false, msg: e.message }); }
  });
  app.put('/admin/team/db', J, async (req, res) => {
    try {
      const w = await who(req, res); if (!w) return;
      const inc = req.body && req.body.doc, snap = snaps.get(String((req.body && req.body.base) || ''));
      if (!inc || typeof inc !== 'object') return res.status(400).json({ ok: false, msg: 'Nothing to save.' });
      if (!snap) return res.status(409).json({ ok: false, reload: true, msg: 'Your page was out of date. It was refreshed, so please repeat your last step.' });
      const next = applyEditorSave(w.doc, snap, inc, w.u);
      await dbPut(next, MASTER());
      res.json({ ok: true, base: keepSnap(next) });
    } catch (e) { res.status(502).json({ ok: false, msg: e.message }); }
  });

  // ---- owner only (your admin password) ----
  const owner = (req, res) => { if (need(res)) return false; if (!isOwner(req)) { res.status(401).json({ ok: false, msg: 'Wrong key. WZ_DB_KEY must equal your admin password.' }); return false; } return true; };
  app.get('/admin/team/list', async (req, res) => {
    if (!owner(req, res)) return;
    try { res.json({ ok: true, team: (await dbGet(MASTER())).team.map(pub) }); } catch (e) { res.status(502).json({ ok: false, msg: e.message }); }
  });
  app.post('/admin/team/create', J, async (req, res) => {
    if (!owner(req, res)) return;
    try {
      const b = req.body || {}, email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 60), pw = String(b.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, msg: 'Enter a valid email address.' });
      if (!name) return res.status(400).json({ ok: false, msg: 'Enter the name.' });
      if (pw.length < 8 || pw.length > 100) return res.status(400).json({ ok: false, msg: 'The password must be 8 to 100 characters.' });
      const doc = await dbGet(MASTER()), ek = emailKey(email);
      if (doc.team.some((x) => x.emailKey === ek)) return res.status(409).json({ ok: false, msg: 'That email already has an account.' });
      const id = 'tm-' + crypto.randomBytes(5).toString('hex'), salt = crypto.randomBytes(16).toString('hex');
      const photo = /^https:\/\//i.test(b.photo || '') ? String(b.photo) : '';
      const u = { id, name, title: String(b.title || '').slice(0, 60), bio: String(b.bio || '').slice(0, 240), photo, role: 'editor', emailKey: ek, emailMask: maskEmail(email), salt, hash: hashPw(pw, salt), active: true, created: Date.now() };
      doc.team.push(u);
      doc.authors.push({ id, name, title: u.title, bio: u.bio, photo });
      await dbPut(doc, MASTER());
      res.json({ ok: true, user: pub(u) });
    } catch (e) { res.status(502).json({ ok: false, msg: e.message }); }
  });
  app.post('/admin/team/update', J, async (req, res) => {
    if (!owner(req, res)) return;
    try {
      const b = req.body || {}, doc = await dbGet(MASTER()), u = doc.team.find((x) => x.id === b.id);
      if (!u) return res.status(404).json({ ok: false, msg: 'Not found.' });
      if (b.password) { if (String(b.password).length < 8) return res.status(400).json({ ok: false, msg: 'The password must be at least 8 characters.' }); u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPw(b.password, u.salt); }
      if (typeof b.active === 'boolean') u.active = b.active;
      for (const f of ['name', 'title', 'bio']) if (typeof b[f] === 'string') u[f] = b[f].slice(0, f === 'bio' ? 240 : 60);
      if (typeof b.photo === 'string') u.photo = /^https:\/\//i.test(b.photo) ? b.photo : '';
      const a = doc.authors.find((x) => x.id === u.id);
      if (a) { a.name = u.name; a.title = u.title; a.bio = u.bio; a.photo = u.photo; }
      await dbPut(doc, MASTER());
      res.json({ ok: true, user: pub(u) });
    } catch (e) { res.status(502).json({ ok: false, msg: e.message }); }
  });
  app.post('/admin/team/delete', J, async (req, res) => {
    if (!owner(req, res)) return;
    try {
      const doc = await dbGet(MASTER()), n = doc.team.length;
      doc.team = doc.team.filter((x) => x.id !== (req.body && req.body.id));
      if (doc.team.length === n) return res.status(404).json({ ok: false, msg: 'Not found.' });
      await dbPut(doc, MASTER());
      res.json({ ok: true });
    } catch (e) { res.status(502).json({ ok: false, msg: e.message }); }
  });
}
module.exports = { register, readToken, signToken, merge3, applyEditorSave, emailKey, hashPw, _snaps: snaps, userFromRequest: async (req) => { const t = readToken(bearer(req)); if (!t) return null; const doc = await dbGet(MASTER()); return doc.team.find((x) => x.id === t.id && x.active !== false) || null; }, isOwner };
