'use strict';
const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ quiet: true }); } catch (e) { /* dotenv optional */ }

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function rest(method, table, { query = '', body, prefer } = {}) {
  if (!SB_URL || !SB_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  const r = await fetch(SB_URL + '/rest/v1/' + table + (query ? '?' + query : ''), {
    method,
    headers: Object.assign({ apikey: SB_KEY, 'Content-Type': 'application/json' }, SB_KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + SB_KEY } : {}, prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(method + ' ' + table + ' -> HTTP ' + r.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}
async function upsert(table, rows, conflict, size = 100) {
  for (let i = 0; i < rows.length; i += size) {
    await rest('POST', table, { query: 'on_conflict=' + conflict, body: rows.slice(i, i + size), prefer: 'resolution=merge-duplicates,return=minimal' });
  }
}
async function insert(table, rows, size = 200) {
  for (let i = 0; i < rows.length; i += size) await rest('POST', table, { body: rows.slice(i, i + size), prefer: 'return=minimal' });
}
async function selectAll(table, order, size = 500) {
  const out = [];
  for (let off = 0; ; off += size) {
    const page = await rest('GET', table, { query: 'select=*&order=' + order + '&limit=' + size + '&offset=' + off });
    out.push(...page);
    if (page.length < size) break;
  }
  return out;
}

const num = (v, d = 0) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? Math.trunc(n) : d; };
const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const txt = (v) => (v == null ? null : String(v));
const catSlug = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const pick = (o, known) => { const rest = {}; for (const k of Object.keys(o)) if (!known.includes(k)) rest[k] = o[k]; return rest; };

const POST_KNOWN = ['title', 'slug', 'category', 'excerpt', 'content', 'coverImage', 'musicFile', 'videoFile', 'date', 'createdAt', 'views', 'downloads', 'audioDownloads', 'videoDownloads', 'reactions', 'comments', 'pinned', 'sourceUrl', 'source', 'auto'];
const SONG_KNOWN = ['id', 'title', 'artistId', 'type', 'excerpt', 'downloadUrl', 'youtubeUrl', 'cover', 'slug', 'createdAt', 'album', 'trackNumber', 'downloads', 'albumId', 'albumCover', 'year', 'genre'];
const ARTIST_KNOWN = ['id', 'name', 'genre', 'bio', 'slug', 'photo', 'createdAt'];
const HANDLED = ['posts', 'songs', 'artists', 'countryViews', 'views', 'articles', 'admin'];
const secretish = (k) => /(token|secret|key|password)$/i.test(k);

function toRows(doc) {
  const fatal = [], warn = [];
  const T = { categories: [], artists: [], songs: [], posts: [], comments: [], replies: [], country_views: [], page_views: [], site_settings: [], site_secrets: [], admin_users: [] };
  const dupCheck = (label, list) => { const seen = new Set(); for (const v of list) { if (seen.has(v)) fatal.push('duplicate ' + label + ': ' + v); seen.add(v); } };

  (doc.artists || []).forEach((a, i) => {
    if (!isObj(a) || a.id == null) return fatal.push('artist #' + i + ' has no id');
    T.artists.push({ id: String(a.id), name: txt(a.name), genre: txt(a.genre), bio: txt(a.bio), slug: txt(a.slug), photo: txt(a.photo), created_at_ms: numOrNull(a.createdAt), legacy_pos: i, extra: pick(a, ARTIST_KNOWN) });
  });
  dupCheck('artist id', T.artists.map((a) => a.id));
  dupCheck('artist slug', T.artists.map((a) => a.slug).filter(Boolean));
  const artistIds = new Set(T.artists.map((a) => a.id));

  (doc.songs || []).forEach((s, i) => {
    if (!isObj(s) || s.id == null) return fatal.push('song #' + i + ' has no id');
    const extra = pick(s, SONG_KNOWN);
    let artist_id = s.artistId == null ? null : String(s.artistId);
    if (artist_id !== null && !artistIds.has(artist_id)) { extra.orphanArtistId = s.artistId; artist_id = null; warn.push('song ' + s.id + ' points to missing artist ' + s.artistId + ' (kept in extra)'); }
    T.songs.push({ id: String(s.id), title: txt(s.title), artist_id, type: txt(s.type), excerpt: txt(s.excerpt), download_url: txt(s.downloadUrl), youtube_url: txt(s.youtubeUrl), cover: txt(s.cover), slug: txt(s.slug), created_at_ms: numOrNull(s.createdAt), album: txt(s.album), track_number: numOrNull(s.trackNumber), downloads: num(s.downloads), album_id: txt(s.albumId), album_cover: txt(s.albumCover), year: txt(s.year), genre: txt(s.genre), legacy_pos: i, extra });
  });
  dupCheck('song id', T.songs.map((s) => s.id));
  dupCheck('song slug', T.songs.map((s) => s.slug).filter(Boolean));

  const cats = new Map();
  const commentIds = [];
  (doc.posts || []).forEach((p, i) => {
    if (!isObj(p) || !p.slug) return fatal.push('post #' + i + ' has no slug');
    const slug = String(p.slug);
    T.posts.push({ slug, title: txt(p.title) || '', category: txt(p.category), excerpt: txt(p.excerpt), content: txt(p.content), cover_image: txt(p.coverImage), music_file: txt(p.musicFile), video_file: txt(p.videoFile), date_label: txt(p.date), created_at_ms: numOrNull(p.createdAt), views: num(p.views), downloads: num(p.downloads), audio_downloads: num(p.audioDownloads), video_downloads: num(p.videoDownloads), reactions: isObj(p.reactions) ? p.reactions : {}, pinned: !!p.pinned, source_url: txt(p.sourceUrl), source: p.source === undefined ? null : p.source, auto: p.auto === undefined ? null : p.auto, legacy_pos: i, extra: pick(p, POST_KNOWN) });
    if (p.category) { const cs = catSlug(p.category); if (!cats.has(cs)) cats.set(cs, new Map()); const m = cats.get(cs); m.set(p.category, (m.get(p.category) || 0) + 1); }
    (Array.isArray(p.comments) ? p.comments : []).forEach((c, ci) => {
      if (!isObj(c)) return;
      const cid = c.id != null ? String(c.id) : 'c-' + slug + '-' + ci;
      commentIds.push(cid);
      T.comments.push({ id: cid, post_slug: slug, parent_id: null, pos: ci, name: txt(c.name), body: txt(c.text), ts_ms: numOrNull(c.ts), likes: num(c.likes), extra: pick(c, ['id', 'name', 'text', 'ts', 'likes', 'replies']) });
      (Array.isArray(c.replies) ? c.replies : []).forEach((r, ri) => {
        if (!isObj(r)) return;
        const rid = r.id != null ? String(r.id) : 'r-' + cid + '-' + ri;
        commentIds.push(rid);
        T.replies.push({ id: rid, post_slug: slug, parent_id: cid, pos: ri, name: txt(r.name), body: txt(r.text), ts_ms: numOrNull(r.ts), likes: num(r.likes), extra: pick(r, ['id', 'name', 'text', 'ts', 'likes']) });
      });
    });
  });
  dupCheck('post slug', T.posts.map((p) => p.slug));
  dupCheck('comment/reply id', commentIds);
  for (const [slug, m] of cats) T.categories.push({ slug, name: [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] });

  Object.entries(isObj(doc.countryViews) ? doc.countryViews : {}).forEach(([c, n]) => T.country_views.push({ country: c, views: num(n) }));
  (Array.isArray(doc.views) ? doc.views : []).forEach((v) => T.page_views.push({ path: txt(v && v.path), ip: txt(v && v.ip), country: txt(v && v.country), time_ms: numOrNull(v && v.time) }));
  if (isObj(doc.admin)) T.admin_users.push({ username: String(doc.admin.username || 'admin'), credential: txt(doc.admin.password), credential_kind: String(doc.admin.password || '').startsWith('$2') ? 'bcrypt' : 'unknown', extra: pick(doc.admin, ['username', 'password']) });
  for (const [k, v] of Object.entries(doc)) {
    if (HANDLED.includes(k)) continue;
    (secretish(k) ? T.site_secrets : T.site_settings).push({ key: k, value: v });
  }
  if (Array.isArray(doc.articles) && doc.articles.length) { T.site_settings.push({ key: 'articles', value: doc.articles }); warn.push('articles is not empty (' + doc.articles.length + '); stored as a setting'); }
  return { T, fatal, warn };
}

const dropNull = (o) => { for (const k of Object.keys(o)) if (o[k] === null) delete o[k]; return o; };
function fromRows(R) {
  const doc = {};
  const kids = new Map();
  for (const c of R.post_comments || []) { if (!kids.has(c.post_slug)) kids.set(c.post_slug, []); kids.get(c.post_slug).push(c); }
  const byPos = (a, b) => a.pos - b.pos;
  doc.posts = (R.posts || []).map((r) => {
    const all = kids.get(r.slug) || [];
    const tops = all.filter((c) => !c.parent_id).sort(byPos);
    const comments = tops.map((c) => Object.assign({ id: c.id, name: c.name, text: c.body, ts: c.ts_ms, likes: c.likes, replies: all.filter((x) => x.parent_id === c.id).sort(byPos).map((x) => Object.assign({ id: x.id, name: x.name, text: x.body, ts: x.ts_ms, likes: x.likes }, x.extra || {})) }, c.extra || {}));
    const o = { title: r.title, slug: r.slug, category: r.category, excerpt: r.excerpt, content: r.content, coverImage: r.cover_image, musicFile: r.music_file, videoFile: r.video_file, date: r.date_label, createdAt: r.created_at_ms, views: r.views, downloads: r.downloads, audioDownloads: r.audio_downloads, videoDownloads: r.video_downloads, reactions: r.reactions || {}, pinned: r.pinned, sourceUrl: r.source_url, source: r.source, auto: r.auto };
    if (comments.length) o.comments = comments;
    return Object.assign(dropNull(o), r.extra || {});
  });
  doc.songs = (R.songs || []).map((r) => {
    const extra = Object.assign({}, r.extra || {});
    let artistId = r.artist_id;
    if (artistId == null && extra.orphanArtistId !== undefined) { artistId = extra.orphanArtistId; delete extra.orphanArtistId; }
    return Object.assign(dropNull({ id: r.id, title: r.title, artistId, type: r.type, excerpt: r.excerpt, downloadUrl: r.download_url, youtubeUrl: r.youtube_url, cover: r.cover, slug: r.slug, createdAt: r.created_at_ms, album: r.album, trackNumber: r.track_number, downloads: r.downloads, albumId: r.album_id, albumCover: r.album_cover, year: r.year, genre: r.genre }), extra);
  });
  doc.artists = (R.artists || []).map((r) => Object.assign(dropNull({ id: r.id, name: r.name, genre: r.genre, bio: r.bio, slug: r.slug, photo: r.photo, createdAt: r.created_at_ms }), r.extra || {}));
  doc.countryViews = {}; for (const r of R.country_views || []) doc.countryViews[r.country] = r.views;
  doc.views = (R.page_views || []).map((r) => ({ path: r.path, ip: r.ip, country: r.country, time: r.time_ms }));
  doc.articles = [];
  const a = (R.admin_users || [])[0]; if (a) doc.admin = Object.assign({ username: a.username, password: a.credential }, a.extra || {});
  for (const r of [...(R.site_settings || []), ...(R.site_secrets || [])]) doc[r.key] = r.value;
  return doc;
}

const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : isObj(v) ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {}) : v;
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function canonComment(c) { return { id: String(c.id), name: txt(c.name), text: txt(c.text), ts: numOrNull(c.ts), likes: num(c.likes), replies: (c.replies || []).map((r) => ({ id: String(r.id), name: txt(r.name), text: txt(r.text), ts: numOrNull(r.ts), likes: num(r.likes), extra: pick(r, ['id', 'name', 'text', 'ts', 'likes']) })), extra: pick(c, ['id', 'name', 'text', 'ts', 'likes', 'replies']) }; }
const canon = {
  posts: (p) => ({ slug: p.slug, title: txt(p.title) || '', category: txt(p.category), excerpt: txt(p.excerpt), content: txt(p.content), coverImage: txt(p.coverImage), musicFile: txt(p.musicFile), videoFile: txt(p.videoFile), date: txt(p.date), createdAt: numOrNull(p.createdAt), views: num(p.views), downloads: num(p.downloads), audioDownloads: num(p.audioDownloads), videoDownloads: num(p.videoDownloads), reactions: isObj(p.reactions) ? p.reactions : {}, pinned: !!p.pinned, sourceUrl: txt(p.sourceUrl), source: p.source === undefined ? null : p.source, auto: p.auto === undefined ? null : p.auto, comments: (Array.isArray(p.comments) ? p.comments : []).filter(isObj).map(canonComment), extra: pick(p, POST_KNOWN) }),
  songs: (s) => ({ id: String(s.id), title: txt(s.title), artistId: txt(s.artistId), type: txt(s.type), excerpt: txt(s.excerpt), downloadUrl: txt(s.downloadUrl), youtubeUrl: txt(s.youtubeUrl), cover: txt(s.cover), slug: txt(s.slug), createdAt: numOrNull(s.createdAt), album: txt(s.album), trackNumber: numOrNull(s.trackNumber), downloads: num(s.downloads), albumId: txt(s.albumId), albumCover: txt(s.albumCover), year: txt(s.year), genre: txt(s.genre), extra: pick(s, SONG_KNOWN) }),
  artists: (a) => ({ id: String(a.id), name: txt(a.name), genre: txt(a.genre), bio: txt(a.bio), slug: txt(a.slug), photo: txt(a.photo), createdAt: numOrNull(a.createdAt), extra: pick(a, ARTIST_KNOWN) }),
  views: (v) => ({ path: txt(v && v.path), ip: txt(v && v.ip), country: txt(v && v.country), time: numOrNull(v && v.time) })
};
function diffList(label, a, b, keyOf) {
  const out = [];
  if (a.length !== b.length) out.push(label + ': count differs (original ' + a.length + ' vs supabase ' + b.length + ')');
  for (let i = 0; i < Math.min(a.length, b.length) && out.length < 10; i++) {
    if (!same(a[i], b[i])) {
      const fields = [...new Set([...Object.keys(a[i]), ...Object.keys(b[i])])].filter((k) => !same(a[i][k], b[i][k]));
      out.push(label + ' #' + i + ' (' + keyOf(a[i]) + '): differs in ' + fields.join(', '));
    }
  }
  return out;
}

function newestBackup() {
  const dir = path.join(process.cwd(), 'backups');
  const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /^full-.*\.json$/.test(x)).sort().pop() : null;
  if (!f) throw new Error('No backups/full-*.json found. Run the backup step first.');
  return path.join(dir, f);
}
function loadBackup(file) {
  let d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (d && d.record) d = d.record;
  if (!isObj(d) || !Array.isArray(d.posts)) throw new Error('Backup does not look like the PulseWire database: ' + file);
  return d;
}
module.exports = { rest, upsert, insert, selectAll, toRows, fromRows, canon, same, diffList, newestBackup, loadBackup, isObj };
