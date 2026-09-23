/* The marks a reader leaves on the words themselves.

   Not the dot: that one answers where you stopped, there is one of it, and
   test 28 is about it. This answers what was worth stopping at, which is a
   different question and not one with a single answer — so the passage takes
   as many as it deserves, and they are kept by the words rather than by the
   screen, which is what lets them survive the column opening beside them and
   the phone turning on its side. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const HL_KEY = 'engrowdict:hl:v1';
const MARK_KEY = 'engrowdict:mark:v1';

/* One short book, for the half of this that is about chapters. */
const SHELF = [{
  slug: 'a-test-book', title: 'A Test Book', author: 'Nobody',
  chapters: [{ n: 1, title: 'ONE', words: 9 }, { n: 2, title: 'TWO', words: 8 }],
}];
const BOOK = {
  slug: 'a-test-book', title: 'A Test Book', author: 'Nobody',
  chapters: [
    { n: 1, title: 'ONE', paras: ['The rain in the valley fell all afternoon.',
                                  'Nobody minded it very much at all.'] },
    { n: 2, title: 'TWO', paras: ['Morning came up behind the hill, slowly.'] },
  ],
};

const mk = store => boot({
  html: shell, full: true, store: store || {},
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

const paras = g => [...g.doc.querySelectorAll('.detail .prose > *')];
const washes = g => g.doc.querySelectorAll('.detail .prose mark.hl').length;
const hlBtn = g => g.doc.getElementById('highlight-this');
const offBtn = g => g.doc.getElementById('unhighlight-this');
const kept = g => JSON.parse(g.store[HL_KEY] || '{}');

/* A paragraph's own words, without the A/B/C label, which is what the page
   counts highlights in and so what this counts them in too. */
const label = para => (para.querySelector('.pmark') || { textContent: '' }).textContent;
const text = para => para.textContent.slice(label(para).length);

/* A character of a paragraph, as the node and offset a range wants. Counted
   through the text nodes rather than taken off the first one, because a
   paragraph with a highlight in it is a paragraph split into several — and a
   test that selected by the first node would quietly start selecting other
   words the moment the feature it is testing worked. */
function pointIn(para, at) {
  const skip = para.querySelector('.pmark');
  const walk = para.ownerDocument.createTreeWalker(para, 4);
  let seen = 0, t;
  while ((t = walk.nextNode())) {
    if (skip && skip.contains(t)) continue;
    const len = t.textContent.length;
    if (seen + len >= at) return { node: t, at: at - seen };
    seen += len;
  }
  return { node: para, at: para.childNodes.length };
}

/* Select the way a reader does — the drag is not something jsdom has, so the
   range it would have left is made directly and the mouseup that opens the
   card is fired after it, which is the order the browser does it in. */
function selectIn(g, i, from, to) {
  const para = paras(g)[i];
  const a = pointIn(para, from), b = pointIn(para, to);
  const r = g.doc.createRange();
  r.setStart(a.node, a.at);
  r.setEnd(b.node, b.at);
  g.window.getSelection().removeAllRanges();
  g.window.getSelection().addRange(r);
  para.dispatchEvent(new g.window.Event('mouseup', { bubbles: true }));
  return para;
}

async function hlIn(g, i, from, to) {
  selectIn(g, i, from, to);
  await wait(60);
  click(g.window, hlBtn(g));
  await wait(40);
}

async function openFirstPassage(g) {
  click(g.window, g.doc.getElementById('tab-passages'));
  await wait(40);
  click(g.window, g.doc.querySelector('.hit'));
  await wait(60);
}

/* What the page is showing, as plain text, so nothing below can pass by
   wrapping the words in something and losing one of them. */
const proseText = g => paras(g).map(p => p.textContent).join('\n');

(async () => {
  const store = {};
  const a = mk(store);
  await wait(900);
  await openFirstPassage(a);
  ok('a passage is open to read', paras(a).length > 2, paras(a).length + ' paragraphs');
  ok('  and nothing in it is marked yet', washes(a) === 0, String(washes(a)));

  const whole = proseText(a);
  const words = text(paras(a)[1]);

  /* --- one highlight ------------------------------------------------------ */
  selectIn(a, 1, 10, 24);
  await wait(60);
  ok('selecting words offers to highlight them, under what the card already had',
     !!hlBtn(a) && hlBtn(a).parentNode.classList.contains('hl-row')
     && hlBtn(a).parentNode === a.doc.getElementById('lookup').lastChild,
     hlBtn(a) ? 'last row' : 'no button');
  ok('  and offers nothing to take off, there being nothing on',
     !offBtn(a), offBtn(a) ? 'offered' : 'not offered');

  click(a.window, hlBtn(a));
  await wait(40);
  ok('pressing it washes those words', washes(a) > 0, String(washes(a)));
  ok('  and puts the card away, the errand being done',
     a.doc.getElementById('lookup').hidden, 'card closed');
  ok('  exactly those words, neither more nor less',
     a.doc.querySelector('.detail .prose mark.hl').textContent
       === words.slice(10, 24),
     JSON.stringify(a.doc.querySelector('.detail .prose mark.hl').textContent));
  ok('  and the paragraph still says what it said',
     proseText(a) === whole, 'unchanged');
  ok('  kept by the words, as a paragraph and characters into it',
     JSON.stringify(kept(a)['r:r0']) === '[{"p":1,"from":10,"to":24}]',
     store[HL_KEY]);

  /* --- as many as the passage deserves ------------------------------------ */
  await hlIn(a, 3, 5, 20);
  await hlIn(a, 4, 0, 12);
  ok('a second and a third leave three, not one moved twice',
     (kept(a)['r:r0'] || []).length === 3,
     JSON.stringify(kept(a)['r:r0']));
  ok('  each in the paragraph it was made in',
     [1, 3, 4].every(i => paras(a)[i].querySelectorAll('mark.hl').length > 0)
     && paras(a)[2].querySelectorAll('mark.hl').length === 0,
     paras(a).map(p => p.querySelectorAll('mark.hl').length).join(''));

  /* --- two that touch are one --------------------------------------------- */
  selectIn(a, 1, 24, 30);
  await wait(60);
  click(a.window, hlBtn(a));
  await wait(40);
  const one = (kept(a)['r:r0'] || []).filter(r => r.p === 1);
  ok('highlighting the words next to a highlight grows it rather than laying a second',
     one.length === 1 && one[0].from === 10 && one[0].to === 30,
     JSON.stringify(one));

  /* --- and it is still there when you come back --------------------------- */
  click(a.window, a.doc.getElementById('tab-dictionary'));
  await wait(40);
  click(a.window, a.doc.getElementById('tab-passages'));
  await wait(80);
  ok('leaving the passage and coming back finds them still there',
     washes(a) >= 3, String(washes(a)));

  const b = mk(store);
  await wait(900);
  await openFirstPassage(b);
  ok('  and so does a later visit', washes(b) >= 3, String(washes(b)));

  /* --- one passage at a time ---------------------------------------------- */
  click(b.window, b.doc.getElementById('tab-passages'));
  await wait(40);
  click(b.window, b.doc.querySelectorAll('.hit')[1]);
  await wait(60);
  ok('what is marked in one passage is not marked in the next',
     washes(b) === 0, String(washes(b)));
  click(b.window, b.doc.querySelectorAll('.hit')[0]);
  await wait(60);
  ok('  and going back to the first still has them', washes(b) >= 3, String(washes(b)));

  /* --- taking one off ------------------------------------------------------ */
  const before = proseText(b);
  const mark = b.doc.querySelector('.detail .prose mark.hl');
  mark.dispatchEvent(new b.window.Event('mouseup', { bubbles: true }));
  await wait(60);
  ok('pressing a highlight opens the card on it, offering to take it off',
     !!offBtn(b) && !hlBtn(b), offBtn(b) ? 'offered' : 'not offered');

  click(b.window, offBtn(b));
  await wait(40);
  ok('  and pressing that takes it off', (kept(b)['r:r0'] || []).length === 2,
     JSON.stringify(kept(b)['r:r0']));
  ok('  out of the store as well, not just off the screen',
     !JSON.stringify(kept(b)['r:r0'] || []).includes('"p":1'),
     JSON.stringify(kept(b)['r:r0']));
  ok('  leaving the words it was on joined back up as they were',
     proseText(b) === before, 'unchanged');
  ok('  and the other two where they were', washes(b) > 0, String(washes(b)));

  /* --- the dot and the wash are two different marks ------------------------ */
  const c = mk({});
  await wait(900);
  await openFirstPassage(c);
  await hlIn(c, 1, 10, 30);
  selectIn(c, 1, 12, 18);
  await wait(60);
  ok('selecting inside a highlight offers to take it off and not to lay it twice',
     !!offBtn(c) && !hlBtn(c),
     (hlBtn(c) ? 'both' : 'only the one'));

  click(c.window, c.doc.getElementById('mark-here'));
  await wait(40);
  ok('the dot can still be left inside a highlight, both being marks on one line',
     c.doc.querySelectorAll('.readmark').length === 1 && washes(c) > 0,
     c.doc.querySelectorAll('.readmark').length + ' dot, ' + washes(c) + ' wash');
  ok('  and the dot is kept where it always was, apart from the highlights',
     !!JSON.parse(c.store[MARK_KEY] || '{}').r0 && !!c.store[HL_KEY],
     c.store[MARK_KEY]);

  /* --- a paragraph is too long to translate and not too long to keep ------- */
  const d = mk({});
  await wait(900);
  await openFirstPassage(d);
  const long = paras(d).findIndex(p => p.textContent.length > 320);
  if (long > -1) {
    const para = paras(d)[long];
    const r = d.doc.createRange();
    r.selectNodeContents(para);
    d.window.getSelection().removeAllRanges();
    d.window.getSelection().addRange(r);
    para.dispatchEvent(new d.window.Event('mouseup', { bubbles: true }));
    await wait(80);
    ok('a whole paragraph is too long to be a question about a phrase',
       !d.doc.querySelector('#lookup .glosses'), 'no senses, no translation');
    ok('  but the card still comes back, with the highlighter in it',
       !d.doc.getElementById('lookup').hidden && !!hlBtn(d),
       hlBtn(d) ? 'offered' : 'not offered');
    click(d.window, hlBtn(d));
    await wait(40);
    ok('  and it marks the paragraph', para.querySelectorAll('mark.hl').length > 0,
       String(para.querySelectorAll('mark.hl').length));
  }

  /* --- a chapter is a passage, and keeps its own -------------------------- */
  const shelfStore = {};
  const e = boot({
    html: shell, full: true, store: shelfStore,
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
  click(e.window, e.doc.getElementById('tab-books'));
  await wait(60);
  click(e.window, e.doc.querySelector('.hit'));
  await wait(120);
  click(e.window, e.doc.querySelector('.toc-row'));
  await wait(120);
  ok('a chapter of a book opens the same way a passage does',
     paras(e).length === 2, paras(e).length + ' paragraphs');

  await hlIn(e, 0, 4, 14);
  ok('  and takes the same highlights', washes(e) === 1, String(washes(e)));
  ok('  kept under the chapter, not the book',
     !!kept(e)['b:a-test-book:1'] && !kept(e)['b:a-test-book:2'],
     Object.keys(kept(e)).join(', '));

  click(e.window, [...e.doc.querySelectorAll('.entry-nav .btn')]
    .find(b => /Contents/.test(b.textContent)));
  await wait(80);
  click(e.window, e.doc.querySelectorAll('.toc-row')[1]);
  await wait(120);
  ok('  so the next chapter opens clean', washes(e) === 0, String(washes(e)));

  /* --- how it is found ----------------------------------------------------- */
  ok('the passage says the highlighter is there', (() => {
    const hint = d.doc.querySelector('.read .hint');
    return !!hint && /[Hh]ighlight/.test(hint.textContent);
  })(), (d.doc.querySelector('.read .hint') || {}).textContent);

  const css = read('app.css');
  ok('the wash has a tone of its own in every palette',
     (css.match(/--hl:/g) || []).length === (css.match(/--ground:/g) || []).length,
     (css.match(/--hl:/g) || []).length + ' of ' + (css.match(/--ground:/g) || []).length);
  ok('  and it is a wash behind the words, not a colour over them',
     /mark\.hl \{[^}]*background: var\(--hl\)/.test(css)
     && /mark\.hl \{[^}]*color: inherit/.test(css),
     'the ink is left alone');
  ok('  which the button that lays it wears, so it needs no explaining',
     /\.hl-btn \{[^}]*background: var\(--hl\)/.test(css), 'the button carries the wash');

  done(a.errs.concat(b.errs, c.errs, d.errs, e.errs));
})();
