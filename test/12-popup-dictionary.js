/* The dictionary window you can keep open while reading a passage. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const POP_KEY = 'engrowdict:pop:v1';

const mk = store => boot({
  html: shell, full: true, store: store || {},
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

(async () => {
  const store = {};
  const a = mk(store);
  await wait(900);
  const { doc, window: w } = a;
  const btn = () => doc.getElementById('popdict-btn');
  const pop = () => doc.getElementById('popdict');
  const typeIn = v => {
    const i = doc.getElementById('pd-q');
    i.value = v;
    i.dispatchEvent(new w.Event('input'));
  };

  /* --- it belongs to the reading tab ------------------------------------ */
  ok('the dictionary tab does not offer it', btn().hidden);
  click(w, doc.getElementById('tab-passages'));
  await wait(30);
  ok('the passages tab does', !btn().hidden);
  ok('  and it starts closed', !pop() || pop().hidden);

  click(w, doc.getElementById('tab-passages'));   // open a passage to read
  click(w, doc.querySelector('.hit'));
  await wait(40);

  /* --- opening and searching -------------------------------------------- */
  click(w, btn());
  ok('the button opens the window', !!pop() && !pop().hidden);
  ok('  and the button shows it is on', btn().getAttribute('aria-pressed') === 'true');
  ok('  with a prompt until something is typed',
     (doc.querySelector('.pd-note')?.textContent || '').includes('Type a word'));

  typeIn('zen');
  const hits = doc.querySelectorAll('.pd-hit');
  ok('typing searches the whole dictionary, not the passage', hits.length > 0,
     hits.length + ' results, first: ' + hits[0].querySelector('.pd-w')?.firstChild.textContent);
  ok('  prefixes rank before matches buried in a definition',
     hits[0].querySelector('.pd-w').firstChild.textContent.trim().startsWith('zen'),
     hits[0].querySelector('.pd-w').firstChild.textContent);
  ok('  the list is capped', doc.querySelectorAll('.pd-hit').length <= 40);

  typeIn('abate');
  ok('  an exact word wins outright',
     doc.querySelector('.pd-hit .pd-w').firstChild.textContent.trim() === 'abate',
     doc.querySelector('.pd-hit .pd-w').firstChild.textContent);

  typeIn('dinh cao');
  ok('  and Vietnamese without tone marks reaches it too',
     doc.querySelectorAll('.pd-hit').length > 0,
     doc.querySelector('.pd-hit .pd-w')?.firstChild.textContent);

  typeIn('zenith');
  click(w, doc.querySelector('.pd-hit'));
  ok('picking one shows its senses', !!doc.querySelector('.pd-entry'),
     doc.querySelector('.pd-hw')?.textContent);
  ok('  with phonetics and meaning',
     (doc.querySelector('.pd-ipa')?.textContent || '').includes('/') &&
     (doc.querySelector('.pd-entry .vi')?.textContent || '').includes('đỉnh'),
     doc.querySelector('.pd-ipa')?.textContent + ' — ' + doc.querySelector('.pd-entry .vi')?.textContent);
  ok('  and a way back to the results', !!doc.querySelector('.pd-back'));
  click(w, doc.querySelector('.pd-back'));
  ok('  which returns to them', !!doc.querySelector('.pd-hits'));

  /* --- the passage stays put -------------------------------------------- */
  ok('the passage is still there behind it',
     doc.querySelectorAll('.read .prose p').length > 1,
     doc.querySelector('.read h1')?.textContent);

  /* --- a selection feeds the open window --------------------------------- */
  w.getSelection = () => ({
    isCollapsed: false,
    toString: () => 'abating',
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 80, top: 150, width: 50, bottom: 166 }) }),
  });
  doc.querySelector('.read .prose').dispatchEvent(new w.Event('mouseup'));
  await wait(30);
  ok('selecting text while it is open feeds it instead of the small card',
     doc.getElementById('pd-q').value === 'abating' &&
     doc.querySelector('.pd-hw')?.textContent === 'abate',
     doc.querySelector('.pd-hw')?.textContent);
  ok('  and the small card stays out of the way',
     !doc.getElementById('lookup') || doc.getElementById('lookup').hidden);

  /* --- dragging is remembered -------------------------------------------- */
  const head = doc.querySelector('.pd-head');
  head.dispatchEvent(new w.MouseEvent('mousedown', { clientX: 300, clientY: 100, bubbles: true }));
  doc.dispatchEvent(new w.MouseEvent('mousemove', { clientX: 360, clientY: 220, bubbles: true }));
  doc.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
  ok('it can be dragged out of the way', !!pop().style.left && !!pop().style.top,
     pop().style.left + ' / ' + pop().style.top);
  ok('  and remembers where it was put', !!store[POP_KEY], store[POP_KEY]);

  /* --- closing ------------------------------------------------------------ */
  click(w, doc.querySelector('.pd-x'));
  ok('the × closes it', pop().hidden);
  click(w, btn());
  ok('the button reopens it', !pop().hidden);

  // leaving the reading tab puts it away
  click(w, doc.getElementById('tab-dictionary'));
  await wait(30);
  ok('going back to the dictionary closes it', pop().hidden);
  ok('  and takes its button away', btn().hidden);

  /* --- opening one from the window --------------------------------------- */
  click(w, doc.getElementById('tab-passages'));
  await wait(30);
  click(w, doc.querySelector('.hit'));
  await wait(30);
  click(w, btn());
  typeIn('zenith');
  click(w, doc.querySelector('.pd-hit'));
  click(w, doc.querySelector('.pd-entry .btn'));
  await wait(40);
  ok('"Open in the dictionary" takes you to the full entry',
     doc.querySelector('.headword')?.textContent === 'zenith' &&
     doc.getElementById('tab-dictionary').getAttribute('aria-selected') === 'true',
     doc.querySelector('.headword')?.textContent);
  ok('  and closes the window behind it', pop().hidden);

  /* --- a fresh visit keeps the position ---------------------------------- */
  const b = mk(store);
  await wait(900);
  click(b.window, b.doc.getElementById('tab-passages'));
  await wait(30);
  click(b.window, b.doc.getElementById('popdict-btn'));
  ok('a later visit opens it where you left it',
     b.doc.getElementById('popdict').style.left === JSON.parse(store[POP_KEY]).left,
     b.doc.getElementById('popdict').style.left);

  done(a.errs.concat(b.errs));
})();
