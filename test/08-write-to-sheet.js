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
    + '\nthis.__doPost = doPost; this.__buildData = buildData;', two);
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

  /* ------------------ D. the window that hands over the link and the key */
  /* The Web App link is too long to select by hand, so it comes with a Copy
     button. The window is built as HTML here and clicked in jsdom below. */
  props2.DEPLOYED_URL = 'https://script.google.com/macros/s/AKfycb-LONG-ID/exec';
  vm.runInContext('this.__showWriteLink = showWriteLink;', two);
  two.__showWriteLink();
  const dlg = two.shown.dialog;
  ok('the menu item opens a window rather than an alert',
     !!dlg && !two.shown.alert, dlg ? dlg.title : 'nothing shown');

  const { JSDOM } = require('jsdom');
  const win = new JSDOM(dlg.out.getContent(), { runScripts: 'dangerously' }).window;
  const fields = [...win.document.querySelectorAll('input')].map(i => i.value);
  ok('  it shows the link and the key in full',
     fields.length === 2 && fields[0] === props2.DEPLOYED_URL &&
     fields[1] === two.props.SOTRATU_KEY, fields.join(' | '));

  const copies = win.document.querySelectorAll('button.copy');
  ok('  each of them has its own Copy button', copies.length === 2 &&
     copies[0].getAttribute('data-for') === 'a' &&
     copies[1].getAttribute('data-for') === 'b');

  let copied = null;
  win.document.execCommand = () => { copied = win.document.getElementById('a').value; return true; };
  copies[0].click();
  ok('  pressing Copy takes the whole link',
     copied === props2.DEPLOYED_URL && copies[0].textContent === 'Copied',
     copies[0].textContent + ' -> ' + String(copied).slice(0, 30) + '…');

  // and before the first deployment there is no link to hand over, only the key
  const props3 = { SOTRATU_KEY: 'k' };
  const three = appsScriptSandbox(grids, props3);
  vm.createContext(three);
  vm.runInContext(read('sheet-sync.gs') + '\nthis.__showWriteLink = showWriteLink;', three);
  three.__showWriteLink();
  const early = new JSDOM(three.shown.dialog.out.getContent()).window.document;
  ok('  undeployed, it says how to deploy and still gives the key',
     early.querySelectorAll('input').length === 1 &&
     /Not deployed yet/.test(early.querySelector('p.lead').textContent),
     early.querySelector('p.lead').textContent.slice(0, 40));

  /* --------------- E. Fill from Cambridge: a draft, not a saved word */
  /* Cambridge is behind Cloudflare, so the script reads it through a rendering
     proxy. What the parser has to get right is that Cambridge's own markup
     goes in and the sheet's shape comes out. */
  const CAMB_EN =
    '<div class="pr dictionary" data-id="cald4">'
    + '<div class="entry-body__el clrd js-share-holder">'
    + '<div class="di-title">susurrus</div><span class="pos dpos">noun</span>'
    + '<span class="ipa dipa lpr-2">ˌsuːˈsʌr.əs</span>'
    + '<div class="def-block ddef_block ">'
    + '<div class="def ddef_d db">a soft, low <a class="query" href="#">noise</a> '
    + 'like someone whispering: </div>'
    + '<span class="eg deg">the susurrus of the leaves</span>'
    + '</div></div></div>'
    + '<div class="pr dictionary" data-id="cacd"><div class="entry-body__el">'
    + '<div class="def-block ddef_block "><div class="def ddef_d db">a whispering sound'
    + '</div></div></div></div>';
  const CAMB_VI =
    '<div class="pr dictionary" data-id="cald4"><div class="entry-body__el">'
    + '<div class="def-block ddef_block "><div class="def ddef_d db">a soft, low noise</div>'
    + '<span class="trans dtrans dtrans-se">tiếng xào xạc</span>'
    + '</div></div></div>';

  two.net.calls = [];
  two.net.reply = url => ({ code: 200, body: /english-vietnamese/.test(url) ? CAMB_VI : CAMB_EN });
  const draft = call2({ key: CFG.key, action: 'draft', word: 'Susurrus ' });
  ok('a draft comes back for the word asked about',
     draft.ok && draft.source === 'Cambridge' && draft.entry.word === 'susurrus',
     JSON.stringify(draft).slice(0, 90));
  ok('  it reads Cambridge, both the English and the Vietnamese page',
     two.net.calls.length === 2 &&
     /dictionary.cambridge.org\/dictionary\/english\/susurrus$/.test(two.net.calls[0]) &&
     /english-vietnamese\/susurrus$/.test(two.net.calls[1]), two.net.calls.join(' , '));
  ok('  the part of speech comes back the short way the sheet writes it',
     draft.entry.pos === 'n', draft.entry.pos);
  ok('  the phonetics come back inside slashes',
     draft.entry.ipa === '/ˌsuːˈsʌr.əs/', draft.entry.ipa);
  ok('  the definition is plain text, no tags and no trailing colon',
     draft.entry.senses[0].def === 'a soft, low noise like someone whispering',
     draft.entry.senses[0].def);
  ok('  the example and the Vietnamese ride along',
     draft.entry.senses[0].eg[0] === 'the susurrus of the leaves' &&
     draft.entry.senses[0].senses === undefined &&
     draft.entry.senses[0].vi === 'tiếng xào xạc',
     draft.entry.senses[0].vi);
  ok('  the other dictionaries stacked on the page are left alone',
     draft.entry.senses.length === 1, draft.entry.senses.length + ' senses');
  ok('  when Cambridge carries the Vietnamese, nothing is machine-translated',
     draft.translated === 0 && two.net.translated.length === 0);
  ok('  and nothing was written to any sheet',
     two.sheets.Vocabulary.grid.every(r => String(r[0]).indexOf('susurrus') !== 0));

  const phrasal = CAMB_EN.replace('>noun<', '>phrasal verb<')
    .replace('>susurrus<', '>look after<');
  two.net.reply = url => ({ code: /english-vietnamese/.test(url) ? 404 : 200, body: phrasal });
  const pvDraft = call2({ key: CFG.key, action: 'draft', word: 'look after' });
  ok('a phrasal verb is split into its verb and its particle',
     pvDraft.ok && pvDraft.entry.type === 'phrasal' && pvDraft.entry.verb === 'look' &&
     pvDraft.entry.particle === 'after' && pvDraft.entry.ipa === '',
     JSON.stringify(pvDraft.entry).slice(0, 80));
  ok('  a word the Vietnamese dictionary does not carry is translated instead',
     pvDraft.entry.senses[0].vi === '[vi] a soft, low noise like someone whispering'
     && pvDraft.translated === 1,
     pvDraft.entry.senses[0].vi + ' / translated: ' + pvDraft.translated);
  ok('    the definition is what gets translated: the headword alone loses the sense',
     two.net.translated.length === 1 &&
     two.net.translated[0] === 'a soft, low noise like someone whispering',
     two.net.translated.join(' | '));

  // a translation that runs on is cut down to a gloss
  two.net.translation = () => 'trông nom ai đó hoặc cái gì '
    + 'đó, phụ trách ai đó hoặc cái gì '
    + 'đó trong một khoảng thời gian dài.';
  const longVi = call2({ key: CFG.key, action: 'draft', word: 'look after' });
  ok('    and a translation that runs on is cut back to a gloss',
     longVi.entry.senses[0].vi.length < 40 &&
     longVi.entry.senses[0].vi.indexOf(',') === -1,
     longVi.entry.senses[0].vi);
  two.net.translation = t => '[vi] ' + t;

  two.net.reply = () => ({ code: 404, body: '' });
  const missing = call2({ key: CFG.key, action: 'draft', word: 'zzzznotaword' });
  ok('a word Cambridge does not have is said so plainly',
     missing.ok === false && /no entry|answered 404/i.test(missing.error), missing.error);

  /* Cambridge has no entry for everything; Merriam-Webster catches the rest. */
  const MW_PAGE =
    '<h1 class="hword">zzz</h1><span class="parts-of-speech">noun</span>'
    + '<span class="dtText">: a thing of no <a href="#">account</a></span>'
    + '<span class="ex-sent t">a mere zzz of a man</span>'
    + '<span id="dictionary-entry-2"></span>'
    + '<span class="dtText">: the second entry, which is another word entirely</span>';
  const notInCambridge = url => /merriam-webster/.test(url)
    ? { code: 200, body: MW_PAGE } : { code: 404, body: '' };

  two.net.calls = [];
  two.net.reply = notInCambridge;
  const mw = call2({ key: CFG.key, action: 'draft', word: 'zzz' });
  ok('a word Cambridge lacks falls through to Merriam-Webster',
     mw.ok && mw.source === 'Merriam-Webster' && mw.entry.pos === 'n' &&
     mw.entry.senses[0].def === 'a thing of no account',
     JSON.stringify(mw.entry).slice(0, 96));
  ok('  Cambridge is still asked first, both pages of it',
     /cambridge/.test(two.net.calls[0]) &&
     two.net.calls.filter(u => /merriam/.test(u)).length === 1,
     two.net.calls.length + ' calls');
  ok('  the example comes with it, and the second entry does not',
     mw.entry.senses[0].eg[0] === 'a mere zzz of a man' && mw.entry.senses.length === 1);
  ok('  Merriam-Webster prints no IPA, so that field is left empty',
     mw.entry.ipa === '');

  /* With a key, Claude writes the gloss instead of Google Translate. */
  two.props.SOTRATU_AI_KEY = 'sk-ant-not-a-real-key';
  two.net.payloads = [];
  two.net.translated = [];
  two.net.reply = url => /api\.anthropic\.com/.test(url)
    ? { code: 200, body: JSON.stringify({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '["k\u1ebb v\u00f4 t\u00edch s\u1ef1"]' }] }) }
    : notInCambridge(url);
  const ai = call2({ key: CFG.key, action: 'draft', word: 'zzz' });
  ok('with a key, the short Vietnamese is written by Claude',
     ai.entry.senses[0].vi === 'k\u1ebb v\u00f4 t\u00edch s\u1ef1' &&
     ai.glossed === 1 && ai.translated === 0 && two.net.translated.length === 0,
     ai.entry.senses[0].vi + ' / glossed ' + ai.glossed);
  const sentToClaude = two.net.payloads[two.net.payloads.length - 1];
  ok('  asked of Opus 5, at low effort, in one request for all the senses',
     sentToClaude.model === 'claude-opus-5' &&
     sentToClaude.output_config.effort === 'low' &&
     sentToClaude.messages.length === 1,
     sentToClaude.model + ' / ' + sentToClaude.output_config.effort);
  ok('  the definition is what it is asked about, and the house style is shown to it',
     /a thing of no account/.test(sentToClaude.messages[0].content) &&
     /y\u1ebfu \u0111i \/ gi\u1ea3m \u0111i/.test(sentToClaude.system) &&
     /One to five words/.test(sentToClaude.system));

  /* A key that does not work must not cost you the draft. */
  two.net.reply = url => /api\.anthropic\.com/.test(url)
    ? { code: 401, body: '{"error":{"message":"invalid x-api-key"}}' }
    : notInCambridge(url);
  const broke = call2({ key: CFG.key, action: 'draft', word: 'zzz' });
  ok('a key that does not work falls back to Google Translate, and says so',
     broke.ok && broke.glossed === 0 && broke.translated === 1 &&
     /401/.test(broke.warning) && !!broke.entry.senses[0].vi,
     broke.warning);
  delete two.props.SOTRATU_AI_KEY;

  /* ------------------- F. the Fill button, from the browser's side */
  const postsFill = [];
  const DRAFT = {
    ok: true, source: 'Cambridge',
    entry: { type: 'word', word: 'susurrus', verb: '', particle: '', pos: 'n',
             ipa: '/suːˈsʌr.əs/', note: '',
             senses: [{ def: 'a soft murmuring sound', eg: ['the susurrus of the leaves'],
                        vi: 'tiếng xào xạc' }] },
  };
  const f = page(unlockedStore(CFG), postsFill, () => {
    const last = postsFill[postsFill.length - 1];
    return last && last.body.action === 'draft' ? DRAFT : { ok: true };
  });
  await wait(900);
  click(f.window, f.doc.getElementById('add-word'));
  const fdlg = f.doc.getElementById('form-dlg');
  fdlg.querySelector('[name=word]').value = 'susurrus';
  ok('the button says Auto Fill',
     f.doc.getElementById('form-fill').textContent === 'Auto Fill',
     f.doc.getElementById('form-fill').textContent);
  click(f.window, f.doc.getElementById('form-fill'));
  ok('  while it is looking, the line turns amber',
     /warn/.test(f.doc.getElementById('form-msg').className) &&
     /Looking susurrus up/.test(f.doc.getElementById('form-msg').textContent),
     f.doc.getElementById('form-msg').className + ' — '
       + f.doc.getElementById('form-msg').textContent);
  await wait(300);
  ok('  and green once something came back',
     /good/.test(f.doc.getElementById('form-msg').className),
     f.doc.getElementById('form-msg').className);

  ok('Fill asks the sheet for a draft of the word typed in',
     postsFill.length === 1 && postsFill[0].body.action === 'draft' &&
     postsFill[0].body.word === 'susurrus', JSON.stringify(postsFill[0] && postsFill[0].body));
  ok('  the head fields come back filled in',
     fdlg.querySelector('[name=pos]').value === 'n' &&
     fdlg.querySelector('[name=ipa]').value === DRAFT.entry.ipa,
     fdlg.querySelector('[name=pos]').value + ' ' + fdlg.querySelector('[name=ipa]').value);
  ok('  the example sits under its definition, the way the sheet writes it',
     f.doc.querySelector('#sense-list [name=def]').value ===
       'a soft murmuring sound\n- the susurrus of the leaves',
     JSON.stringify(f.doc.querySelector('#sense-list [name=def]').value));
  ok('  and the Vietnamese with it',
     f.doc.querySelector('#sense-list [name=vi]').value === 'tiếng xào xạc');
  ok('  nothing is saved yet: the form is still open and no word was sent',
     fdlg.open && !postsFill.some(x => x.body.action === 'add'));
  ok('  it says where the words came from',
     /Cambridge/.test(f.doc.getElementById('form-msg').textContent),
     f.doc.getElementById('form-msg').textContent);

  // nothing found: the same line goes red
  const postsMiss = [];
  const miss = page(unlockedStore(CFG), postsMiss,
    () => ({ ok: false, error: 'No entry for "qqq" in Cambridge or Merriam-Webster.' }));
  await wait(900);
  click(miss.window, miss.doc.getElementById('add-word'));
  miss.doc.querySelector('#form-dlg [name=word]').value = 'qqq';
  click(miss.window, miss.doc.getElementById('form-fill'));
  await wait(300);
  const missMsg = miss.doc.getElementById('form-msg');
  ok('  a word neither dictionary has turns the line red',
     missMsg.className === 'dlg-msg' && /No entry for/.test(missMsg.textContent),
     missMsg.className + ' — ' + missMsg.textContent);

  click(f.window, f.doc.getElementById('form-save'));
  await wait(300);
  const sent = postsFill.filter(x => x.body.action === 'add').pop();
  ok('  pressing Save word is what finally sends it',
     !!sent && sent.body.entry.word === 'susurrus' && sent.body.entry.pos === 'n' &&
     sent.body.entry.senses[0].vi === 'tiếng xào xạc',
     sent ? JSON.stringify(sent.body.entry).slice(0, 80) : 'nothing sent');

  done(a.errs.concat(b.errs, locked.errs, f.errs, miss.errs));
})();
