/* The Translate tab: two boxes, the way everybody already knows.

   Type into the left and the right keeps up — after the typing pauses, since a
   request per keystroke is a request nobody answers. Both ways round, a copy
   and a speaker on each box, and the words in an English result still one
   selection away from the notebook. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');

/* Every request is answered, and written down with the direction it asked for
   so the test can see which way round it went and how the text was cut up. */
function mk(opts) {
  opts = opts || {};
  const sent = [];
  const copied = [];
  const g = boot({
    html: shell, full: true, width: opts.width || 1400, speech: true,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: url => {
      const u = String(url);
      if (u.includes('translate.googleapis.com')) {
        const q = decodeURIComponent(u.split('&q=')[1] || '');
        const sl = (u.match(/[?&]sl=([a-z]+)/) || [])[1];
        const tl = (u.match(/[?&]tl=([a-z]+)/) || [])[1];
        sent.push({ via: 'google', q, sl, tl });
        return opts.googleDown
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ ok: true,
              json: () => Promise.resolve([[['[' + tl + '] ' + q.slice(0, 40), q]]]) });
      }
      if (u.includes('mymemory')) {
        const q = decodeURIComponent(u.split('&q=')[1] || '');
        const pair = decodeURIComponent((u.match(/langpair=([^&]+)/) || [])[1] || '');
        sent.push({ via: 'memory', q, sl: pair.split('|')[0], tl: pair.split('|')[1] });
        return opts.memoryDown
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ ok: true, json: () => Promise.resolve({
              responseData: { translatedText: '[mm] ' + q.slice(0, 40) } }) });
      }
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(read('docs/data.json'))) });
    },
  });
  // jsdom has no clipboard, and the page must not fall over without one
  g.window.navigator.clipboard = {
    writeText: t => { copied.push(t); return Promise.resolve(); },
  };
  g.sent = sent;
  g.copied = copied;
  return g;
}

const type = (g, text) => {
  const ta = g.doc.getElementById('tr-in');
  ta.value = text;
  ta.dispatchEvent(new g.window.Event('input'));
};
const outText = g => [...g.doc.querySelectorAll('.tr-para .vi')]
  .map(n => n.textContent).join('\n\n');

