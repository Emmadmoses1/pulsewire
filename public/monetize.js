// WAVZO download earnings. Runs right after a download starts. Settings live in /money-config.json
(function () {
  var cfg = { smartLink: '', everyNthDownload: 1, showBanner: false };
  // load settings early, so the click handler can open the ad link instantly (browsers need that)
  fetch('/money-config.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (j) { for (var k in j) cfg[k] = j[k]; })
    .catch(function () {});

  function everyNth() {
    var n = Math.max(1, parseInt(cfg.everyNthDownload, 10) || 1);
    try {
      var c = (parseInt(localStorage.getItem('wz_dl_count'), 10) || 0) + 1;
      localStorage.setItem('wz_dl_count', String(c));
      return c % n === 0;
    } catch (e) { return true; }
  }

  function showBanner() {
    var o = document.createElement('div');
    o.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:16px';
    o.innerHTML =
      '<div style="background:#111;color:#fff;border-radius:14px;max-width:360px;width:100%;padding:16px;text-align:center;font-family:Inter,Arial,sans-serif">' +
      '<div style="font-weight:700;font-size:16px">\u2705 Your download has started</div>' +
      '<div style="font-size:12px;color:#aaa;margin:6px 0 10px">Thanks for supporting WAVZO</div>' +
      '<iframe src="/banner.html" style="width:100%;height:290px;border:0;border-radius:8px;background:#000" scrolling="no"></iframe>' +
      '<button type="button" style="margin-top:12px;padding:12px 18px;border:0;border-radius:8px;background:#e63329;color:#fff;font-weight:700;width:100%;font-size:14px">Close</button></div>';
    function close() { if (o.parentNode) o.parentNode.removeChild(o); }
    o.querySelector('button').onclick = close;
    document.body.appendChild(o);
    setTimeout(close, 15000);
  }

  window.wzMonetize = function () {
    var link = /^https:\/\//i.test(cfg.smartLink || '') ? cfg.smartLink : '';
    if (!link && !cfg.showBanner) return;
    if (link && everyNth()) { try { window.open(link, '_blank', 'noopener'); } catch (e) {} }
    if (cfg.showBanner) showBanner();
  };
})();
