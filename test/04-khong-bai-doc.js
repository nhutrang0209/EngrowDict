/* Bản công khai không được kèm bài đọc, và không được lộ tab/nội dung nào. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const pub = fs.readFileSync(__dirname + '/../docs/index.html', 'utf8');
const art = fs.readFileSync(__dirname + '/../so-tra-tu.html', 'utf8');
const ok = (l, c, x) => console.log((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '  -> ' + x : ''));

// vài câu nguyên văn lấy từ các bài đọc trong sheet
const PHRASES = [
  'Methuselah',
  'James Bedford',
  'Percy Spencer',
  'bristlecone pine',
  'friction-maxxing',
];

ok('bản artifact vẫn còn bài đọc', PHRASES.every(p => art.indexOf(p) > -1));
ok('bản công khai không còn câu nào của bài đọc',
   PHRASES.every(p => pub.indexOf(p) === -1),
   PHRASES.filter(p => pub.indexOf(p) > -1).join(', ') || 'sạch');
ok('mảng readings rỗng trong bản công khai', pub.indexOf('"readings":[]') > -1);
ok('nhẹ hơn hẳn', pub.length < art.length - 200000,
   Math.round(pub.length / 1024) + ' KB so với ' + Math.round(art.length / 1024) + ' KB');

const dom = new JSDOM(pub, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://ten-ban.github.io/so-tra-tu/',
  beforeParse(w) {
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  },
});
const { window } = dom;
const doc = window.document;
const errs = [];
window.addEventListener('error', e => errs.push(e.message));

setTimeout(() => {
  ok('không có tab "Bài đọc"',
     ![...doc.querySelectorAll('.tab')].some(t => t.textContent === 'Bài đọc'),
     [...doc.querySelectorAll('.tab')].map(t => t.textContent).join(',') || 'không có tab nào');
  ok('tổng số không nhắc bài đọc',
     doc.querySelector('.brand .tally').textContent.indexOf('bài đọc') === -1,
     doc.querySelector('.brand .tally').textContent);
  ok('tra từ vẫn chạy', (() => {
    const q = doc.getElementById('q');
    q.value = 'abate';
    q.dispatchEvent(new window.Event('input'));
    doc.querySelector('.hit').dispatchEvent(new window.Event('click'));
    return doc.querySelector('.headword')?.textContent === 'abate';
  })(), doc.querySelector('.def')?.textContent);
  ok('thêm từ vẫn hiện', !doc.querySelector('.btn-primary').hidden);
  console.log(errs.length ? 'ERRORS: ' + JSON.stringify(errs) : 'no window errors');
}, 400);
