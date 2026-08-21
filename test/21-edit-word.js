/* Correcting a word that is already in the notebook.

   The entry used to carry ← → and a running count, which said what the arrow
   keys already do. In their place is one button that acts on the entry itself,
   and only for someone who has unlocked the notebook. Saving puts the word
   back where it was: in the sheet for a word that came from the sheet, in this
   browser for a word added here. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, boot, ok, done, wait, click, unlockedStore, BACKUP_KEY,
        appsScriptSandbox } = require('./helpers');

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

const openWord = async (g, word) => {
  const q = g.doc.getElementById('q');
  q.value = word;
  q.dispatchEvent(new g.window.Event('input'));
  await wait(40);
  click(g.window, g.doc.querySelector('.hit'));
  await wait(40);
};

const viOf = g => (g.doc.querySelector('.entry .vi') || {}).textContent;

/* The one button on an entry opens a menu; Edit word is what is in it. */
const openMenu = g => {
  const wrap = g.doc.querySelector('.entry-nav .menu-wrap');
  if (wrap) click(g.window, wrap.querySelector('.iconbtn'));
  return wrap;
};
const editItem = g => g.doc.getElementById('entry-edit');

(async () => {
  /* --- what the entry carries now ---------------------------------------- */
  const posts = [];
  const a = page(unlockedStore(CFG), posts, () => ({ ok: true }));
  await wait(900);
  await openWord(a, 'zenith');

  ok('the entry opens', a.doc.querySelector('.headword').textContent === 'zenith');
  ok('  the ← → buttons are gone, and the running count with them',
     !a.doc.querySelector('.pos-in-list') &&
     a.doc.querySelectorAll('.entry-nav .iconbtn').length === 1,
     a.doc.querySelector('.entry-nav') && a.doc.querySelector('.entry-nav').textContent);
  ok('  what is left is the one menu button',
     (a.doc.querySelector('.entry-nav .iconbtn') || {}).textContent === '☰');
  ok('  and the menu behind it is shut until it is pressed',
     a.doc.querySelector('.entry-nav .menu').hidden);

  openMenu(a);
  ok('  and offers Edit word to an unlocked notebook', !!editItem(a),
     editItem(a) && editItem(a).textContent);
  ok('    with nothing to delete: a word out of the sheet is not mine to remove',
     !a.doc.querySelector('.entry-nav .menu-item.danger'));

  /* --- locked: nothing to press ------------------------------------------ */
  const locked = page({}, [], () => ({ ok: true }));
  await wait(900);
  await openWord(locked, 'zenith');
  ok('a locked notebook offers no menu at all',
     !locked.doc.querySelector('.entry-nav .menu-wrap'));

  /* --- correcting a word that came from the sheet ------------------------- */
  click(a.window, editItem(a));
  await wait(40);
  const dlg = a.doc.getElementById('form-dlg');
  ok('Edit word opens the form on that word', dlg.open &&
     dlg.querySelector('[name=word]').value === 'zenith',
     dlg.querySelector('[name=word]').value);
  ok('  filled in with what the entry already says',
     dlg.querySelector('[name=pos]').value === 'n' &&
     (a.doc.querySelector('#sense-list [name=def]').value || '').length > 5,
     dlg.querySelector('[name=pos]').value + ' - '
       + a.doc.querySelector('#sense-list [name=def]').value.slice(0, 40));
  ok('  and it says it is an edit, not a new word',
     a.doc.querySelector('#form-dlg .dlg-head h2').textContent === 'Edit a word' &&
     a.doc.getElementById('form-save').textContent === 'Save changes',
     a.doc.getElementById('form-save').textContent);

  a.doc.querySelector('#sense-list [name=vi]').value = 'đỉnh cao nhất';
  posts.length = 0;
  click(a.window, a.doc.getElementById('form-save'));
  await wait(300);
  const sent = posts.find(p => p.body.action === 'edit');
  ok('Save changes tells the sheet to rewrite that entry, not to add another',
     !!sent && !posts.some(p => p.body.action === 'add'),
     posts.map(p => p.body.action).join(', '));
  ok('  saying which entry it was', !!sent && sent.body.was.word === 'zenith' &&
     sent.body.was.type === 'word' && !!sent.body.was.id,
     sent && JSON.stringify(sent.body.was));
  ok('  and what it should say now',
     !!sent && sent.body.entry.senses[0].vi === 'đỉnh cao nhất' &&
     sent.body.entry.id === sent.body.was.id,
     sent && sent.body.entry.senses[0].vi);
  ok('  the page shows the correction at once, without waiting for a publish',
     viOf(a) === 'đỉnh cao nhất', viOf(a));

  /* --- a word of my own, with no sheet behind it -------------------------- */
  const mine = page(unlockedStore(), [], () => ({ ok: true }));
  await wait(900);
  click(mine.window, mine.doc.getElementById('add-word'));
  const mdlg = mine.doc.getElementById('form-dlg');
  mdlg.querySelector('[name=word]').value = 'quokka';
  mine.doc.querySelector('#sense-list [name=def]').value = 'a small marsupial';
  mine.doc.querySelector('#sense-list [name=vi]').value = 'chuột túi nhỏ';
  click(mine.window, mine.doc.getElementById('form-save'));
  await wait(300);
  ok('a word added here is on screen',
     mine.doc.querySelector('.headword').textContent === 'quokka',
     mine.doc.querySelector('.headword').textContent);
  const firstId = JSON.parse(mine.store[BACKUP_KEY])[0].id;

  openMenu(mine);
  ok('  a word of my own offers both Edit and Delete',
     !!editItem(mine) && !!mine.doc.querySelector('.entry-nav .menu-item.danger'),
     [...mine.doc.querySelectorAll('.entry-nav .menu-item')].map(b => b.textContent).join(', '));
  click(mine.window, editItem(mine));
  await wait(40);
  mine.doc.querySelector('#sense-list [name=vi]').value = 'chuột túi cụt đuôi';
  click(mine.window, mine.doc.getElementById('form-save'));
  await wait(300);
  const kept = JSON.parse(mine.store[BACKUP_KEY]);
  ok('correcting it changes the one word, and does not add a second beside it',
     kept.length === 1 && kept[0].senses[0].vi === 'chuột túi cụt đuôi',
     kept.length + ' kept: ' + JSON.stringify(kept.map(e => e.word)));
  ok('  and it keeps the id it had', kept[0].id === firstId, kept[0].id);
  ok('  the entry on screen says the new thing',
     viOf(mine) === 'chuột túi cụt đuôi', viOf(mine));

  /* --- the script side: the rows come out and go back in ------------------ */
  const gridsPath = path.join(__dirname, 'grids.json');
  if (!fs.existsSync(gridsPath)) {
    ok('skipped the script side: no grids.json yet', true);
    done(a.errs.concat(locked.errs, mine.errs));
    return;
  }
  const grids = JSON.parse(fs.readFileSync(gridsPath, 'utf8'));
  const sandbox = appsScriptSandbox(grids, { SOTRATU_KEY: CFG.key });
  vm.createContext(sandbox);
  vm.runInContext(read('sheet-sync.gs') + '\nthis.__doPost = doPost;', sandbox);

  const vocab = sandbox.sheets.Vocabulary;
  const findRow = () => vocab.grid.findIndex(r => String(r[0]).indexOf('zenith') === 0);
  const rowsBefore = vocab.grid.length;
  ok('the sheet has the word to begin with', findRow() > -1, 'row ' + (findRow() + 1));

  const res = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'edit',
      was: { id: 's1', type: 'word', word: 'zenith', verb: '', particle: '' },
      entry: { id: 's1', type: 'word', word: 'zenith', verb: '', particle: '',
               pos: 'n', ipa: '/ˈzen.ɪθ/', note: '',
               senses: [{ def: 'the highest point', eg: [], vi: 'đỉnh cao nhất' }] },
    }) },
  }));
  ok('doPost handles the edit action', res.ok === true, JSON.stringify(res).slice(0, 90));
  const at = findRow();
  ok('  the word is still there, once',
     vocab.grid.filter(r => String(r[0]).indexOf('zenith') === 0).length === 1,
     'row ' + (at + 1));
  ok('  carrying what was sent', vocab.grid[at][1] === 'the highest point' &&
     vocab.grid[at][2] === 'đỉnh cao nhất', JSON.stringify(vocab.grid[at]));
  ok('  and the tab did not grow', vocab.grid.length === rowsBefore,
     rowsBefore + ' -> ' + vocab.grid.length);

  const missing = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'edit',
      was: { id: 'sX', type: 'word', word: 'qqqnotthere', verb: '', particle: '' },
      entry: { id: 'sX', type: 'word', word: 'qqqnotthere', pos: '', ipa: '', note: '',
               senses: [{ def: 'x', eg: [], vi: 'x' }] },
    }) },
  }));
  ok('a word that is not in the sheet is said so, and nothing is written',
     missing.ok === false && /Could not find/.test(missing.error), missing.error);

  done(a.errs.concat(locked.errs, mine.errs));
})();
