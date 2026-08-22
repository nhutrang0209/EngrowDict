/* Putting the passages in the order they should be read in.

   The order is the sheet's, and the sheet's order is the order they happened
   to be pasted in. Two buttons at the end of the line that counts them: one
   turns the list into something that can be pushed about, the other sends the
   order to the sheet. Only for somebody who has unlocked the page — everyone
   else is reading, not editing.

   Arrows on the rows rather than a drag: the list is virtual and only draws
   the rows it can see. */
const { read, boot, ok, done, wait, click, unlockedStore } = require('./helpers');

const shell = read('docs/index.html');
const CFG = {
  sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC/edit',
  webApp: 'https://script.google.com/macros/s/XYZ/exec',
  key: 'test-key',
};

function page(store, posts, reply) {
  const g = boot({
    html: shell, full: true, store: store,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    dataFile: 'docs/data.json',
  });
  const real = g.window.fetch;
  g.window.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') {
      posts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply()) });
    }
    return real(url, opts);
  };
  return g;
}

const titles = g => [...g.doc.querySelectorAll('.hit.passage .col .hw')]
  .map(n => n.textContent);
const arrows = (g, row) => g.doc.querySelectorAll('.hit.passage')[row]
  .querySelectorAll('.ord');

(async () => {
  const posts = [];
  const g = page(unlockedStore(CFG), posts, () => ({ ok: true, passages: 33 }));
  await wait(900);
  const { doc, window: w } = g;
  click(w, doc.getElementById('tab-passages'));
  await wait(60);

  const first = titles(g).slice(0, 3);
  ok('the passages are listed in the order the sheet keeps them',
     first.length === 3, first.join(' | '));
  ok('the line that counts them offers to reorder them',
     !!doc.getElementById('order-passages') &&
     doc.getElementById('order-passages').getAttribute('aria-pressed') === 'false',
     doc.getElementById('count').textContent);
  ok('  with an icon and no words, and nothing to send yet',
     doc.getElementById('order-passages').textContent.trim() === '' &&
     !!doc.querySelector('#order-passages svg') &&
     !doc.getElementById('order-save'),
     doc.getElementById('order-passages').outerHTML.slice(0, 60));
  ok('  and no arrows on the rows until it is pressed',
     doc.querySelectorAll('.hit.passage .ord').length === 0);

  click(w, doc.getElementById('order-passages'));
  await wait(60);
  ok('pressed, every row grows a pair of arrows',
     doc.querySelectorAll('.hit.passage').length > 0 &&
     arrows(g, 0).length === 2 &&
     doc.getElementById('order-passages').getAttribute('aria-pressed') === 'true',
     arrows(g, 0).length + ' arrows on the first row');
  ok('  and the second button appears, to send the order',
     !!doc.getElementById('order-save') &&
     doc.getElementById('order-save').textContent.trim() === '' &&
     !!doc.querySelector('#order-save svg'));

  click(w, arrows(g, 1)[0]);                 // the second passage, upwards
  await wait(60);
  ok('an arrow moves a passage past the one above it',
     titles(g)[0] === first[1] && titles(g)[1] === first[0],
     titles(g).slice(0, 3).join(' | '));
  ok('  and they are renumbered where they land',
     [...doc.querySelectorAll('.hit.passage .idx')].slice(0, 3)
       .map(n => n.textContent).join(',') === '1,2,3',
     [...doc.querySelectorAll('.hit.passage .idx')].slice(0, 3)
       .map(n => n.textContent).join(','));
  ok('  the sheet is not written to on the way',
     posts.length === 0, JSON.stringify(posts));
  ok('  and the button says there is something to send',
     doc.getElementById('order-save').classList.contains('wants'));

  click(w, doc.getElementById('order-save'));
  await wait(200);
  ok('the second button sends the order, and nothing else',
     posts.length === 1 && posts[0].action === 'orderpassages' &&
     posts[0].titles[0] === first[1] && posts[0].titles[1] === first[0],
     JSON.stringify(posts[0] && posts[0].titles.slice(0, 2)));
  ok('  and says so once the sheet has it',
     /passages put in that order/.test(doc.getElementById('toast').textContent) &&
     doc.getElementById('toast').className === 'toast good',
     doc.getElementById('toast').textContent);
  ok('  with nothing left to send', !doc.getElementById('order-save').classList.contains('wants'));

  click(w, doc.getElementById('order-passages'));
  await wait(60);
  ok('pressing it again puts the arrows away',
     doc.querySelectorAll('.hit.passage .ord').length === 0 &&
     !doc.getElementById('order-save'));

  /* --- and it is not for whoever is only reading -------------------------- */
  const locked = page({}, [], () => ({ ok: true }));
  await wait(900);
  click(locked.window, locked.doc.getElementById('tab-passages'));
  await wait(60);
  ok('a page nobody has unlocked is offered neither button',
     !locked.doc.getElementById('order-passages') &&
     !locked.doc.getElementById('order-save'),
     locked.doc.getElementById('count').textContent);

  /* --- the dictionary has an order of its own ----------------------------- */
  click(w, doc.getElementById('tab-dictionary'));
  await wait(60);
  ok('the dictionary, which is alphabetical, is offered neither either',
     !doc.getElementById('order-passages'));

  done(g.errs.concat(locked.errs));
})();
