/* sheet-sync.gs (chạy trong Google Sheet) phải bóc ra đúng cùng dữ liệu như
   parse_sheet.py (chạy trên máy). Hai bản viết bằng hai ngôn ngữ khác nhau
   nên đây là phép kiểm quan trọng nhất của cả đường đồng bộ.

   Chạy sheet-sync.gs trong Node với ảnh chụp thô của các tab (grids.json,
   do parse_sheet.py sinh ra) thay cho SpreadsheetApp thật. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, read, ok, done } = require('./helpers');

const gridsPath = path.join(__dirname, 'grids.json');
if (!fs.existsSync(gridsPath)) {
  console.log('PASS  bỏ qua: chưa có grids.json (chạy python parse_sheet.py để sinh)');
  console.log('(1 pass, 0 fail)');
  return;
}

const grids = JSON.parse(fs.readFileSync(gridsPath, 'utf8'));
const src = read('sheet-sync.gs');

// Google Sheet trả về chuỗi đã định dạng; ảnh chụp giữ nguyên giá trị thô.
const sandbox = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: name => {
        const g = grids[name];
        if (!g) return null;
        return {
          getLastRow: () => g.length,
          getLastColumn: () => 4,
          getRange: () => ({ getDisplayValues: () => g }),
        };
      },
    }),
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(src + '\nthis.__buildData = buildData;', sandbox);

const fromSheet = sandbox.__buildData().entries;
const fromPython = JSON.parse(read('dataset.json')).entries;

ok('sheet-sync.gs nạp và chạy được', Array.isArray(fromSheet), fromSheet.length + ' mục');
ok('cùng số mục với parse_sheet.py', fromSheet.length === fromPython.length,
   fromSheet.length + ' (Apps Script) so với ' + fromPython.length + ' (Python)');

const key = e => [e.type, e.word, e.pos, e.ipa, e.note,
  e.senses.map(s => s.def + '|' + s.vi + '|' + s.eg.join('¶')).join('§')].join('◊');

let diff = 0, firstDiff = '';
const n = Math.min(fromSheet.length, fromPython.length);
for (let i = 0; i < n; i++) {
  if (key(fromSheet[i]) !== key(fromPython[i])) {
    if (!diff) {
      firstDiff = '#' + i + '  gs: ' + key(fromSheet[i]).slice(0, 110)
        + '\n            py: ' + key(fromPython[i]).slice(0, 110);
    }
    diff++;
  }
}
ok('mọi mục khớp từng chữ', diff === 0,
   diff ? diff + ' mục lệch, đầu tiên: ' + firstDiff : n + ' mục giống hệt');

const senses = a => a.reduce((n, e) => n + e.senses.length, 0);
ok('cùng số nghĩa', senses(fromSheet) === senses(fromPython),
   senses(fromSheet) + ' so với ' + senses(fromPython));

const egs = a => a.reduce((n, e) => n + e.senses.reduce((m, s) => m + s.eg.length, 0), 0);
ok('cùng số ví dụ', egs(fromSheet) === egs(fromPython),
   egs(fromSheet) + ' so với ' + egs(fromPython));

ok('bản đồng bộ không kèm bài đọc', sandbox.__buildData().readings.length === 0);

// vài mảnh dễ sai nhất
const find = (a, w) => a.find(e => e.word === w);
for (const w of ['aardvark', 'make up for', 'zenith', 'abject']) {
  const g = find(fromSheet, w), p = find(fromPython, w);
  ok('  khớp ở "' + w + '"', !!g && !!p && key(g) === key(p),
     g ? g.pos + ' ' + g.ipa + ' · ' + g.senses.length + ' nghĩa' : 'không thấy');
}

done();
