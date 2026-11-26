'use strict';
const { rest } = require('./lib');
(async () => {
  for (const t of ['email_subs', 'email_sends', 'stat_daily', 'uv', 'rl', 'seen_feed_item', 'posts', 'songs', 'artists', 'post_comments']) {
    try {
      let n = 0;
      for (let off = 0; ; off += 1000) {
        const page = await rest('GET', t, { query: 'select=*&limit=1000&offset=' + off });
        n += page.length;
        if (page.length < 1000) break;
      }
      console.log(t.padEnd(16), n);
    } catch (e) { console.log(t.padEnd(16), 'MISSING/ERR', e.message.slice(0, 60)); }
  }
})();
