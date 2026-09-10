/* The mark a reader leaves where they stopped.

   Not the same thing as keeping your place: that one is the pane's scroll
   position, remembered for you. This is a reader putting a finger on a line
   and saying, that one. One to a passage — a second would make it a
   highlighter, and the question it answers is where you got to.

   Placed by double-clicking, which costs the bar no button. The passage menu
   would have done, but that menu belongs to whoever may edit the passage, and
   stopping to read is not an editor's business. */
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

/* A double-click at a character of a paragraph: the caret the browser leaves
   at the start of the word it selects, then the event itself. */
function markAt(g, i, off) {
  const para = paras(g)[i];
  const text = [...para.childNodes].find(n => n.nodeType === 3 && n.textContent.length > off + 2);
  const r = g.doc.createRange();
  r.setStart(text, off);
  r.setEnd(text, off);
  g.window.getSelection().removeAllRanges();
  g.window.getSelection().addRange(r);
  para.dispatchEvent(new g.window.Event('mouseup', { bubbles: true }));
  para.dispatchEvent(new g.window.Event('dblclick', { bubbles: true }));
  return para;
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
  markAt(a, 1, 20);
  await wait(40);
  ok('double-clicking leaves a mark where the click landed', dots(a) === 1, String(dots(a)));
  ok('  kept under the id of the passage it is in',
     JSON.stringify(JSON.parse(store[MARK_KEY] || '{}').r0) === '{"p":1,"at":20}',
     store[MARK_KEY]);
  ok('  in the paragraph that was clicked, not another',
     paras(a)[1].querySelectorAll('.readmark').length === 1,
     [...paras(a)].map(p => p.querySelectorAll('.readmark').length).join(''));
  ok('  and the words are left exactly as they were',
     paras(a)[1].textContent === before,
     JSON.stringify(paras(a)[1].textContent.slice(0, 40)));

  /* The double-click selects the word under it, and a selection is what opens
     the card that looks a word up. That is not what was being asked for. */
  ok('  without the lookup card opening on the selection it made',
     !a.doc.getElementById('lookup') || a.doc.getElementById('lookup').hidden,
     'card stayed shut');

  markAt(a, 2, 5);
  await wait(40);
  ok('a second double-click moves it rather than leaving two', dots(a) === 1, String(dots(a)));
  ok('  to the paragraph clicked this time',
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
    return !!hint && /[Dd]ouble-click/.test(hint.textContent);
  })(), (b.doc.querySelector('.read .hint') || {}).textContent);

  ok('the dot is red, and its own colour in either theme',
     (read('app.css').match(/--mark:/g) || []).length === 3 &&
     /\.readmark \{[^}]*background: var\(--mark\)/.test(read('app.css')),
     'a colour of its own');

  done(a.errs.concat(b.errs));
})();
