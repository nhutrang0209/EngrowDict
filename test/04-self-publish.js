/* The artifact build: add a word -> the page writes its own replacement HTML
   -> load that back -> the word is still there and everything still works. */
const fs = require('fs');
const path = require('path');
const { read, boot, ok, done, wait, click, addWord, unlockedStore,
        deleteWord } = require('./helpers');

(async () => {
  const published = [];
  const a = boot({ html: read('engrowdict.html'), published, store: unlockedStore() });
  await wait(700);

  addWord(a, {
    word: 'kerfuffle',
    pos: 'n',
    ipa: '/kəˈfʌf.əl/',
    def: 'a lot of noisy activity or argument',
    vi: 'vụ lộn xộn / om sòm',
  });
  await wait(300);

  ok('publish() is called exactly once', published.length === 1, published.length + ' calls');
  const out = published[0];
  ok('a complete HTML document',
     out.toLowerCase().startsWith('<!doctype html>') && out.trim().endsWith('</html>'));
  ok('title and charset survive',
     out.includes('<title>EngrowDict</title>') && out.includes('<meta charset="utf-8">'));
  ok('the Google Fonts link survives', out.includes('fonts.googleapis.com/css2'));
  ok('five script tags', (out.match(/<script/g) || []).length === 5,
     (out.match(/<script/g) || []).length + ' tags');
  ok('a sensible size', out.length > 3000000 && out.length < 8000000,
     Math.round(out.length / 1024) + ' KB');
  ok('Vietnamese diacritics survive', out.includes('vụ lộn xộn / om sòm'));
  ok('the phonetics survive', out.includes('/kəˈfʌf.əl/'));

  fs.writeFileSync(path.join(__dirname, 'republished.html'), out);

  // load the freshly published version
  const published2 = [];
  const b = boot({ html: out, full: true, published: published2, store: unlockedStore() });
  await wait(800);

  ok('the new version runs', !!b.doc.querySelector('.top .mark'),
     b.doc.getElementById('count').textContent);
  const q = b.doc.getElementById('q');
  q.value = 'kerfuffle';
  q.dispatchEvent(new b.window.Event('input'));
  await wait(30);
  click(b.window, b.doc.querySelector('.hit'));
  ok('the added word is still there after the reload',
     b.doc.querySelector('.headword')?.textContent === 'kerfuffle',
     b.doc.querySelector('.headword')?.textContent + ' ' +
     b.doc.querySelector('.ipa')?.textContent + ' — ' + b.doc.querySelector('.vi')?.textContent);
  ok('it is badged as mine', !!b.doc.querySelector('.kind-mine'));
  ok('it can be deleted from the entry menu',
     !!b.doc.querySelector('.entry-nav .menu-wrap .menu-item.danger'));
  ok('  and that menu starts closed',
     b.doc.querySelector('.entry-nav .menu-wrap .menu').hidden);

  q.value = 'zenith';
  q.dispatchEvent(new b.window.Event('input'));
  await wait(30);
  click(b.window, b.doc.querySelector('.hit'));
  ok('the original data is untouched', b.doc.querySelector('.headword')?.textContent === 'zenith',
     b.doc.querySelector('.def')?.textContent?.slice(0, 50));

  q.value = 'kerfuffle';
  q.dispatchEvent(new b.window.Event('input'));
  await wait(30);
  click(b.window, b.doc.querySelector('.hit'));
  b.window.confirm = () => true;
  deleteWord(b);
  await wait(300);
  ok('deleting republishes too', published2.length === 1, published2.length + ' calls');
  ok('the republished copy has an empty added list',
     !!published2[0] && published2[0].includes('id="added">[]<'));

  done(a.errs.concat(b.errs));
})();
