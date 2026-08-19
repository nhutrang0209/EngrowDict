/* The data pulled out of the sheet: full a–z coverage, right shape, no
   leftover formatting junk. */
const { read, ok, done } = require('./helpers');

const d = JSON.parse(read('dataset.json'));
const E = d.entries;
const W = E.filter(e => e.type === 'word');

ok('over 10,000 single words', W.length > 10000,
   W.length + ' words, ' + E.length + ' entries in total');

const letters = new Set(W.map(e => e.word[0].toLowerCase()));
const missing = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(l => !letters.has(l));
ok('all 26 letters covered', missing.length === 0,
   missing.length ? 'missing ' + missing.join(',') : 'a to z, none missing');

const perLetter = {};
for (const e of W) perLetter[e.word[0].toLowerCase()] = (perLetter[e.word[0].toLowerCase()] || 0) + 1;
ok('no letter cut short', perLetter.z > 5 && perLetter.s > 500,
   's:' + perLetter.s + ' z:' + perLetter.z);

ok('phonetics on nearly every word', W.filter(e => e.ipa).length / W.length > 0.98,
   (100 * W.filter(e => e.ipa).length / W.length).toFixed(1) + '%');
ok('part of speech on nearly every word', W.filter(e => e.pos).length / W.length > 0.98,
   (100 * W.filter(e => e.pos).length / W.length).toFixed(1) + '%');

ok('every entry carries at least one sense', E.every(e => e.senses.length > 0));
ok('every entry has an id and a word', E.every(e => e.id && e.word));
ok('no stray line breaks left', !E.some(e => JSON.stringify(e).includes('\\n')));
ok('phonetics never bleed into the headword', !W.some(e => e.word.includes('/')));

const pv = E.filter(e => e.type === 'phrasal');
ok('every phrasal verb keeps its verb', pv.every(e => e.verb),
   pv.length + ' entries, e.g. ' + pv.slice(0, 3).map(e => e.word).join(' | '));
const makeUp = pv.find(e => e.word === 'make up for');
ok('a merged verb cell is still joined correctly', !!makeUp,
   makeUp ? makeUp.verb + ' + ' + makeUp.particle : 'no "make up for" found');

const multi = E.filter(e => e.senses.length > 1);
ok('multi-sense entries survive', multi.length > 2000,
   multi.length + ' with several senses, the largest holding ' +
   Math.max(...E.map(e => e.senses.length)));

const withEg = E.filter(e => e.senses.some(s => s.eg.length));
ok('examples split off from definitions', withEg.length > 1000,
   withEg.length + ' entries carry examples');
const stuck = E.flatMap(e => e.senses.filter(s => / - [A-Z]/.test(s.def)).map(s => e.word));
ok('almost no example left stuck to a definition', stuck.length < 5,
   stuck.length ? stuck.length + ' left (mid-line dashes): ' + stuck.join(', ') : 'none');

ok('reading passages keep their paragraphs',
   d.readings.length > 30 && d.readings.every(r => r.paras.length > 0),
   d.readings.length + ' passages');

done();
