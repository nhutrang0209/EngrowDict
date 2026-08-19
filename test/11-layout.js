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

  /* --- a passage uses the whole width; folding hides only the list ------- */
  const c = mk({});
  await wait(900);
  click(c.window, c.doc.getElementById('tab-passages'));
  await wait(30);
  click(c.window, c.doc.querySelector('.hit'));
  await wait(60);

  ok('a passage is given the full width',
     c.doc.getElementById('detail-inner').className.includes('wide'));
  ok('  with no side column beside it', !c.doc.querySelector('.fromtext'));
  ok('  and the prose measure is uncapped',
     /\.detail-inner\.wide \.read \{[^}]*max-width: none/.test(read('app.css')));
  ok('the dictionary view keeps its narrower measure', (() => {
    click(c.window, c.doc.getElementById('tab-dictionary'));
    return !c.doc.getElementById('detail-inner').className.includes('wide');
  })(), c.doc.getElementById('detail-inner').className);

  // folding while reading must not take the passage away with it
  click(c.window, c.doc.getElementById('tab-passages'));
  await wait(30);
  click(c.window, c.doc.querySelector('.hit'));
  await wait(40);
  const title = c.doc.querySelector('.read h1')?.textContent;
  click(c.window, c.doc.getElementById('fold'));
  ok('folding hides the list', c.doc.body.dataset.list === 'off');
  ok('  and the letter rail with it',
     /body\[data-list="off"\] \.alpha, body\[data-list="off"\] \.list \{ display: none/
       .test(read('app.css')));
  ok('  while the passage stays on screen',
     c.doc.querySelector('.read h1')?.textContent === title &&
     c.doc.querySelectorAll('.read .prose p').length > 1,
     c.doc.querySelector('.read h1')?.textContent + ' — ' +
     c.doc.querySelectorAll('.read .prose p').length + ' paragraphs');
  ok('  and the detail column is the only one left with width',
     /body\[data-list="off"\] \.work \{ grid-template-columns: 0 0 7px 1fr/
       .test(read('app.css')));

  done(a.errs.concat(b.errs, c.errs));
})();
