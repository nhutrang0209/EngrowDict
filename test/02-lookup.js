/* Looking things up: search, filters, letter rail, prev/next, virtual list.
   Runs against the artifact build. */
const { read, boot, ok, done, wait, click, type, btn } = require('./helpers');

(async () => {
  const a = boot({ html: read('engrowdict.html') });
  await wait(600);
  const { doc, window: w } = a;
  const q = doc.getElementById('q');

  ok('page builds', !!doc.querySelector('.top .mark'),
     doc.getElementById('count').textContent);
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

  // a definition that leads with the form being defined
  type(w, q, 'better off');
  await wait(20);
  click(w, doc.querySelector('.hit'));
  const term = doc.querySelector('.def .term');
  ok('the lead-in term is set apart', !!term && term.textContent === 'be better off',
     term && term.textContent);
  ok('  and the rest of the definition is left alone',
     (doc.querySelector('.def')?.textContent || '').startsWith('be better off: to have more money'),
     doc.querySelector('.def')?.textContent?.slice(0, 52));
  ok('  in the ochre the sheet uses', /\.def \.term \{[^}]*var\(--term\)/.test(read('app.css')) &&
     /--term:\s*#bf9000/.test(read('app.css')));
  ok('  every sense that has one gets it',
     doc.querySelectorAll('.def .term').length >= 3,
     doc.querySelectorAll('.def .term').length + ' of ' +
     doc.querySelectorAll('.def').length + ' senses');

  // a definition with no lead-in must not be carved up
  type(w, q, 'aardvark');
  await wait(20);
  click(w, doc.querySelector('.hit'));
  ok('a plain definition is left whole', !doc.querySelector('.def .term'),
     doc.querySelector('.def')?.textContent?.slice(0, 40));

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

  /* Stepping is the arrow keys. It used to be a pair of buttons over the
     entry as well, and they were taken away on purpose — they said what the
     keys already say on every entry forever, and the space belongs to what
     can be done to this entry. The test went on pressing them, which meant
     clicking undefined, which meant this file stopped running here rather
     than saying so. */
  const arrow = key =>
    doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: key, bubbles: true }));

  type(w, q, 'abs');
  await wait(20);
  click(w, doc.querySelector('.hit'));
  const firstWord = doc.querySelector('.headword').textContent;
  arrow('ArrowRight');
  const secondWord = doc.querySelector('.headword').textContent;
  ok('→ moves to the next entry', firstWord !== secondWord, firstWord + ' → ' + secondWord);
  arrow('ArrowLeft');
  ok('← moves back', doc.querySelector('.headword').textContent === firstWord,
     doc.querySelector('.headword').textContent);
  /* What used to stand over the entry: the two arrows, and "3 of 40" beside
     them. Both were taken away for saying what the keys say on every entry
     forever, so the check that they are there is now a check that they are
     not — the entry carries what can be done to it, and nothing else. */
  ok('the entry does not restate the keys back at the reader',
     !doc.querySelector('.pos-in-list') &&
     doc.querySelectorAll('.entry .entry-nav .iconbtn').length <= 1,
     doc.querySelectorAll('.entry .entry-nav .iconbtn').length + ' buttons over the entry');

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

  click(w, doc.getElementById('tab-passages'));
  await wait(20);
  ok('switching to the passages', doc.getElementById('count').textContent.includes('passage'),
     doc.getElementById('count').textContent);
  click(w, doc.querySelector('.hit'));
  ok('a passage opens with its paragraphs',
     doc.querySelectorAll('.read .prose p').length > 1,
     doc.querySelector('.read h1')?.textContent + ' — ' +
     doc.querySelectorAll('.read .prose p').length + ' paragraphs');

  /* --- the word said out loud --------------------------------------------- */
  /* The browser's own voice: no network, no key, and nothing to embed. */
  const s = boot({ html: read('engrowdict.html'), speech: true });
  await wait(600);
  type(s.window, s.doc.getElementById('q'), 'abate');
  await wait(60);
  click(s.window, s.doc.querySelector('.hit'));
  await wait(40);
  const say = s.doc.querySelector('.entry-head .say');
  ok('the headword has a speaker beside it', !!say && !!say.querySelector('svg'),
     say ? say.getAttribute('aria-label') : 'no button');
  click(s.window, say);
  ok('  pressing it says the word, in an English voice',
     s.window.spoken.join(' | ') === '(cancel) | abate @en-GB/GB',
     s.window.spoken.join(' | '));
  ok('  and a second press interrupts the first rather than queueing behind it',
     (click(s.window, say), s.window.spoken.filter(x => x === '(cancel)').length === 2),
     s.window.spoken.join(' | '));

  ok('a browser with no voice at all is given no button to press',
     !a.doc.querySelector('.entry-head .say'));

  done(a.errs.concat(s.errs));
})();
