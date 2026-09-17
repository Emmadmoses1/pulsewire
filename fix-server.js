const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server-app.js');
let src = fs.readFileSync(file, 'utf8');

fs.writeFileSync(file + '.bak5', src);

const marker = "const db = new JsonBinDB(process.env.JSONBIN_KEY, { posts: [], articles: [], admin: { username: 'admin', password: 'changeme123' } });";
if (!src.includes(marker)) {
  console.error('Marker line not found — aborting, no changes made.');
  process.exit(1);
}
const helper = `

async function safeRead(res, fallbackMsg = 'Something went wrong. Please try again shortly.') {
  try {
    await db.read();
    return true;
  } catch (err) {
    console.error('DB read failed:', err.message);
    res.status(503).send(fallbackMsg);
    return false;
  }
}`;
src = src.replace(marker, marker + helper);
src = src.replace(/^( *)await db\.read\(\);/gm, '$1if (!(await safeRead(res))) return;');

fs.writeFileSync(file, src);
console.log('server-app.js patched — ' + (src.match(/safeRead\(res\)/g) || []).length + ' call sites updated.');
