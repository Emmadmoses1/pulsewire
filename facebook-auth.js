require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'].join(',');
const TARGET_PAGE_NAME = 'Wavzo Ng';

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'storage');
const FB_CONFIG_PATH = path.join(STORAGE_DIR, 'data', 'facebook.json');

function saveFacebookConnection(page) {
  fs.mkdirSync(path.dirname(FB_CONFIG_PATH), { recursive: true });
  const data = {
    pageId: page.id,
    pageName: page.name,
    pageAccessToken: page.access_token,
    connectedAt: new Date().toISOString()
  };
  fs.writeFileSync(FB_CONFIG_PATH, JSON.stringify(data, null, 2));
  return data;
}

function getFacebookConnection() {
  if (!fs.existsSync(FB_CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(FB_CONFIG_PATH, 'utf8'));
}

// "Connect" button links here
router.get('/auth/facebook', (req, res) => {
  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}&response_type=code`;
  res.redirect(authUrl);
});

// Facebook redirects back here with ?code=
router.get('/auth/facebook/callback', async (req, res) => {
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

    const targetPage = (pagesData.data || []).find(p => p.name === TARGET_PAGE_NAME);

    if (!targetPage) {
      return res.status(404).send(`Page "${TARGET_PAGE_NAME}" not found among your managed pages. Available: ${(pagesData.data || []).map(p => p.name).join(', ')}`);
    }

    saveFacebookConnection(targetPage);

    res.redirect('/admin/dashboard?fb_connected=1');
  } catch (e) {
    console.error('Facebook OAuth error:', e);
    res.status(500).send('Something went wrong connecting to Facebook');
  }
});

// Check connection status (for the admin dashboard to show "Connected" state)
router.get('/admin/facebook-status', (req, res) => {
  const conn = getFacebookConnection();
  if (!conn) return res.json({ connected: false });
  res.json({ connected: true, pageName: conn.pageName, pageId: conn.pageId, connectedAt: conn.connectedAt });
});

module.exports = router;
module.exports.getFacebookConnection = getFacebookConnection;
