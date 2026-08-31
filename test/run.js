/* Chạy cả bốn bộ kiểm tra, tổng kết pass/fail.
   Dùng: cd test && npm install && npm test   (sau khi đã python build.py) */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname)
  .filter(f => /^\d\d-.*\.js$/.test(f))
  .sort();

/* A file that throws stops where it threw. Counting only the PASS and FAIL
   lines it printed before that, it reads as a short file that passed — which
   is how three of them sat here crashed, quietly not checking the things they
   were written to check, while the total went up every week. A crash is a
   failure, counted as one, with the throw printed under it. */
let pass = 0, fail = 0;
for (const f of files) {
  let out = '', crash = '';
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  } catch (err) {
    out = (err.stdout || '') + '\n' + (err.stderr || '');
    crash = (err.stderr || '').split('\n').filter(Boolean).slice(-4).join(' | ')
      || 'exited ' + err.status;
  }
  const lines = out.split('\n').filter(l => /^(PASS|FAIL)/.test(l));
  const p = lines.filter(l => l.startsWith('PASS')).length;
  const q = lines.filter(l => l.startsWith('FAIL')).length + (crash ? 1 : 0);
  pass += p;
  fail += q;
  console.log('\n== ' + f + '  (' + p + ' pass, ' + q + ' fail)');
  for (const l of lines) if (l.startsWith('FAIL')) console.log('   ' + l);
  if (crash) console.log('   FAIL  it stopped before the end: ' + crash);
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
