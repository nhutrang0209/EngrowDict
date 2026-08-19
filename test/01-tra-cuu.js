const fs = require('fs');
const { JSDOM } = require('jsdom');

const body = fs.readFileSync(__dirname + '/../so-tra-tu.html', 'utf8');
const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + body + '</body></html>';

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://artifacts.example/x' });
const { window } = dom;
const doc = window.document;

window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };

const errs = [];
window.addEventListener('error', e => errs.push('window error: ' + e.message));
const origErr = console.error;
console.error = (...a) => errs.push('console.error: ' + a.join(' '));

setTimeout(() => {
  const ok = (label, cond, extra) =>
    console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  -> ' + extra : ''));

  ok('header rendered', !!doc.querySelector('.top .mark'), doc.querySelector('.brand .tally')?.textContent);
  ok('chips rendered', doc.querySelectorAll('.chip').length >= 5,
     [...doc.querySelectorAll('.chip')].map(c => c.textContent).join(' | '));
  ok('hits rendered', doc.querySelectorAll('.hit').length > 100,
     doc.querySelectorAll('.hit').length + ' rows, tally: ' + doc.getElementById('tally-line').textContent);
  ok('letter dividers', doc.querySelectorAll('.letter').length >= 2,
     [...doc.querySelectorAll('.letter')].slice(0, 8).map(n => n.textContent).join(''));

  // search: english
  const q = doc.getElementById('q');
  q.value = 'abate';
  q.dispatchEvent(new window.Event('input'));
  const first = doc.querySelector('.hit .hw');
  ok('search "abate"', first && first.textContent.trim() === 'abate', first && first.textContent);

  // open it
  doc.querySelector('.hit').dispatchEvent(new window.Event('click'));
  const hw = doc.querySelector('.headword');
  ok('detail opens', hw && hw.textContent === 'abate',
     doc.querySelector('.def')?.textContent + ' || ' + doc.querySelector('.vi')?.textContent);

  // multi-sense entry
  q.value = 'abide';
  q.dispatchEvent(new window.Event('input'));
  doc.querySelector('.hit').dispatchEvent(new window.Event('click'));
  ok('multi-sense numbered', doc.querySelectorAll('.sense .num').length >= 2,
     doc.querySelectorAll('.senses .sense').length + ' senses');

  // example split
  q.value = 'abject';
  q.dispatchEvent(new window.Event('input'));
  doc.querySelector('.hit').dispatchEvent(new window.Event('click'));
  ok('examples split out', doc.querySelectorAll('.eg').length >= 1,
     doc.querySelector('.eg')?.textContent);

  // vietnamese search, no diacritics
  q.value = 'thoai vi';
  q.dispatchEvent(new window.Event('input'));
  ok('VN search w/o diacritics', doc.querySelectorAll('.hit').length > 0,
     doc.querySelector('.hit .hw')?.textContent + ' / ' + doc.querySelector('.hit .gloss')?.textContent);

  // phrasal verb
  q.value = 'drop off';
  q.dispatchEvent(new window.Event('input'));
  ok('phrasal verb found', doc.querySelector('.hit .hw')?.textContent === 'drop off',
     doc.querySelector('.hit .hw')?.textContent);

  // filter chip
  const chip = [...doc.querySelectorAll('.chip')].find(c => c.textContent.startsWith('Thành ngữ'));
  q.value = '';
  q.dispatchEvent(new window.Event('input'));
  chip.dispatchEvent(new window.Event('click'));
  ok('idiom filter', doc.getElementById('tally-line').textContent.indexOf('352') > -1,
     doc.getElementById('tally-line').textContent);
  [...doc.querySelectorAll('.chip')].find(c => c.textContent.startsWith('Tất cả'))
    .dispatchEvent(new window.Event('click'));

  // readings tab
  [...doc.querySelectorAll('.tab')].find(t => t.textContent === 'Bài đọc')
    .dispatchEvent(new window.Event('click'));
  ok('readings listed', doc.querySelectorAll('.hit').length === 33,
     doc.getElementById('tally-line').textContent);
  doc.querySelector('.hit').dispatchEvent(new window.Event('click'));
  ok('reading opens w/ paragraphs', doc.querySelectorAll('.read .prose p').length > 1,
     doc.querySelector('.read h1')?.textContent + ' — ' +
     doc.querySelectorAll('.read .prose p').length + ' đoạn');
  [...doc.querySelectorAll('.tab')].find(t => t.textContent === 'Từ vựng')
    .dispatchEvent(new window.Event('click'));

  // add-word form (no artifact capability here -> local fallback)
  doc.querySelector('.btn-primary').dispatchEvent(new window.Event('click'));
  const dlg = doc.getElementById('form-dlg');
  ok('form opens', dlg.open, 'sense rows: ' + doc.querySelectorAll('#sense-list .sense-edit').length);
  dlg.querySelector('[name=word]').value = 'kerfuffle';
  dlg.querySelector('[name=pos]').value = 'n';
  dlg.querySelector('[name=ipa]').value = '/kəˈfʌf.əl/';
  dlg.querySelector('[name=def]').value = 'a lot of noisy activity or argument';
  dlg.querySelector('[name=vi]').value = 'vụ lộn xộn / om sòm';
  // add a second sense
  [...doc.querySelectorAll('.dlg-body .btn')].find(b => b.textContent.indexOf('Thêm nghĩa') > -1)
    .dispatchEvent(new window.Event('click'));
  const rows = doc.querySelectorAll('#sense-list .sense-edit');
  rows[1].querySelector('[name=def]').value = 'a minor scandal';
  rows[1].querySelector('[name=vi]').value = 'vụ um xùm nhỏ';
  ok('second sense row added', rows.length === 2);

  doc.getElementById('form-save').dispatchEvent(new window.Event('click'));

  setTimeout(() => {
    ok('word added to index', !!doc.querySelector('.headword') &&
       doc.querySelector('.headword').textContent === 'kerfuffle',
       doc.querySelector('.headword')?.textContent + ' / senses ' +
       doc.querySelectorAll('.senses .sense').length + ' / mine badge: ' +
       !!doc.querySelector('.kind-mine'));
    ok('backup written', !!window.localStorage.getItem('so-tra-tu:added:v1'),
       (window.localStorage.getItem('so-tra-tu:added:v1') || '').slice(0, 70));
    ok('banner explains local-only save', !doc.getElementById('banner').hidden,
       doc.getElementById('banner').textContent.slice(0, 80));

    // "Của tôi" filter appears
    ok('"Của tôi" chip appears',
       [...doc.querySelectorAll('.chip')].some(c => c.textContent.startsWith('Của tôi')));

    console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console/window errors');
  }, 60);
}, 400);
