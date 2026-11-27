require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'].join(',');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'storage');
const FB_CONFIG_PATH = path.join(STORAGE_DIR, 'data', 'facebook.json');

// Connection is kept in Supabase (site_secrets, key FB_KEY) so it survives Render redeploys.
// The local file is only a fallback when Supabase is unreachable.
const FB_KEY = 'fb_page_connection';
const sb = require('./supabase/lib');
let fbCache = null, fbAt = 0;

async function saveFacebookConnection(page) {
  const data = {
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token,
    connectedAt: new Date().toISOString()
  };
  try { fs.mkdirSync(path.dirname(FB_CONFIG_PATH), { recursive: true }); fs.writeFileSync(FB_CONFIG_PATH, JSON.stringify(data, null, 2)); } catch (e) { /* ignore */ }
  await sb.upsert('site_secrets', [{ key: FB_KEY, value: data }], 'key');
  fbCache = data; fbAt = Date.now();
  return data;
}

async function getFacebookConnection() {
  if (fbCache && Date.now() - fbAt < 60000) return fbCache;
  try {
    const rows = await sb.rest('GET', 'site_secrets', { query: 'select=value&key=eq.' + FB_KEY + '&limit=1' });
    if (rows && rows[0] && rows[0].value && rows[0].value.pageAccessToken) { fbCache = rows[0].value; fbAt = Date.now(); return fbCache; }
  } catch (e) { console.error('facebook connection read (supabase):', e.message); }
  try {
    if (fs.existsSync(FB_CONFIG_PATH)) {
      const d = JSON.parse(fs.readFileSync(FB_CONFIG_PATH, 'utf8'));
      if (d && d.pageAccessToken) { sb.upsert('site_secrets', [{ key: FB_KEY, value: d }], 'key').catch(() => {}); fbCache = d; fbAt = Date.now(); return d; }
    }
  } catch (e) { /* ignore */ }
  return null;
}

function requireAdminSession(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

router.get('/auth/facebook', requireAdminSession, (req, res) => {
  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}&response_type=code`;
  res.redirect(authUrl);
});

router.get('/auth/facebook/callback', requireAdminSession, async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Facebook auth error: ${error}`);
  if (!code) return res.status(400).send('Missing authorization code');

  try {
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${APP_SECRET}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ error: 'Token exchange failed', details: tokenData });
    }

    const longLivedRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longLivedData = await longLivedRes.json();
    const userToken = longLivedData.access_token || tokenData.access_token;

    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];

    if (!pages.length) {
      return res.status(404).send('No Facebook Pages found for this account. Make sure you are an admin of at least one Page.');
    }

    if (pages.length === 1) {
      await saveFacebookConnection(pages[0]);
      return res.redirect('/admin/dashboard?fb_connected=1');
    }

    req.session.fbPagesTemp = pages;
    const options = pages.map((p, i) =>
      `<a href="/auth/facebook/select?i=${i}" style="display:block;padding:14px 18px;margin:8px 0;background:#1877f2;color:#fff;border-radius:8px;text-decoration:none;font-family:sans-serif;font-weight:600">${p.name}</a>`
    ).join('');
    res.send(`
      <html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;padding:0 20px">
        <h2>Choose a Page to connect</h2>
        <p style="color:#666">Select which Facebook Page WAVZO should post to.</p>
        ${options}
      </body></html>
    `);
  } catch (e) {
    console.error('Facebook OAuth error:', e);
    res.status(500).send('Something went wrong connecting to Facebook');
  }
});

router.get('/auth/facebook/select', requireAdminSession, async (req, res) => {
  const i = parseInt(req.query.i, 10);
  const pages = req.session.fbPagesTemp;
  if (!pages || !pages[i]) return res.status(400).send('Selection expired — please reconnect Facebook.');
  try { await saveFacebookConnection(pages[i]); } catch (e) { return res.status(500).send('Could not save the Facebook connection: ' + e.message); }
  delete req.session.fbPagesTemp;
  res.redirect('/admin/dashboard?fb_connected=1');
});

router.get('/admin/facebook-status', requireAdminSession, async (req, res) => {
  const conn = await getFacebookConnection();
  if (!conn) return res.json({ connected: false });
  res.json({ connected: true, pageName: conn.pageName, pageId: conn.pageId, connectedAt: conn.connectedAt });
});

router.post('/admin/facebook-disconnect', requireAdminSession, async (req, res) => {
  fbCache = null; fbAt = 0;
  try { await sb.rest('DELETE', 'site_secrets', { query: 'key=eq.' + FB_KEY, prefer: 'return=minimal' }); } catch (e) { console.error('facebook disconnect:', e.message); }
  if (fs.existsSync(FB_CONFIG_PATH)) fs.unlinkSync(FB_CONFIG_PATH);
  res.json({ ok: true });
});

module.exports = router;
module.exports.getFacebookConnection = getFacebookConnection;
