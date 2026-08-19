/* Kiểm tra vòng tự-publish: thêm từ -> trang tự sinh HTML thay thế ->
   nạp lại HTML đó -> từ mới phải còn, và trang phải chạy được như cũ. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const body = fs.readFileSync(__dirname + '/../so-tra-tu.html', 'utf8');
const wrap = b => '<!doctype html><html><head><meta charset="utf-8"></head><body>' + b + '</body></html>';

function boot(html, published) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://artifacts.example/so-tra-tu',
    beforeParse(w) {
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
      w.claude = {
        use: name => Promise.resolve(name === 'artifact' ? {
          publish: h => { published.push(h); return Promise.resolve({ version: 'v2' }); },
        } : null),
      };
    },
  });
  const { window } = dom;
  const errs = [];
  window.addEventListener('error', e => errs.push(e.message));
  return { dom, window, doc: window.document, errs };
}

const ok = (l, c, x) => console.log((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '  -> ' + x : ''));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const published = [];
  const a = boot(wrap(body), published);
  await wait(400);

  // thêm từ
  a.doc.querySelector('.btn-primary').dispatchEvent(new a.window.Event('click'));
  const dlg = a.doc.getElementById('form-dlg');
  dlg.querySelector('[name=word]').value = 'kerfuffle';
  dlg.querySelector('[name=pos]').value = 'n';
  dlg.querySelector('[name=ipa]').value = '/kəˈfʌf.əl/';
  dlg.querySelector('[name=type]').value = 'word';
  dlg.querySelector('[name=def]').value = 'a lot of noisy activity or argument';
  dlg.querySelector('[name=vi]').value = 'vụ lộn xộn / om sòm';
  a.doc.getElementById('form-save').dispatchEvent(new a.window.Event('click'));
  await wait(200);

  ok('publish() được gọi', published.length === 1, published.length + ' lần');
  const out = published[0];
  ok('bắt đầu bằng doctype', out.slice(0, 15).toLowerCase().startsWith('<!doctype html>'), out.slice(0, 40));
  ok('có <title>', out.indexOf('<title>Sổ Tra Từ</title>') > -1);
  ok('có meta charset utf-8', out.indexOf('<meta charset="utf-8">') > -1);
  ok('có link Google Fonts', out.indexOf('fonts.googleapis.com/css2') > -1);
  ok('kích thước hợp lý', out.length > 600000 && out.length < 2000000,
     Math.round(out.length / 1024) + ' KB');
  ok('không có script rỗng/hỏng', (out.match(/<script/g) || []).length === 5,
     (out.match(/<script/g) || []).length + ' thẻ script');
  fs.writeFileSync(__dirname + '/republished.html', out);

  // nạp lại bản vừa publish
  const published2 = [];
  const b = boot(out, published2);
  await wait(500);

  ok('bản mới boot được', !!b.doc.querySelector('.top .mark'),
     b.doc.querySelector('.brand .tally')?.textContent);
  ok('số mục tăng 1', b.doc.querySelector('.brand .tally')?.textContent.indexOf('1.396') === 0,
     b.doc.querySelector('.brand .tally')?.textContent);

  const q = b.doc.getElementById('q');
  q.value = 'kerfuffle';
  q.dispatchEvent(new b.window.Event('input'));
  b.doc.querySelector('.hit').dispatchEvent(new b.window.Event('click'));
  ok('từ mới còn sau khi tải lại', b.doc.querySelector('.headword')?.textContent === 'kerfuffle',
     b.doc.querySelector('.headword')?.textContent + ' ' +
     b.doc.querySelector('.ipa')?.textContent + ' — ' +
     b.doc.querySelector('.vi')?.textContent);
  ok('có nhãn "Của tôi"', !!b.doc.querySelector('.kind-mine'));

  // dữ liệu gốc vẫn nguyên
  q.value = 'abate';
  q.dispatchEvent(new b.window.Event('input'));
  b.doc.querySelector('.hit').dispatchEvent(new b.window.Event('click'));
  ok('dữ liệu gốc nguyên vẹn', b.doc.querySelector('.headword')?.textContent === 'abate',
     b.doc.querySelector('.def')?.textContent);

  // ký tự đặc biệt / dấu tiếng Việt sống sót
  ok('dấu tiếng Việt sống sót', out.indexOf('vụ lộn xộn / om sòm') > -1);
  ok('IPA sống sót', out.indexOf('/kəˈfʌf.əl/') > -1);

  // xoá từ vừa thêm -> publish lần nữa, danh sách added rỗng
  b.doc.querySelector('.btn-danger') && (b.window.confirm = () => true);
  q.value = 'kerfuffle';
  q.dispatchEvent(new b.window.Event('input'));
  b.doc.querySelector('.hit').dispatchEvent(new b.window.Event('click'));
  b.window.confirm = () => true;
  b.doc.querySelector('.btn-danger').dispatchEvent(new b.window.Event('click'));
  await wait(200);
  ok('xoá cũng publish lại', published2.length === 1,
     published2.length + ' lần');
  ok('bản sau khi xoá rỗng added',
     published2[0] && published2[0].indexOf('id="added">[]<') > -1);

  const allErrs = a.errs.concat(b.errs);
  console.log(allErrs.length ? 'ERRORS:\n' + allErrs.join('\n') : 'no window errors');
})();
