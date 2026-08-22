/* The Translate tab: paste English, read it back in Vietnamese.

   The passages tab carries what the notebook ships with; this carries whatever
   you have in front of you. Both translators take the text in the URL, so what
   matters here is that a long paragraph is cut up before it is sent and comes
   back joined, that a paragraph nobody will translate says so instead of
   sitting blank, and that the words in the result are still one selection away
   from the notebook. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');

/* Every request is answered; what came back is written down so the test can
   see how the text was cut up. */
function mk(opts) {
  opts = opts || {};
  const sent = [];
  const g = boot({
    html: shell, full: true, width: opts.width || 1400,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: url => {
      const u = String(url);
      if (u.includes('translate.googleapis.com')) {
        const q = decodeURIComponent(u.split('&q=')[1] || '');
        sent.push({ via: 'google', q });
        return opts.googleDown
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ ok: true,
              json: () => Promise.resolve([[['[vi] ' + q.slice(0, 40), q]]]) });
      }
      if (u.includes('mymemory')) {
        const q = decodeURIComponent(u.split('&q=')[1] || '');
        sent.push({ via: 'memory', q });
        return opts.memoryDown
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ ok: true, json: () => Promise.resolve({
              responseData: { translatedText: '[mm] ' + q.slice(0, 40) } }) });
      }
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(read('docs/data.json'))) });
    },
  });
  g.sent = sent;
  return g;
}

const paste = (g, text) => {
  const ta = g.doc.getElementById('tr-in');
  ta.value = text;
  ta.dispatchEvent(new g.window.Event('input'));
};

