/* Looking a second word up on a phone.

   Under 760px there is one column, so the open word covers the list: the
   stylesheet hides .list while data-view is "detail". A search typed there
   used to rank its matches onto a pane nobody could see — the box took the
   letters and the screen never changed. The first letter now hands the screen
   back to the list. On a window wide enough to hold both, nothing moves: the
   list is already there beside the word. */
const { read, boot, ok, done, wait, click, type } = require('./helpers');

const shell = read('docs/index.html');
const phone = width => boot({
  html: shell, full: true, width: width,
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

const view = g => g.doc.body.dataset.view;
const firstHit = g => (g.doc.querySelector('.hit .hw') || {}).textContent;
const headword = g => (g.doc.querySelector('.headword') || {}).textContent;

async function open(g, word) {
  type(g.window, g.doc.getElementById('q'), word);
  await wait(30);
  click(g.window, g.doc.querySelector('.hit'));
  await wait(30);
}

(async () => {
  /* --- the phone ---------------------------------------------------------- */
  const g = phone(420);
  await wait(900);
  await open(g, 'abate');
  ok('a word opens over the list', view(g) === 'detail' && headword(g) === 'abate',
     view(g) + ' / ' + headword(g));

  type(g.window, g.doc.getElementById('q'), 'zenith');
  await wait(30);
  ok('typing another word brings the list back to be read',
     view(g) === 'list', view(g));
  ok('  with the matches for what was typed at the top of it',
     firstHit(g) === 'zenith', firstHit(g));
  ok('  and the word that was open still open behind it',
     headword(g) === 'abate', headword(g));

  click(g.window, g.doc.querySelector('.hit'));
  await wait(30);
  ok('picking one of them opens it, as it does from the list',
     view(g) === 'detail' && headword(g) === 'zenith',
     view(g) + ' / ' + headword(g));

  /* Emptying the box is not a search for anything, so it leaves the screen
     alone — Back is what closes a word. */
  type(g.window, g.doc.getElementById('q'), '');
  await wait(30);
  ok('clearing the box does not throw the open word away',
     view(g) === 'detail', view(g));

  /* --- the desktop -------------------------------------------------------- */
  const wide = phone(1400);
  await wait(900);
  await open(wide, 'abate');
  type(wide.window, wide.doc.getElementById('q'), 'zenith');
  await wait(30);
  ok('on a wide window the list is already beside the word, so nothing moves',
     view(wide) === 'detail' && firstHit(wide) === 'zenith',
     view(wide) + ' / ' + firstHit(wide));

  const css = read('app.css');
  ok('which is the reason: under 760px the list is hidden by the open word',
     /@media \(max-width: 760px\)[\s\S]*body\[data-view="detail"\] \.list/.test(css));

  done(g.errs.concat(wide.errs));
})();
