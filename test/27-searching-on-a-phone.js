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

  /* Which is also why the passages keep their box in the bar on a phone. On a
     wide window it moves into the list it filters, but a box inside a hidden
     list cannot be typed into, and typing is what brings the list back. */
  const box = g2 => g2.doc.getElementById('search');
  click(g.window, g.doc.getElementById('tab-passages'));
  await wait(40);
  ok('on a phone the passages keep the box in the bar, where it can be reached',
     box(g).parentNode.classList.contains('top') &&
     !box(g).classList.contains('in-list'),
     box(g).parentNode.className);

  click(g.window, g.doc.querySelector('.hit'));
  await wait(40);
  type(g.window, g.doc.getElementById('q'), 'the');
  await wait(40);
  ok('  so a passage opened over the list can still be searched past',
     view(g) === 'list' && g.doc.querySelectorAll('.hit').length > 0,
     view(g) + ', ' + g.doc.querySelectorAll('.hit').length + ' rows');

  click(wide.window, wide.doc.getElementById('tab-passages'));
  await wait(40);
  ok('  while a wide window puts it at the top of that list instead',
     box(wide).parentNode.classList.contains('list') &&
     box(wide).classList.contains('in-list'),
     box(wide).parentNode.className);

  /* --- and with the keyboard up ------------------------------------------

     A phone is 640 points tall and the keyboard takes 300 of them, with
     another 45 for the suggestions above it. The furniture over the list — the
     name of the page and its buttons, the A-to-Z strip, the two rows of
     filters — was taking nearly all of what was left, and the reader typing a
     word was shown one row of the answer.

     Hung on the keyboard rather than on the box having focus, because a tap on
     a row blurs the box first: furniture coming back at that moment would
     slide the row out from under the thumb. */
  const k = boot({
    html: shell, full: true, width: 390, height: 640, visual: 640,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    dataFile: 'docs/data.json',
  });
  await wait(900);
  const keys = () => k.doc.body.dataset.keys;
  const keyboard = h => {
    k.window.visualViewport.height = h;
    k.window.visualViewport.dispatchEvent(new k.window.Event('resize'));
  };

  ok('with no keyboard up the phone shows everything it always did',
     keys() === undefined, String(keys()));

  keyboard(295);                     // 640 less a keyboard and its suggestions
  ok('the keyboard coming up is noticed, without being asked about',
     keys() === 'up', String(keys()));

  keyboard(640);
  ok('  and putting it away gives the furniture back',
     keys() === undefined, String(keys()));

  /* A wide window has the room, so nothing is taken off it — a laptop with an
     on-screen keyboard is still a laptop. */
  const kw = boot({
    html: shell, full: true, width: 1400, height: 900, visual: 900,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    dataFile: 'docs/data.json',
  });
  await wait(900);
  kw.window.visualViewport.height = 420;
  kw.window.visualViewport.dispatchEvent(new kw.window.Event('resize'));
  ok('on a window wide enough to have the room, nothing is folded away',
     kw.doc.body.dataset.keys === undefined, String(kw.doc.body.dataset.keys));

  ok('what goes is what is not the answer, and the box and the tabs are not it',
     /body\[data-keys="up"\] \.brand,[\s\S]{0,200}\.chips \{ display: none; \}/.test(css)
     && !/body\[data-keys="up"\][\s\S]{0,200}\.search \{ display: none/.test(css)
     && !/body\[data-keys="up"\][\s\S]{0,200}\.nav \{ display: none/.test(css),
     'brand, acts, alpha and chips');
  ok('  and it is the phone rule that says so, not every screen',
     css.indexOf('body[data-keys="up"]')
       > css.indexOf('@media (max-width: 760px)'),
     'inside the phone rule');

  done(g.errs.concat(wide.errs, k.errs, kw.errs));
})();
