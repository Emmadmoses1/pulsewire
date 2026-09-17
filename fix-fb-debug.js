const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'admin.html');
let src = fs.readFileSync(file, 'utf8');

fs.writeFileSync(file + '.bak-fbdebug', src);

const oldLine = "      alert('Facebook post failed: '+(data.error?.message||'Unknown error'));";
if (!src.includes(oldLine)) {
  console.error('Target line not found — aborting.');
  process.exit(1);
}
const newLine = "      console.error('Facebook API response:', data);\n      alert('Facebook post failed: '+JSON.stringify(data.error||data));";
src = src.replace(oldLine, newLine);
fs.writeFileSync(file, src);
console.log('admin.html patched for FB debug output.');