(async () => {
  const g = mk();
  await wait(900);
  const { doc, window: w } = g;

  /* --- getting there ----------------------------------------------------- */
  ok('the rail carries a Translate place', !doc.getElementById('tab-translate').hidden,
     doc.getElementById('tab-translate').textContent);
  click(w, doc.getElementById('tab-translate'));
  await wait(40);
  ok('  it opens on a box to paste into', !!doc.getElementById('tr-in'));
  ok('  the workspace is given over to it',
     doc.body.dataset.solo === 'on' && doc.getElementById('alpha').hidden !== false,
     doc.body.dataset.solo);
  ok('  and the search box stands down: there is nothing here to search',
     doc.querySelector('.search').hidden);
  ok('  the pane says what it is waiting for',
     (doc.querySelector('.tr-none') || {}).textContent === 'The Vietnamese appears here.');

  /* --- a paragraph at a time --------------------------------------------- */
  paste(g, 'The first paragraph.\n\nAnd a second one, under it.');
  click(w, doc.getElementById('tr-go'));
  await wait(300);
  const paras = [...doc.querySelectorAll('.tr-para')];
  ok('each paragraph comes back on its own', paras.length === 2, paras.length + ' paragraphs');
  ok('  the English stays above the Vietnamese, to be read against it',
     paras[0].querySelector('.en').textContent === 'The first paragraph.' &&
     paras[0].querySelector('.vi').textContent.startsWith('[vi] The first paragraph'),
     paras[0].textContent);
  ok('  and the second one with it',
     paras[1].querySelector('.vi').textContent.includes('second one'),
     paras[1].querySelector('.vi').textContent);
  ok('  it says who translated it, and to look twice',
     /Google Translate/.test(doc.getElementById('tr-msg').textContent) &&
     /twice/.test(doc.getElementById('tr-msg').textContent),
     doc.getElementById('tr-msg').textContent);
  ok('  and offers the Vietnamese for the clipboard',
     !doc.getElementById('tr-copy').hidden);

  /* --- long enough to be cut up ------------------------------------------ */
  // every sentence different: the translator's own cache would answer for a
  // repeated one and the test would be measuring the cache instead
  const long = Array.from({ length: 40 }, (_, i) =>
    'Sentence number ' + (i + 1) + ' is here to make this paragraph a long one.')
    .join(' ');                                       // about 2,900 characters
  g.sent.length = 0;
  paste(g, long);
  click(w, doc.getElementById('tr-go'));
  await wait(400);
  ok('a paragraph too long for a URL is sent in pieces', g.sent.length > 1,
     g.sent.length + ' requests');
  ok('  none of them anywhere near the limit of one',
     g.sent.every(x => x.q.length <= 900), g.sent.map(x => x.q.length).join(', '));
  ok('  cut at the ends of sentences, not in the middle of words',
     g.sent.every(x => /[.!?]$/.test(x.q.trim())), g.sent.map(x => x.q.slice(-12)).join(' | '));
  ok('  and nothing of it is dropped on the way',
     g.sent.map(x => x.q.trim()).join(' ').replace(/\s+/g, ' ') === long,
     g.sent.map(x => x.q.length).join(' + ') + ' of ' + long.length);
  ok('  what comes back is one paragraph again, joined',
     doc.querySelectorAll('.tr-para').length === 1,
     doc.querySelectorAll('.tr-para').length + ' paragraphs');

  /* --- when Google will not answer --------------------------------------- */
  const fallback = mk({ googleDown: true });
  await wait(900);
  click(fallback.window, fallback.doc.getElementById('tab-translate'));
  await wait(40);
  paste(fallback, 'Something to translate.');
  click(fallback.window, fallback.doc.getElementById('tr-go'));
  await wait(300);
  ok('with Google down the other translator answers',
     (fallback.doc.querySelector('.tr-para .vi') || {}).textContent.startsWith('[mm]'),
     (fallback.doc.querySelector('.tr-para .vi') || {}).textContent);
  ok('  and it is named, so the reader knows what they are reading',
     /MyMemory/.test(fallback.doc.getElementById('tr-msg').textContent),
     fallback.doc.getElementById('tr-msg').textContent);

  /* --- when neither will ------------------------------------------------- */
  const dead = mk({ googleDown: true, memoryDown: true });
  await wait(900);
  click(dead.window, dead.doc.getElementById('tab-translate'));
  await wait(40);
  paste(dead, 'Something to translate.');
  click(dead.window, dead.doc.getElementById('tr-go'));
  await wait(300);
  ok('with neither answering the paragraph says so',
     /Neither translator/.test(dead.doc.querySelector('.tr-para').textContent),
     dead.doc.querySelector('.tr-para').textContent.slice(0, 60));
  ok('  and hands the paragraph to Google Translate itself',
     (dead.doc.querySelector('.tr-para a.btn') || {}).href.includes('sl=en'),
     (dead.doc.querySelector('.tr-para a.btn') || {}).href);
  ok('  the English is still there to copy out of',
     dead.doc.querySelector('.tr-para .en').textContent === 'Something to translate.');

  /* --- the notebook is still one selection away -------------------------- */
  w.getSelection = () => ({
    isCollapsed: false,
    toString: () => 'zenith',
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 60, top: 120, width: 40, bottom: 136 }) }),
  });
  doc.getElementById('tr-out').dispatchEvent(new w.Event('mouseup'));
  await wait(40);
  ok('selecting a word in the result looks it up in the notebook',
     (doc.querySelector('#lookup .picked') || {}).textContent === 'zenith',
     (doc.querySelector('#lookup .picked') || {}).textContent);

  /* --- what it keeps ------------------------------------------------------ */
  click(w, doc.getElementById('tab-dictionary'));
  await wait(40);
  click(w, doc.getElementById('tab-translate'));
  await wait(40);
  ok('coming back to it, what was pasted is still there',
     doc.getElementById('tr-in').value === long,
     doc.getElementById('tr-in').value.slice(0, 30));
  click(w, doc.getElementById('tr-clear'));
  await wait(40);
  ok('Clear empties both sides',
     doc.getElementById('tr-in').value === '' && !doc.querySelector('.tr-para'));

  /* --- an empty press ----------------------------------------------------- */
  click(w, doc.getElementById('tr-go'));
  await wait(40);
  ok('pressing Translate with nothing pasted says so, and asks nobody',
     /Paste something first/.test(doc.getElementById('tr-msg').textContent),
     doc.getElementById('tr-msg').textContent);

  /* --- the copy that cannot reach a translator ---------------------------- */
  const art = boot({ html: read('engrowdict.html'), store: {} });
  await wait(700);
  ok('the artifact copy, which can reach nothing, does not offer the place',
     art.doc.getElementById('tab-translate').hidden);

  done(g.errs.concat(fallback.errs, dead.errs, art.errs));
})();
