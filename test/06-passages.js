/* The reading passages, and the card that opens over a selection.

   Both builds carry the passages now (the owner asked for them on the public
   site too). Selecting a run of text looks it up in the notebook first, and
   falls back to a Google Translate link — English to Vietnamese — when the
   notebook has nothing. */
const { read, boot, ok, done, wait, click, btn } = require('./helpers');

const data = JSON.parse(read('docs/data.json'));
const shell = read('docs/index.html');
const art = read('engrowdict.html');

/* --- the data ships in both copies -------------------------------------- */
ok('the public data carries the passages', data.readings.length > 30,
   data.readings.length + ' passages');
ok('every passage keeps its title and paragraphs',
   data.readings.every(r => r.title && r.paras && r.paras.length > 0));
ok('the artifact copy has them too', art.includes('Methuselah'));
ok('the shell itself stays light', shell.length < 160000,
   Math.round(shell.length / 1024) + ' KB');

/* --- and they work in the page ------------------------------------------ */
(async () => {
  // one stub serves data.json and stands in for the translator
  let translatorUp = true;
  const a = boot({
    html: shell, full: true,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: url => {
      if (String(url).includes('mymemory')) {
        return translatorUp
          ? Promise.resolve({ ok: true, json: () => Promise.resolve({
              responseData: { translatedText: 'bàn phím thử' } }) })
          : Promise.reject(new Error('offline'));
      }
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(read('docs/data.json'))) });
    },
  });
  await wait(900);
  const { doc, window: w } = a;

  ok('the Passages button appears', !doc.getElementById('view-read').hidden);
  click(w, btn(doc, '.acts .btn', 'Passages'));
  await wait(30);
  ok('switching to passages lists them',
     doc.getElementById('count').textContent.includes('passage'),
     doc.getElementById('count').textContent);
  ok('the chips are hidden while reading', doc.getElementById('chips').hidden);

  click(w, doc.querySelector('.hit'));
  await wait(30);
  ok('a passage opens with its paragraphs',
     doc.querySelectorAll('.read .prose p').length > 1,
     doc.querySelector('.read h1')?.textContent + ' — ' +
     doc.querySelectorAll('.read .prose p').length + ' paragraphs');
  ok('  and says selections can be looked up',
     (doc.querySelector('.read .hint')?.textContent || '').includes('Select any word'));
  ok('  the prose is justified, with hyphenation to keep the spacing even',
     /\.read \.prose p \{[^}]*text-align: justify/.test(read('app.css')) &&
     /\.read \.prose p \{[^}]*hyphens: auto/.test(read('app.css')));

  /* --- the selection card ------------------------------------------------ */
  // jsdom has no real selection, so drive the same path the handler uses
  function selectText(text) {
    w.getSelection = () => ({
      isCollapsed: false,
      toString: () => text,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 100, top: 200, width: 60, bottom: 216 }) }),
    });
    const prose = doc.querySelector('.read .prose');
    prose.dispatchEvent(new w.Event('mouseup'));
    return new Promise(r => setTimeout(r, 20));
  }
  const card = () => doc.getElementById('lookup');

  await selectText('zenith');
  ok('selecting a word opens the card', !!card() && !card().hidden);
  ok('  showing the headword', card().querySelector('.picked')?.textContent === 'zenith',
     card().querySelector('.picked')?.textContent);
  ok('  with its part of speech and phonetics',
     (card().querySelector('.sub')?.textContent || '').includes('/'),
     card().querySelector('.sub')?.textContent);
  ok('  and the Vietnamese meaning',
     (card().querySelector('.g')?.textContent || '').includes('đỉnh'),
     card().querySelector('.g')?.textContent);
  ok('  offering a jump to the full entry', !!btn(doc, '#lookup .btn', 'Open entry'));

  await selectText('Abated.');
  ok('a stray capital and full stop are ignored',
     card().querySelector('.picked')?.textContent === 'abate',
     card().querySelector('.picked')?.textContent);

  await selectText('abating');
  ok('an -ing form finds its headword',
     card().querySelector('.picked')?.textContent === 'abate',
     card().querySelector('.picked')?.textContent);

  await selectText('he had to make up for it');
  ok('a phrasal verb buried in a sentence is found',
     card().querySelector('.picked')?.textContent === 'make up for',
     card().querySelector('.picked')?.textContent);

  // the notebook holds advanced vocabulary, so ordinary words miss and the
  // machine translator takes over
  ok('common words really are absent from the notebook',
     !data.entries.some(e => ['explain', 'carry', 'threat'].includes(e.word.toLowerCase())));

  await selectText('qwertyuiop');
  const gt = card().querySelector('a.btn');
  ok('a miss offers Google Translate, English to Vietnamese',
     !!gt && gt.href.includes('sl=en') && gt.href.includes('tl=vi') &&
     gt.href.includes('qwertyuiop'),
     gt && gt.href.slice(0, 78));
  await wait(60);
  ok('  and shows the machine translation inline',
     (card().querySelector('.g')?.textContent || '').includes('bàn phím thử'),
     card().querySelector('.g')?.textContent);
  ok('  labelled as machine translation, not as notebook content',
     (card().querySelector('.g em')?.textContent || '').includes('machine translation'),
     card().querySelector('.g em')?.textContent);

  translatorUp = false;
  await selectText('zxcvbnm');
  await wait(60);
  ok('when the translator cannot be reached it says so',
     (card().textContent || '').includes('could not be reached'),
     card().querySelector('.none')?.textContent);
  ok('  and still offers the Google Translate link',
     !!card().querySelector('a.btn'));

  // opening the entry from the card takes you back to the dictionary
  await selectText('zenith');
  click(w, btn(doc, '#lookup .btn', 'Open entry'));
  await wait(30);
  ok('Open entry switches back to the dictionary',
     doc.querySelector('.headword')?.textContent === 'zenith',
     doc.querySelector('.headword')?.textContent);
  ok('  and closes the card', card().hidden);

  done(a.errs);
})();
