// ===== WAVZO Worker: public /charts route (weekly Top 10 + Trending) =====
// HOW TO ADD (2 pastes into your Worker file, e.g. wavzo-db-sb.js):
//  1) Paste everything between "PASTE 1" markers anywhere at top level (e.g. above `const BOT = ...`).
//  2) Paste the single `if (p === '/charts' ...)` line from "PASTE 2" inside extraRoutes, right above the `/stats` route.
// It only READS (the site document + the stat_daily table) and caches the answer for 10 minutes.
// Needs: readDoc, sbAll, isoDay, CORS, reply - all already in your Worker.

// ----- PASTE 1 start -----
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|opus)(\?|#|$)/i;
const W_EV = { view: 1, play: 2, download: 3, share: 2 }; // plays count double, downloads triple
const gospelOrMusic = (p) => /^(MUSIC|GOSPEL)$/i.test(p.category || '') && p.musicFile;
function splitTitle(t) {
  const x = String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/[-|\u2013\u2014]?\s*\(?\s*mp3(\s*download)?\s*\)?/ig, ' ').replace(/\s+/g, ' ').trim();
  const m = x.match(/^(.+?)\s*\|\s*(.+)$/) || x.match(/^(.+?)\s+by\s+(.+)$/i);
  return m ? { a: m[1].trim(), b: m[2].replace(/[-|\s]+$/, '').trim() } : { a: x, b: '' };
}
async function buildCharts(env) {
  const doc = (await readDoc(env)) || {};
  const artists = new Map((doc.artists || []).map((a) => [a.id, a.name]));
  const cat = new Map(); // "kind:key" -> track
  for (const s of (doc.songs || [])) {
    if (!s.slug || !AUDIO_RE.test(String(s.downloadUrl || '')) && !/res\.cloudinary\.com\/.+\.mp3/i.test(String(s.downloadUrl || ''))) continue;
    cat.set('song:' + s.slug, { kind: 'song', key: s.slug, title: s.title, artist: artists.get(s.artistId) || '', cover: s.cover || '', src: s.downloadUrl, url: '/songs/' + s.slug + '.html', all: (s.downloads || 0) * 3 });
  }
  for (const p of (doc.posts || [])) {
    if (!p.slug || !gospelOrMusic(p)) continue;
    const t = splitTitle(p.title);
    cat.set('post:' + p.slug, { kind: 'post', key: p.slug, title: t.b ? t.a : p.title, artist: t.b || '', cover: p.coverImage || '', src: p.musicFile, url: '/posts/' + p.slug + '.html', all: (p.audioDownloads || p.downloads || 0) * 3 + (p.views || 0) });
  }
  const today = isoDay(0), wk1 = isoDay(-6), wk2 = isoDay(-13);
  const rows = await sbAll(env, 'stat_daily?select=day,kind,key,ev,n&day=gte.' + wk2 + '&kind=in.(song,post)&ev=in.(view,play,download,share)', 30000);
  const now = new Map(), before = new Map();
  for (const r of rows) {
    const id = r.kind + ':' + r.key; if (!cat.has(id)) continue;
    const w = (W_EV[r.ev] || 0) * (r.n || 0);
    const bucket = r.day >= wk1 ? now : before;
    bucket.set(id, (bucket.get(id) || 0) + w);
  }
  const all = [...cat.values()].map((t) => {
    const id = t.kind + ':' + t.key, n = now.get(id) || 0, b = before.get(id) || 0;
    return { kind: t.kind, key: t.key, title: t.title, artist: t.artist, cover: t.cover, src: t.src, url: t.url, score: n, prev: b, delta: n - b, all: t.all };
  });
  const top = all.slice().sort((x, y) => (y.score - x.score) || (y.all - x.all)).slice(0, 10)
    .map((t) => ({ ...t, weekly: t.score > 0 }));
  const trending = all.filter((t) => t.delta > 0 && t.score >= 3).sort((x, y) => (y.delta - x.delta) || (y.score - x.score)).slice(0, 10);
  return { updated: Date.now(), from: wk1, to: today, top, trending };
}
async function chartsRoute(env, ctx) {
  const cache = caches.default, ck = new Request('https://wavzo-charts.internal/v1');
  const hit = await cache.match(ck);
  if (hit) return new Response(hit.body, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
  const body = JSON.stringify(await buildCharts(env));
  const res = new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' } });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(ck, res.clone()));
  return new Response(body, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
}
// ----- PASTE 1 end -----

// ----- PASTE 2 (one line, inside extraRoutes, above the /stats route) -----
// if (p === '/charts' && m === 'GET') { try { return await chartsRoute(env, ctx); } catch (e) { return reply({ message: 'charts error: ' + (e && e.message) }, 500); } }
