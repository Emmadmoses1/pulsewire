// Server-side RSS reader for the admin "Suggest from Trusted Sources" button.
// It replaces the free rss2json.com service, which is rate-limited and was the cause of "No headlines".
const Parser = require('rss-parser');
const parser = new Parser({
  customFields: { item: [['media:content', 'mediaContent', { keepArray: true }], ['media:thumbnail', 'mediaThumbnail'], ['content:encoded', 'contentEncoded']] }
});

const F = (name, url) => ({ name, url });
const FEEDS = {
  MUSIC: [F('NotJustOk', 'https://notjustok.com/feed'), F('Tooxclusive', 'https://tooxclusive.com/feed/'), F('Billboard', 'https://www.billboard.com/feed/'), F('NME', 'https://www.nme.com/feed'), F('DJ Hol Up (Afrobeats Mixes)', 'https://feeds.soundcloud.com/users/soundcloud:users:197958241/sounds.rss')],
  ENTERTAINMENT: [F('Variety', 'https://variety.com/feed/'), F('The Hollywood Reporter', 'https://www.hollywoodreporter.com/feed/'), F('ComingSoon', 'https://www.comingsoon.net/feed')],
  CULTURE: [F('OkayAfrica', 'https://www.okayafrica.com/feed/'), F('The Guardian Nigeria', 'https://guardian.ng/feed/'), F('Pulse Nigeria', 'https://www.pulse.ng/rss'), F("Linda Ikeji's Blog", 'https://www.lindaikejisblog.com/feeds/posts/default?alt=rss'), F('Legit.ng Entertainment', 'https://www.legit.ng/rss/entertainment.rss')],
  GOSPEL: [F('Gospel Music', 'https://www.gospel-music.org/feed/'), F('NotJustOk Gospel', 'https://notjustok.com/category/gospel/feed/'), F('Tooxclusive Gospel', 'https://tooxclusive.com/category/gospel/feed/'), F('NaijaGospel', 'https://naijagospel.com.ng/feed/'), F('GospelHotspot', 'https://www.gospelhotspot.net/feed/'), F('Christian Times Nigeria', 'https://christiantimesnigeria.com/feed/'), F('Praiseworld Radio', 'https://praiseworldradio.com/feed/')],
  SPORTS: [F('BBC Sport', 'http://feeds.bbci.co.uk/sport/football/rss.xml'), F('Sky Sports', 'https://www.skysports.com/rss/12040'), F('Goal.com', 'https://www.goal.com/feeds/en/news'), F('CompleteSports', 'https://www.completesports.com/feed/'), F('90min', 'https://www.90min.com/posts.rss'), F('Football Italia', 'https://www.football-italia.net/rss.xml'), F('Brila Sports', 'https://brila.net/category/sports/feed/')],
  NEWS: [F('BBC', 'http://feeds.bbci.co.uk/news/rss.xml'), F('Fox News', 'https://moxie.foxnews.com/google-publisher/latest.xml'), F('The Guardian', 'https://www.theguardian.com/world/rss'), F('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'), F('CNN', 'http://rss.cnn.com/rss/edition.rss'), F('Premium Times', 'https://www.premiumtimesng.com/feed'), F('Daily Post Nigeria', 'https://dailypost.ng/feed'), F('Punch', 'https://punchng.com/feed/'), F('Vanguard', 'https://www.vanguardngr.com/feed/'), F('Channels TV', 'https://www.channelstv.com/feed/'), F('ThisDay', 'https://www.thisdaylive.com/feed/'), F('Legit.ng', 'https://www.legit.ng/rss/all.rss')]
};
FEEDS.TRENDING = FEEDS.MUSIC;

const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const TTL = 3 * 60 * 1000;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014' };

function cp(n) { try { return String.fromCodePoint(n); } catch (e) { return ''; } }
function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (m, n) => cp(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => cp(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m))
    .replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const bad = (u) => /logo|icon|avatar|pixel|spacer|1x1/i.test(u);
