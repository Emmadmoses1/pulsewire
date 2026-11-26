'use strict';
const { rest } = require('./lib');
(async () => {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const h = { apikey: key };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  const api = await (await fetch(base + '/rest/v1/', { headers: h })).json();
  for (const t of ['email_sends', 'uv', 'stat_daily', 'seen_feed_item']) {
    const def = (api.definitions || {})[t];
    console.log(t.padEnd(15), def ? Object.keys(def.properties).join(',') : 'MISSING');
  }
})().catch((e) => console.error('FAILED:', e.message));
