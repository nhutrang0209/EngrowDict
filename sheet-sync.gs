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
    /* Putting the key in from the page, which is the one place that already
       knows which script it is talking to. Finding that script by hand is the
       step everybody gets wrong: a sheet may hold a copy of this file, and a
       key set in the copy does nothing. Nothing reads the key back out — the
       ping answers with its kind, never with the key. */
    if (body.action === 'setai') {
      var props2 = PropertiesService.getScriptProperties();
      var newKey = String(body.aiKey === undefined ? '' : body.aiKey).trim();
      if (!newKey) {
        props2.deleteProperty(PROP_AI);
        props2.deleteProperty(PROP_AI_MODEL);
        return out({ ok: true, ai: '', aiModel: '' });
      }
      if (newKey.length < 20 || /\s/.test(newKey)) {
        return out({ ok: false,
                     error: 'That does not look like an API key: it should be '
                       + 'one long unbroken string' });
      }
      props2.setProperty(PROP_AI, newKey);
      var newModel = String(body.aiModel === undefined ? '' : body.aiModel).trim();
      if (newModel) props2.setProperty(PROP_AI_MODEL, newModel);
      else props2.deleteProperty(PROP_AI_MODEL);
      return out({ ok: true, ai: aiName(newKey),
                   aiModel: newModel || aiDefaultModel(newKey) });
    }
    if (body.action === 'sync') return out(syncForWeb());
    if (body.action === 'draft') {
      return out(draftEntry(body.word, { eg: body.eg, vi: body.vi }));
    }
    if (body.action === 'editpassage') {
      var eplock = LockService.getScriptLock();
      eplock.waitLock(20000);
      try {
        return out(editPassage(body.was, body.entry));
      } finally {
        eplock.releaseLock();
      }
    }
    if (body.action === 'delpassage') {
      var dplock = LockService.getScriptLock();
      dplock.waitLock(20000);
      try {
        return out(deletePassage(body.was));
      } finally {
        dplock.releaseLock();
      }
    }
    if (body.action === 'orderpassages') {
      var olock = LockService.getScriptLock();
      olock.waitLock(20000);
      try {
        return out(orderPassages(body.titles));
      } finally {
        olock.releaseLock();
      }
    }
    if (body.action === 'aitranslate') return out(translatePassage(body.paras));
    if (body.action === 'passage') {
      var plock = LockService.getScriptLock();
      plock.waitLock(20000);
      try {
        return out(addPassage(body.entry));
      } finally {
        plock.releaseLock();
      }
    }
    if (body.action === 'edit') {
      var elock = LockService.getScriptLock();
      elock.waitLock(20000);
      try {
        return out(editEntry(body.was, body.entry));
      } finally {
        elock.releaseLock();
      }
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
    /* No link on a phrasal verb: the verb sits in one cell and the particle in
       the next, so a link on the verb alone points at something the cell does
       not say — and Cambridge's page for the pair is a guess at the slug more
       often than it is a page. The styling stays; only the link goes. */
    var verb = txt(entry.verb || entry.word);
    sh.getRange(at, 1).setRichTextValue(headRichText(verb, verb, ''));
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

/**
 * Correcting a word that is already in the sheet. The rows it stands on come
 * out and the new ones go in, which is also what moves a word to another tab
 * when its group is changed and what keeps the a→z order when it is renamed.
 *
 * `was` is the entry as the page found it: enough to know which rows to take
 * out, no more.
 */
function editEntry(was, entry) {
  if (!was || !entry) return { ok: false, error: 'Nothing to correct' };
  var tab = TABS[was.type] || TABS.word;
  var sh = book().getSheetByName(tab.sheet);
  if (!sh) return { ok: false, error: 'No tab called ' + tab.sheet };

  var found = findEntryRows(sh, tab, was);
  if (!found) {
    return { ok: false, error: 'Could not find "' + txt(was.word)
      + '" in ' + tab.sheet + '. It may have been changed in the sheet since.' };
  }
  sh.deleteRows(found.row, found.rows);

  var res = insertEntry(entry);
  if (!res.ok) {
    return { ok: false, error: 'The old rows came out but the new ones would '
      + 'not go in: ' + res.error };
  }
  res.removed = found.rows;
  return res;
}

/** The rows one entry stands on: its head row, and the senses under it. */
function findEntryRows(sh, tab, was) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var w = width(sh, tab);
  var vals = sh.getRange(1, 1, last, w).getDisplayValues();
  var want = was.type === 'phrasal'
    ? (txt(was.verb || was.word) + ' ' + txt(was.particle)).trim().toLowerCase()
    : txt(was.word).toLowerCase();

  for (var i = 1; i < vals.length; i++) {
    var head = txt(vals[i][0]);
    // the Grammar tab numbers its groups in the first column and names the
    // word in the second, so that is where the word is looked for
    var name = was.type === 'compare' ? txt(vals[i][1]) : head;
    if (!head && !(was.type === 'compare' && name)) continue;
    if (head.length <= 2 && !txt(vals[i][1]) && !txt(vals[i][2])) continue;  // letter divider
    var k = was.type === 'compare'
      ? name.toLowerCase()
      : head.split('\n')[0].replace(/\s*\([^()]*\)\s*$/, '').toLowerCase().trim();
    if (was.type === 'phrasal') k = (k + ' ' + txt(vals[i][1])).trim().toLowerCase();
    if (k !== want) continue;

    var n = 1;                        // the senses under it carry no head
    for (var j = i + 1; j < vals.length; j++) {
      if (txt(vals[j][0]) || (was.type === 'compare' && txt(vals[j][1]))) break;
      n++;
    }
    return { row: i + 1, rows: n };
  }
  return null;
}

