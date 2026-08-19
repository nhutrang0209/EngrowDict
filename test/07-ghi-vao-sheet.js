/* Đường ghi ngược web -> sheet, kiểm cả hai đầu:

   A. Phía web: nút Settings lưu link, thêm từ thì POST đúng nội dung, và
      khi chưa cấu hình thì không gọi mạng gì cả.
   B. Phía Apps Script: doPost chèn dòng vào đúng tab, đúng vị trí a→z, đúng
      định dạng — kiểm bằng cách bóc lại chính sheet đã bị chèn và xem từ mới
      có hiện ra nguyên vẹn không.

   Không chạm tới Google thật: SpreadsheetApp và fetch đều là đồ giả. Việc
   triển khai Web App và CORS thì phải thử trên máy thật. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const SETTINGS = 'so-tra-tu:settings:v1';
const CFG = { sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC/edit',
              webApp: 'https://script.google.com/macros/s/XYZ/exec',
              key: 'khoa-bi-mat' };

function page(store, posts, reply) {
  const g = boot({
    html: shell, full: true, store,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    dataFile: 'docs/data.json',
  });
  const realFetch = g.window.fetch;
  g.window.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') {
      posts.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply()) });
    }
    return realFetch(url, opts);
  };
  return g;
}

/* ---------------------------------------------------- A. phía web */
(async () => {
  // chưa cấu hình gì
  const posts0 = [];
  const a = page({}, posts0, () => ({ ok: true }));
  await wait(900);
  ok('có nút Cài đặt', !!a.doc.querySelector('#set-dlg') &&
     [...a.doc.querySelectorAll('.acts .btn')].some(b => b.getAttribute('aria-label') === 'Cài đặt'));
  ok('chưa cấu hình thì ẩn nút "Mở sheet"', a.doc.getElementById('open-sheet').hidden);
  ok('chưa cấu hình thì ẩn nút "Ghi vào sheet"', a.doc.getElementById('push-sheet').hidden);

  click(a.window, a.doc.querySelector('.acts .btn-primary'));
  ok('form thêm từ ẩn ô "ghi thẳng vào sheet"', a.doc.getElementById('to-sheet-row').hidden);
  a.doc.getElementById('form-dlg').close();

  // cấu hình qua hộp thoại Cài đặt
  const setDlg = a.doc.getElementById('set-dlg');
  setDlg.querySelector('[name=sheetUrl]').value = CFG.sheetUrl;
  setDlg.querySelector('[name=webApp]').value = CFG.webApp;
  setDlg.querySelector('[name=key]').value = CFG.key;
  const setFoot = [...setDlg.querySelectorAll('.dlg-foot .btn')];
  click(a.window, setFoot.find(b => b.textContent === 'Kiểm tra kết nối'));
  await wait(60);
  ok('nút Kiểm tra kết nối gửi ping', posts0.length === 1 && posts0[0].body.action === 'ping',
     JSON.stringify(posts0[0] && posts0[0].body));
  ok('ping mang theo mã khoá', posts0[0].body.key === CFG.key);
  ok('báo kết nối được', a.doc.getElementById('set-msg').textContent.includes('Kết nối được'),
     a.doc.getElementById('set-msg').textContent);

  click(a.window, setFoot.find(b => b.textContent === 'Lưu'));
  await wait(40);
  ok('cài đặt lưu vào localStorage', !!a.store[SETTINGS],
     (a.store[SETTINGS] || '').slice(0, 60));
  ok('cấu hình thật KHÔNG nằm trong tệp trang đem đăng',
     !shell.includes(CFG.key) && !shell.includes('/macros/s/XYZ/') &&
     !read('docs/data.json').includes(CFG.key),
     'chỉ có chuỗi gợi ý trong ô nhập, không có link hay khoá thật');
  ok('hiện nút "Mở sheet" đúng link', !a.doc.getElementById('open-sheet').hidden &&
     a.doc.getElementById('open-sheet').href === CFG.sheetUrl);

  // thêm từ -> phải POST
  click(a.window, a.doc.querySelector('.acts .btn-primary'));
  ok('form hiện ô "ghi thẳng vào sheet", mặc định bật',
     !a.doc.getElementById('to-sheet-row').hidden && a.doc.getElementById('to-sheet').checked);
  const dlg = a.doc.getElementById('form-dlg');
  dlg.querySelector('[name=word]').value = 'susurrus';
  dlg.querySelector('[name=pos]').value = 'n';
  dlg.querySelector('[name=ipa]').value = '/suːˈsʌr.əs/';
  dlg.querySelector('[name=def]').value = 'a soft murmuring or rustling sound';
  dlg.querySelector('[name=vi]').value = 'tiếng xào xạc';
  click(a.window, a.doc.getElementById('form-save'));
  await wait(200);

  const add = posts0[posts0.length - 1];
  ok('thêm từ thì POST lên Web App', add && add.body.action === 'add' && add.url === CFG.webApp);
  ok('POST mang đủ từ, phiên âm, nghĩa',
     add.body.entry.word === 'susurrus' && add.body.entry.ipa === '/suːˈsʌr.əs/' &&
     add.body.entry.senses[0].vi === 'tiếng xào xạc',
     JSON.stringify(add.body.entry).slice(0, 110));
  ok('POST không kèm header lạ (khỏi preflight)', !add.headers);
  ok('đánh dấu đã vào sheet', !!a.doc.querySelector('.kind-sheet'),
     a.doc.querySelector('.kind-sheet')?.textContent);
  ok('không còn từ nào chờ ghi', a.doc.getElementById('push-sheet').hidden);

  // sheet từ chối -> giữ từ lại và mời thử lại
  const posts1 = [];
  const b = page({ [SETTINGS]: JSON.stringify(CFG) }, posts1,
    () => ({ ok: false, error: 'Sai mã khoá' }));
  await wait(900);
  click(b.window, b.doc.querySelector('.acts .btn-primary'));
  const d2 = b.doc.getElementById('form-dlg');
  d2.querySelector('[name=word]').value = 'thole';
  d2.querySelector('[name=vi]').value = 'chịu đựng';
  click(b.window, b.doc.getElementById('form-save'));
  await wait(200);
  ok('sheet từ chối thì vẫn giữ từ trong máy', !!b.store['so-tra-tu:added:v1'] &&
     b.store['so-tra-tu:added:v1'].includes('thole'));
  ok('báo rõ lỗi và mời thử lại',
     b.doc.getElementById('banner').textContent.includes('Sai mã khoá'),
     b.doc.getElementById('banner').textContent.slice(0, 74));
  ok('hiện nút ghi lại số từ còn treo',
     !b.doc.getElementById('push-sheet').hidden &&
     b.doc.getElementById('push-sheet').textContent.includes('1 từ'),
     b.doc.getElementById('push-sheet').textContent);

  /* -------------------------------------------- B. phía Apps Script */
  const grids = JSON.parse(fs.readFileSync(path.join(__dirname, 'grids.json'), 'utf8'));

  // sheet giả: đủ các lệnh mà sheet-sync.gs dùng tới
  function fakeSheet(rows) {
    const g = rows.map(r => r.slice());
    return {
      grid: g,
      getLastRow: () => g.length,
      getMaxColumns: () => 4,
      getLastColumn: () => 4,
      insertRowsBefore: (at, n) => {
        for (let i = 0; i < n; i++) g.splice(at - 1, 0, ['', '', '', '']);
      },
      getRange: (row, col, nRows, nCols) => ({
        getDisplayValues: () => g.slice(row - 1, row - 1 + nRows).map(r => r.slice(col - 1, col - 1 + nCols)),
        setValues: vals => {
          for (let i = 0; i < vals.length; i++) {
            while (g.length < row - 1 + i + 1) g.push(['', '', '', '']);
            for (let j = 0; j < vals[i].length; j++) g[row - 1 + i][col - 1 + j] = vals[i][j];
          }
        },
      }),
    };
  }

  const sheets = {};
  for (const name of Object.keys(grids)) sheets[name] = fakeSheet(grids[name]);
  const props = { SOTRATU_KEY: CFG.key };
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: t => ({ setMimeType: () => t }),
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('sheet-sync.gs') + '\nthis.__doPost = doPost; this.__buildData = buildData;', sandbox);

  const call = payload => JSON.parse(sandbox.__doPost({ postData: { contents: JSON.stringify(payload) } }));

  ok('doPost từ chối khi sai mã khoá',
     call({ key: 'sai', action: 'ping' }).ok === false);
  ok('doPost trả lời ping đúng khoá', call({ key: CFG.key, action: 'ping' }).ok === true);

  // Từ dùng làm mẫu phải chưa có sẵn, nếu không find() sẽ bắt nhầm mục cũ.
  const existing = new Set(sandbox.__buildData().entries.map(e => e.word));
  const samples = ['susurrus', 'thole', 'muddle sideways'];
  ok('từ mẫu chưa có sẵn trong sheet', samples.every(x => !existing.has(x)),
     samples.filter(x => existing.has(x)).join(', ') || 'cả ba đều mới');

  const before = sandbox.__buildData().entries.length;
  const res = call({ key: CFG.key, action: 'add', entry: add.body.entry });
  ok('chèn được vào tab Vocabulary', res.ok && res.sheet === 'Vocabulary',
     JSON.stringify(res));

  const after = sandbox.__buildData().entries;
  ok('bóc lại sheet thấy đúng thêm 1 mục', after.length === before + 1,
     before + ' → ' + after.length);
  const got = after.find(e => e.word === 'susurrus');
  ok('từ mới nguyên vẹn sau khi bóc lại',
     !!got && got.pos === 'n' && got.ipa === '/suːˈsʌr.əs/' &&
     got.senses[0].vi === 'tiếng xào xạc' &&
     got.senses[0].def === 'a soft murmuring or rustling sound',
     got ? got.word + ' (' + got.pos + ') ' + got.ipa + ' — ' + got.senses[0].vi : 'không thấy');

  const at = after.indexOf(got);
  ok('chèn đúng chỗ theo thứ tự a→z',
     after[at - 1].word.toLowerCase() < 'susurrus' && after[at + 1].word.toLowerCase() > 'susurrus',
     after[at - 1].word + '  <  susurrus  <  ' + after[at + 1].word);

  // từ nhiều nghĩa + ví dụ
  const multi = {
    type: 'word', word: 'thole', pos: 'v', ipa: '/θəʊl/', note: '',
    senses: [
      { def: 'to endure something without complaint', eg: ['she tholed the long winter'],
        vi: 'chịu đựng' },
      { def: 'a pin in the side of a boat that holds an oar', eg: [], vi: 'cọc chèo' },
    ],
  };
  ok('chèn được từ nhiều nghĩa', call({ key: CFG.key, action: 'add', entry: multi }).ok);
  const q = sandbox.__buildData().entries.find(e => e.word === 'thole');
  ok('giữ đủ hai nghĩa và ví dụ',
     !!q && q.senses.length === 2 && q.senses[0].eg[0] === 'she tholed the long winter' &&
     q.senses[1].vi === 'cọc chèo',
     q ? q.senses.length + ' nghĩa, ví dụ: ' + q.senses[0].eg[0] : 'không thấy');

  // phrasal verb
  ok('chèn được phrasal verb', call({ key: CFG.key, action: 'add', entry: {
    type: 'phrasal', word: 'muddle sideways', verb: 'muddle', particle: 'sideways',
    senses: [{ def: 'to manage without a plan', eg: [], vi: 'xoay xở cho qua' }],
  } }).ok);
  const pv = sandbox.__buildData().entries.find(e => e.word === 'muddle sideways');
  ok('phrasal verb bóc lại đúng', !!pv && pv.verb === 'muddle' && pv.particle === 'sideways' &&
     pv.senses[0].vi === 'xoay xở cho qua', pv ? pv.word : 'không thấy');

  done(a.errs.concat(b.errs));
})();
