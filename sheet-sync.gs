/**
 * Sổ Tra Từ — đồng bộ Google Sheet lên web bằng một nút bấm.
 *
 * Dán toàn bộ tệp này vào Apps Script của chính file sheet
 * (Tiện ích mở rộng → Apps Script), lưu, rồi tải lại sheet.
 * Menu "Sổ Tra Từ" sẽ hiện ra cạnh menu Trợ giúp.
 *
 * Lần đầu: Sổ Tra Từ → Cài đặt kho GitHub, dán repo và token.
 * Sau đó:  Sổ Tra Từ → Đồng bộ lên web.
 *
 * Script đọc cả sheet, dựng lại data.json y hệt parse_sheet.py, rồi ghi đè
 * docs/data.json trong repo. GitHub Pages tự dựng lại sau vài chục giây —
 * không cần chạy build gì trên máy.
 *
 * Bài đọc KHÔNG được đẩy lên: đó là nguyên văn bài của TED-Ed và BBC.
 */

var PROP_REPO = 'SOTRATU_REPO';     // "nhutrang0209/EngrowDict"
var PROP_TOKEN = 'SOTRATU_TOKEN';   // fine-grained PAT, quyền Contents: Read and write
var PROP_BRANCH = 'SOTRATU_BRANCH';
var PROP_KEY = 'SOTRATU_KEY';       // mã khoá cho đường ghi từ web về sheet
var TARGET = 'docs/data.json';

/** Tab nào ứng với nhóm nào, và ô đầu dòng có mấy cột trước phần nghĩa. */
var TABS = {
  word:       { sheet: 'Vocabulary',   headCols: 1 },
  phrasal:    { sheet: 'Phrasal Verb', headCols: 2 },
  idiom:      { sheet: 'Idioms',       headCols: 1 },
  expression: { sheet: 'Common',       headCols: 1 },
  compare:    { sheet: 'Grammar',      headCols: 2 }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Sổ Tra Từ')
    .addItem('Đồng bộ lên web', 'syncToWeb')
    .addSeparator()
    .addItem('Cài đặt kho GitHub', 'setupRepo')
    .addItem('Link cho web ghi từ vào sheet', 'showWriteLink')
    .addItem('Xem thử số liệu (không đẩy)', 'previewCounts')
    .addToUi();
}

/* ---------------------------------------------------------------- cài đặt */

function setupRepo() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var r = ui.prompt('Kho GitHub',
    'Dạng chu-tai-khoan/ten-repo, ví dụ nhutrang0209/EngrowDict:',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var repo = r.getResponseText().trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    ui.alert('Chưa đúng dạng. Cần chu-tai-khoan/ten-repo.');
    return;
  }

  var t = ui.prompt('Token GitHub',
    'Dán fine-grained personal access token có quyền Contents: Read and write '
    + 'trên đúng repo đó.\n\nTạo tại github.com/settings/personal-access-tokens',
    ui.ButtonSet.OK_CANCEL);
  if (t.getSelectedButton() !== ui.Button.OK) return;
  var token = t.getResponseText().trim();
  if (!token) { ui.alert('Chưa nhập token.'); return; }

  var b = ui.prompt('Nhánh', 'Để trống là dùng main:', ui.ButtonSet.OK_CANCEL);
  var branch = b.getSelectedButton() === ui.Button.OK && b.getResponseText().trim()
    ? b.getResponseText().trim() : 'main';

  props.setProperty(PROP_REPO, repo);
  props.setProperty(PROP_TOKEN, token);
  props.setProperty(PROP_BRANCH, branch);

  var check = ghGet(repo, token, branch, 'docs');
  if (check.code === 200 || check.code === 404) {
    ui.alert('Xong', 'Đã lưu. Giờ dùng Sổ Tra Từ → Đồng bộ lên web.', ui.ButtonSet.OK);
  } else {
    ui.alert('Chưa vào được kho',
      'GitHub trả về ' + check.code + '.\n\n' + String(check.body).slice(0, 300)
      + '\n\nKiểm tra lại tên repo, quyền của token, và token đã được cấp cho repo này chưa.',
      ui.ButtonSet.OK);
  }
}

