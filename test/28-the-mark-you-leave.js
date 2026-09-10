/* The mark a reader leaves where they stopped.

   Not the same thing as keeping your place: that one is the pane's scroll
   position, remembered for you. This is a reader putting a finger on a line
   and saying, that one. One to a passage — a second would make it a
   highlighter, and the question it answers is where you got to.

   Placed from the card that opens over a selection. It was a double-click
   first, and a double-click cannot be told from the selection it makes: the
   browser dispatches dblclick after the mouseup that opened the card, so by
   the time the click could say "not that, this" the card was already up. The
   card is the better place anyway — it is open on the word, it knows where
   the word is, and a button in it is something a reader can see. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const MARK_KEY = 'engrowdict:mark:v1';

const mk = store => boot({
  html: shell, full: true, store: store || {},
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

const paras = g => [...g.doc.querySelectorAll('.detail .prose > *')];
const dots = g => g.doc.querySelectorAll('.readmark').length;

/* Select a word the way a reader does — a double-click is one way, and it is
   the selection it leaves that opens the card — then press the dot in it. */
function selectIn(g, i, from, to) {
  const para = paras(g)[i];
  const text = [...para.childNodes]
    .find(n => n.nodeType === 3 && n.textContent.length > to + 2);
  const r = g.doc.createRange();
  r.setStart(text, from);
  r.setEnd(text, to);
  g.window.getSelection().removeAllRanges();
  g.window.getSelection().addRange(r);
  para.dispatchEvent(new g.window.Event('mouseup', { bubbles: true }));
  return para;
}

const markBtn = g => g.doc.getElementById('mark-here');

async function markIn(g, i, from, to) {
  selectIn(g, i, from, to);
  await wait(60);
  click(g.window, markBtn(g));
  await wait(40);
}

async function openFirstPassage(g) {
  click(g.window, g.doc.getElementById('tab-passages'));
  await wait(40);
  click(g.window, g.doc.querySelector('.hit'));
  await wait(60);
}

(async () => {
  const store = {};
  const a = mk(store);
  await wait(900);
  await openFirstPassage(a);
  ok('a passage is open to read', paras(a).length > 2, paras(a).length + ' paragraphs');
  ok('  and it starts with no mark in it', dots(a) === 0, String(dots(a)));

  const before = paras(a)[1].textContent;
  selectIn(a, 1, 20, 25);
  await wait(60);
  ok('selecting a word offers a dot in the card, beside the speaker',
     !!markBtn(a) && markBtn(a).parentNode.classList.contains('picked'),
     markBtn(a) ? markBtn(a).parentNode.className : 'no button');
  ok('  saying what it will do when it is held',
     /how far you have read/.test(markBtn(a).title) &&
     markBtn(a).getAttribute('aria-label') === markBtn(a).title,
     markBtn(a).title);

  click(a.window, markBtn(a));
  await wait(40);
  ok('pressing it leaves the mark at that word', dots(a) === 1, String(dots(a)));
  ok('  and puts the card away, since that is the whole of the errand',
     a.doc.getElementById('lookup').hidden, 'card closed');
  ok('  kept under the id of the passage it is in',
     JSON.stringify(JSON.parse(store[MARK_KEY] || '{}').r0) === '{"p":1,"at":20}',
     store[MARK_KEY]);
  ok('  in the paragraph that was clicked, not another',
     paras(a)[1].querySelectorAll('.readmark').length === 1,
     [...paras(a)].map(p => p.querySelectorAll('.readmark').length).join(''));
  ok('  and the words are left exactly as they were',
     paras(a)[1].textContent === before,
     JSON.stringify(paras(a)[1].textContent.slice(0, 40)));

  await markIn(a, 2, 5, 10);
  ok('marking again moves it rather than leaving two', dots(a) === 1, String(dots(a)));
  ok('  to the paragraph marked this time',
     paras(a)[2].querySelectorAll('.readmark').length === 1 &&
     paras(a)[1].querySelectorAll('.readmark').length === 0,
     JSON.parse(store[MARK_KEY]).r0 && JSON.stringify(JSON.parse(store[MARK_KEY]).r0));

  /* --- it is still there when you come back ------------------------------- */
  click(a.window, a.doc.getElementById('tab-dictionary'));
  await wait(40);
  click(a.window, a.doc.getElementById('tab-passages'));
  await wait(80);
  ok('leaving the passage and coming back finds it still there', dots(a) === 1, String(dots(a)));

  const b = mk(store);
  await wait(900);
  await openFirstPassage(b);
  ok('  and so does a later visit', dots(b) === 1, String(dots(b)));

  /* --- one passage at a time ---------------------------------------------- */
  click(b.window, b.doc.getElementById('tab-passages'));
  await wait(40);
  click(b.window, b.doc.querySelectorAll('.hit')[1]);
  await wait(60);
  ok('a mark in one passage is not a mark in the next', dots(b) === 0, String(dots(b)));
  click(b.window, b.doc.querySelectorAll('.hit')[0]);
  await wait(60);
  ok('  and going back to the first still has it', dots(b) === 1, String(dots(b)));

  /* --- taking it off ------------------------------------------------------ */
  const whole = paras(b)[2].textContent;
  click(b.window, b.doc.querySelector('.readmark'));
  await wait(40);
  ok('clicking the mark takes it off', dots(b) === 0, String(dots(b)));
  ok('  out of the store as well, not just off the screen',
     !JSON.parse(b.store[MARK_KEY] || '{}').r0,
     b.store[MARK_KEY]);
  ok('  and the paragraph it was split around is whole again',
     paras(b)[2].textContent === whole &&
     [...paras(b)[2].childNodes].filter(n => n.nodeType === 3).length ===
       [...paras(b)[2].childNodes].filter(n => n.nodeType === 3).length,
     JSON.stringify(paras(b)[2].textContent.slice(0, 40)));

  ok('the passage says how to leave one', (() => {
    const hint = b.doc.querySelector('.read .hint');
    return !!hint && /red dot/.test(hint.textContent);
  })(), (b.doc.querySelector('.read .hint') || {}).textContent);

  ok('the dot is red, and its own colour in either theme',
     (read('app.css').match(/--mark:/g) || []).length === 3 &&
     /\.readmark \{[^}]*background: var\(--mark\)/.test(read('app.css')),
     'a colour of its own');
  ok('  and the button wears the same dot it will leave',
     /\.markbtn::before \{[^}]*background: var\(--mark\)/.test(read('app.css')),
     'the button carries the dot');

  done(a.errs.concat(b.errs));
})();