(async () => {
  const g = mk();
  await wait(900);
  const { doc, window: w } = g;

  /* --- getting there ----------------------------------------------------- */
  click(w, doc.getElementById('tab-translate'));
  await wait(40);
  ok('it opens on two boxes', !!doc.getElementById('tr-in') && !!doc.getElementById('tr-out'));
  ok('  which way round is said above them',
     doc.getElementById('tr-from').textContent === 'English' &&
     doc.getElementById('tr-to').textContent === 'Vietnamese',
     doc.getElementById('tr-from').textContent + ' to ' + doc.getElementById('tr-to').textContent);
  ok('  the far box says what it is for',
     (doc.querySelector('.tr-none') || {}).textContent === 'Translation');
  ok('  there is no Translate button to press', !doc.getElementById('tr-go'));

  /* --- it keeps up with the typing --------------------------------------- */
  type(g, 'The first paragraph.');
  ok('nothing is asked on the keystroke itself', g.sent.length === 0,
     g.sent.length + ' requests');
  await wait(700);
  ok('a pause in the typing is what sends it', g.sent.length === 1,
     g.sent.length + ' requests');
  ok('  and the answer lands in the far box',
     outText(g) === '[vi] The first paragraph.', outText(g));
  ok('  named for what wrote it',
     /Google/.test(doc.getElementById('tr-msg').textContent),
     doc.getElementById('tr-msg').textContent);

  type(g, 'The first paragraph.\n\nAnd a second one.');
  await wait(700);
  ok('a paragraph each, in order', doc.querySelectorAll('.tr-para').length === 2,
     outText(g));

  /* --- copying and reading out ------------------------------------------- */
  click(w, doc.getElementById('tr-copy-in'));
  ok('the box you typed in has a copy of its own',
     g.copied[g.copied.length - 1] === 'The first paragraph.\n\nAnd a second one.',
     JSON.stringify(g.copied[g.copied.length - 1]));
  click(w, doc.getElementById('tr-copy-out'));
  ok('  and so does the answer',
     g.copied[g.copied.length - 1] === outText(g),
     JSON.stringify(g.copied[g.copied.length - 1]));

  // the stub notes the cancel that precedes every utterance; the words follow
  const said = () => w.spoken.filter(s => s !== '(cancel)');
  w.spoken.length = 0;
  click(w, doc.getElementById('tr-say-in'));
  ok('the English is read out in English', /@en/.test(said()[0] || ''), said()[0]);
  click(w, doc.getElementById('tr-say-out'));
  ok('  and the Vietnamese in Vietnamese', /@vi/.test(said()[1] || ''), said()[1]);

  /* --- the other way round ------------------------------------------------ */
  g.sent.length = 0;
  click(w, doc.getElementById('tr-swap'));
  await wait(700);
  ok('swapping turns the pair round',
     doc.getElementById('tr-from').textContent === 'Vietnamese' &&
     doc.getElementById('tr-to').textContent === 'English',
     doc.getElementById('tr-from').textContent + ' to ' + doc.getElementById('tr-to').textContent);
  ok('  and puts the answer in the box you type into',
     doc.getElementById('tr-in').value.startsWith('[vi] The first paragraph'),
     doc.getElementById('tr-in').value.slice(0, 40));
  ok('  the translator is asked the other way as well',
     g.sent.length > 0 && g.sent.every(x => x.sl === 'vi' && x.tl === 'en'),
     g.sent.map(x => x.sl + '-' + x.tl).join(', '));

  type(g, 'Một câu tiếng Việt.');
  await wait(700);
  ok('  Vietnamese in gives English out', outText(g) === '[en] Một câu tiếng Việt.',
     outText(g));

  /* --- the notebook is one selection away, where the answer is English ---- */
  w.getSelection = () => ({
    isCollapsed: false,
    toString: () => 'zenith',
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 60, top: 120, width: 40, bottom: 136 }) }),
  });
  doc.getElementById('tr-out').dispatchEvent(new w.Event('mouseup'));
  await wait(40);
  ok('selecting a word in an English answer looks it up in the notebook',
     (doc.querySelector('#lookup .picked') || {}).textContent === 'zenith',
     (doc.querySelector('#lookup .picked') || {}).textContent);

  /* --- clearing ----------------------------------------------------------- */
  click(w, doc.getElementById('tr-clear'));
  await wait(40);
  ok('the cross empties both boxes',
     doc.getElementById('tr-in').value === '' && !doc.querySelector('.tr-para'),
     doc.getElementById('tr-in').value);
  ok('  and takes the copy and the speaker with it, having nothing to give',
     doc.getElementById('tr-copy-out').hidden && doc.getElementById('tr-say-out').hidden);

  /* --- long enough to be cut up ------------------------------------------ */
  const back = mk();
  await wait(900);
  click(back.window, back.doc.getElementById('tab-translate'));
  await wait(40);
  // every sentence different: the translator's own cache would answer for a
  // repeated one and the test would be measuring the cache instead
  const long = Array.from({ length: 40 }, (_, i) =>
    'Sentence number ' + (i + 1) + ' is here to make this paragraph a long one.')
    .join(' ');
  type(back, long);
  await wait(900);
  ok('a paragraph too long for a URL is sent in pieces', back.sent.length > 1,
     back.sent.length + ' requests');
  ok('  none of them anywhere near the limit of one',
     back.sent.every(x => x.q.length <= 900), back.sent.map(x => x.q.length).join(', '));
  ok('  cut at the ends of sentences, not in the middle of words',
     back.sent.every(x => /[.!?]$/.test(x.q.trim())),
     back.sent.map(x => x.q.slice(-12)).join(' | '));
  ok('  and nothing of it is dropped on the way',
     back.sent.map(x => x.q.trim()).join(' ').replace(/\s+/g, ' ') === long,
     back.sent.map(x => x.q.length).join(' + ') + ' of ' + long.length);
  ok('  what comes back is one paragraph again, joined',
     back.doc.querySelectorAll('.tr-para').length === 1,
     back.doc.querySelectorAll('.tr-para').length + ' paragraphs');

  /* --- when Google will not answer --------------------------------------- */
  const fallback = mk({ googleDown: true });
  await wait(900);
  click(fallback.window, fallback.doc.getElementById('tab-translate'));
  await wait(40);
  type(fallback, 'Something to translate.');
  await wait(700);
  ok('with Google down the other translator answers',
     outText(fallback).startsWith('[mm]'), outText(fallback));
  ok('  and is named, so the reader knows what they are reading',
     /MyMemory/.test(fallback.doc.getElementById('tr-msg').textContent),
     fallback.doc.getElementById('tr-msg').textContent);

  /* --- when neither will ------------------------------------------------- */
  const dead = mk({ googleDown: true, memoryDown: true });
  await wait(900);
  click(dead.window, dead.doc.getElementById('tab-translate'));
  await wait(40);
  type(dead, 'Something to translate.');
  await wait(700);
  ok('with neither answering it says so',
     /Neither translator/.test(dead.doc.querySelector('.tr-para').textContent),
     dead.doc.querySelector('.tr-para').textContent.slice(0, 60));
  ok('  and hands the paragraph to Google Translate itself',
     (dead.doc.querySelector('.tr-para a.btn') || {}).href.includes('sl=en'),
     (dead.doc.querySelector('.tr-para a.btn') || {}).href);

  /* --- the copy that cannot reach a translator ---------------------------- */
  const art = boot({ html: read('engrowdict.html'), store: {} });
  await wait(700);
  ok('the artifact copy, which can reach nothing, does not offer the place',
     art.doc.getElementById('tab-translate').hidden);

  done(g.errs.concat(back.errs, fallback.errs, dead.errs, art.errs));
})();
