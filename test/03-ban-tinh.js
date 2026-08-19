/* Bản web tĩnh: không có window.claude, nút thêm từ vẫn phải dùng được,
   từ mới nằm trong localStorage và sống sót qua lần tải trang sau. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(__dirname + '/../docs/index.html', 'utf8');
const store = {};

function boot() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://ten-ban.github.io/so-tra-tu/',
    beforeParse(w) {
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
      // localStorage dùng chung giữa hai lần tải, giống một trình duyệt thật
      Object.defineProperty(w, 'localStorage', {
        value: {
          getItem: k => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
        },
      });
      w.URL.createObjectURL = () => 'blob:fake';
      w.URL.revokeObjectURL = () => {};
    },
  });
  const errs = [];
  dom.window.addEventListener('error', e => errs.push(e.message));
  return { window: dom.window, doc: dom.window.document, errs };
}

const ok = (l, c, x) => console.log((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '  -> ' + x : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const a = boot();
  await wait(400);

  ok('không có claude runtime', typeof a.window.claude === 'undefined');
  ok('trang vẫn dựng đủ', !!a.doc.querySelector('.top .mark'),
     a.doc.querySelector('.brand .tally')?.textContent);
  ok('nút "Thêm từ" KHÔNG bị ẩn', !a.doc.querySelector('.btn-primary').hidden);
  ok('không hiện banner chỉ-xem', a.doc.getElementById('banner').hidden);
  ok('màn hình trống nói rõ nơi lưu',
     [...a.doc.querySelectorAll('.blank p')].some(p => p.textContent.indexOf('trình duyệt') > -1));

  // thêm từ
  a.doc.querySelector('.btn-primary').dispatchEvent(new a.window.Event('click'));
  const dlg = a.doc.getElementById('form-dlg');
  dlg.querySelector('[name=word]').value = 'petrichor';
  dlg.querySelector('[name=pos]').value = 'n';
  dlg.querySelector('[name=ipa]').value = '/ˈpet.rɪ.kɔːr/';
  dlg.querySelector('[name=def]').value = 'the smell of the ground after it rains';
  dlg.querySelector('[name=vi]').value = 'mùi đất sau mưa';
  a.doc.getElementById('form-save').dispatchEvent(new a.window.Event('click'));
  await wait(120);

  ok('form đóng lại', !dlg.open);
  ok('hiện ngay từ vừa thêm', a.doc.querySelector('.headword')?.textContent === 'petrichor',
     a.doc.querySelector('.headword')?.textContent + ' — ' + a.doc.querySelector('.vi')?.textContent);
  ok('có nút xoá', !!a.doc.querySelector('.btn-danger'));
  ok('ghi vào localStorage', !!store['so-tra-tu:added:v1'],
     (store['so-tra-tu:added:v1'] || '').slice(0, 60));
  ok('tổng số tăng 1', a.doc.querySelector('.brand .tally')?.textContent.indexOf('1.396') === 0,
     a.doc.querySelector('.brand .tally')?.textContent);

  // tải lại trang -> từ phải còn
  const b = boot();
  await wait(400);
  ok('từ còn sau khi tải lại trang',
     b.doc.querySelector('.brand .tally')?.textContent.indexOf('1.396') === 0,
     b.doc.querySelector('.brand .tally')?.textContent);
  const q = b.doc.getElementById('q');
  q.value = 'mui dat sau mua';
  q.dispatchEvent(new b.window.Event('input'));
  ok('tra được bằng tiếng Việt không dấu', b.doc.querySelector('.hit .hw')?.textContent === 'petrichor',
     b.doc.querySelector('.hit .hw')?.textContent);

  // xoá
  b.doc.querySelector('.hit').dispatchEvent(new b.window.Event('click'));
  b.window.confirm = () => true;
  b.doc.querySelector('.btn-danger').dispatchEvent(new b.window.Event('click'));
  await wait(120);
  ok('xoá được', b.doc.querySelector('.brand .tally')?.textContent.indexOf('1.395') === 0,
     b.doc.querySelector('.brand .tally')?.textContent);
  ok('localStorage rỗng lại', store['so-tra-tu:added:v1'] === '[]', store['so-tra-tu:added:v1']);

  const errs = a.errs.concat(b.errs);
  console.log(errs.length ? 'ERRORS: ' + JSON.stringify(errs) : 'no window errors');
})();
