/* EngrowDict — an English–Vietnamese vocabulary notebook.

   Two build modes:
   - "artifact": data is embedded in the page; adding or removing a word makes
     the page republish itself, so new words are stored on the server.
   - "static":  a light shell that fetches data.json from the same folder; new
     words live in each visitor's own localStorage.

   The result list is virtualised — 11k entries cannot all live in the DOM. */
(function () {
  "use strict";

  var FONT_URL = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;450;500;600&display=swap";
  var BACKUP_KEY = "engrowdict:added:v1";
  var SETTINGS_KEY = "engrowdict:settings:v1";
  var DEFAULT_PASSCODE = "229922";
  var ROW_H = 64;          // must match .hit in app.css
  var MARK_H = 28;         // must match .letter-mark
  var OVERSCAN = 6;

  var KINDS = {
    word:       { label: "Word",            filter: "Words" },
    phrasal:    { label: "Phrasal verb",    filter: "Phrasal" },
    idiom:      { label: "Idiom",           filter: "Idioms" },
    expression: { label: "Common",          filter: "Common" },
    compare:    { label: "Easily mixed up", filter: "" }
  };
  var KIND_ORDER = ["word", "phrasal", "idiom", "expression", "compare"];
  // the filter row mirrors the sheet's own tabs, and nothing else
  var CHIP_KINDS = ["word", "phrasal", "idiom", "expression"];
  var ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

  /* ---- state ------------------------------------------------------------ */
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
  var rows = [];             // rows feeding the virtual list
  var hits = [];             // matching entries, for prev/next
  var counts = {};
  var selectedId = null;
  var selectedRead = null;

  /* ---- helpers ---------------------------------------------------------- */
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
  function fmt(n) { return n.toLocaleString("en-US"); }
  function plural(n, one, many) { return fmt(n) + " " + (n === 1 ? one : many); }
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

    byWord = {};
    for (var k = 0; k < entries.length; k++) {
      if (!byWord[entries[k]._w]) byWord[entries[k]._w] = entries[k];
    }
  }

  /* ---- looking a selection up -------------------------------------------- */
  var byWord = {};

  /* Crude but serviceable stemming: enough to get from "explained" or
     "carrying" back to a headword the notebook actually holds. */
  function lemmas(w) {
    var out = [w];
    function add(x) { if (x && x.length > 1 && out.indexOf(x) < 0) out.push(x); }
    if (/ies$/.test(w)) add(w.replace(/ies$/, "y"));
    if (/(ches|shes|sses|xes|zes)$/.test(w)) add(w.slice(0, -2));
    if (/s$/.test(w) && !/ss$/.test(w)) add(w.slice(0, -1));
    if (/ied$/.test(w)) add(w.replace(/ied$/, "y"));
    if (/ed$/.test(w)) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
    if (/ing$/.test(w)) { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); }
    if (/([bdfglmnprt])\1(ed|ing)$/.test(w)) add(w.replace(/([bdfglmnprt])\1(ed|ing)$/, "$1"));
    if (/est$/.test(w)) add(w.slice(0, -3));
    if (/er$/.test(w)) add(w.slice(0, -2));
    if (/ly$/.test(w)) add(w.slice(0, -2));
    return out;
  }

  /** Best entry for a selected run of text, or null. */
  function lookupText(text) {
    var clean = text.replace(/[“”"'’(),.;:!?—–]/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return null;
    var whole = norm(clean);
    if (byWord[whole]) return byWord[whole];

    var words = whole.split(" ");
    if (words.length > 1) {
      // try the longest run that is an entry, e.g. "make up for" inside a line
      for (var len = Math.min(words.length, 5); len >= 2; len--) {
        for (var i = 0; i + len <= words.length; i++) {
          var run = words.slice(i, i + len).join(" ");
          if (byWord[run]) return byWord[run];
        }
      }
      return null;
    }
    var forms = lemmas(whole);
    for (var j = 0; j < forms.length; j++) {
      if (byWord[forms[j]]) return byWord[forms[j]];
    }
    return null;
  }

  function translateUrl(text) {
    return "https://translate.google.com/?sl=en&tl=vi&op=translate&text="
      + encodeURIComponent(text);
  }

  /* The notebook holds advanced vocabulary, so most running words in a passage
     are not in it. Machine translation covers the rest — English to Vietnamese,
     which is the only direction this is ever used in. It needs the open web, so
     it works on the published site and not inside the claude.ai artifact. */
  var mtCache = {};
  function machineTranslate(text) {
    var key = text.toLowerCase();
    if (mtCache[key]) return Promise.resolve(mtCache[key]);
    if (MODE !== "static" || typeof fetch !== "function") {
      return Promise.reject(new Error("offline"));
    }
    return fetch("https://api.mymemory.translated.net/get?langpair=en%7Cvi&q="
      + encodeURIComponent(text))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var t = d && d.responseData && d.responseData.translatedText;
        if (!t || /MYMEMORY WARNING|INVALID/i.test(t)) throw new Error("no translation");
        mtCache[key] = t;
        return t;
      });
  }

  /* ---- local backup ------------------------------------------------------ */
  function readBackup() {
    try {
      var raw = localStorage.getItem(BACKUP_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) { return []; }
  }
  function writeBackup(list) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(list)); } catch (err) { /* quota */ }
  }

  /* ---- settings ---------------------------------------------------------- */
  /* Everything here stays in this browser. The sync link and key never ship
     inside the page, which is what keeps other visitors from writing to the
     sheet. The passcode only gates this interface — anyone who reads the page
     source can find it, so treat it as a guard against stray clicks, not as
     real security. */
  var settings = { sheetUrl: "", webApp: "", key: "", code: DEFAULT_PASSCODE, unlocked: false };

  function readSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        settings.sheetUrl = s.sheetUrl || "";
        settings.webApp = s.webApp || "";
        settings.key = s.key || "";
        settings.code = s.code || DEFAULT_PASSCODE;
        settings.unlocked = !!s.unlocked;
      }
    } catch (err) { /* ignore */ }
  }
  function writeSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (err) { /* ignore */ }
  }
  function unlocked() { return settings.unlocked; }
  function mayAdd() { return canWrite && unlocked(); }
  function canWriteSheet() {
    return MODE === "static" && unlocked() && !!settings.webApp && !!settings.key;
  }

  /* Apps Script accepts a plain POST with no custom headers, so no preflight. */
  function callSheet(payload) {
    payload.key = settings.key;
    return fetch(settings.webApp, {
      method: "POST",
      body: JSON.stringify(payload),
      redirect: "follow"
    }).then(function (r) {
      return r.json();
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || "The sheet rejected the request");
      return res;
    });
  }

  /* ---- self-republish (artifact mode only) -------------------------------- */
  function renderPage(added) {
    var css = document.getElementById("css").textContent;
    var mode = document.getElementById("mode").textContent;
    var base = document.getElementById("base").textContent;
    var js = document.getElementById("appjs").textContent;
    var S = "<" + "script";
    var E = "<" + "/" + "script>";
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
      + "<title>EngrowDict</title>\n"
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
    banner("This copy is read-only — words you add stay on this device.", null, null);
    refreshChrome();
  }

  function persist(nextAdded) {
    writeBackup(nextAdded);
    if (MODE === "static") return Promise.resolve({ ok: true, reload: false });
    if (!window.claude || !window.claude.use) {
      goReadOnly();
      return Promise.resolve({ ok: false, msg: "Saved on this device. Open the page from claude.ai to store it for good." });
    }
    return window.claude.use("artifact").then(function (art) {
      if (!art) {
        goReadOnly();
        return { ok: false, msg: "Saved on this device. This copy cannot write to the server." };
      }
      return art.publish(renderPage(nextAdded)).then(function () {
        return { ok: true, reload: true };
      }, function (err) {
        var code = err && err.code;
        if (code === "conflict") {
          return { ok: false, msg: "Someone saved first. The page is reloading — your word is in the local backup, press Sync once it is back." };
        }
        if (code === "not_writer" || code === "not_granted" || code === "not_declared"
          || code === "capability_disabled" || code === "capability_removed" || code === "consent_required") {
          goReadOnly();
          return { ok: false, msg: "You do not have write access to this page. The word is saved on your device." };
        }
        if (code === "rate_limited") return { ok: false, msg: "Saving too fast. Wait a moment, then press Sync." };
        if (code === "too_large") return { ok: false, msg: "The page is too large to save anything more to the server." };
        return { ok: false, msg: "Could not save to the server. The word is in the local backup." };
      });
    });
  }

  /* ---- search ------------------------------------------------------------ */
  function pool() {
    if (view === "read") return READINGS;
    if (kindFilter === "all") return entries;
    return entries.filter(function (e) {
      return kindFilter === "mine" ? !!e.mine : e.type === kindFilter;
    });
  }

  /* Exact word, then prefix, then a word inside a phrase, then anywhere in the
     headword, then anywhere at all. */
  function rankEntries(q, src, limit) {
    var buckets = [[], [], [], [], []], found = 0;
    for (var i = 0; i < src.length; i++) {
      var e = src[i], w = e._w, s = -1;
      if (w === q) s = 0;
      else if (w.lastIndexOf(q, 0) === 0) s = 1;
      else if (w.indexOf(" " + q) > -1) s = 2;
      else if (w.indexOf(q) > -1) s = 3;
      else if (e._all.indexOf(q) > -1) s = 4;
      if (s > -1) {
        buckets[s].push(e);
        if (limit && ++found >= limit * 4) break;
      }
    }
    var out = buckets[0].concat(buckets[1], buckets[2], buckets[3], buckets[4]);
    return limit ? out.slice(0, limit) : out;
  }

  function search() {
    var q = norm(query.trim());
    var src = pool();
    if (!q) { hits = src; return; }
    hits = rankEntries(q, src, 0);
  }

  /* With no query, letter marks are woven in so browsing feels like flipping
     through a printed dictionary. */
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

  /* ---- virtual list ------------------------------------------------------- */
  var scrollBox, spacer, windowBox, drawnFrom = -1, drawnTo = -1;

  function findRow(y) {
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
      frag.appendChild(rows[i].mark ? el("div", "letter-mark", rows[i].mark) : hitRow(rows[i], q));
    }
    windowBox.style.transform = "translateY(" + rows[from].y + "px)";
    windowBox.textContent = "";
    windowBox.appendChild(frag);
  }

  function hitRow(r, q) {
    var e = r.e;
    var b = el("button", "hit");
    b.type = "button";
    b.dataset.i = r.i;
    b.setAttribute("aria-current", e.id === selectedId ? "true" : "false");
    b.addEventListener("click", function () { select(e.id); showDetail(); });

    var line = el("div", "top-line");
    if (e.paras) {                                  // a reading passage
      b.className = "hit passage";
      b.appendChild(el("span", "idx", e.index));
      var col = el("div", "col");
      var thw = el("span", "hw");
      markUp(thw, e.title, q);
      col.appendChild(thw);
      var tg = el("span", "gloss");
      markUp(tg, e.paras[0].text, q);
      col.appendChild(tg);
      b.appendChild(col);
      return b;
    }
    var hw = el("span", "hw");
    markUp(hw, e.word, q);
    line.appendChild(hw);
    if (e.pos) line.appendChild(el("span", "pos", e.pos));
    if (e.mine) line.appendChild(el("span", "mine-dot"));
    if (e.senses.length > 1) line.appendChild(el("span", "senses-n", e.senses.length + " senses"));
    b.appendChild(line);
    var g = el("span", "gloss");
    markUp(g, glossOf(e), q);
    b.appendChild(g);
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

  /* ---- selection ---------------------------------------------------------- */
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

  /* ---- A–Z rail ----------------------------------------------------------- */
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

  /* ---- detail pane -------------------------------------------------------- */
  function drawDetail() {
    hideLookup();
    var host = document.getElementById("detail-inner");
    host.textContent = "";
    // a passage runs the full width; an entry keeps a narrower measure
    host.className = "detail-inner" + (view === "read" && selectedRead ? " wide" : "");
    if (view === "read") {
      host.appendChild(selectedRead ? readingView(selectedRead) : blankView());
      return;
    }
    var e = byId[selectedId];
    if (e && !e.senses) e = null;            // a passage id left over from the other view
    host.appendChild(e ? entryView(e) : blankView());
  }

  function entryView(e) {
    var art = el("article", "entry");

    var at = cursorIndex();
    var nav = el("div", "entry-nav");
    var prev = el("button", "iconbtn", "←");
    prev.type = "button";
    prev.title = "Previous entry (← key)";
    prev.disabled = at <= 0;
    prev.addEventListener("click", function () { step(-1); });
    var next = el("button", "iconbtn", "→");
    next.type = "button";
    next.title = "Next entry (→ key)";
    next.disabled = at < 0 || at >= hits.length - 1;
    next.addEventListener("click", function () { step(1); });
    nav.appendChild(prev);
    nav.appendChild(next);
    if (at > -1) nav.appendChild(el("span", "pos-in-list", fmt(at + 1) + " of " + fmt(hits.length)));
    nav.appendChild(el("span", "grow"));
    if (e.mine && mayAdd()) nav.appendChild(entryMenu(e));
    art.appendChild(nav);

    var head = el("div", "entry-head");
    head.appendChild(el("h1", "headword", e.word));
    if (e.pos) head.appendChild(el("span", "pos-big", e.pos + "."));
    if (e.ipa) head.appendChild(el("span", "ipa", e.ipa));
    head.appendChild(el("span", "kind", kindOf(e)));
    if (e.mine) head.appendChild(el("span", "kind kind-mine", "Added by me"));
    if (e.mine && canWriteSheet()) {
      head.appendChild(el("span", "kind" + (e.inSheet ? " kind-sheet" : ""),
        e.inSheet ? "In the sheet" : "Not in the sheet"));
    }
    art.appendChild(head);
    if (e.note) art.appendChild(el("p", "note", e.note));

    var ol = el("ol", "senses");
    e.senses.forEach(function (s, i) {
      var li = el("li", "sense" + (e.senses.length > 1 ? "" : " solo"));
      if (e.senses.length > 1) li.appendChild(el("span", "num", String(i + 1)));
      var body = el("div", "body");
      if (s.def) body.appendChild(defNode(s.def));
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
      box.appendChild(el("h2", null, e.type === "compare" ? "Easily mixed up with"
        : e.type === "phrasal" ? "Same verb" : "Same root"));
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

    return art;
  }

  /* A button that drops a small menu, closing on Escape or a click elsewhere. */
  function makeMenu(glyph, label) {
    var wrap = el("div", "menu-wrap");
    var trigger = el("button", "iconbtn", glyph);
    trigger.type = "button";
    trigger.title = label;
    trigger.setAttribute("aria-label", label);
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");

    var menu = el("div", "menu");
    menu.hidden = true;

    function close() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onAway, true);
      document.removeEventListener("keydown", onKey, true);
    }
    function onAway(ev) { if (!wrap.contains(ev.target)) close(); }
    function onKey(ev) { if (ev.key === "Escape") { close(); trigger.focus(); } }

    trigger.addEventListener("click", function () {
      if (menu.hidden) {
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        document.addEventListener("click", onAway, true);
        document.addEventListener("keydown", onKey, true);
      } else {
        close();
      }
    });

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    return { wrap: wrap, menu: menu, trigger: trigger, close: close };
  }

  /* Destructive actions live behind a menu rather than sitting in the entry,
     where they are one stray click away. */
  function entryMenu(e) {
    var m = makeMenu("☰", "Options for this entry");
    var del = el("button", "menu-item danger", "Delete this word");
    del.type = "button";
    del.addEventListener("click", function () {
      m.close();
      removeEntry(e);
    });
    m.menu.appendChild(del);
    return m.wrap;
  }

  /* ---- a dictionary you can keep open while reading ---------------------- */
  /* On the Passages tab the search box searches the passages, so looking a
     word up used to mean leaving what you were reading. This floats over it
     instead: type, pick, read, drag it out of the way. */
  var POP_KEY = "engrowdict:pop:v1";
  var popEl = null, popPicked = null;

  function popOpen() { return !!popEl && !popEl.hidden; }

  function buildPopDict() {
    var w = el("div", "popdict");
    w.id = "popdict";
    w.hidden = true;

    var head = el("div", "pd-head");
    head.appendChild(el("span", "pd-title", "Look up"));
    var x = el("button", "pd-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", closePopDict);
    head.appendChild(x);
    w.appendChild(head);

    var sbox = el("div", "pd-search");
    var inp = el("input");
    inp.id = "pd-q";
    inp.type = "search";
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.placeholder = "Search the dictionary…";
    inp.setAttribute("aria-label", "Search the dictionary");
    inp.addEventListener("input", function () { popPicked = null; drawPopDict(); });
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { ev.stopPropagation(); closePopDict(); }
    });
    sbox.appendChild(inp);
    w.appendChild(sbox);

    var body = el("div", "pd-body");
    body.id = "pd-body";
    w.appendChild(body);

    // dragged by its header, and it stays where you put it
    var drag = null;
    head.addEventListener("mousedown", function (ev) {
      if (ev.target === x) return;
      drag = { x: ev.clientX - w.offsetLeft, y: ev.clientY - w.offsetTop };
      ev.preventDefault();
    });
    document.addEventListener("mousemove", function (ev) {
      if (!drag) return;
      var maxL = (window.innerWidth || 1200) - w.offsetWidth - 6;
      var maxT = (window.innerHeight || 800) - 40;
      w.style.left = Math.min(Math.max(6, ev.clientX - drag.x), Math.max(6, maxL)) + "px";
      w.style.top = Math.min(Math.max(6, ev.clientY - drag.y), Math.max(6, maxT)) + "px";
      w.style.right = "auto";
      w.style.bottom = "auto";
    });
    document.addEventListener("mouseup", function () {
      if (!drag) return;
      drag = null;
      try {
        localStorage.setItem(POP_KEY, JSON.stringify({ left: w.style.left, top: w.style.top }));
      } catch (err) { /* ignore */ }
    });
    return w;
  }

  function drawPopDict() {
    var body = document.getElementById("pd-body");
    var inp = document.getElementById("pd-q");
    body.textContent = "";

    if (popPicked) {
      var back = el("button", "pd-back", "‹ results");
      back.type = "button";
      back.addEventListener("click", function () { popPicked = null; drawPopDict(); });
      body.appendChild(back);
      body.appendChild(popEntry(popPicked));
      return;
    }

    var q = norm(inp.value.trim());
    if (!q) {
      body.appendChild(el("p", "pd-note",
        "Type a word, or select one in the passage behind."));
      return;
    }
    var found = rankEntries(q, entries, 40);
    if (!found.length) {
      body.appendChild(el("p", "pd-note", "Nothing in the notebook matches that."));
      return;
    }
    var list = el("ul", "pd-hits");
    found.forEach(function (e) {
      var li = el("li");
      var b = el("button", "pd-hit");
      b.type = "button";
      var line = el("span", "pd-w", e.word);
      if (e.pos) line.appendChild(el("i", null, e.pos));
      b.appendChild(line);
      b.appendChild(el("span", "pd-vi", glossOf(e)));
      b.addEventListener("click", function () { popPicked = e; drawPopDict(); });
      li.appendChild(b);
      list.appendChild(li);
    });
    body.appendChild(list);
  }

  function popEntry(e) {
    var box = el("div", "pd-entry");
    var h = el("div", "pd-head-word");
    h.appendChild(el("span", "pd-hw", e.word));
    if (e.pos) h.appendChild(el("span", "pd-pos", e.pos + "."));
    if (e.ipa) h.appendChild(el("span", "pd-ipa", e.ipa));
    box.appendChild(h);
    e.senses.forEach(function (sn, i) {
      var s = el("div", "pd-sense");
      if (e.senses.length > 1) s.appendChild(el("span", "pd-num", String(i + 1)));
      var col = el("div");
      if (sn.def) col.appendChild(defNode(sn.def));
      if (sn.vi) col.appendChild(el("p", "vi", sn.vi));
      s.appendChild(col);
      box.appendChild(s);
    });
    var full = el("button", "btn", "Open in the dictionary");
    full.type = "button";
    full.addEventListener("click", function () {
      closePopDict();
      view = "vocab";
      selectedId = e.id;
      selectedRead = null;
      query = "";
      if (qInput) qInput.value = "";
      syncViewButtons();
      refresh();
      select(e.id);
      showDetail();
    });
    box.appendChild(full);
    return box;
  }

  function openPopDict(prefill) {
    if (!popEl) {
      popEl = buildPopDict();
      document.getElementById("app").appendChild(popEl);
      try {
        var s = JSON.parse(localStorage.getItem(POP_KEY) || "{}");
        if (s.left) { popEl.style.left = s.left; popEl.style.top = s.top; popEl.style.right = "auto"; }
      } catch (err) { /* ignore */ }
    }
    popEl.hidden = false;
    var inp = document.getElementById("pd-q");
    if (prefill != null) { inp.value = prefill; popPicked = null; }
    drawPopDict();
    inp.focus();
    inp.select();
    syncPopButton();
  }

  function closePopDict() {
    if (popEl) popEl.hidden = true;
    syncPopButton();
  }

  function syncPopButton() {
    var b = document.getElementById("popdict-btn");
    if (!b) return;
    b.hidden = view !== "read";
    b.setAttribute("aria-pressed", String(popOpen()));
    b.className = popOpen() ? "btn btn-primary" : "btn";
  }

  /* ---- the divider: drag to resize, click the chevron to fold away -------- */
  var LIST_KEY = "engrowdict:list:v1";
  var LIST_MIN = 240, LIST_MAX = 620, LIST_DEFAULT = 348;

  function listWidth(px) {
    document.documentElement.style.setProperty("--list-w", Math.round(px) + "px");
  }

  function currentListWidth() {
    return parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue("--list-w"), 10) || LIST_DEFAULT;
  }

  function saveListWidth() {
    try {
      var s = JSON.parse(localStorage.getItem(LIST_KEY) || "{}");
      s.w = currentListWidth();
      localStorage.setItem(LIST_KEY, JSON.stringify(s));
    } catch (err) { /* ignore */ }
  }

  function setListOpen(open) {
    document.body.dataset.list = open ? "on" : "off";
    var chev = document.getElementById("fold");
    if (chev) {
      chev.textContent = open ? "‹" : "›";
      chev.title = open ? "Hide the list" : "Show the list";
      chev.setAttribute("aria-label", chev.title);
      chev.setAttribute("aria-expanded", String(open));
    }
    try {
      var s = JSON.parse(localStorage.getItem(LIST_KEY) || "{}");
      s.open = open;
      localStorage.setItem(LIST_KEY, JSON.stringify(s));
    } catch (err) { /* ignore */ }
    paint(true);
  }

  function restoreList() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(LIST_KEY) || "{}"); } catch (err) { s = {}; }
    listWidth(Math.min(LIST_MAX, Math.max(LIST_MIN, s.w || LIST_DEFAULT)));
    setListOpen(s.open !== false);
  }

  function buildResizer() {
    var bar = el("div", "resizer");
    bar.id = "resizer";
    bar.setAttribute("role", "separator");
    bar.setAttribute("aria-orientation", "vertical");

    var chev = el("button", "fold", "‹");
    chev.type = "button";
    chev.id = "fold";
    chev.addEventListener("click", function (ev) {
      ev.stopPropagation();
      setListOpen(document.body.dataset.list === "off");
    });
    bar.appendChild(chev);

    var dragging = false;
    function move(ev) {
      if (!dragging) return;
      var work = document.querySelector(".work");
      var railW = document.querySelector(".alpha").offsetWidth || 30;
      var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - work.getBoundingClientRect().left;
      listWidth(Math.min(LIST_MAX, Math.max(LIST_MIN, x - railW)));
    }
    function stop() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("resizing");
      saveListWidth();
      paint(true);
    }
    bar.addEventListener("mousedown", function (ev) {
      if (ev.target === chev || document.body.dataset.list === "off") return;
      dragging = true;
      document.body.classList.add("resizing");
      ev.preventDefault();
    });
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", stop);
    bar.addEventListener("touchstart", function (ev) {
      if (ev.target === chev || document.body.dataset.list === "off") return;
      dragging = true;
    }, { passive: true });
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", stop);

    // keyboard: the divider is focusable and moves in steps
    bar.tabIndex = 0;
    bar.addEventListener("keydown", function (ev) {
      var now = currentListWidth();
      if (ev.key === "ArrowLeft") listWidth(Math.max(LIST_MIN, now - 24));
      else if (ev.key === "ArrowRight") listWidth(Math.min(LIST_MAX, now + 24));
      else return;
      ev.preventDefault();
      saveListWidth();
      paint(true);
    });
    return bar;
  }

  /* Two views, two tabs — the dictionary and the passages are separate places
     rather than a switch on one place. */
  var TABS = [["vocab", "Dictionary", "tab-dictionary"], ["read", "Passages", "tab-passages"]];

  function buildTabs() {
    var strip = el("div", "tabs");
    strip.id = "tabs";
    strip.setAttribute("role", "tablist");
    TABS.forEach(function (t) {
      var b = el("button", "tab", t[1]);
      b.type = "button";
      b.id = t[2];
      b.setAttribute("role", "tab");
      b.dataset.view = t[0];
      b.addEventListener("click", function () {
        if (view === t[0]) return;
        view = t[0];
        selectedRead = null;
        selectedId = null;
        query = "";
        if (qInput) qInput.value = "";
        syncViewButtons();
        refresh();
      });
      strip.appendChild(b);
    });
    return strip;
  }

  /* Which tab is lit, and what the search box says it will search. */
  function syncViewButtons() {
    var strip = document.getElementById("tabs");
    if (strip) {
      var bs = strip.querySelectorAll(".tab");
      for (var i = 0; i < bs.length; i++) {
        bs[i].setAttribute("aria-selected", String(bs[i].dataset.view === view));
        bs[i].hidden = bs[i].dataset.view === "read" && !READINGS.length;
      }
    }
    if (qInput) {
      qInput.placeholder = view === "read"
        ? "Search inside the passages…" : "Search a word, a meaning, or Vietnamese…";
    }
    if (view !== "read") closePopDict();
    syncPopButton();
  }

  /* Many definitions lead with the exact form being defined — "be better off:
     to have more money…". The sheet sets that lead-in apart, so the page does
     too. A colon this early is always a lead-in in this data, never a sentence
     break. */
  function defNode(text) {
    var p = el("p", "def");
    var i = text.indexOf(":");
    if (i > 0 && i <= 70 && (text.charAt(i + 1) === " " || i === text.length - 1)) {
      p.appendChild(el("b", "term", text.slice(0, i)));
      p.appendChild(document.createTextNode(text.slice(i)));
    } else {
      p.textContent = text;
    }
    return p;
  }

  /* Related entries: the mixed-up group, the same phrasal verb, or same root. */
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
    var words = r._text.split(/\s+/).length;
    w.appendChild(el("p", "meta", "Passage " + r.index + " · " + fmt(words) + " words"));
    w.appendChild(el("p", "hint",
      "Select any word or phrase to see what the notebook has on it — English to Vietnamese."));
    var prose = el("div", "prose");
    r.paras.forEach(function (x) {
      var node = el("p", x.mark ? "labelled" : null, x.text);
      if (x.mark) {
        var m = el("span", "pmark", x.mark);
        m.setAttribute("aria-hidden", "true");
        node.insertBefore(m, node.firstChild);
      }
      prose.appendChild(node);
    });
    prose.addEventListener("mouseup", onSelectInProse);
    prose.addEventListener("touchend", onSelectInProse);
    w.appendChild(prose);
    return w;
  }

  /* ---- the card that opens over a selection ------------------------------- */
  var lookupCard = null;

  function onSelectInProse() {
    // let the browser settle the selection first
    setTimeout(function () {
      var sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed) { hideLookup(); return; }
      var text = String(sel).trim();
      if (!text || text.length > 120) { hideLookup(); return; }
      var rect = null;
      try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (err) { rect = null; }
      if (popOpen()) {
        var inp = document.getElementById("pd-q");
        inp.value = text;
        popPicked = lookupText(text);
        drawPopDict();
        return;
      }
      showLookup(text, rect);
    }, 0);
  }

  function hideLookup() {
    if (lookupCard) lookupCard.hidden = true;
  }

  function showLookup(text, rect) {
    if (!lookupCard) {
      lookupCard = el("div", "lookup");
      lookupCard.id = "lookup";
      document.getElementById("app").appendChild(lookupCard);
      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") hideLookup();
      });
      window.addEventListener("scroll", hideLookup, true);
    }
    lookupCard.textContent = "";

    var close = el("button", "x", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", hideLookup);
    lookupCard.appendChild(close);

    var found = lookupText(text);
    lookupCard.appendChild(el("div", "picked", found ? found.word : text));

    if (found) {
      var bits = [];
      if (found.pos) bits.push(found.pos + ".");
      var sub = el("div", "sub");
      if (bits.length) sub.appendChild(document.createTextNode(bits.join(" ") + " "));
      if (found.ipa) sub.appendChild(el("span", "ipa-inline", found.ipa));
      if (sub.textContent) lookupCard.appendChild(sub);

      var box = el("div", "glosses");
      found.senses.slice(0, 4).forEach(function (s) {
        var g = el("div", "g", s.vi || s.def);
        if (s.vi && s.def) g.appendChild(el("em", null, s.def));
        box.appendChild(g);
      });
      lookupCard.appendChild(box);

      var row = el("div", "row");
      var open = el("button", "btn", "Open entry");
      open.type = "button";
      open.addEventListener("click", function () {
        hideLookup();
        view = "vocab";
        selectedId = found.id;
        selectedRead = null;
        query = "";
        if (qInput) qInput.value = "";
        syncViewButtons();
        refresh();
        select(found.id);
        showDetail();
      });
      row.appendChild(open);
      lookupCard.appendChild(row);
    } else {
      var box2 = el("div", "glosses");
      var line = el("div", "g", "Translating…");
      box2.appendChild(line);
      lookupCard.appendChild(box2);

      var row2 = el("div", "row");
      var gt = document.createElement("a");
      gt.className = "btn";
      gt.target = "_blank";
      gt.rel = "noopener";
      gt.href = translateUrl(text);
      gt.textContent = "Open in Google Translate";
      row2.appendChild(gt);
      lookupCard.appendChild(row2);

      machineTranslate(text).then(function (vi) {
        line.textContent = vi;
        line.appendChild(el("em", null, "machine translation, not from the notebook"));
        place(lookupCard, rect);
      }, function () {
        line.remove();
        var none = el("p", "none",
          "Not in the notebook, and the translator could not be reached.");
        box2.appendChild(none);
        place(lookupCard, rect);
      });
    }

    lookupCard.hidden = false;
    place(lookupCard, rect);
  }

  function place(card, rect) {
    if (!rect) return;
    var pad = 10;
    var w = card.offsetWidth || 320;
    var h = card.offsetHeight || 160;
    var vw = window.innerWidth || 1024;
    var vh = window.innerHeight || 768;
    var left = Math.min(Math.max(pad, rect.left + rect.width / 2 - w / 2), vw - w - pad);
    var top = rect.bottom + 8;
    if (top + h > vh - pad) top = Math.max(pad, rect.top - h - 8);
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(top) + "px";
  }

  function blankView() {
    var w = el("div", "blank");
    if (view === "read") {
      w.appendChild(el("p", "lead", "Pick a passage"));
      w.appendChild(el("p", "sub", "Type in the search box to filter by title or by what is inside."));
      return w;
    }
    w.appendChild(el("p", "lead", "Look a word up, or flip through by letter"));
    w.appendChild(el("p", "sub",
      "Type English or Vietnamese — the search covers the word, its phonetics, "
      + "the English definition and the Vietnamese meaning. Vietnamese without "
      + "tone marks works too: “thoai vi” finds abdicate."));

    var stats = el("div", "stats");
    [[entries.length, "entries"],
     [senseCount(entries), "senses"],
     [counts.phrasal || 0, "phrasal verbs"],
     [counts.idiom || 0, "idioms"]].forEach(function (p) {
      if (!p[0]) return;
      var s = el("div", "stat");
      s.appendChild(el("b", null, fmt(p[0])));
      s.appendChild(el("span", null, p[1]));
      stats.appendChild(s);
    });
    w.appendChild(stats);

    var keys = el("div", "keys");
    keys.appendChild(el("h3", null, "Keyboard"));
    var dl = el("dl");
    [[["/"], "jump to the search box"],
     [["↑", "↓"], "move through the list"],
     [["←", "→"], "previous / next entry"],
     [["Esc"], "clear the search box"]].forEach(function (p) {
      var dt = el("dt");
      p[0].forEach(function (k) { dt.appendChild(el("span", null, k)); });
      dl.appendChild(dt);
      dl.appendChild(el("dd", null, p[1]));
    });
    keys.appendChild(dl);
    w.appendChild(keys);

    var foot = el("div", "foot");
    var rnd = el("button", "btn", "Random entry");
    rnd.type = "button";
    rnd.addEventListener("click", function () {
      if (!hits.length) return;
      select(hits[Math.floor(Math.random() * hits.length)].id);
      paint(true);
      showDetail();
    });
    foot.appendChild(rnd);
    if (!unlocked()) {
      var unlock = el("button", "btn", "Unlock adding words");
      unlock.type = "button";
      unlock.addEventListener("click", function () { openSettings(true); });
      foot.appendChild(unlock);
    }
    w.appendChild(foot);

    if (MODE === "static" && unlocked() && !canWriteSheet()) {
      w.appendChild(el("p", "local-note",
        "Words you add here are kept in this browser only, and are not sent "
        + "anywhere. Use Back up .json to keep them for good, or set a sync link "
        + "in Settings to write them straight into the Google Sheet."));
    }
    return w;
  }

  /* ---- add / remove a word ------------------------------------------------ */
  function newSenseRow(n) {
    var box = el("div", "sense-edit");
    var row = el("div", "row");
    row.appendChild(el("span", "lab", "Sense " + n));
    var drop = el("button", "btn btn-quiet drop", "Remove");
    drop.type = "button";
    drop.addEventListener("click", function () { box.remove(); renumberSenses(); });
    row.appendChild(drop);
    box.appendChild(row);

    var f1 = el("label", "field");
    f1.appendChild(el("span", null, "English definition"));
    var ta = el("textarea");
    ta.name = "def";
    ta.placeholder = "to become less strong";
    f1.appendChild(ta);
    box.appendChild(f1);

    var f2 = el("label", "field");
    f2.appendChild(el("span", null, "Vietnamese meaning"));
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
      boxes[i].querySelector(".lab").textContent = "Sense " + (i + 1);
      boxes[i].querySelector(".drop").hidden = boxes.length === 1;
    }
  }

  function openForm(prefill) {
    if (!mayAdd()) { openSettings(true); return; }
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
    if (!word) return { err: "Enter the word first." };
    var senses = [];
    var boxes = document.querySelectorAll("#sense-list .sense-edit");
    for (var i = 0; i < boxes.length; i++) {
      var def = boxes[i].querySelector("[name=def]").value.trim();
      var vi = boxes[i].querySelector("[name=vi]").value.trim();
      if (def || vi) senses.push({ def: def, vi: vi, eg: [] });
    }
    if (!senses.length) return { err: "Add at least one sense — a definition or a Vietnamese meaning." };
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
    btn.textContent = wantSheet ? "Writing to the sheet…" : "Saving…";
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
        btn.textContent = "Save word";
        document.getElementById("form-dlg").close();
        if (res.ok && res.reload) { toast("Saved “" + got.entry.word + "”"); return; }
        ADDED = next;
        rebuild();
        refresh();
        select(got.entry.id);
        showDetail();
        if (!res.ok) { banner(res.msg, "Sync", syncPending); return; }
        if (got.entry.inSheet) { toast("Wrote “" + got.entry.word + "” into the sheet"); return; }
        if (sheetErr) {
          banner("Saved in this browser, but not written to the sheet: " + sheetErr,
            "Try again", pushToSheet);
          return;
        }
        toast("Saved “" + got.entry.word + "” in this browser");
      });
    });
  }

  /* Push words that have been added but not written into the sheet yet. */
  function unsynced() {
    return ADDED.filter(function (e) { return !e.inSheet; });
  }

  function pushToSheet() {
    if (!canWriteSheet()) { openSettings(); return; }
    var todo = unsynced();
    if (!todo.length) { toast("Nothing is waiting to be written."); return; }
    banner("Writing " + plural(todo.length, "word", "words") + " into the sheet…", null, null);
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
      if (okN && !lastErr) {
        document.getElementById("banner").hidden = true;
        toast("Wrote " + plural(okN, "word", "words") + " into the sheet");
      } else if (okN) {
        banner("Wrote " + okN + ", then hit an error: " + lastErr, "Try again", pushToSheet);
      } else {
        banner("Could not write to the sheet: " + lastErr, "Try again", pushToSheet);
      }
    });
  }

  /* Pull the sheet in. The script republishes data.json and the page reloads
     it; if the repo is not set up, the entries come back inline instead and
     only last for this visit. */
  function syncFromSheet() {
    if (!canWriteSheet()) { openSettings(true); return; }
    var b = document.getElementById("sync-sheet");
    b.disabled = true;
    banner("Reading the sheet…", null, null);
    callSheet({ action: "sync" }).then(function (res) {
      if (res.published) {
        banner("Sheet read, " + plural(res.entries, "entry", "entries")
          + " published. Loading the new copy…", null, null);
        return fetch("data.json?ts=" + Date.now(), { cache: "reload" })
          .then(function (r) {
            if (!r.ok) throw new Error("data.json " + r.status);
            return r.json();
          })
          .then(function (fresh) {
            applySync(fresh, res.entries);
            document.getElementById("banner").hidden = true;
            toast("Synced " + plural(res.entries, "entry", "entries") + " from the sheet");
          }, function () {
            banner("The sheet was published, but the site is still serving the old copy — "
              + "GitHub takes up to a minute. Reload the page shortly.", null, null);
          });
      }
      if (res.data && res.data.entries) {
        applySync(res.data, res.entries);
        banner("Showing " + plural(res.entries, "entry", "entries")
          + " read straight from the sheet, for this visit only. " + (res.error || ""),
          null, null);
        return;
      }
      banner("Could not read the sheet: " + (res.error || "unknown reason"),
        "Try again", syncFromSheet);
    }, function (err) {
      banner("Could not reach the sheet: " + (err && err.message ? err.message : err),
        "Try again", syncFromSheet);
    }).then(function () { b.disabled = false; });
  }

  /* Words of mine that already reached the sheet now arrive as ordinary
     entries, so drop them from the local list to avoid showing both. */
  function applySync(fresh, count) {
    BASE = { entries: fresh.entries, readings: BASE.readings || [] };
    var before = ADDED.length;
    ADDED = ADDED.filter(function (e) { return !e.inSheet; });
    if (ADDED.length !== before) writeBackup(ADDED);
    selectedId = null;
    rebuild();
    refresh();
  }

  function removeEntry(e) {
    if (!window.confirm("Remove “" + e.word + "” from the notebook?")) return;
    var next = ADDED.filter(function (x) { return x.id !== e.id; });
    persist(next).then(function (res) {
      if (res.ok && res.reload) { toast("Removed"); return; }
      ADDED = next;
      selectedId = null;
      rebuild();
      refresh();
      if (res.ok) { toast("Removed"); return; }
      banner(res.msg, "Sync", syncPending);
    });
  }

  function syncPending() {
    banner("Syncing…", null, null);
    persist(ADDED).then(function (res) {
      if (!res.ok) banner(res.msg, "Try again", syncPending);
    });
  }

  /* ---- export -------------------------------------------------------------- */
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
      a.download = "engrowdict.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast("Backup file created");
      return;
    }
    if (!window.claude || !window.claude.use) { toast("Downloads are not available in this copy."); return; }
    window.claude.use("downloads").then(function (dl) {
      if (!dl) { toast("Downloads are not available in this copy."); return; }
      return dl.save({ filename: "engrowdict.json", data: payload }).then(function () {
        toast("Backup file created");
      }, function () { toast("The file could not be saved."); });
    });
  }

  /* ---- notices -------------------------------------------------------------- */
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
    var x = el("button", "btn btn-quiet", "Dismiss");
    x.type = "button";
    x.addEventListener("click", function () { b.hidden = true; });
    b.appendChild(x);
    b.hidden = false;
  }

  /* ---- redraw --------------------------------------------------------------- */
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
  }

  function drawCount() {
    var box = document.getElementById("count");
    box.textContent = "";
    var q = query.trim();
    if (view === "read") {
      box.appendChild(document.createTextNode(plural(hits.length, "passage", "passages")));
      return;
    }
    box.appendChild(document.createTextNode(plural(hits.length, "entry", "entries")));
    box.appendChild(el("span", "dot", "·"));
    box.appendChild(document.createTextNode(fmt(senseCount(hits)) + " senses"));
    if (q) {
      box.appendChild(el("span", "dot", "·"));
      box.appendChild(document.createTextNode("matching “" + q + "”"));
    }
  }

  function drawChips() {
    var box = document.getElementById("chips");
    box.hidden = view === "read";
    box.textContent = "";
    var defs = [["all", "All"]].concat(CHIP_KINDS.map(function (k) { return [k, KINDS[k].filter]; }));
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
      b.title = "Jump to " + L.toUpperCase();
      b.addEventListener("click", function () { jumpTo(L); });
      box.appendChild(b);
    });
  }

  /* Everything whose visibility depends on settings or write access. */
  function refreshChrome() {
    var add = document.getElementById("add-word");
    if (add) {
      add.hidden = !canWrite;
      add.textContent = mayAdd() ? "+ Add word" : "Unlock to add";
    }
    var open = document.getElementById("open-sheet");
    if (open) {
      open.hidden = !settings.sheetUrl;
      open.href = settings.sheetUrl || "#";
    }
    var push = document.getElementById("push-sheet");
    if (push) {
      var n = canWriteSheet() ? unsynced().length : 0;
      push.hidden = !n;
      push.textContent = "Write " + plural(n, "word", "words") + " to sheet";
    }
    var sync = document.getElementById("sync-sheet");
    if (sync) sync.hidden = !canWriteSheet();
    syncViewButtons();
    var row = document.getElementById("to-sheet-row");
    if (row) row.hidden = !canWriteSheet();
  }

  /* ---- page chrome ---------------------------------------------------------- */
  var qInput;

  function build() {
    var app = document.getElementById("app");
    app.textContent = "";

    var top = el("header", "top");
    var brand = el("div", "brand");
    brand.appendChild(el("span", "mark", "EngrowDict"));
    top.appendChild(brand);
    top.appendChild(buildTabs());

    var back = el("button", "btn btn-quiet back", "← List");
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
    qInput.setAttribute("aria-label", "Search");
    qInput.placeholder = "Search a word, a meaning, or Vietnamese…";
    searchBox.appendChild(qInput);
    var hk = el("div", "hintkeys");
    hk.appendChild(el("kbd", null, "/"));
    searchBox.appendChild(hk);
    top.appendChild(searchBox);

    /* The bar carries what gets used constantly; the rest lives under ⋯, so
       five things sit here rather than eight. */
    var acts = el("div", "acts");

    var pop = el("button", "btn", "Look up");
    pop.type = "button";
    pop.id = "popdict-btn";
    pop.hidden = true;
    pop.title = "A dictionary window you can keep open while reading (d)";
    pop.addEventListener("click", function () {
      if (popOpen()) closePopDict(); else openPopDict("");
    });
    acts.appendChild(pop);

    var add = el("button", "btn btn-primary", "+ Add word");
    add.type = "button";
    add.id = "add-word";
    add.addEventListener("click", function () { openForm(query.trim()); });
    acts.appendChild(add);

    var more = makeMenu("⋯", "More actions");
    var push = el("button", "menu-item", "Write to sheet");
    push.type = "button";
    push.id = "push-sheet";
    push.hidden = true;
    push.addEventListener("click", function () { more.close(); pushToSheet(); });
    more.menu.appendChild(push);

    var openSheet = document.createElement("a");
    openSheet.className = "menu-item";
    openSheet.id = "open-sheet";
    openSheet.target = "_blank";
    openSheet.rel = "noopener";
    openSheet.textContent = "Open sheet";
    openSheet.hidden = true;
    more.menu.appendChild(openSheet);

    var exp = el("button", "menu-item", "Back up .json");
    exp.type = "button";
    exp.id = "backup-json";
    exp.addEventListener("click", function () { more.close(); exportJson(); });
    more.menu.appendChild(exp);
    acts.appendChild(more.wrap);

    var sync = el("button", "btn", "Sync from sheet");
    sync.type = "button";
    sync.id = "sync-sheet";
    sync.hidden = true;
    sync.title = "Read the Google Sheet and refresh this page from it";
    sync.addEventListener("click", syncFromSheet);
    acts.appendChild(sync);

    var gear = el("button", "btn btn-quiet", "⚙");
    gear.type = "button";
    gear.id = "settings-btn";
    gear.title = "Settings";
    gear.setAttribute("aria-label", "Settings");
    gear.addEventListener("click", function () { openSettings(); });
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
    alpha.setAttribute("aria-label", "Jump by letter");
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

    work.appendChild(buildResizer());

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
    restoreList();

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
      else if (ev.key === "d" && view === "read") {
        ev.preventDefault();
        if (popOpen()) closePopDict(); else openPopDict("");
      }
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

    var head = el("div", "dlg-head");
    head.appendChild(el("h2", null, "Add a word"));
    head.appendChild(el("p", null, "A word can carry several senses."));
    dlg.appendChild(head);

    var body = el("div", "dlg-body");
    var g = el("div", "grid-3");
    g.appendChild(field("Word", "word", "abate", false));
    g.appendChild(field("Part of speech", "pos", "v", false));
    g.appendChild(field("Phonetics", "ipa", "/əˈbeɪt/", true));
    body.appendChild(g);

    var g2 = el("div", "grid-3");
    var ft = el("label", "field");
    ft.appendChild(el("span", null, "Group"));
    var sel = el("select");
    sel.name = "type";
    KIND_ORDER.forEach(function (k) {
      var o = el("option", null, KINDS[k].label);
      o.value = k;
      sel.appendChild(o);
    });
    ft.appendChild(sel);
    g2.appendChild(ft);
    var fn = field("Note", "note", "US: slaughterhouse", false);
    fn.style.gridColumn = "span 2";
    g2.appendChild(fn);
    body.appendChild(g2);

    var list = el("div", "field");
    list.id = "sense-list";
    list.style.gap = "12px";
    body.appendChild(list);

    var more = el("button", "btn", "+ Add another sense");
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
    toSheetRow.appendChild(el("span", null, "Write straight into the sheet"));
    foot.appendChild(toSheetRow);
    var msg = el("span", "dlg-msg");
    msg.id = "form-msg";
    foot.appendChild(msg);
    foot.appendChild(el("span", "spacer2"));
    var cancel = el("button", "btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function () { dlg.close(); });
    foot.appendChild(cancel);
    var save = el("button", "btn btn-primary", "Save word");
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

  /* ---- settings dialog ------------------------------------------------------ */
  /* Each link is shown as plain text and only becomes editable after its Edit
     button is pressed, so a stray click cannot repoint the sheet. */
  function setRow(id, label, key, placeholder, hint, secret) {
    var row = el("div", "setrow");
    row.id = "row-" + id;
    row.appendChild(el("span", "setlabel", label));

    var line = el("div", "setline");
    var val = el("span", "setval");
    val.id = "val-" + id;
    line.appendChild(val);

    var input = el("input", "mono");
    input.name = key;
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.hidden = true;
    line.appendChild(input);

    var btn = el("button", "btn edit-btn", "Edit");
    btn.type = "button";
    btn.addEventListener("click", function () {
      if (input.hidden) {
        input.hidden = false;
        val.hidden = true;
        btn.textContent = "Cancel";
        input.focus();
      } else {
        input.hidden = true;
        input.value = settings[key] || "";
        val.hidden = false;
        btn.textContent = "Edit";
      }
    });
    line.appendChild(btn);
    row.appendChild(line);
    if (hint) row.appendChild(el("span", "hint", hint));
    row.dataset.secret = secret ? "1" : "";
    return row;
  }

  function showRowValue(id, key) {
    var row = document.getElementById("row-" + id);
    var val = document.getElementById("val-" + id);
    var input = row.querySelector("input");
    var raw = settings[key] || "";
    if (!raw) {
      val.textContent = "Not set yet";
      val.classList.add("unset");
    } else if (row.dataset.secret) {
      val.textContent = raw.slice(0, 3) + "•".repeat(Math.max(4, raw.length - 3));
      val.classList.remove("unset");
    } else {
      val.textContent = raw;
      val.classList.remove("unset");
    }
    val.hidden = false;
    input.hidden = true;
    input.value = raw;
    row.querySelector(".edit-btn").textContent = "Edit";
  }

  function buildSettings() {
    var dlg = document.createElement("dialog");
    dlg.id = "set-dlg";

    var head = el("div", "dlg-head");
    head.appendChild(el("h2", null, "Settings"));
    head.appendChild(el("p", null, "Kept in this browser only."));
    dlg.appendChild(head);

    var body = el("div", "dlg-body");

    /* --- passcode ------------------------------------------------------- */
    var gate = el("div", "gate");
    gate.id = "gate";
    body.appendChild(gate);

    /* --- links ---------------------------------------------------------- */
    var links = el("div", "setgroup");
    links.id = "setgroup";
    links.appendChild(setRow("sheet", "Google Sheet link", "sheetUrl",
      "https://docs.google.com/spreadsheets/d/…",
      "Adds an Open sheet button to the top bar.", false));
    links.appendChild(setRow("webapp", "Sync Web App link", "webApp",
      "https://script.google.com/macros/s/…/exec",
      "From the sheet: EngrowDict menu → Link for the web to write words.", false));
    links.appendChild(setRow("key", "Sync key", "key", "",
      "Comes with the link above.", true));
    body.appendChild(links);

    var note = el("p", "set-note");
    note.id = "set-note";
    body.appendChild(note);
    dlg.appendChild(body);

    var foot = el("div", "dlg-foot");
    var msg = el("span", "dlg-msg");
    msg.id = "set-msg";
    foot.appendChild(msg);
    foot.appendChild(el("span", "spacer2"));
    var testBtn = el("button", "btn", "Test connection");
    testBtn.type = "button";
    testBtn.id = "set-test";
    testBtn.addEventListener("click", function () {
      readForm();
      if (!settings.webApp || !settings.key) { setMsg("Both the Web App link and the key are needed.", false); return; }
      setMsg("Trying…", true);
      callSheet({ action: "ping" }).then(function () {
        setMsg("Connected.", true);
      }, function (err) {
        setMsg("No luck: " + (err && err.message ? err.message : err), false);
      });
    });
    foot.appendChild(testBtn);
    var close = el("button", "btn", "Close");
    close.type = "button";
    close.addEventListener("click", function () { dlg.close(); });
    foot.appendChild(close);
    var save = el("button", "btn btn-primary", "Save");
    save.type = "button";
    save.id = "set-save";
    save.addEventListener("click", function () {
      readForm();
      writeSettings();
      drawSettings();
      refresh();
      toast("Settings saved");
    });
    foot.appendChild(save);
    dlg.appendChild(foot);

    function readForm() {
      ["sheet:sheetUrl", "webapp:webApp", "key:key"].forEach(function (pair) {
        var p = pair.split(":");
        var row = document.getElementById("row-" + p[0]);
        var input = row.querySelector("input");
        if (!input.hidden) settings[p[1]] = input.value.trim();
      });
    }
    return dlg;
  }

  function setMsg(text, good) {
    var m = document.getElementById("set-msg");
    m.textContent = text;
    m.classList.toggle("good", !!good);
  }

  /* Redraw the parts of Settings that depend on lock state. */
  function drawSettings() {
    var gate = document.getElementById("gate");
    gate.textContent = "";

    if (!unlocked()) {
      gate.appendChild(el("p", "gate-title", "Locked"));
      gate.appendChild(el("p", "gate-sub",
        "Enter the passcode to add words and to change these links."));
      var row = el("div", "gate-row");
      var inp = el("input", "mono");
      inp.type = "password";
      inp.id = "pass-in";
      inp.placeholder = "Passcode";
      inp.autocomplete = "off";
      row.appendChild(inp);
      var go = el("button", "btn btn-primary", "Unlock");
      go.type = "button";
      go.id = "pass-go";
      go.addEventListener("click", function () {
        if (inp.value.trim() === settings.code) {
          settings.unlocked = true;
          writeSettings();
          drawSettings();
          refresh();
          toast("Unlocked");
        } else {
          setMsg("Wrong passcode.", false);
          inp.select();
        }
      });
      inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") go.click(); });
      row.appendChild(go);
      gate.appendChild(row);
    } else {
      gate.appendChild(el("p", "gate-title good", "Unlocked"));
      gate.appendChild(el("p", "gate-sub", "You can add words and edit the links below."));
      var row2 = el("div", "gate-row");
      var np = el("input", "mono");
      np.type = "text";
      np.id = "pass-new";
      np.placeholder = "New passcode";
      np.autocomplete = "off";
      row2.appendChild(np);
      var ch = el("button", "btn", "Change passcode");
      ch.type = "button";
      ch.id = "pass-change";
      ch.addEventListener("click", function () {
        var v = np.value.trim();
        if (v.length < 4) { setMsg("Use at least 4 characters.", false); return; }
        settings.code = v;
        writeSettings();
        np.value = "";
        setMsg("Passcode changed.", true);
      });
      row2.appendChild(ch);
      var lk = el("button", "btn btn-quiet", "Lock again");
      lk.type = "button";
      lk.id = "pass-lock";
      lk.addEventListener("click", function () {
        settings.unlocked = false;
        writeSettings();
        drawSettings();
        refresh();
        toast("Locked");
      });
      row2.appendChild(lk);
      gate.appendChild(row2);
    }

    showRowValue("sheet", "sheetUrl");
    showRowValue("webapp", "webApp");
    showRowValue("key", "key");

    var on = unlocked();
    document.getElementById("setgroup").classList.toggle("disabled", !on);
    var btns = document.querySelectorAll("#setgroup .edit-btn");
    for (var i = 0; i < btns.length; i++) btns[i].disabled = !on;
    document.getElementById("set-test").disabled = !on;
    document.getElementById("set-save").disabled = !on;

    document.getElementById("set-note").textContent = MODE === "static"
      ? "With a Web App link and a key set, every word you add is inserted straight into the right tab of the sheet, in alphabetical order. Neither ever leaves this device, so other visitors cannot write to your sheet. The passcode only guards this interface — it is visible to anyone who reads the page source."
      : "The claude.ai copy is not allowed to call out to other sites, so writing into the sheet only works on the public web copy.";
  }

  function openSettings(focusPass) {
    drawSettings();
    setMsg("", false);
    var dlg = document.getElementById("set-dlg");
    dlg.showModal();
    if (focusPass && !unlocked()) {
      var p = document.getElementById("pass-in");
      if (p) p.focus();
    }
  }

  /* ---- start ----------------------------------------------------------------- */
  function start(data) {
    readSettings();
    BASE = data;
    READINGS = data.readings || [];
    READINGS.forEach(function (r, i) {
      r.id = "r" + i;
      // tolerate an older data.json still serving plain strings
      r.paras = r.paras.map(function (p) { return typeof p === "string" ? { text: p } : p; });
      r._text = r.paras.map(function (x) { return x.text; }).join(" ");
      r._w = norm(r.title);
      r._all = norm(r.title + " " + r._text);
    });

    var backup = readBackup();
    var known = {};
    ADDED.forEach(function (e) { known[e.id] = true; });
    var pending = backup.filter(function (e) { return e && e.id && !known[e.id]; });
    if (pending.length) {
      ADDED = ADDED.concat(pending);
      if (MODE !== "static") {
        banner(plural(pending.length, "word", "words")
          + " in the local backup are not on the server yet.", "Sync", syncPending);
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
    showLoading("Loading the notebook…");
    fetch("data.json").then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(start, function () {
      showLoading("Could not load the data. Try reloading the page.");
    });
  }
})();
