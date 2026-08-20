/* Putting a book on the site, from the page.

   Add a book keeps the book in the browser it was added in, which is the right
   default and the wrong one for a shelf you want on the phone as well as on the
   laptop. The tick beside the button writes the same two files that
   import_books.py --publish writes — the book and the shelf — into docs/books/
   over the GitHub API, and every device reads them from there.

   The fake repo below is the contents API and nothing more: read a path, write
   a path, refuse a bad token, refuse a stale sha. */
const { read, boot, ok, done, wait, click, btn, unlockedStore } = require('./helpers');

const shell = read('docs/index.html');
const API = 'https://api.github.com/repos/nhutrang0209/EngrowDict/contents/';

const BOOK = {
  slug: 'a-test-book',
  title: 'A Test Book',
  author: 'Nobody',
  chapters: [
    { n: 1, title: 'THE BOY WHO LIVED',
      paras: ['Mr. and Mrs. Dursley, of number four, Privet Drive.',
              'They were perfectly normal, thank you very much.'] },
    { n: 2, title: 'THE VANISHING GLASS', paras: ['Nearly ten years had passed.'] },
  ],
};

const reply = (status, body) => Promise.resolve({
  ok: status < 300, status, json: () => Promise.resolve(body),
});

function fakeRepo(files) {
  const kept = {};
  Object.keys(files || {}).forEach(function (k) {
    kept[k] = { text: files[k], sha: 'sha-' + k };
  });
  const log = [];
  let n = 0;
  return {
    kept, log,
    text: p => kept[p] && kept[p].text,
    fetch(url, init) {
      const path = String(url).slice(API.length);
      const method = (init && init.method) || 'GET';
      const auth = init && init.headers && init.headers.Authorization;
      log.push({ method, path, auth });
      if (auth !== 'Bearer github_pat_test') return reply(401, { message: 'Bad credentials' });
      if (method === 'GET') {
        const f = kept[path];
        return f
          ? reply(200, { sha: f.sha, content: Buffer.from(f.text, 'utf8').toString('base64') })
          : reply(404, { message: 'Not Found' });
      }
      const body = JSON.parse(init.body);
      if (kept[path] && kept[path].sha !== body.sha) return reply(409, { message: 'stale sha' });
      kept[path] = {
        text: Buffer.from(body.content, 'base64').toString('utf8'),
        sha: 'sha-' + (++n),
      };
      log[log.length - 1].message = body.message;
      return reply(200, { content: { path: path } });
    },
  };
}

/* No shelf online and no sheet: only the GitHub side is under test here. */
function stubs(repo) {
  return function (url, init) {
    const u = String(url);
    if (u.startsWith('https://api.github.com/')) return repo.fetch(u, init);
    if (u.includes('books/')) return reply(404, null);
    return reply(200, JSON.parse(read('docs/data.json')));
  };
}

/* jsdom will not let a file input be filled, and the page only wants the name
   of what was picked — bookify.js is stubbed in boot(). */
function pickFile(g, name) {
  const pick = g.doc.getElementById('book-file');
  Object.defineProperty(pick, 'files', { value: [{ name: name }], configurable: true });
  pick.dispatchEvent(new g.window.Event('change'));
}

const msg = g => g.doc.getElementById('book-msg').textContent;

function shelfPage(repo, book, extra) {
  const g = boot({
    html: shell, full: true, idb: true,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    store: unlockedStore(extra || { ghToken: 'github_pat_test' }),
    fetchStub: stubs(repo), bookify: () => book,
  });
  return g;
}

