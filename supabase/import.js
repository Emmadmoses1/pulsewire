'use strict';
// Usage:  node supabase/import.js [--dry-run] [backups/full-XXXX.json]
// Reads a LOCAL backup file and writes it into Supabase. Never touches JSONBin or the live site.
const { upsert, insert, rest, toRows, loadBackup, newestBackup } = require('./lib');

(async () => {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const file = args.find((a) => !a.startsWith('--')) || newestBackup();
  console.log('Backup file:', file);
  const { T, fatal, warn } = toRows(loadBackup(file));
  console.log('\nRows to import:');
  for (const [k, v] of Object.entries(T)) console.log('  ' + k.padEnd(14), v.length);
  if (warn.length) { console.log('\nWarnings (' + warn.length + '):'); warn.slice(0, 15).forEach((w) => console.log('  - ' + w)); }
  if (fatal.length) { console.log('\nSTOPPED. Fix these first (nothing was written):'); fatal.slice(0, 25).forEach((w) => console.log('  - ' + w)); process.exit(1); }
  if (dry) return console.log('\nDry run only. Nothing was written.');

  const step = async (name, fn) => { process.stdout.write('Importing ' + name + ' ... '); await fn(); console.log('done'); };
  await step('categories', () => upsert('categories', T.categories, 'slug', 200));
  await step('artists', () => upsert('artists', T.artists, 'id', 200));
  await step('songs', () => upsert('songs', T.songs, 'id', 100));
  await step('posts', () => upsert('posts', T.posts, 'slug', 40));
  await step('comments', () => upsert('post_comments', T.comments, 'id', 200));
  await step('replies', () => upsert('post_comments', T.replies, 'id', 200));
  await step('country_views', () => upsert('country_views', T.country_views, 'country', 200));
  await step('site_settings', () => upsert('site_settings', T.site_settings, 'key', 50));
  await step('site_secrets', () => upsert('site_secrets', T.site_secrets, 'key', 50));
  await step('admin_users', () => upsert('admin_users', T.admin_users, 'username', 50));
  await step('page_views', async () => {
    const have = await rest('GET', 'page_views', { query: 'select=id&limit=1' });
    if (have.length) return process.stdout.write('(skipped, table already has rows) ');
    await insert('page_views', T.page_views, 200);
  });
  console.log('\nImport finished. Now run:  node supabase/verify.js');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
