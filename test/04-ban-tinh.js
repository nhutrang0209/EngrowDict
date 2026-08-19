/* Bản web tĩnh: vỏ trang nhẹ tự tải data.json, không có window.claude,
   từ mới lưu trong localStorage và sống sót qua lần tải trang sau. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const store = {};
const mk = () => boot({
  html: shell, full: true, store,
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

(async () => {
  ok('vỏ trang nhẹ', shell.length < 120000, Math.round(shell.length / 1024) + ' KB');
  ok('vỏ trang không nhúng dữ liệu',
   !shell.includes('<script type="application/json" id="base">'));
  ok('vỏ trang trỏ tới data.json', shell.includes('href="data.json"'));

  const a = mk();
  await wait(900);
  const { doc, window: w } = a;

  ok('không có claude runtime', typeof w.claude === 'undefined');
  ok('tải xong và dựng trang', !!doc.querySelector('.top .mark'),
     doc.getElementById('tally').textContent);
  ok('có đủ dữ liệu', doc.getElementById('tally').textContent.includes('11.401'),
     doc.getElementById('tally').textContent);
  ok('nút "Thêm từ" KHÔNG bị ẩn', !doc.querySelector('.acts .btn-primary').hidden);
  ok('không hiện dải chỉ-xem', doc.getElementById('banner').hidden);
  ok('màn hình mở đầu nói rõ nơi lưu',
     [...doc.querySelectorAll('.blank p')].some(p => p.textContent.includes('trình duyệt')));
  ok('không có nút Bài đọc', ![...doc.querySelectorAll('.acts .btn')].some(b => b.textContent === 'Bài đọc'),
     [...doc.querySelectorAll('.acts .btn')].map(b => b.textContent).join(' | '));

  // thêm từ
  click(w, doc.querySelector('.acts .btn-primary'));
  const dlg = doc.getElementById('form-dlg');
  dlg.querySelector('[name=word]').value = 'petrichor';
  dlg.querySelector('[name=pos]').value = 'n';
  dlg.querySelector('[name=ipa]').value = '/ˈpet.rɪ.kɔːr/';
  dlg.querySelector('[name=def]').value = 'the smell of the ground after it rains';
  dlg.querySelector('[name=vi]').value = 'mùi đất sau mưa';
  click(w, doc.getElementById('form-save'));
  await wait(150);

  ok('form đóng lại', !dlg.open);
  ok('hiện ngay từ vừa thêm', doc.querySelector('.headword')?.textContent === 'petrichor',
     doc.querySelector('.headword')?.textContent + ' — ' + doc.querySelector('.vi')?.textContent);
  ok('ghi vào localStorage', !!store['so-tra-tu:added:v1'],
     (store['so-tra-tu:added:v1'] || '').slice(0, 58));
  ok('tổng số tăng 1', doc.getElementById('tally').textContent.includes('11.402'),
     doc.getElementById('tally').textContent);

  // tải lại trang
  const b = mk();
  await wait(900);
  ok('từ còn sau khi tải lại trang', b.doc.getElementById('tally').textContent.includes('11.402'),
     b.doc.getElementById('tally').textContent);
  const q = b.doc.getElementById('q');
  q.value = 'mui dat sau mua';
  q.dispatchEvent(new b.window.Event('input'));
  await wait(30);
  ok('tra được bằng tiếng Việt không dấu',
     b.doc.querySelector('.hit .hw')?.textContent === 'petrichor',
     b.doc.querySelector('.hit .hw')?.textContent);

  click(b.window, b.doc.querySelector('.hit'));
  b.window.confirm = () => true;
  click(b.window, b.doc.querySelector('.btn-danger'));
  await wait(150);
  ok('xoá được', b.doc.getElementById('tally').textContent.includes('11.401'),
     b.doc.getElementById('tally').textContent);
  ok('localStorage rỗng lại', store['so-tra-tu:added:v1'] === '[]', store['so-tra-tu:added:v1']);

  done(a.errs.concat(b.errs));
})();