/* ------------------------------------------ a passage, in Vietnamese, by AI */

/**
 * The reader's own translation of a passage. Not the gloss column and not a
 * machine translator: a person reading a passage in a second language wants
 * the sentence they are looking at said properly in the first one.
 *
 * The paragraphs go over numbered and come back numbered, so the two columns
 * stay level with each other. In batches, because a model handed 900 words and
 * asked for 900 back is a model that starts summarising near the end.
 */
var AI_PARAS_AT_ONCE = 4;

function passageRules() {
  return 'You translate English passages into Vietnamese for a Vietnamese '
    + 'learner of English who is reading the English alongside your translation.'
    + '\n\nRules:\n'
    + '- Translate the meaning exactly. Nothing added, nothing left out, '
    + 'nothing summarised.\n'
    + '- Natural written Vietnamese: what a Vietnamese writer would have '
    + 'written, not English words in Vietnamese order.\n'
    + '- One item per numbered paragraph, in the same order, whole. Never join '
    + 'two paragraphs and never split one.\n'
    + '- Keep names, titles, numbers, dates and quotations as they are; put '
    + 'quotation marks back where the English has them.\n'
    + '- Keep the register: an academic paragraph stays academic, a quoted '
    + 'speaker keeps their voice.\n'
    + '- A term of art that a learner would meet in Vietnamese as the English '
    + 'may keep the English in brackets after the Vietnamese.\n'
    + '- No notes, no explanations, no romanised pronunciation.\n\n'
    + 'Answer with a JSON array of strings, one per paragraph, in order. '
    + 'Nothing else.';
}

/** Whatever came back, pulled out of the wrapper, one string a paragraph. */
/* ---- reading a list out of a model ---------------------------------------

   Models put a stray backslash in now and then — a "\\u" with nothing behind
   it, or an escape JSON has no word for — and JSON.parse says "Bad Unicode
   escape in JSON at position 6412", which is what a reader saw where a
   translated passage should have been.

   So the obvious damage is mended before parsing, and an answer that still
   will not parse is read as lines. A translation with one paragraph out of
   shape beats an error message where the passage was. */
