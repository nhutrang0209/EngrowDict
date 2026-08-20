/* Turning an uploaded book into chapters, in the browser.

   import_books.py does this on a computer with PyMuPDF, which hands over a page
   already grouped into blocks. pdf.js hands over something rawer — every run of
   glyphs with the position it was drawn at — so the grouping has to be done
   here: runs into lines, lines into paragraphs. Everything after that is the
   same reasoning as the Python, and the two are meant to stay recognisably the
   same code: the running header comes off, the page number comes off, the drop
   capital is put back on the front of its own word, and a word cut in half by
   a line ending is made whole.

   Loaded only when a file is actually picked. pdf.js is 1.8 MB and most visits
   never open a book. */

const PAGE_NO = /^[\s*.\-]*\d{1,4}[\s*.\-]*$/;
const SPACED = /^(?:\w[\s ]){3,}\w[\s.]*$/;
const NUMBERED = /^\s*(chapter|part|book)\b[\s\d.,:ivxlcdm-]*$/i;

function unspace(s) {
  return SPACED.test(s) ? s.replace(/\s+/g, "") : s;
}

function key(s) {
  return unspace(s).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
}

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";
}

function linesOf(par) {
  return par.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
}

function headOf(par) {
  const ls = linesOf(par);
  return ls.length ? ls[0] : "";
}

/* ---- the page ----------------------------------------------------------- */

/* pdf.js reports each run of glyphs with the matrix it was drawn under. Runs
   sharing a baseline are a line; the tolerance is a fraction of the type size
   rather than a fixed number of points, so it holds for a footnote as well as
   for a heading. */
function linesFromItems(items) {
  const runs = items
    .filter(function (it) { return it.str && it.str.trim(); })
    .map(function (it) {
      return {
        x: it.transform[4],
        y: it.transform[5],
        h: Math.abs(it.transform[3]) || it.height || 10,
        s: it.str,
      };
    })
    .sort(function (a, b) { return b.y - a.y || a.x - b.x; });
  if (!runs.length) return [];

  /* A drop capital is a single letter set two or three times the size of the
     text, out in the left margin, and sitting on the baseline of the second or
     third line of the paragraph rather than the first. Following its position
     would drop it into the middle of a sentence, so it is taken off the page
     first and put back on the front of the line it opens. */
  const body = pct(runs.map(function (r) { return r.h; }), 0.5);
  const caps = [];
  const rest = runs.filter(function (r) {
    if (r.s.trim().length === 1 && /^[A-Z]$/.test(r.s.trim()) && r.h > body * 1.6) {
      caps.push(r);
      return false;
    }
    return true;
  });

  const lines = [];
  rest.forEach(function (r) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - r.y) <= Math.max(2, r.h * 0.5)) {
      // a gap wider than a space was drawn, not typed
      const gap = r.x - (last.x2 || r.x);
      const space = gap > r.h * 0.28 && !/\s$/.test(last.text);
      last.text += (space ? " " : "") + r.s;
      last.x2 = r.x + (r.s.length * r.h * 0.5);
      last.hs.push(r.h);
      return;
    }
    lines.push({ y: r.y, x: r.x, hs: [r.h], text: r.s,
                 x2: r.x + r.s.length * r.h * 0.5 });
  });

  caps.forEach(function (c) {
    let best = null;
    lines.forEach(function (l) {
      // the line must start to the right of the letter and stand within the
      // height it covers; of those, the highest one is the line it opens
      if (l.x <= c.x + c.h * 0.2) return;
      if (l.y < c.y - c.h * 0.4 || l.y > c.y + c.h) return;
      if (!best || l.y > best.y) best = l;
    });
    if (best) best.text = c.s.trim() + best.text;
  });

  return lines.map(function (l) {
    l.text = l.text.replace(/[ \t]+/g, " ").trim();
    // the height of the words, not of any initial the printer decorated them
    // with: one big letter must not make the whole line look like a heading
    l.h = pct(l.hs, 0.5);
    return l;
  }).filter(function (l) { return l.text; });
}

