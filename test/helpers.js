/* Shared harness: load one build of the page into jsdom and hand back the
   window once its scripts have run. jsdom does no layout, so clientHeight is 0
   and the virtual list only builds its first few rows — still enough to check
   content and interaction. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SETTINGS_KEY = 'engrowdict:settings:v1';
const BACKUP_KEY = 'engrowdict:added:v1';
const PASSCODE = '229922';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Pre-unlock a store so the add-word tests are not blocked by the passcode. */
function unlockedStore(extra) {
  const s = Object.assign({ sheetUrl: '', webApp: '', key: '', code: PASSCODE, unlocked: true }, extra);
  return { [SETTINGS_KEY]: JSON.stringify(s) };
}

function boot(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const published = opts.published;
  const html = opts.full
    ? opts.html
    : '<!doctype html><html><head><meta charset="utf-8"></head><body>' + opts.html + '</body></html>';

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: opts.url || 'https://artifacts.example/engrowdict',
    beforeParse(w) {
      // jsdom 30 dropped the userAgent option, and the phone-only bits of the
      // page are decided on the user agent
      if (opts.ua) {
        Object.defineProperty(w.navigator, 'userAgent',
          { value: opts.ua, configurable: true });
      }
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
      Object.defineProperty(w, 'localStorage', {
        configurable: true,
        value: {
          getItem: k => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
        },
      });
      // jsdom has no IndexedDB, and the books added on a device live in it
      if (opts.idb || opts.idbSeed) {
        const fake = require('fake-indexeddb');
        w.indexedDB = new fake.IDBFactory();
        ['IDBKeyRange', 'IDBTransaction', 'IDBRequest', 'IDBDatabase',
         'IDBObjectStore'].forEach(n => { if (fake[n]) w[n] = fake[n]; });
        // seeded here, before the page runs, so the shelf it reads at start-up
        // already has the book on it — no second read to wait for
        if (opts.idbSeed) {
          const req = w.indexedDB.open('engrowdict-books', 1);
          req.onupgradeneeded = () =>
            req.result.createObjectStore('books', { keyPath: 'slug' });
          req.onsuccess = () => {
            const st = req.result.transaction('books', 'readwrite').objectStore('books');
            opts.idbSeed.forEach(b => st.put(b));
          };
        }
      }
      // jsdom has no dynamic import, so the page's hook stands in for
      // bookify.js: hand back the book a picked file would have read as
      if (opts.bookify) w.bookifyStub = opts.bookify;
      if (!w.TextEncoder) w.TextEncoder = TextEncoder;
      if (!w.TextDecoder) w.TextDecoder = TextDecoder;
      w.URL.createObjectURL = () => 'blob:fake';
      w.URL.revokeObjectURL = () => {};
      w.scrollTo = () => {};
      // fetch has to exist before the page's own scripts run
      if (opts.fetchStub) {
        w.fetch = opts.fetchStub;
      } else if (opts.dataFile) {
        w.fetch = () => Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(JSON.parse(read(opts.dataFile))),
        });
      }
      if (published) {
        w.claude = {
          use: name => Promise.resolve(name === 'artifact' ? {
            publish: h => { published.push(h); return Promise.resolve({ version: 'v2' }); },
          } : null),
        };
      }
    },
  });
  const errs = [];
  dom.window.addEventListener('error', e => errs.push(e.message));
  return { dom, window: dom.window, doc: dom.window.document, errs, store };
}

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) pass++; else fail++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  -> ' + extra : ''));
}
function done(errs) {
  if (errs && errs.length) console.log('ERRORS: ' + JSON.stringify(errs));
  console.log('(' + pass + ' pass, ' + fail + ' fail)');
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const click = (w, node) => node.dispatchEvent(new w.Event('click'));
const type = (w, input, value) => { input.value = value; input.dispatchEvent(new w.Event('input')); };
const btn = (doc, sel, label) =>
  [...doc.querySelectorAll(sel)].find(b => b.textContent.trim() === label);

/** Open the entry's ☰ menu and press Delete. Returns false if there is none. */
function deleteWord(g) {
  const wrap = g.doc.querySelector('.entry-nav .menu-wrap');
  if (!wrap) return false;
  click(g.window, wrap.querySelector('.iconbtn'));
  const item = wrap.querySelector('.menu-item.danger');
  if (!item || wrap.querySelector('.menu').hidden) return false;
  click(g.window, item);
  return true;
}

/** Fill the add-word dialog and save. Assumes the passcode is already cleared. */
function addWord(g, fields) {
  click(g.window, g.doc.getElementById('add-word'));
  const dlg = g.doc.getElementById('form-dlg');
  for (const [name, value] of Object.entries(fields)) {
    dlg.querySelector('[name=' + name + ']').value = value;
  }
  click(g.window, g.doc.getElementById('form-save'));
  return dlg;
}

/* ---- stand-ins for the Apps Script side ---------------------------------- */

/** A sheet that records the formatting calls as well as the values. */
function fakeSheet(rows) {
  const g = rows.map(r => r.slice());
  const log = { merges: [], borders: [], rich: [] };
  const sheet = {
    grid: g,
    log,
    getLastRow: () => g.length,
    getMaxColumns: () => 4,
    getLastColumn: () => 4,
    insertRowsBefore: (at, n) => {
      for (let i = 0; i < n; i++) g.splice(at - 1, 0, ['', '', '', '']);
    },
    getRange: (row, col, nRows, nCols) => {
      nRows = nRows === undefined ? 1 : nRows;
      nCols = nCols === undefined ? 1 : nCols;
      const at = { row, col, nRows, nCols };
      return {
        getDisplayValues: () => g.slice(row - 1, row - 1 + nRows)
          .map(r => r.slice(col - 1, col - 1 + nCols)),
        setValues: vals => {
          for (let i = 0; i < vals.length; i++) {
            while (g.length < row - 1 + i + 1) g.push(['', '', '', '']);
            for (let j = 0; j < vals[i].length; j++) g[row - 1 + i][col - 1 + j] = vals[i][j];
          }
        },
        merge: () => { log.merges.push(at); },
        setRichTextValue: v => { log.rich.push({ at, value: v }); },
        setBorder: (top, left, bottom, right, vertical, horizontal, color, style) => {
          log.borders.push({ at, top, left, bottom, right, vertical, horizontal, color, style });
        },
      };
    },
  };
  return sheet;
}

/**
 * Enough of the Apps Script globals for sheet-sync.gs to run under Node.
 *
 * `grids` is the workbook the script is attached to. `others`, keyed by
 * spreadsheet id, are the ones it can only reach by link — which is how the
 * web page points the same deployment at another sheet.
 */
function appsScriptSandbox(grids, props, others) {
  props = props || {};
  const tabs = g => {
    const m = {};
    for (const name of Object.keys(g)) m[name] = fakeSheet(g[name]);
    return m;
  };
  const sheets = tabs(grids);
  const books = {};
  for (const id of Object.keys(others || {})) books[id] = tabs(others[id]);

  const textStyle = () => {
    const s = {};
    const b = {
      setBold: v => { s.bold = v; return b; },
      setItalic: v => { s.italic = v; return b; },
      setUnderline: v => { s.underline = v; return b; },
      setForegroundColor: v => { s.color = v; return b; },
      build: () => s,
    };
    return b;
  };
  const richText = () => {
    const v = { text: '', styles: [], links: [] };
    const b = {
      setText: t => { v.text = t; return b; },
      setTextStyle: (from, to, style) => { v.styles.push({ from, to, style }); return b; },
      setLinkUrl: (from, to, url) => { v.links.push({ from, to, url }); return b; },
      build: () => v,
    };
    return b;
  };

  // what the menu functions put on screen, so a test can read it back
  const shown = { dialog: null, alert: null };
  // what UrlFetchApp is asked for, and what the test wants it to answer with
  const net = {
    calls: [], reply: () => ({ code: 404, body: '' }),
    translated: [], translation: t => '[vi] ' + t, payloads: [],
  };

  const sandbox = {
    sheets,
    books,
    props,
    shown,
    net,
    Utilities: {
      getUuid: () => 'uuid-1111-2222-3333',
      base64Encode: t => Buffer.from(String(t), 'utf8').toString('base64'),
      Charset: { UTF_8: 'utf8' },
    },
    ScriptApp: { getService: () => ({ getUrl: () => props.DEPLOYED_URL || '' }) },
    LanguageApp: {
      translate: (text, from, to) => {
        net.translated.push(text);
        return net.translation(text);
      },
    },
    UrlFetchApp: {
      fetchAll: reqs => reqs.map(r => {
        net.calls.push(r.url);
        const a = net.reply(r.url);
        return { getResponseCode: () => a.code, getContentText: () => a.body || '' };
      }),
      fetch: (url, opts) => {
        net.calls.push(url);
        if (opts && opts.payload) {
          try { net.payloads.push(JSON.parse(opts.payload)); } catch (e) { /* not json */ }
        }
        const a = net.reply(url, opts);
        return { getResponseCode: () => a.code, getContentText: () => a.body || '' };
      },
    },
    HtmlService: {
      createHtmlOutput: html => {
        const out = { html: html, setWidth: () => out, setHeight: () => out,
                      getContent: () => html };
        return out;
      },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null }),
      getUi: () => ({
        showModalDialog: (out, title) => { shown.dialog = { out, title }; },
        alert: function () { shown.alert = [].slice.call(arguments); },
        ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
      }),
      openById: id => {
        if (!books[id]) throw new Error('No spreadsheet with the id ' + id);
        return { getSheetByName: n => books[id][n] || null };
      },
      newTextStyle: textStyle,
      newRichTextValue: richText,
      BorderStyle: { SOLID: 'SOLID', DASHED: 'DASHED', DOTTED: 'DOTTED' },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => props[k] || null,
        setProperty: (k, v) => { props[k] = v; },
        deleteProperty: k => { delete props[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: t => ({ setMimeType: () => t }),
    },
    console,
  };
  return sandbox;
}

module.exports = {
  ROOT, read, boot, ok, done, wait, click, type, btn, addWord,
  unlockedStore, SETTINGS_KEY, BACKUP_KEY, PASSCODE, deleteWord,
  fakeSheet, appsScriptSandbox,
};
