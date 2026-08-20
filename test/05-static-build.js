/* The static build: a light shell that fetches data.json, no window.claude,
   words kept in localStorage and still there on the next visit. */
const { read, boot, ok, done, wait, click, addWord, unlockedStore, BACKUP_KEY,
        deleteWord } = require('./helpers');

const shell = read('docs/index.html');
const store = unlockedStore();
const mk = () => boot({
  html: shell, full: true, store,
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

(async () => {
  // 175 KB, not 140: the Books tab and the reader added about seven, putting a
  // book on the site for every device another three, the Auto Fill box in the
  // word form two more, keeping your place in a passage another four, and the
  // key for the Vietnamese column one. The importer itself is not in here —
  // bookify.js and pdf.js are fetched only when someone actually picks a file.
  ok('the shell is small', shell.length < 175000, Math.round(shell.length / 1024) + ' KB');
  ok('the shell embeds no data',
     !shell.includes('<script type="application/json" id="base">'));
  ok('the shell points at data.json', shell.includes('href="data.json"'));

  const a = mk();
  await wait(900);
  const { doc, window: w } = a;

  ok('no claude runtime here', typeof w.claude === 'undefined');
  ok('it loads and builds', !!doc.querySelector('.top .mark'),
     doc.getElementById('count').textContent);
  ok('all the data arrived', doc.getElementById('count').textContent.includes('11,401'),
     doc.getElementById('count').textContent);
  ok('the add button is available once unlocked',
     doc.getElementById('add-word').textContent === '+ Add word');
  ok('no read-only notice', doc.getElementById('banner').hidden);
  ok('the opening screen says where words are kept',
     [...doc.querySelectorAll('.blank p')].some(p => p.textContent.includes('this browser')));
  ok('the Passages button is offered',
     !doc.getElementById('tab-passages').hidden,
     [...doc.querySelectorAll('.acts .btn')].map(b => b.textContent).join(' | '));

  const dlg = addWord(a, {
    word: 'petrichor',
    pos: 'n',
    ipa: '/ˈpet.rɪ.kɔːr/',
    def: 'the smell of the ground after it rains',
    vi: 'mùi đất sau mưa',
  });
  await wait(150);

  ok('the form closes', !dlg.open);
  ok('the new word shows straight away',
     doc.querySelector('.headword')?.textContent === 'petrichor',
     doc.querySelector('.headword')?.textContent + ' — ' + doc.querySelector('.vi')?.textContent);
  ok('it is written to localStorage', !!store[BACKUP_KEY],
     (store[BACKUP_KEY] || '').slice(0, 58));
  ok('the total goes up by one', doc.getElementById('count').textContent.includes('11,402'),
     doc.getElementById('count').textContent);

  const b = mk();
  await wait(900);
  ok('the word survives a page reload',
     b.doc.getElementById('count').textContent.includes('11,402'),
     b.doc.getElementById('count').textContent);
  const q = b.doc.getElementById('q');
  q.value = 'mui dat sau mua';
  q.dispatchEvent(new b.window.Event('input'));
  await wait(30);
  ok('and is findable in Vietnamese without tone marks',
     b.doc.querySelector('.hit .hw')?.textContent === 'petrichor',
     b.doc.querySelector('.hit .hw')?.textContent);

  click(b.window, b.doc.querySelector('.hit'));
  b.window.confirm = () => true;
  deleteWord(b);
  await wait(150);
  q.value = '';                       // the count line reports the current filter
  q.dispatchEvent(new b.window.Event('input'));
  await wait(30);
  ok('deleting works', b.doc.getElementById('count').textContent.includes('11,401'),
     b.doc.getElementById('count').textContent);
  ok('localStorage is empty again', store[BACKUP_KEY] === '[]', store[BACKUP_KEY]);

  done(a.errs.concat(b.errs));
})();
