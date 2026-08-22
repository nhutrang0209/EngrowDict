/* The Sync button beside ⚙: pull the sheet in without opening it.

   Two paths. When the script can push to GitHub it republishes data.json and
   the page reloads that; when it cannot, the entries come back inline and last
   only for the visit. Both are checked here, plus the duplicate that would
   otherwise appear once a word of mine comes back as an ordinary entry. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, boot, ok, done, wait, click, addWord, unlockedStore, BACKUP_KEY,
        appsScriptSandbox } = require('./helpers');

const shell = read('docs/index.html');
const CFG = {
  sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC/edit',
  webApp: 'https://script.google.com/macros/s/XYZ/exec',
  key: 'a-secret-key',
};
const REAL = JSON.parse(read('docs/data.json'));
// the published copy grows every time the sheet is synced, so the counts on
// screen are read off it rather than written down here
const NOW = REAL.entries.length.toLocaleString('en-US');
const PLUS1 = (REAL.entries.length + 1).toLocaleString('en-US');

/** A page whose POSTs are answered by `reply`, and whose data.json fetches
 *  return whatever `dataNow()` currently says. */
function page(store, posts, reply, dataNow) {
  return boot({
    html: shell, full: true, store,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: (url, opts) => {
      if (opts && opts.method === 'POST') {
        posts.push({ url, body: JSON.parse(opts.body) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve(reply()) });
      }
      return Promise.resolve({ ok: true, status: 200, url, json: () => Promise.resolve(dataNow()) });
    },
  });
}

