/* Sổ Tra Từ — tra cứu & bổ sung từ vựng Anh–Việt.

   Hai chế độ, quyết định lúc build:
   - "artifact": dữ liệu nhúng sẵn trong trang; mỗi lần thêm/xoá từ, trang tự
     publish lại chính nó nên từ mới lưu lên máy chủ.
   - "static":  vỏ trang nhẹ, tải data.json cùng thư mục; từ mới lưu trong
     localStorage của từng người xem.

   Danh sách kết quả dựng theo kiểu cuộn ảo — 11 nghìn mục thì không thể đổ
   hết vào DOM. */
(function () {
  "use strict";

  var FONT_URL = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;450;500;600&display=swap";
  var BACKUP_KEY = "so-tra-tu:added:v1";
  var SETTINGS_KEY = "so-tra-tu:settings:v1";
  var ROW_H = 58;          // phải khớp .hit trong app.css
  var MARK_H = 26;         // phải khớp .letter-mark
  var OVERSCAN = 6;

  var KINDS = {
    word:       { label: "Từ",           filter: "Từ" },
    phrasal:    { label: "Phrasal verb", filter: "Phrasal" },
    idiom:      { label: "Thành ngữ",    filter: "Thành ngữ" },
    expression: { label: "Cụm từ",       filter: "Cụm từ" },
    compare:    { label: "Dễ nhầm",      filter: "Dễ nhầm" }
  };
  var KIND_ORDER = ["word", "phrasal", "idiom", "expression", "compare"];
  var ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

  /* ---- trạng thái ------------------------------------------------------ */
  var MODE = JSON.parse(document.getElementById("mode").textContent);
  var BASE = null;
  var ADDED = JSON.parse(document.getElementById("added").textContent);
  var READINGS = [];
  var entries = [];
  var byId = {};
  var canWrite = true;
  var view = "vocab";        // vocab | read
  var kindFilter = "all";
  var query = "";
  var rows = [];             // {kind:"mark"|"hit", ...} — nguồn của cuộn ảo
  var hits = [];             // chỉ các mục, để đi tới/lui
  var counts = {};
  var selectedId = null;
  var selectedRead = null;

  /* ---- tiện ích -------------------------------------------------------- */
  function norm(s) {
    return (s || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d");
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(n) { return n.toLocaleString("vi-VN"); }
  function glossOf(e) {
    var s = e.senses && e.senses[0];
    return s ? (s.vi || s.def || "") : "";
  }
  function senseCount(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].senses) n += list[i].senses.length;
    }
    return n;
  }
  function kindOf(e) { return (KINDS[e.type] || KINDS.word).label; }

  function indexEntry(e) {
    var parts = [e.word, e.pos, e.ipa, e.note];
    for (var i = 0; i < e.senses.length; i++) {
      var s = e.senses[i];
      parts.push(s.def, s.vi);
      if (s.eg) parts.push(s.eg.join(" "));
    }
    e._w = norm(e.word);
    e._all = norm(parts.join("  "));
    return e;
  }

  function rebuild() {
    entries = BASE.entries.concat(ADDED);
    byId = {};
    counts = { all: entries.length, mine: 0 };
    KIND_ORDER.forEach(function (k) { counts[k] = 0; });
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e._w) indexEntry(e);
      byId[e.id] = e;
      counts[e.type] = (counts[e.type] || 0) + 1;
      if (e.mine) counts.mine++;
    }
    entries.sort(function (a, b) { return a._w < b._w ? -1 : a._w > b._w ? 1 : 0; });
    for (var j = 0; j < READINGS.length; j++) byId[READINGS[j].id] = READINGS[j];
  }

  /* ---- sao lưu cục bộ --------------------------------------------------- */
  function readBackup() {
    try {
      var raw = localStorage.getItem(BACKUP_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) { return []; }
  }
  function writeBackup(list) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(list)); } catch (err) { /* đầy bộ nhớ */ }
  }

  /* ---- cài đặt: link sheet + link ghi ngược ----------------------------- */
  /* Chỉ nằm trong trình duyệt này. Ai mở trang mà không có link thì không
     ghi được vào sheet — đó là điều giữ cho sheet của bạn không ai sửa được. */
  var settings = { sheetUrl: "", webApp: "", key: "" };

  function readSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        settings.sheetUrl = s.sheetUrl || "";
        settings.webApp = s.webApp || "";
        settings.key = s.key || "";
      }
    } catch (err) { /* bỏ qua */ }
  }
  function writeSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (err) { /* bỏ qua */ }
  }
  function canWriteSheet() {
    return MODE === "static" && !!settings.webApp && !!settings.key;
  }

  /* Apps Script chấp nhận POST không kèm header lạ, nên không phát sinh
     preflight; gửi chuỗi thường là đủ. */
  function callSheet(payload) {
    payload.key = settings.key;
    return fetch(settings.webApp, {
      method: "POST",
      body: JSON.stringify(payload),
      redirect: "follow"
    }).then(function (r) {
      return r.json();
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || "Sheet từ chối yêu cầu");
      return res;
    });
  }

  /* ---- tự publish lại (chỉ chế độ artifact) ----------------------------- */
  function renderPage(added) {
    var css = document.getElementById("css").textContent;
    var mode = document.getElementById("mode").textContent;
    var base = document.getElementById("base").textContent;
    var js = document.getElementById("appjs").textContent;
    var S = "<" + "script";
    var E = "<" + "/" + "script>";
    return '<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + "<title>Sổ Tra Từ</title>\n"
      + '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
      + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
      + '<link rel="stylesheet" href="' + FONT_URL.replace(/&/g, "&amp;") + '">\n'
      + '<style id="css">' + css + "<" + "/style>\n</head>\n<body>\n"
      + '<div id="app"></div>\n'
      + S + ' type="application/json" id="mode">' + mode + E + "\n"
      + S + ' type="application/json" id="base">' + base + E + "\n"
      + S + ' type="application/json" id="added">'
      + JSON.stringify(added).replace(/</g, "\\u003c") + E + "\n"
      + S + ' type="text/plain" id="appjs">' + js + E + "\n"
      + S + ">new Function(document.getElementById('appjs').textContent)()" + E + "\n"
      + "</body>\n</html>";
  }

  function goReadOnly() {
    if (!canWrite) return;
    canWrite = false;
    var ns = document.querySelectorAll("[data-write]");
    for (var i = 0; i < ns.length; i++) ns[i].hidden = true;
    banner("Bản này chỉ xem được — từ bạn thêm chỉ nằm trên máy này.", null, null);
  }

  function persist(nextAdded) {
    writeBackup(nextAdded);
    if (MODE === "static") return Promise.resolve({ ok: true, reload: false });
    if (!window.claude || !window.claude.use) {
      goReadOnly();
      return Promise.resolve({ ok: false, msg: "Đã lưu trên máy này. Mở trang từ claude.ai để lưu vĩnh viễn." });
    }
    return window.claude.use("artifact").then(function (art) {
      if (!art) {
        goReadOnly();
        return { ok: false, msg: "Đã lưu trên máy này. Bản đang mở không ghi được lên máy chủ." };
      }
      return art.publish(renderPage(nextAdded)).then(function () {
        return { ok: true, reload: true };
      }, function (err) {
        var code = err && err.code;
        if (code === "conflict") {
          return { ok: false, msg: "Có người vừa lưu trước. Trang sẽ tải lại — từ của bạn đã giữ trong bản sao lưu, bấm Đồng bộ sau khi tải xong." };
        }
        if (code === "not_writer" || code === "not_granted" || code === "not_declared"
          || code === "capability_disabled" || code === "capability_removed" || code === "consent_required") {
          goReadOnly();
          return { ok: false, msg: "Bạn không có quyền ghi vào trang này. Từ đã lưu trên máy bạn." };
        }
        if (code === "rate_limited") return { ok: false, msg: "Lưu quá dồn dập. Đợi một chút rồi bấm Đồng bộ." };
        if (code === "too_large") return { ok: false, msg: "Trang đã quá lớn để lưu thêm lên máy chủ." };
        return { ok: false, msg: "Không lưu được lên máy chủ. Từ đã giữ trong bản sao lưu trên máy này." };
      });
    });
  }

  /* ---- tìm kiếm --------------------------------------------------------- */
  function pool() {
    if (view === "read") return READINGS;
    if (kindFilter === "all") return entries;
    return entries.filter(function (e) {
      return kindFilter === "mine" ? !!e.mine : e.type === kindFilter;
    });
  }

  function search() {
    var q = norm(query.trim());
    var src = pool();
    if (!q) { hits = src; return; }
    var buckets = [[], [], [], [], []];
    for (var i = 0; i < src.length; i++) {
      var e = src[i], w = e._w, s = -1;
      if (w === q) s = 0;
      else if (w.lastIndexOf(q, 0) === 0) s = 1;
      else if (w.indexOf(" " + q) > -1) s = 2;
      else if (w.indexOf(q) > -1) s = 3;
      else if (e._all.indexOf(q) > -1) s = 4;
      if (s > -1) buckets[s].push(e);
    }
    hits = buckets[0].concat(buckets[1], buckets[2], buckets[3], buckets[4]);
  }

  /* Dựng danh sách dòng cho khung cuộn: khi không tìm gì thì chèn thêm dòng
     đánh dấu chữ cái, cho cảm giác lật từ điển. */
  function layout() {
    rows = [];
    var showMarks = !query.trim() && view !== "read";
    var letter = null;
    for (var i = 0; i < hits.length; i++) {
      var e = hits[i];
      if (showMarks) {
        var L = (e._w.charAt(0) || "#").toUpperCase();
        if (L !== letter) { letter = L; rows.push({ mark: L }); }
      }
      rows.push({ e: e, i: i });
    }
    var y = 0;
    for (var j = 0; j < rows.length; j++) {
      rows[j].y = y;
      y += rows[j].mark ? MARK_H : ROW_H;
    }
    return y;
  }

  function markUp(node, text, q) {
    if (!q) { node.textContent = text; return; }
    var i = norm(text).indexOf(q);
    if (i < 0) { node.textContent = text; return; }
    node.appendChild(document.createTextNode(text.slice(0, i)));
    node.appendChild(el("mark", null, text.slice(i, i + q.length)));
    node.appendChild(document.createTextNode(text.slice(i + q.length)));
  }

  /* ---- cuộn ảo ---------------------------------------------------------- */
  var scrollBox, spacer, windowBox, drawnFrom = -1, drawnTo = -1;

  function findRow(y) {                       // nhị phân theo toạ độ
    var lo = 0, hi = rows.length - 1, best = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (rows[mid].y <= y) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return best;
  }

  function paint(force) {
    if (!rows.length) { windowBox.textContent = ""; drawnFrom = drawnTo = -1; return; }
    var top = scrollBox.scrollTop;
    var h = scrollBox.clientHeight;
    var from = Math.max(0, findRow(top) - OVERSCAN);
    var to = Math.min(rows.length - 1, findRow(top + h) + OVERSCAN);
    if (!force && from === drawnFrom && to === drawnTo) return;
    drawnFrom = from; drawnTo = to;
    var q = norm(query.trim());
    var frag = document.createDocumentFragment();
    for (var i = from; i <= to; i++) {
      frag.appendChild(rows[i].mark ? markRow(rows[i]) : hitRow(rows[i], q));
    }
    windowBox.style.transform = "translateY(" + rows[from].y + "px)";
    windowBox.textContent = "";
    windowBox.appendChild(frag);
  }

  function markRow(r) { return el("div", "letter-mark", r.mark); }

  function hitRow(r, q) {
    var e = r.e;
    var b = el("button", "hit");
    b.type = "button";
    b.dataset.i = r.i;
    b.setAttribute("aria-current", e.id === selectedId ? "true" : "false");
    if (e.paras) {                                  // dòng của một bài đọc
      var tline = el("div", "top-line");
      var thw = el("span", "hw");
      markUp(thw, e.title, q);
      tline.appendChild(thw);
      tline.appendChild(el("span", "senses-n", "bài " + e.index));
      b.appendChild(tline);
      var tg = el("span", "gloss");
      markUp(tg, e.paras[0], q);
      b.appendChild(tg);
      b.addEventListener("click", function () { select(e.id); showDetail(); });
      return b;
    }
    var line = el("div", "top-line");
    var hw = el("span", "hw");
    markUp(hw, e.word, q);
    line.appendChild(hw);
    if (e.pos) line.appendChild(el("span", "pos", e.pos));
    if (e.mine) line.appendChild(el("span", "mine-dot"));
    if (e.senses.length > 1) line.appendChild(el("span", "senses-n", e.senses.length + " nghĩa"));
    b.appendChild(line);
    var g = el("span", "gloss");
    markUp(g, glossOf(e), q);
    b.appendChild(g);
    b.addEventListener("click", function () { select(e.id); showDetail(); });
    return b;
  }

  function scrollToIndex(i) {
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].i === i) {
        var y = rows[j].y;
        var top = scrollBox.scrollTop, h = scrollBox.clientHeight;
        if (y < top + MARK_H) scrollBox.scrollTop = Math.max(0, y - MARK_H);
        else if (y + ROW_H > top + h) scrollBox.scrollTop = y + ROW_H - h;
        return;
      }
    }
  }

  /* ---- chọn mục --------------------------------------------------------- */
  function cursorIndex() {
    for (var i = 0; i < hits.length; i++) if (hits[i].id === selectedId) return i;
    return -1;
  }

  function select(id, keepScroll) {
    selectedId = id;
    if (view === "read") selectedRead = byId[id] || null;
    var ns = windowBox.querySelectorAll(".hit");
    for (var i = 0; i < ns.length; i++) {
      var e = hits[Number(ns[i].dataset.i)];
      ns[i].setAttribute("aria-current", String(!!e && e.id === selectedId));
    }
    if (!keepScroll) {
      var at = cursorIndex();
      if (at > -1) scrollToIndex(at);
    }
    drawDetail();
    syncAlpha();
  }

  function step(d) {
    if (!hits.length) return;
    var at = cursorIndex();
    var next = at < 0 ? (d > 0 ? 0 : hits.length - 1) : at + d;
    if (next < 0 || next >= hits.length) return;
    select(hits[next].id);
    paint(true);
  }

  function showDetail() {
    document.body.dataset.view = "detail";
    document.querySelector(".detail").scrollTop = 0;
  }

  /* ---- dải A–Z ---------------------------------------------------------- */
  function jumpTo(letter) {
    if (query) { qInput.value = ""; query = ""; refresh(); }
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].mark === letter.toUpperCase()) {
        scrollBox.scrollTop = rows[i].y;
        paint(true);
        return;
      }
    }
  }
  function syncAlpha() {
    var cur = selectedId && byId[selectedId] ? byId[selectedId]._w.charAt(0) : "";
    var ns = document.querySelectorAll(".alpha button");
    for (var i = 0; i < ns.length; i++) {
      ns[i].setAttribute("aria-current", String(ns[i].dataset.l === cur));
    }
  }

  /* ---- khung nghĩa ------------------------------------------------------- */
  function drawDetail() {
    var host = document.getElementById("detail-inner");
    host.textContent = "";
    if (view === "read") {
      host.appendChild(selectedRead ? readingView(selectedRead) : blankView());
      return;
    }
    var e = byId[selectedId];
    host.appendChild(e ? entryView(e) : blankView());
  }

  function entryView(e) {
    var art = el("article", "entry");

    var at = cursorIndex();
    var nav = el("div", "entry-nav");
    var prev = el("button", "iconbtn", "←");
    prev.type = "button";
    prev.title = "Mục trước (phím ←)";
    prev.disabled = at <= 0;
    prev.addEventListener("click", function () { step(-1); });
    var next = el("button", "iconbtn", "→");
    next.type = "button";
    next.title = "Mục sau (phím →)";
    next.disabled = at < 0 || at >= hits.length - 1;
    next.addEventListener("click", function () { step(1); });
    nav.appendChild(prev);
    nav.appendChild(next);
    if (at > -1) nav.appendChild(el("span", "pos-in-list", fmt(at + 1) + " / " + fmt(hits.length)));
    nav.appendChild(el("span", "grow"));
    art.appendChild(nav);

    var head = el("div", "entry-head");
    head.appendChild(el("h1", "headword", e.word));
    if (e.pos) head.appendChild(el("span", "pos-big", e.pos + "."));
    if (e.ipa) head.appendChild(el("span", "ipa", e.ipa));
    head.appendChild(el("span", "kind", kindOf(e)));
    if (e.mine) head.appendChild(el("span", "kind kind-mine", "Của tôi"));
    if (e.mine && canWriteSheet()) {
      head.appendChild(el("span", "kind" + (e.inSheet ? " kind-sheet" : ""),
        e.inSheet ? "Đã vào sheet" : "Chưa vào sheet"));
    }
    art.appendChild(head);
    if (e.note) art.appendChild(el("p", "note", e.note));

    var ol = el("ol", "senses");
    e.senses.forEach(function (s, i) {
      var li = el("li", "sense" + (e.senses.length > 1 ? "" : " solo"));
      if (e.senses.length > 1) li.appendChild(el("span", "num", String(i + 1)));
      var body = el("div", "body");
      if (s.def) body.appendChild(el("p", "def", s.def));
      if (s.eg && s.eg.length) {
        var egs = el("div", "egs");
        s.eg.forEach(function (x) { egs.appendChild(el("p", "eg", x)); });
        body.appendChild(egs);
      }
      if (s.vi) body.appendChild(el("p", "vi", s.vi));
      li.appendChild(body);
      ol.appendChild(li);
    });
    art.appendChild(ol);

    var rel = relatedOf(e);
    if (rel.length) {
      var box = el("div", "related");
      box.appendChild(el("h2", null, e.type === "compare" ? "Dễ nhầm với"
        : e.type === "phrasal" ? "Cùng động từ" : "Cùng gốc"));
      var ul = el("ul");
      rel.forEach(function (x) {
        var li = el("li");
        var b = el("button");
        b.type = "button";
        b.appendChild(document.createTextNode(x.word));
        if (x.pos) b.appendChild(el("span", "pos", x.pos));
        b.addEventListener("click", function () { select(x.id); showDetail(); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      art.appendChild(box);
    }

    if (e.mine && canWrite) {
      var foot = el("div", "entry-foot");
      var del = el("button", "btn btn-danger", "Xoá từ này");
      del.type = "button";
      del.addEventListener("click", function () { removeEntry(e); });
      foot.appendChild(del);
      art.appendChild(foot);
    }
    return art;
  }

  /* Mục liên quan: nhóm dễ nhầm, cùng động từ (phrasal), hoặc cùng gốc từ. */
  function relatedOf(e) {
    var out = [];
    var i;
    if (e.type === "compare" && e.group) {
      for (i = 0; i < entries.length; i++) {
        var c = entries[i];
        if (c.type === "compare" && c.group === e.group && c.id !== e.id) out.push(c);
      }
      return out;
    }
    if (e.type === "phrasal" && e.verb) {
      for (i = 0; i < entries.length; i++) {
        if (entries[i].type === "phrasal" && entries[i].verb === e.verb && entries[i].id !== e.id) {
          out.push(entries[i]);
        }
      }
      return out.slice(0, 14);
    }
    var stem = e._w.replace(/(ing|ed|ly|ness|ment|tion|sion|ity|ous|ful|less|able|ible|ise|ize)$/, "");
    if (stem.length < 5) return out;
    for (i = 0; i < entries.length; i++) {
      var x = entries[i];
      if (x.id !== e.id && x._w !== e._w && x._w.lastIndexOf(stem, 0) === 0
        && Math.abs(x._w.length - e._w.length) < 7) {
        out.push(x);
        if (out.length >= 10) break;
      }
    }
    return out;
  }

  function readingView(r) {
    var w = el("div", "read");
    w.appendChild(el("h1", null, r.title));
    var words = r.paras.join(" ").split(/\s+/).length;
    w.appendChild(el("p", "meta", "Bài " + r.index + " · " + fmt(words) + " từ"));
    var prose = el("div", "prose");
    r.paras.forEach(function (p) { prose.appendChild(el("p", null, p)); });
    w.appendChild(prose);
    return w;
  }

  function blankView() {
    var w = el("div", "blank");
    if (view === "read") {
      w.appendChild(el("p", "lead", "Chọn một bài đọc"));
      w.appendChild(el("p", "sub", "Gõ vào ô tìm kiếm để lọc theo tiêu đề hoặc nội dung bài."));
      return w;
    }
    w.appendChild(el("p", "lead", "Tra một từ, hoặc lật theo chữ cái"));
    w.appendChild(el("p", "sub",
      "Gõ tiếng Anh hoặc tiếng Việt — trang tìm trong cả từ, phiên âm, định nghĩa "
      + "và nghĩa tiếng Việt. Tiếng Việt không dấu vẫn ra: gõ “thoai vi” ra abdicate."));

    var stats = el("div", "stats");
    [[entries.length, "mục từ"],
     [senseCount(entries), "nghĩa"],
     [counts.phrasal || 0, "phrasal verb"],
     [counts.idiom || 0, "thành ngữ"]].forEach(function (p) {
      if (!p[0]) return;
      var s = el("div", "stat");
      s.appendChild(el("b", null, fmt(p[0])));
      s.appendChild(el("span", null, p[1]));
      stats.appendChild(s);
    });
    w.appendChild(stats);

    var keys = el("div", "keys");
    keys.appendChild(el("h3", null, "Phím tắt"));
    var dl = el("dl");
    [[["/"], "nhảy vào ô tìm kiếm"],
     [["↑", "↓"], "đi trong danh sách"],
     [["←", "→"], "mục trước / mục sau"],
     [["Esc"], "xoá ô tìm kiếm"]].forEach(function (p) {
      var dt = el("dt");
      p[0].forEach(function (k) { dt.appendChild(el("span", null, k)); });
      dl.appendChild(dt);
      dl.appendChild(el("dd", null, p[1]));
    });
    keys.appendChild(dl);
    w.appendChild(keys);

    var foot = el("div", "foot");
    var rnd = el("button", "btn", "Một từ ngẫu nhiên");
    rnd.type = "button";
    rnd.addEventListener("click", function () {
      if (!hits.length) return;
      select(hits[Math.floor(Math.random() * hits.length)].id);
      paint(true);
      showDetail();
    });
    foot.appendChild(rnd);
    w.appendChild(foot);

    if (MODE === "static") {
      w.appendChild(el("p", "local-note",
        "Từ bạn thêm ở bản này được lưu trong chính trình duyệt bạn đang dùng, "
        + "không gửi đi đâu cả — bấm “Sao lưu .json” nếu muốn giữ lâu dài."));
    }
    return w;
  }

  /* ---- thêm / xoá từ ----------------------------------------------------- */
  function newSenseRow(n) {
    var box = el("div", "sense-edit");
    var row = el("div", "row");
    row.appendChild(el("span", "lab", "Nghĩa " + n));
    var drop = el("button", "btn btn-quiet drop", "Bỏ");
    drop.type = "button";
    drop.addEventListener("click", function () { box.remove(); renumberSenses(); });
    row.appendChild(drop);
    box.appendChild(row);

    var f1 = el("label", "field");
    f1.appendChild(el("span", null, "Definition (English)"));
    var ta = el("textarea");
    ta.name = "def";
    ta.placeholder = "to become less strong";
    f1.appendChild(ta);
    box.appendChild(f1);

    var f2 = el("label", "field");
    f2.appendChild(el("span", null, "Nghĩa ngắn gọn"));
    var inp = el("input");
    inp.name = "vi";
    inp.placeholder = "yếu đi / giảm đi";
    f2.appendChild(inp);
    box.appendChild(f2);
    return box;
  }
  function renumberSenses() {
    var boxes = document.querySelectorAll("#sense-list .sense-edit");
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].querySelector(".lab").textContent = "Nghĩa " + (i + 1);
      boxes[i].querySelector(".drop").hidden = boxes.length === 1;
    }
  }

  function openForm(prefill) {
    var dlg = document.getElementById("form-dlg");
    dlg.querySelector("[name=word]").value = prefill || "";
    dlg.querySelector("[name=pos]").value = "";
    dlg.querySelector("[name=ipa]").value = "";
    dlg.querySelector("[name=type]").value = "word";
    dlg.querySelector("[name=note]").value = "";
    var list = document.getElementById("sense-list");
    list.textContent = "";
    list.appendChild(newSenseRow(1));
    renumberSenses();
    document.getElementById("form-msg").textContent = "";
    dlg.showModal();
    dlg.querySelector("[name=word]").focus();
  }

  function collectForm() {
    var dlg = document.getElementById("form-dlg");
    var word = dlg.querySelector("[name=word]").value.trim();
    if (!word) return { err: "Chưa nhập từ." };
    var senses = [];
    var boxes = document.querySelectorAll("#sense-list .sense-edit");
    for (var i = 0; i < boxes.length; i++) {
      var def = boxes[i].querySelector("[name=def]").value.trim();
      var vi = boxes[i].querySelector("[name=vi]").value.trim();
      if (def || vi) senses.push({ def: def, vi: vi, eg: [] });
    }
    if (!senses.length) return { err: "Cần ít nhất một nghĩa — điền definition hoặc nghĩa tiếng Việt." };
    return {
      entry: {
        id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: dlg.querySelector("[name=type]").value,
        word: word,
        pos: dlg.querySelector("[name=pos]").value.trim(),
        ipa: dlg.querySelector("[name=ipa]").value.trim(),
        note: dlg.querySelector("[name=note]").value.trim(),
        senses: senses,
        mine: true,
        at: new Date().toISOString().slice(0, 10)
      }
    };
  }

  function saveForm() {
    var got = collectForm();
    var msg = document.getElementById("form-msg");
    if (got.err) { msg.textContent = got.err; return; }
    var btn = document.getElementById("form-save");
    var box = document.getElementById("to-sheet");
    var wantSheet = canWriteSheet() && box && box.checked;
    btn.disabled = true;
    btn.textContent = wantSheet ? "Đang ghi vào sheet…" : "Đang lưu…";
    msg.textContent = "";

    var sheetErr = null;
    var toSheet = wantSheet
      ? callSheet({ action: "add", entry: got.entry }).then(function () {
        got.entry.inSheet = true;
      }, function (err) {
        sheetErr = err && err.message ? err.message : String(err);
      })
      : Promise.resolve();

    toSheet.then(function () {
      var next = ADDED.concat([got.entry]);
      return persist(next).then(function (res) {
        btn.disabled = false;
        btn.textContent = "Lưu từ";
        document.getElementById("form-dlg").close();
        if (res.ok && res.reload) { toast("Đã lưu “" + got.entry.word + "”"); return; }
        ADDED = next;
        rebuild();
        refresh();
        select(got.entry.id);
        showDetail();
        if (!res.ok) { banner(res.msg, "Đồng bộ", syncPending); return; }
        if (got.entry.inSheet) { toast("Đã ghi “" + got.entry.word + "” vào sheet"); return; }
        if (sheetErr) {
          banner("Đã lưu trong trình duyệt, nhưng chưa ghi được vào sheet: " + sheetErr,
            "Thử lại", pushToSheet);
          return;
        }
        toast("Đã lưu “" + got.entry.word + "” vào trình duyệt này");
      });
    });
  }

  /* Đẩy những từ đã thêm mà chưa vào sheet. */
  function unsynced() {
    return ADDED.filter(function (e) { return !e.inSheet; });
  }

  function pushToSheet() {
    if (!canWriteSheet()) { openSettings(); return; }
    var todo = unsynced();
    if (!todo.length) { toast("Không còn từ nào chờ ghi vào sheet."); return; }
    banner("Đang ghi " + todo.length + " từ vào sheet…", null, null);
    var okN = 0, lastErr = null;
    var chain = Promise.resolve();
    todo.forEach(function (e) {
      chain = chain.then(function () {
        return callSheet({ action: "add", entry: e }).then(function () {
          e.inSheet = true;
          okN++;
        }, function (err) { lastErr = err && err.message ? err.message : String(err); });
      });
    });
    chain.then(function () {
      writeBackup(ADDED);
      rebuild();
      refresh();
      if (okN && !lastErr) { document.getElementById("banner").hidden = true; toast("Đã ghi " + okN + " từ vào sheet"); }
      else if (okN) banner("Ghi được " + okN + " từ, còn lỗi: " + lastErr, "Thử lại", pushToSheet);
      else banner("Chưa ghi được vào sheet: " + lastErr, "Thử lại", pushToSheet);
    });
  }

  function removeEntry(e) {
    if (!window.confirm("Xoá “" + e.word + "” khỏi sổ?")) return;
    var next = ADDED.filter(function (x) { return x.id !== e.id; });
    persist(next).then(function (res) {
      if (res.ok && res.reload) { toast("Đã xoá"); return; }
      ADDED = next;
      selectedId = null;
      rebuild();
      refresh();
      if (res.ok) { toast("Đã xoá"); return; }
      banner(res.msg, "Đồng bộ", syncPending);
    });
  }

  function syncPending() {
    banner("Đang đồng bộ…", null, null);
    persist(ADDED).then(function (res) {
      if (!res.ok) banner(res.msg, "Thử lại", syncPending);
    });
  }

  /* ---- xuất tệp ---------------------------------------------------------- */
  function exportJson() {
    var payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      entries: entries.map(function (e) {
        return { word: e.word, pos: e.pos, ipa: e.ipa, type: e.type, note: e.note, senses: e.senses, mine: !!e.mine };
      })
    }, null, 1);
    if (MODE === "static") {
      var url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      var a = document.createElement("a");
      a.href = url;
      a.download = "so-tra-tu.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast("Đã tạo bản sao lưu");
      return;
    }
    if (!window.claude || !window.claude.use) { toast("Không tải xuống được ở bản này."); return; }
    window.claude.use("downloads").then(function (dl) {
      if (!dl) { toast("Không tải xuống được ở bản này."); return; }
      return dl.save({ filename: "so-tra-tu.json", data: payload }).then(function () {
        toast("Đã tạo bản sao lưu");
      }, function () { toast("Chưa tải được tệp."); });
    });
  }

  /* ---- thông báo --------------------------------------------------------- */
  var toastTimer = null;
  function toast(text) {
    var t = document.getElementById("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function banner(text, actionLabel, fn) {
    var b = document.getElementById("banner");
    b.textContent = "";
    b.appendChild(el("span", null, text));
    if (actionLabel && fn) {
      var btn = el("button", "btn", actionLabel);
      btn.type = "button";
      btn.addEventListener("click", fn);
      b.appendChild(btn);
    }
    var x = el("button", "btn btn-quiet", "Ẩn");
    x.type = "button";
    x.addEventListener("click", function () { b.hidden = true; });
    b.appendChild(x);
    b.hidden = false;
  }

  /* ---- vẽ lại toàn bộ ---------------------------------------------------- */
  function refresh() {
    search();
    var total = layout();
    spacer.style.height = total + "px";
    scrollBox.scrollTop = 0;
    paint(true);
    drawChips();
    drawCount();
    drawAlpha();
    drawDetail();
    refreshChrome();
    document.getElementById("tally").textContent =
      fmt(entries.length) + " mục · " + fmt(senseCount(entries)) + " nghĩa"
      + (READINGS.length ? " · " + fmt(READINGS.length) + " bài đọc" : "");
  }

  function drawCount() {
    var box = document.getElementById("count");
    box.textContent = "";
    var q = query.trim();
    if (view === "read") {
      box.appendChild(document.createTextNode(fmt(hits.length) + " bài đọc"));
      return;
    }
    box.appendChild(document.createTextNode(fmt(hits.length) + " mục"));
    box.appendChild(el("span", "dot", "·"));
    box.appendChild(document.createTextNode(fmt(senseCount(hits)) + " nghĩa"));
    if (q) {
      box.appendChild(el("span", "dot", "·"));
      box.appendChild(document.createTextNode("khớp “" + q + "”"));
    }
  }

  function drawChips() {
    var box = document.getElementById("chips");
    box.hidden = view === "read";
    box.textContent = "";
    var defs = [["all", "Tất cả"]].concat(KIND_ORDER.map(function (k) { return [k, KINDS[k].filter]; }));
    if (counts.mine) defs.push(["mine", "Của tôi"]);
    defs.forEach(function (d) {
      if (d[0] !== "all" && !counts[d[0]]) return;
      var b = el("button", "chip");
      b.type = "button";
      b.setAttribute("aria-pressed", String(kindFilter === d[0]));
      b.appendChild(document.createTextNode(d[1]));
      b.appendChild(el("span", "n", fmt(counts[d[0]] || 0)));
      b.addEventListener("click", function () { kindFilter = d[0]; refresh(); });
      box.appendChild(b);
    });
  }

  function drawAlpha() {
    var box = document.getElementById("alpha");
    box.hidden = view === "read" || !!query.trim();
    if (box.hidden) return;
    if (box.dataset.done === kindFilter) return;
    box.dataset.done = kindFilter;
    box.textContent = "";
    var have = {};
    for (var i = 0; i < hits.length; i++) have[hits[i]._w.charAt(0)] = true;
    ALPHABET.forEach(function (L) {
      var b = el("button", null, L);
      b.type = "button";
      b.dataset.l = L;
      b.disabled = !have[L];
      b.title = "Lật tới chữ " + L.toUpperCase();
      b.addEventListener("click", function () { jumpTo(L); });
      box.appendChild(b);
    });
  }

  /* ---- dựng khung trang --------------------------------------------------- */
  var qInput;

  function build() {
    var app = document.getElementById("app");
    app.textContent = "";

    var top = el("header", "top");
    var brand = el("div", "brand");
    brand.appendChild(el("span", "mark", "Sổ Tra Từ"));
    var tally = el("span", "tally");
    tally.id = "tally";
    brand.appendChild(tally);
    top.appendChild(brand);

    var back = el("button", "btn btn-quiet back", "← Danh sách");
    back.type = "button";
    back.addEventListener("click", function () { document.body.dataset.view = "list"; });
    top.appendChild(back);

    var searchBox = el("div", "search");
    searchBox.innerHTML = '<svg class="glass" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';
    qInput = el("input");
    qInput.id = "q";
    qInput.type = "search";
    qInput.autocomplete = "off";
    qInput.spellcheck = false;
    qInput.setAttribute("aria-label", "Tìm từ");
    qInput.placeholder = "Tra từ, nghĩa, hoặc tiếng Việt…";
    searchBox.appendChild(qInput);
    var hk = el("div", "hintkeys");
    hk.appendChild(el("kbd", null, "/"));
    searchBox.appendChild(hk);
    top.appendChild(searchBox);

    var acts = el("div", "acts");
    if (READINGS.length) {
      var rd = el("button", "btn", "Bài đọc");
      rd.type = "button";
      rd.addEventListener("click", function () {
        view = view === "read" ? "vocab" : "read";
        rd.setAttribute("aria-pressed", String(view === "read"));
        rd.className = view === "read" ? "btn btn-primary" : "btn";
        qInput.placeholder = view === "read" ? "Tìm trong bài đọc…" : "Tra từ, nghĩa, hoặc tiếng Việt…";
        selectedRead = null;
        refresh();
      });
      acts.appendChild(rd);
    }
    var add = el("button", "btn btn-primary", "+ Thêm từ");
    add.type = "button";
    add.dataset.write = "1";
    add.addEventListener("click", function () { openForm(query.trim()); });
    acts.appendChild(add);
    var push = el("button", "btn", "Ghi vào sheet");
    push.type = "button";
    push.id = "push-sheet";
    push.hidden = true;
    push.dataset.write = "1";
    push.addEventListener("click", pushToSheet);
    acts.appendChild(push);

    var openSheet = document.createElement("a");
    openSheet.className = "btn btn-quiet";
    openSheet.id = "open-sheet";
    openSheet.target = "_blank";
    openSheet.rel = "noopener";
    openSheet.textContent = "Mở sheet";
    openSheet.hidden = true;
    acts.appendChild(openSheet);

    var exp = el("button", "btn btn-quiet", "Sao lưu .json");
    exp.type = "button";
    exp.addEventListener("click", exportJson);
    acts.appendChild(exp);

    var gear = el("button", "btn btn-quiet", "⚙");
    gear.type = "button";
    gear.title = "Cài đặt";
    gear.setAttribute("aria-label", "Cài đặt");
    gear.addEventListener("click", openSettings);
    acts.appendChild(gear);

    top.appendChild(acts);
    app.appendChild(top);

    var bn = el("div", "banner");
    bn.id = "banner";
    bn.hidden = true;
    app.appendChild(bn);

    var work = el("div", "work");
    var alpha = el("nav", "alpha");
    alpha.id = "alpha";
    alpha.setAttribute("aria-label", "Lật theo chữ cái");
    work.appendChild(alpha);

    var list = el("div", "list");
    var chips = el("div", "chips");
    chips.id = "chips";
    list.appendChild(chips);
    var count = el("div", "count");
    count.id = "count";
    list.appendChild(count);
    scrollBox = el("div", "scroll");
    spacer = el("div", "spacer");
    windowBox = el("div", "window");
    spacer.appendChild(windowBox);
    scrollBox.appendChild(spacer);
    list.appendChild(scrollBox);
    work.appendChild(list);

    var detail = el("section", "detail");
    var inner = el("div", "detail-inner");
    inner.id = "detail-inner";
    detail.appendChild(inner);
    work.appendChild(detail);
    app.appendChild(work);

    var t = el("div", "toast");
    t.id = "toast";
    t.hidden = true;
    t.setAttribute("role", "status");
    app.appendChild(t);
    app.appendChild(buildDialog());
    app.appendChild(buildSettings());
    refreshChrome();

    scrollBox.addEventListener("scroll", function () { paint(false); }, { passive: true });
    window.addEventListener("resize", function () { paint(true); });

    qInput.addEventListener("input", function () { query = qInput.value; refresh(); });
    qInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { qInput.value = ""; query = ""; refresh(); }
      else if (ev.key === "ArrowDown") { ev.preventDefault(); step(1); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); step(-1); }
      else if (ev.key === "Enter" && hits.length) {
        ev.preventDefault();
        if (!byId[selectedId]) select(hits[0].id);
        showDetail();
      }
    });
    document.addEventListener("keydown", function (ev) {
      if (isTyping(ev.target)) return;
      if (ev.key === "/") { ev.preventDefault(); qInput.focus(); qInput.select(); }
      else if (ev.key === "ArrowLeft") step(-1);
      else if (ev.key === "ArrowRight") step(1);
      else if (ev.key === "ArrowDown") { ev.preventDefault(); step(1); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); step(-1); }
    });
  }

  function isTyping(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  function buildDialog() {
    var dlg = document.createElement("dialog");
    dlg.id = "form-dlg";
    dlg.dataset.write = "1";

    var head = el("div", "dlg-head");
    head.appendChild(el("h2", null, "Thêm từ"));
    head.appendChild(el("p", null, "Một từ có thể có nhiều nghĩa."));
    dlg.appendChild(head);

    var body = el("div", "dlg-body");
    var g = el("div", "grid-3");
    g.appendChild(field("Từ", "word", "abate", false));
    g.appendChild(field("Từ loại", "pos", "v", false));
    g.appendChild(field("Phiên âm", "ipa", "/əˈbeɪt/", true));
    body.appendChild(g);

    var g2 = el("div", "grid-3");
    var ft = el("label", "field");
    ft.appendChild(el("span", null, "Nhóm"));
    var sel = el("select");
    sel.name = "type";
    KIND_ORDER.forEach(function (k) {
      var o = el("option", null, KINDS[k].label);
      o.value = k;
      sel.appendChild(o);
    });
    ft.appendChild(sel);
    g2.appendChild(ft);
    var fn = field("Ghi chú", "note", "US: slaughterhouse", false);
    fn.style.gridColumn = "span 2";
    g2.appendChild(fn);
    body.appendChild(g2);

    var list = el("div", "field");
    list.id = "sense-list";
    list.style.gap = "12px";
    body.appendChild(list);

    var more = el("button", "btn", "+ Thêm nghĩa");
    more.type = "button";
    more.addEventListener("click", function () {
      list.appendChild(newSenseRow(list.children.length + 1));
      renumberSenses();
    });
    body.appendChild(more);
    dlg.appendChild(body);

    var foot = el("div", "dlg-foot");
    var toSheetRow = el("label", "checkrow");
    toSheetRow.id = "to-sheet-row";
    toSheetRow.hidden = true;
    var cb = el("input");
    cb.type = "checkbox";
    cb.id = "to-sheet";
    cb.checked = true;
    toSheetRow.appendChild(cb);
    toSheetRow.appendChild(el("span", null, "Ghi thẳng vào sheet"));
    foot.appendChild(toSheetRow);
    var msg = el("span", "dlg-msg");
    msg.id = "form-msg";
    foot.appendChild(msg);
    foot.appendChild(el("span", "spacer2"));
    var cancel = el("button", "btn", "Huỷ");
    cancel.type = "button";
    cancel.addEventListener("click", function () { dlg.close(); });
    foot.appendChild(cancel);
    var save = el("button", "btn btn-primary", "Lưu từ");
    save.type = "button";
    save.id = "form-save";
    save.addEventListener("click", saveForm);
    foot.appendChild(save);
    dlg.appendChild(foot);
    return dlg;
  }

  function buildSettings() {
    var dlg = document.createElement("dialog");
    dlg.id = "set-dlg";

    var head = el("div", "dlg-head");
    head.appendChild(el("h2", null, "Cài đặt"));
    head.appendChild(el("p", null, "Chỉ lưu trong trình duyệt này."));
    dlg.appendChild(head);

    var body = el("div", "dlg-body");
    body.appendChild(setField("Link Google Sheet", "sheetUrl",
      "https://docs.google.com/spreadsheets/d/…",
      "Để hiện nút “Mở sheet” trên thanh đầu trang."));
    body.appendChild(setField("Link Web App ghi từ", "webApp",
      "https://script.google.com/macros/s/…/exec",
      "Lấy trong sheet: menu Sổ Tra Từ → Link cho web ghi từ vào sheet."));
    body.appendChild(setField("Mã khoá", "key", "", "Lấy cùng chỗ với link trên."));

    var note = el("p", "set-note");
    note.textContent = MODE === "static"
      ? "Có đủ link và mã khoá thì mỗi từ bạn thêm sẽ được chèn thẳng vào đúng tab của sheet, đúng thứ tự a→z. Hai thứ này không rời khỏi máy bạn, nên người khác mở trang cũng không ghi được vào sheet."
      : "Bản Artifact trên claude.ai không được phép gọi ra ngoài, nên đường ghi vào sheet chỉ chạy ở bản web tĩnh (GitHub Pages).";
    body.appendChild(note);
    dlg.appendChild(body);

    var foot = el("div", "dlg-foot");
    var msg = el("span", "dlg-msg");
    msg.id = "set-msg";
    foot.appendChild(msg);
    foot.appendChild(el("span", "spacer2"));
    var testBtn = el("button", "btn", "Kiểm tra kết nối");
    testBtn.type = "button";
    testBtn.addEventListener("click", function () {
      readForm();
      if (!settings.webApp || !settings.key) { msg.textContent = "Cần cả link Web App và mã khoá."; return; }
      msg.textContent = "Đang thử…";
      callSheet({ action: "ping" }).then(function () {
        msg.style.color = "var(--accent-hi)";
        msg.textContent = "Kết nối được.";
      }, function (err) {
        msg.style.color = "";
        msg.textContent = "Không được: " + (err && err.message ? err.message : err);
      });
    });
    foot.appendChild(testBtn);
    var save = el("button", "btn btn-primary", "Lưu");
    save.type = "button";
    save.addEventListener("click", function () {
      readForm();
      writeSettings();
      dlg.close();
      refreshChrome();
      toast("Đã lưu cài đặt");
    });
    foot.appendChild(save);
    dlg.appendChild(foot);

    function readForm() {
      settings.sheetUrl = dlg.querySelector("[name=sheetUrl]").value.trim();
      settings.webApp = dlg.querySelector("[name=webApp]").value.trim();
      settings.key = dlg.querySelector("[name=key]").value.trim();
    }
    return dlg;
  }

  function setField(label, name, placeholder, hint) {
    var f = el("label", "field");
    f.appendChild(el("span", null, label));
    var i = el("input", "mono");
    i.name = name;
    i.placeholder = placeholder;
    i.autocomplete = "off";
    i.spellcheck = false;
    f.appendChild(i);
    if (hint) f.appendChild(el("span", "hint", hint));
    return f;
  }

  function openSettings() {
    var dlg = document.getElementById("set-dlg");
    dlg.querySelector("[name=sheetUrl]").value = settings.sheetUrl;
    dlg.querySelector("[name=webApp]").value = settings.webApp;
    dlg.querySelector("[name=key]").value = settings.key;
    var m = document.getElementById("set-msg");
    m.textContent = "";
    m.style.color = "";
    dlg.showModal();
  }

  /* Bật/tắt những thứ phụ thuộc vào cài đặt. */
  function refreshChrome() {
    var open = document.getElementById("open-sheet");
    if (open) {
      open.hidden = !settings.sheetUrl;
      open.href = settings.sheetUrl || "#";
    }
    var push = document.getElementById("push-sheet");
    if (push) {
      var n = canWriteSheet() ? unsynced().length : 0;
      push.hidden = !n;
      push.textContent = "Ghi " + n + " từ vào sheet";
    }
    var row = document.getElementById("to-sheet-row");
    if (row) row.hidden = !canWriteSheet();
  }

  function field(label, name, placeholder, mono) {
    var f = el("label", "field");
    f.appendChild(el("span", null, label));
    var i = el("input", mono ? "mono" : null);
    i.name = name;
    i.placeholder = placeholder;
    i.autocomplete = "off";
    f.appendChild(i);
    return f;
  }

  /* ---- khởi động ---------------------------------------------------------- */
  function start(data) {
    readSettings();
    BASE = data;
    READINGS = data.readings || [];
    READINGS.forEach(function (r, i) {
      r.id = "r" + i;
      r._w = norm(r.title);
      r._all = norm(r.title + " " + r.paras.join(" "));
    });

    var backup = readBackup();
    var known = {};
    ADDED.forEach(function (e) { known[e.id] = true; });
    var pending = backup.filter(function (e) { return e && e.id && !known[e.id]; });
    if (pending.length) {
      ADDED = ADDED.concat(pending);
      if (MODE !== "static") {
        banner(pending.length + " từ trong bản sao lưu trên máy này chưa có trên máy chủ.",
          "Đồng bộ", syncPending);
      }
    } else if (backup.length !== ADDED.length) {
      writeBackup(ADDED);
    }

    build();
    rebuild();
    refresh();

    if (MODE === "static") return;
    if (!checkWrite()) {
      window.addEventListener("load", function () {
        setTimeout(function () { if (!checkWrite()) goReadOnly(); }, 300);
      });
    }
  }

  function checkWrite() {
    if (!window.claude || !window.claude.use) return false;
    window.claude.use("artifact").then(function (a) { if (!a) goReadOnly(); });
    return true;
  }

  function showLoading(text) {
    var app = document.getElementById("app");
    app.textContent = "";
    var box = el("div", "loading");
    var bar = el("div", "bar");
    bar.appendChild(el("i"));
    box.appendChild(bar);
    box.appendChild(el("p", null, text));
    app.appendChild(box);
  }

  var embedded = document.getElementById("base");
  if (embedded) {
    start(JSON.parse(embedded.textContent));
  } else {
    showLoading("Đang tải sổ từ…");
    fetch("data.json").then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(start, function () {
      showLoading("Không tải được dữ liệu. Thử tải lại trang.");
    });
  }
})();
