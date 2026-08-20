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
var PROP_BOOK = 'SOTRATU_BOOK';     // the workbook the web page last pointed at
var PROP_READER = 'SOTRATU_READER'; // optional r.jina.ai key, for a private rate limit
var PROP_AI = 'SOTRATU_AI_KEY';     // optional Claude or OpenAI key, for the short Vietnamese
var PROP_AI_MODEL = 'SOTRATU_AI_MODEL';   // optional, to name a model of your own
var TARGET = 'docs/data.json';

/**
 * Which tab holds which group, how many columns come before the senses, and
 * how many columns the tab actually uses. `cols` matters: the sheet has blank
 * columns past the last one in use, and drawing borders into them would leave
 * rules hanging off the right-hand edge of the table.
 */
var TABS = {
  word:       { sheet: 'Vocabulary',   headCols: 1, cols: 3 },
  phrasal:    { sheet: 'Phrasal Verb', headCols: 2, cols: 4 },
  idiom:      { sheet: 'Idioms',       headCols: 1, cols: 3 },
  expression: { sheet: 'Common',       headCols: 1, cols: 3 },
  compare:    { sheet: 'Grammar',      headCols: 2, cols: 4 }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EngrowDict')
    .addItem('Publish to the web', 'syncToWeb')
    .addSeparator()
    .addItem('Set up GitHub repo', 'setupRepo')
    .addItem('Key for the Vietnamese column', 'setAiKey')
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

/**
 * Where the key for the Vietnamese column is put in. It stays in this script's
 * properties: the web page never sees it, so it cannot leak from a browser.
 */
function setAiKey() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var had = props.getProperty(PROP_AI);

  var r = ui.prompt('Key for the Vietnamese column',
    'Paste an API key. One beginning sk-ant- goes to Claude '
    + '(console.anthropic.com), one beginning sk- to OpenAI '
    + '(platform.openai.com) — both billed. Anything else is taken as a Google '
    + 'key and goes to Gemini (aistudio.google.com), which is free up to a '
    + 'daily limit.\n\n'
    + (had ? 'A key is already saved. Pasting another replaces it; leaving this '
          + 'empty removes it and the column falls back to Google Translate.'
          : 'Leave it empty to carry on without one.'),
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  var key = r.getResponseText().trim();
  if (!key) {
    props.deleteProperty(PROP_AI);
    props.deleteProperty(PROP_AI_MODEL);
    ui.alert('Removed', 'The Vietnamese column will be machine-translated again.',
      ui.ButtonSet.OK);
    return;
  }
  /* Length and a space are all that is worth testing. Which service the key
     belongs to is read off sk- / sk-ant- and everything else is Google's, so a
     key in a shape nobody has seen yet still goes through. */
  if (key.length < 20 || /\s/.test(key)) {
    ui.alert('That does not look like an API key',
      'An API key is one long unbroken string. A ChatGPT Plus or Gemini '
      + 'subscription is not one: the key is issued separately, at '
      + 'aistudio.google.com (free up to a daily limit), '
      + 'console.anthropic.com, or platform.openai.com.', ui.ButtonSet.OK);
    return;
  }

  props.setProperty(PROP_AI, key);

  var m = ui.prompt('Model',
    'Leave blank for the default (' + aiDefaultModel(key)
    + '). Fill it in only if that one is not available to you.',
    ui.ButtonSet.OK_CANCEL);
  if (m.getSelectedButton() === ui.Button.OK && m.getResponseText().trim()) {
    props.setProperty(PROP_AI_MODEL, m.getResponseText().trim());
  } else {
    props.deleteProperty(PROP_AI_MODEL);
  }

  ui.alert('Saved',
    'Auto Fill will ask ' + aiName(key) + ' for the Vietnamese from now on. The '
    + 'key stays in this script and never reaches the web page.',
    ui.ButtonSet.OK);
}

/* ------------------------------------------- the way back: web -> sheet */

/**
 * Show the link to paste into the web page's Settings.
 * Deploy → New deployment → Web app → "Anyone" must be done first.
 */
function showWriteLink() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(PROP_KEY);
  if (!key) {
    key = Utilities.getUuid();
    props.setProperty(PROP_KEY, key);
  }
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { url = ''; }

  SpreadsheetApp.getUi().showModalDialog(writeLinkDialog(url, key), 'EngrowDict');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A window rather than an alert, because the Web App link is far too long to
 * drag a cursor across without dropping a character: each value sits in a box
 * of its own with a Copy button beside it.
 */
function writeLinkDialog(url, key) {
  function field(label, value, id) {
    return '<label for="' + id + '">' + esc(label) + '</label>'
      + '<div class="row">'
      + '<input id="' + id + '" readonly value="' + esc(value) + '">'
      + '<button class="copy" data-for="' + id + '">Copy</button>'
      + '</div>';
  }

  var lead = url
    ? 'Paste these two into the web page Settings.'
    : 'Not deployed yet — Deploy → New deployment → Web app → '
      + 'Who has access: Anyone → Deploy, then open this menu item again for '
      + 'the link. The key below is ready either way.';

  var html = '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8"><style>'
    + 'body{font:13px/1.5 Roboto,Arial,sans-serif;color:#202124;margin:0;padding:4px 2px}'
    + 'p.lead{margin:0 0 16px}'
    + 'label{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;'
    + 'color:#5f6368;margin-bottom:5px}'
    + '.row{display:flex;gap:8px;margin-bottom:16px}'
    + 'input{flex:1;min-width:0;font:12px/1.4 "Roboto Mono",Consolas,monospace;'
    + 'padding:8px 10px;border:1px solid #dadce0;border-radius:4px;background:#f8f9fa;color:#202124}'
    + 'button.copy{flex:none;padding:8px 14px;border:0;border-radius:4px;background:#1a73e8;'
    + 'color:#fff;font-weight:500;cursor:pointer}'
    + 'button.copy:hover{background:#1765cc}'
    + 'button.copy.done{background:#188038}'
    + 'p.foot{margin:0;color:#5f6368;font-size:12px}'
    + '</style></head><body>'
    + '<p class="lead">' + esc(lead) + '</p>'
    + (url ? field('Web App link', url, 'a') : '')
    + field('Key', key, 'b')
    + '<p class="foot">Both stay in your own browser. Anyone without them cannot '
    + 'write to the sheet.</p>'
    + '<script>'
    + 'var bs=document.querySelectorAll("button.copy");'
    + 'for(var i=0;i<bs.length;i++){bs[i].addEventListener("click",function(){'
    + 'var b=this,f=document.getElementById(b.getAttribute("data-for"));'
    + 'f.focus();f.select();f.setSelectionRange(0,99999);'
    + 'var done=false;try{done=document.execCommand("copy")}catch(e){}'
    + 'if(done){say(b,"Copied")}'
    + 'else if(navigator.clipboard){navigator.clipboard.writeText(f.value)'
    + '.then(function(){say(b,"Copied")},function(){say(b,"Press Ctrl+C")})}'
    + 'else{say(b,"Press Ctrl+C")}})}'
    + 'function say(b,t){var old=b.textContent;b.textContent=t;b.className="copy done";'
    + 'setTimeout(function(){b.textContent=old;b.className="copy"},1400)}'
    + '<\/script></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setWidth(560)
    .setHeight(url ? 300 : 320);
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

    // The page sends the same Google Sheet link that sits in its Settings, so
    // moving the words to another workbook is one field, not another deployment.
    TARGET_BOOK = null;
    var id = bookIdFrom(body.sheet);
    if (id) {
      try {
        TARGET_BOOK = SpreadsheetApp.openById(id);
      } catch (err) {
        return out({ ok: false, error: 'That sheet link cannot be opened: ' + String(err) });
      }
      PropertiesService.getScriptProperties().setProperty(PROP_BOOK, id);
    }

    /* The ping carries back which service will write the Vietnamese, so the
       page can say whether a key is set without a word being looked up. The
       key itself is never sent: only its kind, and the model if one is named.

       And the id of this script, because a sheet can hold a copy of this file
       and a copy has properties of its own: a key put into the wrong one of
       them looks, from the page, exactly like a key put into none. */
    if (body.action === 'ping') {
      var pp = PropertiesService.getScriptProperties();
      var pkey = pp.getProperty(PROP_AI);
      return out({ ok: true, pong: true,
                   script: ScriptApp.getScriptId(),
                   ai: pkey ? aiName(pkey) : '',
                   aiModel: pkey ? (pp.getProperty(PROP_AI_MODEL) || aiDefaultModel(pkey)) : '' });
    }
    if (body.action === 'sync') return out(syncForWeb());
    if (body.action === 'draft') {
      return out(draftEntry(body.word, { eg: body.eg, vi: body.vi }));
    }
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

/**
 * Which workbook this run is about.
 *
 * A request over the web names its own, which is what lets the web page swap
 * sheets on its own. The menu inside a sheet always means the sheet it lives
 * in. A script with neither — one deployed on its own rather than bound to a
 * workbook — falls back to whichever sheet the page named last.
 */
var TARGET_BOOK = null;

function book() {
  if (TARGET_BOOK) return TARGET_BOOK;
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { active = null; }
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty(PROP_BOOK);
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('No sheet to work on. Open this from a spreadsheet, or put the '
    + 'Google Sheet link in the web page Settings.');
}

/** The id out of a Google Sheets link, or the id itself if that is what came. */
function bookIdFrom(text) {
  var s = txt(text);
  if (!s) return '';
  var m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // a bare id, not a stray sentence: real ones run to about forty characters
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

/** The tab's own column count, never wider than the sheet really is. */
function width(sh, tab) {
  var want = (tab && tab.cols) || 3;
  var have = sh.getMaxColumns ? sh.getMaxColumns() : want;
  return Math.max(1, Math.min(want, have));
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
var TEXT_INK = '#1f1f1f';    // and its near-black for everything under them
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
    .setForegroundColor(TEXT_INK).build();
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
      null, null, null, null, null, true, BORDER_INK, SpreadsheetApp.BorderStyle.DOTTED);
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
function insertRowFor(sh, sortKey, headCols, cols) {
  var last = sh.getLastRow();
  if (last < 2) return last + 1;
  var vals = sh.getRange(1, 1, last, cols).getDisplayValues();
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
  var sh = book().getSheetByName(tab.sheet);
  if (!sh) return { ok: false, error: 'No tab called ' + tab.sheet };

  var w = width(sh, tab);
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
      rowsOut.push([i === 0 ? headCell(entry) : '', def, txt(senses[i].vi)]);
    }
  }

  var sortKey = entry.type === 'phrasal'
    ? (txt(entry.verb) + ' ' + txt(entry.particle)).trim().toLowerCase()
    : txt(entry.word).toLowerCase();
  var at = entry.type === 'compare'
    ? sh.getLastRow() + 1                       // grouped, not alphabetical
    : insertRowFor(sh, sortKey, tab.headCols, w);


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

/* ------------------------------------- the draft: Cambridge -> the form */

/**
 * Cambridge answers a plain server-side request with 403 — the entry pages and
 * robots.txt alike — because Cloudflare wants a browser. r.jina.ai renders the
 * page and hands back Cambridge's own markup, so what lands in the form is
 * Cambridge's wording rather than a paraphrase of it.
 *
 * Two pages are read at once: the English dictionary for the part of speech,
 * the phonetics, the definitions and the examples, and the English-Vietnamese
 * one for the Vietnamese. A word missing from the smaller Vietnamese
 * dictionary simply comes back with that column empty.
 */
var READER = 'https://r.jina.ai/';
var CAMBRIDGE = 'https://dictionary.cambridge.org/dictionary/';

/** Cambridge slugs: lowercase, hyphenated, nothing else. */
function slugOf(word) {
  return txt(word).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Tags out, entities back, the spacing Cambridge's inline links leave behind
 *  tidied up. */
function cText(html) {
  var s = String(html || '').replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
       .replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+'/g, "'").replace(/\(\s+/g, '(')
       .replace(/\s+\)/g, ')');
  return s.replace(/:$/, '').trim();
}

function cFirst(re, html) {
  var m = String(html).match(re);
  return m ? cText(m[1]) : '';
}

/**
 * One Cambridge page. Only the first entry body is read: the page stacks the
 * Advanced Learner's, Academic Content and Business dictionaries one after
 * another, and taking all three would fill the form with the same sense
 * written three ways.
 */
function cParse(html, wantVi) {
  // the page stacks three dictionaries: keep the Advanced Learner's, which is
  // the one the sheet has always been written from, and its first entry only
  var dicts = String(html).split(/class="pr dictionary"/);
  var e = dicts.length > 1 ? dicts[1] : String(html);
  var parts = e.split(/class="[^"]*entry-body__el[^"]*"/);
  if (parts.length > 1) e = parts[1];
  var ipa = cFirst(/class="ipa dipa[^"]*"[^>]*>([\s\S]*?)<\/span>/, e);
  var out = {
    word: cFirst(/class="di-title"[^>]*>([\s\S]*?)<\/div>/, e)
       || cFirst(/class="hw dhw"[^>]*>([\s\S]*?)<\//, e),
    pos: cFirst(/class="pos dpos"[^>]*>([\s\S]*?)<\//, e),
    ipa: ipa ? '/' + ipa + '/' : '',
    senses: []
  };
  var blocks = e.split(/class="def-block ddef_block\s*"/);
  for (var i = 1; i < blocks.length; i++) {
    var d = cFirst(/class="def ddef_d db"[^>]*>([\s\S]*?)<\/div>/, blocks[i]);
    if (!d) continue;
    var eg = [];
    var re = /class="eg deg"[^>]*>([\s\S]*?)<\/span>/g, m;
    while ((m = re.exec(blocks[i])) && eg.length < 2) {
      var one = cText(m[1]);
      if (one) eg.push(one);
    }
    var sense = { def: d, eg: eg, vi: '' };
    if (wantVi) sense.vi = cFirst(/class="trans dtrans[^"]*"[^>]*>([\s\S]*?)<\/span>/, blocks[i]);
    out.senses.push(sense);
  }
  return out;
}

/**
 * The column holds a gloss, not a sentence: the leading "to ..." goes, and a
 * translation that runs on is cut at the first break rather than filling the
 * cell with a paragraph.
 */
function shortVi(text) {
  var t = txt(text).replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  if (t.length > 64) t = t.split(/[;:,]/)[0].trim();
  return t;
}

/** Cambridge writes the long form out; the sheet writes the short one. */
var POS_SHORT = {
  noun: 'n', verb: 'v', adjective: 'adj', adverb: 'adv', preposition: 'prep',
  conjunction: 'conj', pronoun: 'pron', determiner: 'det', exclamation: 'exclam',
  'modal verb': 'v', 'auxiliary verb': 'v'
};

/**
 * Merriam-Webster, the second choice. It answers a plain request, so no reader
 * is needed — but it prints its own respelling rather than IPA, and has no
 * Vietnamese at all, which is why Cambridge is asked first and this is only
 * reached for words Cambridge does not carry.
 */
function readMerriam(slug) {
  var r;
  try {
    r = UrlFetchApp.fetch('https://www.merriam-webster.com/dictionary/' + slug, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      muteHttpExceptions: true, followRedirects: true
    });
  } catch (err) {
    return null;
  }
  if (r.getResponseCode() !== 200) return null;

  var h = r.getContentText();
  var cut = h.indexOf('id="dictionary-entry-2"');   // the first entry only
  if (cut > -1) h = h.slice(0, cut);

  var out = {
    word: cFirst(/class="hw[^"]*"[^>]*>([\s\S]*?)<\//, h),
    pos: cFirst(/class="parts-of-speech[^"]*"[^>]*>([\s\S]*?)<\//, h),
    ipa: '',
    senses: []
  };
  var defs = [], m, re = /<span class="dtText">([\s\S]*?)<\/span>/g;
  while ((m = re.exec(h))) defs.push({ text: m[1], at: re.lastIndex });
  for (var i = 0; i < defs.length && out.senses.length < 5; i++) {
    var d = cText(defs[i].text).replace(/^:\s*/, '');
    if (!d) continue;
    var seg = h.slice(defs[i].at, i + 1 < defs.length ? defs[i + 1].at : h.length);
    var eg = [], em, ere = /<span class="ex-sent[^"]*">([\s\S]*?)<\/span>/g;
    while ((em = ere.exec(seg)) && eg.length < 2) {
      var one = cText(em[1]);
      if (one) eg.push(one);
    }
    out.senses.push({ def: d, eg: eg, vi: '' });
  }
  return out.senses.length ? out : null;
}

/**
 * The Vietnamese column holds a gloss a person would jot down — "yếu đi /
 * giảm đi", not a translation of the whole definition. The model is asked for
 * exactly that, all the senses of the word in one request.
 *
 * Three kinds of key work. Only OpenAI and Anthropic have promised their keys
 * a shape — sk- and sk-ant- respectively — so those two are recognised and
 * everything else is taken to be a Google key. Google has already changed
 * theirs once, from AIza… to AQ.…, and a prefix test that refused the new one
 * outright is the reason this reads the way it does now.
 *
 * Gemini is the one with a free tier, which is why it is worth its own branch
 * rather than a wrapper service. Set SOTRATU_AI_MODEL to name a particular
 * model; the defaults below are only defaults.
 */
function aiKind(key) {
  var k = String(key).trim();
  if (k.indexOf('sk-ant-') === 0) return 'claude';
  if (k.indexOf('sk-') === 0) return 'openai';
  return 'gemini';
}

function aiName(key) {
  var kind = aiKind(key);
  return kind === 'claude' ? 'Claude' : kind === 'gemini' ? 'Gemini' : 'OpenAI';
}

function aiDefaultModel(key) {
  var kind = aiKind(key);
  return kind === 'claude' ? 'claude-opus-5'
    : kind === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini';
}

function glossRules() {
  return 'You write the Vietnamese column of an English-Vietnamese vocabulary '
    + 'notebook. For each numbered English definition, give the gloss a Vietnamese '
    + 'learner would write down: the meaning itself, not a translation of the '
    + 'wording.\n\n'
    + 'Rules:\n'
    + '- One to five words. Never a sentence, never a clause with "hoặc" strung '
    + 'through it.\n'
    + '- Natural Vietnamese, the register of a dictionary margin.\n'
    + '- Two close readings may be joined with " / ", at most.\n'
    + '- A short parenthetical is welcome where the gloss would otherwise be '
    + 'vague: phía sau (tàu / thuyền), lợn đất (thú ăn kiến).\n'
    + '- Keep any part of speech the English has: a verb glosses as a verb.\n'
    + '- No quotation marks, no "nghĩa là", no explanation.\n\n'
    + 'Examples:\n'
    + 'to become less strong -> yếu đi / giảm đi\n'
    + 'at the back of or behind a ship or boat -> ở phía đuôi tàu\n'
    + 'very careful and with great attention to every detail -> tỉ mỉ\n'
    + 'a soft murmuring or rustling sound -> tiếng xào xạc\n'
    + 'to take care of or be in charge of someone or something -> trông nom\n\n'
    + 'Answer with a JSON array of strings, one per definition, in order. '
    + 'Nothing else.';
}

/** The list of definitions, numbered, as the model is shown them. */
function glossAsk(word, pos, defs) {
  var lines = [];
  for (var i = 0; i < defs.length; i++) lines.push((i + 1) + '. ' + defs[i]);
  return 'Word: ' + word + (pos ? ' (' + pos + ')' : '') + '\n\n' + lines.join('\n');
}

/** Whatever came back, pulled out of the wrapper and cut to a gloss. */
function glossList(text, howMany) {
  var m = String(text).match(/\[[\s\S]*\]/);
  if (!m) throw new Error('The model did not answer with a list');
  var list = JSON.parse(m[0]);
  var out = [];
  for (var i = 0; i < list.length && i < howMany; i++) out.push(shortVi(String(list[i])));
  return out;
}

function glossesFromAI(word, pos, defs, key, model) {
  var kind = aiKind(key);
  var url, opts;

  if (kind === 'claude') {
    opts = {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01'
      },
      payload: JSON.stringify({
        model: model || 'claude-opus-5',
        max_tokens: 4000,
        output_config: { effort: 'low' },
        fallbacks: 'default',
        system: glossRules(),
        messages: [{ role: 'user', content: glossAsk(word, pos, defs) }]
      })
    };
    url = 'https://api.anthropic.com/v1/messages';
  } else if (kind === 'gemini') {
    /* The key rides in a header rather than the query string, so it stays out
       of anything that logs URLs. Asking for JSON back means the answer is the
       list itself and not a list wrapped in a sentence about the list. */
    opts = {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({
        system_instruction: { parts: [{ text: glossRules() }] },
        contents: [{ role: 'user', parts: [{ text: glossAsk(word, pos, defs) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
      })
    };
    url = 'https://generativelanguage.googleapis.com/v1beta/models/'
      + (model || 'gemini-2.5-flash') + ':generateContent';
  } else {
    opts = {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: glossRules() },
          { role: 'user', content: glossAsk(word, pos, defs) }
        ]
      })
    };
    url = 'https://api.openai.com/v1/chat/completions';
  }

  var r = UrlFetchApp.fetch(url, opts);
  var who = aiName(key);
  if (r.getResponseCode() !== 200) {
    throw new Error(who + ' answered ' + r.getResponseCode() + ' '
      + String(r.getContentText()).slice(0, 120));
  }

  var body = JSON.parse(r.getContentText());
  var text = '';
  if (kind === 'claude') {
    if (body.stop_reason === 'refusal') throw new Error('Claude declined this word');
    for (var j = 0; j < (body.content || []).length; j++) {
      if (body.content[j].type === 'text') text += body.content[j].text;
    }
  } else if (kind === 'gemini') {
    var cand = (body.candidates || [])[0];
    var blocked = body.promptFeedback && body.promptFeedback.blockReason;
    if (!cand) {
      throw new Error(blocked ? 'Gemini would not answer for this word ('
        + blocked + ')' : 'Gemini sent nothing back');
    }
    var parts = (cand.content && cand.content.parts) || [];
    for (var g = 0; g < parts.length; g++) {
      if (parts[g].text) text += parts[g].text;
    }
    if (!text) {
      throw new Error('Gemini stopped at ' + (cand.finishReason || 'nothing at all'));
    }
  } else {
    var choice = (body.choices || [])[0];
    text = choice && choice.message ? String(choice.message.content || '') : '';
  }
  return glossList(text, defs.length);
}

/**
 * What the Fill button asks for. Nothing is written anywhere: the entry comes
 * back for the form to show, and it is the person at the keyboard who decides
 * whether it is worth keeping.
 *
 * Cambridge first, always. Merriam-Webster only for the words Cambridge has no
 * entry for, and it is said out loud in the form when that happens.
 */
function draftEntry(term, opts) {
  var slug = slugOf(term);
  if (!slug) return { ok: false, error: 'No word to look up' };

  // The form's two boxes. An old caller that sends neither gets the lot, the
  // way Fill worked before they existed.
  var wantEg = !opts || opts.eg !== false;
  var wantVi = !opts || opts.vi !== false;

  var props = PropertiesService.getScriptProperties();
  var headers = { 'x-return-format': 'html' };
  var rkey = props.getProperty(PROP_READER);
  if (rkey) headers.Authorization = 'Bearer ' + rkey;
  var one = function (path) {
    return { url: READER + CAMBRIDGE + path + '/' + slug, headers: headers,
             muteHttpExceptions: true, followRedirects: true };
  };

  var asks = [one('english')];
  if (wantVi) asks.push(one('english-vietnamese'));   // not asked for, not read
  var res = null;
  try {
    res = UrlFetchApp.fetchAll(asks);
  } catch (err) {
    res = null;
  }

  var en = null, source = 'Cambridge', viSenses = null, why = '';
  if (res && res[0].getResponseCode() === 200) {
    var parsed = cParse(res[0].getContentText(), false);
    if (parsed.senses.length) {
      en = parsed;
      if (wantVi && res[1] && res[1].getResponseCode() === 200) {
        viSenses = cParse(res[1].getContentText(), true).senses;
      }
    }
  } else if (res) {
    why = 'Cambridge answered ' + res[0].getResponseCode();
  }

  if (!en) {
    en = readMerriam(slug);
    source = 'Merriam-Webster';
  }
  if (!en) {
    return { ok: false, error: 'No entry for "' + slug + '" in Cambridge'
      + (why ? ' (' + why + ')' : '') + ' or Merriam-Webster.' };
  }

  if (viSenses) {
    for (var i = 0; i < en.senses.length && i < viSenses.length; i++) {
      en.senses[i].vi = viSenses[i].vi;
    }
  }

  var pos = en.pos.toLowerCase();
  var word = en.word.replace(/\s+(someone|something|sb|sth)(\/(someone|something|sb|sth))*$/i, '')
    .trim() || txt(term);
  var entry = {
    type: 'word', word: word, verb: '', particle: '',
    pos: POS_SHORT[pos] || (pos === 'phrasal verb' || pos === 'idiom' ? '' : en.pos),
    ipa: en.ipa, note: '', senses: en.senses.slice(0, 5)
  };
  if (pos === 'phrasal verb') {
    var bits = word.split(/\s+/);
    entry.type = 'phrasal';
    entry.verb = bits.shift();
    entry.particle = bits.join(' ');
    entry.ipa = '';                       // the sheet keeps phonetics off these
  } else if (pos === 'idiom') {
    entry.type = 'idiom';
  }

  if (!wantEg) {
    for (var x = 0; x < entry.senses.length; x++) entry.senses[x].eg = [];
  }
  if (!wantVi) {
    // No Vietnamese asked for: nothing to gloss, nothing to translate, and no
    // model called about it either.
    for (var y = 0; y < entry.senses.length; y++) entry.senses[y].vi = '';
    return { ok: true, entry: entry, source: source, by: '',
             glossed: 0, translated: 0, warning: '' };
  }

  // The gloss: Claude where there is a key for it, Google Translate where
  // there is not, and both only for the senses Cambridge left empty.
  var gaps = [];
  for (var g = 0; g < entry.senses.length; g++) {
    if (!entry.senses[g].vi) gaps.push(g);
  }
  var glossed = 0, machine = 0, warning = '', writer = '';
  var aikey = props.getProperty(PROP_AI);
  /* Said out loud, because "machine-translated" on its own reads like the
     model was asked and did that: there was no model to ask. */
  if (gaps.length && !aikey) {
    warning = 'No AI key is set in the sheet, so that is Google Translate: '
      + 'EngrowDict menu, Key for the Vietnamese column.';
  }
  if (gaps.length && aikey) {
    try {
      var defs = [];
      for (var d = 0; d < gaps.length; d++) defs.push(entry.senses[gaps[d]].def);
      var got = glossesFromAI(entry.word, entry.pos, defs, aikey,
        props.getProperty(PROP_AI_MODEL));
      for (var k = 0; k < gaps.length; k++) {
        if (got[k]) { entry.senses[gaps[k]].vi = got[k]; glossed++; }
      }
      if (glossed) writer = aiName(aikey);
    } catch (err) {
      warning = String(err && err.message ? err.message : err);
    }
  }
  for (var t = 0; t < entry.senses.length; t++) {
    if (entry.senses[t].vi) continue;
    try {
      // The definition, and only the definition. Translating the headword on its
      // own is shorter but throws the sense away: abaft came back as "sau",
      // which is not what abaft means. A clause you can trim beats a word that
      // is wrong.
      var mt = shortVi(LanguageApp.translate(entry.senses[t].def, 'en', 'vi'));
      if (mt) { entry.senses[t].vi = mt; machine++; }
    } catch (err2) { /* a sense with no Vietnamese is better than no draft */ }
  }

  return { ok: true, entry: entry, source: source, by: writer,
           glossed: glossed, translated: machine, warning: warning };
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
  var sh = book().getSheetByName(name);
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
