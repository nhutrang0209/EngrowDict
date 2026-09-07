/* The dictionary window you can keep open while reading a passage. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const POP_KEY = 'engrowdict:pop:v1';

const mk = store => boot({
  html: shell, full: true, store: store || {}, speech: true,
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
  // the headword span also carries the part of speech in an <i>
  const wordOf = node => [...node.childNodes]
    .filter(n => n.nodeName !== 'I').map(n => n.textContent).join('').trim();
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
     hits.length + ' results, first: ' + wordOf(hits[0].querySelector('.pd-w')));
  ok('  prefixes rank before matches buried in a definition',
     wordOf(hits[0].querySelector('.pd-w')).startsWith('zen'),
     [...hits].slice(0, 4).map(h => wordOf(h.querySelector('.pd-w'))).join(', '));
  ok('  the list is capped', doc.querySelectorAll('.pd-hit').length <= 40);

  ok('  the matched characters are marked, as on the dictionary tab',
     hits[0].querySelector('.pd-w mark')?.textContent === 'zen',
     hits[0].querySelector('.pd-w')?.innerHTML);
  ok('  and only those characters',
     wordOf(hits[0].querySelector('.pd-w')).length >
     hits[0].querySelector('.pd-w mark').textContent.length,
     hits[0].querySelector('.pd-w mark').textContent + ' of ' +
     wordOf(hits[0].querySelector('.pd-w')));

  typeIn('abate');
  ok('  an exact word wins outright',
     wordOf(doc.querySelector('.pd-hit .pd-w')) === 'abate',
     wordOf(doc.querySelector('.pd-hit .pd-w')));

  // a word whose only matches sit late in the alphabet must still rank first
  typeIn('yi');
  const yi = [...doc.querySelectorAll('.pd-hit')].map(h => wordOf(h.querySelector('.pd-w')));
  ok('  a headword starting with the query leads, wherever it sits in the a-z',
     yi[0] === 'yield' || yi[0] === 'yin', yi.slice(0, 5).join(', '));
  ok('  both of them before any word that merely contains it',
     yi.indexOf('yield') < yi.indexOf('be flying blind') &&
     yi.indexOf('yin') < yi.indexOf('be flying blind'),
     yi.slice(0, 6).join(', '));

  ok('  it looks up words, not meanings',
     yi.every(x => x.toLowerCase().includes('yi')),
     yi.filter(x => !x.toLowerCase().includes('yi')).join(', ') || 'every result contains it');

  typeIn('dinh cao');
  ok('  so a Vietnamese meaning finds nothing here',
     doc.querySelectorAll('.pd-hit').length === 0 &&
     (doc.querySelector('.pd-note')?.textContent || '').includes('Nothing'),
     doc.querySelector('.pd-note')?.textContent);

  /* --- walked with the arrow keys ---------------------------------------- */
  /* The window is a list of words, and the keys that walk a list of words are
     the two that walk the list on the Dictionary tab. Pressed on the window
     rather than on the box, because after picking a word the focus is on a
     button in here somewhere and they should still work. */
  /* cancelable, because a real keydown is: an event built without it takes
     preventDefault() and does nothing with it, and a test that leaves it out
     is asking the page a question no browser ever asks. */
  const press = key => pop().dispatchEvent(
    new w.KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
  const arrow = press;
  const marked = () => {
    const on = doc.querySelector('.pd-hit[aria-current="true"]');
    return on ? wordOf(on.querySelector('.pd-w')) : null;
  };

  typeIn('direct');
  const list = [...doc.querySelectorAll('.pd-hit')].map(h => wordOf(h.querySelector('.pd-w')));
  ok('nothing is marked before a key is pressed', marked() === null, marked());
  arrow('ArrowDown');
  ok('down marks the first result', marked() === list[0], marked());
  arrow('ArrowDown');
  ok('  and again the second', marked() === list[1], marked());
  arrow('ArrowUp');
  ok('up comes back', marked() === list[0], marked());
  arrow('ArrowUp');
  ok('  and stops at the top rather than wrapping round', marked() === list[0], marked());

  arrow('ArrowDown');
  press('Enter');
  ok('Enter opens the one that is marked',
     !!doc.querySelector('.pd-entry') && doc.querySelector('.pd-hw')?.textContent === list[1],
     doc.querySelector('.pd-hw')?.textContent);

  /* On an entry the same two keys turn the page, which is what they do on the
     Dictionary tab — the results of one search read through without going back
     to the list between each. */
  arrow('ArrowDown');
  ok('  from there they turn to the next word in the results',
     doc.querySelector('.pd-hw')?.textContent === list[2],
     doc.querySelector('.pd-hw')?.textContent);
  arrow('ArrowUp');
  ok('  and back to the one before it',
     doc.querySelector('.pd-hw')?.textContent === list[1],
     doc.querySelector('.pd-hw')?.textContent);

  click(w, doc.querySelector('.pd-back'));
  ok('  the results remember where the walk had got to',
     marked() === list[1], marked());

  typeIn('zenith');
  ok('  and typing again starts it over', marked() === null, marked());

  /* Nothing behind the window may move while these keys are being used in it:
     the passage list has the same two keys bound on the document. */
  const before = doc.querySelector('.read h1')?.textContent;
  arrow('ArrowDown');
  ok('the passage behind is left where it was',
     doc.querySelector('.read h1')?.textContent === before, before);

  click(w, doc.querySelector('.pd-hit'));
  ok('picking one shows its senses', !!doc.querySelector('.pd-entry'),
     doc.querySelector('.pd-hw')?.textContent);
  ok('  with phonetics and meaning',
     (doc.querySelector('.pd-ipa')?.textContent || '').includes('/') &&
     (doc.querySelector('.pd-entry .vi')?.textContent || '').includes('đỉnh'),
     doc.querySelector('.pd-ipa')?.textContent + ' — ' + doc.querySelector('.pd-entry .vi')?.textContent);
  ok('  and a way back to the results', !!doc.querySelector('.pd-back'));

  /* Same arithmetic as the workspace grid: a block with one child must not be
     laid out in two tracks, or the text is squeezed into the 20px meant for
     the sense number and wraps a word to a line. */
  const css = read('app.css');
  const tracksOf = sel => {
    const i = css.indexOf(sel);
    const j = css.indexOf('grid-template-columns:', i);
    return css.slice(j + 'grid-template-columns:'.length, css.indexOf(';', j))
      .trim().split(/\s+/).length;
  };
  const solo = doc.querySelector('.pd-sense');
  ok('a lone sense is laid out in one track',
     solo.classList.contains('solo') &&
     tracksOf('.pd-sense.solo') === solo.children.length,
     solo.className + ', ' + solo.children.length + ' child, ' +
     tracksOf('.pd-sense.solo') + ' track');

  typeIn('strike');
  click(w, doc.querySelector('.pd-hit'));
  const many = doc.querySelector('.pd-sense');
  ok('a numbered sense is laid out in two',
     !many.classList.contains('solo') &&
     tracksOf('.pd-sense {') === many.children.length,
     many.children.length + ' children, ' + tracksOf('.pd-sense {') + ' tracks');
  ok('  and the numbers are there', doc.querySelectorAll('.pd-num').length > 1,
     doc.querySelectorAll('.pd-num').length + ' numbered senses');

  typeIn('zenith');
  click(w, doc.querySelector('.pd-hit'));
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

  /* --- the word, said out loud ------------------------------------------ */
  const said = doc.querySelector('#popdict .pd-head-word .say');
  ok('the floating dictionary says the word too',
     !!said && /^Say /.test(said.getAttribute('aria-label')),
     said ? said.getAttribute('aria-label') : 'no button');
  click(w, said);
  ok('  in an English voice, like everywhere else',
     w.spoken.some(x => / @en-GB\/GB$/.test(x)), w.spoken.join(' | '));

  done(a.errs.concat(b.errs));
})();
