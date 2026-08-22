/* The places, down the side.

   Across the top they shared the bar with the search box, and every place
   added made that worse. Down the side there is room for as many as there
   ever are; shut, the rail is the icons alone. Not on a phone, where the
   width is the scarce thing and the rail lies back down as a strip. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const LIST_KEY = 'engrowdict:list:v1';
const mk = (store, width) => boot({
  html: shell, full: true, store: store || {}, width: width,
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

(async () => {
  const store = {};
  const a = mk(store, 1440);
  await wait(900);
  const { doc, window: w } = a;
  const nav = () => doc.getElementById('tabs');

  /* --- where it is ------------------------------------------------------- */
  ok('the places are a rail in the workspace, not a strip in the bar',
     nav().parentNode.className === 'work' && nav().className === 'nav' &&
     !doc.querySelector('.top .tab'),
     nav().parentNode.className);
  ok('  and the first thing in it', doc.querySelector('.work').firstChild === nav());
  ok('  it is still a tablist, read down instead of across',
     nav().getAttribute('role') === 'tablist' &&
     nav().getAttribute('aria-orientation') === 'vertical');

  const tabs = [...nav().querySelectorAll('.tab')];
  ok('every place is on it', tabs.map(t => t.id).join(' ') ===
     'tab-dictionary tab-passages tab-books tab-translate',
     tabs.map(t => t.id).join(' '));
  ok('  each with an icon and its name',
     tabs.every(t => t.querySelector('.ico svg') && t.querySelector('.lab')),
     tabs.map(t => (t.querySelector('.lab') || {}).textContent).join(', '));
  ok('  and the name where it can be read with the rail shut',
     tabs.every(t => t.title && t.getAttribute('aria-label')),
     tabs.map(t => t.title).join(', '));

  /* --- it still switches the view ---------------------------------------- */
  click(w, doc.getElementById('tab-passages'));
  await wait(40);
  ok('pressing one goes there',
     doc.getElementById('tab-passages').getAttribute('aria-selected') === 'true' &&
     doc.getElementById('tab-dictionary').getAttribute('aria-selected') === 'false');
  click(w, doc.getElementById('tab-dictionary'));
  await wait(40);

  /* --- a place asked for is a place shown --------------------------------- */
  click(w, doc.getElementById('fold'));
  ok('the list can be folded away for room', doc.body.dataset.list === 'off');
  click(w, doc.getElementById('tab-books'));
  await wait(40);
  ok('  and choosing a place brings it back, since that is what was asked for',
     doc.body.dataset.list === 'on', doc.body.dataset.list);
  click(w, doc.getElementById('fold'));
  click(w, doc.getElementById('tab-dictionary'));
  await wait(40);
  ok('  whichever place it is', doc.body.dataset.list === 'on', doc.body.dataset.list);

  /* --- open and shut ----------------------------------------------------- */
  const fold = () => doc.getElementById('nav-fold');
  ok('a wide window opens with the names showing', doc.body.dataset.nav === 'on',
     doc.body.dataset.nav);
  ok('  and the chevron offers to shut it', fold().textContent === '«',
     fold().textContent + ' / ' + fold().title);

  click(w, fold());
  ok('pressing it leaves the icons alone', doc.body.dataset.nav === 'off');
  ok('  the chevron turns around', fold().textContent === '»', fold().title);
  ok('  the labels are hidden by the stylesheet, not thrown away',
     !!doc.querySelector('.tab .lab') &&
     /body\[data-nav="off"\] \.tab \.lab \{ display: none/.test(read('app.css')));
  ok('  and the choice is remembered', JSON.parse(store[LIST_KEY]).nav === false,
     store[LIST_KEY]);

  click(w, fold());
  ok('pressing it again brings the names back', doc.body.dataset.nav === 'on' &&
     JSON.parse(store[LIST_KEY]).nav === true);

  /* --- what a later visit does ------------------------------------------- */
  click(w, fold());
  const b = mk(store, 1440);
  await wait(900);
  ok('a later visit opens it the way it was left',
     b.doc.body.dataset.nav === 'off', b.doc.body.dataset.nav);

  const narrow = mk({}, 900);
  await wait(900);
  ok('a window with less room to spare starts on the icons alone',
     narrow.doc.body.dataset.nav === 'off', narrow.doc.body.dataset.nav);

  /* --- the room it takes ------------------------------------------------- */
  const css = read('app.css');
  ok('shut, the rail costs 46 pixels', /:root \{[^}]*--nav-w: 46px/.test(css));
  ok('  open, it is wide enough for the names',
     /body\[data-nav="on"\] \{ --nav-w: 176px/.test(css));
  ok('the workspace gives it a track of its own',
     /\.work \{[^}]*grid-template-columns: var\(--nav-w\) var\(--rail-w\)/.test(css));
  ok('on a phone it lies back down as a strip, names and all',
     /\.nav \{\s*\n?\s*flex-direction: row/.test(css) &&
     /body\[data-nav="off"\] \.tab \.lab, \.nav \.tab \.lab \{ display: inline/.test(css));
  ok('  and the chevron goes away there, where nothing hovers',
     /\.nav-fold \{ display: none; \}/.test(css));
  ok('  while a passage being read takes the whole phone, strip and all',
     /body\[data-view="detail"\] \.nav \{ display: none/.test(css));

  done(a.errs.concat(b.errs, narrow.errs));
})();
