/**
 * EngrowDict — publish this Google Sheet to the web with one button.
 *
 * Paste this whole file into the sheet's own Apps Script project
 * (Extensions → Apps Script), save, then reload the sheet. An "EngrowDict"
 * menu appears next to Help.
 *
 * First time: EngrowDict → Set up GitHub repo, then paste the repo and token.
 * After that: EngrowDict → Publish to the web.
 *
 * The script reads the whole workbook, rebuilds data.json exactly the way
 * parse_sheet.py does, and overwrites docs/data.json in the repo. GitHub Pages
 * redeploys within a minute — nothing has to be built on your machine.
 *
 * Reading passages are NOT published: they are the verbatim text of TED-Ed and
 * BBC articles.
 */

var PROP_REPO = 'SOTRATU_REPO';     // "nhutrang0209/EngrowDict"
var PROP_TOKEN = 'SOTRATU_TOKEN';   // fine-grained PAT, Contents: Read and write
var PROP_BRANCH = 'SOTRATU_BRANCH';
var PROP_KEY = 'SOTRATU_KEY';       // shared secret for the web-to-sheet path
var TARGET = 'docs/data.json';

/** Which tab holds which group, and how many columns precede the senses. */
var TABS = {
  word:       { sheet: 'Vocabulary',   headCols: 1 },
  phrasal:    { sheet: 'Phrasal Verb', headCols: 2 },
  idiom:      { sheet: 'Idioms',       headCols: 1 },
  expression: { sheet: 'Common',       headCols: 1 },
  compare:    { sheet: 'Grammar',      headCols: 2 }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EngrowDict')
    .addItem('Publish to the web', 'syncToWeb')
    .addSeparator()
    .addItem('Set up GitHub repo', 'setupRepo')
    .addItem('Link for the web to write words', 'showWriteLink')
    .addItem('Preview the counts (no upload)', 'previewCounts')
    .addToUi();
}

/* ------------------------------------------------------------------ setup */

function setupRepo() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var r = ui.prompt('GitHub repo',
    'In the form owner/name, for example nhutrang0209/EngrowDict:',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var repo = r.getResponseText().trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    ui.alert('That is not the right shape. It should be owner/name.');
    return;
  }

  var t = ui.prompt('GitHub token',
    'Paste a fine-grained personal access token with Contents: Read and write '
    + 'on that repo.\n\nCreate one at github.com/settings/personal-access-tokens',
    ui.ButtonSet.OK_CANCEL);
  if (t.getSelectedButton() !== ui.Button.OK) return;
  var token = t.getResponseText().trim();
  if (!token) { ui.alert('No token entered.'); return; }

  var b = ui.prompt('Branch', 'Leave blank to use main:', ui.ButtonSet.OK_CANCEL);
  var branch = b.getSelectedButton() === ui.Button.OK && b.getResponseText().trim()
    ? b.getResponseText().trim() : 'main';

  props.setProperty(PROP_REPO, repo);
  props.setProperty(PROP_TOKEN, token);
  props.setProperty(PROP_BRANCH, branch);

  var check = ghGet(repo, token, branch, 'docs');
  if (check.code === 200 || check.code === 404) {
    ui.alert('Done', 'Saved. Now use EngrowDict → Publish to the web.', ui.ButtonSet.OK);
  } else {
    ui.alert('Cannot reach the repo',
      'GitHub answered ' + check.code + '.\n\n' + String(check.body).slice(0, 300)
      + '\n\nCheck the repo name, the token permissions, and that the token was '
      + 'granted access to this repo.',
      ui.ButtonSet.OK);
  }
}

