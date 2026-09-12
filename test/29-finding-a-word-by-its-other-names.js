/* An entry answers to more names than its headword.

   "harbour" had no entry for "harbor", and searching "harbor" found nothing
   worth reading. An entry carries other names in three places: a spelling in
   its note ("harbor"), the other side of the Atlantic ("US: slaughterhouse"),
   the forms of an irregular verb ("beheld | beheld"); and the words a sense
   opens with in ochre ("seafarer (n): a person who travels by sea"). Each is
   looked for as a name is looked for, ranks just below a headword that says
   the same thing, and is shown beside the word it brought up.

   The words named here are the reader's own examples where the sheet still
   has them, and whatever else fits the same shape where it does not: the
   sheet is edited, and a test that names one entry stops testing anything
   the day that entry goes. */
const { read, boot, ok, done, wait, click, type, BACKUP_KEY } = require('./helpers');

const shell = read('docs/index.html');
const data = JSON.parse(read('docs/data.json'));
const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const heads = new Set(data.entries.map(e => norm(e.word)));
const isFree = w => !!w && !heads.has(norm(w));      // no headword of its own

const mk = () => boot({
  html: shell, full: true, store: {}, width: 1500,
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

/* The reader's example if the sheet still has it, else the first like it. */
function pick(prefer, nameOf) {
  const fits = e => { const n = nameOf(e); return n && isFree(n) ? n : ''; };
  const e = data.entries.find(x => x.word === prefer && fits(x))
    || data.entries.find(x => fits(x));
  return e ? { entry: e.word, name: nameOf(e) } : null;
}

const spelling = pick('harbour', e => {
  const n = (e.note || '').trim();
  return /^[A-Za-z-]{3,}$/.test(n) ? n : '';
});
const atlantic = pick('abattoir', e => {
  const m = (e.note || '').trim().match(/^(?:US|UK):\s*([A-Za-z-]{3,})$/);
  return m ? m[1] : '';
});
const irregular = pick('behold', e => {
  const m = (e.note || '').trim().match(/^([A-Za-z-]{3,})\s*\|/);
  return m ? m[1] : '';
});
const leadIn = pick('seafaring', e => {
  for (const s of e.senses) {
    const m = (s.def || '').match(/^([A-Za-z-]{3,}) \((?:n|v|adj|adv)\): /);
    if (m) return m[1];
  }
  return '';
});
/* A name that is both some entry's headword and another entry's other name:
   "broach" has an entry, and is also what the US calls a brooch. */
const shared = (() => {
  const pref = data.entries.find(e => e.word === 'brooch');
  const cands = (pref ? [pref] : []).concat(data.entries);
  for (const e of cands) {
    const m = (e.note || '').match(/\b(?:US|UK):\s*([A-Za-z-]{3,})/);
    if (m && heads.has(norm(m[1])) && norm(m[1]) !== norm(e.word)) {
      return { entry: e.word, name: m[1] };
    }
  }
  return null;
})();
/* A label in ochre is not a name: "Old use or formal: clothes". */
const labelled = data.entries.find(e => e.senses.some(s => /^Old use or formal: /.test(s.def || '')))
  || data.entries.find(e => e.senses.some(s => /^(?:formal|informal|literary): /i.test(s.def || '')));

const hits = g => [...g.doc.querySelectorAll('.list .hit')];
const hw = r => (r.querySelector('.hw') || {}).textContent || '';
const via = r => (r.querySelector('.via') || {}).textContent || '';

async function searchFor(g, text) {
  type(g.window, g.doc.getElementById('q'), text);
  await wait(40);
}

(async () => {
  ok('the sheet has an example of each kind of other name',
     !!spelling && !!atlantic && !!irregular && !!leadIn,
     [spelling, atlantic, irregular, leadIn].map(x => x ? x.entry + '<-' + x.name : 'none').join(', '));

  const g = mk();
  await wait(900);

  /* --- on the Dictionary tab --------------------------------------------- */
  await searchFor(g, spelling.name);
  ok('a spelling in the note finds the word: "' + spelling.name + '" brings up "'
       + spelling.entry + '"', hw(hits(g)[0]) === spelling.entry,
     hits(g).slice(0, 3).map(hw).join(', '));
  ok('  and says which name it came up by, since that is not obvious until it is',
     via(hits(g)[0]).indexOf(spelling.name) > -1 && /^via /.test(via(hits(g)[0])),
     via(hits(g)[0]) || 'nothing beside it');

  await searchFor(g, atlantic.name);
  ok('the other side of the Atlantic finds it: "' + atlantic.name + '" brings up "'
       + atlantic.entry + '"', hw(hits(g)[0]) === atlantic.entry,
     hits(g).slice(0, 3).map(hw).join(', '));

  await searchFor(g, irregular.name);
  ok('a form of an irregular verb finds the verb: "' + irregular.name + '" brings up "'
       + irregular.entry + '"', hw(hits(g)[0]) === irregular.entry,
     hits(g).slice(0, 3).map(hw).join(', '));

  await searchFor(g, leadIn.name);
  ok('the word a sense opens with in ochre finds its entry: "' + leadIn.name
       + '" brings up "' + leadIn.entry + '"', hw(hits(g)[0]) === leadIn.entry,
     hits(g).slice(0, 3).map(hw).join(', '));

  await searchFor(g, leadIn.name.slice(0, Math.max(4, leadIn.name.length - 2)));
  ok('  and does as it is typed, before the name is finished',
     hits(g).slice(0, 10).some(r => hw(r) === leadIn.entry),
     hits(g).slice(0, 5).map(hw).join(', '));

  /* The ranking itself. An entry that only mentions a name in its definition
     used to come up level with the entry that answers to that name, and then
     the alphabet chose between them: an earlier word whose definition happened
     to say the name came first. None of the reader's own examples happens to
     have such a neighbour in the sheet, so one is written in, the way a word
     of the reader's own is: kept on this device, earlier in the alphabet than
     anything the sheet has, and saying the name in passing. */
  const mention = {
    id: 'u0mention', type: 'word', word: '0-mention', pos: '', ipa: '', note: '',
    senses: [{ def: 'a word that says ' + spelling.name + ' in passing', vi: '', eg: [] }],
    mine: true, at: '2026-01-01',
  };
  const m = boot({
    html: shell, full: true, width: 1500,
    store: { [BACKUP_KEY]: JSON.stringify([mention]) },
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    dataFile: 'docs/data.json',
  });
  await wait(900);
  await searchFor(m, spelling.name);
  const mentioned = hits(m).map(hw);
  ok('an entry that only mentions a name still comes up for it, as it always did',
     mentioned.indexOf(mention.word) > -1, mentioned.slice(0, 4).join(', '));
  ok('  but the entry that answers to the name ranks above it, alphabet or no',
     mentioned.indexOf(spelling.entry) > -1 &&
     mentioned.indexOf(spelling.entry) < mentioned.indexOf(mention.word),
     '"' + spelling.name + '": ' + mentioned.slice(0, 4).join(', '));

  if (shared) {
    await searchFor(g, shared.name);
    const order = hits(g).map(hw);
    ok('a headword that says it outright comes before another entry that only answers to it',
       order.indexOf(shared.name) > -1 && order.indexOf(shared.entry) > -1 &&
       order.indexOf(shared.name) < order.indexOf(shared.entry),
       '"' + shared.name + '": ' + order.slice(0, 4).join(', '));
    ok('  and the headword carries no "via", since it came up by its own name',
       !via(hits(g)[order.indexOf(shared.name)]),
       via(hits(g)[order.indexOf(shared.name)]) || 'none');
  }

  /* --- in the Look up window, which searches names only ------------------ */
  click(g.window, g.doc.getElementById('tab-passages'));
  await wait(40);
  click(g.window, g.doc.querySelector('.hit'));
  await wait(60);
  const lk = g.doc.getElementById('lk-q');
  const pdWord = h => [...h.querySelector('.pd-w').childNodes]
    .filter(n => n.nodeName !== 'I').map(n => n.textContent).join('').trim();
  type(g.window, lk, leadIn.name);
  await wait(60);
  const pd = [...g.doc.querySelectorAll('.pd-hit')];
  ok('the Look up window finds a word by the name it opens a sense with',
     pd.length > 0 && pdWord(pd[0]) === leadIn.entry,
     pd.slice(0, 3).map(pdWord).join(', ') || 'nothing');
  ok('  and shows that name under it',
     pd.length > 0 && ((pd[0].querySelector('.pd-via') || {}).textContent || '')
       .indexOf(leadIn.name) > -1,
     pd.length ? (pd[0].querySelector('.pd-via') || {}).textContent : 'no row');

  if (labelled) {
    type(g.window, lk, 'old use');
    await wait(60);
    const pdl = [...g.doc.querySelectorAll('.pd-hit')].map(pdWord);
    ok('a label set in ochre is not a name, so it does not bring its entry up',
       pdl.indexOf(labelled.word) < 0,
       '"old use": ' + (pdl.slice(0, 4).join(', ') || 'nothing'));
  }
  type(g.window, lk, '');
  await wait(20);

  /* --- selecting the name in a passage ------------------------------------ */
  g.window.getSelection = () => ({
    isCollapsed: false,
    toString: () => spelling.name,
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ left: 100, top: 200, width: 60, bottom: 216 }),
    }),
  });
  g.doc.querySelector('.read .prose').dispatchEvent(new g.window.Event('mouseup'));
  await wait(40);
  const picked = (g.doc.querySelector('#lookup .picked') || {}).textContent || '';
  ok('selecting the other name in a passage opens the entry it belongs to',
     picked.indexOf(spelling.entry) === 0,
     JSON.stringify(picked));

  /* --- one rule for the ochre and the names ------------------------------- */
  const src = read('app.js');
  const defInto = src.slice(src.indexOf('function defInto('), src.indexOf('function defNode('));
  const altNames = src.slice(src.indexOf('function altNames('), src.indexOf('function altTier('));
  ok('what is set in ochre and what is searched for are found by the same rule',
     defInto.indexOf('leadInEnd(') > -1 && altNames.indexOf('leadInEnd(') > -1,
     'leadInEnd in both');

  done(g.errs.concat(m.errs));
})();
