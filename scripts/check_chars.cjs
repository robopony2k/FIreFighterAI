const fs = require('fs');
const path = 'src/render/threeTest.ts';
const s = fs.readFileSync(path, 'utf8');
let found = false;
for (let i = 0; i < s.length; i++) {
  const ch = s.charCodeAt(i);
  if ((ch >= 0 && ch < 9) || ch === 11 || ch === 12 || (ch > 13 && ch < 32)) {
    found = true;
    const lines = s.slice(0, i).split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    console.log(`control char ${ch} at index ${i} line ${line} col ${col}`);
  }
}
if (!found) console.log('no control chars found');
