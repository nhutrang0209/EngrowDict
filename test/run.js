/* Chạy cả bốn bộ kiểm tra, tổng kết pass/fail.
   Dùng: cd test && npm install && npm test   (sau khi đã python build.py) */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname)
  .filter(f => /^\d\d-.*\.js$/.test(f))
  .sort();

let pass = 0, fail = 0;
for (const f of files) {
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout || '') + '\n' + (err.stderr || '');
  }
  const lines = out.split('\n').filter(l => /^(PASS|FAIL)/.test(l));
  const p = lines.filter(l => l.startsWith('PASS')).length;
  const q = lines.filter(l => l.startsWith('FAIL')).length;
  pass += p;
  fail += q;
  console.log('\n== ' + f + '  (' + p + ' pass, ' + q + ' fail)');
  for (const l of lines) if (l.startsWith('FAIL')) console.log('   ' + l);
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
