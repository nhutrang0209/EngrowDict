/* Adding a passage of your own.

   The passages the page ships with come out of the sheet, so one added here
   goes into the sheet too — two rows, the numbered title and the body under
   it, which is exactly what parse_sheet.py reads and what the sync publishes.
   Until that publish comes back down it lives on this device. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, boot, ok, done, wait, click, unlockedStore,
        appsScriptSandbox } = require('./helpers');

const shell = read('docs/index.html');
const MINE = 'engrowdict:passages:v1';
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
      posts.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply()) });
    }
    return realFetch(url, opts);
  };
  return g;
}

const fill = (g, title, body) => {
  const dlg = g.doc.getElementById('pass-dlg');
  dlg.querySelector('[name=ptitle]').value = title;
  dlg.querySelector('[name=pbody]').value = body;
};

(async () => {
  /* --- the button is where the passages are ------------------------------- */
  const store = unlockedStore(CFG);
  const posts = [];
  const a = page(store, posts, () => ({ ok: true, index: 34, row: 900 }));
  await wait(900);
  const { doc, window: w } = a;
  const add = () => doc.getElementById('add-word');

  ok('on the dictionary the button adds a word', add().textContent === '+ Add word',
     add().textContent);
  click(w, doc.getElementById('tab-passages'));
  await wait(40);
  ok('on the passages it adds a passage', add().textContent === '+ Add passage',
     add().textContent);
  ok('  and it is the same button, not another one beside it',
     doc.querySelectorAll('.acts .btn-primary').length === 1);

  click(w, add());
  const dlg = doc.getElementById('pass-dlg');
  ok('pressing it opens a form for one', dlg.open &&
     !!dlg.querySelector('[name=ptitle]') && !!dlg.querySelector('[name=pbody]'));

  /* --- what it will not save --------------------------------------------- */
  fill(a, '', 'A paragraph.');
  click(w, doc.getElementById('pass-save'));
  await wait(40);
  ok('a passage with no title is refused',
     /title/.test(doc.getElementById('pass-msg').textContent) && posts.length === 0,
     doc.getElementById('pass-msg').textContent);
  fill(a, 'A Title', '   ');
  click(w, doc.getElementById('pass-save'));
  await wait(40);
  ok('  and one with no text', /Paste the passage/.test(doc.getElementById('pass-msg').textContent),
     doc.getElementById('pass-msg').textContent);

  /* --- saving it ---------------------------------------------------------- */
  fill(a, 'The Hemp Revival', 'The first paragraph.\n\nThe second one.\n   \nThe third.');
  click(w, doc.getElementById('pass-save'));
  await wait(300);
  const sent = posts.find(p => p.body.action === 'passage');
  ok('saving sends it to the sheet', !!sent, posts.map(p => p.body.action).join(', '));
  ok('  with its title and a paragraph a line',
     !!sent && sent.body.entry.title === 'The Hemp Revival' &&
     sent.body.entry.paras.length === 3 &&
     sent.body.entry.paras[2] === 'The third.',
     sent && JSON.stringify(sent.body.entry.paras));
  ok('  the form closes behind it', !dlg.open);
  ok('  and the passage is open on the page',
     (doc.querySelector('.read h1') || {}).textContent === 'The Hemp Revival',
     (doc.querySelector('.read h1') || {}).textContent);
  ok('  with its paragraphs in it',
     doc.querySelectorAll('.read .prose p').length === 3,
     doc.querySelectorAll('.read .prose p').length + ' paragraphs');
  ok('  it is kept on this device as well',
     JSON.parse(store[MINE]).length === 1 &&
     JSON.parse(store[MINE])[0].title === 'The Hemp Revival',
     store[MINE] && store[MINE].slice(0, 60));

  /* --- the tick, the same one the word form has --------------------------- */
  click(w, add());
  ok('the form offers to write it straight into the sheet',
     !doc.getElementById('pass-to-sheet-row').hidden &&
     doc.getElementById('pass-to-sheet').checked === true);
  doc.getElementById('pass-to-sheet').checked = false;
  fill(a, 'Kept Here Only', 'A paragraph of it.');
  posts.length = 0;
  click(w, doc.getElementById('pass-save'));
  await wait(300);
  ok('  unticked, nothing is sent to the sheet', posts.length === 0,
     posts.map(p => p.body.action).join(', '));
  ok('  and it is still saved on the device, marked as not in the sheet',
     JSON.parse(store[MINE]).some(r => r.title === 'Kept Here Only' && r.inSheet === false),
     store[MINE].slice(0, 120));

  /* --- putting a passage right -------------------------------------------- */
  const menu = () => doc.querySelector('.read .entry-nav .menu-wrap');
  ok('a passage carries the same one button an entry does', !!menu(),
     menu() && menu().textContent);
  click(w, menu().querySelector('.iconbtn'));
  ok('  which offers Edit and Delete',
     !!doc.getElementById('passage-edit') && !!doc.getElementById('passage-delete'));
  click(w, doc.getElementById('passage-edit'));
  await wait(40);
  ok('Edit opens the form on that passage',
     dlg.open && dlg.querySelector('[name=ptitle]').value === 'Kept Here Only' &&
     dlg.querySelector('[name=pbody]').value === 'A paragraph of it.',
     dlg.querySelector('[name=ptitle]').value);
  ok('  and says it is an edit', doc.getElementById('pass-save').textContent === 'Save changes',
     doc.getElementById('pass-head').textContent);

  fill(a, 'Kept Here Only', 'A paragraph of it.\nAnd another.');
  doc.getElementById('pass-to-sheet').checked = true;
  posts.length = 0;
  click(w, doc.getElementById('pass-save'));
  await wait(300);
  const fixed = posts.find(p => p.body.action === 'editpassage');
  ok('saving a correction tells the sheet which passage it was',
     !!fixed && fixed.body.was.title === 'Kept Here Only' &&
     fixed.body.entry.paras.length === 2,
     fixed && JSON.stringify(fixed.body));
  ok('  the page shows it at once',
     doc.querySelectorAll('.read .prose p').length === 2,
     doc.querySelectorAll('.read .prose p').length + ' paragraphs');
  // the list paints a window of rows, so it is searched rather than counted
  const search = title => {
    const q = doc.getElementById('q');
    q.value = title;
    q.dispatchEvent(new w.Event('input'));
    return [...doc.querySelectorAll('.hit .hw')].filter(n => n.textContent === title).length;
  };
  ok('  and it is not shown twice in the list', search('Kept Here Only') === 1,
     search('Kept Here Only') + ' in the list');
  // searching redrew the list; the passage itself is still the one on the page
  const q0 = doc.getElementById('q');
  q0.value = '';
  q0.dispatchEvent(new w.Event('input'));
  await wait(40);

  /* --- and taking one out ------------------------------------------------- */
  w.confirm = () => true;
  click(w, menu().querySelector('.iconbtn'));
  posts.length = 0;
  click(w, doc.getElementById('passage-delete'));
  await wait(300);
  ok('Delete tells the sheet to take it out',
     (posts.find(p => p.body.action === 'delpassage') || {}).body !== undefined,
     posts.map(p => p.body.action).join(', '));
  ok('  and it is gone from the list', search('Kept Here Only') === 0);
  ok('  and from the device', !JSON.parse(store[MINE]).some(r => r.title === 'Kept Here Only'),
     store[MINE]);

  /* --- writing it with the buttons ---------------------------------------- */
  click(w, add());
  const ta = dlg.querySelector('[name=pbody]');
  const bar = dlg.querySelector('.markbar');
  const press = label => click(w,
    [...bar.querySelectorAll('.markbtn')].find(b => (b.title || '') === label));
  ok('the box has a row of buttons over it', !!bar &&
     bar.querySelectorAll('.markbtn').length >= 8,
     bar && bar.querySelectorAll('.markbtn').length + ' buttons');

  ta.value = 'A word in it';
  ta.selectionStart = 2; ta.selectionEnd = 6;
  press('Bold');
  ok('Bold marks what was selected', ta.value === 'A **word** in it', ta.value);
  ta.selectionStart = 0; ta.selectionEnd = ta.value.length;
  press('Take the marks off');
  ok('  and the eraser takes it off again', ta.value === 'A word in it', ta.value);

  ta.value = 'A heading';
  ta.selectionStart = ta.selectionEnd = 3;
  press('Heading');
  ok('Heading works on the line, not the selection', ta.value === '# A heading', ta.value);
  press('Heading');
  ok('  and pressing it again takes it back', ta.value === 'A heading', ta.value);
  press('Indent');
  press('Indent');
  ok('Indent steps the line in, once for each press', ta.value === '> > A heading',
     JSON.stringify(ta.value));
  press('Outdent');
  ok('  and Outdent steps it back', ta.value === '> A heading', JSON.stringify(ta.value));

  ta.value = 'Red for danger';
  ta.selectionStart = 0; ta.selectionEnd = 3;
  press('Red');
  ok('a colour is a mark like any other', ta.value === '[red]Red[/] for danger', ta.value);

  /* --- the preview shows what it will look like --------------------------- */
  ta.value = '# A Heading\n- a bullet\n> stepped in\nplain **bold** and [green]green[/]';
  ta.dispatchEvent(new w.Event('input'));
  const pv = doc.getElementById('pass-preview');
  ok('the form previews it as it will read',
     !!pv && pv.querySelector('h2') && pv.querySelector('h2').textContent === 'A Heading',
     pv && pv.textContent.slice(0, 40));
  ok('  bullets, indents, bold and colour and all',
     !!pv.querySelector('p.bullet') && !!pv.querySelector('.in1') &&
     !!pv.querySelector('b') && !!pv.querySelector('.c-green'),
     [...pv.children].map(n => n.className || n.tagName).join(', '));

  /* --- and the passage itself reads that way ------------------------------ */
  dlg.querySelector('[name=ptitle]').value = 'A Formatted Passage';
  click(w, doc.getElementById('pass-save'));
  await wait(300);
  const prose = doc.querySelector('.read .prose');
  ok('the passage carries the formatting through',
     !!prose.querySelector('h2') && !!prose.querySelector('p.bullet') &&
     !!prose.querySelector('.in1') && !!prose.querySelector('b') &&
     !!prose.querySelector('.c-green'),
     prose.innerHTML.slice(0, 120));
  ok('  and the marks themselves are nowhere on screen',
     !/[*\\[]/.test(prose.textContent), prose.textContent.slice(0, 60));
  ok('  what went to the sheet is the text with its marks, one line a paragraph',
     (posts.find(p => p.body.action === 'passage') || {}).body.entry.paras[0] === '# A Heading',
     JSON.stringify((posts.find(p => p.body.action === 'passage') || {}).body.entry.paras));

  /* --- and it is there on the next visit ---------------------------------- */
  const b = page(store, [], () => ({ ok: true }));
  await wait(900);
  click(b.window, b.doc.getElementById('tab-passages'));
  await wait(40);
  const titles = [...b.doc.querySelectorAll('.hit .hw')].map(n => n.textContent);
  ok('a later visit still has it', titles.includes('The Hemp Revival'),
     titles.slice(0, 4).join(', '));

  /* --- once the sheet publishes it, the local copy steps aside ------------ */
  const withIt = JSON.parse(read('docs/data.json'));
  withIt.readings = withIt.readings.concat([{
    index: '34', title: 'The Hemp Revival',
    paras: [{ text: 'The first paragraph.' }],
  }]);
  const c = boot({
    html: shell, full: true, store,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: () => Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve(withIt) }),
  });
  await wait(900);
  click(c.window, c.doc.getElementById('tab-passages'));
  await wait(40);
  const again = [...c.doc.querySelectorAll('.hit .hw')]
    .filter(n => n.textContent === 'The Hemp Revival');
  ok('once the sheet carries it, it is not shown twice', again.length === 1,
     again.length + ' copies');
  ok('  and the device stops keeping its own copy of that one',
     !JSON.parse(store[MINE]).some(r => r.title === 'The Hemp Revival'),
     store[MINE].slice(0, 80));

  /* --- with no sheet to write to ------------------------------------------ */
  const alone = {};
  const d = page(unlockedStore(), [], () => ({ ok: true }));
  Object.assign(d.store, alone);
  await wait(900);
  click(d.window, d.doc.getElementById('tab-passages'));
  await wait(40);
  click(d.window, d.doc.getElementById('add-word'));
  fill(d, 'On This Device', 'Only here for now.');
  click(d.window, d.doc.getElementById('pass-save'));
  await wait(300);
  ok('with no sheet linked it is still saved, here',
     (d.doc.querySelector('.read h1') || {}).textContent === 'On This Device' &&
     JSON.parse(d.store[MINE])[0].inSheet === false,
     d.store[MINE] && d.store[MINE].slice(0, 60));

  /* --- locked, there is nothing to press ---------------------------------- */
  const locked = page({}, [], () => ({ ok: true }));
  await wait(900);
  click(locked.window, locked.doc.getElementById('tab-passages'));
  await wait(40);
  ok('a locked notebook is asked to unlock first',
     locked.doc.getElementById('add-word').textContent === 'Unlock to add',
     locked.doc.getElementById('add-word').textContent);

  /* --- the script side ---------------------------------------------------- */
  const gridsPath = path.join(__dirname, 'grids.json');
  if (!fs.existsSync(gridsPath)) {
    ok('skipped the script side: no grids.json yet', true);
    done(a.errs.concat(b.errs, c.errs, d.errs, locked.errs));
    return;
  }
  const grids = JSON.parse(fs.readFileSync(gridsPath, 'utf8'));
  const sandbox = appsScriptSandbox(grids, { SOTRATU_KEY: CFG.key });
  vm.createContext(sandbox);
  vm.runInContext(read('sheet-sync.gs')
    + '\nthis.__doPost = doPost;\nthis.__buildData = buildData;', sandbox);

  const tab = sandbox.sheets['Reading Passage'];
  const before = tab.grid.length;
  const wasCount = sandbox.__buildData().readings.length;
  // the number it should take is one past the largest already in the column
  const nextNo = Math.max(...tab.grid.slice(1)
    .map(r => parseInt(String(r[0]).replace('.0', ''), 10))
    .filter(n => !isNaN(n))) + 1;
  const res = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'passage',
      entry: { title: 'A New Passage', paras: ['First para.', 'Second para.'] },
    }) },
  }));
  ok('doPost handles the passage action', res.ok === true, JSON.stringify(res));
  ok('  it takes the next number', res.index === nextNo,
     res.index + ', after ' + (nextNo - 1));
  ok('  two rows go in: the title, then the body',
     tab.grid.length === before + 2 &&
     tab.grid[before][1] === 'A New Passage' &&
     String(tab.grid[before][0]) === String(nextNo) &&
     tab.grid[before + 1][1] === 'First para.\nSecond para.',
     JSON.stringify(tab.grid.slice(before)));
  ok('  and the reader picks it up as a passage like any other', (() => {
    const readings = sandbox.__buildData().readings;
    const last = readings[readings.length - 1];
    return readings.length === wasCount + 1 && last.title === 'A New Passage' &&
      last.paras.length === 2 && last.paras[1].text === 'Second para.';
  })(), JSON.stringify(sandbox.__buildData().readings.slice(-1)));

  /* --- the script side: putting one right, and taking one out ------------ */
  const fixed2 = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'editpassage',
      was: { title: 'A New Passage' },
      entry: { title: 'A Renamed Passage', paras: ['Only one para now.'] },
    }) },
  }));
  ok('doPost handles the editpassage action', fixed2.ok === true, JSON.stringify(fixed2));
  ok('  the rows it stood on are the rows it still stands on',
     tab.grid.length === before + 2 &&
     tab.grid[before][1] === 'A Renamed Passage' &&
     tab.grid[before + 1][1] === 'Only one para now.',
     JSON.stringify(tab.grid.slice(before)));
  ok('  and its number is left alone', String(tab.grid[before][0]) === String(nextNo),
     String(tab.grid[before][0]));

  const gone = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'delpassage', was: { title: 'A Renamed Passage' },
    }) },
  }));
  ok('doPost handles the delpassage action, both rows of it',
     gone.ok === true && tab.grid.length === before,
     JSON.stringify(gone) + ' — ' + tab.grid.length + ' rows');
  ok('  and a passage that is not there is said so',
     JSON.parse(sandbox.__doPost({
       postData: { contents: JSON.stringify({
         key: CFG.key, action: 'delpassage', was: { title: 'Never Existed' },
       }) },
     })).ok === false);

  const empty = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'passage', entry: { title: 'No Body', paras: [] },
    }) },
  }));
  ok('a passage with no text is refused, and nothing is written',
     empty.ok === false && tab.grid.length === before, empty.error);

  done(a.errs.concat(b.errs, c.errs, d.errs, locked.errs));
})();
