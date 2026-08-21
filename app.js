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
  var BOOKS = [];            // the shelf: titles and contents, never the text
  var SHELF_NET = [];        // what the site publishes
  var SHELF_MINE = [];       // what was added on this device
  var bookText = {};         // slug -> the whole book, once it has been opened
  var entries = [];
  var byId = {};
  var canWrite = true;
  var view = "vocab";        // vocab | read | book
  var kindFilter = "all";
  var query = "";
  var rows = [];             // rows feeding the virtual list
  var hits = [];             // matching entries, for prev/next
  var counts = {};
  var selectedId = null;
  var selectedRead = null;
  var selectedBook = null;
  var openChapter = 0;       // 0 is the table of contents

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
  /* A link to one of this project's own files, worked out from the address the
     page is served from, so nothing has to be hard-coded. Falls back to plain
     text off GitHub Pages, where there is no repo to point at. */
  function repoFileLink(name) {
    var host = location.hostname || "";
    if (host.slice(-10) === ".github.io") {
      var owner = host.slice(0, -10);
      var seg = location.pathname.split("/").filter(Boolean)[0];
      var a = el("a", "filelink", name);
      a.href = "https://github.com/" + owner + "/" + (seg || host) + "/blob/main/" + name;
      a.target = "_blank";
      a.rel = "noopener";
      return a;
    }
    return el("code", "filelink", name);
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
  /* ---- saying the word out loud -------------------------------------------

     The browser has a voice of its own: no network, no key, nothing to embed,
     and it works with the page installed and no signal. Where a browser ships
     no voice at all — some Linux builds do not — the button is not drawn
     rather than drawn dead. */
  function canSpeak() {
    return !!window.speechSynthesis
      && typeof window.SpeechSynthesisUtterance === "function";
  }

  function speak(word) {
    if (!canSpeak() || !word) return;
    try {
      window.speechSynthesis.cancel();       // a second press interrupts the first
      var say = new window.SpeechSynthesisUtterance(word);
      say.lang = "en-GB";
      say.rate = 0.95;                       // a word on its own, not a sentence
      var voices = window.speechSynthesis.getVoices
        ? (window.speechSynthesis.getVoices() || []) : [];
      var pick = null, i;
      for (i = 0; i < voices.length; i++) {
        if (!pick && /^en/i.test(voices[i].lang)) pick = voices[i];
        if (/^en[-_]GB/i.test(voices[i].lang)) { pick = voices[i]; break; }
      }
      if (pick) say.voice = pick;
      window.speechSynthesis.speak(say);
    } catch (err) { /* a browser that will not speak is not worth a message */ }
  }

  function sayButton(word) {
    var b = el("button", "say");
    b.type = "button";
    b.title = "Say " + word;
    b.setAttribute("aria-label", "Say " + word);
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
      + ' aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>'
      + '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'
      + '<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    b.addEventListener("click", function () { speak(word); });
    return b;
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
    for (var b = 0; b < BOOKS.length; b++) byId[BOOKS[b].id] = BOOKS[b];

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
     the only direction this is ever used in. It needs the open web, so it works
     on the published site and not inside the claude.ai artifact.

     Two sources, tried in order. Google's is what people mean by "translate
     this word"; it is an undocumented endpoint, so it may change without
     notice, which is why MyMemory stands behind it and the card always offers
     a link out. MyMemory alone was the first version of this and was wrong in
     a way worth remembering: it is a translation memory, not a translator, so
     asking it for one word returns the closest segment some human once
     translated — "imprisonment" came back as "sợ bỏ tù", the fear of it. */
  var mtCache = {};

  function gTranslate(text) {
    return fetch("https://translate.googleapis.com/translate_a/single"
      + "?client=gtx&sl=en&tl=vi&dt=t&q=" + encodeURIComponent(text))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d[0] || !d[0].length) throw new Error("unexpected shape");
        var out = "";
        for (var i = 0; i < d[0].length; i++) {
          if (d[0][i] && d[0][i][0]) out += d[0][i][0];
        }
        if (!out.trim()) throw new Error("empty");
        return { text: out.trim(), via: "Google Translate" };
      });
  }

  function memoryTranslate(text) {
    return fetch("https://api.mymemory.translated.net/get?langpair=en%7Cvi&q="
      + encodeURIComponent(text))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var t = d && d.responseData && d.responseData.translatedText;
        if (!t || /MYMEMORY WARNING|INVALID/i.test(t)) throw new Error("no translation");
        return { text: t, via: "MyMemory" };
      });
  }

  function machineTranslate(text) {
    var key = text.toLowerCase();
    if (mtCache[key]) return Promise.resolve(mtCache[key]);
    if (MODE !== "static" || typeof fetch !== "function") {
      return Promise.reject(new Error("offline"));
    }
    return gTranslate(text).catch(function () {
      return memoryTranslate(text);
    }).then(function (got) {
      mtCache[key] = got;
      return got;
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
  var settings = { sheetUrl: "", webApp: "", key: "", repo: "", ghToken: "",
    code: DEFAULT_PASSCODE, unlocked: false };

  function readSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        settings.sheetUrl = s.sheetUrl || "";
        settings.webApp = s.webApp || "";
        settings.key = s.key || "";
        settings.repo = s.repo || "";
        settings.ghToken = s.ghToken || "";
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

  /* Apps Script accepts a plain POST with no custom headers, so no preflight.
     The sheet link rides along: the script writes to the workbook named here,
     not to whichever one it happens to be attached to. */
  function callSheet(payload, signal) {
    payload.key = settings.key;
    payload.sheet = settings.sheetUrl;
    return fetch(settings.webApp, {
      method: "POST",
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: signal || undefined
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
    if (view === "book") return BOOKS;
    if (kindFilter === "all") return entries;
    return entries.filter(function (e) {
      return kindFilter === "mine" ? !!e.mine : e.type === kindFilter;
    });
  }

  /* Exact word, then the headword starting with it, then a word inside a
     phrase starting with it, then anywhere in the headword, and last — unless
     asked for headwords only — anywhere in the definitions and meanings.
     Every entry is scored before anything is ranked: stopping early once
     enough matches were found made the order depend on where a word sits in
     the alphabet, which buried "yield" under matches from the letter a. */
  function rankEntries(q, src, limit, headwordOnly) {
    var buckets = [[], [], [], [], []];
    for (var i = 0; i < src.length; i++) {
      var e = src[i], w = e._w, s = -1;
      if (w === q) s = 0;
      else if (w.lastIndexOf(q, 0) === 0) s = 1;
      else if (w.indexOf(" " + q) > -1) s = 2;
      else if (w.indexOf(q) > -1) s = 3;
      else if (!headwordOnly && e._all.indexOf(q) > -1) s = 4;
      if (s > -1) buckets[s].push(e);
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
    if (e.chapters) {                               // a book on the shelf
      b.className = "hit passage";
      b.appendChild(el("span", "idx", e.index));
      var bcol = el("div", "col");
      var bhw = el("span", "hw");
      markUp(bhw, e.title, q);
      bcol.appendChild(bhw);
      var bg = el("span", "gloss");
      markUp(bg, (e.author ? e.author + " · " : "")
        + plural(e.chapters.length, "chapter", "chapters"), q);
      bcol.appendChild(bg);
      b.appendChild(bcol);
      return b;
    }
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
    if (view === "book") { selectedBook = byId[id] || null; openChapter = 0; }
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
    var box = detailBox();
    if (box) box.scrollTop = 0;
    restorePlace();
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
    var wide = (view === "read" && selectedRead)
      || (view === "book" && selectedBook && openChapter);
    host.className = "detail-inner" + (wide ? " wide" : "");
    if (view === "read") {
      host.appendChild(selectedRead ? readingView(selectedRead) : blankView());
      restorePlace();
      return;
    }
    if (view === "book") {
      host.appendChild(selectedBook ? bookView(selectedBook) : blankView());
      restorePlace();
      return;
    }
    if (cameFrom) host.appendChild(backRow());
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
    if (canSpeak()) head.appendChild(sayButton(e.word));
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
    inp.placeholder = "Look a word up…";
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
        "Type a word, or select one in the passage behind. This searches "
        + "headwords; the Dictionary tab searches the meanings too."));
      return;
    }
    var found = rankEntries(q, entries, 40, true);
    if (!found.length) {
      body.appendChild(el("p", "pd-note", "Nothing in the notebook matches that."));
      return;
    }
    var list = el("ul", "pd-hits");
    found.forEach(function (e) {
      var li = el("li");
      var b = el("button", "pd-hit");
      b.type = "button";
      // same marking as the list on the dictionary tab
      var line = el("span", "pd-w");
      markUp(line, e.word, q);
      if (e.pos) line.appendChild(el("i", null, e.pos));
      b.appendChild(line);
      var vi = el("span", "pd-vi");
      markUp(vi, glossOf(e), q);
      b.appendChild(vi);
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
      // with no number there is only one child, so the grid must be one track
      var s = el("div", "pd-sense" + (e.senses.length > 1 ? "" : " solo"));
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
      markPlace();
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

  /* ---- where you got to, and the way back ---------------------------------

     A passage runs longer than a screen, so leaving one and coming back used
     to mean hunting for the line you had reached. How far down you were is
     kept per passage — and per chapter of a book — and put back when it opens
     again. A fraction of the way down rather than a count of pixels: the same
     passage is a different height on a phone.

     The other half of the same problem: looking a word up from a passage took
     you to the Dictionary tab and left the passage behind. Where you were is
     marked before the jump, and the entry carries a button back to it. */
  var PLACE_KEY = "engrowdict:place:v1";
  var places = null, placeTimer = 0, cameFrom = null;

  function detailBox() { return document.querySelector(".detail"); }

  function readPlaces() {
    if (places) return places;
    try { places = JSON.parse(localStorage.getItem(PLACE_KEY) || "{}"); }
    catch (err) { places = {}; }
    if (!places || typeof places !== "object") places = {};
    return places;
  }

  /* What the pane is showing, if it is showing something you read at all. */
  function placeKey() {
    if (view === "read" && selectedRead) return "r:" + selectedRead.id;
    if (view === "book" && selectedBook && openChapter) {
      return "b:" + selectedBook.slug + ":" + openChapter;
    }
    return "";
  }

  function savePlace() {
    var key = placeKey(), box = detailBox();
    if (!key || !box) return;
    var room = box.scrollHeight - box.clientHeight;
    if (room <= 0) return;                  // nothing to scroll, nothing to keep
    var at = box.scrollTop / room;
    var all = readPlaces();
    // the top is where it starts anyway, and the end is read: both open fresh
    if (at < 0.02 || at > 0.98) delete all[key];
    else all[key] = Math.round(at * 1000) / 1000;
    try { localStorage.setItem(PLACE_KEY, JSON.stringify(all)); } catch (err) { /* quota */ }
  }

  /* Called every time the pane is redrawn, so a passage with nothing kept for
     it starts at the top rather than wherever the last one was left. */
  function restorePlace() {
    var key = placeKey(), box = detailBox();
    if (!key || !box) return;
    var at = readPlaces()[key];
    var to = down(box, at);
    box.scrollTop = to;
    // The page's fonts are swapped in when they arrive, and the passage is a
    // different height once they are: on a cold load the line the reader
    // stopped at has moved by then. Put it back a second time, unless they
    // have taken over the scrolling themselves in the meantime.
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () {
        if (placeKey() !== key || Math.abs(box.scrollTop - to) > 4) return;
        box.scrollTop = down(box, at);
      });
    }
  }

  function down(box, at) {
    var room = box.scrollHeight - box.clientHeight;
    return (at && room > 0) ? at * room : 0;
  }

  /* ---- the top bar, out of the way while reading -------------------------

     Wide enough and the tabs, the search and the buttons sit on one line and
     cost nothing. On a phone they are three lines deep over the column of text
     the page was opened for, so it gets out of the way while the text is read.

     How it gets out of the way matters more than that it does. Folding it out
     of the layout moved the passage as well, which is two things moving at
     once for one gesture — so on a narrow screen the bar is lifted out of the
     flow altogether and the passage scrolls under it, the way a phone browser
     does with its own toolbar. The bar then follows the scroll one pixel for
     one pixel, and when the scrolling stops it settles the short way, either
     fully there or fully gone. Nothing else moves at any point. */
  var lastScroll = 0;
  var barOff = 0;
  var barSettle = 0;
  var NARROW = 760;

  function narrowScreen() {
    return window.innerWidth <= NARROW;
  }

  function topBar() {
    return document.querySelector(".top");
  }

  /* The bar's own height, given to the stylesheet: the passage is padded by it
     so that the first line starts below the bar and the rest reads under it. */
  function measureBar() {
    var bar = topBar();
    var app = document.getElementById("app");
    if (!bar || !app) return 0;
    var h = bar.offsetHeight;
    if (h) app.style.setProperty("--bar-h", h + "px");
    return h;
  }

  function setBarOff(px, settling) {
    var bar = topBar();
    if (!bar) return;
    barOff = px;
    bar.classList.toggle("settling", !!settling);
    bar.style.transform = px ? "translateY(-" + px + "px)" : "";
  }

  function showTop() {
    if (barSettle) { clearTimeout(barSettle); barSettle = 0; }
    if (barOff) setBarOff(0, true);
  }

  /* Left half shown, it goes back; more than half gone, it goes. */
  function settleBar(h) {
    if (barSettle) clearTimeout(barSettle);
    barSettle = setTimeout(function () {
      barSettle = 0;
      if (barOff <= 0 || barOff >= h) return;
      setBarOff(barOff > h / 2 ? h : 0, true);
    }, 140);
  }

  function watchTop(box) {
    box.addEventListener("scroll", function () {
      var y = box.scrollTop;
      var moved = y - lastScroll;
      lastScroll = y;
      if (!narrowScreen()) { showTop(); return; }
      var h = measureBar();
      if (!h) return;
      // the first screenful is the bar's own: nothing to gain by hiding it there
      if (y <= h) { setBarOff(0, false); return; }
      var next = Math.max(0, Math.min(h, barOff + moved));
      if (next !== barOff) setBarOff(next, false);
      settleBar(h);
    }, { passive: true });
  }

  function watchPlace(box) {
    box.addEventListener("scroll", function () {
      if (placeTimer) return;               // a scroll is hundreds of events
      placeTimer = setTimeout(function () { placeTimer = 0; savePlace(); }, 250);
    }, { passive: true });
  }

  /* Where the dictionary was opened from, remembered so it can be got back to. */
  function markPlace() {
    if (view === "read" && selectedRead) {
      cameFrom = { view: "read", id: selectedRead.id, chapter: 0,
                   label: selectedRead.title };
    } else if (view === "book" && selectedBook && openChapter) {
      cameFrom = { view: "book", id: selectedBook.id, chapter: openChapter,
                   label: "Chapter " + openChapter + " of " + selectedBook.title };
    } else {
      cameFrom = null;
      return;
    }
    savePlace();
  }

  function goBack() {
    var to = cameFrom;
    if (!to) return;
    cameFrom = null;
    view = to.view;
    selectedRead = null;
    selectedBook = null;
    openChapter = 0;
    query = "";
    if (qInput) qInput.value = "";
    syncViewButtons();
    refresh();
    select(to.id);
    if (to.chapter) { openChapter = to.chapter; drawDetail(); }
    showDetail();
  }

  function backRow() {
    var row = el("div", "back-row");
    var b = el("button", "btn", "← Back to " + cameFrom.label);
    b.type = "button";
    b.id = "back-to-reading";
    b.title = "Back to what you were reading";
    b.addEventListener("click", goBack);
    row.appendChild(b);
    return row;
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
  var TABS = [["vocab", "Dictionary", "tab-dictionary"],
              ["read", "Passages", "tab-passages"],
              ["book", "Books", "tab-books"]];

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
        if (t[0] === "vocab") markPlace(); else cameFrom = null;
        view = t[0];
        selectedRead = null;
        selectedBook = null;
        openChapter = 0;
        selectedId = null;
        query = "";
        if (qInput) qInput.value = "";
        showTop();
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
        var v = bs[i].dataset.view;
        bs[i].hidden = (v === "read" && !READINGS.length)
          || (v === "book" && !BOOKS.length && !canAddBooks());
      }
    }
    var addRow = document.getElementById("shelf-add");
    if (addRow) addRow.hidden = view !== "book" || !canAddBooks();
    var pubRow = document.getElementById("book-pub-row");
    if (pubRow) pubRow.hidden = !!(addRow && addRow.hidden) || !canPublishBooks();
    if (qInput) {
      qInput.placeholder = view === "read" ? "Search inside the passages…"
        : view === "book" ? "Search the shelf by title or author…"
        : "Search a word, a meaning, or Vietnamese…";
    }
    if (view !== "read" && view !== "book") closePopDict();
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

  function readingView(r, lead) {
    var w = el("div", "read");
    w.appendChild(el("h1", null, r.title));
    var words = r._text.split(/\s+/).length;
    w.appendChild(el("p", "meta",
      (lead || "Passage " + r.index) + " · " + fmt(words) + " words"));
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

  /* ---- books --------------------------------------------------------------

     A book arrives as a shelf entry — its title and the names of its chapters
     — and its text only when a chapter is opened. That is what keeps a library
     from costing anything until it is read. Once open, a chapter is a passage
     like any other: the same prose, the same select-to-look-up. */

  /* Books added here live in IndexedDB rather than in localStorage: a novel is
     the best part of a megabyte and localStorage is a few, and it already holds
     the words waiting to be pushed to the sheet. */
  var BOOK_DB = "engrowdict-books";

  function withDB() {
    return new Promise(function (yes, no) {
      if (!window.indexedDB) { no(new Error("no IndexedDB")); return; }
      var req = window.indexedDB.open(BOOK_DB, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains("books")) {
          req.result.createObjectStore("books", { keyPath: "slug" });
        }
      };
      req.onsuccess = function () { yes(req.result); };
      req.onerror = function () { no(req.error); };
    });
  }

  function inStore(mode, run) {
    return withDB().then(function (db) {
      return new Promise(function (yes, no) {
        var tx = db.transaction("books", mode);
        var req = run(tx.objectStore("books"));
        req.onsuccess = function () { yes(req.result); };
        req.onerror = function () { no(req.error); };
      });
    });
  }

  function myBooks() {
    return inStore("readonly", function (st) { return st.getAll(); })
      .then(function (list) { return list || []; }, function () { return []; });
  }

  function keepBook(book) {
    return inStore("readwrite", function (st) { return st.put(book); });
  }

  function dropBook(slug) {
    return inStore("readwrite", function (st) { return st.delete(slug); });
  }

  function loadBook(book) {
    var slug = book.slug;
    if (bookText[slug]) return Promise.resolve(bookText[slug]);
    var get = book.mine
      ? inStore("readonly", function (st) { return st.get(slug); })
      : fetch("books/" + slug + ".json").then(function (r) {
          if (!r.ok) throw new Error("books/" + slug + ".json " + r.status);
          return r.json();
        });
    return get.then(function (b) {
      if (!b || !b.chapters) throw new Error("empty book");
      bookText[slug] = b;
      return b;
    });
  }

  function chapterAsPassage(book, c) {
    var paras = c.paras.map(function (t) { return { text: t }; });
    return {
      id: book.id + "#" + c.n,
      title: c.title,
      index: c.n,
      paras: paras,
      _text: c.paras.join(" ")
    };
  }

  function contentsView(book) {
    var w = el("div", "read contents");
    w.appendChild(el("h1", null, book.title));
    var words = 0;
    book.chapters.forEach(function (c) { words += c.words || 0; });
    w.appendChild(el("p", "meta",
      (book.author ? book.author + " · " : "")
      + plural(book.chapters.length, "chapter", "chapters")
      + (words ? " · " + fmt(words) + " words" : "")));
    if (book.mine) {
      var nav = el("div", "entry-nav");
      nav.appendChild(el("span", "grow"));
      /* A book added before the token was set, or added with the tick clear,
         is still only on this device: this is the way it gets to the others
         without being picked all over again. */
      if (canPublishBooks()) {
        var up = el("button", "btn",
          onSite(book.slug) ? "Replace on the site" : "Save to the site");
        up.type = "button";
        up.addEventListener("click", function () { sendBook(book, up); });
        nav.appendChild(up);
      } else if (onSite(book.slug)) {
        nav.appendChild(el("span", "shelf-msg good", "On the site"));
      }
      var rm = el("button", "btn", "Remove from this device");
      rm.type = "button";
      rm.addEventListener("click", function () { forgetBook(book); });
      nav.appendChild(rm);
      w.appendChild(nav);
    }
    var list = el("div", "toc");
    book.chapters.forEach(function (c) {
      var b = el("button", "toc-row");
      b.type = "button";
      b.appendChild(el("span", "idx", String(c.n)));
      b.appendChild(el("span", "hw", c.title));
      if (c.words) b.appendChild(el("span", "gloss", fmt(c.words) + " words"));
      b.addEventListener("click", function () { openChapter = c.n; drawDetail(); });
      list.appendChild(b);
    });
    w.appendChild(list);
    return w;
  }

  function chapterView(book, full) {
    var at = -1;
    for (var i = 0; i < full.chapters.length; i++) {
      if (full.chapters[i].n === openChapter) at = i;
    }
    if (at < 0) { openChapter = 0; return contentsView(book); }
    var c = full.chapters[at];
    var w = readingView(chapterAsPassage(book, c), "Chapter " + c.n + " of " + book.title);

    function toContents() { openChapter = 0; drawDetail(); }
    var top = el("div", "entry-nav");
    var up = el("button", "btn", "← Contents");
    up.type = "button";
    up.addEventListener("click", toContents);
    top.appendChild(up);
    w.insertBefore(top, w.firstChild);

    var nav = el("div", "entry-nav");
    var back = el("button", "btn", "← Contents");
    back.type = "button";
    back.addEventListener("click", toContents);
    nav.appendChild(back);
    nav.appendChild(el("span", "grow"));
    [[-1, "Previous"], [1, "Next"]].forEach(function (d) {
      var to = full.chapters[at + d[0]];
      var b = el("button", "btn", d[1]);
      b.type = "button";
      b.disabled = !to;
      if (to) {
        b.addEventListener("click", function () {
          openChapter = to.n;
          drawDetail();          // which puts the pane where this chapter was left
        });
      }
      nav.appendChild(b);
    });
    w.appendChild(nav);
    return w;
  }

  function bookView(book) {
    if (!openChapter) return contentsView(book);
    var full = bookText[book.slug];
    if (full) return chapterView(book, full);
    var w = el("div", "read");
    w.appendChild(el("h1", null, book.title));
    w.appendChild(el("p", "meta", "Opening the book…"));
    var want = book.slug, chapter = openChapter;
    loadBook(book).then(function () {
      if (view === "book" && selectedBook && selectedBook.slug === want
        && openChapter === chapter) drawDetail();
    }, function () {
      if (view === "book" && selectedBook && selectedBook.slug === want) {
        openChapter = 0;
        drawDetail();
        toast("Could not open " + book.title);
      }
    });
    return w;
  }

  /* ---- adding a book ------------------------------------------------------

     The file never leaves the machine. pdf.js reads it here, bookify.js cuts it
     into chapters here, and the result goes into this browser's own storage —
     which also means a book added on the phone is on the phone, and adding it
     again on the laptop is the way it gets there. Unless the tick beside the
     button says otherwise: then the same book is also written to the site, and
     every device has it. */

  /* The artifact is one file with nothing beside it, so it cannot reach
     bookify.js or pdf.js; the static copy can. */
  function canAddBooks() {
    return MODE === "static" && !!window.indexedDB;
  }

  /* ---- putting a book on the site ----------------------------------------

     A book added on a device is on that device. Ticking Put it on the site
     writes it to docs/books/ in the repo this page is served from — the same
     two files import_books.py --publish writes, reached over the GitHub API
     instead of from a terminal — and from there every device reads it off the
     shelf. GitHub Pages takes a minute or so to publish the commit.

     It needs a fine-grained token with Contents: write, which is kept in this
     browser beside the sheet key and never ships inside the page, so nobody
     else who opens the address can write to the repo. docs/ is public, so this
     is for books that are out of copyright, and the tick is off by default
     because that is a decision worth making on purpose. */

  var BOOKS_DIR = "docs/books/";

  /* owner/name, worked out from the address the page is served from, the way
     the links in Settings are. The field in Settings is for a custom domain,
     where the address says nothing about the repo behind it. */
  function ghRepo() {
    if (settings.repo) {
      return settings.repo.replace(/^https?:\/\/github\.com\//, "")
        .replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
    }
    var host = location.hostname || "";
    if (host.slice(-10) !== ".github.io") return "";
    var owner = host.slice(0, -10);
    var seg = location.pathname.split("/").filter(Boolean)[0];
    return owner + "/" + (seg || host);
  }

  function canPublishBooks() {
    return canAddBooks() && unlocked() && !!settings.ghToken && !!ghRepo();
  }

  /* The shelf the site published, read when the page opened. A book on it is
     on every device already, which is what the buttons below go by. */
  function onSite(slug) {
    for (var i = 0; i < SHELF_NET.length; i++) {
      if (SHELF_NET[i] && SHELF_NET[i].slug === slug) return true;
    }
    return false;
  }

  /* The API wants base64 of the bytes, and btoa wants one byte per character,
     so the text goes through UTF-8 first — a book of Vietnamese notes or curly
     quotes would come out wrong otherwise. */
  function b64(text) {
    var bytes = new TextEncoder().encode(text), out = "", i;
    for (i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(out);
  }

  function unb64(text) {
    var raw = atob(String(text).replace(/\s/g, ""));
    var bytes = new Uint8Array(raw.length), i;
    for (i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function gh(path, init) {
    init = init || {};
    init.headers = {
      Authorization: "Bearer " + settings.ghToken,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    return fetch("https://api.github.com/repos/" + ghRepo() + "/contents/" + path, init);
  }

  /* null for a file that is not there yet — the first book, or the first
     shelf — which is the normal case, not a failure. */
  function ghRead(path) {
    return gh(path).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) return ghBlame(r);
      return r.json();
    });
  }

  function ghWrite(path, text, sha, message) {
    var body = { message: message, content: b64(text) };
    if (sha) body.sha = sha;
    return gh(path, { method: "PUT", body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? r.json() : ghBlame(r); });
  }

  /* GitHub says why in the body; a bare status code is no help to anyone. */
  function ghBlame(r) {
    return r.json().then(function (e) {
      var why = e && e.message ? e.message : "GitHub answered " + r.status;
      if (r.status === 401 || r.status === 403) {
        why = "the token was refused — it needs Contents: write on " + ghRepo();
      } else if (r.status === 404) {
        why = ghRepo() + " was not found, or the token cannot see it";
      }
      var err = new Error(why);
      err.status = r.status;
      throw err;
    }, function () {
      var err = new Error("GitHub answered " + r.status);
      err.status = r.status;
      throw err;
    });
  }

  /* The book first and the shelf after it: a shelf is read by every device
     that opens the page, and it must never name a file that is not there.

     The repo is asked what it already has before anything is written. A book
     of that name up there is either this book or a better copy of it, and
     which one wins is not for a file picker to decide — so it comes back
     already: true, and replacing it takes a second, deliberate press. */
  function publishBook(book, replace) {
    var file = BOOKS_DIR + book.slug + ".json";
    return ghRead(file).then(function (got) {
      if (got && !replace) return { already: true };
      return ghWrite(file, JSON.stringify(book), got && got.sha,
        got ? "Replace " + book.title + " on the shelf"
            : "Add " + book.title + " to the shelf")
        .then(function () { return putOnShelf(book, 0); })
        .then(function () { return { already: false, replaced: !!got }; });
    });
  }

  function putOnShelf(book, tried) {
    var path = BOOKS_DIR + "index.json";
    return ghRead(path).then(function (got) {
      var list = [];
      if (got && got.content) {
        try { list = JSON.parse(unb64(got.content)); } catch (err) { list = []; }
      }
      if (!Array.isArray(list)) list = [];
      var entry = onShelf(book);
      delete entry.mine;                 // it is the site's copy now, not this device's
      list = list.filter(function (b) { return b && b.slug !== book.slug; });
      list.push(entry);
      list.sort(function (a, b) { return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; });
      return ghWrite(path, JSON.stringify(list), got && got.sha,
        "Put " + book.title + " on the shelf");
    }).catch(function (err) {
      // another device wrote the shelf between the read and the write
      if (tried < 2 && (err.status === 409 || err.status === 422)) {
        return putOnShelf(book, tried + 1);
      }
      throw err;
    });
  }

  function buildAdd() {
    var row = el("div", "shelf-add");
    row.id = "shelf-add";
    row.hidden = true;

    var pick = el("input");
    pick.type = "file";
    pick.id = "book-file";
    pick.accept = ".pdf,.epub,application/pdf,application/epub+zip";
    pick.hidden = true;

    var b = el("button", "btn add-book", "＋ Add a book");
    b.type = "button";
    b.id = "book-add";
    b.addEventListener("click", function () { pick.value = ""; pick.click(); });

    /* Off unless it is asked for: the button on its own writes to this
       browser, and this one writes to the public site. */
    var pub = el("label", "shelf-pub");
    pub.id = "book-pub-row";
    pub.hidden = true;
    pub.title = "Commit it to docs/books/, where every device reads the shelf";
    var tick = el("input");
    tick.type = "checkbox";
    tick.id = "book-pub";
    pub.appendChild(tick);
    pub.appendChild(el("span", null, "Put it on the site too"));

    var msg = el("span", "shelf-msg");
    msg.id = "book-msg";

    pick.addEventListener("change", function () {
      if (pick.files && pick.files[0]) takeBook(pick.files[0]);
    });

    row.appendChild(b);
    row.appendChild(pick);
    row.appendChild(pub);
    row.appendChild(msg);
    return row;
  }

  function bookMsg(text, tone) {
    var n = document.getElementById("book-msg");
    if (!n) return;
    n.textContent = text || "";
    n.className = "shelf-msg" + (tone ? " " + tone : "");
  }

  /* Fetched the first time a file is picked, and never on a visit that picks
     none. Kept behind a hook because the test harness runs the page in jsdom,
     which has no dynamic import to run. */
  function readBookFile(file, say) {
    if (window.bookifyStub) return Promise.resolve(window.bookifyStub(file, say));
    return import("./bookify.js").then(function (mod) { return mod.bookify(file, say); });
  }

  function takeBook(file) {
    var add = document.getElementById("book-add");
    if (add) add.disabled = true;
    bookMsg("Reading " + file.name + "…", "warn");
    readBookFile(file, function (at, all) {
      bookMsg("Reading page " + fmt(at) + " of " + fmt(all) + "…", "warn");
    }).then(function (book) {
      var tick = document.getElementById("book-pub");
      var alsoSite = !!(tick && tick.checked) && canPublishBooks();
      return keepBook(book).then(function () {
        bookText[book.slug] = book;
        bookMsg(book.title + " · "
          + plural(book.chapters.length, "chapter", "chapters")
          + (alsoSite ? " · putting it on the site…" : ""),
          alsoSite ? "warn" : "good");
        return refreshShelf().then(function () {
          var found = null;
          BOOKS.forEach(function (b) { if (b.slug === book.slug) found = b; });
          if (found) { select(found.id); showDetail(); }
        });
      }).then(function () {
        /* The book is readable here already; the site is the slow half, so it
           is reported when it lands rather than waited for first. */
        if (!alsoSite) return null;
        return publishBook(book).then(function (res) {
          if (tick) tick.checked = false;
          if (res.already) {
            markOnSite(book);
            bookMsg(book.title + " is on the site already — nothing was sent. "
              + "Open it and press Replace on the site to put this copy up "
              + "instead.", "warn");
            return;
          }
          markOnSite(book);
          bookMsg(book.title + " is on the site — every device has it once "
            + "GitHub Pages has published the commit, a minute or so.", "good");
        }, function (err) {
          bookMsg("On this device, but not on the site — "
            + (err && err.message ? err.message : "unknown"), "bad");
        });
      });
    }).catch(function (err) {
      bookMsg("Could not read that file — " + (err && err.message ? err.message : "unknown"),
        "bad");
    }).then(function () {
      if (add) add.disabled = false;
    });
  }

  /* The shelf entry knows the chapter names and not one word of the text, so
     the book is read back out of this device's storage before it is sent. */
  function sendBook(book, btn) {
    var replacing = onSite(book.slug);
    var was = btn.textContent;
    btn.disabled = true;
    btn.textContent = replacing ? "Replacing…" : "Saving…";
    loadBook(book).then(function (full) {
      return publishBook(full, replacing).then(function (res) {
        if (res.already) {
          toast(book.title + " is on the site already");
        } else {
          toast(book.title + (res.replaced ? " replaced on the site" : " is on the site")
            + " — a minute for GitHub Pages to publish it");
        }
        markOnSite(full);
      });
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = was;
      toast("Not sent — " + (err && err.message ? err.message : "unknown"));
    });
  }

  /* The site's shelf is read once, when the page opens, so what was just put
     on it is put on this copy of it too — the button reads its state from
     there, and so does the next book added with the same name. */
  function markOnSite(full) {
    if (!onSite(full.slug)) {
      var entry = onShelf(full);
      delete entry.mine;
      SHELF_NET = SHELF_NET.concat([entry]);
      indexShelf();
    }
    drawDetail();
  }

  function forgetBook(book) {
    dropBook(book.slug).then(function () {
      delete bookText[book.slug];
      selectedBook = null;
      openChapter = 0;
      return refreshShelf();
    }).then(function () {
      toast(book.title + " removed from this device");
    }, function () {
      toast("Could not remove that book");
    });
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
        markPlace();            // the passage, and the line of it, to come back to
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

      machineTranslate(text).then(function (got) {
        line.textContent = got.text;
        line.appendChild(el("em", null, got.via + ", not from the notebook"));
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
    if (view === "book") {
      w.appendChild(el("p", "lead", "Pick a book"));
      w.appendChild(el("p", "sub",
        "Every book is split into chapters. Open one and select any word or "
        + "phrase in it, the same as in a passage."));
      return w;
    }
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
    /* The number is the handle: a word's senses come back in the dictionary's
       order of importance, which is not the order they matter to the person
       learning it. */
    var grip = el("button", "sense-grip");
    grip.type = "button";
    grip.title = "Drag to reorder, or use the arrow keys";
    grip.setAttribute("aria-label", "Move this sense");
    grip.appendChild(el("span", "grip-dots", "⠿"));
    grip.appendChild(el("span", "lab", "Sense " + n));
    dragSense(box, grip);
    row.appendChild(grip);
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

    /* A sense belongs where it belongs: this puts one in the gap under this
       box rather than at the end of eighteen of them. It sits in the gap
       itself, so the list is still nothing but senses. */
    var add = el("button", "sense-add", "+");
    add.type = "button";
    add.title = "Add a sense here";
    add.setAttribute("aria-label", "Add a sense after this one");
    add.addEventListener("click", function () { addSenseAfter(box); });
    box.appendChild(add);
    return box;
  }

  function addSenseAfter(box) {
    var list = document.getElementById("sense-list");
    var fresh = newSenseRow(0);
    list.insertBefore(fresh, box.nextSibling);
    renumberSenses();
    fresh.querySelector("[name=def]").focus();
    return fresh;
  }
  /* Reordering is moving the box in the list and renumbering: the form is read
     off the DOM when it is saved and when it is put on the rail, so there is
     nothing else to keep in step. */
  function moveSense(box, by) {
    var list = document.getElementById("sense-list");
    var kids = [].slice.call(list.children);
    var at = kids.indexOf(box);
    var to = at + by;
    if (at < 0 || to < 0 || to >= kids.length) return;
    if (by > 0) list.insertBefore(box, kids[to].nextSibling);
    else list.insertBefore(box, kids[to]);
    renumberSenses();
  }

  function dragSense(box, grip) {
    grip.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowUp") { ev.preventDefault(); moveSense(box, -1); grip.focus(); }
      else if (ev.key === "ArrowDown") { ev.preventDefault(); moveSense(box, 1); grip.focus(); }
    });

    grip.addEventListener("mousedown", function (ev) {
      if (ev.button !== 0) return;
      var list = document.getElementById("sense-list");
      ev.preventDefault();
      box.classList.add("lifting");
      /* Where the pointer is against the middle of every other box: past the
         middle of the one above and it goes above it, and the same downwards. */
      var move = function (on) {
        var kids = [].slice.call(list.children);
        var me = kids.indexOf(box);
        for (var i = 0; i < kids.length; i++) {
          if (i === me) continue;
          var r = kids[i].getBoundingClientRect();
          var mid = r.top + r.height / 2;
          if (i < me && on.clientY < mid) { list.insertBefore(box, kids[i]); break; }
          if (i > me && on.clientY > mid) { list.insertBefore(box, kids[i].nextSibling); break; }
        }
        renumberSenses();
      };
      var up = function () {
        box.classList.remove("lifting");
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
  }

  function renumberSenses() {
    var boxes = document.querySelectorAll("#sense-list .sense-edit");
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].querySelector(".lab").textContent = "Sense " + (i + 1);
      boxes[i].querySelector(".drop").hidden = boxes.length === 1;
      var add = boxes[i].querySelector(".sense-add");
      if (add) add.hidden = i === boxes.length - 1;   // the wide button is there
    }
  }

  /* Add word with one already open puts that one on the rail rather than
     throwing it away — the whole point of the rail. */
  function openForm(prefill) {
    if (!mayAdd()) { openSettings(true); return; }
    if (current) hideCurrent();
    var card = newCard(prefill || "");
    current = card;
    paintCard(card);
    drawRail();
    var dlg = document.getElementById("form-dlg");
    placeForm();
    if (!dlg.open) dlg.show();
    dlg.querySelector("[name=word]").focus();
  }

  /* The form's one line of feedback: amber while it is working, green when
     something came back, red when nothing did. */
  function formMsg(text, tone) {
    var msg = document.getElementById("form-msg");
    msg.className = "dlg-msg" + (tone ? " " + tone : "");
    msg.textContent = text;
  }

  /* ---- forms that are still being filled in ------------------------------

     A lookup takes as long as Cambridge and the model take, and a form that
     will not answer until then is a form you cannot use. So a form is a card:
     Hide puts it on the rail down the right-hand side, still being looked up,
     and Add word opens another beside it. Press a card on the rail to have it
     back, with whatever came for it while it was away.

     The form itself is one dialog, shown without a backdrop so that the rail
     and the Add word button stay live behind it. One card is on screen at a
     time; the rest keep their fields, their word and their lookup in here. */
  var cards = [];
  var current = null;
  var cardSeq = 0;
  var FILLS_AT_ONCE = 2;

  function newCard(word) {
    var card = {
      id: "c" + (++cardSeq),
      saving: null,          // "sheet" or "device" while Save word is running
      word: word || "",
      pos: "", ipa: "", type: "word", note: "",
      senses: [],
      /* The Vietnamese is the column the notebook is kept for, so it is asked
         for by default; the examples are not. */
      want: { eg: false, vi: true },
      fill: null,            // {state, res, err, stop} once Auto Fill is pressed
      shown: true,           // whether what came back is already in the boxes
      msg: "", msgTone: ""
    };
    cards.push(card);
    return card;
  }

  function cardState(card) {
    if (card.saving) return card.saving === "sheet" ? "writing" : "saving";
    return card.fill ? card.fill.state : "draft";
  }

  function cardName(card) {
    return card.word || "a new word";
  }

  /* Four cards saying "rough" would be four of the same thing otherwise. */
  function cardLabel(card) {
    return cardName(card) + (card.pos ? " · " + card.pos : "");
  }

  /* ---- the rail ---------------------------------------------------------- */
  function buildRail() {
    var rail = el("div", "card-rail");
    rail.id = "card-rail";
    rail.hidden = true;
    var head = el("div", "card-rail-head", "Waiting");
    head.id = "card-rail-head";
    rail.appendChild(head);
    var list = el("div", "card-list");
    list.id = "card-list";
    rail.appendChild(list);
    return rail;
  }

  function stateWord(state) {
    return state === "writing" ? "writing to the sheet…"
      : state === "saving" ? "saving…"
      : state === "filling" ? "looking up…"
      : state === "waiting" ? "in line"
      : state === "failed" ? "no luck"
      : state === "ready" ? "ready" : "draft";
  }

  function drawRail() {
    var rail = document.getElementById("card-rail");
    if (!rail) return;
    var parked = cards.filter(function (c) { return c !== current; });
    rail.hidden = !parked.length;
    var list = document.getElementById("card-list");
    list.textContent = "";
    parked.forEach(function (card) {
      var row = el("div", "card-row");
      row.dataset.word = card.word;
      var open = el("button", "card-open");
      open.type = "button";
      open.appendChild(el("span", "card-word", cardLabel(card)));
      open.appendChild(el("span", "card-state", stateWord(cardState(card))));
      open.addEventListener("click", function () { showCard(card); });
      row.appendChild(open);
      var x = el("button", "card-x", "×");
      x.type = "button";
      x.title = "Throw " + cardName(card) + " away";
      x.setAttribute("aria-label", "Throw " + cardName(card) + " away");
      x.addEventListener("click", function () { dropCard(card); });
      row.appendChild(x);
      list.appendChild(row);
    });
  }

  /* ---- the form as a window ----------------------------------------------

     Dragged by its head, the way a window is, because a form that stays put
     over the one paragraph you wanted to read is no better than a modal. Where
     it is put is kept for the rest of the session: the next card off the rail
     opens where you left the last one. Two taps on the head puts it back in
     the middle. */
  var formPos = null;
  var formSize = null;
  var MIN_W = 380;
  var MIN_H = 260;

  /* Dragging fires a mousemove for every pixel and the form is a fixed box
     with a wide shadow: writing its style on each one asks the browser to lay
     it out again dozens of times a frame, which is exactly what it looked
     like. One write per frame instead. */
  var formFrame = 0;

  function placeFormSoon() {
    if (formFrame) return;
    var soon = window.requestAnimationFrame
      || function (fn) { return setTimeout(fn, 16); };
    formFrame = soon(function () {
      formFrame = 0;
      placeForm();
    });
  }

  function placeForm() {
    var dlg = document.getElementById("form-dlg");
    if (!dlg) return;
    if (formPos) {
      dlg.style.left = formPos.left + "px";
      dlg.style.top = formPos.top + "px";
      dlg.style.transform = "none";
    } else {
      dlg.style.left = "";
      dlg.style.top = "";
      dlg.style.transform = "";
    }
    /* A form given a height of its own hands it to the middle section: the
       head and the foot keep theirs and the senses take what is left. */
    if (formSize) {
      dlg.style.width = formSize.w + "px";
      dlg.style.height = formSize.h + "px";
      dlg.classList.add("sized");
    } else {
      dlg.style.width = "";
      dlg.style.height = "";
      dlg.classList.remove("sized");
    }
  }

  /* Enough of it stays on screen to be caught again by whichever edge it was
     pushed towards. */
  function clampForm(box) {
    if (formSize) {
      formSize.w = Math.max(MIN_W, Math.min(formSize.w, window.innerWidth));
      formSize.h = Math.max(MIN_H, Math.min(formSize.h, window.innerHeight));
    }
    if (!formPos) return;
    var w = (formSize && formSize.w) || (box && box.width) || 0;
    formPos.left = Math.max(90 - w, Math.min(formPos.left, window.innerWidth - 90));
    formPos.top = Math.max(0, Math.min(formPos.top, window.innerHeight - 40));
  }

  function onHeadItself(ev) {
    return !(ev.target && ev.target.closest
      && ev.target.closest("button, input, select, textarea, a"));
  }

  function dragForm(head) {
    head.addEventListener("mousedown", function (ev) {
      if (ev.button !== 0 || !onHeadItself(ev)) return;
      var dlg = document.getElementById("form-dlg");
      var box = dlg.getBoundingClientRect();
      var dx = ev.clientX - box.left;
      var dy = ev.clientY - box.top;
      ev.preventDefault();
      head.classList.add("dragging");
      dlg.classList.add("moving");
      var move = function (on) {
        formPos = { left: on.clientX - dx, top: on.clientY - dy };
        clampForm(box);
        placeFormSoon();
      };
      var up = function () {
        head.classList.remove("dragging");
        dlg.classList.remove("moving");
        placeForm();
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });

    head.addEventListener("dblclick", function (ev) {
      if (!onHeadItself(ev)) return;
      formPos = null;
      formSize = null;
      placeForm();
    });
  }

  /* ---- and pulled about by its edges -------------------------------------

     Eight strips laid over the border: the four sides and, since they cost
     nothing once the sides are there, the four corners. A side moved inwards
     takes the opposite side with it — pulling the left edge right moves the
     form as well as narrows it, which is what an edge is expected to do. */
  var GRIPS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

  function buildGrips(dlg) {
    GRIPS.forEach(function (dir) {
      var grip = el("div", "rs rs-" + dir);
      grip.dataset.dir = dir;
      grip.addEventListener("mousedown", function (ev) {
        if (ev.button === 0) startResize(dir, ev);
      });
      dlg.appendChild(grip);
    });
  }

  function startResize(dir, ev) {
    var dlg = document.getElementById("form-dlg");
    var box = dlg.getBoundingClientRect();
    var x0 = ev.clientX, y0 = ev.clientY;
    var from = { left: box.left, top: box.top, w: box.width, h: box.height };
    ev.preventDefault();
    dlg.classList.add("resizing");
    var move = function (on) {
      var dx = on.clientX - x0, dy = on.clientY - y0;
      var left = from.left, top = from.top, w = from.w, h = from.h;
      if (dir.indexOf("e") > -1) w = from.w + dx;
      if (dir.indexOf("s") > -1) h = from.h + dy;
      if (dir.indexOf("w") > -1) { w = from.w - dx; left = from.left + dx; }
      if (dir.indexOf("n") > -1) { h = from.h - dy; top = from.top + dy; }
      if (w < MIN_W) {
        if (dir.indexOf("w") > -1) left -= MIN_W - w;
        w = MIN_W;
      }
      if (h < MIN_H) {
        if (dir.indexOf("n") > -1) top -= MIN_H - h;
        h = MIN_H;
      }
      formSize = { w: w, h: h };
      formPos = { left: left, top: top };
      placeFormSoon();
    };
    var up = function () {
      dlg.classList.remove("resizing");
      placeForm();
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  /* ---- moving a card on and off the screen -------------------------------- */
  /* What is in the boxes right now, so the card comes back as it was left. */
  function snapCurrent() {
    if (!current) return;
    var dlg = document.getElementById("form-dlg");
    current.word = dlg.querySelector("[name=word]").value.trim();
    current.pos = dlg.querySelector("[name=pos]").value;
    current.ipa = dlg.querySelector("[name=ipa]").value;
    current.type = dlg.querySelector("[name=type]").value;
    current.note = dlg.querySelector("[name=note]").value;
    current.want = {
      eg: document.getElementById("fill-eg").checked,
      vi: document.getElementById("fill-vi").checked
    };
    current.senses = [];
    var boxes = document.querySelectorAll("#sense-list .sense-edit");
    for (var i = 0; i < boxes.length; i++) {
      current.senses.push({
        def: boxes[i].querySelector("[name=def]").value,
        vi: boxes[i].querySelector("[name=vi]").value,
        eg: []
      });
    }
    current.msg = document.getElementById("form-msg").textContent;
  }

  /* Hide shuts the form, always. Whether there is a card behind it to keep is
     a separate question from whether the thing on screen goes away: a form
     that stays put when Hide is pressed is the one thing this must not do. */
  function hideCurrent() {
    /* Keeping the card is worth a try; shutting the window is not optional. A
       fault in the first must not swallow the second, and must not be silent
       either — a button that does nothing at all is the worst kind. */
    try {
      if (current) snapCurrent();
    } catch (err) {
      toast("The form was hidden, but what was typed in it could not be kept: "
        + (err && err.message ? err.message : err));
    }
    current = null;
    var dlg = document.getElementById("form-dlg");
    if (dlg && dlg.open) dlg.close();
    try { drawRail(); } catch (err2) { /* the rail redraws on the next change */ }
  }

  function paintCard(card) {
    var dlg = document.getElementById("form-dlg");
    document.getElementById("fill-eg").checked = !!card.want.eg;
    document.getElementById("fill-vi").checked = !!card.want.vi;
    applyDraft({ type: card.type, word: card.word, verb: "", particle: "",
                 pos: card.pos, ipa: card.ipa, senses: card.senses },
               { eg: true, vi: true });
    dlg.querySelector("[name=word]").value = card.word || "";
    dlg.querySelector("[name=note]").value = card.note || "";
    formMsg(card.msg || "", card.msgTone || "");
    paintSaveButton(card);
  }

  function showCard(card) {
    if (current === card) return;
    if (current) hideCurrent();
    current = card;
    paintCard(card);
    /* Whatever came back while it was on the rail goes into the boxes now. */
    if (!card.shown) landIntoForm(card);
    drawRail();
    var dlg = document.getElementById("form-dlg");
    placeForm();
    if (!dlg.open) dlg.show();
    dlg.querySelector("[name=word]").focus();
  }

  function dropCard(card) {
    if (card.fill && card.fill.state === "filling" && card.fill.stop) {
      try { card.fill.stop.abort(); } catch (err) { /* older browsers */ }
    }
    if (card.fill) card.fill.state = "dropped";
    cards = cards.filter(function (c) { return c !== card; });
    if (current === card) {
      current = null;
      document.getElementById("form-dlg").close();
    }
    drawRail();
    pumpFills();
  }

  /* ---- the lookups themselves --------------------------------------------- */
  /* Two at a time. Each is its own request to the same Apps Script, which
     answers them side by side; more than a couple only queues them at the far
     end, where nothing can be called off. */
  function pumpFills() {
    var going = 0, i;
    for (i = 0; i < cards.length; i++) {
      if (cards[i].fill && cards[i].fill.state === "filling") going++;
    }
    for (i = 0; i < cards.length && going < FILLS_AT_ONCE; i++) {
      if (cards[i].fill && cards[i].fill.state === "waiting") {
        startFill(cards[i]);
        going++;
      }
    }
  }

  function startFill(card) {
    var f = card.fill;
    f.state = "filling";
    drawRail();
    /* A card thrown away while its lookup is in the air tells the browser to
       stop; where it cannot, the answer is ignored when it arrives. */
    if (typeof AbortController === "function") f.stop = new AbortController();
    callSheet({ action: "draft", word: card.word, eg: card.want.eg, vi: card.want.vi },
      f.stop && f.stop.signal).then(function (res) {
      if (f.state === "dropped") return;
      f.state = "ready";
      f.res = res;
      card.shown = false;
      landFill(card);
    }, function (err) {
      if (f.state === "dropped") return;
      f.state = "failed";
      f.err = err && err.message ? err.message : String(err);
      card.shown = false;
      landFill(card);
    });
  }

  function landFill(card) {
    if (current === card) landIntoForm(card);
    else if (card.fill.state === "failed") toast(cardName(card) + ": " + card.fill.err);
    drawRail();
    pumpFills();
  }

  /* The draft into the boxes, and the line under them saying where it came
     from. Done when the card is on screen, and left waiting when it is not. */
  function landIntoForm(card) {
    card.shown = true;
    if (card.fill.state === "failed") {
      card.msg = card.fill.err;
      card.msgTone = "";
      formMsg(card.msg, "");
      return;
    }
    applyDraft(card.fill.res.entry, card.want);
    card.msg = fillSays(card.fill.res);
    card.msgTone = "good";
    formMsg(card.msg, "good");
    snapCurrent();
  }

  function fillSays(res) {
    res = res || {};
    var bits = [res.source === "Cambridge"
      ? "Filled from Cambridge."
      : "Cambridge had no entry — filled from " + (res.source || "the dictionary") + "."];
    if (res.glossed) {
      bits.push("The Vietnamese for " + plural(res.glossed, "sense", "senses")
        + " was written by " + (res.by || "the model") + ".");
    }
    if (res.translated) {
      bits.push(plural(res.translated, "sense", "senses")
        + " came back machine-translated — look at those twice.");
    }
    if (res.dropped) {
      bits.push("Cambridge lists " + plural(res.dropped, "sense", "senses")
        + " more than fitted here.");
    }
    if (res.warning) bits.push(res.warning);
    bits.push("Then press Save word.");
    return bits.join(" ");
  }

  function firstReadyCard() {
    for (var i = 0; i < cards.length; i++) {
      var st = cardState(cards[i]);
      if (st === "ready" || st === "failed") return cards[i];
    }
    return null;
  }

  function openNextCard() {
    var card = firstReadyCard();
    if (card) showCard(card);
  }

  /* Cambridge fills the form in and stops there: nothing is written until you
     read it over and press Save word yourself. */
  function fillFromCambridge() {
    var dlg = document.getElementById("form-dlg");
    var word = dlg.querySelector("[name=word]").value.trim();
    if (!word) { formMsg("Type the word first.", ""); return; }
    if (!canWriteSheet()) {
      formMsg("This goes through the sheet's Web App link — set it in Settings first.", "");
      return;
    }
    var want = {
      eg: document.getElementById("fill-eg").checked,
      vi: document.getElementById("fill-vi").checked
    };
    if (!current) return;                       // no card, nothing to fill in
    current.word = word;
    current.want = want;
    current.fill = { state: "waiting", res: null, err: "", stop: null };
    current.shown = true;
    current.msg = "Looking " + word + " up. Press Hide and this form goes to the "
      + "rail on the right, with the answer waiting in it.";
    current.msgTone = "warn";
    formMsg(current.msg, "warn");
    drawRail();
    pumpFills();
  }

  /* One sense per box, the examples under their own definition the way the
     sheet writes them. */
  function applyDraft(e, want) {
    if (!e) return;
    /* Left to itself a draft carries everything it found; the boxes beside the
       button decide how much of it lands in the form. */
    var wantEg = want ? !!want.eg : true;
    var wantVi = want ? !!want.vi : true;
    var dlg = document.getElementById("form-dlg");
    dlg.querySelector("[name=word]").value = e.type === "phrasal"
      ? (e.verb + " " + e.particle).trim() : (e.word || "");
    dlg.querySelector("[name=pos]").value = e.pos || "";
    dlg.querySelector("[name=ipa]").value = e.ipa || "";
    dlg.querySelector("[name=type]").value = e.type || "word";
    var list = document.getElementById("sense-list");
    list.textContent = "";
    (e.senses || []).forEach(function (s, i) {
      var box = newSenseRow(i + 1);
      box.querySelector("[name=def]").value = senseText(s, { eg: wantEg });
      box.querySelector("[name=vi]").value = wantVi ? (s.vi || "") : "";
      list.appendChild(box);
    });
    if (!list.children.length) list.appendChild(newSenseRow(1));
    renumberSenses();
  }

  /* A definition with its examples under it, the way the sheet writes them. */
  function senseText(s, want) {
    var def = s.def || "";
    if (want && want.eg) {
      (s.eg || []).forEach(function (x) { def += "\n- " + x; });
    }
    return def;
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
    var type = dlg.querySelector("[name=type]").value;
    var bits = word.split(/\s+/);
    return {
      entry: {
        id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: type,
        word: word,
        verb: type === "phrasal" && bits.length > 1 ? bits[0] : "",
        particle: type === "phrasal" && bits.length > 1 ? bits.slice(1).join(" ") : "",
        pos: dlg.querySelector("[name=pos]").value.trim(),
        ipa: dlg.querySelector("[name=ipa]").value.trim(),
        note: dlg.querySelector("[name=note]").value.trim(),
        senses: senses,
        mine: true,
        at: new Date().toISOString().slice(0, 10)
      }
    };
  }

  /* The Save button says what the card is doing, so a card put on the rail
     mid-write and brought back again does not look idle. */
  function paintSaveButton(card) {
    var btn = document.getElementById("form-save");
    if (!btn) return;
    var doing = card && card.saving;
    btn.disabled = !!doing;
    btn.textContent = doing === "sheet" ? "Writing to the sheet…"
      : doing ? "Saving…" : "Save word";
  }

  /* Writing a word to the sheet is a second or two of somebody else's server,
     and there is no reason to watch that either: Hide puts the card on the
     rail mid-write, the rail says what it is doing, and the toast at the
     bottom says when it is done. */
  function saveForm() {
    var got = collectForm();
    if (got.err) { formMsg(got.err, ""); return; }
    var card = current;
    var box = document.getElementById("to-sheet");
    var wantSheet = canWriteSheet() && box && box.checked;
    if (card) {
      snapCurrent();
      card.saving = wantSheet ? "sheet" : "device";
      card.msg = "";
      card.msgTone = "";
    }
    paintSaveButton(card);
    formMsg("", "");
    drawRail();

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
        /* The card is done with, wherever it was when it finished. */
        if (card) {
          card.saving = null;
          cards = cards.filter(function (c) { return c !== card; });
        }
        var onScreen = current === card || !card;
        if (onScreen) {
          current = null;
          var dlg = document.getElementById("form-dlg");
          if (dlg.open) dlg.close();
        }
        paintSaveButton(null);
        drawRail();
        /* Straight on to the next word that came back while this one was being
           read — but only if it was this form that was on screen. */
        if (onScreen) setTimeout(openNextCard, 0);
        if (res.ok && res.reload) { toast("Saved “" + got.entry.word + "”"); return; }
        ADDED = next;
        rebuild();
        refresh();
        if (onScreen) {
          select(got.entry.id);
          showDetail();
        }
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
    b.classList.add("turning");        // the arrows go round while it reads
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
    }).then(function () {
      b.disabled = false;
      b.classList.remove("turning");
    });
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
  /* A page kept open all day on a phone has no console to look at, and a
     script that falls over quietly looks exactly like a button that does
     nothing. The first few faults are said out loud; after that they would be
     noise. */
  var faultsSaid = 0;
  function sayFault(what) {
    if (faultsSaid >= 3) return;
    faultsSaid++;
    toast("Something went wrong: " + what);
  }

  function watchFaults() {
    window.addEventListener("error", function (ev) {
      if (ev && ev.error) sayFault(ev.message || String(ev.error));
    });
    window.addEventListener("unhandledrejection", function (ev) {
      var why = ev && ev.reason;
      sayFault((why && why.message) || String(why || "a promise was dropped"));
    });
  }

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
    if (view === "book") {
      box.appendChild(document.createTextNode(plural(hits.length, "book", "books")));
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
    box.hidden = view === "read" || view === "book";
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
    box.hidden = view === "read" || view === "book" || !!query.trim();
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
    back.addEventListener("click", function () {
      document.body.dataset.view = "list";
      showTop();
    });
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

    /* Two arrows round a circle: what the button does is a turn of the
       handle, and on a phone the words for it took a third of the bar. The
       name lives on in the tooltip and in what a screen reader says. */
    var sync = el("button", "btn btn-icon");
    sync.type = "button";
    sync.id = "sync-sheet";
    sync.hidden = true;
    sync.title = "Sync from sheet — read the Google Sheet and refresh this page from it";
    sync.setAttribute("aria-label", "Sync from sheet");
    sync.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
      + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
      + ' aria-hidden="true"><polyline points="23 4 23 10 17 10"/>'
      + '<polyline points="1 20 1 14 7 14"/>'
      + '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'
      + '</svg>';
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

    var hint = addToHomeHint();
    if (hint) app.appendChild(hint);

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
    list.appendChild(buildAdd());
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
    app.appendChild(buildRail());
    app.appendChild(buildDialog());
    app.appendChild(buildSettings());
    refreshChrome();
    restoreList();
    watchFaults();

    scrollBox.addEventListener("scroll", function () { paint(false); }, { passive: true });
    watchPlace(detail);
    watchTop(detail);
    measureBar();
    window.addEventListener("resize", function () {
      paint(true);
      measureBar();
      if (!narrowScreen()) showTop();
      var dlg = document.getElementById("form-dlg");
      if (formPos && dlg) { clampForm(dlg.getBoundingClientRect()); placeForm(); }
    });

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
      else if (ev.key === "d" && (view === "read" || view === "book")) {
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
    head.id = "form-head";
    head.appendChild(el("h2", null, "Add a word"));
    head.appendChild(el("p", null, "A word can carry several senses."));
    /* The × and Escape do what Hide does. A window shuts by its corner, and a
       form shown without a backdrop is not shut by Escape on its own. */
    var x = el("button", "dlg-x", "×");
    x.type = "button";
    x.id = "form-x";
    x.title = "Hide this form";
    x.setAttribute("aria-label", "Hide this form");
    x.addEventListener("click", hideCurrent);
    head.appendChild(x);
    dragForm(head);
    dlg.appendChild(head);
    dlg.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { ev.preventDefault(); hideCurrent(); }
    });
    buildGrips(dlg);

    var body = el("div", "dlg-body");
    /* The word and the button that looks it up sit on one line: what you type
       and the thing that acts on it, side by side. Everything the lookup only
       ever fills in — part of speech, phonetics — waits on the line below. */
    var g = el("div", "grid-word");
    g.appendChild(field("Word", "word", "abate", false));
    g.appendChild(buildFillBox());
    body.appendChild(g);

    var g1 = el("div", "grid-2");
    g1.appendChild(field("Part of speech", "pos", "v", false));
    g1.appendChild(field("Phonetics", "ipa", "/əˈbeɪt/", true));
    body.appendChild(g1);

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
    /* Hide keeps the form and its lookup, on the rail; Cancel throws both
       away. Two different things, so two buttons. */
    var hide = el("button", "btn", "Hide");
    hide.type = "button";
    hide.id = "form-hide";
    hide.title = "Put this form on the rail and carry on";
    hide.addEventListener("click", hideCurrent);
    foot.appendChild(hide);
    var cancel = el("button", "btn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function () {
      if (current) dropCard(current);
      else dlg.close();
    });
    foot.appendChild(cancel);
    var save = el("button", "btn btn-primary", "Save word");
    save.type = "button";
    save.id = "form-save";
    save.addEventListener("click", saveForm);
    foot.appendChild(save);
    dlg.appendChild(foot);
    return dlg;
  }

  /* Auto Fill, and the two things it may bring along. Both start unticked: a
     draft is a definition and nothing else unless you ask for more. */
  function buildFillBox() {
    var box = el("div", "fill-box");
    var fill = el("button", "btn", "Auto Fill");
    fill.type = "button";
    fill.id = "form-fill";
    fill.addEventListener("click", fillFromCambridge);
    box.appendChild(fill);
    var opts = el("div", "fill-opts");
    opts.appendChild(fillOpt("fill-eg", "Include examples"));
    opts.appendChild(fillOpt("fill-vi", "Include Vietnamese meaning"));
    box.appendChild(opts);
    return box;
  }

  function fillOpt(id, label) {
    var row = el("label", "checkrow");
    var cb = el("input");
    cb.type = "checkbox";
    cb.id = id;
    row.appendChild(cb);
    row.appendChild(el("span", null, label));
    return row;
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


  /* ---- installing it on a phone ------------------------------------------- */
  /* Android offers its own install prompt; iOS offers nothing at all, so on an
     iPhone the page has to point at the Share menu itself. Shown once, and only
     to a Safari that is not already running the installed copy. */
  var A2HS_KEY = "engrowdict:a2hs:v1";

  function onIphone() {
    var ua = navigator.userAgent || "";
    var ios = /iPad|iPhone|iPod/.test(ua)
      || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);   // iPadOS
    var safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return ios && safari;
  }

  function installed() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || navigator.standalone === true;
  }

  function addToHomeHint() {
    if (MODE !== "static" || installed() || !onIphone()) return null;
    try { if (localStorage.getItem(A2HS_KEY)) return null; } catch (err) { /* private mode */ }

    var bar = el("div", "a2hs");
    bar.id = "a2hs";
    var text = el("span");
    text.appendChild(el("b", null, "Keep it on your Home Screen. "));
    text.appendChild(document.createTextNode(
      "Share \u2191 → Add to Home Screen. It opens full screen and the whole "
      + "dictionary works with no signal."));
    bar.appendChild(text);
    var x = el("button", "x", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Dismiss");
    x.addEventListener("click", function () {
      bar.remove();
      try { localStorage.setItem(A2HS_KEY, "1"); } catch (err) { /* private mode */ }
    });
    bar.appendChild(x);
    return bar;
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
    var x = el("button", "dlg-x", "×");
    x.type = "button";
    x.id = "set-x";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", function () { dlg.close(); });
    head.appendChild(x);
    dlg.appendChild(head);

    var body = el("div", "dlg-body");

    /* --- passcode ------------------------------------------------------- */
    var gate = el("div", "gate");
    gate.id = "gate";
    body.appendChild(gate);

    /* --- the sheet, folded away until it is wanted ----------------------- */
    /* Swapping workbooks is one field out of the three, so the steps sit right
       above them rather than in a manual nobody opens. */
    var fold = el("details", "setfold");
    fold.id = "sheet-fold";
    var sum = el("summary", "setfold-head");
    sum.appendChild(el("span", "setfold-title", "The sheet"));
    var state = el("span", "setfold-state");
    state.id = "sheet-fold-state";
    sum.appendChild(state);
    fold.appendChild(sum);

    var inner = el("div", "setfold-body");
    inner.appendChild(el("p", "setfold-lede", "To change workbook:"));

    var steps = el("ol", "steps");
    [
      "Paste the new link below, then Test connection and Save.",
      "Press Sync in the top bar.",
      "To take a word out, delete its row in the sheet, then Sync again.",
    ].forEach(function (t) { steps.appendChild(el("li", null, t)); });
    inner.appendChild(steps);

    inner.appendChild(el("p", "setfold-note",
      "The other two fields never change: they belong to the Apps Script project, "
      + "not to a workbook."));

    /* Where those two come from, for whoever has not set them up before. */
    var first = el("details", "setfold sub");
    first.id = "first-fold";
    var fsum = el("summary", "setfold-head");
    fsum.appendChild(el("span", "setfold-title", "Where the link and key come from"));
    fsum.appendChild(el("span", "setfold-state", "once, ever"));
    first.appendChild(fsum);

    var fbody = el("div", "setfold-body");
    fbody.appendChild(el("p", "setfold-lede", "The sheet hands you both."));

    var fsteps = el("ol", "steps");
    fsteps.appendChild(el("li", null, "In the sheet: Extensions → Apps Script."));
    var li2 = el("li", null, "Paste in ");
    li2.appendChild(repoFileLink("sheet-sync.gs"));
    li2.appendChild(document.createTextNode(", then Save."));
    fsteps.appendChild(li2);
    [
      "Deploy → New deployment → Web app → Anyone → Deploy, and allow it.",
      "Reload the sheet: EngrowDict menu → Link for the web to write words.",
      "Copy both into the fields below → Test connection → Save.",
    ].forEach(function (t) { fsteps.appendChild(el("li", null, t)); });
    fbody.appendChild(fsteps);

    fbody.appendChild(el("p", "setfold-note",
      "Already deployed? Manage deployments → ✏️ → New version, which keeps the "
      + "same link. Done once, this covers every workbook after it."));
    first.appendChild(fbody);
    inner.appendChild(first);

    var links = el("div", "setgroup");
    links.id = "setgroup";
    links.appendChild(setRow("sheet", "Google Sheet link", "sheetUrl",
      "https://docs.google.com/spreadsheets/d/…",
      "Which workbook Add word and Sync use.", false));
    links.appendChild(setRow("webapp", "Sync Web App link", "webApp",
      "https://script.google.com/macros/s/…/exec",
      "EngrowDict menu → Link for the web to write words.", false));
    links.appendChild(setRow("key", "Sync key", "key", "",
      "Shown with that link.", true));
    inner.appendChild(links);

    /* The key for the Vietnamese column belongs to the script, not to this
       browser, so it is typed here and sent straight on — this page is the one
       place that already knows which script it is talking to, and a sheet may
       hold a copy of that script whose properties do nothing. Sent, never
       stored, never read back: what comes back is only which service it is. */
    var aiRow = el("div", "setrow");
    aiRow.id = "row-ai";
    aiRow.appendChild(el("span", "setlabel", "Key for the Vietnamese column"));
    var aiLine = el("div", "setline");
    var aiIn = el("input", "mono");
    aiIn.id = "ai-in";
    aiIn.type = "password";
    aiIn.placeholder = "Gemini, Claude or OpenAI key";
    aiIn.autocomplete = "off";
    aiIn.spellcheck = false;
    aiLine.appendChild(aiIn);
    var aiSend = el("button", "btn", "Send to the sheet");
    aiSend.type = "button";
    aiSend.id = "ai-send";
    aiSend.addEventListener("click", sendAiKey);
    aiLine.appendChild(aiSend);
    aiRow.appendChild(aiLine);
    aiRow.appendChild(el("span", "hint",
      "Kept in the script, not in this browser. Empty sends nothing; "
      + "Test connection says which service is answering."));
    links.appendChild(aiRow);

    fold.appendChild(inner);
    body.appendChild(fold);

    /* --- the shelf on the site ------------------------------------------ */
    /* Only wanted by whoever publishes books rather than keeping them on one
       device, so it is folded away like the sheet is. */
    var gfold = el("details", "setfold");
    gfold.id = "books-fold";
    var gsum = el("summary", "setfold-head");
    gsum.appendChild(el("span", "setfold-title", "Books for every device"));
    var gstate = el("span", "setfold-state");
    gstate.id = "books-fold-state";
    gsum.appendChild(gstate);
    gfold.appendChild(gsum);

    var ginner = el("div", "setfold-body");
    ginner.appendChild(el("p", "setfold-lede",
      "With a token here, Add a book offers to put the book on the site as "
      + "well as on this device, and every device then reads it off the shelf."));

    var gsteps = el("ol", "steps");
    [
      "On GitHub: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.",
      "Repository access: only this repo. Permissions → Contents: Read and write.",
      "Paste the token below and Save. It stays in this browser.",
    ].forEach(function (t) { gsteps.appendChild(el("li", null, t)); });
    ginner.appendChild(gsteps);

    ginner.appendChild(el("p", "setfold-note",
      "The book is committed to docs/books/, which is served to anyone who has "
      + "the address, so put out-of-copyright books there and keep the rest on "
      + "the device. GitHub Pages takes a minute to publish a commit."));

    var glinks = el("div", "setgroup");
    glinks.id = "setgroup-books";
    glinks.appendChild(setRow("repo", "GitHub repo", "repo", ghRepo() || "owner/name",
      "Only for a custom domain — otherwise the address says which repo.", false));
    glinks.appendChild(setRow("ghtoken", "GitHub token", "ghToken", "github_pat_…",
      "Fine-grained, Contents: read and write.", true));
    ginner.appendChild(glinks);

    gfold.appendChild(ginner);
    body.appendChild(gfold);

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
      callSheet({ action: "ping" }).then(function (res) {
        /* The one thing about the sheet that cannot be seen from here is
           whether a key for the Vietnamese was ever put in, so the ping says. */
        setMsg("Connected. " + (res.ai
          ? "Auto Fill asks " + res.ai + " for the Vietnamese"
            + (res.aiModel ? " (" + res.aiModel + ")" : "") + "."
          : "No key for the Vietnamese column is set in the script this link "
            + "runs" + (res.script ? " (" + res.script + ")" : "")
            + ", so that column is Google Translate. Put it in there, not in a "
            + "copy: EngrowDict menu in that script's own sheet, or Project "
            + "Settings, Script properties, SOTRATU_AI_KEY."), true);
      }, function (err) {
        setMsg("No luck: " + (err && err.message ? err.message : err), false);
      });
    });
    foot.appendChild(testBtn);
    var save = el("button", "btn btn-primary", "Save");
    save.type = "button";
    save.id = "set-save";
    save.addEventListener("click", function () {
      readForm();
      writeSettings();
      drawSettings();
      syncViewButtons();      // a token just pasted in puts the tick on the shelf
      refresh();
      dlg.close();
      toast("Settings saved");
    });
    foot.appendChild(save);
    dlg.appendChild(foot);

    /* Straight into the script's own properties. An empty box takes the key
       back out, which is the way to go back to Google Translate. */
    function sendAiKey() {
      var box = document.getElementById("ai-in");
      var btn = document.getElementById("ai-send");
      readForm();
      if (!settings.webApp || !settings.key) {
        setMsg("The Web App link and the Sync key are needed first.", false);
        return;
      }
      var raw = box.value.trim();
      btn.disabled = true;
      setMsg(raw ? "Sending the key to the script…" : "Taking the key out…", true);
      callSheet({ action: "setai", aiKey: raw }).then(function (res) {
        box.value = "";
        setMsg(res.ai
          ? "Saved in the script. Auto Fill asks " + res.ai
            + (res.aiModel ? " (" + res.aiModel + ")" : "") + " for the Vietnamese."
          : "The key is out. The Vietnamese column is Google Translate again.",
          true);
      }, function (err) {
        setMsg("Not saved: " + (err && err.message ? err.message : err), false);
      }).then(function () { btn.disabled = false; });
    }

    function readForm() {
      ["sheet:sheetUrl", "webapp:webApp", "key:key",
       "repo:repo", "ghtoken:ghToken"].forEach(function (pair) {
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
    showRowValue("repo", "repo");
    showRowValue("ghtoken", "ghToken");

    document.getElementById("books-fold-state").textContent =
      canPublishBooks() ? "publishing" : ghRepo() ? "device only" : "not on GitHub Pages";

    var ready = !!settings.sheetUrl && !!settings.webApp && !!settings.key;
    var fold = document.getElementById("sheet-fold");
    if (fold && !ready) fold.open = true;      // left alone once it is all filled in
    document.getElementById("sheet-fold-state").textContent = ready
      ? "linked" : "not set up yet";

    var on = unlocked();
    document.getElementById("setgroup").classList.toggle("disabled", !on);
    document.getElementById("setgroup-books").classList.toggle("disabled", !unlocked());
    var btns = document.querySelectorAll("#setgroup .edit-btn, #setgroup-books .edit-btn");
    for (var i = 0; i < btns.length; i++) btns[i].disabled = !on;
    document.getElementById("ai-send").disabled = !on;
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

  /* The shelf is read after the page is already usable: a missing books folder
     is the normal case, not a failure, and the tab simply stays hidden. What
     the site publishes and what was added on this device are one shelf. */
  function indexShelf() {
    var seen = {};
    BOOKS = SHELF_MINE.concat(SHELF_NET).filter(function (b) {
      if (!b || !b.title || !b.chapters || !b.chapters.length) return false;
      if (seen[b.slug]) return false;    // a device copy stands in for the site's
      seen[b.slug] = true;
      return true;
    }).map(function (b, i) {
      b.id = "b" + i;
      b.index = String(i + 1);
      b._w = norm(b.title);
      b._all = norm(b.title + " " + (b.author || "") + " "
        + b.chapters.map(function (c) { return c.title; }).join(" "));
      return b;
    });
    rebuild();
    syncViewButtons();
    if (view === "book") refresh();
  }

  function onShelf(book) {
    return {
      slug: book.slug,
      title: book.title,
      author: book.author,
      mine: true,
      chapters: book.chapters.map(function (c) {
        return {
          n: c.n,
          title: c.title,
          words: c.paras.reduce(function (n, p) { return n + p.split(/\s+/).length; }, 0)
        };
      })
    };
  }

  function refreshShelf() {
    return myBooks().then(function (list) {
      SHELF_MINE = list.map(onShelf);
      indexShelf();
    });
  }

  function shelf() {
    refreshShelf();
    if (typeof fetch !== "function") return;   // the artifact, opened from a file
    fetch("books/index.json").then(function (r) {
      return r.ok ? r.json() : [];
    }).then(function (list) {
      // a folder with no shelf in it can answer with anything at all
      if (!Array.isArray(list)) return;
      SHELF_NET = list;
      indexShelf();
    }, function () { /* no shelf, no tab */ });
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
    shelf();

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
