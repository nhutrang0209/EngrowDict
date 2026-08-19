/* A word written back into the sheet has to look like the ones already there:
   the headword bold, blue and linked to Cambridge; the part of speech and the
   phonetics plain; column A merged across a multi-sense entry; a dashed rule
   between senses and solid lines everywhere else. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, ok, done, appsScriptSandbox } = require('./helpers');

const KEY = 'a-secret-key';
const grids = JSON.parse(fs.readFileSync(path.join(__dirname, 'grids.json'), 'utf8'));
const sandbox = appsScriptSandbox(grids, { SOTRATU_KEY: KEY });
vm.createContext(sandbox);
vm.runInContext(read('sheet-sync.gs') + '\nthis.__doPost = doPost;', sandbox);

const call = entry => JSON.parse(sandbox.__doPost({
  postData: { contents: JSON.stringify({ key: KEY, action: 'add', entry: entry }) },
}));
const vocab = sandbox.sheets.Vocabulary;
const since = n => ({
  merges: vocab.log.merges.slice(n.merges),
  borders: vocab.log.borders.slice(n.borders),
  rich: vocab.log.rich.slice(n.rich),
});
const mark = () => ({
  merges: vocab.log.merges.length,
  borders: vocab.log.borders.length,
  rich: vocab.log.rich.length,
});

/* --- one sense ---------------------------------------------------------- */
let m = mark();
let res = call({
  type: 'word', word: 'susurrus', pos: 'n', ipa: '/suːˈsʌr.əs/', note: '',
  senses: [{ def: 'a soft murmuring sound', eg: [], vi: 'tiếng xào xạc' }],
});
ok('a single-sense word is inserted', res.ok && !res.warning, JSON.stringify(res));
let got = since(m);

ok('no merge for a single row', got.merges.length === 0);
ok('the head cell is written as rich text', got.rich.length === 1 && got.rich[0].at.col === 1);

const rich = got.rich[0].value;
ok('the rich text holds word, part of speech and phonetics',
   rich.text === 'susurrus (n)\n/suːˈsʌr.əs/', JSON.stringify(rich.text));
ok('the whole cell is reset to plain first',
   rich.styles[0].from === 0 && rich.styles[0].to === rich.text.length &&
   rich.styles[0].style.bold === false && rich.styles[0].style.underline === false &&
   rich.styles[0].style.color === '#1f1f1f',
   JSON.stringify(rich.styles[0].style));
ok('only the word itself is styled',
   rich.styles[1].from === 0 && rich.styles[1].to === 'susurrus'.length,
   rich.text.slice(rich.styles[1].from, rich.styles[1].to));
ok('  bold and dark blue',
   rich.styles[1].style.bold === true && rich.styles[1].style.color === '#1155cc',
   JSON.stringify(rich.styles[1].style));
ok('  and nothing past the word is styled', rich.styles.length === 2);
ok('only the word carries the link',
   rich.links.length === 1 && rich.links[0].from === 0 &&
   rich.links[0].to === 'susurrus'.length);
ok('  pointing at Cambridge',
   rich.links[0].url === 'https://dictionary.cambridge.org/dictionary/english/susurrus',
   rich.links[0].url);

const outline = got.borders.find(b => b.style === 'SOLID');
ok('the block is outlined solid',
   !!outline && outline.top && outline.left && outline.bottom && outline.right &&
   outline.vertical === true && outline.horizontal === null,
   outline && JSON.stringify({ v: outline.vertical, h: outline.horizontal, c: outline.color }));
ok('no rule between senses when there is only one',
   !got.borders.some(b => b.style === 'DOTTED'));
ok('the outline stops at the last column the tab uses',
   outline.at.nCols === 3, outline.at.nCols + ' columns wide');

/* --- several senses ------------------------------------------------------ */
m = mark();
res = call({
  type: 'word', word: 'thole', pos: 'v', ipa: '/θəʊl/', note: '',
  senses: [
    { def: 'to endure without complaint', eg: ['she tholed the winter'], vi: 'chịu đựng' },
    { def: 'a pin that holds an oar', eg: [], vi: 'cọc chèo' },
    { def: 'to be permitted', eg: [], vi: 'được phép' },
  ],
});
ok('a three-sense word is inserted', res.ok && res.rows === 3, JSON.stringify(res));
got = since(m);

ok('column A is merged across the three rows',
   got.merges.length === 1 && got.merges[0].col === 1 &&
   got.merges[0].nRows === 3 && got.merges[0].nCols === 1,
   JSON.stringify(got.merges));