function extractImage(it, html) {
  const enc = it.enclosure || {};
  if (enc.url && /^image/i.test(enc.type || '') && !bad(enc.url)) return enc.url;
  const mc = Array.isArray(it.mediaContent) ? it.mediaContent : (it.mediaContent ? [it.mediaContent] : []);
  for (const m of mc) { const u = m && m.$ && m.$.url; if (u && u !== 'undefined' && !bad(u) && (!m.$.medium || m.$.medium === 'image' || /\.(jpe?g|png|webp)/i.test(u))) return u; }
  const th = it.mediaThumbnail;
  if (th && th.$ && th.$.url && !bad(th.$.url)) return th.$.url;
  const m = String(html || '').match(/<img[^>]+src=["'](https?:\/\/[^"'> ]+)["']/i);
  if (m && !bad(m[1])) return m[1];
  return null;
}
function toItem(feed, it) {
  const html = it.contentEncoded || it.content || it.summary || '';
  const enc = it.enclosure || {};
  let mediaType = null, mediaUrl = null;
  if (enc.url && /^audio/i.test(enc.type || '')) { mediaType = 'audio'; mediaUrl = enc.url; }
  else if (enc.url && /^video/i.test(enc.type || '')) { mediaType = 'video'; mediaUrl = enc.url; }
  const iso = it.isoDate || it.pubDate;
  return {
    source: feed.name,
    title: htmlToText(it.title).replace(/\s+/g, ' ').trim(),
    link: String(it.link || '').trim(),
    excerpt: htmlToText(it.contentSnippet || it.summary || html).replace(/\s+/g, ' ').slice(0, 200),
    fullContent: htmlToText(html).replace(/^The post .+ appeared first on .+$/gim, '').trim(),
    image: extractImage(it, html), mediaType, mediaUrl,
    pub: iso ? (Date.parse(iso) || 0) : 0
  };
}
async function fetchFeed(feed) {
  const r = await fetch(feed.url, { signal: AbortSignal.timeout(9000), redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const parsed = await parser.parseString(await r.text());
  return (parsed.items || []).slice(0, 6).map((it) => toItem(feed, it)).filter((x) => x.title && x.link);
}

// ---- remembers what was already posted (by source link and by headline) ----
const normLink = (u) => String(u || '').replace(/&amp;/g, '&').replace(/[).,;]+$/, '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function postedSets(doc) {
  const links = new Set(), titles = new Set();
  for (const p of (doc && doc.posts) || []) {
    if (p.sourceUrl) links.add(normLink(p.sourceUrl));
    (String(p.content || '').slice(-900).match(/https?:\/\/[^\s"'<>)]+/g) || []).forEach((u) => links.add(normLink(u)));
    if (p.title) titles.add(normTitle(p.title));
  }
  return { links, titles };
}

const cache = new Map(), inflight = new Map(), known = new Set();
async function getCategory(cat, fresh) {
  const feeds = FEEDS[cat] || FEEDS.NEWS;
  const hit = cache.get(cat);
  if (hit && !fresh && Date.now() - hit.t < TTL) return hit;
  if (inflight.has(cat)) return inflight.get(cat);
  const p = (async () => {
    const results = await Promise.allSettled(feeds.map(fetchFeed));
    const items = [], failed = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') items.push(...r.value);
      else failed.push(feeds[i].name + ' (' + String((r.reason && r.reason.message) || r.reason).slice(0, 50) + ')');
    });
    if (!items.length && hit) return hit; // every feed failed: keep the last good list
    items.sort((a, b) => (b.pub || 0) - (a.pub || 0));
    items.forEach((x) => known.add(x.link));
    const out = { t: Date.now(), items, failed };
    cache.set(cat, out);
    return out;
  })().finally(() => inflight.delete(cat));
  inflight.set(cat, p);
  return p;
}

const ogCache = new Map();
async function ogImage(url) {
  if (ogCache.has(url)) return ogCache.get(url);
  const r = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' } });
  const html = (await r.text()).slice(0, 400000);
  const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/i) ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
  const img = m && !bad(m[1]) ? m[1].replace(/&amp;/g, '&') : null;
  ogCache.set(url, img);
  return img;
}

function register(app) {
  app.get('/admin/rss-items', async (req, res) => {
    try {
      const cat = String(req.query.cat || 'NEWS').toUpperCase();
      const data = await getCategory(cat, req.query.fresh === '1');
      let posted = { links: new Set(), titles: new Set() };
      try { posted = postedSets(await require('./instant-pages').dbJson()); } catch (e) { console.log('RSS: could not read posted list: ' + e.message); }
      const seenL = new Set(), seenT = new Set();
      const items = data.items.filter((x) => {
        const l = normLink(x.link), t = normTitle(x.title);
        if (posted.links.has(l) || posted.titles.has(t) || seenL.has(l) || seenT.has(t)) return false;
        seenL.add(l); seenT.add(t);
        return true;
      }).slice(0, 60);
      res.set('Cache-Control', 'no-store').json({ items, failed: data.failed, total: data.items.length });
    } catch (e) {
      console.log('RSS failed: ' + e.message);
      res.status(500).json({ error: e.message, items: [] });
    }
  });
  app.get('/admin/og-image', async (req, res) => {
    try {
      const url = String(req.query.url || '');
      if (!known.has(url)) return res.json({ image: null }); // only links that came from our own feed list
      res.set('Cache-Control', 'public, max-age=3600').json({ image: await ogImage(url) });
    } catch (e) { res.json({ image: null }); }
  });
}

module.exports = { register, htmlToText, toItem, postedSets, normLink, normTitle, getCategory, _FEEDS: FEEDS };