function looseJson(text) {
  return String(text)
    .replace(/\\u(?![0-9a-fA-F]{4})/g, "u")      // an escape that escapes nothing
    .replace(/\\(?![\\"\/bfnrtu])/g, "");      // and any other JSON has no word for
}

/** The lines of an answer that was meant to be a list and was not quite. */
function listLines(text) {
  var raw = String(text).split(/\n+/), out = [], i;
  for (i = 0; i < raw.length; i++) {
    var one = String(raw[i])
      .replace(/^\s*[\[\],"]+\s*$/, "")          // a bracket or a quote on its own
      .replace(/^\s*\d+[.)]\s*/, "")             // 1. or 1)
      .replace(/^\s*[-*\u2022]\s*/, "")           // a bullet
      .replace(/^"|",?$/g, "")
      .trim();
    if (one) out.push(one);
  }
  return out;
}

/** Whatever the model said, as a list of strings. */
function listFrom(text) {
  var m = String(text).match(/\[[\s\S]*\]/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (err) { /* mended below */ }
    try { return JSON.parse(looseJson(m[0])); } catch (err2) { /* read as lines */ }
  }
  return listLines(text);
}

function paraList(text, howMany) {
  var list = listFrom(text);
  if (!list.length) throw new Error('The model did not answer with a list');
  var out = [];
  for (var i = 0; i < list.length && i < howMany; i++) out.push(flat(list[i]));
  while (out.length < howMany) out.push('');
  return out;
}

/** One ask, whichever service the key belongs to. Returns what it said. */
function askAI(system, user, key, model) {
  var kind = aiKind(key), url, opts;

  if (kind === 'gemini') {
    var names = model ? [model] : GEMINI_MODELS;
    /* Translating is not a puzzle: the flash models think first by default and
       the thinking is most of the wait, so it is turned off. A model that has
       never heard of the setting answers 400, and that one is asked again
       without it rather than being given up on. */
    var body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.3, responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 }
      }
    };
    var plain = {
      system_instruction: body.system_instruction,
      contents: body.contents,
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
    };
    var send = function (name, what) {
      return UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + name
        + ':generateContent', {
          method: 'post', contentType: 'application/json',
          muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
          payload: JSON.stringify(what)
        });
    };

    var trouble = '';
    for (var n = 0; n < names.length; n++) {
      var g = send(names[n], body);
      if (g.getResponseCode() === 400) g = send(names[n], plain);
      if (g.getResponseCode() === 200) return geminiText(g.getContentText());
      trouble = 'Gemini answered ' + g.getResponseCode() + ' for ' + names[n] + ': '
        + String(g.getContentText()).replace(/\s+/g, ' ').slice(0, 120);
      if (g.getResponseCode() !== 404 && g.getResponseCode() !== 429
        && g.getResponseCode() !== 503) break;
    }
    throw new Error(trouble || 'Gemini sent nothing back');
  }

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
        max_tokens: 8000,
        output_config: { effort: 'low' },
        fallbacks: 'default',
        system: system,
        messages: [{ role: 'user', content: user }]
      })
    };
    url = 'https://api.anthropic.com/v1/messages';
  } else {
    opts = {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + key },
      payload: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    };
    url = 'https://api.openai.com/v1/chat/completions';
  }

  var r = UrlFetchApp.fetch(url, opts);
  if (r.getResponseCode() !== 200) {
    throw new Error(aiName(key) + ' answered ' + r.getResponseCode() + ' '
      + String(r.getContentText()).replace(/\s+/g, ' ').slice(0, 120));
  }
  var body = JSON.parse(r.getContentText());
  var text = '';
  if (kind === 'claude') {
    if (body.stop_reason === 'refusal') throw new Error('Claude declined this passage');
    for (var j = 0; j < (body.content || []).length; j++) {
      if (body.content[j].type === 'text') text += body.content[j].text;
    }
  } else {
    var choice = (body.choices || [])[0];
    text = choice && choice.message ? String(choice.message.content || '') : '';
  }
  return text;
}

function translatePassage(paras) {
  var lines = [];
  for (var i = 0; i < (paras || []).length; i++) {
    var one = flat(paras[i]);
    if (one) lines.push(one);
  }
  if (!lines.length) return { ok: false, error: 'There is nothing to translate' };

  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(PROP_AI);
  if (!key) {
    return { ok: false, error: 'No key for the Vietnamese column is set. '
      + 'EngrowDict -> Key for the Vietnamese column, in the sheet.' };
  }
  var model = props.getProperty(PROP_AI_MODEL);

  var out = [];
  for (var at = 0; at < lines.length; at += AI_PARAS_AT_ONCE) {
    var batch = lines.slice(at, at + AI_PARAS_AT_ONCE);
    var numbered = [];
    for (var b = 0; b < batch.length; b++) numbered.push((b + 1) + '. ' + batch[b]);
    var said = askAI(passageRules(), numbered.join('\n\n'), key, model);
    var got = paraList(said, batch.length);
    for (var g = 0; g < got.length; g++) out.push(got[g]);
  }
  return { ok: true, paras: out, by: aiName(key) };
}

/* ------------------------------------------------------ a passage of theirs */

