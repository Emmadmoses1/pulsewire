// INSTANT PAGES: builds post / song / artist pages on demand from the live database,
// so a new item has a working, crawlable address the moment it is published.
const fs = require('fs');
const path = require('path');
const DB_URL = 'https://wavzo-db.dakudinamoses.workers.dev/v3/b/main/latest';
const SITE = 'https://wavzo.com.ng';
let cache = { t: 0, doc: null };

let inflight = null;
function refreshDoc() {
  if (inflight) return inflight;
  inflight = (async () => {
    const r = await fetch(DB_URL, { headers: { 'X-Master-Key': 'public' } });
    if (!r.ok) throw new Error('database returned ' + r.status);
    const j = await r.json();
    cache = { t: Date.now(), doc: j.record || {} };
    return cache.doc;
  })().finally(() => { inflight = null; });
  return inflight;
}
// Old data is served instantly while fresh data loads in the background
async function getDoc(maxAgeMs) {
  if (cache.doc && Date.now() - cache.t < maxAgeMs) return cache.doc;
  if (cache.doc && maxAgeMs > 0) { refreshDoc().catch(() => {}); return cache.doc; }
  return refreshDoc();
}
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const js = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const attr = (s, n) => esc(String(s || '').slice(0, n).replace(/"/g, "'"));
const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const put = (tpl, from, to) => tpl.split(from).join(to); // no special replacement patterns

function head(o) {
  return '<title>' + o.title + '</title>\n  <meta name="description" content="' + o.desc + '">\n  <link rel="canonical" href="' + o.url + '">\n' +
    '  <meta property="og:site_name" content="WAVZO">\n  <meta property="og:type" content="' + o.type + '">\n  <meta property="og:title" content="' + o.ogTitle + '">\n  <meta property="og:description" content="' + o.desc + '">\n' +
    '  <meta property="og:image" content="' + o.image + '">\n  <meta property="og:image:secure_url" content="' + o.image + '">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">\n  <meta property="og:image:alt" content="' + o.ogTitle + '">\n' +
    '  <meta property="og:url" content="' + o.url + '">\n  <meta name="twitter:card" content="summary_large_image">\n' +
    '  <meta name="twitter:title" content="' + o.ogTitle + '">\n  <meta name="twitter:description" content="' + o.desc + '">\n  <meta name="twitter:image" content="' + o.image + '">\n  <meta name="twitter:image:alt" content="' + o.ogTitle + '">' +
    (o.robots ? '\n  <meta name="robots" content="' + o.robots + '">' : '') +
    (o.ld ? '\n  <script type="application/ld+json">' + js(o.ld) + '</script>' : '');
}
const DEFAULT_IMG = SITE + '/images/wavzo-og-image.png';
// Share-ready image: always https, 1200x630, small enough for WhatsApp (< 300 KB)
function ogImage(u) {
  u = String(u == null ? '' : u).trim().replace(/&amp;/g, '&');
  if (!u || /^(none|null|undefined)$/i.test(u) || /^data:/i.test(u)) return DEFAULT_IMG;
  if (u.startsWith('//')) u = 'https:' + u;
  else if (u.startsWith('/')) u = SITE + u;
  if (!/^https?:\/\//i.test(u)) return DEFAULT_IMG;
  if (/^https?:\/\/res\.cloudinary\.com\//i.test(u) && u.indexOf('/image/upload/') > -1) {
    return u.replace('/image/upload/', '/image/upload/c_fill,g_auto,w_1200,h_630,q_auto,f_jpg/').replace(/^http:/, 'https:');
  }
  if (u.indexOf(SITE) === 0) return u;
  return 'https://wsrv.nl/?url=' + encodeURIComponent(u) + '&w=1200&h=630&fit=cover&output=jpg&q=80';
}
const plain = (h) => String(h == null ? '' : h).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const safeId = (v) => String(v == null ? '' : v).replace(/[^\w.-]/g, '');

function postLd(post, url) {
  const n = Number(post.createdAt);
  let d = new Date(isNaN(n) ? post.createdAt : n);
  if (isNaN(d)) d = new Date(post.date);
  const iso = isNaN(d) ? undefined : d.toISOString();
  return {
    '@context': 'https://schema.org', '@type': 'NewsArticle', mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    headline: String(post.title || 'WAVZO').slice(0, 110), description: String(post.excerpt || plain(post.content)).slice(0, 200),
    image: [ogImage(post.coverImage)], datePublished: iso, dateModified: iso,
    author: { '@type': 'Organization', name: 'WAVZO', url: SITE },
    publisher: { '@type': 'Organization', name: 'WAVZO', logo: { '@type': 'ImageObject', url: SITE + '/images/wavzo-icon-512.png' } }
  };
}
// ---- Search quality rules: only strong, unique posts are offered to Google ----
const SEO_MIN_TEXT = 300; // posts with less text (and no audio/video) are kept for readers but hidden from Google
const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hasMedia = (p) => [p.musicFile, p.videoFile].some((v) => v && v !== 'None');
const textLen = (p) => plain(p.content).length;
let seoDoc = null, seoBest = null;
function seoBestMap(doc) {
  if (seoDoc === doc && seoBest) return seoBest;
  const best = new Map();
  for (const p of doc.posts || []) {
    if (!p || !p.slug) continue;
    const k = normTitle(p.title);
    if (!k) continue;
    const cur = best.get(k);
    const better = !cur || textLen(p) > textLen(cur) ||
      (textLen(p) === textLen(cur) && (Number(p.createdAt) || 0) < (Number(cur.createdAt) || 0));
    if (better) best.set(k, p);
  }
  seoDoc = doc; seoBest = best;
  return best;
}
function seoState(doc, post) {
  const main = seoBestMap(doc).get(normTitle(post.title));
  const dupOf = main && main.slug !== post.slug ? main.slug : null;
  const thin = !hasMedia(post) && textLen(post) < SEO_MIN_TEXT;
  return { dupOf, thin, index: !dupOf && !thin };
}
function ssrArticle(post, doc) {
  const cat = esc(post.category || ''), title = esc(post.title || '');
  const rel = (doc.posts || []).filter((p) => p.slug !== post.slug && p.category === post.category).slice(-3).reverse();
  return '<div class="article-breadcrumb"><a href="/">Home</a> <span>/</span> ' + cat + '</div>' +
    '<div class="article-cat-tag">' + cat + '</div><h1 class="article-title">' + title + '</h1>' +
    '<div class="views-bar"><span>📅 ' + esc(post.date || '') + '</span></div>' +
    (/^https?:\/\//i.test(post.coverImage || '') ? '<img src="' + esc(ogImage(post.coverImage)) + '" class="article-cover" alt="' + title + '">' : '') +
    '<div class="article-body">' + (post.content || '') + '</div>' +
    (rel.length ? '<div class="related-section"><h3 class="related-title">More from ' + cat + '</h3>' +
      rel.map((r) => '<p><a href="/posts/' + safeId(r.slug) + '.html">' + esc(r.title || '') + '</a></p>').join('') + '</div>' : '');
}
function renderPost(doc, post) {
  const slug = safeId(post.slug);
  const st = seoState(doc, post);
  const url = SITE + '/posts/' + (st.dupOf ? safeId(st.dupOf) : slug) + '.html';
  let page = put(read('post.html'), '<title>WAVZO</title>', head({
    title: esc(post.title || 'WAVZO') + ' — WAVZO', desc: attr(post.excerpt || plain(post.content), 200), url, type: 'article',
    ogTitle: esc(post.title || 'WAVZO'), image: esc(ogImage(post.coverImage)), ld: postLd(post, url), robots: st.thin && !st.dupOf ? 'noindex,follow' : ''
  }));
  page = put(page, "let slug=new URLSearchParams(window.location.search).get('slug');", "const slug='" + slug + "';");
  page = put(page, '<div class="article-inner" id="articleInner"></div>', '<div class="article-inner" id="articleInner">' + ssrArticle(post, doc) + '</div>');
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
    ogTitle: esc(title) + ' — ' + esc(aname), image: esc(ogImage(song.cover))
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
    image: esc(ogImage(artist.photo))
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
const day = (ms) => { const n = Number(ms); const d = new Date(isNaN(n) ? ms : n); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
async function sitemap() {
  const doc = await getDoc(60000);
  const rows = [[SITE + '/', ''], [SITE + '/artists.html', ''], [SITE + '/about.html', ''], [SITE + '/contact.html', ''], [SITE + '/dmca.html', ''], [SITE + '/privacy-policy.html', ''], [SITE + '/terms.html', '']];
  for (const p of doc.posts || []) if (p.slug && seoState(doc, p).index) rows.push([SITE + '/posts/' + p.slug + '.html', day(p.createdAt)]);
  for (const s of doc.songs || []) if (s.slug) rows.push([SITE + '/songs/' + s.slug + '.html', day(s.createdAt)]);
  for (const a of doc.artists || []) if (a.slug) rows.push([SITE + '/artists/' + a.slug + '.html', day(a.createdAt)]);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.map(([u, d]) => '  <url><loc>' + esc(u) + '</loc>' + (d ? '<lastmod>' + d + '</lastmod>' : '') + '</url>').join('\n') + '\n</urlset>\n';
}
async function dbJson() {
  const doc = await getDoc(20000);
  return { posts: doc.posts || [], songs: doc.songs || [], artists: doc.artists || [] };
}
// Small, compressed list for the home page (no article bodies): ~2 MB becomes ~100 KB
const crypto = require('crypto');
const zlib = require('zlib');
let homeFor = null, homeOut = null;
function homePayload(doc) {
  if (homeFor === doc && homeOut) return homeOut;
  const posts = (doc.posts || []).map((p) => {
    const rest = Object.assign({}, p);
    delete rest.content;
    rest.excerpt = String(p.excerpt || plain(p.content)).slice(0, 220);
    return rest;
  });
  const body = Buffer.from(JSON.stringify({ posts, songs: doc.songs || [], artists: doc.artists || [] }));
  homeOut = { body, gz: zlib.gzipSync(body, { level: 9 }), etag: '"' + crypto.createHash('md5').update(body).digest('hex').slice(0, 16) + '"' };
  homeFor = doc;
  return homeOut;
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
// Notifies search engines (IndexNow) about new posts/songs/artists, no admin action needed
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'wavzo2026indexnow';
let known = null;
async function submitIndexNow(urls) {
  if (!urls.length) return;
  try {
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'wavzo.com.ng', key: INDEXNOW_KEY, keyLocation: SITE + '/' + INDEXNOW_KEY + '.txt', urlList: urls.slice(0, 100) })
    });
    console.log('IndexNow: sent ' + Math.min(urls.length, 100) + ' url(s), status ' + r.status);
  } catch (e) { console.log('IndexNow failed: ' + e.message); }
}
async function checkNew() {
  try {
    const doc = await getDoc(0);
    const rows = [];
    for (const k of ['posts', 'songs', 'artists']) for (const x of doc[k] || []) if (x && x.slug && (k !== 'posts' || seoState(doc, x).index)) rows.push({ url: SITE + '/' + k + '/' + x.slug + '.html', t: Number(x.createdAt) || 0 });
    if (known === null) {
      known = new Set(rows.map((r) => r.url));
      await submitIndexNow(rows.filter((r) => r.t > Date.now() - 6 * 3600 * 1000).map((r) => r.url)); // published while the server slept
      return;
    }
    const fresh = rows.filter((r) => !known.has(r.url));
    fresh.forEach((r) => known.add(r.url));
    if (fresh.length) await submitIndexNow(fresh.map((r) => r.url).concat(SITE + '/'));
  } catch (e) { console.log('IndexNow check failed: ' + e.message); }
}
let watching = false;
function startIndexNowWatcher() {
  if (watching) return;
  watching = true; refreshDoc().catch(() => {}); setTimeout(checkNew, 15000); setInterval(checkNew, 60000); }

module.exports = { homePayload, dbDoc: () => getDoc(30000), startIndexNowWatcher, page, sitemap, dbJson, handler, _cache: () => cache, _reset: () => { cache = { t: 0, doc: null }; } };
