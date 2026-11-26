'use strict';
// Usage: node patch-worker.js path/to/wavzo-db-sb.js
// Writes a NEW file next to it (wavzo-db-sb-v6.js). Your original is never changed.
const fs = require('fs');
const path = require('path');
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('Give the path of wavzo-db-sb.js'); process.exit(1); }
let t = fs.readFileSync(src, 'utf8');

function between(start, end, replacement) {
  const a = t.indexOf(start);
  if (a < 0 || t.indexOf(start, a + 1) >= 0) throw new Error('start marker not found exactly once: ' + start.slice(0, 50));
  const b = t.indexOf(end, a);
  if (b < 0) throw new Error('end marker not found: ' + end.slice(0, 50));
  t = t.slice(0, a) + replacement + t.slice(b + end.length);
}
function swap(from, to) {
  const a = t.indexOf(from);
  if (a < 0 || t.indexOf(from, a + 1) >= 0) throw new Error('text not found exactly once: ' + from.slice(0, 50));
  t = t.replace(from, () => to);
}

between('async function checkAdmin(env, key) {', 'return !!env.ADMIN_KEY && same(key, env.ADMIN_KEY);\n}', String.raw`async function checkAdmin(env, key) {
  if (!key) return false;
  let row = null;
  try { row = ((await sb(env, 'GET', 'site_secrets?select=value&key=eq.wz_admin_hash&limit=1')) || [])[0]; } catch (e) {}
  const v = row && typeof row.value === 'string' ? row.value : '';
  if (v) {
    const [salt, hash] = v.split(':');
    return same(await sha256hex(salt + key), hash);
  }
  return !!env.ADMIN_KEY && same(key, env.ADMIN_KEY);
}`);
swap('(stored in D1) wins', '(stored in Supabase) wins');

between("  await env.DB.batch([\n    env.DB.prepare('CREATE TABLE IF NOT EXISTS seen_feed_item", '}).filter(Boolean));', String.raw`  const postedLinks = new Set(
    (await sbAll(env, 'posts?select=source_url&source_url=not.is.null&order=slug.asc')).map((p) => p.source_url).filter(Boolean)
  );`);

between('  const seenSet = new Set();', "(l, now)));\n  }", String.raw`  const seenSet = new Set();
  const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  for (let i = 0; i < uniqueLinks.length; i += 25) {
    const chunk = uniqueLinks.slice(i, i + 25);
    const rows = (await sb(env, 'GET', 'seen_feed_item?select=link&link=in.(' + encodeURIComponent(chunk.map(q).join(',')) + ')')) || [];
    rows.forEach((r) => seenSet.add(r.link));
  }

  const anySeen = (await sb(env, 'GET', 'seen_feed_item?select=link&limit=1')) || [];
  const isBootstrap = anySeen.length === 0;

  const toInsert = uniqueLinks.filter((l) => !seenSet.has(l));
  const now = Date.now();
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    await sb(env, 'POST', 'seen_feed_item?on_conflict=link', chunk.map((l) => ({ link: l, seen_at: now })), 'resolution=ignore-duplicates,return=minimal');
  }`);

between("      await env.DB.batch([\n        env.DB.prepare('CREATE TABLE IF NOT EXISTS config", '      ]);', String.raw`      try {
        await sb(env, 'POST', 'site_secrets?on_conflict=key', { key: 'wz_admin_hash', value: salt + ':' + (await sha256hex(salt + next)), updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal');
      } catch (e) { return reply({ message: 'Could not save the new password' }, 500); }`);

swap('// (still on D1 for now: needs the "DB" binding, which this test Worker does not have)', '// (now on Supabase: feed-watch no longer needs the D1 "DB" binding)');
swap("v: 5, store:", "v: 6, store:");

const out = path.join(path.dirname(path.resolve(src)), 'wavzo-db-sb-v6.js');
fs.writeFileSync(out, t);
console.log('Wrote', out);
console.log('Remaining D1 uses (should be only the site document):');
t.split('\n').forEach((l, i) => { if (/env\.DB/.test(l)) console.log('  line ' + (i + 1) + ': ' + l.trim().slice(0, 70)); });
