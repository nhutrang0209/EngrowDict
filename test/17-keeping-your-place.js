/* Keeping your place in a passage, and the way back to it.

   A passage is longer than a screen: how far down you were is kept per
   passage and put back when it is opened again. And looking a word up from a
   passage no longer strands you in the dictionary — the entry carries a
   button back to what you were reading.

   jsdom does no layout, so the pane's heights are stubbed: what is under test
   is the bookkeeping, not the browser's scrolling. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const PLACE_KEY = 'engrowdict:place:v1';

const mk = store => boot({
  html: shell, full: true, store: store || {},
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

/* A pane with something to scroll: 3000 px of passage in a 600 px window. */
function scrollable(doc, height) {
  const box = doc.querySelector('.detail');
  Object.defineProperty(box, 'scrollHeight', { value: height || 3000, configurable: true });
  Object.defineProperty(box, 'clientHeight', { value: 600, configurable: true });
  return box;
}

const scrollTo = (w, box, top) => {
  box.scrollTop = top;
  box.dispatchEvent(new w.Event('scroll'));
};

(async () => {
  const store = {};
  const a = mk(store);
  await wait(900);
  const { doc, window: w } = a;

  click(w, doc.getElementById('tab-passages'));
  await wait(30);
  const first = doc.querySelectorAll('.hit')[0];
  const second = doc.querySelectorAll('.hit')[1];
  click(w, first);
  await wait(30);
  const title = doc.querySelector('.read h1').textContent;
  ok('a passage opens in the pane', !!title, title);

  const box = scrollable(doc);
  ok('  and it starts at the top', box.scrollTop === 0, String(box.scrollTop));

  scrollTo(w, box, 1200);                 // half way down 2400 px of room
  await wait(300);
  const kept = JSON.parse(store[PLACE_KEY] || '{}');
  ok('reading down the passage keeps the place',
     Object.keys(kept).length === 1 &&
     Math.abs(Object.values(kept)[0].at - 0.5) < 0.01,
     JSON.stringify(kept));
  ok('  under the passage\'s own key', Object.keys(kept)[0] === 'r:r0', Object.keys(kept)[0]);

  // another passage is another place: this one opens at the top
  click(w, second);
  await wait(30);
  ok('opening a different passage starts it at the top', box.scrollTop === 0,
     String(box.scrollTop));

  click(w, first);
  await wait(30);
  ok('coming back to the first one opens where it was left', box.scrollTop === 1200,
     String(box.scrollTop));

  /* The end used to be dropped, on the reasoning that a passage read through
     is finished and should open fresh. A reader who goes to the end to check
     something and comes back to find it rewound is not helped by that, and
     "put me back where I was" is the whole of what this is for. It is kept.

     (The assertion that stood here asked after the key 'r:0'. The key is
     'r:r0'. It passed on every run and would have gone on passing whatever
     the code did.) */
  scrollTo(w, box, 2400);
  await wait(300);
  ok('read to the end, the end is where it is kept',
     Math.abs(JSON.parse(store[PLACE_KEY] || '{}')['r:r0'].at - 1) < 0.01,
     store[PLACE_KEY]);

  scrollTo(w, box, 900);
  await wait(300);

  /* --- a later visit ----------------------------------------------------- */
  const b = mk(store);
  await wait(900);
  click(b.window, b.doc.getElementById('tab-passages'));
  await wait(30);
  const bBox = scrollable(b.doc);
  click(b.window, b.doc.querySelectorAll('.hit')[0]);
  await wait(30);
  ok('a later visit opens the passage where reading stopped', bBox.scrollTop === 900,
     String(bBox.scrollTop));

  /* --- the way back ------------------------------------------------------ */
  // the bar carries the lookup box on this tab; typing in it is the whole gesture
  const q = b.doc.getElementById('lk-q');
  q.value = 'zenith';
  q.dispatchEvent(new b.window.Event('input'));
  await wait(20);
  click(b.window, b.doc.querySelector('.pd-hit'));
  click(b.window, b.doc.querySelector('.pd-entry .btn'));
  await wait(40);
  const back = b.doc.getElementById('back-to-reading');
  ok('opening a word from a passage leaves a way back to it', !!back,
     back && back.textContent);
  ok('  and it says which passage by name',
     !!back && back.textContent.indexOf(title) > -1, back && back.textContent);
  ok('  the entry itself is open behind it',
     b.doc.querySelector('.headword').textContent === 'zenith');

  click(b.window, back);
  await wait(40);
  ok('pressing it goes back to the passage',
     b.doc.getElementById('tab-passages').getAttribute('aria-selected') === 'true' &&
     !!b.doc.querySelector('.read h1'),
     b.doc.querySelector('.read h1') && b.doc.querySelector('.read h1').textContent);
  ok('  at the line it was left at', bBox.scrollTop === 900, String(bBox.scrollTop));
  ok('  and the way back is gone once it has been taken',
     !b.doc.getElementById('back-to-reading'));

  /* --- the dictionary on its own owes nothing ---------------------------- */
  click(b.window, b.doc.getElementById('tab-dictionary'));
  await wait(30);
  click(b.window, b.doc.getElementById('tab-passages'));
  await wait(30);
  ok('going to the dictionary from the list of passages offers no way back',
     !b.doc.getElementById('back-to-reading'));

  /* --- a chapter of a book keeps its own place --------------------------- */
  const SHELF = [{ slug: 'a-test-book', title: 'A Test Book', author: 'Nobody',
                   chapters: [{ n: 1, title: 'ONE', words: 9 },
                              { n: 2, title: 'TWO', words: 8 }] }];
  const BOOK = { slug: 'a-test-book', title: 'A Test Book', author: 'Nobody',
                 chapters: [{ n: 1, title: 'ONE', paras: ['The first chapter of it.'] },
                            { n: 2, title: 'TWO', paras: ['The second chapter of it.'] }] };
  const c = boot({
    html: shell, full: true, store,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: url => {
      const u = String(url);
      if (u.includes('books/index.json')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SHELF) });
      }
      if (u.includes('books/a-test-book.json')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(BOOK) });
      }
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(read('docs/data.json'))) });
    },
  });
  await wait(900);
  click(c.window, c.doc.getElementById('tab-books'));
  await wait(30);
  click(c.window, c.doc.querySelector('.hit'));
  await wait(30);
  click(c.window, c.doc.querySelector('.toc-row'));
  await wait(60);
  const cBox = scrollable(c.doc);
  scrollTo(c.window, cBox, 600);
  await wait(300);
  ok('a chapter keeps its place under the book and the chapter',
     JSON.parse(store[PLACE_KEY])['b:a-test-book:1'].at === 0.25, store[PLACE_KEY]);

  const toContents = () => {
    const up = [...c.doc.querySelectorAll('.entry-nav .btn')]
      .find(x => x.textContent.indexOf('Contents') > -1);
    click(c.window, up);
  };
  toContents();
  await wait(30);
  click(c.window, c.doc.querySelectorAll('.toc-row')[1]);
  await wait(60);
  ok('  the next chapter starts at its own top', cBox.scrollTop === 0, String(cBox.scrollTop));

  toContents();
  await wait(30);
  click(c.window, c.doc.querySelector('.toc-row'));
  await wait(60);
  ok('  and coming back to the first opens where it was left', cBox.scrollTop === 600,
     String(cBox.scrollTop));

  /* --- leaving the tab and coming back ------------------------------------
     Keeping your place in something you have to go and find again is not
     keeping your place. Pressing Dictionary and then Passages used to put the
     reader back at the list, with the passage closed and the place kept for a
     passage nobody was in. */
  const d = mk(store);
  await wait(900);
  click(d.window, d.doc.getElementById('tab-passages'));
  await wait(40);
  const dBox = scrollable(d.doc);
  click(d.window, d.doc.querySelectorAll('.hit')[0]);
  await wait(40);
  const dTitle = d.doc.querySelector('.read h1').textContent;
  scrollTo(d.window, dBox, 1500);
  await wait(300);

  click(d.window, d.doc.getElementById('tab-dictionary'));
  await wait(40);
  ok('leaving the passages shows the dictionary, not the passage',
     !d.doc.querySelector('.read h1'), 'left');

  click(d.window, d.doc.getElementById('tab-passages'));
  await wait(60);
  ok('coming back opens the passage that was being read, not the list',
     !!d.doc.querySelector('.read h1') &&
     d.doc.querySelector('.read h1').textContent === dTitle,
     (d.doc.querySelector('.read h1') || {}).textContent || 'the list');
  ok('  at the line it was left at', dBox.scrollTop === 1500, String(dBox.scrollTop));

  /* --- the place is a paragraph, not a fraction of the height --------------
     A fraction only means anything while the height does not change, and it
     changes: the translation column opens beside the passage and the text
     narrows, the divider is dragged, the fonts arrive. Every one of those
     moved the line the reader was put back to.

     jsdom lays nothing out, so the paragraphs are given rectangles. On the
     prototype rather than on the nodes, because the pane is redrawn between
     keeping the place and putting it back, and rectangles hung on the old
     nodes would go with them. */
  let tall = 400;                       // the height of one paragraph, changed below
  const detail = d.doc.querySelector('.detail');
  detail.getBoundingClientRect =
    () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 0 });
  d.window.Element.prototype.getBoundingClientRect = function () {
    const host = this.parentNode;
    if (!host || !host.classList || !host.classList.contains('prose')) {
      return { top: 0, bottom: 0, height: 0, left: 0, right: 0 };
    }
    // paragraph i begins i paragraphs down the passage, and the reading area
    // starts at 0, so this is simply where it sits from where we are scrolled
    const i = [...host.children].indexOf(this);
    const top = i * tall - detail.scrollTop;
    return { top, bottom: top + tall, height: tall, left: 0, right: 0 };
  };

  // 1000px down 400px paragraphs is paragraph 2, halfway through it
  scrollTo(d.window, dBox, 1000);
  await wait(300);
  const mark = JSON.parse(store[PLACE_KEY])['r:r0'];
  ok('what is kept is which paragraph, and how far through it',
     mark.p === 2 && Math.abs(mark.into - 0.5) < 0.02, JSON.stringify(mark));

  /* The same passage half again as tall — the translation column opened beside
     it, say, and the text narrowed. Paragraph 2 now begins at 1200 and half of
     it is 300, so the line the reader was on is at 1500. The fraction that was
     kept before would have put them at 1000 again, five hundred pixels and
     more than a paragraph short of it. */
  click(d.window, d.doc.getElementById('tab-dictionary'));
  await wait(40);
  tall = 600;                      // the layout changes while the reader is away
  click(d.window, d.doc.getElementById('tab-passages'));
  await wait(60);
  ok('  and it is that paragraph that is found again, at whatever height',
     Math.abs(dBox.scrollTop - 1500) < 3,
     dBox.scrollTop + ', wanted 1500 — where a fraction would have said 1000');

  done(a.errs.concat(b.errs, c.errs, d.errs));
})();
