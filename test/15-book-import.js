/* Reading an uploaded book in the browser.

   bookify.js is what the Add-a-book button runs. pdf.js hands it a page as
   loose runs of glyphs with the positions they were drawn at, so this is where
   a page becomes lines, lines become paragraphs, and everything the printer
   added — the running header, the page number, the drop capital, the word
   broken across a line ending — is taken back off.

   layout-test.pdf is drawn by make_layout_pdf.py to do all of those things at
   once. What it must not lose is the shouting: "SEIZE HIM!" is a line of the
   story, and capitals are no evidence of a heading. */
const { read, ok, done } = require('./helpers');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const fixture = path.join(__dirname, 'layout-test.pdf');

function fileOf(p, name) {
  const buf = readFileSync(p);
  return {
    name: name,
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

(async () => {
  const { bookify, chaptersFrom, slugify } =
    await import('file://' + path.join(ROOT, 'docs', 'bookify.js'));

  /* --- the whole of a PDF ------------------------------------------------- */
  const book = await bookify(fileOf(fixture, 'layout-test.pdf'));

  ok('a PDF comes back split into its chapters', book.chapters.length === 3,
     book.chapters.length + ' chapters');
  ok('  each under the name the book gives it',
     book.chapters.map(c => c.title).join(' / ') ===
     'THE BOY WHO LIVED / THE VANISHING GLASS / THE LETTERS FROM NO ONE',
     book.chapters.map(c => c.title).join(' / '));
  ok('  numbered from one', book.chapters.every((c, i) => c.n === i + 1));
  ok('  and named after itself', slugify('A Test Book!') === 'a-test-book');

  const paras = book.chapters[0].paras;
  ok('the chapter is paragraphs, not pages', paras.length === 15,
     paras.length + ' paragraphs');

  ok('the drop capital is the first letter of its word, not a stray letter',
     paras[0].startsWith('Mr. and Mrs. Dursley'), paras[0].slice(0, 30));
  ok('  and the paragraph it opens is whole',
     paras[0].includes('perfectly normal, thank you very much'),
     paras[0].slice(0, 90));

  ok('a word broken by the line ending is put back together',
     paras[1].includes('went swooping back') && !paras[1].includes('swoop- ing'),
     paras[1].slice(30, 90));

  ok('shouting is kept — capitals are no evidence of a heading',
     paras.indexOf('"I WANT MY LETTER!" he shouted.') > -1 &&
     paras.indexOf('SEIZE HIM!') > -1);

  const all = book.chapters.map(c => c.paras.join(' ')).join(' ');
  ok('the running header is gone from the text',
     all.indexOf('THE BOY WHO LIVED') === -1 && all.indexOf('C H A P T E R') === -1);
  ok('the page numbers are gone too', !/(^|\s)\d{1,2}(\s|$)/.test(all.slice(0, 400)),
     all.slice(0, 60));
  ok('  and the chapter opening is not repeated as a paragraph',
     book.chapters.every(c => c.paras[0] !== c.title));

  ok('every paragraph is a paragraph, not a line',
     paras.filter(p => p.length > 40).length >= 9,
     paras.filter(p => p.length > 40).length + ' over 40 characters');

  /* --- the same rules, without a PDF -------------------------------------- */
  // pages of already-extracted text, which is what an EPUB gives
  const pages = [
    ['CHAPTER ONE', 'The first thing they saw was the door.', '1'],
    ['CHAPTER ONE', 'It had been painted green.', '2'],
    ['CHAPTER ONE', 'They knocked twice.', '3'],
    ['CHAPTER ONE', 'Nobody answered.', '4'],
    ['CHAPTER TWO', 'The second door was blue.', '5'],
    ['CHAPTER TWO', 'STOP RIGHT THERE!', '6'],
  ];
  const chapters = chaptersFrom(pages, [['CHAPTER ONE', 0], ['CHAPTER TWO', 4]]);
  ok('a heading repeated on every page is furniture, and comes off',
     chapters.length === 2 &&
     chapters[0].paras.join(' ').indexOf('CHAPTER ONE') === -1,
     chapters.map(c => c.paras.length).join('/'));
  ok('  the page numbers go with it',
     chapters[0].paras.join(' ').indexOf('1') === -1,
     chapters[0].paras.join(' | '));
  ok('  and a shout under a repeated heading survives',
     chapters[1].paras.indexOf('STOP RIGHT THERE!') > -1,
     chapters[1].paras.join(' | '));

  /* --- a book with nothing in it ------------------------------------------ */
  let refused = false;
  try {
    await bookify({ name: 'empty.pdf', arrayBuffer: async () => new ArrayBuffer(8) });
  } catch (e) { refused = true; }
  ok('a file that is not a book is refused rather than half-read', refused);

  /* --- and the page can reach it ------------------------------------------ */
  const shell = read('docs/index.html');
  ok('the page loads the importer only when a file is picked',
     shell.includes('import("./bookify.js")') &&
     !shell.includes('<script src="bookify.js"'));
  ok('pdf.js is vendored, so an installed copy still works offline',
     read('docs/vendor/pdf.mjs').length > 100000 &&
     read('docs/vendor/pdf.worker.mjs').length > 100000);
  ok('  and its worker is found beside it, not beside the page',
     read('docs/bookify.js').includes('new URL("./vendor/pdf.worker.mjs", import.meta.url)'));

  done();
})();
