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
// as it ships: a build on Windows carries carriage returns that git
// normalises away before anyone downloads it — see 05-static-build.js
ok('the shell itself stays light', shell.replace(/\r\n/g, '\n').length < 320000,
   Math.round(shell.length / 1024) + ' KB');

/* --- and they work in the page ------------------------------------------ */
(async () => {
  // one stub serves data.json and stands in for the translator
  let googleUp = true, memoryUp = true;
  const a = boot({
    html: shell, full: true, speech: true,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: url => {
      if (String(url).includes('translate.googleapis.com')) {
        return googleUp
          ? Promise.resolve({ ok: true, json: () => Promise.resolve([[['bỏ tù', 'imprisonment']]]) })
          : Promise.reject(new Error('offline'));
      }
      if (String(url).includes('mymemory')) {
        return memoryUp
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

  ok('the Passages button appears', !doc.getElementById('tab-passages').hidden);
  click(w, doc.getElementById('tab-passages'));
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
  ok('the row leads with the passage number, not a pill',
     doc.querySelector('.hit.passage .idx')?.textContent === '1' &&
     !doc.querySelector('.hit .senses-n'),
     doc.querySelector('.hit.passage .idx')?.textContent);
  // the passages are whatever the sheet published last, so the row is checked
  // against the data rather than against a title written down here
  ok('  and the title sits beside it',
     doc.querySelector('.hit.passage .col .hw')?.textContent === data.readings[0].title,
     doc.querySelector('.hit.passage .col .hw')?.textContent);

  ok('  and says selections can be looked up',
     (doc.querySelector('.read .hint')?.textContent || '').includes('Select any word'));
  /* A book chapter is drawn by the same readingView, so one rule covers both. */
  ok('  the prose is justified, and no word is broken across two lines',
     /\.read \.prose p \{[^}]*text-align: justify/.test(read('app.css')) &&
     /\.read \.prose p \{[^}]*hyphens: none/.test(read('app.css')) &&
     !/hyphens: auto/.test(read('app.css')),
     (read('app.css').match(/hyphens: [a-z]+/g) || []).join(', '));

  /* A lettered passage shows its letters in the margin. Which passage that is
     comes from the data rather than from memory: the sheet is edited, and a
     test that names one passage stops testing anything the day it is renamed
     — it stops running instead, on a click at nothing. */
  const lettered = data.readings.find(r => r.paras.filter(p => p.mark).length > 4);
  ok('some passage numbers its paragraphs in the margin',
     !!lettered, lettered && lettered.title);
  const q2 = doc.getElementById('q');
  q2.value = lettered.title;
  q2.dispatchEvent(new w.Event('input'));
  await wait(30);
  ok('  and searching its title finds it',
     doc.querySelector('.hit .hw')?.textContent === lettered.title,
     doc.querySelector('.hit .hw')?.textContent);
  click(w, doc.querySelector('.hit'));
  await wait(30);
  ok('a lettered passage marks its paragraphs',
     doc.querySelectorAll('.read .prose p.labelled .pmark').length > 4,
     [...doc.querySelectorAll('.read .prose .pmark')].slice(0, 6).map(n => n.textContent).join(''));
  const firstMarked = lettered.paras.find(p => p.mark);
  ok('  and the letter is no longer part of the sentence',
     !firstMarked.text.startsWith(firstMarked.mark) &&
     doc.querySelector('.read .prose p.labelled')?.textContent
       .startsWith(firstMarked.mark + firstMarked.text.slice(0, 12)),
     doc.querySelector('.read .prose p.labelled')?.textContent.slice(0, 26));
  q2.value = '';
  q2.dispatchEvent(new w.Event('input'));
  await wait(30);
  click(w, doc.querySelector('.hit'));
  await wait(30);

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
  ok('  and a speaker, since a word is a word wherever it is read',
     !!card().querySelector('.picked .say') &&
     card().querySelector('.picked .say').getAttribute('aria-label') === 'Say zenith',
     card().querySelector('.picked .say')
       ? card().querySelector('.picked .say').getAttribute('aria-label') : 'no button');

  /* --- every sense, not the first few ------------------------------------ */
  const host = data.entries.find(e => e.word === 'host' && e.type === 'word');
  ok('the notebook holds more senses for a word than a card used to show',
     host && host.senses.length > 4, host && host.senses.length + ' senses');

  await selectText('host');
  const glosses = () => [...card().querySelectorAll('.glosses.senses .g')];
  ok('a word with many senses shows all of them',
     glosses().length === host.senses.length,
     glosses().length + ' of ' + host.senses.length);
  ok('  the last one included, which used to fall off the end',
     glosses().pop().textContent.includes(host.senses[host.senses.length - 1].vi),
     glosses().pop().textContent);
  ok('  in a box that scrolls rather than a card that grows',
     !!card().querySelector('.glosses.senses'));
  ok('  with Open entry still under it',
     !!btn(doc, '#lookup .btn', 'Open entry'));
  ok('  and a count, since a scrollbar on a phone is drawn only while scrolling',
     (card().querySelector('.sub')?.textContent || '')
       .includes(host.senses.length + ' senses'),
     card().querySelector('.sub')?.textContent);

  /* The card closes when the passage moves out from under it. Scrolling the
     senses is not that: closing there would make the list unreadable by
     reading it. */
  card().querySelector('.glosses.senses').dispatchEvent(new w.Event('scroll'));
  await wait(10);
  ok('scrolling the senses leaves the card open', !card().hidden);
  doc.querySelector('.detail').dispatchEvent(new w.Event('scroll'));
  await wait(10);
  ok('  scrolling the passage still closes it', card().hidden);

  await selectText('Abated.');
  ok('a stray capital and full stop are ignored',
     card().querySelector('.picked')?.textContent === 'abate',
     card().querySelector('.picked')?.textContent);

  await selectText('abating');
  ok('an -ing form finds its headword',
     card().querySelector('.picked')?.textContent === 'abate',
     card().querySelector('.picked')?.textContent);

  /* --- a line is answered as a line ---------------------------------------
     A reader picked out a sentence and got back one phrase from the middle of
     it, the sentence itself never translated. What was asked decides what is
     answered: the notebook answers a word, the translator answers a line, and
     an entry found inside a line goes underneath rather than in place of it. */
  await selectText('he had to make up for it');
  await wait(60);
  ok('a line is headed by the line, not by a phrase out of the middle of it',
     card().querySelector('.picked')?.textContent === 'he had to make up for it',
     card().querySelector('.picked')?.textContent);
  ok('  and it is the line that gets translated',
     (card().querySelector('.g')?.textContent || '').includes('bỏ tù'),
     card().querySelector('.g')?.textContent);
  ok('  a phrasal verb buried in it is still found, and offered underneath',
     card().querySelector('.also-word')?.textContent === 'make up for' &&
     !!btn(doc, '#lookup .btn', 'Open entry'),
     card().querySelector('.also-word')?.textContent);
  ok('  set apart, so it does not read as the answer to what was asked',
     /\.lookup \.also \{[^}]*border-top/.test(read('app.css')), 'ruled off');

  await selectText('make up for');
  ok('the phrase on its own is still a headword, answered by the notebook',
     card().querySelector('.picked')?.textContent === 'make up for' &&
     !card().querySelector('.also'),
     card().querySelector('.picked')?.textContent);

  /* A sentence out of the passages themselves, not one written here to make
     the point — the cap is about what the passages actually run to, and a
     sentence invented for the test can be any length its author guesses.
     The one written here was 113 characters, and the check that it ran past
     the old cap of 120 had been failing ever since. */
  const sentences = data.readings
    .flatMap(r => r.paras.map(p => p.text))
    .flatMap(t => t.split(/(?<=[.!?])\s+/))
    .map(t => t.trim())
    .filter(Boolean);
  const over = sentences.filter(t => t.length > 120).length;
  ok('  a sentence past the old 120-character cap is an ordinary sentence here',
     over / sentences.length > 0.2,
     Math.round(100 * over / sentences.length) + '% of ' + sentences.length
       + ' sentences run past 120 characters');
  const long = sentences.find(t => t.length > 120 && t.length < 300);
  await selectText(long);
  await wait(60);
  ok('selecting a whole sentence opens the card rather than nothing at all',
     !!card() && !card().hidden && card().querySelector('.picked.line'),
     card() && card().hidden ? 'hidden' : 'shown');
  ok('  headed by the sentence, set to be read rather than blown up',
     card().querySelector('.picked')?.textContent === long,
     (card().querySelector('.picked')?.textContent || '').slice(0, 40));
  ok('  and a paragraph is still too much to ask one card for', (() => {
     const para = data.readings[0].paras[0].text;
     return para.length > 300;
  })(), 'a paragraph runs past the cap');

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
  ok('  and shows the translation inline',
     (card().querySelector('.g')?.textContent || '').includes('bỏ tù'),
     card().querySelector('.g')?.textContent);
  ok('  naming its source, so it is not mistaken for the notebook',
     (card().querySelector('.g em')?.textContent || '')
       .includes('Google Translate, not from the notebook'),
     card().querySelector('.g em')?.textContent);

  // Google is undocumented and may stop answering; MyMemory stands behind it
  googleUp = false;
  await selectText('poiuytrewq');
  await wait(60);
  ok('  if Google will not answer, the other source is tried',
     (card().querySelector('.g em')?.textContent || '').includes('MyMemory'),
     card().querySelector('.g')?.textContent);

  memoryUp = false;
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
  const back = doc.getElementById('back-to-reading');
  ok('  leaving a way back to the passage it was opened from', !!back,
     back && back.textContent);
  click(w, back);
  await wait(30);
  ok('  which goes back to it',
     doc.getElementById('tab-passages').getAttribute('aria-selected') === 'true' &&
     !!doc.querySelector('.read .prose'),
     doc.querySelector('.read h1') && doc.querySelector('.read h1').textContent);

  done(a.errs);
})();