(async () => {
  /* --- hidden until the sync link is configured ------------------------ */
  const bare = page(unlockedStore(), [], () => ({ ok: true }), () => REAL);
  await wait(900);
  ok('no Sync button before the link is set', bare.doc.getElementById('sync-sheet').hidden);

  /* --- the published path ---------------------------------------------- */
  // the sheet gains one word that the site does not have yet
  const grown = {
    entries: REAL.entries.concat([{
      id: 'sNEW', type: 'word', word: 'zugzwang', pos: 'n', ipa: '/ˈtsuːktsvaŋ/', note: '',
      senses: [{ def: 'a position in which any move worsens things', eg: [], vi: 'thế bí' }],
    }]),
    readings: [],
  };
  let served = REAL;
  const posts = [];
  const a = page(unlockedStore(CFG), posts,
    () => ({ ok: true, published: true, entries: grown.entries.length, error: null, data: null }),
    () => served);
  await wait(900);

  ok('the Sync button sits next to Settings', (() => {
    const acts = [...a.doc.querySelectorAll('.acts > *')].map(n => n.id || n.textContent.trim());
    return acts.indexOf('sync-sheet') === acts.indexOf('settings-btn') - 1;
  })(), [...a.doc.querySelectorAll('.acts > *')].map(n => n.id || n.textContent.trim()).join(' | '));
  ok('it shows once the link is set', !a.doc.getElementById('sync-sheet').hidden);
  ok('  and says what it is with two arrows rather than with three words',
     !!a.doc.querySelector('#sync-sheet svg') &&
     a.doc.getElementById('sync-sheet').textContent.trim() === '' &&
     a.doc.getElementById('sync-sheet').getAttribute('aria-label') === 'Sync from sheet',
     a.doc.getElementById('sync-sheet').getAttribute('aria-label'));
  ok('the site starts on the old data',
     a.doc.getElementById('count').textContent.includes(NOW),
     a.doc.getElementById('count').textContent);

  served = grown;                                  // GitHub now serves the new file
  click(a.window, a.doc.getElementById('sync-sheet'));
  await wait(400);

  ok('Sync asks the script to sync', posts.length === 1 && posts[0].body.action === 'sync',
     JSON.stringify(posts[0] && posts[0].body).slice(0, 60));
  ok('the request carries the key', posts[0].body.key === CFG.key);
  ok('the page picks up the republished data',
     a.doc.getElementById('count').textContent.includes(PLUS1),
     a.doc.getElementById('count').textContent);
  const q = a.doc.getElementById('q');
  q.value = 'zugzwang';
  q.dispatchEvent(new a.window.Event('input'));
  await wait(30);
  ok('the word added in the sheet is now searchable',
     a.doc.querySelector('.hit .hw')?.textContent === 'zugzwang',
     a.doc.querySelector('.hit .hw')?.textContent + ' — ' + a.doc.querySelector('.hit .gloss')?.textContent);
  ok('the banner is cleared afterwards', a.doc.getElementById('banner').hidden);

  /* --- a passage rewritten, and not one word added --------------------- */
  /* The count cannot tell that file from the one before it, so what is
     published carries a stamp and the page waits for that stamp to arrive. */
  const SAME = JSON.parse(JSON.stringify(REAL));
  const EDITED = JSON.parse(JSON.stringify(REAL));
  EDITED.at = '2026-08-22T09:00:00.000Z';
  EDITED.readings[0] = Object.assign({}, EDITED.readings[0], { title: 'Pine Trees, put right' });
  let servedEdit = SAME;
  const postsEdit = [];
  const edit = page(unlockedStore(CFG), postsEdit,
    () => ({ ok: true, published: true, entries: REAL.entries.length,
             at: EDITED.at, error: null, data: null }),
    () => servedEdit);
  await wait(900);
  click(edit.window, edit.doc.getElementById('sync-sheet'));
  await wait(400);
  ok('a file with the same number of entries is not taken for the new one',
     /Waiting for GitHub/.test(edit.doc.getElementById('banner').textContent),
     edit.doc.getElementById('banner').textContent);

  servedEdit = EDITED;
  await wait(1800);
  click(edit.window, edit.doc.getElementById('tab-passages'));
  await wait(60);
  ok('  the rewritten passage arrives once the stamp does',
     /Pine Trees, put right/.test(edit.doc.querySelector('.hit .hw').textContent),
     edit.doc.querySelector('.hit .hw').textContent);

  /* --- the copy GitHub is still catching up with ----------------------- */
  /* Pages serves a commit thirty to sixty seconds after it lands, so the fetch
     straight after a sync is very often the file that was already there. It
     answers 200 and nothing looks wrong — the dictionary simply does not
     change, which is why syncing twice used to be the way to sync. */
  let slow = REAL;
  const postsSlow = [];
  const late = page(unlockedStore(CFG), postsSlow,
    () => ({ ok: true, published: true, entries: grown.entries.length, error: null, data: null }),
    () => slow);
  await wait(900);
  click(late.window, late.doc.getElementById('sync-sheet'));
  await wait(400);
  ok('a site still serving the old copy is not taken for the new one',
     late.doc.getElementById('count').textContent.includes(NOW) &&
     /Waiting for GitHub/.test(late.doc.getElementById('banner').textContent),
     late.doc.getElementById('banner').textContent);

  slow = grown;                                    // Pages catches up
  await wait(1800);
  ok('  and when it catches up the dictionary follows, on the one press',
     late.doc.getElementById('count').textContent.includes(PLUS1) &&
     postsSlow.length === 1,
     late.doc.getElementById('count').textContent + ' after ' + postsSlow.length + ' sync');
  ok('  the banner clears itself', late.doc.getElementById('banner').hidden);

  /* --- no duplicate once my word comes back from the sheet ------------- */
  let served2 = REAL;
  const posts2 = [];
  const b = page(unlockedStore(CFG), posts2,
    () => ({ ok: true, published: true, entries: served2.entries.length, error: null, data: null }),
    () => served2);
  await wait(900);

  addWord(b, { word: 'zugzwang', pos: 'n', def: 'a position where any move worsens things', vi: 'thế bí' });
  await wait(250);
  ok('my word is stored locally and marked as in the sheet',
     JSON.parse(b.store[BACKUP_KEY])[0].inSheet === true,
     b.doc.getElementById('count').textContent);

  served2 = grown;                                 // the sheet now carries it too
  click(b.window, b.doc.getElementById('sync-sheet'));
  await wait(400);
  ok('after syncing it appears exactly once',
     b.doc.getElementById('count').textContent.includes(PLUS1),
     b.doc.getElementById('count').textContent);
  ok('  and is dropped from the local list', JSON.parse(b.store[BACKUP_KEY]).length === 0,
     b.store[BACKUP_KEY]);

  /* --- the fallback path: nothing to push to --------------------------- */
  const posts3 = [];
  const c = page(unlockedStore(CFG), posts3, () => ({
    ok: true, published: false, entries: grown.entries.length,
    error: 'No GitHub repo set up yet — use EngrowDict → Set up GitHub repo.',
    data: grown,
  }), () => REAL);
  await wait(900);
  click(c.window, c.doc.getElementById('sync-sheet'));
  await wait(300);
  ok('with no repo set up the entries still arrive',
     c.doc.getElementById('count').textContent.includes(PLUS1),
     c.doc.getElementById('count').textContent);
  ok('  and the page says it only lasts this visit',
     c.doc.getElementById('banner').textContent.includes('this visit only'),
     c.doc.getElementById('banner').textContent.slice(0, 90));
  ok('  and passes on why', c.doc.getElementById('banner').textContent.includes('Set up GitHub repo'));

  /* --- the script side: sync uses the same reader as the menu ---------- */
  const grids = JSON.parse(fs.readFileSync(path.join(__dirname, 'grids.json'), 'utf8'));
  const sandbox = appsScriptSandbox(grids, { SOTRATU_KEY: CFG.key });   // no repo, no token
  vm.createContext(sandbox);
  vm.runInContext(read('sheet-sync.gs') + '\nthis.__doPost = doPost;', sandbox);

  const res = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({ key: CFG.key, action: 'sync' }) },
  }));

  ok('doPost handles the sync action', res.ok === true);
  ok('  reports it could not publish, and why',
     res.published === false && /GitHub repo/.test(res.error), res.error);
  ok('  returns the whole sheet inline instead',
     !!res.data && res.data.entries.length === 11401,
     res.data ? res.data.entries.length + ' entries' : 'nothing');
  ok('  with the reading passages in it', res.data.readings.length === 33,
     res.data.readings.length + ' passages');
  ok('  read by the same code as the menu item',
     res.data.entries[0].word === JSON.parse(read('dataset.json')).entries[0].word,
     res.data.entries[0].word);
  /* A sync is about the words. A sheet with no passages in it has none to
     publish, and none to take off the site either. */
  const noPassages = Object.assign({}, grids);
  delete noPassages['Reading Passage'];
  const bareSheet = appsScriptSandbox(noPassages,
    { SOTRATU_KEY: CFG.key, SOTRATU_REPO: 'someone/EngrowDict', SOTRATU_TOKEN: 'ghp_x' });
  vm.createContext(bareSheet);
  vm.runInContext(read('sheet-sync.gs') + '\nthis.__publish = publishToRepo;', bareSheet);
  bareSheet.net.reply = url => /raw.githubusercontent.com/.test(url)
    ? { code: 200, body: JSON.stringify({ entries: [], readings: [{ index: '1', title: 'Kept' }] }) }
    : { code: 200, body: JSON.stringify({ content: { sha: 'abc' } }) };
  const bareRes = bareSheet.__publish();
  const sent = bareSheet.net.payloads[bareSheet.net.payloads.length - 1];
  ok('a sheet with no passages keeps the ones already on the site',
     bareRes.ok === true &&
     JSON.parse(Buffer.from(sent.content, 'base64').toString('utf8'))
       .readings[0].title === 'Kept',
     JSON.stringify(sent && Object.keys(sent)));

  ok('a wrong key still gets nothing',
     JSON.parse(sandbox.__doPost({
       postData: { contents: JSON.stringify({ key: 'nope', action: 'sync' }) },
     })).ok === false);

  done(a.errs.concat(b.errs, c.errs, bare.errs));
})();
