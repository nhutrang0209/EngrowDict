/* The list column: draggable, foldable, and remembered. And the panel that
   fills the space beside a passage — the words the notebook already holds. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const LIST_KEY = 'engrowdict:list:v1';
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
  const root = doc.documentElement;
  const widthNow = () => root.style.getPropertyValue('--list-w');

  /* --- the divider ------------------------------------------------------- */
  ok('there is a divider between the list and the page',
     !!doc.getElementById('resizer') && doc.getElementById('resizer').getAttribute('role') === 'separator');
  ok('the list starts open and at its default width',
     doc.body.dataset.list === 'on' && widthNow() === '348px', widthNow());

  // drag it wider
  const bar = doc.getElementById('resizer');
  bar.dispatchEvent(new w.MouseEvent('mousedown', { clientX: 378, bubbles: true }));
  doc.dispatchEvent(new w.MouseEvent('mousemove', { clientX: 500, bubbles: true }));
  ok('dragging widens the list', parseInt(widthNow(), 10) > 400, widthNow());
  doc.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));
  ok('  and the width is remembered', JSON.parse(store[LIST_KEY]).w > 400,
     store[LIST_KEY]);

  // it will not shrink past the minimum or grow past the maximum
  bar.dispatchEvent(new w.MouseEvent('mousedown', { clientX: 500, bubbles: true }));
  doc.dispatchEvent(new w.MouseEvent('mousemove', { clientX: 10, bubbles: true }));
  ok('it stops at a usable minimum', widthNow() === '240px', widthNow());
  doc.dispatchEvent(new w.MouseEvent('mousemove', { clientX: 4000, bubbles: true }));
  ok('  and at a maximum', widthNow() === '620px', widthNow());
  doc.dispatchEvent(new w.MouseEvent('mouseup', { bubbles: true }));

  // arrow keys nudge it too
  bar.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  ok('arrow keys move the divider', widthNow() === '596px', widthNow());
  ok('  and that width is remembered too', JSON.parse(store[LIST_KEY]).w === 596,
     store[LIST_KEY]);

  /* --- folding ----------------------------------------------------------- */
  const fold = doc.getElementById('fold');
  ok('the chevron says it will hide the list', fold.title === 'Hide the list');
  click(w, fold);
  ok('clicking it folds the list away', doc.body.dataset.list === 'off');
  ok('  and the chevron turns around', fold.textContent === '›' && fold.title === 'Show the list');
  ok('  the choice is remembered', JSON.parse(store[LIST_KEY]).open === false);
  click(w, fold);
  ok('clicking again brings it back', doc.body.dataset.list === 'on');

  // a fresh visit restores both
  click(w, fold);
  const b = mk(store);
  await wait(900);
  ok('a later visit opens folded, at the same width',
     b.doc.body.dataset.list === 'off' &&
     b.doc.documentElement.style.getPropertyValue('--list-w') === '596px',
     b.doc.body.dataset.list + ' / ' + b.doc.documentElement.style.getPropertyValue('--list-w'));

  /* --- the panel beside a passage ---------------------------------------- */
  const c = mk({});
  await wait(900);
  click(c.window, c.doc.getElementById('tab-passages'));
  await wait(30);
  click(c.window, c.doc.querySelector('.hit'));
  await wait(60);

  ok('reading a passage lays the page out in two columns',
     c.doc.getElementById('detail-inner').className.includes('wide'));
  const aside = c.doc.querySelector('.fromtext');
  ok('the space beside the prose holds the notebook panel', !!aside,
     aside && aside.querySelector('h2')?.textContent);
  const items = c.doc.querySelectorAll('.ft-item');
  ok('  in the order they turn up in the passage',
     [...items].slice(0, 3).map(n => n.querySelector('.ft-w').firstChild.textContent.trim())
       .every(x => c.doc.querySelector('.read .prose').textContent.toLowerCase().includes(x.split(' ')[0])),
     [...items].slice(0, 3).map(n => n.querySelector('.ft-w').firstChild.textContent.trim()).join(' → '));
  ok('  listing words from this passage that the notebook has', items.length > 3,
     items.length + ' words: ' +
     [...items].slice(0, 5).map(n => n.querySelector('.ft-w')?.textContent.trim()).join(', '));
  ok('  each with its short Vietnamese meaning',
     [...items].every(n => (n.querySelector('.ft-vi')?.textContent || '').length > 0),
     items[0].querySelector('.ft-vi')?.textContent);
  ok('  and the count is shown', aside.querySelector('h2 .n')?.textContent === String(items.length),
     aside.querySelector('h2 .n')?.textContent);

  const word = items[0].querySelector('.ft-w').firstChild.textContent.trim();
  click(c.window, items[0]);
  await wait(40);
  ok('clicking one opens it in the dictionary',
     c.doc.querySelector('.headword')?.textContent === word,
     word + ' → ' + c.doc.querySelector('.headword')?.textContent);
  ok('  and the view has switched tabs',
     c.doc.getElementById('tab-dictionary').getAttribute('aria-selected') === 'true');

  ok('the dictionary view stays single-column',
     !c.doc.getElementById('detail-inner').className.includes('wide'),
     c.doc.getElementById('detail-inner').className);

  done(a.errs.concat(b.errs, c.errs));
})();
