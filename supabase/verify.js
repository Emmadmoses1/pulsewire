'use strict';
// Usage:  node supabase/verify.js [backups/full-XXXX.json]
// Prints only counts, slugs/ids and field NAMES. Never prints content, emails or secrets.
const { selectAll, fromRows, canon, same, diffList, loadBackup, newestBackup } = require('./lib');

(async () => {
  const file = process.argv[2] || newestBackup();
  const orig = loadBackup(file);
  console.log('Backup file:', file, '\nReading Supabase ...');
  const R = {
    posts: await selectAll('posts', 'legacy_pos.asc'),
    post_comments: await selectAll('post_comments', 'id.asc'),
    songs: await selectAll('songs', 'legacy_pos.asc'),
    artists: await selectAll('artists', 'legacy_pos.asc'),
    country_views: await selectAll('country_views', 'country.asc'),
    page_views: await selectAll('page_views', 'id.asc'),
    site_settings: await selectAll('site_settings', 'key.asc'),
    site_secrets: await selectAll('site_secrets', 'key.asc'),
    admin_users: await selectAll('admin_users', 'username.asc')
  };
  const now = fromRows(R);
  const problems = [];
  problems.push(...diffList('posts', (orig.posts || []).map(canon.posts), now.posts.map(canon.posts), (x) => x.slug));
  problems.push(...diffList('songs', (orig.songs || []).map(canon.songs), now.songs.map(canon.songs), (x) => x.id));
  problems.push(...diffList('artists', (orig.artists || []).map(canon.artists), now.artists.map(canon.artists), (x) => x.id));
  problems.push(...diffList('views', (orig.views || []).map(canon.views), now.views.map(canon.views), (x) => x.path));
  const cv = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, Number(v)]));
  if (!same(cv(orig.countryViews), cv(now.countryViews))) problems.push('countryViews: differs');
  if (orig.admin && !same(orig.admin, now.admin)) problems.push('admin: differs');
  const handled = ['posts', 'songs', 'artists', 'countryViews', 'views', 'articles', 'admin'];
  for (const k of Object.keys(orig)) if (!handled.includes(k) && !same(orig[k], now[k])) problems.push('setting "' + k + '": differs or missing');

  const c = (a) => String((a || []).length).padStart(5);
  console.log('\n                original  supabase');
  console.log('posts          ' + c(orig.posts) + '     ' + c(now.posts));
  console.log('songs          ' + c(orig.songs) + '     ' + c(now.songs));
  console.log('artists        ' + c(orig.artists) + '     ' + c(now.artists));
  console.log('page views     ' + c(orig.views) + '     ' + c(now.views));
  console.log('comments+reply ' + String((orig.posts || []).reduce((n, p) => n + (p.comments || []).reduce((m, x) => m + 1 + (x.replies || []).length, 0), 0)).padStart(5) + '     ' + c(R.post_comments));
  if (problems.length) { console.log('\nMISMATCHES (' + problems.length + '):'); problems.forEach((p) => console.log('  - ' + p)); process.exit(1); }
  console.log('\nALL MATCH. Every record in the backup is in Supabase with identical values.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