/** Two rows, the way the tab is already written: the numbered title, and the
 *  body under it with a line to a paragraph. Which is what parse_sheet.py
 *  reads and what the sync publishes. */
function addPassage(p) {
  var sh = book().getSheetByName('Reading Passage');
  if (!sh) return { ok: false, error: 'No tab called Reading Passage' };
  var title = flat(p && p.title);
  var paras = (p && p.paras) || [];
  var lines = [];
  for (var i = 0; i < paras.length; i++) {
    var one = flat(paras[i]);
    if (one) lines.push(one);
  }
  if (!title) return { ok: false, error: 'The passage has no title' };
  if (!lines.length) return { ok: false, error: 'The passage has no text' };

  var next = nextPassage(sh);
  var at = sh.getLastRow() + 1;
  sh.getRange(at, 1, 2, 2).setValues([[next, title], ['', lines.join('\n')]]);
  return { ok: true, index: next, row: at, paragraphs: lines.length };
}

/** The rows one passage stands on: the numbered title, and the body under it. */
function findPassage(sh, title) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var vals = sh.getRange(1, 1, last, 2).getDisplayValues();
  var want = flat(title).toLowerCase();
  for (var i = 1; i < vals.length; i++) {
    if (!txt(vals[i][0])) continue;                      // a body row
    if (flat(vals[i][1]).toLowerCase() !== want) continue;
    var body = (i + 1 < vals.length && !txt(vals[i + 1][0])) ? i + 2 : 0;
    return { row: i + 1, bodyRow: body, index: txt(vals[i][0]) };
  }
  return null;
}

/** Putting a passage right: the title cell and the body cell, in place. */
function editPassage(was, p) {
  var sh = book().getSheetByName('Reading Passage');
  if (!sh) return { ok: false, error: 'No tab called Reading Passage' };
  var title = flat(p && p.title);
  var lines = [];
  var paras = (p && p.paras) || [];
  for (var i = 0; i < paras.length; i++) {
    var one = flat(paras[i]);
    if (one) lines.push(one);
  }
  if (!title) return { ok: false, error: 'The passage has no title' };
  if (!lines.length) return { ok: false, error: 'The passage has no text' };

  var at = findPassage(sh, was && was.title);
  if (!at) {
    return { ok: false, error: 'Could not find "' + flat(was && was.title)
      + '" among the passages. It may have been changed in the sheet since.' };
  }
  sh.getRange(at.row, 2).setValue(title);
  if (at.bodyRow) {
    sh.getRange(at.bodyRow, 2).setValue(lines.join('\n'));
  } else {
    sh.insertRowsAfter(at.row, 1);
    sh.getRange(at.row + 1, 1, 1, 2).setValues([['', lines.join('\n')]]);
  }
  return { ok: true, index: at.index, row: at.row, paragraphs: lines.length };
}

/** And taking one out: both its rows, the body first so the other stays put. */
function deletePassage(was) {
  var sh = book().getSheetByName('Reading Passage');
  if (!sh) return { ok: false, error: 'No tab called Reading Passage' };
  var at = findPassage(sh, was && was.title);
  if (!at) {
    return { ok: false, error: 'Could not find "' + flat(was && was.title)
      + '" among the passages.' };
  }
  if (at.bodyRow) sh.deleteRows(at.bodyRow, 1);
  sh.deleteRows(at.row, 1);
  return { ok: true, removed: at.bodyRow ? 2 : 1 };
}

/**
 * The order the passages read in, written back into the tab. The page sends
 * the titles in the order it wants them; the rows are gathered, put in that
 * order and written down again, numbered from one. A title the page does not
 * name keeps its place at the end rather than being lost — the sheet may have
 * grown a passage since the page last read it.
 */
