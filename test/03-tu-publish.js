/* Bản artifact: thêm từ -> trang tự sinh HTML thay thế -> nạp lại bản đó
   -> từ mới phải còn và trang phải chạy y như cũ. */
const fs = require('fs');
const path = require('path');
const { read, boot, ok, done, wait, click } = require('./helpers');

(async () => {
  const published = [];
  const a = boot({ html: read('so-tra-tu.html'), published });
  await wait(600);

  click(a.window, a.doc.querySelector('.acts .btn-primary'));
  const dlg = a.doc.getElementById('form-dlg');
  dlg.querySelector('[name=word]').value = 'kerfuffle';
  dlg.querySelector('[name=pos]').value = 'n';
  dlg.querySelector('[name=ipa]').value = '/kəˈfʌf.əl/';
  dlg.querySelector('[name=def]').value = 'a lot of noisy activity or argument';
  dlg.querySelector('[name=vi]').value = 'vụ lộn xộn / om sòm';
  click(a.window, a.doc.getElementById('form-save'));
  await wait(300);

  ok('publish() được gọi đúng một lần', published.length === 1, published.length + ' lần');
  const out = published[0];
  ok('là tài liệu HTML đủ đầu đuôi',
     out.toLowerCase().startsWith('<!doctype html>') && out.trim().endsWith('</html>'));
  ok('giữ <title> và charset',
     out.includes('<title>Sổ Tra Từ</title>') && out.includes('<meta charset="utf-8">'));
  ok('giữ link Google Fonts', out.includes('fonts.googleapis.com/css2'));
  ok('đủ 5 thẻ script', (out.match(/<script/g) || []).length === 5,
     (out.match(/<script/g) || []).length + ' thẻ');
  ok('kích thước hợp lý', out.length > 3000000 && out.length < 8000000,
     Math.round(out.length / 1024) + ' KB');
  ok('dấu tiếng Việt sống sót', out.includes('vụ lộn xộn / om sòm'));
  ok('IPA sống sót', out.includes('/kəˈfʌf.əl/'));

  fs.writeFileSync(path.join(__dirname, 'republished.html'), out);

  // nạp lại chính bản vừa publish
  const published2 = [];
  const b = boot({ html: out, full: true, published: published2 });
  await wait(700);

  ok('bản mới chạy được', !!b.doc.querySelector('.top .mark'),
     b.doc.getElementById('tally').textContent);
  const q = b.doc.getElementById('q');
  q.value = 'kerfuffle';
  q.dispatchEvent(new b.window.Event('input'));
  await wait(30);
  click(b.window, b.doc.querySelector('.hit'));
  ok('từ mới còn sau khi tải lại', b.doc.querySelector('.headword')?.textContent === 'kerfuffle',
     b.doc.querySelector('.headword')?.textContent + ' ' +
     b.doc.querySelector('.ipa')?.textContent + ' — ' + b.doc.querySelector('.vi')?.textContent);
  ok('có nhãn "Của tôi"', !!b.doc.querySelector('.kind-mine'));
  ok('có nút xoá', !!b.doc.querySelector('.btn-danger'));

  q.value = 'zenith';
  q.dispatchEvent(new b.window.Event('input'));
  await wait(30);
  click(b.window, b.doc.querySelector('.hit'));
  ok('dữ liệu gốc nguyên vẹn', b.doc.querySelector('.headword')?.textContent === 'zenith',
     b.doc.querySelector('.def')?.textContent?.slice(0, 50));

  // xoá lại
  q.value = 'kerfuffle';
  q.dispatchEvent(new b.window.Event('input'));
  await wait(30);
  click(b.window, b.doc.querySelector('.hit'));
  b.window.confirm = () => true;
  click(b.window, b.doc.querySelector('.btn-danger'));
  await wait(300);
  ok('xoá cũng publish lại', published2.length === 1, published2.length + ' lần');
  ok('bản sau khi xoá có danh sách thêm rỗng',
     !!published2[0] && published2[0].includes('id="added">[]<'));

  done(a.errs.concat(b.errs));
})();
