/* WAVZO mini player: one player for the whole site.
   - Any element with data-wz-play='{"src":"...","title":"...","artist":"...","cover":"...","key":"slug","kind":"song|post","url":"/songs/x"}' starts it.
   - Elements sharing data-wz-list="name" become the queue (next/previous follow page order).
   - The queue and position are remembered, so the player is still there (and resumes) on the next page. */
(function () {
  'use strict';
  if (window.WZPlayer) return;
  var LS = 'wz_player_v1', API = 'https://wavzo-db.dakudinamoses.workers.dev/track';
  var st = { q: [], i: -1, t: 0, on: false };
  var a = new Audio(); a.preload = 'metadata';
  var bar, ui = {}, sheetOpen = false, lastSave = 0, tracked = {};

  function load() { try { var s = JSON.parse(localStorage.getItem(LS) || 'null'); if (s && Array.isArray(s.q) && s.q.length) st = s; } catch (e) {} }
  function save(force) {
    var n = Date.now(); if (!force && n - lastSave < 1500) return; lastSave = n;
    st.t = a.currentTime || 0; st.on = !a.paused;
    try { localStorage.setItem(LS, JSON.stringify({ q: st.q.slice(0, 60), i: st.i, t: st.t, on: st.on })); } catch (e) {}
  }
  function cur() { return st.q[st.i] || null; }
  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function img(u) { return u ? esc(u) : 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#1a1a24"/><path d="M40 30v34a9 9 0 1 1-6-8.5V36l26-6v28a9 9 0 1 1-6-8.5V30z" fill="#e5202f"/></svg>'); }

  function track(ev, t) {
    try {
      if (!t || !t.key || !t.kind) return;
      var host = location.hostname, live = (host === 'wavzo.com.ng' || host === 'www.wavzo.com.ng');
      var owner = false; try { owner = !!localStorage.getItem('wz_key'); } catch (e) {}
      if (!live || owner) return;
      if (window.WZ && window.WZ.track) return window.WZ.track(ev, t.kind, t.key);
      var body = JSON.stringify({ ev: ev, kind: t.kind, key: t.key, ref: document.referrer || '' });
      if (navigator.sendBeacon) navigator.sendBeacon(API, new Blob([body], { type: 'text/plain' }));
    } catch (e) {}
  }

  /* ---------- UI ---------- */
  var CSS = '#wzp{position:fixed;left:0;right:0;bottom:var(--wzp-b,0px);z-index:85;background:var(--card,#101018);color:var(--text,#f3f3f7);border-top:1px solid var(--line,#22222d);box-shadow:0 -14px 34px -18px rgba(0,0,0,.55);font-family:Inter,system-ui,sans-serif;transform:translateY(110%);transition:transform .28s ease}' +
    '#wzp.on{transform:none}' +
    '#wzp .sk{position:relative;height:18px;margin-top:-9px;cursor:pointer;touch-action:none}' +
    '#wzp .sk i{position:absolute;left:0;right:0;top:8px;height:3px;background:var(--line,#2a2a36)}' +
    '#wzp .sk b{position:absolute;left:0;top:8px;height:3px;width:0;background:linear-gradient(90deg,var(--brand,#e5202f),var(--brand2,#ff7a45))}' +
    '#wzp .row{display:flex;align-items:center;gap:10px;padding:4px 12px 10px;max-width:980px;margin:0 auto}' +
    '#wzp img{width:44px;height:44px;border-radius:8px;object-fit:cover;flex:none;background:#1a1a24}' +
    '#wzp .meta{min-width:0;flex:1}' +
    '#wzp .t{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}' +
    '#wzp .s{font-size:12px;color:var(--muted,#9696a6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#wzp button{background:none;border:0;color:inherit;cursor:pointer;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:none}' +
    '#wzp button:hover{background:rgba(127,127,140,.18)}' +
    '#wzp button svg{width:20px;height:20px;fill:currentColor}' +
    '#wzp .pp{width:44px;height:44px;background:var(--brand,#e5202f);color:#fff}#wzp .pp:hover{background:var(--brand2,#ff7a45)}' +
    '#wzp .tm{font-size:11px;color:var(--muted,#9696a6);font-variant-numeric:tabular-nums;min-width:74px;text-align:right}' +
    '#wzp .hint{display:none;font-size:11px;color:var(--brand2,#ff7a45);font-weight:700}#wzp.wait .hint{display:block}' +
    '#wzq{position:fixed;left:0;right:0;bottom:var(--wzp-b,0px);z-index:84;max-height:58vh;overflow:auto;background:var(--card,#101018);color:var(--text,#f3f3f7);border-radius:16px 16px 0 0;padding:14px 12px 90px;box-shadow:0 -20px 50px -20px rgba(0,0,0,.7);display:none;font-family:Inter,system-ui,sans-serif}' +
    '#wzq.on{display:block}#wzq h4{font-size:13px;margin:0 6px 8px}' +
    '#wzq .it{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:0;color:inherit;padding:8px 6px;border-radius:10px;cursor:pointer;font:inherit}' +
    '#wzq .it:hover,#wzq .it.cur{background:rgba(127,127,140,.14)}#wzq .it img{width:38px;height:38px;border-radius:6px;object-fit:cover}' +
    '#wzq .it span{min-width:0;flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#wzq .it small{display:block;color:var(--muted,#9696a6);font-size:11px}' +
    '[data-wz-play]{cursor:pointer}' +
    '@media (min-width:700px){#wzq{left:auto;right:16px;width:380px;bottom:calc(84px + var(--wzp-b,0px));border-radius:14px;padding-bottom:14px}}' +
    '@media (prefers-reduced-motion:reduce){#wzp{transition:none}}';
  var IC = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>', next: '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M3 6h14v2H3zm0 5h14v2H3zm0 5h9v2H3zm14-1v-2h2v-2h2v2h2v2h-2v2h-2v-2z"/></svg>', x: '<svg viewBox="0 0 24 24"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>'
  };
  function build() {
    if (bar) return;
    var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    bar = document.createElement('div'); bar.id = 'wzp'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Music player');
    bar.innerHTML = '<div class="sk" id="wzSk" role="slider" aria-label="Seek" tabindex="0"><i></i><b id="wzBar"></b></div>' +
      '<div class="row"><a id="wzLink" href="#" style="display:flex;gap:10px;align-items:center;min-width:0;flex:1;color:inherit"><img id="wzImg" alt=""><span class="meta"><span class="t" id="wzT"></span><span class="s" id="wzS"></span><span class="hint">Tap play to resume</span></span></a>' +
      '<span class="tm" id="wzTm">0:00</span>' +
      '<button id="wzPrev" aria-label="Previous">' + IC.prev + '</button><button class="pp" id="wzPP" aria-label="Play or pause">' + IC.play + '</button><button id="wzNext" aria-label="Next">' + IC.next + '</button>' +
      '<button id="wzQ" aria-label="Queue">' + IC.list + '</button><button id="wzX" aria-label="Close player">' + IC.x + '</button></div>';
    document.body.appendChild(bar);
    var q = document.createElement('div'); q.id = 'wzq'; q.setAttribute('aria-label', 'Up next'); document.body.appendChild(q); ui.q = q;
    ui.img = bar.querySelector('#wzImg'); ui.t = bar.querySelector('#wzT'); ui.s = bar.querySelector('#wzS'); ui.tm = bar.querySelector('#wzTm');
    ui.bar = bar.querySelector('#wzBar'); ui.pp = bar.querySelector('#wzPP'); ui.link = bar.querySelector('#wzLink'); ui.sk = bar.querySelector('#wzSk');
    ui.pp.onclick = toggle; bar.querySelector('#wzPrev').onclick = prev; bar.querySelector('#wzNext').onclick = next;
    bar.querySelector('#wzQ').onclick = function () { sheetOpen = !sheetOpen; q.classList.toggle('on', sheetOpen); drawQ(); };
    bar.querySelector('#wzX').onclick = close;
    function seekTo(e) { var r = ui.sk.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; if (a.duration) a.currentTime = Math.max(0, Math.min(1, x / r.width)) * a.duration; }
    ui.sk.addEventListener('pointerdown', function (e) { seekTo(e); var mv = function (ev) { seekTo(ev); }, up = function () { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); });
    ui.sk.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') a.currentTime += 5; if (e.key === 'ArrowLeft') a.currentTime -= 5; });
  }
  function drawQ() {
    if (!sheetOpen) return;
    ui.q.innerHTML = '<h4>Up next</h4>' + st.q.map(function (t, n) {
      return '<button class="it' + (n === st.i ? ' cur' : '') + '" data-n="' + n + '"><img src="' + img(t.cover) + '" alt=""><span>' + esc(t.title) + '<small>' + esc(t.artist || '') + '</small></span></button>';
    }).join('');
    Array.prototype.forEach.call(ui.q.querySelectorAll('.it'), function (b) { b.onclick = function () { go(+b.dataset.n); }; });
  }
  function layout() { /* keep the player above the phone's bottom tab bar and keep page content clear of it */
    var bt = document.querySelector('.btab'), off = 0;
    try { if (bt && getComputedStyle(bt).display !== 'none') off = bt.offsetHeight || 0; } catch (e) {}
    var r = document.documentElement.style;
    r.setProperty('--wzp-b', off + 'px'); r.setProperty('--wzp-h', (bar && bar.classList.contains('on')) ? '76px' : '0px');
  }
  window.addEventListener('resize', layout);
  function draw() {
    var t = cur(); if (!t) { if (bar) bar.classList.remove('on'); layout(); return; }
    build(); bar.classList.add('on'); layout();
    ui.img.src = img(t.cover); ui.t.textContent = t.title; ui.s.textContent = t.artist || '';
    ui.link.href = t.url || '#'; ui.pp.innerHTML = a.paused ? IC.play : IC.pause; drawQ();
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || 'WAVZO', artwork: t.cover ? [{ src: t.cover, sizes: '512x512' }] : [] }); } catch (e) {}
    }
  }

  /* ---------- controls ---------- */
  function go(n, resumeAt) {
    if (n < 0 || n >= st.q.length) return;
    st.i = n; var t = cur(); a.src = t.src; tracked = {};
    if (resumeAt) a.addEventListener('loadedmetadata', function f() { a.removeEventListener('loadedmetadata', f); try { a.currentTime = resumeAt; } catch (e) {} });
    draw(); return a.play().then(function () { bar && bar.classList.remove('wait'); }).catch(function () { bar && bar.classList.add('wait'); draw(); });
  }
  function toggle() { if (!cur()) return; if (a.paused) { bar.classList.remove('wait'); a.play().catch(function () {}); } else a.pause(); }
  function next() { if (st.i < st.q.length - 1) go(st.i + 1); else { a.pause(); a.currentTime = 0; draw(); } }
  function prev() { if (a.currentTime > 4 || st.i === 0) a.currentTime = 0; else go(st.i - 1); }
  function close() { a.pause(); a.removeAttribute('src'); st = { q: [], i: -1, t: 0, on: false }; sheetOpen = false; if (ui.q) ui.q.classList.remove('on'); try { localStorage.removeItem(LS); } catch (e) {} draw(); }
  function play(track, queue) {
    if (!track || !track.src) return;
    var q = (queue && queue.length ? queue : [track]).filter(function (t) { return t && t.src; });
    var n = q.findIndex(function (t) { return t.src === track.src; }); if (n < 0) { q.unshift(track); n = 0; }
    st.q = q; go(n);
  }
  function enqueue(track) { if (!track || !track.src) return; if (!st.q.some(function (t) { return t.src === track.src; })) st.q.push(track); if (st.i < 0) go(0); else { draw(); save(true); } }

  document.addEventListener('play', function (e) { if (e.target !== a && !a.paused) a.pause(); }, true);
  a.addEventListener('play', function () { Array.prototype.forEach.call(document.querySelectorAll('audio,video'), function (m) { try { m.pause(); } catch (e) {} }); draw(); save(true); var t = cur(); if (t && !tracked.p) { tracked.p = 1; track('play', t); } });
  a.addEventListener('pause', function () { draw(); save(true); });
  a.addEventListener('ended', next);
  a.addEventListener('timeupdate', function () {
    if (!ui.bar) return; if (a.duration) ui.bar.style.width = (a.currentTime / a.duration * 100) + '%';
    ui.tm.textContent = fmt(a.currentTime) + ' / ' + fmt(a.duration); save(false);
  });
  a.addEventListener('error', function () { if (cur() && st.i < st.q.length - 1) next(); });
  window.addEventListener('pagehide', function () { save(true); });
  if ('mediaSession' in navigator) {
    var h = { play: toggle, pause: toggle, previoustrack: prev, nexttrack: next };
    Object.keys(h).forEach(function (k) { try { navigator.mediaSession.setActionHandler(k, h[k]); } catch (e) {} });
  }

  /* ---------- page hooks ---------- */
  function readTrack(el) { try { return JSON.parse(el.getAttribute('data-wz-play')); } catch (e) { return null; } }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-wz-play]'); if (!el) return;
    var t = readTrack(el); if (!t) return; e.preventDefault();
    if (el.hasAttribute('data-wz-queue')) { build(); enqueue(t); return; }
    var list = el.getAttribute('data-wz-list'), q = null;
    if (list) q = Array.prototype.map.call(document.querySelectorAll('[data-wz-list="' + list + '"]'), readTrack).filter(Boolean);
    play(t, q);
  });

  window.WZPlayer = { play: play, enqueue: enqueue, next: next, prev: prev, toggle: toggle, close: close, state: function () { return { track: cur(), playing: !a.paused }; } };

  /* restore after a page change: try to keep playing, otherwise show the bar paused with a hint */
  function boot() {
    load(); if (!cur()) return; build();
    var t = cur(); a.src = t.src; var at = st.t || 0, was = st.on;
    a.addEventListener('loadedmetadata', function f() { a.removeEventListener('loadedmetadata', f); try { if (at) a.currentTime = at; } catch (e) {} });
    draw();
    if (was) a.play().catch(function () { bar.classList.add('wait'); draw(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
