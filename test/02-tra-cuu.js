/* Tra cứu, lọc, lật chữ cái, đi tới/lui — chạy trên bản artifact. */
const { read, boot, ok, done, wait, click, type } = require('./helpers');

(async () => {
  const a = boot({ html: read('so-tra-tu.html') });
  await wait(600);
  const { doc, window: w } = a;
  const q = doc.getElementById('q');

  ok('trang dựng xong', !!doc.querySelector('.top .mark'),
     doc.getElementById('tally').textContent);
  ok('danh sách có dòng', doc.querySelectorAll('.hit').length > 0,
     doc.querySelectorAll('.hit').length + ' dòng dựng thật, ' +
     doc.getElementById('count').textContent);
  ok('cuộn ảo: DOM ít hơn nhiều so với số mục',
     doc.querySelectorAll('.hit').length < 60,
     doc.querySelectorAll('.hit').length + ' nút trong DOM cho 11k mục');
  ok('có dấu chữ cái khi chưa tìm gì', doc.querySelectorAll('.letter-mark').length > 0,
     doc.querySelector('.letter-mark')?.textContent);
  ok('dải A–Z đủ 26 nút', doc.querySelectorAll('.alpha button').length === 26);
  ok('dải A–Z không nút nào bị khoá',
     doc.querySelectorAll('.alpha button[disabled]').length === 0);

  // --- tra tiếng Anh, ở giữa và cuối bảng chữ cái ---
  for (const [word, expectVi] of [['abate', 'yếu'], ['martial', 'quân'], ['zenith', 'đỉnh']]) {
    type(w, q, word);
    await wait(20);
    const first = doc.querySelector('.hit .hw');
    ok('tra "' + word + '"', first && first.textContent.trim() === word,
       first && first.textContent);
    click(w, doc.querySelector('.hit'));
    ok('  mở được khung nghĩa của "' + word + '"',
       doc.querySelector('.headword')?.textContent === word &&
       (doc.querySelector('.vi')?.textContent || '').includes(expectVi),
       doc.querySelector('.ipa')?.textContent + ' — ' + doc.querySelector('.vi')?.textContent);
  }

  // --- nhiều nghĩa được đánh số ---
  type(w, q, 'strike');
  await wait(20);
  click(w, doc.querySelector('.hit'));
  ok('mục nhiều nghĩa được đánh số', doc.querySelectorAll('.sense .num').length > 5,
     doc.querySelectorAll('.senses .sense').length + ' nghĩa');

  // --- ví dụ hiện riêng ---
  type(w, q, 'abject');
  await wait(20);
  click(w, doc.querySelector('.hit'));
  ok('ví dụ hiện thành dòng riêng', doc.querySelectorAll('.eg').length > 0,
     doc.querySelector('.eg')?.textContent);

  // --- tiếng Việt không dấu ---
  type(w, q, 'mui dat');
  await wait(20);
  ok('tra bằng tiếng Việt không dấu', doc.querySelectorAll('.hit').length > 0,
     doc.querySelector('.hit .hw')?.textContent + ' / ' + doc.querySelector('.hit .gloss')?.textContent);

  // --- phrasal verb ---
  type(w, q, 'make up for');
  await wait(20);
  ok('tra được phrasal verb', doc.querySelector('.hit .hw')?.textContent === 'make up for',
     doc.querySelector('.hit .hw')?.textContent);
  click(w, doc.querySelector('.hit'));
  ok('  gợi ý cùng động từ', doc.querySelectorAll('.related button').length > 3,
     doc.querySelector('.related h2')?.textContent + ': ' +
     [...doc.querySelectorAll('.related button')].slice(0, 4).map(b => b.textContent).join(', '));

  // --- đi tới / lui trong kết quả ---
  type(w, q, 'abs');
  await wait(20);
  click(w, doc.querySelector('.hit'));
  const firstWord = doc.querySelector('.headword').textContent;
  click(w, [...doc.querySelectorAll('.iconbtn')][1]);   // →
  const secondWord = doc.querySelector('.headword').textContent;
  ok('nút → sang mục kế', firstWord !== secondWord, firstWord + ' → ' + secondWord);
  click(w, [...doc.querySelectorAll('.iconbtn')][0]);   // ←
  ok('nút ← quay lại', doc.querySelector('.headword').textContent === firstWord,
     doc.querySelector('.headword').textContent);
  ok('có chỉ số vị trí trong danh sách', !!doc.querySelector('.pos-in-list'),
     doc.querySelector('.pos-in-list')?.textContent);

  // --- lọc theo nhóm ---
  type(w, q, '');
  await wait(20);
  const chip = [...doc.querySelectorAll('.chip')].find(c => c.textContent.startsWith('Thành ngữ'));
  click(w, chip);
  await wait(20);
  ok('lọc thành ngữ', doc.getElementById('count').textContent.startsWith('352'),
     doc.getElementById('count').textContent);
  click(w, [...doc.querySelectorAll('.chip')].find(c => c.textContent.startsWith('Tất cả')));
  await wait(20);

  // --- lật chữ cái ---
  const zBtn = [...doc.querySelectorAll('.alpha button')].find(b => b.dataset.l === 'z');
  click(w, zBtn);
  await wait(20);
  const shown = [...doc.querySelectorAll('.hit .hw')].map(n => n.textContent.toLowerCase());
  ok('lật tới chữ Z', shown.some(t => t.startsWith('z')),
     'mốc ' + [...doc.querySelectorAll('.letter-mark')].map(n => n.textContent).join('') +
     ', ví dụ ' + shown.filter(t => t.startsWith('z')).slice(0, 3).join(', '));

  // --- bài đọc ---
  const rd = [...doc.querySelectorAll('.acts .btn')].find(b => b.textContent === 'Bài đọc');
  click(w, rd);
  await wait(20);
  ok('chuyển sang bài đọc', doc.getElementById('count').textContent.includes('bài đọc'),
     doc.getElementById('count').textContent);

  done(a.errs);
})();
