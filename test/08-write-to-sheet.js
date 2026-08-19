/* The web -> sheet path, checked from both ends:

   A. In the browser: Settings holds the link, adding a word posts the right
      body, and nothing is sent while the passcode is still locked.
   B. In Apps Script: doPost inserts rows into the right tab in alphabetical
      order and in the sheet's own format — checked by reading the patched
      sheet back and seeing the new word come out whole.

   Google itself is never touched: SpreadsheetApp and fetch are both stand-ins.
   Deploying the Web App, and CORS, can only be checked on the real thing. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, boot, ok, done, wait, click, btn, addWord,
        unlockedStore, BACKUP_KEY, appsScriptSandbox } = require('./helpers');

const shell = read('docs/index.html');
const CFG = {
  sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC/edit',
  webApp: 'https://script.google.com/macros/s/XYZ/exec',
  key: 'a-secret-key',
};

function page(store, posts, reply) {
  const g = boot({
    html: shell, full: true, store,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    dataFile: 'docs/data.json',
  });
  const realFetch = g.window.fetch;
  g.window.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') {
      posts.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply()) });
    }
    return realFetch(url, opts);
  };
  return g;
}

(async () => {
  /* ------------------------------------------------ A. in the browser */
  const posts0 = [];
  const a = page(unlockedStore(), posts0, () => ({ ok: true }));
  await wait(900);
  const { doc, window: w } = a;

  ok('unlocked but unconfigured: no Open sheet button', doc.getElementById('open-sheet').hidden);
  ok('unlocked but unconfigured: no Write to sheet button', doc.getElementById('push-sheet').hidden);
  click(w, doc.getElementById('add-word'));
  ok('the add form hides the write-to-sheet tick', doc.getElementById('to-sheet-row').hidden);
  doc.getElementById('form-dlg').close();

  // fill in Settings through the Edit buttons
  const setDlg = doc.getElementById('set-dlg');
  click(w, doc.getElementById('settings-btn'));
  for (const [id, value] of [['sheet', CFG.sheetUrl], ['webapp', CFG.webApp], ['key', CFG.key]]) {
    const row = doc.getElementById('row-' + id);
    click(w, row.querySelector('.edit-btn'));
    row.querySelector('input').value = value;
  }
  click(w, btn(doc, '#set-dlg .dlg-foot .btn', 'Test connection'));
  await wait(60);
  ok('Test connection sends a ping',
     posts0.length === 1 && posts0[0].body.action === 'ping',
     JSON.stringify(posts0[0] && posts0[0].body));
  ok('the ping carries the key', posts0[0].body.key === CFG.key);
  ok('it reports success', doc.getElementById('set-msg').textContent.includes('Connected'),
     doc.getElementById('set-msg').textContent);

  click(w, btn(doc, '#set-dlg .dlg-foot .btn', 'Save'));
  await wait(60);
  setDlg.close();
  ok('the real config is not inside the published files',
     !shell.includes(CFG.key) && !shell.includes('/macros/s/XYZ/') &&
     !read('docs/data.json').includes(CFG.key),
     'only placeholder text in the inputs, no real link or key');
  ok('the Open sheet button appears', !doc.getElementById('open-sheet').hidden &&
     doc.getElementById('open-sheet').href === CFG.sheetUrl);

  click(w, doc.getElementById('add-word'));
  ok('the write-to-sheet tick appears, on by default',
     !doc.getElementById('to-sheet-row').hidden && doc.getElementById('to-sheet').checked);
  doc.getElementById('form-dlg').close();

  addWord(a, {
    word: 'susurrus',
    pos: 'n',
    ipa: '/suːˈsʌr.əs/',
    def: 'a soft murmuring or rustling sound',
    vi: 'tiếng xào xạc',
  });
  await wait(250);

  const add = posts0[posts0.length - 1];
  ok('adding a word posts to the Web App',
     add && add.body.action === 'add' && add.url === CFG.webApp);
  ok('the post carries the word, phonetics and meaning',
     add.body.entry.word === 'susurrus' && add.body.entry.ipa === '/suːˈsʌr.əs/' &&
     add.body.entry.senses[0].vi === 'tiếng xào xạc',
     JSON.stringify(add.body.entry).slice(0, 110));
  ok('no custom headers, so no CORS preflight', !add.headers);
  ok('the entry is badged as being in the sheet', !!doc.querySelector('.kind-sheet'),
     doc.querySelector('.kind-sheet')?.textContent);
  ok('nothing is left waiting', doc.getElementById('push-sheet').hidden);

  // a locked visitor sends nothing at all
  const postsLocked = [];
  const locked = page({ 'engrowdict:settings:v1': JSON.stringify(
    Object.assign({ code: '229922', unlocked: false }, CFG)) }, postsLocked, () => ({ ok: true }));
  await wait(900);
  click(locked.window, locked.doc.getElementById('add-word'));
  ok('a locked visitor cannot even open the add form',
     !locked.doc.getElementById('form-dlg').open && postsLocked.length === 0);
  ok('  and no Write to sheet button is offered',
     locked.doc.getElementById('push-sheet').hidden);

  // the sheet refuses: keep the word and offer a retry
  const posts1 = [];
  const b = page(unlockedStore(CFG), posts1, () => ({ ok: false, error: 'Wrong key' }));
  await wait(900);
  addWord(b, { word: 'thole', vi: 'chịu đựng' });
  await wait(250);
  ok('a refused write still keeps the word locally',
     !!b.store[BACKUP_KEY] && b.store[BACKUP_KEY].includes('thole'));
  ok('the error is spelled out with a retry',
     b.doc.getElementById('banner').textContent.includes('Wrong key'),
     b.doc.getElementById('banner').textContent.slice(0, 74));
  ok('the top bar counts what is still waiting',
     !b.doc.getElementById('push-sheet').hidden &&
     b.doc.getElementById('push-sheet').textContent.includes('1 word'),
     b.doc.getElementById('push-sheet').textContent);

  /* ------------------------------------------------ B. in Apps Script */
  const grids = JSON.parse(fs.readFileSync(path.join(__dirname, 'grids.json'), 'utf8'));

  const props = { SOTRATU_KEY: CFG.key };
  const sandbox = appsScriptSandbox(grids, props);
  vm.createContext(sandbox);
  vm.runInContext(read('sheet-sync.gs') + '\nthis.__doPost = doPost; this.__buildData = buildData;', sandbox);

  const call = payload => JSON.parse(sandbox.__doPost({ postData: { contents: JSON.stringify(payload) } }));

  ok('doPost refuses a wrong key', call({ key: 'nope', action: 'ping' }).ok === false);
  ok('doPost answers a ping with the right key', call({ key: CFG.key, action: 'ping' }).ok === true);

  // Sample words must not already exist, or find() would pick up an old entry.
  const existing = new Set(sandbox.__buildData().entries.map(e => e.word));
  const samples = ['susurrus', 'thole', 'muddle sideways'];
  ok('the sample words are new to the sheet', samples.every(x => !existing.has(x)),
     samples.filter(x => existing.has(x)).join(', ') || 'all three are new');

  const before = sandbox.__buildData().entries.length;
  const res = call({ key: CFG.key, action: 'add', entry: add.body.entry });
  ok('inserted into the Vocabulary tab', res.ok && res.sheet === 'Vocabulary', JSON.stringify(res));

  const after = sandbox.__buildData().entries;
  ok('reading the sheet back shows exactly one more entry', after.length === before + 1,
     before + ' → ' + after.length);
  const got = after.find(e => e.word === 'susurrus');
  ok('the new word comes back whole',
     !!got && got.pos === 'n' && got.ipa === '/suːˈsʌr.əs/' &&
     got.senses[0].vi === 'tiếng xào xạc' &&
     got.senses[0].def === 'a soft murmuring or rustling sound',
     got ? got.word + ' (' + got.pos + ') ' + got.ipa + ' — ' + got.senses[0].vi : 'not found');

  const at = after.indexOf(got);
  ok('it landed in the right alphabetical place',
     after[at - 1].word.toLowerCase() < 'susurrus' && after[at + 1].word.toLowerCase() > 'susurrus',
     after[at - 1].word + '  <  susurrus  <  ' + after[at + 1].word);

  const multi = {
    type: 'word', word: 'thole', pos: 'v', ipa: '/θəʊl/', note: '',
    senses: [
      { def: 'to endure something without complaint', eg: ['she tholed the long winter'],
        vi: 'chịu đựng' },
      { def: 'a pin in the side of a boat that holds an oar', eg: [], vi: 'cọc chèo' },
    ],
  };
  ok('a multi-sense word inserts', call({ key: CFG.key, action: 'add', entry: multi }).ok);
  const q = sandbox.__buildData().entries.find(e => e.word === 'thole');
  ok('both senses and the example survive the round trip',
     !!q && q.senses.length === 2 && q.senses[0].eg[0] === 'she tholed the long winter' &&
     q.senses[1].vi === 'cọc chèo',
     q ? q.senses.length + ' senses, example: ' + q.senses[0].eg[0] : 'not found');

  ok('a phrasal verb inserts', call({ key: CFG.key, action: 'add', entry: {
    type: 'phrasal', word: 'muddle sideways', verb: 'muddle', particle: 'sideways',
    senses: [{ def: 'to manage without a plan', eg: [], vi: 'xoay xở cho qua' }],
  } }).ok);
  const pv = sandbox.__buildData().entries.find(e => e.word === 'muddle sideways');
  ok('the phrasal verb reads back correctly',
     !!pv && pv.verb === 'muddle' && pv.particle === 'sideways' &&
     pv.senses[0].vi === 'xoay xở cho qua', pv ? pv.word : 'not found');

  /* ------------------------- C. pointing the same script at another sheet */
  /* Changing the Google Sheet link in Settings is the whole move: the same
     deployment, the same key, a different workbook. */

  ok('every post names the workbook it means', add.body.sheet === CFG.sheetUrl,
     String(add.body.sheet));

  const BOOK2 = 'second-workbook-id-0123456789';
  const blank = {
    Vocabulary: [[' ', 'Meaning', '', '']],
    'Phrasal Verb': [[' ', '', 'Meaning', '']],
    Idioms: [[' ', 'Meaning', '', '']],
    Common: [[' ', 'Meaning', '', '']],
    Grammar: [[' ', '', 'Meaning', '']],
  };
  const props2 = { SOTRATU_KEY: CFG.key };
  const two = appsScriptSandbox(grids, props2, { [BOOK2]: blank });
  vm.createContext(two);
  vm.runInContext(read('sheet-sync.gs')
    + '
this.__doPost = doPost; this.__buildData = buildData;', two);
  const call2 = (payload) =>
    JSON.parse(two.__doPost({ postData: { contents: JSON.stringify(payload) } }));

  const link2 = 'https://docs.google.com/spreadsheets/d/' + BOOK2 + '/edit#gid=0';
  const attachedBefore = two.sheets.Vocabulary.grid.length;
  const r2 = call2({ key: CFG.key, sheet: link2, action: 'add', entry: {
    type: 'word', word: 'quoll', pos: 'n', ipa: '/kwɒl/', note: '',
    senses: [{ def: 'a small carnivorous marsupial', eg: [], vi: 'thú quoll' }],
  } });
  ok('a word goes to the workbook the link names', r2.ok && r2.sheet === 'Vocabulary',
     JSON.stringify(r2));
  ok('  and it really is in that workbook',
     two.books[BOOK2].Vocabulary.grid.some(r => String(r[0]).indexOf('quoll') === 0),
     JSON.stringify(two.books[BOOK2].Vocabulary.grid.slice(-1)));
  ok('  while the workbook the script is attached to is untouched',
     two.sheets.Vocabulary.grid.length === attachedBefore);
  ok('  and the link is remembered for a script with no sheet of its own',
     two.props.SOTRATU_BOOK === BOOK2, String(two.props.SOTRATU_BOOK));

  const synced = call2({ key: CFG.key, sheet: link2, action: 'sync' });
  ok('Sync reads the named workbook, not the attached one',
     synced.ok && synced.data && synced.data.entries.length === 1 &&
     synced.data.entries[0].word === 'quoll',
     synced.data ? synced.data.entries.length + ' entries' : JSON.stringify(synced));

  const bad = call2({ key: CFG.key, sheet: 'https://docs.google.com/spreadsheets/d/nope/edit',
                      action: 'ping' });
  ok('a link that cannot be opened is refused at the ping, not later',
     bad.ok === false && /cannot be opened/.test(bad.error), JSON.stringify(bad));

  const plain = call2({ key: CFG.key, action: 'add', entry: {
    type: 'word', word: 'zoetrope', pos: 'n', ipa: '', note: '',
    senses: [{ def: 'a spinning drum of pictures', eg: [], vi: 'trống quay hình' }],
  } });
  ok('a page too old to send a link still writes to the attached workbook',
     plain.ok && two.sheets.Vocabulary.grid.length > attachedBefore &&
     !two.books[BOOK2].Vocabulary.grid.some(r => String(r[0]).indexOf('zoetrope') === 0),
     JSON.stringify(plain));

  done(a.errs.concat(b.errs, locked.errs));
})();
