'use strict';
// Usage: node supabase/check.js  (read-only; prints only table/function NAMES and row counts)
const { rest } = require('./lib');
(async () => {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const h = { apikey: key };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  const r = await fetch(base + '/rest/v1/', { headers: h });
  if (!r.ok) throw new Error('OpenAPI HTTP ' + r.status);
  const paths = Object.keys((await r.json()).paths || {});
  const rpcs = paths.filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5)).sort();
  const tables = paths.filter((p) => !p.startsWith('/rpc/') && p !== '/').map((p) => p.slice(1)).sort();
  console.log('TABLES:', tables.join(', ') || '(none)');
  console.log('FUNCTIONS:', rpcs.join(', ') || '(none)');
  console.log('');
  for (const t of ['email_subs', 'email_sends', 'posts', 'songs', 'artists', 'post_comments', 'page_views']) {
    if (!tables.includes(t)) { console.log(t.padEnd(14), 'MISSING'); continue; }
    try { const rows = await rest('GET', t, { query: 'select=*&limit=1000' }); console.log(t.padEnd(14), 'exists, rows:', rows.length >= 1000 ? '1000+' : rows.length); }
    catch (e) { console.log(t.padEnd(14), 'exists, unreadable:', e.message.slice(0, 80)); }
  }
  const need = ['bump_post_counter', 'bump_country_view', 'like_comment', 'react_post', 'wz_limited', 'wz_track', 'wz_stats'];
  console.log('\nFunctions still missing:', need.filter((n) => !rpcs.includes(n)).join(', ') || 'none');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
