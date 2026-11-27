/* WAVZO home renderer. The SAME code runs on the server (so Google sees the stories) and in the browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WZH = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var SECTION_ORDER = ['NEWS', 'ENTERTAINMENT', 'SPORTS', 'TRENDING', 'GOSPEL', 'MUSIC', 'CULTURE'];
  var PER_PAGE = 24;
  var ICON = { NEWS: '\uD83D\uDCF0', ENTERTAINMENT: '\uD83C\uDFAC', SPORTS: '\u26BD', TRENDING: '\uD83D\uDD25', GOSPEL: '\uD83D\uDE4F', MUSIC: '\uD83C\uDFA7', CULTURE: '\uD83C\uDF0D' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cslug(c) { return String(c || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function cname(c) { var s = String(c || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function safe(s) { return String(s || '').replace(/[^\w.%-]/g, ''); }
  function plain(h) { return String(h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = plain(s); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '\u2026' : s; }
  function kviews(v) { v = +v || 0; return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(v); }

  // Picture address: resized, modern format, and the same everywhere
  function IMG(u, w, h) {
    u = String(u == null ? '' : u).trim().replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(u)) return u.charAt(0) === '/' ? u : '';
    if (u.indexOf('wsrv.nl') > -1 || u.indexOf('https://wavzo.com.ng') === 0) return u;
    var m = u.match(/^(https?:\/\/res\.cloudinary\.com\/[^\/]+\/image\/upload\/)(.*)$/);
    if (m) return m[1] + (h ? 'c_fill,g_auto,w_' + w + ',h_' + h + ',' : 'w_' + w + ',') + 'f_auto,q_auto/' + m[2];
    return 'https://wsrv.nl/?url=' + encodeURIComponent(u) + '&w=' + w + (h ? '&h=' + h + '&fit=cover' : '') + '&output=webp&q=75';
  }
  function pic(p, w, h, cls, eager) {
    var u = IMG(p.coverImage, w, h);
    if (!u) return '<div class="' + cls + ' ph">' + (ICON[p.category] || '\uD83D\uDCF0') + '</div>';
    return '<img class="' + cls + '" src="' + esc(u) + '" data-o="' + esc(p.coverImage) + '" onerror="WZH.fb(this)" width="' + w + '" height="' + (h || Math.round(w * 0.6)) + '" alt="' + esc(p.title) + '"' + (eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"') + '>';
  }
  function fb(el) { el.onerror = null; if (el.dataset && el.dataset.o) el.src = el.dataset.o; }
  function href(p) { return '/posts/' + safe(p.slug) + '.html'; }
  function ex(p) { return clip(p.excerpt || p.content || '', 150); }

  function heroSlide(p, i) {
    return '<article class="slide' + (i === 0 ? ' on' : '') + '"><a class="slide-link" href="' + href(p) + '" aria-label="' + esc(p.title) + '"></a>' + pic(p, 1000, 640, 'slide-img', i === 0) +
      '<div class="slide-shade"></div><div class="slide-body"><span class="pill">' + (p.pinned ? '\uD83D\uDCCC ' : '') + esc(cname(p.category)) + '</span><h2>' + esc(p.title) + '</h2><p>' + esc(ex(p)) + '</p><span class="meta">' + esc(p.date || '') + '</span></div></article>';
  }
  function trendRow(p, i) {
    return '<a class="rank" href="' + href(p) + '"><b>' + (i + 1) + '</b><span class="rt">' + esc(p.title) + '<small>' + esc(cname(p.category)) + '' + '</small></span>' + pic(p, 120, 80, 'rank-img') + '</a>';
  }
  function gridCard(p) {
    return '<a class="card" href="' + href(p) + '">' + pic(p, 640, 360, 'card-img') + '<div class="card-b"><span class="cat c-' + cslug(p.category) + '">' + (p.pinned ? '\uD83D\uDCCC ' : '') + esc(cname(p.category)) + '</span><h3>' + esc(p.title) + '</h3><p>' + esc(ex(p)) + '</p><span class="meta">' + esc(p.date || '') + '</span></div></a>';
  }
  function secBlock(cat, list) {
    var big = list[0], rest = list.slice(1, 4);
    return '<section class="blk"><div class="blk-hd"><h2><i>' + (ICON[cat] || '') + '</i> ' + esc(cname(cat)) + '</h2><a href="/category/' + cslug(cat) + '">See all \u2192</a></div><div class="sec"><a class="big" href="' + href(big) + '">' + pic(big, 900, 560, 'big-img') +
      '<div class="slide-shade"></div><div class="big-b"><span class="pill">' + esc(cname(cat)) + '</span><h3>' + esc(big.title) + '</h3></div></a><div class="stack">' +
      rest.map(function (p) { return '<a class="row" href="' + href(p) + '">' + pic(p, 220, 150, 'row-img') + '<span class="rt">' + esc(p.title) + '<small>' + esc(p.date || '') + '</small></span></a>'; }).join('') + '</div></div></section>';
  }
  function dec(s) { return String(s == null ? '' : s).replace(/&(amp|lt|gt|quot|#0?39|apos);/g, function (m, k) { return { amp: '&', lt: '<', gt: '>', quot: '"' }[k] || "'"; }); }
  function albumSlug(name, id) { return (cslug(dec(name)) || 'album') + '-' + safe(id); }
  // songs that share an albumId become ONE album; everything else is a single
  function releases(songs) {
    var by = {}, out = [];
    (songs || []).forEach(function (s) {
      if (!s || !s.slug) return;
      if (s.albumId) {
        var a = by[s.albumId];
        if (!a) { a = by[s.albumId] = { kind: 'album', id: String(s.albumId), name: s.album || 'Album', cover: s.albumCover || s.cover, artistId: s.artistId, tracks: [], t: 0 }; out.push(a); }
        a.tracks.push(s); a.t = Math.max(a.t, +s.createdAt || 0);
      } else out.push({ kind: 'single', song: s, t: +s.createdAt || 0 });
    });
    out.forEach(function (r) { if (r.tracks) r.tracks.sort(function (x, y) { return (+x.trackNumber || 999) - (+y.trackNumber || 999) || (+x.createdAt || 0) - (+y.createdAt || 0); }); });
    return out.sort(function (a, b) { return b.t - a.t; });
  }
  function relCard(r, am, now) {
    var al = r.kind === 'album', s = r.song, cover = al ? r.cover : s.cover, title = al ? r.name : s.title, aid = al ? r.artistId : s.artistId;
    var link = al ? '/albums/' + albumSlug(r.name, r.id) + '.html' : '/songs/' + safe(s.slug) + '.html';
    var im = IMG(cover, 320, 320), fresh = r.t > 0 && (now || Date.now()) - r.t < 7 * 864e5;
    return '<a class="rel" href="' + link + '"><span class="rc">' + (im ? '<img src="' + esc(im) + '" data-o="' + esc(cover) + '" onerror="this.onerror=null;this.src=this.dataset.o" width="320" height="320" loading="lazy" alt="">' : '<span class="mph">\uD83C\uDFB5</span>') +
      (al ? '<em class="rtag">ALBUM \u00B7 ' + r.tracks.length + ' tracks</em>' : '') + (fresh ? '<em class="rnew">NEW</em>' : '') + '</span><b>' + esc(dec(title)) + '</b><small>' + esc(am[aid] ? am[aid].name : '') + '</small></a>';
  }
  // MUSIC / GOSPEL stories that carry a downloadable audio file can headline the "New song" card too
  function audioPost(p) {
    var f = p && p.musicFile;
    return !!(p && p.slug && p.title && p.coverImage && (p.category === 'MUSIC' || p.category === 'GOSPEL') && (p.q !== 0 || p.pinned) &&
      typeof f === 'string' && f.length > 4 && !/^(none|null|undefined)$/i.test(f.trim()));
  }
  function postTime(p) { return +p.createdAt || Date.parse(p.date) || 0; }
  function songFromPost(p) {
    var t = dec(p.title).replace(/\[[^\]]*\]/g, ' ').replace(/[\s|\-\u2013\u2014:]*\(?\s*mp3\s*(?:download|audio)?\s*\)?/ig, ' ').replace(/\s+/g, ' ').replace(/^[\s|\-\u2013\u2014:]+|[\s|\-\u2013\u2014:]+$/g, '');
    var who = '', m = t.match(/^(.+?)\s+by\s+(.+)$/i) || t.match(/^([^|]+?)\s*\|\s*([^|]+)$/);
    if (m) { t = m[1].trim(); who = m[2].trim(); }
    return { title: t || dec(p.title), artist: who || cname(p.category) };
  }
  function spotPost(p) {
    var s = songFromPost(p), im = IMG(p.coverImage, 480, 480);
    if (!im) return '';
    return '<a class="spot" href="' + href(p) + '"><span class="spot-bg" style="background-image:url(' + esc(im) + ')"></span><span class="spot-in"><img src="' + esc(im) + '" width="112" height="112" alt="" loading="lazy"><span class="spot-t"><em>NEW SONG</em><b>' +
      esc(s.title) + '</b><small>' + esc(s.artist) + '</small><i>Download \u2192</i></span></span></a>';
  }
  function spot(rel, am, posts) {
    var r = rel[0], pp = null;
    (posts || []).forEach(function (p) { if (audioPost(p) && (!pp || postTime(p) > postTime(pp))) pp = p; });
    if (pp && (!r || postTime(pp) > r.t)) { var sp = spotPost(pp); if (sp) return sp; }
    if (!r) return '';
    var al = r.kind === 'album', s = r.song, cover = al ? r.cover : s.cover, title = dec(al ? r.name : s.title), aid = al ? r.artistId : s.artistId;
    var link = al ? '/albums/' + albumSlug(r.name, r.id) + '.html' : '/songs/' + safe(s.slug) + '.html';
    var im = IMG(cover, 480, 480);
    if (!im) return '';
    return '<a class="spot" href="' + link + '"><span class="spot-bg" style="background-image:url(' + esc(im) + ')"></span><span class="spot-in"><img src="' + esc(im) + '" width="112" height="112" alt="" loading="lazy"><span class="spot-t"><em>' +
      (al ? 'NEW ALBUM \u00B7 ' + r.tracks.length + ' TRACKS' : 'NEW SONG') + '</em><b>' + esc(title) + '</b><small>' + esc(am[aid] ? am[aid].name : '') + '</small><i>' + (al ? 'Open album \u2192' : 'Download \u2192') + '</i></span></span></a>';
  }
  function musicSection(songs, artists, posts) {
    if (!songs.length && !(posts || []).some(audioPost)) return '';
    var am = {}; artists.forEach(function (a) { am[a.id] = a; });
    var rel = releases(songs), now = Date.now();
    if (!songs.length) return spot(rel, am, posts);
    var singles = rel.filter(function (r) { return r.kind === 'single'; }).slice(0, 8);
    var top = songs.filter(function (s) { return s && s.slug && (+s.downloads || 0) > 0; }).sort(function (a, b) { return (+b.downloads || 0) - (+a.downloads || 0); }).slice(0, 5);
    function row(s, n) {
      var im = IMG(s.cover, 160, 160);
      return '<a class="mrow" href="/songs/' + safe(s.slug) + '.html">' + (n ? '<span class="mn">' + n + '</span>' : '') +
        (im ? '<img src="' + esc(im) + '" data-o="' + esc(s.cover) + '" onerror="WZH.fb(this)" width="160" height="160" loading="lazy" alt="">' : '<span class="mph">\uD83C\uDFB5</span>') +
        '<span class="mt"><b>' + esc(dec(s.title)) + '</b><small>' + esc(am[s.artistId] ? am[s.artistId].name : '') + '</small></span><span class="mdl">Download</span></a>';
    }
    return spot(rel, am, posts) + '<section class="blk"><div class="blk-hd"><h2><i>\uD83C\uDD95</i> New releases</h2><a href="/music">See all \u2192</a></div><div class="rail2">' + rel.slice(0, 12).map(function (r) { return relCard(r, am, now); }).join('') + '</div></section>' +
      (singles.length ? '<section class="blk"><div class="blk-hd"><h2><i>\uD83C\uDFA7</i> Latest singles</h2><a href="/music">See all \u2192</a></div><div class="mlist">' + singles.map(function (r) { return row(r.song, 0); }).join('') + '</div></section>' : '') +
      (top.length ? '<section class="blk"><div class="blk-hd"><h2><i>\uD83D\uDD25</i> Most downloaded</h2></div><div class="mlist">' + top.map(function (s, i) { return row(s, i + 1); }).join('') + '</div></section>' : '');
  }
  function artistSection(songs, artists) {
    var list = artists.filter(function (a) { return a && a.slug; });
    if (!list.length) return '';
    var n = {}; songs.forEach(function (s) { n[s.artistId] = (n[s.artistId] || 0) + 1; });
    list = list.slice().sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || (n[b.id] || 0) - (n[a.id] || 0); }).slice(0, 24);
    return '<section class="blk"><div class="blk-hd"><h2><i>\uD83C\uDFA4</i> Artists &amp; stars</h2><a href="/artists.html">View all \u2192</a></div><div class="rail av">' + list.map(function (a) {
      var im = IMG(a.photo, 200, 200);
      return '<a class="artist" href="/artists/' + safe(a.slug) + '.html"><span class="ring">' + (im ? '<img src="' + esc(im) + '" data-o="' + esc(a.photo) + '" onerror="WZH.fb(this)" width="200" height="200" loading="lazy" alt="' + esc(a.name) + '">' : '<em>\uD83C\uDFA4</em>') + '</span><b>' + esc(a.name) + '</b></a>';
    }).join('') + '</div></section>';
  }
  // pinned posts first (newest pin first); a pinned post always shows, even if it would normally be hidden
  function good(posts) {
    var g = posts.filter(function (p) { return p && p.slug && p.title && (p.q !== 0 || p.pinned); });
    var pin = g.filter(function (p) { return p.pinned; }).sort(function (a, b) { return (+b.pinned || 0) - (+a.pinned || 0); });
    return pin.concat(g.filter(function (p) { return !p.pinned; }));
  }
  function sig(posts) { var g = good(posts); return g.length + ':' + (g[0] ? g[0].slug : ''); }
  function latest(posts, cat, from, n) {
    var g = good(posts).filter(function (p) { return cat === 'ALL' || p.category === cat; });
    var part = g.slice(from, from + (n || PER_PAGE));
    return { html: part.map(gridCard).join(''), next: from + part.length, total: g.length };
  }
  function build(data) {
    var posts = (data.posts || []).filter(function (p) { return p && p.slug && p.title; }), songs = data.songs || [], artists = data.artists || [];
    var g = good(posts), img = g.filter(function (p) { return p.coverImage; });
    var hero = img.filter(function (p) { return p.pinned; }).slice(0, 3).concat(img.filter(function (p) { return !p.pinned; })).slice(0, 6);
    var anyViews = img.some(function (p) { return +p.views > 0; });
    var trend = anyViews ? img.slice().sort(function (a, b) { return (+b.views || 0) - (+a.views || 0); }).slice(0, 6) : img.slice(6, 12);
    if (trend.length < 3) trend = img.slice(0, 6);
    var secs = [];
    SECTION_ORDER.forEach(function (c) {
      if (secs.length >= 4) return;
      var l = img.filter(function (p) { return p.category === c; }).slice(0, 4);
      if (l.length >= 3) secs.push(secBlock(c, l));
    });
    var counts = {}; g.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });
    var cats = Object.keys(counts).sort(function (a, b) { var ia = SECTION_ORDER.indexOf(a), ib = SECTION_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    var l1 = latest(posts, 'ALL', 0, PER_PAGE), tk = g.slice(0, 10);
    return {
      ticker: tk.concat(tk).map(function (p) { return '<a href="' + href(p) + '">' + esc(p.title) + '</a>'; }).join(''),
      bars: hero.map(function () { return '<i><b></b></i>'; }).join(''),
      hero: hero.map(heroSlide).join(''),
      trending: trend.map(trendRow).join(''),
      music: musicSection(songs, artists, posts),
      artists: artistSection(songs, artists),
      sections: secs.join(''),
      chips: '<a class="chip on" data-cat="ALL" href="/">All</a>' + cats.map(function (c) { return '<a class="chip" data-cat="' + esc(c) + '" href="/category/' + cslug(c) + '">' + esc(cname(c)) + '</a>'; }).join(''),
      latest: l1.html, next: l1.next, total: l1.total,
      sig: sig(posts), preload: hero[0] ? IMG(hero[0].coverImage, 1000, 640) : ''
    };
  }
  return { releases: releases, relCard: relCard, albumSlug: albumSlug, dec: dec, build: build, latest: latest, sig: sig, esc: esc, IMG: IMG, fb: fb, PER_PAGE: PER_PAGE };
});
