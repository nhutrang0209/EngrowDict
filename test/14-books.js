/* Whole books, split into chapters.

   A book is not a passage: it is too big to ship with the page and too long to
   read in one screen. So the page reads a shelf — titles and chapter names —
   when it opens, and the text of a book only when a chapter of it is opened.
   Once open, a chapter behaves exactly like a passage, because that is the
   part the reader already knows: select a word, get the notebook on it. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');

const SHELF = [{
  slug: 'the-boy-who-lived',
  title: 'A Test Book',
  author: 'Nobody',
  chapters: [
    { n: 1, title: 'THE BOY WHO LIVED', words: 12 },
    { n: 2, title: 'THE VANISHING GLASS', words: 9 },
  ],
}];

const BOOK = {
  slug: 'the-boy-who-lived',
  title: 'A Test Book',
  author: 'Nobody',
  chapters: [
    { n: 1, title: 'THE BOY WHO LIVED',
      paras: ['Mr. and Mrs. Dursley, of number four, Privet Drive, were proud.',
              'They were perfectly normal, thank you very much.'] },
    { n: 2, title: 'THE VANISHING GLASS',
      paras: ['Nearly ten years had passed since the Dursleys had woken up.'] },
  ],
};

(async () => {
  let bookAsked = 0, shelfUp = true;
  const a = boot({
    html: shell, full: true,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: url => {
      const u = String(url);
      if (u.includes('books/index.json')) {
        return shelfUp
          ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SHELF) })
          : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
      }
      if (u.includes('books/the-boy-who-lived.json')) {
        bookAsked++;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(BOOK) });
      }
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(read('docs/data.json'))) });
    },
  });
  await wait(900);
  const { doc, window: w } = a;

  /* --- the shelf ---------------------------------------------------------- */
  ok('the Books tab appears once there is a shelf',
     !doc.getElementById('tab-books').hidden);
  ok('  and no book was downloaded to draw it', bookAsked === 0,
     bookAsked + ' book fetches');

  click(w, doc.getElementById('tab-books'));
  await wait(30);
  ok('the list counts books, not entries',
     doc.getElementById('count').textContent.includes('book'),
     doc.getElementById('count').textContent);
  ok('  the chips and the alphabet stay out of the way',
     doc.getElementById('chips').hidden && doc.getElementById('alpha').hidden);
  ok('  the shelf row names the book',
     doc.querySelector('.hit.passage .hw')?.textContent === 'A Test Book',
     doc.querySelector('.hit.passage .hw')?.textContent);
  ok('  and says who wrote it and how long it is',
     (doc.querySelector('.hit.passage .gloss')?.textContent || '')
       .includes('Nobody · 2 chapters'),
     doc.querySelector('.hit.passage .gloss')?.textContent);

  /* --- the contents ------------------------------------------------------- */
  click(w, doc.querySelector('.hit'));
  await wait(30);
  ok('opening a book shows its contents, not its text',
     doc.querySelectorAll('.toc-row').length === 2 &&
     !doc.querySelector('.read .prose'),
     doc.querySelectorAll('.toc-row').length + ' chapters listed');
  ok('  a chapter row carries its number, name and length',
     doc.querySelector('.toc-row .idx')?.textContent === '1' &&
     doc.querySelector('.toc-row .hw')?.textContent === 'THE BOY WHO LIVED' &&
     (doc.querySelector('.toc-row .gloss')?.textContent || '').includes('12'),
     [...doc.querySelectorAll('.toc-row')][0]?.textContent);
  ok('  the book is still not downloaded', bookAsked === 0, bookAsked + ' fetches');

  /* --- a chapter ---------------------------------------------------------- */
  click(w, doc.querySelector('.toc-row'));
  await wait(60);
  ok('opening a chapter fetches the book once', bookAsked === 1, bookAsked + ' fetches');
  ok('  and lays the chapter out as prose',
     doc.querySelectorAll('.read .prose p').length === 2,
     doc.querySelectorAll('.read .prose p').length + ' paragraphs');
  ok('  under its own title',
     doc.querySelector('.read h1')?.textContent === 'THE BOY WHO LIVED',
     doc.querySelector('.read h1')?.textContent);
  ok('  saying which chapter of which book it is',
     (doc.querySelector('.read .meta')?.textContent || '')
       .toLowerCase().includes('chapter 1 of a test book'),
     doc.querySelector('.read .meta')?.textContent);
  ok('  and inviting the same select-to-look-up as a passage',
     (doc.querySelector('.read .hint')?.textContent || '').includes('Select any word'));
  ok('  the chapter runs the full width, like a passage',
     doc.getElementById('detail-inner').className.includes('wide'),
     doc.getElementById('detail-inner').className);

  /* --- moving through the book -------------------------------------------- */
  const nav = [...doc.querySelectorAll('.entry-nav')].pop();
  const next = [...nav.querySelectorAll('button')].find(b => b.textContent === 'Next');
  const prev = [...nav.querySelectorAll('button')].find(b => b.textContent === 'Previous');
  ok('the first chapter can go forward but not back',
     !next.disabled && prev.disabled);
  click(w, next);
  await wait(30);
  ok('  Next opens the following chapter',
     doc.querySelector('.read h1')?.textContent === 'THE VANISHING GLASS',
     doc.querySelector('.read h1')?.textContent);
  ok('  and does not download the book again', bookAsked === 1, bookAsked + ' fetches');
  const nav2 = [...doc.querySelectorAll('.entry-nav')].pop();
  ok('  the last chapter can go back but not forward',
     [...nav2.querySelectorAll('button')].find(b => b.textContent === 'Next').disabled &&
     ![...nav2.querySelectorAll('button')].find(b => b.textContent === 'Previous').disabled);

  click(w, [...nav2.querySelectorAll('button')].find(b => b.textContent.includes('Contents')));
  await wait(30);
  ok('Contents goes back to the chapter list',
     doc.querySelectorAll('.toc-row').length === 2 && !doc.querySelector('.read .prose'));

  /* --- looking a word up inside a chapter --------------------------------- */
  click(w, doc.querySelector('.toc-row'));
  await wait(60);
  const p = doc.querySelector('.read .prose p');
  const range = doc.createRange();
  range.selectNodeContents(p);
  w.getSelection().removeAllRanges();
  w.getSelection().addRange(range);
  p.dispatchEvent(new w.Event('mouseup', { bubbles: true }));
  await wait(60);
  ok('selecting inside a chapter opens the lookup card',
     !!doc.getElementById('lookup') && !doc.getElementById('lookup').hidden);

  /* --- searching the shelf ------------------------------------------------- */
  const q = doc.getElementById('q');
  q.value = 'vanishing';
  q.dispatchEvent(new w.Event('input'));
  await wait(30);
  ok('a chapter name finds its book',
     doc.querySelectorAll('.hit').length === 1,
     doc.querySelectorAll('.hit').length + ' hits');
  q.value = 'nothing here at all';
  q.dispatchEvent(new w.Event('input'));
  await wait(30);
  ok('  and a word in no book finds none', doc.querySelectorAll('.hit').length === 0);
  q.value = '';
  q.dispatchEvent(new w.Event('input'));
  await wait(30);

  ok('the search box says what it searches here',
     q.placeholder.includes('shelf'), q.placeholder);

  /* --- a book added on this device ----------------------------------------- */
  // The reading of an uploaded file is bookify.js, which 15-book-import.js
  // covers. What matters here is the other half: a book in this browser's own
  // storage stands on the shelf beside the published ones, opens with no
  // network at all, and can be taken off again.
  const offline = function (url) {
    return String(url).includes("books/")
      ? Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })
      : Promise.resolve({ ok: true, status: 200,
          json: () => Promise.resolve(JSON.parse(read('docs/data.json'))) });
  };
  const c = boot({
    html: shell, full: true, idbSeed: [BOOK],
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: offline,
  });
  await wait(900);
  const cw = c.window, cd = c.doc;

  ok('the Books tab is there for a device with a book but no shelf online',
     !cd.getElementById('tab-books').hidden);
  click(cw, cd.getElementById('tab-books'));
  await wait(60);
  ok('  the button to add one sits above the list',
     !cd.getElementById('shelf-add').hidden &&
     /Add a book/.test(cd.getElementById('book-add').textContent),
     cd.getElementById('book-add').textContent);
  ok('  and it takes a PDF or an EPUB',
     cd.getElementById('book-file').accept.includes('.pdf') &&
     cd.getElementById('book-file').accept.includes('.epub'),
     cd.getElementById('book-file').accept);
  ok('the book added here is on the shelf',
     cd.querySelector('.hit.passage .hw')?.textContent === 'A Test Book',
     cd.querySelector('.hit.passage .hw')?.textContent);

  click(cw, cd.querySelector('.hit'));
  await wait(60);
  ok('  it opens to its contents',
     cd.querySelectorAll('.toc-row').length === 2,
     cd.querySelectorAll('.toc-row').length + ' chapters');
  ok('  and offers to take it off the device',
     [...cd.querySelectorAll('.entry-nav button')]
       .some(b => b.textContent.includes('Remove')));

  click(cw, cd.querySelector('.toc-row'));
  await wait(60);
  ok('  a chapter reads with nothing fetched at all',
     cd.querySelectorAll('.read .prose p').length === 2,
     cd.querySelectorAll('.read .prose p').length + ' paragraphs');

  const back = [...cd.querySelectorAll('.entry-nav button')]
    .find(b => b.textContent.includes('Contents'));
  click(cw, back);
  await wait(30);
  click(cw, [...cd.querySelectorAll('.entry-nav button')]
    .find(b => b.textContent.includes('Remove')));
  await wait(120);
  ok('Remove takes the book off the shelf',
     cd.querySelectorAll('.hit').length === 0,
     cd.querySelectorAll('.hit').length + ' books left');

  click(cw, cd.getElementById('tab-dictionary'));
  await wait(30);
  ok('  and the add button stays out of the dictionary',
     cd.getElementById('shelf-add').hidden);
  ok('    which the stylesheet agrees with, [hidden] and all',
     /\.shelf-add\[hidden\] \{ display: none; \}/.test(read('app.css')));

  /* --- nowhere to put one -------------------------------------------------- */
  const art = read('engrowdict.html');
  ok('the artifact, which is one file with nothing beside it, does not offer to add',
     art.includes('MODE === "static" && !!window.indexedDB'));

  /* --- no shelf, no books, no tab ------------------------------------------ */
  shelfUp = false;
  const b = boot({
    html: shell, full: true,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: offline,
  });
  await wait(900);
  ok('a browser with no books and no shelf hides the tab, and still works',
     b.doc.getElementById('tab-books').hidden &&
     b.doc.querySelectorAll('.hit').length > 0);

  done();
})();