function orderPassages(titles) {
  var sh = book().getSheetByName('Reading Passage');
  if (!sh) return { ok: false, error: 'No tab called Reading Passage' };
  var last = sh.getLastRow();
  if (last < 2) return { ok: false, error: 'There are no passages to put in order' };

  var vals = sh.getRange(1, 1, last, 2).getDisplayValues();
  var found = [], byTitle = {}, i;
  for (i = 1; i < vals.length; i++) {
    if (!txt(vals[i][0])) continue;                       // a body row
    var body = (i + 1 < vals.length && !txt(vals[i + 1][0])) ? txt(vals[i + 1][1]) : '';
    var one = { title: flat(vals[i][1]), body: body };
    found.push(one);
    byTitle[one.title.toLowerCase()] = one;
  }
  if (!found.length) return { ok: false, error: 'There are no passages to put in order' };

  var out = [], seen = {};
  (titles || []).forEach(function (t) {
    var k = flat(t).toLowerCase();
    if (byTitle[k] && !seen[k]) { out.push(byTitle[k]); seen[k] = 1; }
  });
  found.forEach(function (one) {
    var k = one.title.toLowerCase();
    if (!seen[k]) { out.push(one); seen[k] = 1; }
  });

  var rows = [];
  for (i = 0; i < out.length; i++) {
    rows.push([String(i + 1), out[i].title]);
    rows.push(['', out[i].body]);
  }
  var need = 1 + rows.length;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  sh.getRange(2, 1, last - 1, 2).clearContent();
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  return { ok: true, passages: out.length };
}

