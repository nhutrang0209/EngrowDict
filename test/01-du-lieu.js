/* Dữ liệu bóc từ sheet: đủ A–Z, đúng cấu trúc, không sót rác định dạng. */
const { ROOT, read, ok, done } = require('./helpers');
const path = require('path');

const d = JSON.parse(read('dataset.json'));
const E = d.entries;
const W = E.filter(e => e.type === 'word');

ok('có trên 10.000 từ', W.length > 10000, W.length + ' từ đơn, ' + E.length + ' mục tổng');

const letters = new Set(W.map(e => e.word[0].toLowerCase()));
const missing = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(l => !letters.has(l));
ok('phủ đủ 26 chữ cái', missing.length === 0, missing.length ? 'thiếu ' + missing.join(',') : 'a→z đủ');

const perLetter = {};
for (const e of W) perLetter[e.word[0].toLowerCase()] = (perLetter[e.word[0].toLowerCase()] || 0) + 1;
ok('không chữ nào bị cụt', Object.values(perLetter).every(n => n > 0)
   && perLetter.z > 5 && perLetter.s > 500,
   's:' + perLetter.s + ' z:' + perLetter.z);

ok('phiên âm phủ gần hết', W.filter(e => e.ipa).length / W.length > 0.98,
   (100 * W.filter(e => e.ipa).length / W.length).toFixed(1) + '%');
ok('từ loại phủ gần hết', W.filter(e => e.pos).length / W.length > 0.98,
   (100 * W.filter(e => e.pos).length / W.length).toFixed(1) + '%');

ok('mọi mục đều có ít nhất một nghĩa', E.every(e => e.senses.length > 0));
ok('mọi mục đều có id và word', E.every(e => e.id && e.word));
ok('không sót ký tự xuống dòng', !E.some(e => JSON.stringify(e).includes('\\n')));
ok('không sót phiên âm lẫn trong tên từ', !W.some(e => e.word.includes('/')));

const pv = E.filter(e => e.type === 'phrasal');
ok('phrasal verb luôn có động từ', pv.every(e => e.verb),
   pv.length + ' mục, vd: ' + pv.slice(0, 3).map(e => e.word).join(' | '));
const makeUp = pv.find(e => e.word === 'make up for');
ok('động từ bị gộp ô vẫn ghép đúng', !!makeUp,
   makeUp ? makeUp.verb + ' + ' + makeUp.particle : 'không thấy "make up for"');

const multi = E.filter(e => e.senses.length > 1);
ok('giữ được mục nhiều nghĩa', multi.length > 2000,
   multi.length + ' mục nhiều nghĩa, nhiều nhất ' +
   Math.max(...E.map(e => e.senses.length)) + ' nghĩa');

const withEg = E.filter(e => e.senses.some(s => s.eg.length));
ok('tách được ví dụ khỏi định nghĩa', withEg.length > 1000,
   withEg.length + ' mục có ví dụ');
const stuck = E.flatMap(e => e.senses.filter(s => / - [A-Z]/.test(s.def)).map(s => e.word));
ok('gần như không còn ví dụ dính vào định nghĩa', stuck.length < 5,
   stuck.length ? stuck.length + ' ca còn lại (gạch nối giữa dòng): ' + stuck.join(', ') : 'sạch');

ok('có bài đọc kèm đoạn', d.readings.length > 30 && d.readings.every(r => r.paras.length > 0),
   d.readings.length + ' bài');

done();
