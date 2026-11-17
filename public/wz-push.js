/* WAVZO alerts: a small bell and a polite prompt. Nothing is asked until the reader taps Allow. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  var KEY = null, bell = null, sheet = null;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function u8(b64) { var p = '='.repeat((4 - b64.length % 4) % 4), s = (b64 + p).replace(/-/g, '+').replace(/_/g, '/'), r = atob(s), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  navigator.serviceWorker.register('/sw.js').catch(function () {});

  var css = document.createElement('style');
  css.textContent = '#pushSheet{position:fixed;left:12px;right:12px;bottom:14px;max-width:460px;margin:0 auto;z-index:900;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;border-radius:20px;background:var(--card,#fff);color:var(--text,#111);border:1px solid var(--line,#e6e6ee);box-shadow:0 24px 50px -20px rgba(0,0,0,.55);font-family:Inter,system-ui,sans-serif}' +
    '#pushSheet img{width:44px;height:44px;border-radius:12px}#pushSheet div{flex:1;min-width:150px}#pushSheet b{display:block;font-size:14px}#pushSheet span{font-size:12px;opacity:.7}' +
    '#pushSheet button{border:0;border-radius:999px;padding:10px 18px;font-weight:800;font-size:12px;cursor:pointer;font-family:inherit}#pushSheet .y{background:linear-gradient(135deg,#e5202f,#ff7a45);color:#fff}#pushSheet .n{background:transparent;color:inherit;opacity:.7}' +
    '#pushBell{font-size:16px}.wzpt{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#111;color:#fff;padding:12px 18px;border-radius:999px;font:600 13px Inter,system-ui,sans-serif;z-index:950}';
  document.head.appendChild(css);
  function toast(m) { var t = document.createElement('div'); t.className = 'wzpt'; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }

  async function pubKey() {
    if (KEY !== null) return KEY;
    try { KEY = (await (await fetch('/api/push/key')).json()).key || ''; } catch (e) { KEY = ''; }
    return KEY;
  }
  async function sync(sub) { await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) }); set('wz_push_sync', String(Date.now())); }
  function hideUI() { if (bell) { bell.remove(); bell = null; } if (sheet) { sheet.remove(); sheet = null; } }
  async function enable() {
    var k = await pubKey();
    if (!k) return false;
    if (Notification.permission === 'denied') { toast('Alerts are blocked in your browser settings.'); return false; }
    var perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') { set('wz_push_no', String(Date.now())); hideUI(); return false; }
    var reg = await navigator.serviceWorker.ready;
    var sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(k) });
    await sync(sub); set('wz_push', 'on'); hideUI(); toast('You will now get news alerts \uD83D\uDD14');
    return true;
  }
  function showBell() {
    var host = document.querySelector('.acts') || document.getElementById('siteNav');
    if (bell || !host) return;
    bell = document.createElement('button'); bell.id = 'pushBell'; bell.className = 'ibtn'; bell.type = 'button';
    bell.setAttribute('aria-label', 'Get news alerts'); bell.innerHTML = '\uD83D\uDD14'; bell.onclick = function () { enable(); };
    host.insertBefore(bell, host.firstChild);
  }
  function showSheet() {
    if (sheet || Notification.permission !== 'default') return;
    sheet = document.createElement('div'); sheet.id = 'pushSheet';
    sheet.innerHTML = '<img src="/images/wavzo-icon-192.png" alt=""><div><b>Get breaking news alerts</b><span>New stories and music, with pictures, on your phone.</span></div><button class="y" type="button">Allow</button><button class="n" type="button">Not now</button>';
    sheet.querySelector('.y').onclick = function () { enable(); };
    sheet.querySelector('.n').onclick = function () { set('wz_push_no', String(Date.now())); sheet.remove(); sheet = null; };
    document.body.appendChild(sheet);
  }
  async function boot() {
    var k = await pubKey();
    if (!k) return;                                   // the server is not set up for alerts: do nothing at all
    if (Notification.permission === 'granted') {      // keep the server's list fresh every 3 days
      try { var reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub && Date.now() - (+get('wz_push_sync') || 0) > 3 * 864e5) sync(sub); } catch (e) { /* ignore */ }
      return;
    }
    if (Notification.permission === 'denied') return;
    showBell();
    var visits = +get('wz_visits') || 0;
    try { if (!sessionStorage.getItem('wz_vs')) { visits++; set('wz_visits', String(visits)); sessionStorage.setItem('wz_vs', '1'); } } catch (e) { /* ignore */ }
    if (visits >= 2 && Date.now() - (+get('wz_push_no') || 0) > 7 * 864e5) setTimeout(showSheet, 15000);
  }
  window.wzPush = { enable: enable };
  window.addEventListener('load', function () { setTimeout(boot, 1500); });
})();
