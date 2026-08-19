/* Sổ Tra Từ — tra cứu & bổ sung từ vựng Anh–Việt.
   Trang tự lưu chính nó: mỗi lần thêm/xoá từ, nó publish lại một phiên bản
   mới của artifact, nên từ mới còn nguyên khi mở lại ở máy khác. */
(function () {
  "use strict";

  var FONT_URL = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap";
  var BACKUP_KEY = "so-tra-tu:added:v1";

  var KINDS = {
    word:       { label: "Từ",          filter: "Từ" },
    phrasal:    { label: "Phrasal verb", filter: "Phrasal" },
    idiom:      { label: "Thành ngữ",   filter: "Thành ngữ" },
    expression: { label: "Cụm từ",      filter: "Cụm từ" },
    compare:    { label: "Dễ nhầm",     filter: "Dễ nhầm" }
  };
  var KIND_ORDER = ["word", "phrasal", "idiom", "expression", "compare"];

  /* ---- state --------------------------------------------------------- */
  // "artifact": trang tự publish lại chính nó, từ mới lên máy chủ.
  // "static":   bản đặt trên web tĩnh, từ mới chỉ nằm trong trình duyệt người xem.
  var MODE = JSON.parse(document.getElementById("mode").textContent);
  var BASE = JSON.parse(document.getElementById("base").textContent);
  var ADDED = JSON.parse(document.getElementById("added").textContent);
  var READINGS = BASE.readings || [];
  var entries = [];
  var canWrite = true;
  var pending = [];          // trong sao lưu cục bộ nhưng chưa lên máy chủ
  var view = "vocab";        // vocab | read
  var kindFilter = "all";
  var query = "";
  var hits = [];
  var cursor = -1;
  var selectedId = null;
  var selectedRead = null;

  /* ---- helpers ------------------------------------------------------- */
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
    return list.reduce(function (n, e) { return n + (e.senses ? e.senses.length : 0); }, 0);
  }

  function indexEntry(e) {
    var parts = [e.word, e.pos, e.ipa, e.note];
    (e.senses || []).forEach(function (s) {
      parts.push(s.def, s.vi);
      (s.eg || []).forEach(function (x) { parts.push(x); });
    });
    e._w = norm(e.word);
    e._all = norm(parts.join("  "));
    return e;
  }

  function rebuild() {
    entries = BASE.entries.concat(ADDED).map(indexEntry);
    entries.sort(function (a, b) {
      return a._w < b._w ? -1 : a._w > b._w ? 1 : 0;
    });
  }

  /* ---- backup (localStorage) ----------------------------------------- */
  function readBackup() {
    try {
      var raw = localStorage.getItem(BACKUP_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) { return []; }
  }
  function writeBackup(list) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(list)); } catch (err) { /* hết dung lượng */ }
  }

  /* ---- page source (dùng để tự publish lại) --------------------------- */
  function jsonSafe(s) { return s.replace(/</g, "\\u003c"); }

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
      + S + ' type="application/json" id="added">' + jsonSafe(JSON.stringify(added)) + E + "\n"
      + S + ' type="text/plain" id="appjs">' + js + E + "\n"
      + S + ">new Function(document.getElementById('appjs').textContent)()" + E + "\n"
      + "</body>\n</html>";
  }

  function goReadOnly() {
    if (!canWrite) return;
    canWrite = false;
    document.querySelectorAll("[data-write]").forEach(function (n) { n.hidden = true; });
    banner("Bản này chỉ xem được — từ bạn thêm chỉ lưu trên máy này.", null, null);
  }

  /* Lưu danh sách từ đã thêm: sao lưu cục bộ trước, rồi publish lại trang.
     Bản tĩnh dừng ở bước sao lưu — trình duyệt là nơi lưu duy nhất. */
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
        if (code === "too_large") return { ok: false, msg: "Trang đã đầy, không thêm được nữa." };
        return { ok: false, msg: "Không lưu được lên máy chủ. Từ đã giữ trong bản sao lưu trên máy này." };
      });
    });
  }

  /* ---- tìm kiếm ------------------------------------------------------ */
  function search() {
    var q = norm(query.trim());
    var pool = entries.filter(function (e) {
      if (kindFilter === "all") return true;
      if (kindFilter === "mine") return !!e.mine;
      return e.type === kindFilter;
    });
    if (!q) { hits = pool; return; }
    var scored = [];
    for (var i = 0; i < pool.length; i++) {
      var e = pool[i], s = -1;
      if (e._w === q) s = 0;
      else if (e._w.indexOf(q) === 0) s = 1;
      else if (e._w.indexOf(" " + q) > -1) s = 2;
      else if (e._w.indexOf(q) > -1) s = 3;
      else if (e._all.indexOf(q) > -1) s = 4;
      if (s > -1) scored.push([s, e]);
    }
    scored.sort(function (a, b) {
      if (a[0] !== b[0]) return a[0] - b[0];
      return a[1]._w < b[1]._w ? -1 : a[1]._w > b[1]._w ? 1 : 0;
    });
    hits = scored.map(function (p) { return p[1]; });
  }

  function markUp(node, text, q) {
    if (!q) { node.textContent = text; return; }
    var i = norm(text).indexOf(q);
    if (i < 0) { node.textContent = text; return; }
    node.appendChild(document.createTextNode(text.slice(0, i)));
    node.appendChild(el("mark", null, text.slice(i, i + q.length)));
    node.appendChild(document.createTextNode(text.slice(i + q.length)));
  }

  /* ---- vẽ danh sách kết quả ------------------------------------------ */
  function drawHits() {
    var list = document.getElementById("hits");
    list.textContent = "";
    var q = norm(query.trim());

    if (view === "read") {
      var rs = READINGS.filter(function (r) {
        if (!q) return true;
        if (norm(r.title).indexOf(q) > -1) return true;
        return r.paras.some(function (p) { return norm(p).indexOf(q) > -1; });
      });
      document.getElementById("tally-line").textContent =
        fmt(rs.length) + " bài đọc" + (q ? " khớp “" + query.trim() + "”" : "");
      if (!rs.length) { list.appendChild(el("p", "empty", "Không có bài đọc nào khớp.")); return; }
      rs.forEach(function (r) {
        var li = el("li");
        var b = el("button", "hit");
        b.type = "button";
        b.setAttribute("aria-current", selectedRead === r ? "true" : "false");
        var hw = el("span", "hw");
        markUp(hw, r.title, q);
        b.appendChild(hw);
        b.appendChild(el("span", "gloss", r.paras[0].slice(0, 90) + "…"));
        b.addEventListener("click", function () { selectedRead = r; drawHits(); drawDetail(); focusDetail(); });
        li.appendChild(b);
        list.appendChild(li);
      });
      return;
    }

    document.getElementById("tally-line").textContent =
      fmt(hits.length) + " mục · " + fmt(senseCount(hits)) + " nghĩa"
      + (q ? " khớp “" + query.trim() + "”" : "");

    if (!hits.length) {
      var p = el("p", "empty", "Không tìm thấy “" + query.trim() + "”. ");
      if (canWrite) {
        var a = el("button", "btn", "Thêm từ này");
        a.type = "button";
        a.addEventListener("click", function () { openForm(query.trim()); });
        p.appendChild(document.createElement("br"));
        p.appendChild(document.createElement("br"));
        p.appendChild(a);
      }
      list.appendChild(p);
      return;
    }

    var letter = null;
    var frag = document.createDocumentFragment();
    var cap = Math.min(hits.length, 600);
    for (var i = 0; i < cap; i++) {
      var e = hits[i];
      if (!q) {
        var L = (e._w[0] || "#").toUpperCase();
        if (L !== letter) { letter = L; frag.appendChild(el("li", "letter", L)); }
      }
      frag.appendChild(hitRow(e, q, i));
    }
    if (hits.length > cap) {
      frag.appendChild(el("li", "empty", "Còn " + fmt(hits.length - cap) + " mục nữa — gõ thêm để thu hẹp."));
    }
    list.appendChild(frag);
  }

  function hitRow(e, q, i) {
    var li = el("li");
    var b = el("button", "hit");
    b.type = "button";
    b.dataset.i = i;
    b.setAttribute("aria-current", e.id === selectedId ? "true" : "false");
    var hw = el("span", "hw");
    markUp(hw, e.word, q);
    b.appendChild(hw);
    if (e.pos) b.appendChild(el("span", "ipa", "(" + e.pos + ")"));
    if (e.ipa) b.appendChild(el("span", "ipa", e.ipa));
    if (e.mine) b.appendChild(el("span", "mine-dot"));
    var g = el("span", "gloss");
    markUp(g, glossOf(e), q);
    b.appendChild(g);
    b.addEventListener("click", function () { select(e.id, i); focusDetail(); });
    li.appendChild(b);
    return li;
  }

  function select(id, i) {
    selectedId = id;
    cursor = typeof i === "number" ? i : hits.findIndex(function (e) { return e.id === id; });
    document.querySelectorAll(".hit").forEach(function (n) {
      n.setAttribute("aria-current", String(Number(n.dataset.i) === cursor));
    });
    drawDetail();
  }
  function focusDetail() {
    document.body.dataset.view = "detail";
    document.querySelector(".detail").scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* ---- vẽ khung chi tiết --------------------------------------------- */
  function drawDetail() {
    var host = document.getElementById("detail");
    host.textContent = "";
    if (view === "read") {
      host.appendChild(selectedRead ? readingView(selectedRead) : blankView());
      return;
    }
    var e = entries.find(function (x) { return x.id === selectedId; });
    host.appendChild(e ? entryView(e) : blankView());
  }

  function blankView() {
    var w = el("div", "blank");
    w.appendChild(el("h2", null, view === "read" ? "Chọn một bài đọc" : "Tra một từ"));
    w.appendChild(el("p", null, view === "read"
      ? "Gõ vào ô tìm kiếm để lọc theo tiêu đề hoặc nội dung bài."
      : "Gõ tiếng Anh hoặc tiếng Việt — trang tìm cả trong từ, phiên âm, định nghĩa và nghĩa tiếng Việt. Không dấu vẫn ra."));
    var dl = el("dl");
    [["/", "nhảy vào ô tìm kiếm"],
     ["↑ ↓", "đi trong danh sách"],
     ["Enter", "mở mục đang chọn"],
     ["Esc", "xoá ô tìm kiếm"]].forEach(function (p) {
      var dt = el("dt");
      dt.appendChild(el("span", null, p[0]));
      dl.appendChild(dt);
      dl.appendChild(el("dd", null, p[1]));
    });
    w.appendChild(dl);
    if (MODE === "static" && view !== "read") {
      w.appendChild(el("p", null,
        "Từ bạn thêm ở bản này được lưu trong chính trình duyệt bạn đang dùng — "
        + "nhớ bấm “Sao lưu .json” nếu muốn giữ lâu dài."));
    }
    return w;
  }

  function entryView(e) {
    var art = el("article", "entry");
    var head = el("div", "entry-head");
    head.appendChild(el("h1", "headword", e.word));
    if (e.pos) head.appendChild(el("span", "pos", e.pos + "."));
    if (e.ipa) head.appendChild(el("span", "ipa", e.ipa));
    head.appendChild(el("span", "kind", (KINDS[e.type] || KINDS.word).label));
    if (e.mine) head.appendChild(el("span", "kind kind-mine", "Của tôi"));
    art.appendChild(head);
    if (e.note) art.appendChild(el("p", "note", e.note));

    var senses = e.senses || [];
    var ol = el("ol", "senses");
    senses.forEach(function (s, i) {
      var li = el("li", "sense" + (senses.length > 1 ? "" : " solo"));
      if (senses.length > 1) li.appendChild(el("span", "num", String(i + 1)));
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

    if (e.type === "compare" && e.group) {
      var sibs = entries.filter(function (x) {
        return x.type === "compare" && x.group === e.group && x.id !== e.id;
      });
      if (sibs.length) {
        var rel = el("div", "related");
        rel.appendChild(el("h2", null, "Dễ nhầm với"));
        var ul = el("ul");
        sibs.forEach(function (x) {
          var li = el("li");
          var b = el("button", null, x.word);
          b.type = "button";
          b.addEventListener("click", function () { select(x.id); });
          li.appendChild(b);
          ul.appendChild(li);
        });
        rel.appendChild(ul);
        art.appendChild(rel);
      }
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

  /* ---- thêm / xoá từ -------------------------------------------------- */
  function newSenseRow(n) {
    var box = el("div", "sense-edit");
    box.dataset.sense = "1";
    var row = el("div", "row");
    row.appendChild(el("span", "lab", "Nghĩa " + n));
    var drop = el("button", "btn btn-quiet drop", "Bỏ");
    drop.type = "button";
    drop.addEventListener("click", function () {
      box.remove();
      renumberSenses();
    });
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
    boxes.forEach(function (b, i) {
      b.querySelector(".lab").textContent = "Nghĩa " + (i + 1);
      b.querySelector(".drop").hidden = boxes.length === 1;
    });
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
    document.querySelectorAll("#sense-list .sense-edit").forEach(function (b) {
      var def = b.querySelector("[name=def]").value.trim();
      var vi = b.querySelector("[name=vi]").value.trim();
      if (def || vi) senses.push({ def: def, vi: vi, eg: [] });
    });
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
    btn.disabled = true;
    btn.textContent = "Đang lưu…";
    msg.textContent = "";
    var next = ADDED.concat([got.entry]);
    persist(next).then(function (res) {
      btn.disabled = false;
      btn.textContent = "Lưu từ";
      if (res.ok && res.reload) {
        document.getElementById("form-dlg").close();
        toast("Đã lưu “" + got.entry.word + "”");
        return;                       // trang sẽ tự tải lại bản mới
      }
      ADDED = next;                   // vẫn hiện ngay, đã có trong sao lưu
      if (res.ok) {
        rebuild();
        document.getElementById("form-dlg").close();
        refresh();
        select(got.entry.id);
        toast("Đã lưu “" + got.entry.word + "” vào trình duyệt này");
        return;
      }
      got.entry.pendingSync = true;
      pending.push(got.entry);
      rebuild();
      document.getElementById("form-dlg").close();
      refresh();
      select(got.entry.id);
      banner(res.msg, "Đồng bộ", syncPending);
    });
  }

  function removeEntry(e) {
    if (!window.confirm("Xoá “" + e.word + "” khỏi sổ?")) return;
    var next = ADDED.filter(function (x) { return x.id !== e.id; });
    persist(next).then(function (res) {
      if (res.ok && res.reload) { toast("Đã xoá"); return; }
      ADDED = next;
      pending = pending.filter(function (x) { return x.id !== e.id; });
      rebuild();
      selectedId = null;
      refresh();
      if (res.ok) { toast("Đã xoá"); return; }
      banner(res.msg, "Đồng bộ", syncPending);
    });
  }

  function syncPending() {
    banner("Đang đồng bộ…", null, null);
    persist(ADDED).then(function (res) {
      if (res.ok) return;
      banner(res.msg, "Thử lại", syncPending);
    });
  }

  /* ---- export -------------------------------------------------------- */
  function exportJson() {
    var payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      entries: entries.map(function (e) {
        return { word: e.word, pos: e.pos, ipa: e.ipa, type: e.type, note: e.note, senses: e.senses, mine: !!e.mine };
      }),
      readings: READINGS
    }, null, 2);
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

  /* ---- chrome -------------------------------------------------------- */
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

  function refresh() {
    search();
    drawHits();
    drawDetail();
    drawChips();
    document.getElementById("tally").textContent =
      fmt(entries.length) + " mục · " + fmt(senseCount(entries)) + " nghĩa"
      + (READINGS.length ? " · " + fmt(READINGS.length) + " bài đọc" : "");
  }

  function drawChips() {
    var box = document.getElementById("chips");
    box.textContent = "";
    var counts = { all: entries.length, mine: 0 };
    KIND_ORDER.forEach(function (k) { counts[k] = 0; });
    entries.forEach(function (e) {
      counts[e.type] = (counts[e.type] || 0) + 1;
      if (e.mine) counts.mine++;
    });
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

  /* ---- khung trang --------------------------------------------------- */
  function build() {
    var app = document.getElementById("app");

    var top = el("header", "top");
    var brand = el("div", "brand");
    brand.appendChild(el("span", "mark", "Sổ Tra Từ"));
    brand.appendChild(el("span", "tally")).id = "tally";
    top.appendChild(brand);

    var back = el("button", "btn btn-quiet back", "← Danh sách");
    back.type = "button";
    back.addEventListener("click", function () { document.body.dataset.view = "list"; });
    top.appendChild(back);

    var tabs = el("div", "tabs");
    tabs.setAttribute("role", "tablist");
    // Bản công khai không kèm bài đọc — khi đó bỏ luôn tab.
    var tabDefs = READINGS.length ? [["vocab", "Từ vựng"], ["read", "Bài đọc"]] : [];
    tabDefs.forEach(function (t) {
      var b = el("button", "tab", t[1]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(view === t[0]));
      b.addEventListener("click", function () {
        view = t[0];
        tabs.querySelectorAll(".tab").forEach(function (n, i) {
          n.setAttribute("aria-selected", String(i === (t[0] === "vocab" ? 0 : 1)));
        });
        document.getElementById("chips").hidden = view === "read";
        document.getElementById("q").placeholder = view === "read"
          ? "Tìm trong bài đọc…" : "Tra từ, nghĩa, hoặc tiếng Việt…";
        refresh();
      });
      tabs.appendChild(b);
    });
    top.appendChild(tabs);

    var acts = el("div", "acts");
    var add = el("button", "btn btn-primary", "+ Thêm từ");
    add.type = "button";
    add.dataset.write = "1";
    add.addEventListener("click", function () { openForm(query.trim()); });
    acts.appendChild(add);
    var exp = el("button", "btn", "Sao lưu .json");
    exp.type = "button";
    exp.addEventListener("click", exportJson);
    acts.appendChild(exp);
    top.appendChild(acts);
    app.appendChild(top);

    var bn = el("div", "banner");
    bn.id = "banner";
    bn.hidden = true;
    app.appendChild(bn);

    var work = el("div", "work");
    var rail = el("aside", "rail");
    var rh = el("div", "rail-head");
    var searchBox = el("div", "search");
    searchBox.innerHTML = '<svg class="glass" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';
    var input = el("input");
    input.id = "q";
    input.type = "search";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Tìm từ");
    input.placeholder = "Tra từ, nghĩa, hoặc tiếng Việt…";
    searchBox.appendChild(input);
    searchBox.appendChild(el("kbd", null, "/"));
    rh.appendChild(searchBox);
    var chips = el("div", "chips");
    chips.id = "chips";
    rh.appendChild(chips);
    rail.appendChild(rh);
    var tl = el("div", "tally-line");
    tl.id = "tally-line";
    rail.appendChild(tl);
    var hitList = el("ol", "hits");
    hitList.id = "hits";
    rail.appendChild(hitList);
    work.appendChild(rail);

    var detail = el("section", "detail");
    detail.id = "detail";
    work.appendChild(detail);
    app.appendChild(work);

    var t = el("div", "toast");
    t.id = "toast";
    t.hidden = true;
    t.setAttribute("role", "status");
    app.appendChild(t);

    app.appendChild(buildDialog());

    input.addEventListener("input", function () {
      query = input.value;
      cursor = -1;
      search2();
    });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { input.value = ""; query = ""; search2(); }
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); move(ev.key === "ArrowDown" ? 1 : -1); }
      if (ev.key === "Enter" && hits.length) {
        ev.preventDefault();
        select(hits[Math.max(cursor, 0)].id, Math.max(cursor, 0));
        focusDetail();
      }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "/" && document.activeElement !== input && !isTyping(ev.target)) {
        ev.preventDefault();
        input.focus();
        input.select();
      }
    });

    // Cột trái dính ngay dưới thanh đầu trang, dù thanh cao bao nhiêu.
    function measure() {
      document.documentElement.style.setProperty("--top-h", top.offsetHeight + "px");
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("load", measure);
  }

  function isTyping(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }
  function search2() { refresh(); }

  function move(d) {
    if (view === "read" || !hits.length) return;
    cursor = Math.max(0, Math.min(hits.length - 1, cursor + d));
    select(hits[cursor].id, cursor);
    var node = document.querySelector('.hit[data-i="' + cursor + '"]');
    if (node) node.scrollIntoView({ block: "nearest" });
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
    var msg = el("span", "dlg-msg");
    msg.id = "form-msg";
    foot.appendChild(msg);
    var sp = el("span", "spacer");
    foot.appendChild(sp);
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

  /* ---- khởi động ------------------------------------------------------ */
  function boot() {
    build();

    // Gộp lại những từ còn trong sao lưu cục bộ mà bản đã publish chưa có.
    var backup = readBackup();
    var known = {};
    ADDED.forEach(function (e) { known[e.id] = true; });
    pending = backup.filter(function (e) { return e && e.id && !known[e.id]; });
    if (pending.length) {
      ADDED = ADDED.concat(pending);
      if (MODE !== "static") {
        banner(pending.length + " từ trong bản sao lưu trên máy này chưa có trên máy chủ.", "Đồng bộ", syncPending);
      }
    } else if (backup.length !== ADDED.length) {
      writeBackup(ADDED);
    }

    rebuild();
    refresh();

    if (MODE === "static") return;
    // Quyền ghi có thể được gắn vào ngay sau khi trang chạy, nên thử lại
    // một nhịp trước khi chuyển hẳn sang chế độ chỉ xem.
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

  boot();
})();