const dotted = got.borders.find(b => b.style === 'DOTTED');
ok('the rule between senses is the finer dotted one, as elsewhere in the sheet',
   !!dotted && dotted.horizontal === true,
   dotted && JSON.stringify({ h: dotted.horizontal, col: dotted.at.col, n: dotted.at.nCols }));
ok('  and it starts beside the merged head, not through it',
   dotted.at.col === 2 && dotted.at.nRows === 3, JSON.stringify(dotted.at));
ok('  reaching only the columns the tab uses',
   dotted.at.col + dotted.at.nCols - 1 === 3, 'stops at column ' + (dotted.at.col + dotted.at.nCols - 1));
ok('  while nothing else about it is drawn',
   dotted.top === null && dotted.left === null &&
   dotted.bottom === null && dotted.right === null && dotted.vertical === null);
ok('the outline stays solid', got.borders.some(b => b.style === 'SOLID' && b.top === true));

/* --- reading it back ----------------------------------------------------- */
vm.runInContext('this.__buildData = buildData;', sandbox);
const after = sandbox.__buildData().entries;
const back = after.find(e => e.word === 'thole');
ok('the entry still reads back whole after the formatting',
   !!back && back.senses.length === 3 && back.pos === 'v' && back.ipa === '/θəʊl/' &&
   back.senses[0].eg[0] === 'she tholed the winter',
   back ? back.senses.length + ' senses, ' + back.ipa : 'not found');

/* --- phrasal verbs ------------------------------------------------------- */
m = mark();
const pvBefore = sandbox.sheets['Phrasal Verb'].log.rich.length;
res = call({
  type: 'phrasal', word: 'muddle sideways', verb: 'muddle', particle: 'sideways',
  senses: [
    { def: 'to manage without a plan', eg: [], vi: 'xoay xở' },
    { def: 'to drift along', eg: [], vi: 'lần hồi' },
  ],
});
ok('a phrasal verb is inserted', res.ok && res.sheet === 'Phrasal Verb', JSON.stringify(res));
const pvLog = sandbox.sheets['Phrasal Verb'].log;
const pvRich = pvLog.rich[pvBefore].value;
ok('the verb links to the whole phrasal verb on Cambridge',
   pvRich.links[0].url.endsWith('/muddle-sideways'), pvRich.links[0].url);
ok('both the verb and the particle columns are merged',
   pvLog.merges.slice(-2).every(x => x.nRows === 2) &&
   pvLog.merges.slice(-2).map(x => x.col).join() === '1,2',
   JSON.stringify(pvLog.merges.slice(-2)));
const pvDotted = pvLog.borders.filter(b => b.style === 'DOTTED').pop();
ok('its rule starts after the particle column', pvDotted.at.col === 3,
   JSON.stringify(pvDotted.at));
ok('  and a phrasal verb does use all four columns',
   pvDotted.at.col + pvDotted.at.nCols - 1 === 4,
   'stops at column ' + (pvDotted.at.col + pvDotted.at.nCols - 1));

/* --- odd headwords ------------------------------------------------------- */
ok('a two-word headword slugs correctly',
   sandbox.cambridgeUrl('bristlecone pine').endsWith('/bristlecone-pine'),
   sandbox.cambridgeUrl('bristlecone pine'));
ok('punctuation is dropped from the slug',
   sandbox.cambridgeUrl("(a) sort of").endsWith('/a-sort-of'),
   sandbox.cambridgeUrl("(a) sort of"));
ok('a headword with nothing linkable gets no link',
   sandbox.cambridgeUrl('!!!') === '', JSON.stringify(sandbox.cambridgeUrl('!!!')));

/* --- formatting must never cost the data --------------------------------- */
const brittle = appsScriptSandbox(grids, { SOTRATU_KEY: KEY });
brittle.SpreadsheetApp.newRichTextValue = () => { throw new Error('no rich text here'); };
vm.createContext(brittle);
vm.runInContext(read('sheet-sync.gs') + '\nthis.__doPost = doPost; this.__buildData = buildData;', brittle);
const before = brittle.__buildData().entries.length;
const shaky = JSON.parse(brittle.__doPost({
  postData: { contents: JSON.stringify({ key: KEY, action: 'add', entry: {
    type: 'word', word: 'zugzwang', pos: 'n', ipa: '/ˈtsuːktsvaŋ/', note: '',
    senses: [{ def: 'any move worsens the position', eg: [], vi: 'thế bí' }],
  } }) },
}));
ok('a formatting failure still keeps the word', shaky.ok === true &&
   brittle.__buildData().entries.length === before + 1,
   before + ' → ' + brittle.__buildData().entries.length);
ok('  and says so plainly', /formatting did not apply/.test(shaky.warning || ''),
   shaky.warning);

done();
