/* The static build: a light shell that fetches data.json, no window.claude,
   words kept in localStorage and still there on the next visit. */
const { read, boot, ok, done, wait, click, addWord, unlockedStore, BACKUP_KEY,
        deleteWord } = require('./helpers');

const shell = read('docs/index.html');
// the published data grows every time the sheet is synced, so the counts on
// screen are read off it rather than written down here
const REAL = JSON.parse(read('docs/data.json'));
const NOW = REAL.entries.length.toLocaleString('en-US');
const PLUS1 = (REAL.entries.length + 1).toLocaleString('en-US');
const store = unlockedStore();
const mk = () => boot({
  html: shell, full: true, store,
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

(async () => {
  // 320 KB, not 140: the Books tab and the reader added about seven, putting a
  // book on the site for every device another three, the Auto Fill box in the
  // word form two more, keeping your place in a passage another four, the key
  // for the Vietnamese column one, the forms on the rail — hidden, dragged and
  // pulled about — six between them, the Translate tab twelve, writing a
  // passage and having one translated beside it eight, pairing the two columns
  // sentence by sentence five, answering a selected line as a line rather than
  // as a phrase out of the middle of it two, and refusing a word the notebook
  // already holds one. The importer itself is not in here: bookify.js and
  // pdf.js are fetched only when someone picks a file.
  //
  // Measured as it ships. build.py writes whatever newline the machine it ran
  // on prefers, and git puts them all back to one byte on the way in, so a
  // build on Windows is some eight KB of carriage returns that nobody ever
  // downloads — count those and the budget is a platform away from meaning
  // anything.
  const shipped = shell.replace(/\r\n/g, '\n').length;
  ok('the shell is small', shipped < 320000, Math.round(shipped / 1024) + ' KB');
  ok('the shell embeds no data',
     !shell.includes('<script type="application/json" id="base">'));
  ok('the shell points at data.json', shell.includes('href="data.json"'));

  const a = mk();
  await wait(900);
  const { doc, window: w } = a;

  ok('no claude runtime here', typeof w.claude === 'undefined');
  ok('it loads and builds', !!doc.querySelector('.top .mark'),
     doc.getElementById('count').textContent);
  ok('all the data arrived', doc.getElementById('count').textContent.includes(NOW),
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
  ok('the total goes up by one', doc.getElementById('count').textContent.includes(PLUS1),
     doc.getElementById('count').textContent);

  const b = mk();
  await wait(900);
  ok('the word survives a page reload',
     b.doc.getElementById('count').textContent.includes(PLUS1),
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
  ok('deleting works', b.doc.getElementById('count').textContent.includes(NOW),
     b.doc.getElementById('count').textContent);
  ok('localStorage is empty again', store[BACKUP_KEY] === '[]', store[BACKUP_KEY]);

  done(a.errs.concat(b.errs));
})();
