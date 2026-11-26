'use strict';
// Usage: node supabase/copy-d1.js [--dry-run]
// Copies D1 tables mail, uv, seen_feed_item into Supabase (email_sends, uv, seen_feed_item).
// READ-ONLY on D1. Existing Supabase rows are never overwritten (ignore-duplicates).
const { rest } = require('./lib');
const dry = process.argv.includes('--dry-run');
const A = process.env.CF_ACCOUNT_ID, D = process.env.CF_D1_ID, T = process.env.CF_API_TOKEN;
if (!A || !D || !T) { console.error('Missing CF_ACCOUNT_ID / CF_D1_ID / CF_API_TOKEN in .env'); process.exit(1); }

async function d1(sql, params = []) {
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + A + '/d1/database/' + D + '/query', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
    signal: AbortSignal.timeout(60000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error('D1 HTTP ' + r.status + ' ' + JSON.stringify(j.errors || []).slice(0, 200));
  return j.result[0].results || [];
}

const JOBS = [
  { from: 'mail', to: 'email_sends', cols: 'slug,ts,sent,failed,subject', order: 'slug', conflict: 'slug', page: 500, map: (r) => ({ slug: r.slug, ts: r.ts, sent: r.sent, failed: r.failed, subject: r.subject, error: null }) },
  { from: 'uv', to: 'uv', cols: 'day,key,ev,h,n', order: 'day,key,ev,h', conflict: 'day,key,ev,h', page: 1000, map: (r) => r },
  { from: 'seen_feed_item', to: 'seen_feed_item', cols: 'link,seen_at', order: 'link', conflict: 'link', page: 2000, map: (r) => r }
];

(async () => {
  for (const j of JOBS) {
    let read = 0;
    process.stdout.write(j.from.padEnd(16) + '-> ' + j.to.padEnd(16));
    for (let off = 0; ; off += j.page) {
      const rows = await d1('SELECT ' + j.cols + ' FROM ' + j.from + ' ORDER BY ' + j.order + ' LIMIT ' + j.page + ' OFFSET ' + off);
      read += rows.length;
      if (!dry && rows.length) {
        for (let i = 0; i < rows.length; i += 500) {
          await rest('POST', j.to, { query: 'on_conflict=' + j.conflict, body: rows.slice(i, i + 500).map(j.map), prefer: 'resolution=ignore-duplicates,return=minimal' });
        }
      }
      if (rows.length < j.page) break;
    }
    console.log(read + ' rows read' + (dry ? ' (dry run, nothing written)' : ' and sent'));
  }
  console.log(dry ? '\nDry run finished.' : '\nCopy finished. Now run: node supabase/counts.js');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