function previewCounts() {
  var d = buildData();
  var n = {};
  for (var i = 0; i < d.entries.length; i++) n[d.entries[i].type] = (n[d.entries[i].type] || 0) + 1;
  var senses = 0;
  for (i = 0; i < d.entries.length; i++) senses += d.entries[i].senses.length;
  SpreadsheetApp.getUi().alert('Read from the sheet',
    d.entries.length + ' entries · ' + senses + ' senses\n\n'
    + 'Words: ' + (n.word || 0) + '\nPhrasal verbs: ' + (n.phrasal || 0)
    + '\nIdioms: ' + (n.idiom || 0) + '\nExpressions: ' + (n.expression || 0)
    + '\nEasily mixed up: ' + (n.compare || 0)
    + '\n\nReading passages are left out of the public copy.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ------------------------------------------- the way back: web -> sheet */

/**
 * Show the link to paste into the web page's Settings.
 * Deploy → New deployment → Web app → "Anyone" must be done first.
 */
function showWriteLink() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(PROP_KEY);
  if (!key) {
    key = Utilities.getUuid();
    props.setProperty(PROP_KEY, key);
  }
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { url = ''; }

  if (!url) {
    ui.alert('Not deployed yet',
      'Go to Deploy → New deployment → pick type "Web app", set '
      + '"Who has access" to "Anyone", then Deploy.\n\n'
      + 'Come back and open this menu again to get the link.\n\nYour key:\n' + key,
      ui.ButtonSet.OK);
    return;
  }
  ui.alert('Paste these two into the web page Settings',
    'Web App link:\n' + url + '\n\nKey:\n' + key
    + '\n\nBoth stay in your own browser. Anyone without them cannot write to '
    + 'the sheet.',
    ui.ButtonSet.OK);
}

/** Lets you open the link in a browser to check the deployment. */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'engrowdict', version: 1 }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var out = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  };
  try {
    var body = JSON.parse(e.postData.contents);
    var key = PropertiesService.getScriptProperties().getProperty(PROP_KEY);
    if (!key || body.key !== key) return out({ ok: false, error: 'Wrong key' });
    if (body.action === 'ping') return out({ ok: true, pong: true });
    if (body.action === 'sync') return out(syncForWeb());
    if (body.action !== 'add') return out({ ok: false, error: 'Unknown request' });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var res = insertEntry(body.entry);
      return out(res);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

/** How many columns are actually in play; every tab uses 3 or 4. */
function width(sh) {
  return Math.max(1, Math.min(4, sh.getMaxColumns ? sh.getMaxColumns() : 4));
}

/** A new mixed-up group takes the next number after the largest in use. */
function nextGroup(sh) {
  var last = sh.getLastRow();
  if (last < 2) return '1';
  var vals = sh.getRange(1, 1, last, 1).getDisplayValues();
  var max = 0;
  for (var i = 1; i < vals.length; i++) {
    var n = parseInt(txt(vals[i][0]), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

var LINK_BLUE = '#1155cc';   // the blue the sheet already uses for headwords
var BORDER_INK = '#000000';

/** Where the headword links to. Cambridge slugs are lowercase, hyphenated. */
function cambridgeUrl(term) {
  var slug = txt(term).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? 'https://dictionary.cambridge.org/dictionary/english/' + slug : '';
}

/**
 * The head cell as rich text: the word itself bold, blue and linked; the part
 * of speech, the phonetics and any note left plain underneath.
 */
function headRichText(fullText, word, url) {
  var plain = SpreadsheetApp.newTextStyle()
    .setBold(false).setItalic(false).setUnderline(false)
    .setForegroundColor(BORDER_INK).build();
  var headline = SpreadsheetApp.newTextStyle()
    .setBold(true).setUnderline(true).setForegroundColor(LINK_BLUE).build();

  var b = SpreadsheetApp.newRichTextValue().setText(fullText);
  if (!fullText.length) return b.build();
  b = b.setTextStyle(0, fullText.length, plain);
  var n = Math.min(word.length, fullText.length);
  if (n > 0 && fullText.lastIndexOf(word, 0) === 0) {
    b = b.setTextStyle(0, n, headline);
    if (url) b = b.setLinkUrl(0, n, url);
  }
  return b.build();
}

/**
 * Make the new rows look like every other entry: one merged cell for the head,
 * a dashed rule between senses, solid lines everywhere else.
 */
function formatInserted(sh, at, n, entry, w) {
  var headWide = (entry.type === 'phrasal' || entry.type === 'compare') ? 2 : 1;

  if (n > 1) {
    for (var c = 1; c <= headWide; c++) sh.getRange(at, c, n, 1).merge();
  }

  if (entry.type === 'compare') {
    var cw = txt(entry.word);
    sh.getRange(at, 2).setRichTextValue(headRichText(cw, cw, cambridgeUrl(cw)));
  } else if (entry.type === 'phrasal') {
    var verb = txt(entry.verb || entry.word);
    var whole = (verb + ' ' + txt(entry.particle)).trim();
    sh.getRange(at, 1).setRichTextValue(headRichText(verb, verb, cambridgeUrl(whole)));
  } else {
    var text = headCell(entry);
    sh.getRange(at, 1).setRichTextValue(
      headRichText(text, txt(entry.word), cambridgeUrl(entry.word)));
  }

  // outline and the column rules stay solid
  sh.getRange(at, 1, n, w).setBorder(
    true, true, true, true, true, null, BORDER_INK, SpreadsheetApp.BorderStyle.SOLID);

  // only the rules between senses are dashed, and only beside the merged head
  if (n > 1 && w > headWide) {
    sh.getRange(at, headWide + 1, n, w - headWide).setBorder(
      null, null, null, null, null, true, BORDER_INK, SpreadsheetApp.BorderStyle.DASHED);
  }
}

/** Build the head cell the way the sheet writes it: word (pos) \n /ipa/ */
function headCell(entry) {
  var s = txt(entry.word);
  if (txt(entry.pos)) s += ' (' + txt(entry.pos) + ')';
  if (txt(entry.ipa)) s += '\n' + txt(entry.ipa);
  if (txt(entry.note)) s += '\n' + txt(entry.note);
  return s;
}

/** The first row to insert before, so the tab stays in a→z order. */
function insertRowFor(sh, sortKey, headCols) {
  var last = sh.getLastRow();
  if (last < 2) return last + 1;
  var vals = sh.getRange(1, 1, last, width(sh)).getDisplayValues();
  var target = 0;
  for (var i = 1; i < vals.length; i++) {
    var a = txt(vals[i][0]);
    if (!a) continue;                                   // a following sense
    var isDivider = a.length <= 2 && !txt(vals[i][1]) && !txt(vals[i][2]);
    if (isDivider) continue;                            // letter divider
    var k = a.split('\n')[0].replace(/\s*\([^()]*\)\s*$/, '').toLowerCase().trim();
    if (headCols > 1) k = (k + ' ' + txt(vals[i][1])).trim().toLowerCase();
    if (k > sortKey) { target = i + 1; break; }          // getRange is 1-based
  }
  return target || last + 1;
}

function insertEntry(entry) {
  var tab = TABS[entry.type] || TABS.word;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab.sheet);
  if (!sh) return { ok: false, error: 'No tab called ' + tab.sheet };

  var senses = entry.senses || [];
  if (!senses.length) return { ok: false, error: 'The word has no senses' };

  var group = entry.type === 'compare' ? nextGroup(sh) : '';
  var rowsOut = [];
  for (var i = 0; i < senses.length; i++) {
    var def = txt(senses[i].def);
    var eg = senses[i].eg || [];
    for (var j = 0; j < eg.length; j++) def += '\n   - ' + txt(eg[j]);
    if (entry.type === 'phrasal') {
      rowsOut.push([i === 0 ? txt(entry.verb || entry.word) : '',
                    i === 0 ? txt(entry.particle) : '', def, txt(senses[i].vi)]);
    } else if (entry.type === 'compare') {
      rowsOut.push([i === 0 ? group : '', i === 0 ? txt(entry.word) : '', def, txt(senses[i].vi)]);
    } else {
      rowsOut.push([i === 0 ? headCell(entry) : '', def, txt(senses[i].vi), '']);
    }
  }

  var sortKey = entry.type === 'phrasal'
    ? (txt(entry.verb) + ' ' + txt(entry.particle)).trim().toLowerCase()
    : txt(entry.word).toLowerCase();
  var at = entry.type === 'compare'
    ? sh.getLastRow() + 1                       // grouped, not alphabetical
    : insertRowFor(sh, sortKey, tab.headCols);

  var w = width(sh);
  if (at <= sh.getLastRow()) sh.insertRowsBefore(at, rowsOut.length);
  var trimmed = [];
  for (i = 0; i < rowsOut.length; i++) trimmed.push(rowsOut[i].slice(0, w));
  sh.getRange(at, 1, trimmed.length, w).setValues(trimmed);

  // The words matter more than the styling, so a formatting failure is
  // reported rather than allowed to throw the whole insert away.
  try {
    formatInserted(sh, at, trimmed.length, entry, w);
  } catch (err) {
    return { ok: true, sheet: tab.sheet, row: at, rows: trimmed.length,
             warning: 'Added, but the formatting did not apply: ' + String(err) };
  }
  return { ok: true, sheet: tab.sheet, row: at, rows: trimmed.length };
}

/* ---------------------------------------------------------------- publish */

/** Read the sheet and push it to the repo. Shared by the menu item and by the
 *  Sync button on the web page, so both take exactly the same path. */
function publishToRepo() {
  var props = PropertiesService.getScriptProperties();
  var repo = props.getProperty(PROP_REPO);
  var token = props.getProperty(PROP_TOKEN);
  var branch = props.getProperty(PROP_BRANCH) || 'main';

  var data = buildData();
  if (!data.entries.length) {
    return { ok: false, error: 'No entries could be read. Check the tab names.' };
  }
  var payload = { entries: data.entries, readings: [] };
  if (!repo || !token) {
    return { ok: true, published: false, entries: data.entries.length, payload: payload,
             error: 'No GitHub repo set up yet — use EngrowDict → Set up GitHub repo.' };
  }
  var json = JSON.stringify(payload);
  var sha = shaOf(repo, token, branch, TARGET);
  var res = ghPut(repo, token, branch, TARGET, json, sha,
    'Sync from Google Sheet: ' + data.entries.length + ' entries');
  if (res.code === 200 || res.code === 201) {
    return { ok: true, published: true, entries: data.entries.length };
  }
  return { ok: true, published: false, entries: data.entries.length, payload: payload,
           error: 'GitHub answered ' + res.code + '. ' + String(res.body).slice(0, 160) };
}

/** What the web page's Sync button calls. When the push cannot happen, the
 *  entries come back inline so the page can at least show them right away. */
function syncForWeb() {
  var r = publishToRepo();
  if (!r.ok) return r;
  return {
    ok: true,
    published: !!r.published,
    entries: r.entries,
    error: r.error || null,
    data: r.published ? null : r.payload,
  };
}

function syncToWeb() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_REPO) || !props.getProperty(PROP_TOKEN)) { setupRepo(); return; }

  SpreadsheetApp.getActiveSpreadsheet().toast('Reading the sheet…', 'EngrowDict', 30);
  var r = publishToRepo();
  if (!r.ok) { ui.alert(r.error); return; }

  if (r.published) {
    ui.alert('Published',
      r.entries + ' entries are on the web.\n\n'
      + 'GitHub Pages redeploys in about 30–60 seconds. If the page still looks '
      + 'the same, reload with Ctrl+F5.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('Upload failed', r.error, ui.ButtonSet.OK);
  }
}

/* -------------------------------------------------------- talking to GitHub */

function ghHeaders(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function ghGet(repo, token, branch, path) {
  var url = 'https://api.github.com/repos/' + repo + '/contents/' + path
    + '?ref=' + encodeURIComponent(branch);
  var r = UrlFetchApp.fetch(url, {
    method: 'get', headers: ghHeaders(token), muteHttpExceptions: true,
  });
  return { code: r.getResponseCode(), body: r.getContentText() };
}

/** Get the target file's sha from the directory listing, to avoid
 *  downloading the whole 4 MB file. */
function shaOf(repo, token, branch, path) {
  var dir = path.indexOf('/') > -1 ? path.slice(0, path.lastIndexOf('/')) : '';
  var name = path.slice(path.lastIndexOf('/') + 1);
  var r = ghGet(repo, token, branch, dir);
  if (r.code !== 200) return null;
  var list = JSON.parse(r.body);
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name) return list[i].sha;
  }
  return null;
}

