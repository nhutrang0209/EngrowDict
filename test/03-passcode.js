/* The passcode gate and the Edit buttons in Settings.

   The gate is a guard against stray clicks, not real security — the default
   passcode is visible in the page source. What the tests hold it to is that it
   consistently governs what the interface offers. */
const { read, boot, ok, done, wait, click, btn, SETTINGS_KEY, PASSCODE } = require('./helpers');

const shell = read('docs/index.html');
const mk = store => boot({
  html: shell, full: true, store: store || {},
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

(async () => {
  const a = mk();
  await wait(900);
  const { doc, window: w } = a;

  // --- locked by default ------------------------------------------------
  ok('starts locked', doc.getElementById('add-word').textContent === 'Unlock to add',
     doc.getElementById('add-word').textContent);
  click(w, doc.getElementById('add-word'));
  ok('the add form stays shut while locked', !doc.getElementById('form-dlg').open);
  ok('  it opens Settings instead', doc.getElementById('set-dlg').open);
  ok('  with the passcode field focused-ready', !!doc.getElementById('pass-in'));
  ok('the opening screen offers a way in', !!btn(doc, '.blank .btn', 'Unlock adding words'));

  // --- links cannot be edited while locked -------------------------------
  ok('link rows are shown but not editable',
     doc.querySelectorAll('#setgroup .edit-btn').length === 3 &&
     [...doc.querySelectorAll('#setgroup .edit-btn')].every(b => b.disabled));
  ok('Save and Test are off too',
     doc.getElementById('set-save').disabled && doc.getElementById('set-test').disabled);
  ok('the sheet link reads as not set yet',
     doc.getElementById('val-sheet').textContent === 'Not set yet',
     doc.getElementById('val-sheet').textContent);

  // --- wrong passcode ----------------------------------------------------
  doc.getElementById('pass-in').value = '000000';
  click(w, doc.getElementById('pass-go'));
  ok('a wrong passcode is refused',
     doc.getElementById('set-msg').textContent.includes('Wrong'),
     doc.getElementById('set-msg').textContent);
  ok('  and nothing unlocks', doc.getElementById('add-word').textContent === 'Unlock to add');

  // --- right passcode ----------------------------------------------------
  doc.getElementById('pass-in').value = PASSCODE;
  click(w, doc.getElementById('pass-go'));
  await wait(60);
  ok('the default passcode 229922 unlocks it',
     doc.getElementById('add-word').textContent === '+ Add word',
     doc.getElementById('add-word').textContent);
  ok('the unlocked state is remembered', JSON.parse(a.store[SETTINGS_KEY]).unlocked === true);
  ok('edit buttons come alive',
     [...doc.querySelectorAll('#setgroup .edit-btn')].every(b => !b.disabled));

  // --- Edit button reveals the input -------------------------------------
  const row = doc.getElementById('row-sheet');
  const input = row.querySelector('input');
  const edit = row.querySelector('.edit-btn');
  ok('the link starts read-only', input.hidden && !doc.getElementById('val-sheet').hidden);
  click(w, edit);
  ok('pressing Edit reveals the input',
     !input.hidden && doc.getElementById('val-sheet').hidden && edit.textContent === 'Cancel');
  input.value = 'https://docs.google.com/spreadsheets/d/ABC/edit';
  click(w, btn(doc, '#set-dlg .dlg-foot .btn', 'Save'));
  await wait(60);
  ok('Save keeps the new link',
     JSON.parse(a.store[SETTINGS_KEY]).sheetUrl === 'https://docs.google.com/spreadsheets/d/ABC/edit');
  ok('  and it goes back to read-only',
     doc.getElementById('val-sheet').textContent.endsWith('/ABC/edit') &&
     row.querySelector('input').hidden,
     doc.getElementById('val-sheet').textContent);
  ok('  the Open sheet button appears', !doc.getElementById('open-sheet').hidden);
  ok('  Save closes the window, so there is no wondering whether it took',
     !doc.getElementById('set-dlg').open);
  ok('  closing is an × in the corner, not a button in the footer',
     !!doc.getElementById('set-x') &&
     ![...doc.querySelectorAll('#set-dlg .dlg-foot .btn')]
       .some(b => b.textContent === 'Close'));

  click(w, doc.getElementById('settings-btn'));
  ok('  and the × shuts it again', doc.getElementById('set-dlg').open &&
     (click(w, doc.getElementById('set-x')), !doc.getElementById('set-dlg').open));
  click(w, doc.getElementById('settings-btn'));

  // Cancel puts back what was stored
  click(w, edit);
  row.querySelector('input').value = 'https://example.com/wrong';
  click(w, edit);
  ok('Cancel throws the edit away',
     row.querySelector('input').value.endsWith('/ABC/edit') && edit.textContent === 'Edit',
     row.querySelector('input').value);

  // --- the key is masked -------------------------------------------------
  const keyRow = doc.getElementById('row-key');
  click(w, keyRow.querySelector('.edit-btn'));
  keyRow.querySelector('input').value = 'abcdef123456';
  click(w, btn(doc, '#set-dlg .dlg-foot .btn', 'Save'));
  await wait(60);
  ok('the key is shown masked', doc.getElementById('val-key').textContent.startsWith('abc') &&
     doc.getElementById('val-key').textContent.includes('•') &&
     !doc.getElementById('val-key').textContent.includes('456'),
     doc.getElementById('val-key').textContent);

  // --- changing the passcode ---------------------------------------------
  doc.getElementById('pass-new').value = '12';
  click(w, doc.getElementById('pass-change'));
  ok('a too-short passcode is refused',
     doc.getElementById('set-msg').textContent.includes('4 characters'),
     doc.getElementById('set-msg').textContent);
  doc.getElementById('pass-new').value = 'trang2026';
  click(w, doc.getElementById('pass-change'));
  ok('the passcode can be changed once unlocked',
     JSON.parse(a.store[SETTINGS_KEY]).code === 'trang2026',
     doc.getElementById('set-msg').textContent);

  // --- lock again, then the new passcode is the one that works -----------
  click(w, doc.getElementById('pass-lock'));
  await wait(60);
  ok('Lock again puts it back', doc.getElementById('add-word').textContent === 'Unlock to add');
  doc.getElementById('pass-in').value = PASSCODE;
  click(w, doc.getElementById('pass-go'));
  ok('  the old passcode no longer works',
     doc.getElementById('add-word').textContent === 'Unlock to add');
  doc.getElementById('pass-in').value = 'trang2026';
  click(w, doc.getElementById('pass-go'));
  await wait(60);
  ok('  the new one does', doc.getElementById('add-word').textContent === '+ Add word');

  // --- the sheet section folds, and says how to swap workbooks -----------
  const fold = a.doc.getElementById('sheet-fold');
  ok('the three links live in one collapsible section',
     !!fold && a.doc.querySelectorAll('#setgroup .edit-btn').length === 3);
  ok('  with the key for the Vietnamese column under them, and no Edit on it',
     fold.querySelectorAll('.setrow').length === 4 &&
     !!a.doc.getElementById('ai-send') && !a.doc.querySelector('#row-ai .edit-btn'),
     fold.querySelectorAll('.setrow').length + ' rows');
  ok('  it opens itself while anything is still missing', fold.open,
     'webApp is not set here');
  const steps = [...a.doc.querySelectorAll('#sheet-fold > .setfold-body > .steps > li')]
    .map(li => li.textContent);
  ok('  the steps for changing workbook are spelled out there',
     steps.length === 3 && /Test connection and Save/.test(steps[0]) &&
     /^Press Sync/.test(steps[1]), steps.length + ' steps');
  ok('  and the note says the Web App link and key stay put',
     /never change/.test(
       a.doc.querySelector('#sheet-fold > .setfold-body > .setfold-note').textContent));

  // where the link and the key come from, for a first-time set-up
  const first = a.doc.getElementById('first-fold');
  const fsteps = [...first.querySelectorAll('.steps > li')].map(li => li.textContent);
  ok('  a nested section says where the link and key come from',
     !!first && first.open === false && fsteps.length === 5, fsteps.length + ' steps');
  ok('    it names the file to paste, and links to it in the repo',
     /sheet-sync\.gs/.test(fsteps[1]) &&
     first.querySelector('a.filelink').href ===
       'https://github.com/nhutrang0209/EngrowDict/blob/main/sheet-sync.gs',
     first.querySelector('a.filelink').href);
  ok('    it says to deploy as a Web app open to Anyone',
     /Web app/.test(fsteps[2]) && /Anyone/.test(fsteps[2]), fsteps[2]);
  ok('    and names the menu item that shows both',
     /Link for the web to write words/.test(fsteps[3]), fsteps[3]);
  ok('    every step is its own line, none of them a paragraph',
     fsteps.every(t => t.length < 80), String(Math.max.apply(null, fsteps.map(t => t.length))));

  const c = mk({ [SETTINGS_KEY]: JSON.stringify({
    sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC/edit',
    webApp: 'https://script.google.com/macros/s/XYZ/exec',
    key: 'a-secret-key', code: PASSCODE, unlocked: true }) });
  await wait(900);
  click(c.window, c.doc.getElementById('settings-btn'));
  ok('once it is all linked the section stays folded away',
     c.doc.getElementById('sheet-fold').open === false);
  ok('  and the summary says so',
     c.doc.getElementById('sheet-fold-state').textContent === 'linked',
     c.doc.getElementById('sheet-fold-state').textContent);

  // --- a fresh visitor is locked again, with the default -----------------
  const b = mk();
  await wait(900);
  ok('someone else opening the site is locked out',
     b.doc.getElementById('add-word').textContent === 'Unlock to add');
  ok('  and sees no link of yours', b.doc.getElementById('open-sheet').hidden);

  done(a.errs.concat(b.errs, c.errs));
})();
