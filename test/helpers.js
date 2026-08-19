/* Khung dùng chung: nạp một bản trang vào jsdom và trả về cửa sổ đã chạy.
   jsdom không tính layout nên clientHeight = 0; danh sách cuộn ảo vì thế chỉ
   dựng vài dòng đầu — vẫn đủ để kiểm tra nội dung và tương tác. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
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
    url: opts.url || 'https://artifacts.example/so-tra-tu',
    beforeParse(w) {
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
      w.URL.createObjectURL = () => 'blob:fake';
      w.URL.revokeObjectURL = () => {};
      w.scrollTo = () => {};
      if (opts.dataFile) {
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

module.exports = { ROOT, read, boot, ok, done, wait, click, type };
