/* WAVZO share bar: WhatsApp first, then the phone's share sheet, then copy link.
   Added to song, album and artist pages (story pages already have their own buttons). */
(function () {
  'use strict';
  var m = location.pathname.match(/^\/(songs|albums|artists)\/([^\/]+?)(?:\.html)?$/);
  if (!m) return;
  var TYPE = { songs: 'song', albums: 'album', artists: 'artist' }[m[1]];
  var SLUG; try { SLUG = decodeURIComponent(m[2]); } catch (e) { SLUG = m[2]; }
  var API = 'https://wavzo-db.dakudinamoses.workers.dev/track';

  function send() { // counts the tap as a "share" in your stats (not for the owner, not on test sites)
    try {
      var host = location.hostname, owner = false;
      try { owner = !!localStorage.getItem('wz_key'); } catch (e) { /* ignore */ }
      var kind = TYPE === 'album' ? 'page' : TYPE, key = (TYPE === 'album' ? 'album-' : '') + SLUG;
      if (!(host === 'wavzo.com.ng' || host === 'www.wavzo.com.ng') || owner || !/^[\w.\-:~%]{1,120}$/.test(key)) return;
      var body = JSON.stringify({ ev: 'share', kind: kind, key: key, ref: document.referrer || '' });
      if (navigator.sendBeacon) { navigator.sendBeacon(API, new Blob([body], { type: 'text/plain' })); return; }
      fetch(API, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } });
    } catch (e) { /* ignore */ }
  }
  function meta(p) { var el = document.querySelector('meta[property="' + p + '"]'); return el ? (el.getAttribute('content') || '') : ''; }
  function info() {
    var url = (meta('og:url') || location.origin + location.pathname).split('#')[0].split('?')[0];
    var title = (meta('og:title') || document.title || 'WAVZO').replace(/\s*\|\s*WAVZO\s*$/i, '').trim();
    var lead = TYPE === 'artist' ? '\uD83C\uDFA4 ' : '\uD83C\uDFB5 ';
    var ask = TYPE === 'artist' ? 'Songs and downloads on WAVZO: ' : 'Download on WAVZO: ';
    return { url: url + '?utm_source=share', title: title, text: lead + title + '\n' + ask };
  }

  function build() {
    var css = document.createElement('style');
    css.textContent = '.wzsh{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 16px;font-family:inherit}' +
      '.wzsh a,.wzsh button{display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:1 1 auto;min-width:104px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;padding:11px 16px;border-radius:999px;font:700 13px/1 inherit;cursor:pointer;text-decoration:none}' +
      '.wzsh .wa{background:#25d366;border-color:#25d366;color:#fff}.wzsh .wa:active{background:#1ebe5b}';
    document.head.appendChild(css);
    var bar = document.createElement('div');
    bar.className = 'wzsh';
    bar.setAttribute('aria-label', 'Share');
    var wa = document.createElement('a');
    wa.className = 'wa'; wa.target = '_blank'; wa.rel = 'noopener'; wa.textContent = '\uD83D\uDCF2 WhatsApp';
    wa.addEventListener('click', function () { var i = info(); wa.href = 'https://wa.me/?text=' + encodeURIComponent(i.text + i.url); send(); });
    wa.href = 'https://wa.me/';
    bar.appendChild(wa);
    if (navigator.share) {
      var sh = document.createElement('button');
      sh.type = 'button'; sh.textContent = '\u2197 Share';
      sh.addEventListener('click', function () { var i = info(); send(); navigator.share({ title: i.title, text: i.text.trim(), url: i.url }).catch(function () { /* cancelled */ }); });
      bar.appendChild(sh);
    }
    var cp = document.createElement('button');
    cp.type = 'button'; cp.textContent = '\uD83D\uDD17 Copy link';
    cp.addEventListener('click', function () {
      var i = info(), done = function () { cp.textContent = '\u2713 Copied'; setTimeout(function () { cp.textContent = '\uD83D\uDD17 Copy link'; }, 2000); };
      send();
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(i.url).then(done, function () { window.prompt('Copy this link', i.url); });
      else window.prompt('Copy this link', i.url);
    });
    bar.appendChild(cp);
    return bar;
  }
  function place() {
    if (document.querySelector('.wzsh')) return;
    var bar = build(), hero = document.querySelector('.hero'), h1 = document.querySelector('h1');
    if (hero) hero.insertAdjacentElement('afterend', bar);
    else if (h1) h1.insertAdjacentElement('afterend', bar);
    else return;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
})();
