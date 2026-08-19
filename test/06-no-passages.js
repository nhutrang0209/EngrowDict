/* The public copy must not carry the verbatim TED-Ed / BBC passages. */
const { read, ok, done } = require('./helpers');

const data = read('docs/data.json');
const shell = read('docs/index.html');
const art = read('engrowdict.html');

const PHRASES = [
  'Methuselah',
  'James Bedford',
  'Percy Spencer',
  'Ron Simonson',
  'Agnes Milowka',
];

ok('the artifact copy still has the passages', PHRASES.every(p => art.includes(p)));
ok('the public data carries none of their sentences',
   PHRASES.every(p => !data.includes(p)),
   PHRASES.filter(p => data.includes(p)).join(', ') || 'clean');
ok('the public shell is clean too', PHRASES.every(p => !shell.includes(p)));
ok('the readings array is empty', data.includes('"readings":[]'));
ok('the entries are all still there', JSON.parse(data).entries.length > 11000,
   JSON.parse(data).entries.length + ' entries');
ok('and it is lighter than the artifact copy', data.length < art.length,
   Math.round(data.length / 1024) + ' KB against ' + Math.round(art.length / 1024) + ' KB');

done();