/** The number after the largest already in the first column. */
function nextPassage(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var vals = sh.getRange(1, 1, last, 1).getDisplayValues();
  var max = 0;
  for (var i = 1; i < vals.length; i++) {
    var n = parseInt(txt(vals[i][0]).replace('.0', ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
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
  var payload = { entries: data.entries, readings: data.readings };
  if (!repo || !token) {
    return { ok: true, published: false, entries: data.entries.length, payload: payload,
             error: 'No GitHub repo set up yet — use EngrowDict → Set up GitHub repo.' };
  }
  // A sheet with no Reading Passage tab must not take the passages off the
  // site: what is published stays published unless the sheet has its own.
  if (!payload.readings.length) payload.readings = publishedReadings(repo, token, branch);
  /* A stamp on what is published, and the same stamp in the answer. Counting
     entries was the old way of telling the new copy from the old one, and it
     cannot see a passage that was rewritten or a word that was put right: the
     count is the same and the file is not. */
  payload.at = new Date().toISOString();
  var json = JSON.stringify(payload);
  var sha = shaOf(repo, token, branch, TARGET);
  var res = ghPut(repo, token, branch, TARGET, json, sha,
    'Sync from Google Sheet: ' + data.entries.length + ' entries');
  if (res.code === 200 || res.code === 201) {
    return { ok: true, published: true, entries: data.entries.length, at: payload.at };
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
    at: r.at || null,
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
/* The page stacks three dictionaries — keep the Advanced Learner's, which is
   the one the sheet has always been written from — and inside it one entry per
   part of speech: rough is an adjective, a noun, a verb and an adverb, in four
   blocks. Reading the first alone lost three quarters of the word. */
function cParseAll(html, wantVi) {
  var dicts = String(html).split(/class="pr dictionary"/);
  var e = dicts.length > 1 ? dicts[1] : String(html);
  var parts = e.split(/class="[^"]*entry-body__el[^"]*"/);
  var out = [], title = '', i;
  for (i = 1; i < parts.length; i++) {
    var block = cParse(parts[i], wantVi);
    if (!block.senses.length) continue;
    title = title || block.word;
    if (!block.word) block.word = title;   // only the first block is titled
    out.push(block);
  }
  if (!out.length) {
    var whole = cParse(e, wantVi);
    if (whole.senses.length) out.push(whole);
  }
  return out;
}

/** One entry-body: its headword, part of speech, phonetics and senses. */
function cParse(e, wantVi) {
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

/* ---- lining the two dictionaries up -------------------------------------

   The English-Vietnamese Cambridge is a different book from the English one:
   fewer senses, in its own order. Laid side by side by position, "rough" got
   the gloss "dữ dội; (thời tiết) xấu" against the definition about wine that
   tastes cheap — the third sense of one book against the third of another.

   Both books print the English definition, so that is what they are matched
   on: the same words, or near enough. A sense with nothing near enough is left
   empty on purpose, for the model or for Google Translate, either of which
   beats a gloss belonging to another sense. */
function defWords(text) {
  var words = String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/);
  var out = {}, n = 0, i;
  var SKIP = { a: 1, an: 1, the: 1, of: 1, or: 1, to: 1, and: 1, in: 1, that: 1,
               is: 1, for: 1, with: 1, on: 1, by: 1, as: 1, be: 1, it: 1 };
  for (i = 0; i < words.length; i++) {
    if (words[i] && !SKIP[words[i]] && !out[words[i]]) { out[words[i]] = 1; n++; }
  }
  return { set: out, n: n };
}

/** How much two definitions have in common, 0 to 1. */
function defLikeness(a, b) {
  var x = defWords(a), y = defWords(b);
  if (!x.n || !y.n) return 0;
  var shared = 0, w;
  for (w in x.set) if (y.set[w]) shared++;
  return shared / (x.n + y.n - shared);
}

/** Each Vietnamese sense goes to one English one, to its closest, or nowhere. */
function pairVi(enSenses, viSenses) {
  var taken = {};
  for (var i = 0; i < enSenses.length; i++) {
    var best = -1, score = 0;
    for (var j = 0; j < viSenses.length; j++) {
      if (taken[j] || !viSenses[j].vi) continue;
      var how = defLikeness(enSenses[i].def, viSenses[j].def);
      if (how > score) { score = how; best = j; }
    }
    // half the words in common is a low bar for a match and a high one for a
    // coincidence: below it, the sense is better off with no Vietnamese at all
    if (best > -1 && score >= 0.5) {
      enSenses[i].vi = viSenses[best].vi;
      taken[best] = 1;
    }
  }
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
/* A word with seventeen senses in Cambridge is unusual and worth having whole;
   the cap is only there so that one runaway entry cannot fill a form, a sheet
   and a model request all at once. */
var MAX_SENSES = 20;

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
    : kind === 'gemini' ? GEMINI_MODELS[0] : 'gpt-4o-mini';
}

/* Google retires a model name and then answers 404 to everyone still asking
   for it — gemini-2.5-flash went that way — and a preview under load answers
   503. Either is worth trying the next name for rather than losing the gloss,
   so the default is a list and the first that answers wins. A name set in
   SOTRATU_AI_MODEL is asked on its own: it was chosen on purpose.

   gemini-flash-latest always exists but thinks for twenty seconds; the numbered
   one answers in two, so it goes first. */
var GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3-flash-preview'];

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
    + '- A definition beginning "used to describe" or "used to say" is talking '
    + 'about the word, not naming a thing: gloss what the word means in that '
    + 'use, with the thing it is said of in the parenthetical.\n'
    + '- No quotation marks, no "nghĩa là", no explanation.\n\n'
    + 'Examples:\n'
    + 'to become less strong -> yếu đi / giảm đi\n'
    + 'at the back of or behind a ship or boat -> ở phía đuôi tàu\n'
    + 'very careful and with great attention to every detail -> tỉ mỉ\n'
    + 'a soft murmuring or rustling sound -> tiếng xào xạc\n'
    + 'to take care of or be in charge of someone or something -> trông nom\n'
    + 'used to describe an alcoholic drink, especially wine, that tastes cheap '
    + 'and often strong -> (rượu) rẻ tiền, gắt\n\n'
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
  var list = listFrom(text);
  if (!list.length) throw new Error('The model did not answer with a list');
  var out = [];
  for (var i = 0; i < list.length && i < howMany; i++) out.push(shortVi(String(list[i])));
  return out;
}

function glossesFromGemini(word, pos, defs, key, names) {
  var opts = {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({
      system_instruction: { parts: [{ text: glossRules() }] },
      contents: [{ role: 'user', parts: [{ text: glossAsk(word, pos, defs) }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
    })
  };

  var trouble = '';
  for (var n = 0; n < names.length; n++) {
    var r = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + names[n]
      + ':generateContent', opts);
    var code = r.getResponseCode();
    if (code === 200) return glossList(geminiText(r.getContentText()), defs.length);
    trouble = 'Gemini answered ' + code + ' for ' + names[n] + ': '
      + String(r.getContentText()).replace(/\s+/g, ' ').slice(0, 120);
    // a name that is gone, busy or rate-limited is worth the next name; a
    // refused key or a malformed request is not
    if (code !== 404 && code !== 429 && code !== 503) break;
  }
  throw new Error(trouble || 'Gemini sent nothing back');
}

function geminiText(raw) {
  var body = JSON.parse(raw);
  var cand = (body.candidates || [])[0];
  if (!cand) {
    var blocked = body.promptFeedback && body.promptFeedback.blockReason;
    throw new Error(blocked
      ? 'Gemini would not answer for this word (' + blocked + ')'
      : 'Gemini sent nothing back');
  }
  var parts = (cand.content && cand.content.parts) || [];
  var text = '';
  for (var g = 0; g < parts.length; g++) {
    if (parts[g].text) text += parts[g].text;
  }
  if (!text) {
    throw new Error('Gemini stopped at ' + (cand.finishReason || 'nothing at all'));
  }
  return text;
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
    return glossesFromGemini(word, pos, defs, key,
      model ? [model] : GEMINI_MODELS);
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

  /* With a model to ask, the English-Vietnamese page is not fetched at all.
     It is the smaller book, it keeps its own order — the reason the two had to
     be matched on their English in the first place — and a model reading the
     definition gives the same voice to every sense of a word rather than a
     human gloss for four of them and something else for the other thirteen.
     One page instead of two is also half the wait.

     Without a key it is still the best Vietnamese there is, so it is still
     read: Google Translate on a definition is the last resort, not the first. */
  var haveModel = !!props.getProperty(PROP_AI);
  var askCambridgeVi = wantVi && !haveModel;
  var asks = [one('english')];
  if (askCambridgeVi) asks.push(one('english-vietnamese'));
  var res = null;
  try {
    res = UrlFetchApp.fetchAll(asks);
  } catch (err) {
    res = null;
  }

  var blocks = [], source = 'Cambridge', viSenses = null, why = '';
  if (res && res[0].getResponseCode() === 200) {
    blocks = cParseAll(res[0].getContentText(), false);
    if (blocks.length && askCambridgeVi && res[1] && res[1].getResponseCode() === 200) {
      // the Vietnamese book is stacked the same way; its senses are matched on
      // their English rather than on which block they came from
      var viBlocks = cParseAll(res[1].getContentText(), true);
      viSenses = [];
      for (var v = 0; v < viBlocks.length; v++) {
        viSenses = viSenses.concat(viBlocks[v].senses);
      }
    }
  } else if (res) {
    why = 'Cambridge answered ' + res[0].getResponseCode();
  }

  var en = blocks[0] || null;
  if (!en) {
    en = readMerriam(slug);
    source = 'Merriam-Webster';
    blocks = en ? [en] : [];
  }
  if (!en) {
    return { ok: false, error: 'No entry for "' + slug + '" in Cambridge'
      + (why ? ' (' + why + ')' : '') + ' or Merriam-Webster.' };
  }

  /* Cambridge stacks one entry body per part of speech — rough is an
     adjective, a verb, a noun and an adverb, eighteen senses between them —
     and the word is still one word. They come back as one entry: the parts of
     speech listed the way the sheet lists them, "adj, v, n, adv", and every
     sense under it in the order the page gives them. */
  var all = [], posList = [], seenPos = {};
  for (var b = 0; b < blocks.length; b++) {
    if (viSenses) pairVi(blocks[b].senses, viSenses);
    var short = shortPos(blocks[b].pos);
    if (short && !seenPos[short]) { seenPos[short] = 1; posList.push(short); }
    all = all.concat(blocks[b].senses);
  }
  var dropped = Math.max(0, all.length - MAX_SENSES);
  all = all.slice(0, MAX_SENSES);

  var entry = entryFrom(blocks[0], term);
  entry.pos = posList.join(', ');
  entry.senses = all;

  if (!wantEg) {
    for (var x = 0; x < all.length; x++) all[x].eg = [];
  }
  if (!wantVi) {
    // No Vietnamese asked for: nothing to gloss, nothing to translate, and no
    // model called about it either.
    for (var y = 0; y < all.length; y++) all[y].vi = '';
    return { ok: true, entry: entry, source: source,
             by: '', glossed: 0, translated: 0, warning: '', dropped: dropped };
  }

  // The gloss: the model where there is a key for it, Google Translate where
  // there is not, and both only for the senses Cambridge left empty.
  var gaps = [];
  for (var g = 0; g < all.length; g++) {
    if (!all[g].vi) gaps.push(g);
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
      for (var d = 0; d < gaps.length; d++) defs.push(all[gaps[d]].def);
      var got = glossesFromAI(entry.word, entry.pos, defs, aikey,
        props.getProperty(PROP_AI_MODEL));
      for (var k = 0; k < gaps.length; k++) {
        if (got[k]) { all[gaps[k]].vi = got[k]; glossed++; }
      }
      if (glossed) writer = aiName(aikey);
    } catch (err) {
      warning = String(err && err.message ? err.message : err);
    }
  }
  for (var t = 0; t < all.length; t++) {
    if (all[t].vi) continue;
    try {
      // The definition, and only the definition. Translating the headword on its
      // own is shorter but throws the sense away: abaft came back as "sau",
      // which is not what abaft means. A clause you can trim beats a word that
      // is wrong.
      var mt = shortVi(LanguageApp.translate(all[t].def, 'en', 'vi'));
      if (mt) { all[t].vi = mt; machine++; }
    } catch (err2) { /* a sense with no Vietnamese is better than no draft */ }
  }

  return { ok: true, entry: entry, source: source,
           by: writer, glossed: glossed, translated: machine,
           warning: warning, dropped: dropped };
}

/** Cambridge writes "adjective"; the sheet writes "adj". */
function shortPos(pos) {
  var p = String(pos || '').toLowerCase();
  return POS_SHORT[p] || (p === 'phrasal verb' || p === 'idiom' ? '' : pos);
}

/** One parsed block as the sheet would hold it. */
function entryFrom(block, term) {
  var pos = block.pos.toLowerCase();
  var word = block.word
    .replace(/\s+(someone|something|sb|sth)(\/(someone|something|sb|sth))*$/i, '')
    .trim() || txt(term);
  var entry = {
    type: 'word', word: word, verb: '', particle: '',
    pos: shortPos(block.pos),
    ipa: block.ipa, note: '', senses: block.senses.slice(0, MAX_SENSES)
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
  return entry;
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
  return { entries: entries, readings: readingsFrom() };
}

/* ---------------------------------------------- the passages, as read here */

/* Two rows to a piece: the numbered row carries the title, the row under it
   the whole body, one paragraph to a line. Mirrors parse_sheet.py, which is
   what the site is built from when it is built from a terminal instead. */
function readingsFrom() {
  var rows = grid('Reading Passage');
  var out = [], pend = null;
  for (var i = 1; i < rows.length; i++) {
    var body = txt(rows[i][1]);
    if (!body) continue;
    if (txt(rows[i][0])) {
      pend = { index: txt(rows[i][0]).replace('.0', ''), title: flat(body) };
    } else if (pend) {
      var parts = body.split('\n'), paras = [];
      for (var p = 0; p < parts.length; p++) {
        var one = flat(parts[p]);
        if (one) paras.push(one);
      }
      pend.paras = labelParas(paras);
      out.push(pend);
      pend = null;
    }
  }
  return out;
}

/* Some passages are the IELTS sort, with paragraphs lettered A, B, C… The
   letter is glued to the text and sometimes doubled ("A A In 1977"). It only
   counts as a label when the letters actually run in order down the passage —
   otherwise a paragraph opening with the article "A" would lose it. */
function labelParas(paras) {
  var i, out = [], runs = 0;
  for (i = 0; i < paras.length && i < 26; i++) {
    if (leads(paras[i], letterAt(i))) runs++;
  }
  if (paras.length < 3 || runs < Math.max(3, Math.floor(paras.length * 0.6))) {
    for (i = 0; i < paras.length; i++) out.push({ text: paras[i] });
    return out;
  }
  for (i = 0; i < paras.length; i++) {
    var L = i < 26 ? letterAt(i) : '';
    // "A A In 1977" carries its letter twice; both come off
    var rest = L ? stripLetter(stripLetter(paras[i], L), L) : '';
    if (rest) out.push({ mark: L, text: rest });
    else out.push({ text: paras[i] });
  }
  return out;
}

/* The letter is a label only where it stands on its own, never where the
   paragraph simply opens with the word "A". */
function leads(p, L) {
  return p.charAt(0) === L && (p.length === 1 || p.charAt(1) === ' ');
}

function stripLetter(p, L) {
  return leads(p, L) ? txt(p.slice(1)) : p;
}

function letterAt(i) { return String.fromCharCode(65 + i); }

/* What the site is already serving. Read only when the sheet has no passages
   of its own to publish: a sync is about the words, and it has no business
   taking the passages off the site on its way past. */
function publishedReadings(repo, token, branch) {
  try {
    var url = 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + TARGET;
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: token ? { Authorization: 'token ' + token } : {}
    });
    if (res.getResponseCode() !== 200) return [];
    var got = JSON.parse(res.getContentText());
    return (got && got.readings) || [];
  } catch (err) {
    return [];                       // no answer is not a reason to lose them
  }
}