(async () => {
  /* --- the tick is there only when it can do something --------------------- */
  const noToken = shelfPage(fakeRepo(), BOOK, {});
  await wait(900);
  click(noToken.window, noToken.doc.getElementById('tab-books'));
  await wait(40);
  ok('with no token the button adds to this device and says nothing of a site',
     !noToken.doc.getElementById('shelf-add').hidden &&
     noToken.doc.getElementById('book-pub-row').hidden);

  const locked = boot({
    html: shell, full: true, idb: true,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: stubs(fakeRepo()), bookify: () => BOOK,
  });
  await wait(900);
  click(locked.window, locked.doc.getElementById('tab-books'));
  await wait(40);
  ok('  and a page nobody has unlocked cannot write to the site either',
     locked.doc.getElementById('book-pub-row').hidden);

  /* --- the first book on the shelf ---------------------------------------- */
  const repo = fakeRepo();
  const g = shelfPage(repo, BOOK);
  await wait(900);
  click(g.window, g.doc.getElementById('tab-books'));
  await wait(40);

  const tick = g.doc.getElementById('book-pub');
  ok('a token puts the tick beside the button',
     !g.doc.getElementById('book-pub-row').hidden &&
     g.doc.getElementById('book-pub-row').textContent.includes('site'),
     g.doc.getElementById('book-pub-row').textContent);
  ok('  and it is off until it is asked for', tick.checked === false);

  tick.checked = true;
  pickFile(g, 'a-test-book.epub');
  await wait(400);

  ok('the book is committed to docs/books/',
     !!repo.text('docs/books/a-test-book.json'),
     Object.keys(repo.kept).join(', '));
  ok('  whole, chapters and paragraphs and all',
     repo.text('docs/books/a-test-book.json') === JSON.stringify(BOOK));

  const first = JSON.parse(repo.text('docs/books/index.json') || 'null');
  ok('the shelf beside it names the book',
     Array.isArray(first) && first.length === 1 &&
     first[0].title === 'A Test Book' && first[0].author === 'Nobody',
     JSON.stringify(first).slice(0, 90));
  ok('  with the chapters counted, not carried',
     first[0].chapters.length === 2 && first[0].chapters[0].words === 17 &&
     !('paras' in first[0].chapters[0]),
     JSON.stringify(first[0].chapters[0]));
  ok('  and nothing on it to say it belongs to one device',
     !('mine' in first[0]), Object.keys(first[0]).join(', '));

  const writes = repo.log.filter(c => c.method === 'PUT');
  ok('the book goes up before the shelf that points at it',
     writes.map(c => c.path).join(' -> ') ===
     'docs/books/a-test-book.json -> docs/books/index.json',
     writes.map(c => c.path).join(' -> '));
  ok('  under a commit message naming the book',
     writes.every(c => c.message.includes('A Test Book')),
     writes.map(c => c.message).join(' / '));
  ok('  with the token kept in this browser and nothing else',
     repo.log.every(c => c.auth === 'Bearer github_pat_test'));

  ok('the page says the book is on the site', /on the site/.test(msg(g)), msg(g));
  ok('  and the tick clears, so the next book is a decision again',
     tick.checked === false);
  ok('the book is on this device too, readable before Pages has published it',
     g.doc.querySelector('.hit.passage .hw')?.textContent === 'A Test Book',
     g.doc.querySelector('.hit.passage .hw')?.textContent);

  /* --- more books, on a shelf that is already there ----------------------- */
  const g2 = shelfPage(repo, Object.assign({}, BOOK, { slug: 'zebra', title: 'Zebra' }));
  await wait(900);
  click(g2.window, g2.doc.getElementById('tab-books'));
  await wait(40);
  g2.doc.getElementById('book-pub').checked = true;
  pickFile(g2, 'zebra.epub');
  await wait(400);
  let list = JSON.parse(repo.text('docs/books/index.json'));
  ok('a second book joins the shelf rather than replacing it',
     list.length === 2, list.map(b => b.slug).join(','));

  const g3 = shelfPage(repo, Object.assign({}, BOOK, { slug: 'apples', title: 'Apples' }));
  await wait(900);
  click(g3.window, g3.doc.getElementById('tab-books'));
  await wait(40);
  g3.doc.getElementById('book-pub').checked = true;
  pickFile(g3, 'apples.epub');
  await wait(400);
  list = JSON.parse(repo.text('docs/books/index.json'));
  ok('  and the shelf keeps the order import_books.py writes it in',
     list.map(b => b.slug).join(',') === 'a-test-book,apples,zebra',
     list.map(b => b.slug).join(','));

  const g4 = shelfPage(repo, Object.assign({}, BOOK, { author: 'Someone Else' }));
  await wait(900);
  click(g4.window, g4.doc.getElementById('tab-books'));
  await wait(40);
  g4.doc.getElementById('book-pub').checked = true;
  pickFile(g4, 'a-test-book.epub');
  await wait(400);
  list = JSON.parse(repo.text('docs/books/index.json'));
  ok('the same book sent twice is one entry, the second one standing',
     list.length === 3 &&
     list.filter(b => b.slug === 'a-test-book')[0].author === 'Someone Else',
     list.map(b => b.slug + ':' + b.author).join(', '));

  /* --- a token that is refused -------------------------------------------- */
  const bad = fakeRepo();
  const g5 = shelfPage(bad, BOOK, { ghToken: 'github_pat_wrong' });
  await wait(900);
  click(g5.window, g5.doc.getElementById('tab-books'));
  await wait(40);
  g5.doc.getElementById('book-pub').checked = true;
  pickFile(g5, 'a-test-book.epub');
  await wait(400);
  ok('a refused token says so, and says what the token needs',
     /token was refused/.test(msg(g5)) && /Contents: write/.test(msg(g5)), msg(g5));
  ok('  the book is still on the device it was added on',
     g5.doc.querySelector('.hit.passage .hw')?.textContent === 'A Test Book');
  ok('  and nothing was written to the repo', !Object.keys(bad.kept).length,
     Object.keys(bad.kept).join(', '));

  /* --- and none of it happens without the tick ---------------------------- */
  const quiet = fakeRepo();
  const g6 = shelfPage(quiet, BOOK);
  await wait(900);
  click(g6.window, g6.doc.getElementById('tab-books'));
  await wait(40);
  pickFile(g6, 'a-test-book.epub');
  await wait(400);
  ok('a book added with the tick clear reaches GitHub not at all',
     quiet.log.length === 0 && !/on the site/.test(msg(g6)), msg(g6));

  /* --- setting the token up in the first place ---------------------------- */
  const fresh = fakeRepo();
  const g8 = shelfPage(fresh, BOOK, {});
  await wait(900);
  click(g8.window, g8.doc.getElementById('tab-books'));
  await wait(40);
  click(g8.window, g8.doc.getElementById('settings-btn'));
  const tokenRow = g8.doc.getElementById('row-ghtoken');
  ok('Settings has a place for the token, and says which repo it will write to',
     !!tokenRow && g8.doc.getElementById('row-repo')
       .querySelector('input').placeholder === 'nhutrang0209/EngrowDict',
     g8.doc.getElementById('row-repo').querySelector('input').placeholder);

  click(g8.window, tokenRow.querySelector('.edit-btn'));
  tokenRow.querySelector('input').value = 'github_pat_test';
  click(g8.window, btn(g8.doc, '#set-dlg .dlg-foot .btn', 'Save'));
  await wait(60);
  ok('  the token is shown masked, like the sheet key',
     g8.doc.getElementById('val-ghtoken').textContent.startsWith('git') &&
     g8.doc.getElementById('val-ghtoken').textContent.includes('•') &&
     !g8.doc.getElementById('val-ghtoken').textContent.includes('test'),
     g8.doc.getElementById('val-ghtoken').textContent);
  ok('  and the tick is on the shelf without reloading anything',
     !g8.doc.getElementById('book-pub-row').hidden);

  g8.doc.getElementById('book-pub').checked = true;
  pickFile(g8, 'a-test-book.epub');
  await wait(400);
  ok('  a book picked straight afterwards goes up',
     !!fresh.text('docs/books/index.json'), msg(g8));

  /* --- where there is no repo behind the address -------------------------- */
  const off = fakeRepo();
  const g7 = boot({
    html: shell, full: true, idb: true, url: 'https://example.com/dict/',
    store: unlockedStore({ ghToken: 'github_pat_test' }),
    fetchStub: stubs(off), bookify: () => BOOK,
  });
  await wait(900);
  click(g7.window, g7.doc.getElementById('tab-books'));
  await wait(40);
  ok('off GitHub Pages the tick waits for the repo to be named in Settings',
     g7.doc.getElementById('book-pub-row').hidden);

  done(g.errs);
})();
