/* Bản công khai không được kèm nguyên văn bài đọc của TED-Ed / BBC. */
const { read, ok, done } = require('./helpers');

const data = read('docs/data.json');
const shell = read('docs/index.html');
const art = read('so-tra-tu.html');

const PHRASES = [
  'Methuselah',
  'James Bedford',
  'Percy Spencer',
  'Ron Simonson',
  'Agnes Milowka',
];

ok('bản artifact vẫn còn bài đọc', PHRASES.every(p => art.includes(p)));
ok('data.json công khai không còn câu nào của bài đọc',
   PHRASES.every(p => !data.includes(p)),
   PHRASES.filter(p => data.includes(p)).join(', ') || 'sạch');
ok('vỏ trang công khai cũng sạch', PHRASES.every(p => !shell.includes(p)));
ok('mảng readings rỗng', data.includes('"readings":[]'));
ok('vẫn đủ mục từ', JSON.parse(data).entries.length > 11000,
   JSON.parse(data).entries.length + ' mục');
ok('nhẹ hơn bản artifact', data.length < art.length,
   Math.round(data.length / 1024) + ' KB so với ' + Math.round(art.length / 1024) + ' KB');

done();
