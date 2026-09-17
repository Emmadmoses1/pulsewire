require('dotenv').config();
const express = require('express');
const router = express.Router();

const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'].join(',');

// Step 1: "Connect" button links here
router.get('/auth/facebook', (req, res) => {
  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}&response_type=code`;
  res.redirect(authUrl);
});

// Step 2: Facebook redirects back here with a ?code=
router.get('/auth/facebook/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Facebook auth error: ${error}`);
  if (!code) return res.status(400).send('Missing authorization code');

  try {
    // Exchange code for a short-lived user access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${APP_SECRET}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ error: 'Token exchange failed', details: tokenData });
    }

    // Exchange for a long-lived user token (~60 days)
    const longLivedRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longLivedData = await longLivedRes.json();
    const userToken = longLivedData.access_token || tokenData.access_token;

    // Get the list of Pages this user manages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();

    // pagesData.data is an array of { id, name, access_token, category, ... }
    // access_token here is the PAGE access token — store this per page, it doesn't expire
    // the same way the user token does (it's tied to the user token's validity).

    // TODO: render a page-picker UI using pagesData.data, then on selection
    // save { pageId, pageName, pageAccessToken } to your DB.

    res.json({ pages: pagesData.data });
  } catch (e) {
    console.error('Facebook OAuth error:', e);
    res.status(500).send('Something went wrong connecting to Facebook');
  }
});

module.exports = router;
