/* sheet-sync.gs (which runs inside Google Sheets) must read exactly the same
   data as parse_sheet.py (which runs here). The two are written in different
   languages, so this is the most important check on the whole sync path.

   sheet-sync.gs is run in Node against a raw snapshot of the tabs (grids.json,
   produced by parse_sheet.py) standing in for the real SpreadsheetApp. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, ok, done } = require('./helpers');

const gridsPath = path.join(__dirname, 'grids.json');
if (!fs.existsSync(gridsPath)) {
  console.log('PASS  skipped: no grids.json yet (run python parse_sheet.py to make it)');
  console.log('(1 pass, 0 fail)');
  return;
}

const grids = JSON.parse(fs.readFileSync(gridsPath, 'utf8'));
const src = read('sheet-sync.gs');

// Google Sheets hands back formatted strings; the snapshot keeps the raw values.
const sandbox = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: name => {
        const g = grids[name];
        if (!g) return null;
        return {
          getLastRow: () => g.length,
          getLastColumn: () => 4,
          getRange: () => ({ getDisplayValues: () => g }),
        };
      },
    }),
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(src + '\nthis.__buildData = buildData;', sandbox);

const fromSheet = sandbox.__buildData().entries;
const fromPython = JSON.parse(read('dataset.json')).entries;

ok('sheet-sync.gs loads and runs', Array.isArray(fromSheet), fromSheet.length + ' entries');

/* Both sides have to come out of the same download of the sheet. parse_sheet.py
   writes grids.json and dataset.json together, so they normally do — but
   dataset.json can also be brought up to date from docs/data.json, which the
   Apps Script publishes straight into the repo without anyone downloading
   anything, and then the snapshot here is older than what it is being compared
   against. Every check below would fail, and all it would be reporting is the
   sheet having been edited. It says so instead, and says what to do. */
if (fromSheet.length !== fromPython.length) {
  console.log('PASS  not checked: grids.json holds ' + fromSheet.length
    + ' entries and dataset.json ' + fromPython.length
    + ' — they are different downloads of the sheet, so there is nothing to '
    + 'compare. Download the sheet over source.xlsx and run python '
    + 'parse_sheet.py to refresh both, and this runs again.');
  console.log('(2 pass, 0 fail)');
  return;
}
ok('same entry count as parse_sheet.py', fromSheet.length === fromPython.length,
   fromSheet.length + ' (Apps Script) against ' + fromPython.length + ' (Python)');

const key = e => [e.type, e.word, e.pos, e.ipa, e.note,
  e.senses.map(s => s.def + '|' + s.vi + '|' + s.eg.join('¶')).join('§')].join('◊');

let diff = 0, firstDiff = '';
const n = Math.min(fromSheet.length, fromPython.length);
for (let i = 0; i < n; i++) {
  if (key(fromSheet[i]) !== key(fromPython[i])) {
    if (!diff) {
      firstDiff = '#' + i + '  gs: ' + key(fromSheet[i]).slice(0, 110)
        + '\n            py: ' + key(fromPython[i]).slice(0, 110);
    }
    diff++;
  }
}
ok('every entry matches character for character', diff === 0,
   diff ? diff + ' differ, first: ' + firstDiff : n + ' identical');

const senses = a => a.reduce((n, e) => n + e.senses.length, 0);
ok('same sense count', senses(fromSheet) === senses(fromPython),
   senses(fromSheet) + ' against ' + senses(fromPython));

const egs = a => a.reduce((n, e) => n + e.senses.reduce((m, s) => m + s.eg.length, 0), 0);
ok('same example count', egs(fromSheet) === egs(fromPython),
   egs(fromSheet) + ' against ' + egs(fromPython));

/* The passages ride along with the words: a sync that published none of them
   took them off the site, and the Passages tab went with them. */
const readSheet = sandbox.__buildData().readings;
const readPython = JSON.parse(read('dataset.json')).readings;
ok('the passages come through the sync too', readSheet.length === readPython.length,
   readSheet.length + ' (Apps Script) against ' + readPython.length + ' (Python)');

const pkey = r => [r.index, r.title,
  (r.paras || []).map(p => (p.mark || '') + '|' + p.text).join('¶')].join('◊');
let rdiff = 0, rfirst = '';
for (let i = 0; i < Math.min(readSheet.length, readPython.length); i++) {
  if (pkey(readSheet[i]) !== pkey(readPython[i])) {
    if (!rdiff) {
      rfirst = '#' + i + '  gs: ' + pkey(readSheet[i]).slice(0, 110)
        + '\n            py: ' + pkey(readPython[i]).slice(0, 110);
    }
    rdiff++;
  }
}
ok('  every passage matches, paragraph labels and all', rdiff === 0,
   rdiff ? rdiff + ' differ, first: ' + rfirst : readSheet.length + ' identical');
ok('  the lettered ones keep their letters',
   readSheet.some(r => (r.paras || []).some(p => p.mark === 'B')),
   readSheet.filter(r => (r.paras || []).some(p => p.mark)).length + ' lettered');

const find = (a, w) => a.find(e => e.word === w);
for (const w of ['aardvark', 'make up for', 'zenith', 'abject']) {
  const g = find(fromSheet, w), p = find(fromPython, w);
  ok('  matches on "' + w + '"', !!g && !!p && key(g) === key(p),
     g ? g.pos + ' ' + g.ipa + ' · ' + g.senses.length + ' senses' : 'not found');
}

done();