/* The gap between two lines of the same paragraph is the leading; the gap
   between paragraphs is larger. Taking the middle of all the gaps assumes most
   of them are within a paragraph, which is true of prose and false of a page
   of two-line paragraphs — so take the low quarter, which is the leading in
   either case. */
function pct(ns, p) {
  if (!ns.length) return 0;
  const s = ns.slice().sort(function (a, b) { return a - b; });
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
}

/* A paragraph ends where the next line is pushed further down than the leading
   explains, or where the next line is indented — which in a novel is the only
   mark a new paragraph gets. */
function blocksFromLines(lines) {
  if (!lines.length) return [];
  // Measure the leading on body lines only. A heading, or the line a drop
  // capital lands on, sits further from its neighbours than any paragraph
  // break, and letting those into the measurement raises the bar until real
  // breaks stop clearing it.
  const body = pct(lines.map(function (l) { return l.h; }), 0.5) || 10;
  const isBody = function (l) { return Math.abs(l.h - body) <= body * 0.2; };
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0.5 && isBody(lines[i - 1]) && isBody(lines[i])) gaps.push(gap);
  }
  const lead = pct(gaps, 0.25) || 12;
  const left = Math.min.apply(null, lines.map(function (l) { return l.x; }));

  const blocks = [];
  let cur = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    const indented = lines[i].x > left + Math.max(6, lead * 0.5);
    const bigger = Math.abs(lines[i].h - lines[i - 1].h) > 2.5;
    if (gap > lead * 1.35 || indented || bigger) {
      blocks.push(cur);
      cur = [];
    }
    cur.push(lines[i]);
  }
  blocks.push(cur);
  return blocks.filter(function (b) { return b.length; });
}

function blocksOfPage(items) {
  return blocksFromLines(linesFromItems(items)).map(function (block) {
    return block.map(function (l) { return l.text; }).join("\n");
  });
}

/* ---- the book ----------------------------------------------------------- */

function furniture(pages) {
  const seen = {};
  pages.forEach(function (bs) {
    bs.slice(0, 1).concat(bs.slice(-1)).forEach(function (t) {
      const k = key(headOf(t));
      if (k) seen[k] = (seen[k] || 0) + 1;
    });
  });
  const floor = Math.max(4, Math.floor(pages.length / 20));
  const out = {};
  Object.keys(seen).forEach(function (k) { if (seen[k] >= floor) out[k] = true; });
  return out;
}

function clean(par) {
  let out = "";
  linesOf(par).forEach(function (l) {
    if (out.length === 1 && /^[A-Z]$/.test(out)) out += l;   // a drop capital
    else if (/-$/.test(out)) out = out.slice(0, -1) + l;     // a word cut in two
    else if (out) out += " " + l;
    else out = l;
  });
  return out.replace(/ {2,}/g, " ").replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").trim();
}

function isHeading(line, title) {
  const flat = unspace(line).replace(/^[\s.]+|[\s.]+$/g, "");
  if (!flat) return true;
  if (title && key(flat) === key(title)) return true;
  if (NUMBERED.test(flat)) return true;
  return SPACED.test(line) && line.length < 60;
}

function stripHead(par, title) {
  const ls = linesOf(par);
  while (ls.length && isHeading(ls[0], title)) ls.shift();
  return ls.join("\n");
}

function cleared(pages) {
  const junk = furniture(pages);
  return pages.map(function (bs) {
    const kept = [];
    let cap = "";
    bs.forEach(function (t) {
      const flat = unspace(headOf(t));
      if (linesOf(t).length === 1) {
        if (junk[key(flat)] || PAGE_NO.test(flat)) return;
        if (flat.length === 1 && /^[A-Z]$/.test(flat)) { cap = flat; return; }
      }
      kept.push(t);
    });
    if (cap && kept.length) kept[0] = cap + "\n" + kept[0];
    return kept;
  });
}

