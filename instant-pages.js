// INSTANT PAGES: builds post / song / artist pages on demand from the live database,
// so a new item has a working, crawlable address the moment it is published.
const fs = require('fs');
const path = require('path');
const DB_URL = 'https://wavzo-db.dakudinamoses.workers.dev/v3/b/main/latest';
const SITE = 'https://wavzo.com.ng';
let cache = { t: 0, doc: null };

async function getDoc(maxAgeMs) {
  if (cache.doc && Date.now() - cache.t < maxAgeMs) return cache.doc;
  const r = await fetch(DB_URL, { headers: { 'X-Master-Key': 'public' } });
  if (!r.ok) throw new Error('database returned ' + r.status);
  const j = await r.json();
  cache = { t: Date.now(), doc: j.record || {} };
  return cache.doc;
}
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const js = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const attr = (s, n) => esc(String(s || '').slice(0, n).replace(/"/g, "'"));
const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const put = (tpl, from, to) => tpl.split(from).join(to); // no special replacement patterns

function head(o) {
  return '<title>' + o.title + '</title>\n  <meta name="description" content="' + o.desc + '">\n  <link rel="canonical" href="' + o.url + '">\n' +
    '  <meta property="og:type" content="' + o.type + '">\n  <meta property="og:title" content="' + o.ogTitle + '">\n  <meta property="og:description" content="' + o.desc + '">\n' +
    '  <meta property="og:image" content="' + o.image + '">\n  <meta property="og:url" content="' + o.url + '">\n  <meta name="twitter:card" content="summary_large_image">\n' +
    '  <meta name="twitter:title" content="' + o.ogTitle + '">\n  <meta name="twitter:description" content="' + o.desc + '">\n  <meta name="twitter:image" content="' + o.image + '">';
}
const safeId = (v) => String(v == null ? '' : v).replace(/[^\w.-]/g, '');

function renderPost(doc, post) {
  const slug = safeId(post.slug);
  const url = SITE + '/posts/' + slug + '.html';
  let page = put(read('post.html'), '<title>WAVZO</title>', head({
    title: esc(post.title || 'WAVZO') + ' — WAVZO', desc: attr(post.excerpt, 200), url, type: 'article',
    ogTitle: esc(post.title || 'WAVZO'), image: esc(post.coverImage || SITE + '/images/default-cover.jpg')
  }));
  page = put(page, "let slug=new URLSearchParams(window.location.search).get('slug');", "const slug='" + slug + "';");
  const same = (doc.posts || []).filter((p) => p.slug !== post.slug && p.category === post.category).slice(-3)
    .map((p) => ({ slug: p.slug, title: p.title, category: p.category, coverImage: p.coverImage, date: p.date }));
  return put(page, "const CACHE_KEY='pw_posts';", "const CACHE_KEY='pw_posts';\nconst PREPOST=" + js({ post, related: same }) + ';');
}
function renderSong(doc, song) {
  const artist = (doc.artists || []).find((a) => a.id === song.artistId) || {};
  const aname = artist.name || 'WAVZO', slug = safeId(song.slug), title = song.title || 'Song';
  const url = SITE + '/songs/' + slug + '.html';
  let page = put(read('song.html'), '<title>WAVZO</title>', head({
    title: esc(title) + ' — ' + esc(aname) + ' | WAVZO', desc: attr(song.excerpt || (title + ' by ' + aname), 200), url, type: 'music.song',
    ogTitle: esc(title) + ' — ' + esc(aname), image: esc(song.cover || SITE + '/images/default-cover.jpg')
  }));
  page = put(page, "const songId='__SONG_ID__';", "const songId='" + safeId(song.id) + "';");
  const pre = js({ song, artist: artist.id ? artist : null, titles: (doc.posts || []).slice(0, 6).map((p) => p.title || '') });
  return put(page, "const songId='" + safeId(song.id) + "';", "const songId='" + safeId(song.id) + "';\nconst PRE=" + pre + ';');
}
function renderArtist(doc, artist) {
  const slug = safeId(artist.slug), name = artist.name || 'Artist';
  const url = SITE + '/artists/' + slug + '.html';
  let page = put(read('artist.html'), '<title>WAVZO</title>', head({
    title: esc(name) + ' — WAVZO', desc: attr(artist.bio, 200), url, type: 'profile', ogTitle: esc(name) + ' — WAVZO',
    image: esc(artist.photo || SITE + '/images/default-cover.jpg')
  }));
  page = put(page, "const artistId='__ARTIST_ID__';", "const artistId='" + safeId(artist.id) + "';");
  const songs = (doc.songs || []).filter((s) => s.artistId === artist.id);
  const pre = js({ artist, songs, titles: (doc.posts || []).slice(0, 6).map((p) => p.title || '') });
  return put(page, "const artistId='" + safeId(artist.id) + "';", "const artistId='" + safeId(artist.id) + "';\nconst PREART=" + pre + ';');
}

const LISTS = { post: 'posts', song: 'songs', artist: 'artists' };
const RENDER = { post: renderPost, song: renderSong, artist: renderArtist };
async function page(kind, slug) {
  let doc = await getDoc(30000);
  let item = (doc[LISTS[kind]] || []).find((x) => x && x.slug === slug);
  if (!item && Date.now() - cache.t > 4000) {          // maybe it was just published: look again
    doc = await getDoc(0);
    item = (doc[LISTS[kind]] || []).find((x) => x && x.slug === slug);
  }
  return item ? RENDER[kind](doc, item) : null;
}
const day = (ms) => { const d = new Date(ms); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
async function sitemap() {
  const doc = await getDoc(60000);
  const rows = [[SITE + '/', ''], [SITE + '/artists.html', '']];
  for (const p of doc.posts || []) if (p.slug) rows.push([SITE + '/posts/' + p.slug + '.html', day(p.createdAt)]);
  for (const s of doc.songs || []) if (s.slug) rows.push([SITE + '/songs/' + s.slug + '.html', day(s.createdAt)]);
  for (const a of doc.artists || []) if (a.slug) rows.push([SITE + '/artists/' + a.slug + '.html', day(a.createdAt)]);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.map(([u, d]) => '  <url><loc>' + esc(u) + '</loc>' + (d ? '<lastmod>' + d + '</lastmod>' : '') + '</url>').join('\n') + '\n</urlset>\n';
}
async function dbJson() {
  const doc = await getDoc(20000);
  return { posts: doc.posts || [], songs: doc.songs || [], artists: doc.artists || [] };
}
function handler(kind) {
  return async (req, res, next) => {
    try {
      const slug = String(req.params.slug || '').replace(/\.html$/, '');
      if (!/^[\w.%-]{1,160}$/.test(slug)) return next();
      const html = await page(kind, decodeURIComponent(slug));
      if (!html) return next();
      res.set('Cache-Control', 'public, max-age=60').type('html').send(html);
    } catch (e) { next(); }
  };
}
module.exports = { page, sitemap, dbJson, handler, _cache: () => cache, _reset: () => { cache = { t: 0, doc: null }; } };
