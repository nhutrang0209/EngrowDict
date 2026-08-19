/* Looking things up: search, filters, letter rail, prev/next, virtual list.
   Runs against the artifact build. */
const { read, boot, ok, done, wait, click, type, btn } = require('./helpers');

(async () => {
  const a = boot({ html: read('engrowdict.html') });
  await wait(600);
  const { doc, window: w } = a;
  const q = doc.getElementById('q');

  ok('page builds', !!doc.querySelector('.top .mark'),
     doc.getElementById('tally').textContent);
  ok('the list has rows', doc.querySelectorAll('.hit').length > 0,
     doc.querySelectorAll('.hit').length + ' rows built, ' +
     doc.getElementById('count').textContent);
  ok('virtual list keeps the DOM small', doc.querySelectorAll('.hit').length < 60,
     doc.querySelectorAll('.hit').length + ' buttons in the DOM for 11k entries');
  ok('letter marks appear when nothing is typed',
     doc.querySelectorAll('.letter-mark').length > 0,
     doc.querySelector('.letter-mark')?.textContent);
  ok('the A–Z rail has 26 buttons', doc.querySelectorAll('.alpha button').length === 26);
  ok('no letter is disabled', doc.querySelectorAll('.alpha button[disabled]').length === 0);

  // English lookups from the start, middle and end of the alphabet
  for (const [word, expectVi] of [['abate', 'yếu'], ['martial', 'quân'], ['zenith', 'đỉnh']]) {
    type(w, q, word);
    await wait(20);
    const first = doc.querySelector('.hit .hw');
    ok('search "' + word + '"', first && first.textContent.trim() === word,
       first && first.textContent);
    click(w, doc.querySelector('.hit'));
    ok('  opens the entry for "' + word + '"',
       doc.querySelector('.headword')?.textContent === word &&
       (doc.querySelector('.vi')?.textContent || '').includes(expectVi),
       doc.querySelector('.ipa')?.textContent + ' — ' + doc.querySelector('.vi')?.textContent);
  }

  type(w, q, 'strike');
  await wait(20);
  click(w, doc.querySelector('.hit'));
  ok('senses are numbered when there are several',
     doc.querySelectorAll('.sense .num').length > 5,
     doc.querySelectorAll('.senses .sense').length + ' senses');

  type(w, q, 'abject');
  await wait(20);
  click(w, doc.querySelector('.hit'));
  ok('examples get their own line', doc.querySelectorAll('.eg').length > 0,
     doc.querySelector('.eg')?.textContent);

  type(w, q, 'mui dat');
  await wait(20);
  ok('Vietnamese without tone marks still finds it',
     doc.querySelectorAll('.hit').length > 0,
     doc.querySelector('.hit .hw')?.textContent + ' / ' + doc.querySelector('.hit .gloss')?.textContent);

  type(w, q, 'make up for');
  await wait(20);
  ok('phrasal verbs are searchable',
     doc.querySelector('.hit .hw')?.textContent === 'make up for',
     doc.querySelector('.hit .hw')?.textContent);
  click(w, doc.querySelector('.hit'));
  ok('  suggests others with the same verb',
     doc.querySelectorAll('.related button').length > 3,
     doc.querySelector('.related h2')?.textContent + ': ' +
     [...doc.querySelectorAll('.related button')].slice(0, 4).map(b => b.textContent).join(', '));

  type(w, q, 'abs');
  await wait(20);
  click(w, doc.querySelector('.hit'));
  const firstWord = doc.querySelector('.headword').textContent;
  click(w, [...doc.querySelectorAll('.iconbtn')][1]);   // →
  const secondWord = doc.querySelector('.headword').textContent;
  ok('→ moves to the next entry', firstWord !== secondWord, firstWord + ' → ' + secondWord);
  click(w, [...doc.querySelectorAll('.iconbtn')][0]);   // ←
  ok('← moves back', doc.querySelector('.headword').textContent === firstWord,
     doc.querySelector('.headword').textContent);
  ok('position in the result set is shown', !!doc.querySelector('.pos-in-list'),
     doc.querySelector('.pos-in-list')?.textContent);

  type(w, q, '');
  await wait(20);
  click(w, [...doc.querySelectorAll('.chip')].find(c => c.textContent.startsWith('Idioms')));
  await wait(20);
  ok('filtering to idioms', doc.getElementById('count').textContent.startsWith('352'),
     doc.getElementById('count').textContent);
  click(w, [...doc.querySelectorAll('.chip')].find(c => c.textContent.startsWith('All')));
  await wait(20);

  const zBtn = [...doc.querySelectorAll('.alpha button')].find(b => b.dataset.l === 'z');
  click(w, zBtn);
  await wait(20);
  const shown = [...doc.querySelectorAll('.hit .hw')].map(n => n.textContent.toLowerCase());
  ok('the rail jumps to Z', shown.some(t => t.startsWith('z')),
     'marks ' + [...doc.querySelectorAll('.letter-mark')].map(n => n.textContent).join('') +
     ', e.g. ' + shown.filter(t => t.startsWith('z')).slice(0, 3).join(', '));

  click(w, btn(doc, '.acts .btn', 'Passages'));
  await wait(20);
  ok('switching to the passages', doc.getElementById('count').textContent.includes('passage'),
     doc.getElementById('count').textContent);
  click(w, doc.querySelector('.hit'));
  ok('a passage opens with its paragraphs',
     doc.querySelectorAll('.read .prose p').length > 1,
     doc.querySelector('.read h1')?.textContent + ' — ' +
     doc.querySelectorAll('.read .prose p').length + ' paragraphs');

  done(a.errs);
})();
