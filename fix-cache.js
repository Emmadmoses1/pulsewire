const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'jsonbin-db.js');
let src = fs.readFileSync(file, 'utf8');

fs.writeFileSync(file + '.bak', src);

const oldRead = `  async read() {
    const res = await fetch(\`\${BASE_URL}/latest\`, { headers: { 'X-Master-Key': this.key } });
    if (!res.ok) throw new Error(\`JSONBin read failed: \${res.status}\`);
    this.data = (await res.json()).record;
    return this.data;
  }`;

const newRead = `  async read() {
    const now = Date.now();
    if (this._cachedAt && (now - this._cachedAt) < 15000) {
      return this.data;
    }
    const res = await fetch(\`\${BASE_URL}/latest\`, { headers: { 'X-Master-Key': this.key } });
    if (!res.ok) {
      if (this.data) return this.data;
      throw new Error(\`JSONBin read failed: \${res.status}\`);
    }
    this.data = (await res.json()).record;
    this._cachedAt = now;
    return this.data;
  }`;

if (!src.includes(oldRead)) {
  console.error('Exact read() block not found — no changes made. Paste jsonbin-db.js back so I can check.');
  process.exit(1);
}
src = src.replace(oldRead, newRead);
fs.writeFileSync(file, src);
console.log('jsonbin-db.js patched with 15s cache + stale-fallback.');