function marks(pages) {
  const found = [];
  pages.forEach(function (bs, i) {
    for (let j = 0; j < Math.min(3, bs.length); j++) {
      const line = headOf(bs[j]);
      const flat = unspace(line).replace(/^[\s.]+|[\s.]+$/g, "");
      if (NUMBERED.test(flat) || (SPACED.test(line) && line.length < 60)) {
        found.push([flat, i]);
        return;
      }
    }
  });
  return found;
}

function titleKeys(title) {
  const keys = [];
  const tail = /((?:chapter|part|book)\b[\s\d.,:ivxlcdm-]*)$/i.exec(title);
  if (tail) keys.push(key(tail[1]));
  keys.push(key(title));
  return keys.filter(Boolean);
}

/* Chapters are cut where their heading falls, not where the page turns: a
   table of contents points at a page, and a chapter routinely starts halfway
   down one. */
export function chaptersFrom(rawPages, toc) {
  const pages = cleared(rawPages);
  const paras = [];
  const atPage = [];
  pages.forEach(function (page) {
    atPage.push(paras.length);
    page.forEach(function (p) { paras.push(p); });
  });
  atPage.push(paras.length);

  let list = (toc && toc.length) ? toc : marks(pages);
  if (!list.length) list = [["The book", 0]];

  const cuts = list.map(function (t) {
    const title = t[0], page = Math.min(Math.max(0, t[1]), pages.length - 1);
    const lo = atPage[Math.max(0, page - 1)];
    const hi = atPage[Math.min(atPage.length - 1, page + 2)];
    const keys = titleKeys(title);
    for (let i = Math.max(0, lo); i < Math.min(paras.length, hi); i++) {
      if (keys.indexOf(key(headOf(paras[i]))) > -1) return [headOf(paras[i]), i];
    }
    return [title, atPage[page]];
  });

  const chapters = [];
  cuts.forEach(function (cut, n) {
    const title = cut[0];
    const last = n + 1 < cuts.length ? cuts[n + 1][1] : paras.length;
    let body = paras.slice(cut[1], last);
    while (body.length && !stripHead(body[0], title)) body.shift();
    if (body.length) body[0] = stripHead(body[0], title);
    body = body.filter(function (p) {
      return linesOf(p).length > 1 || !isHeading(p, title);
    }).map(clean).filter(function (p) { return p.length > 1; });
    if (body.length) {
      chapters.push({ n: chapters.length + 1, title: unspace(title).replace(/^[\s.]+|[\s.]+$/g, ""), paras: body });
    }
  });
  return chapters;
}

/* ---- PDF ---------------------------------------------------------------- */

let pdfjs = null;

async function pdflib() {
  if (!pdfjs) {
    pdfjs = await import("./vendor/pdf.mjs");
    // resolved against this file, not against whatever page loaded it
    pdfjs.GlobalWorkerOptions.workerSrc =
      new URL("./vendor/pdf.worker.mjs", import.meta.url).href;
  }
  return pdfjs;
}

async function outlineOf(doc) {
  let items = null;
  try { items = await doc.getOutline(); } catch (e) { items = null; }
  if (!items || !items.length) return [];
  const out = [];
  for (const it of items) {
    try {
      const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
      if (!dest || !dest[0]) continue;
      out.push([String(it.title || "").trim(), await doc.getPageIndex(dest[0])]);
    } catch (e) { /* an outline entry that points nowhere is no entry */ }
  }
  return out;
}