function ghPut(repo, token, branch, path, text, sha, message) {
  var payload = {
    message: message,
    content: Utilities.base64Encode(text, Utilities.Charset.UTF_8),
    branch: branch,
  };
  if (sha) payload.sha = sha;
  var r = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
    method: 'put',
    headers: ghHeaders(token),
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  return { code: r.getResponseCode(), body: r.getContentText() };
}

/* ------------------------------- reading the sheet (mirrors parse_sheet.py) */

function txt(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}
function flat(s) {
  return txt(s).replace(/\n/g, ' ').replace(/[ \t]+/g, ' ').trim();
}
function senseOf(defCell, viCell) {
  var parts = txt(defCell).split(/\n\s*[-–—]\s*/);
  var eg = [];
  for (var i = 1; i < parts.length; i++) {
    if (flat(parts[i])) eg.push(flat(parts[i]));
  }
  return { def: flat(parts[0]), eg: eg, vi: flat(viCell) };
}
function parseHead(cell) {
  var s = txt(cell);
  var ipa = '';
  var m = s.match(/\/[^\/\n]{1,80}\//);
  if (m) {
    ipa = m[0].trim();
    s = s.slice(0, m.index) + '\n' + s.slice(m.index + m[0].length);
  }
  var lines = [];
  var raw = s.split('\n');
  for (var i = 0; i < raw.length; i++) if (raw[i].trim()) lines.push(raw[i].trim());
  var first = lines.length ? lines[0] : '';
  var pos = '';
  var p = first.match(/\(([^()]{1,25})\)\s*$/);
  if (p && /^[a-zA-Z][a-zA-Z,. \/]{0,24}$/.test(p[1].trim())) {
    pos = p[1].trim();
    first = first.slice(0, p.index).trim();
  }
  var note = lines.slice(1).join(' ').replace(/^[\s\-=]+|[\s\-=]+$/g, '');
  return { word: flat(first), pos: pos, ipa: ipa, note: flat(note) };
}

function grid(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(1, 1, last, Math.max(4, sh.getLastColumn())).getDisplayValues();
}

function buildData() {
  var entries = [];

  function add(e) {
    var keep = [];
    for (var i = 0; i < e.senses.length; i++) {
      if (e.senses[i].def || e.senses[i].vi) keep.push(e.senses[i]);
    }
    e.senses = keep;
    if (e.word && keep.length) entries.push(e);
  }

  var rows, i, head, h, buf;

  // --- Vocabulary ---
  rows = grid('Vocabulary');
  buf = null;
  head = null;
  for (i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!txt(r[0]) && !txt(r[1]) && !txt(r[2])) continue;
    if (txt(r[0])) {
      if (buf) add(buf);
      buf = null;
      if (!txt(r[1]) && !txt(r[2]) && txt(r[0]).length <= 2) continue;   // letter divider
      h = parseHead(r[0]);
      buf = { type: 'word', word: h.word, pos: h.pos, ipa: h.ipa, note: h.note, senses: [] };
    }
    if (buf) buf.senses.push(senseOf(r[1], r[2]));
  }
  if (buf) add(buf);

  // --- Phrasal Verb: the verb cell is merged across its particle rows ---
  rows = grid('Phrasal Verb');
  var verb = '';
  buf = null;
  for (i = 1; i < rows.length; i++) {
    var pr = rows[i];
    var a = txt(pr[0]), b = txt(pr[1]);
    if (!a && !b && !txt(pr[2]) && !txt(pr[3])) continue;
    if (a || b) {
      if (buf) add(buf);
      if (a) verb = a;
      buf = { type: 'phrasal', word: flat(verb + ' ' + b), verb: flat(verb),
              particle: flat(b), pos: '', ipa: '', note: '', senses: [] };
    }
    if (buf) buf.senses.push(senseOf(pr[2], pr[3]));
  }
  if (buf) add(buf);

  // --- Idioms / Common ---
  var simple = [['Idioms', 'idiom'], ['Common', 'expression']];
  for (var s = 0; s < simple.length; s++) {
    rows = grid(simple[s][0]);
    buf = null;
    for (i = 1; i < rows.length; i++) {
      var sr = rows[i];
      if (!txt(sr[0]) && !txt(sr[1]) && !txt(sr[2])) continue;
      if (txt(sr[0])) {
        if (buf) add(buf);
        h = parseHead(sr[0]);
        buf = { type: simple[s][1], word: h.word, pos: h.pos, ipa: h.ipa, note: h.note, senses: [] };
      }
      if (buf) buf.senses.push(senseOf(sr[1], sr[2]));
    }
    if (buf) add(buf);
  }

  // --- Grammar: groups of easily mixed-up words ---
  rows = grid('Grammar');
  var group = '';
  for (i = 1; i < rows.length; i++) {
    var gr = rows[i];
    if (txt(gr[0])) group = txt(gr[0]).replace(/\.0$/, '');
    if (txt(gr[1])) {
      add({ type: 'compare', word: flat(gr[1]), group: group,
            pos: '', ipa: '', note: '', senses: [senseOf(gr[2], gr[3])] });
    }
  }

  for (i = 0; i < entries.length; i++) entries[i].id = 's' + i;
  return { entries: entries, readings: [] };
}