function previewCounts() {
  var d = buildData();
  var n = {};
  for (var i = 0; i < d.entries.length; i++) n[d.entries[i].type] = (n[d.entries[i].type] || 0) + 1;
  var senses = 0;
  for (i = 0; i < d.entries.length; i++) senses += d.entries[i].senses.length;
  SpreadsheetApp.getUi().alert('Đọc được từ sheet',
    d.entries.length + ' mục · ' + senses + ' nghĩa\n\n'
    + 'Từ: ' + (n.word || 0) + '\nPhrasal verb: ' + (n.phrasal || 0)
    + '\nThành ngữ: ' + (n.idiom || 0) + '\nCụm từ: ' + (n.expression || 0)
    + '\nDễ nhầm: ' + (n.compare || 0)
    + '\n\nBài đọc không được đẩy lên bản công khai.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* -------------------------------------------- đường ghi ngược: web -> sheet */

/**
 * Hiện link để dán vào nút Settings của trang web.
 * Phải Triển khai (Deploy) → Ứng dụng web → Ai cũng truy cập được, trước đã.
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
    ui.alert('Chưa triển khai',
      'Vào Triển khai → Bản triển khai mới → chọn loại "Ứng dụng web", '
      + 'mục "Người có quyền truy cập" chọn "Bất kỳ ai", rồi Triển khai.\n\n'
      + 'Xong quay lại bấm menu này lần nữa để lấy link.\n\nMã khoá của bạn:\n' + key,
      ui.ButtonSet.OK);
    return;
  }
  ui.alert('Dán hai dòng này vào nút Settings của trang web',
    'Link Web App:\n' + url + '\n\nMã khoá:\n' + key
    + '\n\nHai thứ này chỉ lưu trong trình duyệt của bạn. Ai không có chúng thì '
    + 'không ghi được vào sheet.',
    ui.ButtonSet.OK);
}

/** Cho phép mở link bằng trình duyệt để thử xem đã triển khai đúng chưa. */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'so-tra-tu', version: 1 }))
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
    if (!key || body.key !== key) return out({ ok: false, error: 'Sai mã khoá' });
    if (body.action === 'ping') return out({ ok: true, pong: true });
    if (body.action !== 'add') return out({ ok: false, error: 'Không hiểu yêu cầu' });

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

/** Số cột thật sự dùng tới; các tab đều 3–4 cột. */
function width(sh) {
  return Math.max(1, Math.min(4, sh.getMaxColumns ? sh.getMaxColumns() : 4));
}

/** Nhóm "dễ nhầm" mới thì đánh số tiếp theo số nhóm lớn nhất đang có. */
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

/** Ghép ô đầu dòng theo đúng cách sheet đang viết: từ (từ loại) \n /phiên âm/ */
function headCell(entry) {
  var s = txt(entry.word);
  if (txt(entry.pos)) s += ' (' + txt(entry.pos) + ')';
  if (txt(entry.ipa)) s += '\n' + txt(entry.ipa);
  if (txt(entry.note)) s += '\n' + txt(entry.note);
  return s;
}

/** Dòng đầu tiên nên chèn trước, để giữ thứ tự a→z của tab. */
function insertRowFor(sh, sortKey, headCols) {
  var last = sh.getLastRow();
  if (last < 2) return last + 1;
  var vals = sh.getRange(1, 1, last, width(sh)).getDisplayValues();
  var target = 0;
  for (var i = 1; i < vals.length; i++) {
    var a = txt(vals[i][0]);
    if (!a) continue;                                   // dòng nghĩa tiếp theo
    var isDivider = a.length <= 2 && !txt(vals[i][1]) && !txt(vals[i][2]);
    if (isDivider) continue;                            // mốc chữ cái
    var k = a.split('\n')[0].replace(/\s*\([^()]*\)\s*$/, '').toLowerCase().trim();
    if (headCols > 1) k = (k + ' ' + txt(vals[i][1])).trim().toLowerCase();
    if (k > sortKey) { target = i + 1; break; }          // getRange dùng chỉ số từ 1
  }
  return target || last + 1;
}