async function readPdf(buf, say) {
  const lib = await pdflib();
  const doc = await lib.getDocument({
    data: buf, isEvalSupported: false, verbosity: 0
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(blocksOfPage(tc.items));
    page.cleanup();
    if (say && i % 10 === 0) say(i, doc.numPages);
  }
  const meta = await doc.getMetadata().catch(function () { return null; });
  const info = (meta && meta.info) || {};
  return {
    pages: pages,
    toc: await outlineOf(doc),
    title: String(info.Title || "").trim(),
    author: String(info.Author || "").trim(),
  };
}

/* ---- EPUB --------------------------------------------------------------- */

/* An EPUB is a zip of XHTML. Reading it needs no library: the central
   directory is at the end of the file, and DecompressionStream does the rest.
   Where a PDF has to be reasoned about, an EPUB simply says where its chapters
   are, so its own markup is trusted over any guessing. */
async function unzip(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let end = -1;
  for (let i = view.byteLength - 22; i >= 0 && i > view.byteLength - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("not a zip");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);

  const files = {};
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const how = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const head = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const lnLen = view.getUint16(head + 26, true);
    const leLen = view.getUint16(head + 28, true);
    const from = head + 30 + lnLen + leLen;
    files[name] = { how: how, raw: bytes.subarray(from, from + size) };
    at += 46 + nameLen + extraLen + commentLen;
  }

  const out = {};
  for (const name of Object.keys(files)) {
    const f = files[name];
    if (f.how === 0) { out[name] = f.raw; continue; }
    const stream = new Blob([f.raw]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    out[name] = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return out;
}

function xml(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

function resolve(base, href) {
  const parts = base.split("/").slice(0, -1);
  href.split("/").forEach(function (p) {
    if (p === "..") parts.pop();
    else if (p && p !== ".") parts.push(p);
  });
  return parts.join("/");
}

async function readEpub(buf) {
  const zip = await unzip(buf);
  const text = function (name) {
    return zip[name] ? new TextDecoder().decode(zip[name]) : "";
  };
  const container = xml(text("META-INF/container.xml"));
  const rootEl = container.querySelector("rootfile");
  const opfPath = rootEl ? rootEl.getAttribute("full-path") : "";
  const opf = xml(text(opfPath));

  const href = {};
  opf.querySelectorAll("manifest > item").forEach(function (it) {
    href[it.getAttribute("id")] = resolve(opfPath, it.getAttribute("href"));
  });
  const spine = [];
  opf.querySelectorAll("spine > itemref").forEach(function (r) {
    const p = href[r.getAttribute("idref")];
    if (p && zip[p]) spine.push(p);
  });

  const meta = function (tag) {
    const n = opf.getElementsByTagName("dc:" + tag)[0]
      || opf.getElementsByTagName(tag)[0];
    return n ? n.textContent.trim() : "";
  };

  // one document per spine entry, which stands in for a page
  const pages = spine.map(function (path) {
    const doc = new DOMParser().parseFromString(text(path), "text/html");
    doc.querySelectorAll("script, style").forEach(function (n) { n.remove(); });
    const blocks = [];
    doc.querySelectorAll("h1, h2, h3, h4, p, blockquote, div.chapter").forEach(function (n) {
      const t = (n.textContent || "").replace(/\s+/g, " ").trim();
      if (t) blocks.push(t);
    });
    return blocks;
  });

  // the spine already breaks at the chapters, so a heading per document is
  // enough of a table of contents
  const toc = [];
  pages.forEach(function (blocks, i) {
    if (blocks.length > 1) toc.push([blocks[0], i]);
  });

  return { pages: pages, toc: toc, title: meta("title"), author: meta("creator") };
}

/* ---- what the page asks for --------------------------------------------- */

export async function bookify(file, say) {
  const buf = await file.arrayBuffer();
  const name = file.name.replace(/\.[^.]+$/, "");
  const epub = /\.epub$/i.test(file.name);
  const raw = epub ? await readEpub(buf) : await readPdf(buf, say);
  const chapters = chaptersFrom(raw.pages, raw.toc);
  if (!chapters.length) throw new Error("no text");
  const title = raw.title || name;
  return {
    slug: slugify(title),
    title: title,
    author: raw.author || "",
    chapters: chapters,
  };
}