function insertEntry(entry) {
  var tab = TABS[entry.type] || TABS.word;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab.sheet);
  if (!sh) return { ok: false, error: 'Không thấy tab ' + tab.sheet };

  var senses = entry.senses || [];
  if (!senses.length) return { ok: false, error: 'Từ chưa có nghĩa nào' };

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
    ? sh.getLastRow() + 1                       // tab này xếp theo nhóm, không theo a→z
    : insertRowFor(sh, sortKey, tab.headCols);

  var w = width(sh);
  if (at <= sh.getLastRow()) sh.insertRowsBefore(at, rowsOut.length);
  var trimmed = [];
  for (i = 0; i < rowsOut.length; i++) trimmed.push(rowsOut[i].slice(0, w));
  sh.getRange(at, 1, trimmed.length, w).setValues(trimmed);
  return { ok: true, sheet: tab.sheet, row: at, rows: trimmed.length };
}

/* ------------------------------------------------------------------ đồng bộ */

function syncToWeb() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var repo = props.getProperty(PROP_REPO);
  var token = props.getProperty(PROP_TOKEN);
  var branch = props.getProperty(PROP_BRANCH) || 'main';
  if (!repo || !token) { setupRepo(); return; }

  SpreadsheetApp.getActiveSpreadsheet().toast('Đang đọc sheet…', 'Sổ Tra Từ', 30);
  var data = buildData();
  if (!data.entries.length) {
    ui.alert('Không đọc được mục nào từ sheet. Kiểm tra lại tên các tab.');
    return;
  }
  var json = JSON.stringify({ entries: data.entries, readings: [] });

  SpreadsheetApp.getActiveSpreadsheet().toast('Đang đẩy lên GitHub…', 'Sổ Tra Từ', 60);
  var sha = shaOf(repo, token, branch, TARGET);
  var res = ghPut(repo, token, branch, TARGET, json, sha,
    'Đồng bộ từ Google Sheet: ' + data.entries.length + ' mục');

  if (res.code === 200 || res.code === 201) {
    ui.alert('Đã đồng bộ',
      data.entries.length + ' mục đã lên web.\n\n'
      + 'GitHub Pages dựng lại sau khoảng 30–60 giây. Nếu mở trang mà chưa thấy đổi, '
      + 'tải lại bằng Ctrl+F5.',
      ui.ButtonSet.OK);
  } else {
    ui.alert('Đẩy không thành công',
      'GitHub trả về ' + res.code + '.\n\n' + String(res.body).slice(0, 400),
      ui.ButtonSet.OK);
  }
}

/* ------------------------------------------------------------- gọi GitHub */

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

/** Lấy sha của tệp đích qua danh sách thư mục, để khỏi tải về cả tệp 4 MB. */
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

/* ------------------------------------------------- bóc sheet (giống parse_sheet.py) */

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
      if (!txt(r[1]) && !txt(r[2]) && txt(r[0]).length <= 2) continue;   // mốc chữ cái
      h = parseHead(r[0]);
      buf = { type: 'word', word: h.word, pos: h.pos, ipa: h.ipa, note: h.note, senses: [] };
    }
    if (buf) buf.senses.push(senseOf(r[1], r[2]));
  }
  if (buf) add(buf);

  // --- Phrasal Verb: ô động từ gộp qua nhiều dòng giới từ ---
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

  // --- Grammar: nhóm từ dễ nhầm ---
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
