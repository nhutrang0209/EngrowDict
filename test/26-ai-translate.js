/* A passage put into Vietnamese by the model, beside the English it belongs to.

   Not the machine translation the selection card falls back on — that is for a
   phrase nobody wrote a gloss for. This is the whole passage, asked for from
   the menu, read paragraph beside paragraph, with a rule between the two
   columns that can be dragged. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, boot, ok, done, wait, click, unlockedStore,
        appsScriptSandbox } = require('./helpers');

const shell = read('docs/index.html');
const LIST_KEY = 'engrowdict:list:v1';
const CFG = {
  sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC/edit',
  webApp: 'https://script.google.com/macros/s/XYZ/exec',
  key: 'a-secret-key',
};

function page(store, posts, reply, mt) {
  const g = boot({
    html: shell, full: true, store, width: 1500,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    dataFile: 'docs/data.json',
  });
  const realFetch = g.window.fetch;
  g.window.fetch = (url, opts) => {
    /* The translator the card falls back on, answered here when a test says
       what it should say: a word in, a Vietnamese rendering out. */
    if (mt && String(url).indexOf('translate.googleapis.com') > -1) {
      const q = decodeURIComponent((String(url).match(/[?&]q=([^&]*)/) || [])[1] || '');
      const said = mt(q) || 'không có ở đây';
      return Promise.resolve({ ok: true, json: () => Promise.resolve([[[said, q]]]) });
    }
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push({ url, body });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply(body)) });
    }
    return realFetch(url, opts);
  };
  return g;
}

const openMenu = g => {
  const wrap = g.doc.querySelector('.read .entry-nav .menu-wrap');
  if (wrap) click(g.window, wrap.querySelector('.iconbtn'));
  return wrap;
};

(async () => {
  const posts = [];
  /* One Vietnamese line back for every English line sent, which is what a
     translator does. The stub used to answer three lines whatever it was
     asked, and the day a fourth line was added to the first batch — the
     title — that told us nothing about where the fourth answer went. */
  const VI = ['Đoạn một.', 'Đoạn hai.', 'Đoạn ba.', 'Đoạn bốn.', 'Đoạn năm.'];
  let answer = (body) => ({ ok: true, by: 'Gemini',
    paras: (body.paras || []).map((_, i) => VI[i] || 'Đoạn nữa.') });
  const a = page(unlockedStore(CFG), posts, (body) => answer(body));
  await wait(900);
  const { doc, window: w } = a;

  click(w, doc.getElementById('tab-passages'));
  await wait(40);
  click(w, doc.querySelector('.hit'));
  await wait(60);
  const paras = doc.querySelectorAll('.read .prose p, .read .prose h2').length;
  ok('a passage is open', paras > 1, paras + ' paragraphs');

  /* --- asking for it ------------------------------------------------------ */
  openMenu(a);
  ok('the menu offers to have it translated', !!doc.getElementById('passage-ai'),
     [...doc.querySelectorAll('.read .menu-item')].map(b => b.textContent).join(', '));

  click(w, doc.getElementById('passage-ai'));
  ok('  it opens a column beside the passage, not under it',
     !!doc.querySelector('.readsplit .read') && !!doc.querySelector('.readsplit .aipane'),
     doc.querySelector('.readsplit') && doc.querySelector('.readsplit').className);
  ok('  and the pane gives the pair the whole width, margin and all',
     doc.getElementById('detail-inner').className === 'detail-inner wide split' &&
     /\.detail-inner\.split \{ max-width: none/.test(read('app.css')),
     doc.getElementById('detail-inner').className);
  ok('  the English is given a header of its own, the twin of the Vietnamese one',
     !!doc.querySelector('.readsplit .read .read-head') &&
     doc.querySelector('.readsplit .read .read-head .ai-title').textContent === 'English' &&
     !!doc.querySelector('.readsplit .read .read-head .menu-wrap'),
     doc.querySelector('.readsplit .read .read-head')
       && doc.querySelector('.readsplit .read .read-head').textContent);
  ok('    so both columns begin at the same height', (() => {
    const css = read('app.css');
    const head = css.slice(css.indexOf('.read-head.entry-nav {'),
                           css.indexOf('.read-head.entry-nav {') + 420);
    const ai = css.slice(css.indexOf('.ai-head {'), css.indexOf('.ai-head {') + 200);
    const pad = t => (t.match(/padding[^;]*10px/) || [])[0];
    return !!pad(head) && !!pad(ai) && /min-height: 30px/.test(head) &&
      /min-height: 30px/.test(ai) && /position: sticky/.test(head);
  })(), 'headers matched');
  ok('  and says it is working on it',
     /translating/.test(doc.getElementById('ai-by').textContent),
     doc.getElementById('ai-by').textContent);

  await wait(300);
  const sent = posts.find(p => p.body.action === 'aitranslate');
  ok('the passage is sent to the sheet to be translated', !!sent,
     posts.map(p => p.body.action).join(', '));
  // a lettered passage carries its A/B/C inside the paragraph; the letter is a
  // label, not part of the text, and is not sent
  const firstNode = doc.querySelector('.read .prose p, .read .prose h2');
  const label = firstNode.querySelector('.pmark');
  const firstEnglish = (label
    ? firstNode.textContent.slice(label.textContent.length)
    : firstNode.textContent).trim();
  const title = doc.querySelector('.read h1').textContent;
  ok('  led by the title, which is a line of English like any other',
     !!sent && sent.body.paras[0] === title && sent.body.paras[1] === firstEnglish,
     sent && JSON.stringify(sent.body.paras.slice(0, 2)));
  ok('  so it costs no extra call, and the sheet needs to know nothing new',
     !!sent && sent.body.paras.length <= 4 && sent.body.action === 'aitranslate',
     sent && sent.body.paras.length + ' in the first ask');
  ok('  and every paragraph of it in the end, in order', (() => {
    const all = posts.filter(p => p.body.action === 'aitranslate')
      .reduce((list, p) => list.concat(p.body.paras), []);
    return all.length === paras + 1 && all[0] === title && all[1] === firstEnglish;
  })(), posts.filter(p => p.body.action === 'aitranslate').length + ' asks for '
     + paras + ' paragraphs and a title');

  const said = [...doc.querySelectorAll('.ai-para .vi')].map(n => n.textContent);
  ok('what comes back is read down the right', said[0] === 'Đoạn hai.' &&
     said[1] === 'Đoạn ba.', said.slice(0, 2).join(' | '));
  ok('  under the name of the passage in Vietnamese, over the column it heads',
     (doc.querySelector('.ai-h1') || {}).textContent === 'Đoạn một.' &&
     doc.querySelector('.ai-body').firstChild.className === 'ai-h1',
     (doc.querySelector('.ai-h1') || {}).textContent);
  ok('    set the same way as the English title it translates, by one rule', (() => {
    const css = read('app.css');
    /* One rule for both, so they cannot drift apart again — which is how the
       English came to be 38px over half a column while this read as a caption
       under it. */
    const both = css.match(/\.ai-h1,\s*\.readsplit \.read h1 \{([^}]*)\}/);
    if (!both) return false;
    const solo = css.match(/(?<!split )\.read h1 \{([^}]*)\}/);
    return /font-size: 22px/.test(both[1]) && /var\(--serif\)/.test(both[1]) &&
      // and the passage read on its own keeps the big opening line
      !!solo && /clamp\(/.test(solo[1]);
  })(), 'one rule for both, and the single column keeps its own');
  ok('    and it is not one of the paragraphs, which are numbered against the English',
     doc.querySelectorAll('.ai-para').length === paras &&
     !doc.querySelector('.ai-h1').classList.contains('ai-para'),
     doc.querySelectorAll('.ai-para').length + ' paragraphs against ' + paras);
  ok('  one line to a paragraph, level with the English',
     said.length === paras, said.length + ' against ' + paras);
  ok('  and it says who translated it', /Gemini/.test(doc.getElementById('ai-by').textContent),
     doc.getElementById('ai-by').textContent);

  /* --- the rule between them ---------------------------------------------- */
  const root = doc.documentElement;
  const widthNow = () => root.style.getPropertyValue('--ai-w');
  ok('the column starts at a readable width', widthNow() === '420px', widthNow());
  const bar = doc.getElementById('ai-split');
  ok('  with a rule between the two that says it is one',
     !!bar && bar.getAttribute('role') === 'separator');
  bar.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  ok('  dragged, or nudged by the arrow keys, it gives the Vietnamese more room',
     widthNow() === '444px', widthNow());
  ok('    and the width is remembered', JSON.parse(a.store[LIST_KEY]).ai === 444,
     a.store[LIST_KEY]);
  bar.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  ok('  and back the other way', widthNow() === '420px', widthNow());

  /* --- reading them together ---------------------------------------------- */
  ok('the passage keeps its button where it can be reached',
     read('app.css').indexOf('.read .entry-nav {') > -1 &&
     /position: sticky/.test(read('app.css').slice(read('app.css').indexOf('.read .entry-nav {'), read('app.css').indexOf('.read .entry-nav {') + 90)),
     'sticky');

  // jsdom lays nothing out, so both scrollers are given a height to have
  const detail = doc.querySelector('.detail');
  const aiBody = doc.getElementById('ai-body');
  const stub = (node, full, seen) => {
    Object.defineProperty(node, 'scrollHeight', { value: full, configurable: true });
    Object.defineProperty(node, 'clientHeight', { value: seen, configurable: true });
  };
  stub(detail, 4000, 800);            // 3200 of room
  stub(aiBody, 2600, 600);            // 2000 of room
  detail.scrollTop = 800;             // a quarter of the way down the English
  detail.dispatchEvent(new w.Event('scroll'));
  ok('scrolling the English brings the Vietnamese with it, by the same fraction',
     aiBody.scrollTop === 500, aiBody.scrollTop + ' of 2000, against 800 of 3200');

  detail.scrollTop = 3200;
  detail.dispatchEvent(new w.Event('scroll'));
  ok('  the end of one is the end of the other', aiBody.scrollTop === 2000,
     String(aiBody.scrollTop));

  /* --- and by the paragraph, where there is a layout to measure ----------- */
  // the same paragraphs, set at different heights in the two columns: the
  // Vietnamese runs longer, which is why the same fraction down lands in the
  // wrong place and the paragraph itself has to be found
  const rect = (node, top, height) => {
    node.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 0 });
  };
  const ens = [...doc.querySelectorAll('.readsplit .read .prose > *')];
  const vis = [...aiBody.querySelectorAll('.ai-para')];
  detail.getBoundingClientRect = () => ({ top: 100, bottom: 900, height: 800, left: 0, right: 0 });
  aiBody.getBoundingClientRect = () => ({ top: 100, bottom: 700, height: 600, left: 0, right: 0 });
  aiBody.scrollTop = 0;
  // English: paragraph 0 well above, paragraph 1 straddling the top edge
  ens.forEach((n, i) => rect(n, i === 0 ? -400 : 60 + (i - 1) * 300, i === 0 ? 460 : 300));
  // Vietnamese, taller: paragraph 1 starts 700 below the top of its box
  vis.forEach((n, i) => rect(n, 100 + (i === 0 ? 0 : 700 + (i - 1) * 420),
                            i === 0 ? 700 : 420));
  detail.scrollTop = 900;
  detail.dispatchEvent(new w.Event('scroll'));
  // paragraph 1 stands 40px above the top edge of a 300px paragraph, so the
  // reader is an eighth into it: 700 + 0.1333 * 420
  ok('the paragraph at the top of the English is put at the top of the Vietnamese',
     aiBody.scrollTop === 756, aiBody.scrollTop + ', wanted 756');
  ok('  carrying how far into that paragraph the reader is', (() => {
    // a fifth of the way through the English paragraph: 700 + 0.2 * 420 = 784
    aiBody.scrollTop = 0;
    ens.forEach((n, i) => rect(n, i === 0 ? -400 : 40 + (i - 1) * 300, i === 0 ? 460 : 300));
    detail.dispatchEvent(new w.Event('scroll'));
    return aiBody.scrollTop === 784;
  })(), aiBody.scrollTop + ', wanted 784');

  /* --- and the two titles stand at the top together ------------------------
     The passage opens with its name over the English and its name in
     Vietnamese over the translation. Pairing paragraph for paragraph put A at
     the top of the Vietnamese while A was still below the fold in the English,
     which pushed the Vietnamese title off the top of its own column — and a
     reader who scrolled nowhere saw no translated title at all and reported
     the feature missing. */
  const viTitle = doc.querySelector('.ai-h1');
  ok('the Vietnamese column is headed by the name of the passage', !!viTitle,
     viTitle && viTitle.textContent);
  rect(viTitle, 100, 90);                  // 90px of heading above paragraph A
  // English at its very top: its own heading fills 260px before paragraph A
  ens.forEach((n, i) => rect(n, 100 + 260 + i * 300, 300));
  vis.forEach((n, i) => rect(n, 100 + 90 + i * 420, 420));
  detail.scrollTop = 0;
  aiBody.scrollTop = 0;
  detail.dispatchEvent(new w.Event('scroll'));
  ok('  at the top of the English, the Vietnamese is at the top of its own',
     aiBody.scrollTop === 0, aiBody.scrollTop + ', wanted 0 — the title in view');

  /* Half way through the English heading is half way through the Vietnamese
     one. The rectangles here are fixed rather than moving with the scroll the
     way a browser's do, so the Vietnamese is wound back to nothing before each
     measurement — the same thing the paragraph cases above do. */
  aiBody.scrollTop = 0;
  ens.forEach((n, i) => rect(n, 100 + 130 + i * 300, 300));
  detail.scrollTop = 130;
  detail.dispatchEvent(new w.Event('scroll'));
  ok('  and through the headings together, neither one jumping',
     aiBody.scrollTop === 45, aiBody.scrollTop + ', wanted 45 — half of 90');

  // paragraph A reaches the top of one column as it reaches the top of the other
  aiBody.scrollTop = 0;
  ens.forEach((n, i) => rect(n, 100 + i * 300, 300));
  detail.scrollTop = 260;
  detail.dispatchEvent(new w.Event('scroll'));
  ok('  and A tops both columns at the same moment',
     aiBody.scrollTop === 90, aiBody.scrollTop + ', wanted 90');
  delete viTitle.getBoundingClientRect;

  ens.forEach(n => { delete n.getBoundingClientRect; });
  vis.forEach(n => { delete n.getBoundingClientRect; });
  delete detail.getBoundingClientRect;
  delete aiBody.getBoundingClientRect;

  const englishAt = detail.scrollTop;
  aiBody.scrollTop = 40;
  aiBody.dispatchEvent(new w.Event('scroll'));
  ok('  but reading ahead in the translation leaves the English where it was',
     detail.scrollTop === englishAt && aiBody.scrollTop === 40,
     detail.scrollTop + ' / ' + aiBody.scrollTop);
  detail.scrollTop = 0;
  detail.dispatchEvent(new w.Event('scroll'));

  /* --- picking a sentence out on one side, and finding it on the other ----
     Sentence for sentence where both sides count the same, and spread across
     the difference where they do not. What must never happen is the thing a
     reader complained of: half a line selected, the whole paragraph lit. */
  posts.length = 0;
  const FOUR = 'Câu một. Câu hai. Câu ba. Câu bốn.';
  answer = (body) => ({ ok: true, by: 'Gemini',
    paras: (body.paras || []).map(() => FOUR) });
  click(w, doc.getElementById('ai-again'));
  await wait(1200);

  /* every batch that lands redraws the pane, so nothing here is held on to */
  const viParas = () => [...doc.querySelectorAll('#ai-body .ai-para')];
  const eng = () => [...doc.querySelectorAll('.readsplit .read .prose > *')];

  ok('the Vietnamese is laid down a sentence at a time',
     viParas()[0].querySelectorAll('.vs').length === 4 &&
     viParas()[0].querySelector('.vi').textContent === FOUR,
     viParas()[0].querySelectorAll('.vs').length + ' spans');

  // the paragraph's own text, without the A/B/C label in front of it
  const ownText = (node) => {
    const mark = node.querySelector('.pmark');
    const t = node.textContent;
    return mark ? t.slice(mark.textContent.length) : t;
  };
  // a range over characters [a, b) of that text, walking past the label
  const pickChars = (node, a, b) => {
    const mark = node.querySelector('.pmark');
    const walk = doc.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
    const range = doc.createRange();
    let seen = 0, set = false, t;
    while ((t = walk.nextNode())) {
      if (mark && mark.contains(t)) continue;
      const len = t.textContent.length;
      if (!set && seen + len >= a) { range.setStart(t, a - seen); set = true; }
      if (seen + len >= b) { range.setEnd(t, b - seen); break; }
      seen += len;
    }
    w.getSelection().removeAllRanges();
    w.getSelection().addRange(range);
    node.dispatchEvent(new w.Event('mouseup', { bubbles: true }));
  };
  const litIn = (i) => [...viParas()[i].querySelectorAll('.vs')]
    .map((n, k) => (n.classList.contains('lit') ? k : -1)).filter(k => k > -1);
  const anyLit = () => viParas().reduce((n, _, i) => n + litIn(i).length, 0);

  const first = ownText(eng()[0]);
  const stop = first.indexOf('. ') + 1;
  ok('  the passage opens with more than one sentence, so there is something to tell apart',
     stop > 0 && stop < first.length - 1, 'first stop at ' + stop + ' of ' + first.length);

  /* Which spans exactly depends on how the two sides divide up: four
     Vietnamese sentences against three English ones means the first English
     one covers more than one of them. What must hold whatever the passage is:
     the opening is lit, the end is not, and it is not the whole paragraph. */
  pickChars(eng()[0], 0, Math.max(4, Math.floor(stop / 2)));
  await wait(40);
  ok('half of the opening sentence lights the opening, not the whole paragraph',
     litIn(0)[0] === 0 && litIn(0).indexOf(3) === -1 && litIn(0).length < 4,
     litIn(0).join() || 'none');

  pickChars(eng()[0], 0, first.length);
  await wait(40);
  ok('  and the whole paragraph does light the whole paragraph',
     litIn(0).join() === '0,1,2,3', litIn(0).join() || 'none');

  pickChars(eng()[0], first.length - 20, first.length);
  await wait(40);
  ok('  a few words at the end light the end, and leave the opening alone',
     litIn(0).length > 0 && litIn(0).indexOf(0) === -1,
     litIn(0).join() || 'none');

  const pick = (from, to) => {
    const range = doc.createRange();
    range.setStart(from.firstChild || from, 0);
    const end = to || from;
    range.setEnd(end.lastChild || end, (end.lastChild || end).length || 0);
    w.getSelection().removeAllRanges();
    w.getSelection().addRange(range);
    from.dispatchEvent(new w.Event('mouseup', { bubbles: true }));
  };
  const litParas = () => viParas()
    .map((n, i) => (n.classList.contains('lit') ? i : -1)).filter(i => i > -1);

  pick(eng()[1]);
  await wait(40);
  ok('a selection is followed from one paragraph to the next',
     litParas().join() === '1', litParas().join() || 'none');

  pick(eng()[0], eng()[2]);
  await wait(40);
  ok('  one across three paragraphs lights all three, whole',
     litParas().join() === '0,1,2' && litIn(1).join() === '0,1,2,3',
     litParas().join() + ' / middle ' + litIn(1).join());

  w.getSelection().removeAllRanges();
  eng()[1].dispatchEvent(new w.Event('mouseup', { bubbles: true }));
  await wait(40);
  ok('  and letting the selection go puts the Vietnamese back as it was',
     anyLit() === 0 && litParas().length === 0, anyLit() + ' still lit');

  ok('what is lit is washed behind the words, not dressed up as a selection', (() => {
    const css = read('app.css');
    const rule = css.slice(css.indexOf('.ai-para .vs {'), css.indexOf('.ai-para .vs {') + 300);
    return /box-decoration-break: clone/.test(rule) &&
      /\.ai-para \.vs\.lit \{ background: var\(--lit\)/.test(css) &&
      /^\s*--lit:/m.test(css) && css.match(/^\s*--lit:/gm).length === 3;
  })(), 'washed, and a colour of its own in every theme');

  /* --- the very words, and the right sentence however the model divides ----
     A reader selected "determined", at the end of a run-on English sentence
     about Binet, and the Vietnamese of that sentence's opening clause lit up.
     The model does not spread a difference evenly over a paragraph: it broke
     that one long sentence in two, and ran two short ones together further
     on. Pairing by sentence index smeared the reader's word onto the wrong
     sentence — and when the break and the join cancelled out, the two sides
     counted the same and the index was trusted outright, one sentence out
     all the way down. And a sentence was the finest the wash could go, when
     what was wanted was the two words "xác định".

     The English is whatever the sheet published, split by the page's own
     rule — taken from app.js rather than written again here, since a second
     rule that disagrees with the first builds the wrong Vietnamese to test
     against. The Vietnamese is made-up words, so no gloss in the notebook can
     match it by accident, each sentence about the length of what it stands
     for. The translator is told what to say. */
  const appSentences = (() => {
    const src = read('app.js');
    const grab = (name) => {
      const at = src.indexOf('function ' + name + '(');
      let depth = 0;
      for (let j = src.indexOf('{', at); j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
      }
      return '';
    };
    const lineOf = (needle) => {
      const at = src.indexOf(needle);
      return src.slice(at, src.indexOf('\n', at));
    };
    return new Function(lineOf('var NOT_END') + '\n' + grab('lower') + '\n' +
      grab('sentences') + '\nreturn sentences;')();
  })();
  const CAPS = ['Zanh', 'Zbnh', 'Zcnh', 'Zdnh', 'Zenh', 'Zfnh', 'Zgnh', 'Zhnh', 'Zinh', 'Zknh'];
  const viSentence = (cap, len, tail) => {
    let t = cap;
    while (t.length < len - 1 - (tail ? tail.length + 1 : 0)) t += ' zamô';
    return t + (tail ? ' ' + tail : '') + '.';
  };
  const lateWords = (text) => {
    const out = [];
    const re = /[A-Za-z]{6,}/g;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > text.length * 0.6) out.push({ w: m[0], at: m.index });
    }
    return out.reverse();                     // the latest first
  };
  const midWordOf = (text, cut) => {
    const re = /[A-Za-z]{4,}/g;
    const seg = text.slice(cut.from, cut.to);
    const hits = [];
    let m;
    while ((m = re.exec(seg))) hits.push({ w: m[0], at: cut.from + m.index });
    return hits[Math.floor(hits.length / 2)];
  };
  const lens = (cuts) => cuts.map(c => c.to - c.from);

  /* The two ways the model divides differently, each built from an English
     paragraph as it stands. A break alone: the opening sentence in two, the
     rest whole — one more Vietnamese sentence than English. A break and a
     join: the opening in two and the last two run together — the same count
     on both sides, which is the case that was trusted and should not be. */
  const breakOnly = (cuts, tail) => {
    const n = lens(cuts);
    const v = [Math.ceil(n[0] / 2), Math.floor(n[0] / 2)].concat(n.slice(1));
    return v.map((x, i) => viSentence(CAPS[i % CAPS.length], Math.max(12, x),
      i === v.length - 1 ? tail : '')).join(' ');
  };
  const breakAndJoin = (cuts) => {
    const n = lens(cuts);
    const v = [Math.ceil(n[0] / 2), Math.floor(n[0] / 2)]
      .concat(n.slice(1, -2), [n[n.length - 2] + n[n.length - 1] + 1]);
    return v.map((x, i) => viSentence(CAPS[i % CAPS.length], Math.max(12, x), '')).join(' ');
  };

  const viFor = {};                            // English paragraph -> its Vietnamese
  let target = '', inside = '';
  const postsP = [];
  const ph = page(unlockedStore(CFG), postsP, (body) => ({
    ok: true, by: 'Gemini',
    paras: (body.paras || []).map(en => viFor[en] || 'Câu. Câu nữa.'),
  }), (q) => {
    const w = q.toLowerCase();
    if (w === target) return 'tớiđích';
    if (w === inside) return 'đích';          // a whole word, found only inside one
    return 'không có ở đây';
  });
  await wait(900);
  click(ph.window, ph.doc.getElementById('tab-passages'));
  await wait(40);
  click(ph.window, ph.doc.querySelector('.hit'));
  await wait(60);

  const engP = () => [...ph.doc.querySelectorAll('.read .prose > *')];
  const own = (node) => {
    const mark = node.querySelector('.pmark');
    return mark ? node.textContent.slice(mark.textContent.length) : node.textContent;
  };

  /* Built from the English as it is on screen, before the translation is
     asked for, so the two sides line up the way a real answer would. */
  const en0 = own(engP()[0]);
  const cuts0 = appSentences(en0);
  ok('the English opening has more than one sentence to build a Vietnamese from',
     cuts0.length >= 2, cuts0.length + ' sentences');
  viFor[en0] = breakOnly(cuts0, 'tớiđích zamu');

  // a later paragraph long enough for a break and a join both
  const joinAt = engP().findIndex((n, i) => i > 0 && appSentences(own(n)).length >= 4);
  const enJ = joinAt > -1 ? own(engP()[joinAt]) : '';
  const cutsJ = joinAt > -1 ? appSentences(enJ) : [];
  if (joinAt > -1) viFor[enJ] = breakAndJoin(cutsJ);
  ok('  and a later paragraph long enough to break one sentence and join two',
     joinAt > 0, joinAt > 0 ? 'paragraph ' + joinAt + ', ' + cutsJ.length + ' sentences'
       : 'none in this passage');

  openMenu(ph);
  click(ph.window, ph.doc.getElementById('passage-ai'));
  await wait(1500);

  const viP = () => [...ph.doc.querySelectorAll('#ai-body .ai-para')];
  const selectChars = (node, a0, b0) => {
    const mark = node.querySelector('.pmark');
    const walk = ph.doc.createTreeWalker(node, 4);
    const range = ph.doc.createRange();
    let seen = 0, set = false, t;
    while ((t = walk.nextNode())) {
      if (mark && mark.contains(t)) continue;
      const len = t.textContent.length;
      if (!set && seen + len >= a0) { range.setStart(t, a0 - seen); set = true; }
      if (seen + len >= b0) { range.setEnd(t, b0 - seen); break; }
      seen += len;
    }
    ph.window.getSelection().removeAllRanges();
    ph.window.getSelection().addRange(range);
    node.dispatchEvent(new ph.window.Event('mouseup', { bubbles: true }));
  };
  const litVs = (i) => [...viP()[i].querySelectorAll('.vs')]
    .map((n, k) => (n.classList.contains('lit') ? k : -1)).filter(k => k > -1);
  const phrase = () => viP()[0].querySelector('.vp');
  /* English sentence k is Vietnamese sentence k + 1 once the opening one has
     been broken in two. */
  const brokenOpening = (cuts, at) => {
    let k = 0;
    while (k < cuts.length - 1 && at >= cuts[k].to) k++;
    if (k > 0) return k + 1;
    return at < (cuts[0].from + cuts[0].to) / 2 ? 0 : 1;
  };

  ok('the Vietnamese came back one sentence longer than the English, as the model breaks them',
     (viP()[0].querySelector('.vi') || {}).textContent === viFor[en0] &&
     viP()[0].querySelectorAll('.vs').length === cuts0.length + 1,
     viP()[0].querySelectorAll('.vs').length + ' Vietnamese against ' + cuts0.length + ' English');

  /* A word in the middle of the second English sentence. It is the third
     Vietnamese one, since the first English sentence became two. */
  const mid0 = midWordOf(en0, cuts0[1]);
  selectChars(engP()[0], mid0.at, mid0.at + mid0.w.length);
  await wait(150);
  ok('a word in the second English sentence lights the third Vietnamese one, and only that',
     litVs(0).join() === '2',
     JSON.stringify(mid0.w) + ' lit ' + (litVs(0).join() || 'nothing') + ', wanted 2');

  if (joinAt > 0) {
    ok('  a break and a join come out the same count on both sides',
       viP()[joinAt].querySelectorAll('.vs').length === cutsJ.length,
       viP()[joinAt].querySelectorAll('.vs').length + ' against ' + cutsJ.length);
    const midJ = midWordOf(enJ, cutsJ[1]);
    selectChars(engP()[joinAt], midJ.at, midJ.at + midJ.w.length);
    await wait(150);
    ok('    and that count is not trusted: the word still lights the sentence it is in',
       litVs(joinAt).join() === '2',
       JSON.stringify(midJ.w) + ' lit ' + (litVs(joinAt).join() || 'nothing')
         + ', wanted 2 — pairing by index says 1');
  }

  const words = lateWords(en0);
  ok('  the English opening has words late in it to select', words.length >= 3,
     words.slice(0, 3).map(x => x.w).join(', '));
  target = words[0].w.toLowerCase();
  inside = words[2].w.toLowerCase();

  /* a word whose Vietnamese is not in the paragraph: the sentence stays lit,
     and it is the sentence the word is in, not that one and the one before */
  selectChars(engP()[0], words[1].at, words[1].at + words[1].w.length);
  await wait(150);
  ok('a word late in a paragraph lights the one Vietnamese sentence it is in',
     litVs(0).join() === String(brokenOpening(cuts0, words[1].at)) && !phrase(),
     litVs(0).join() + ', wanted ' + brokenOpening(cuts0, words[1].at)
       + (phrase() ? ' and no phrase' : ''));

  /* a word whose Vietnamese is there: those words, and not the sentence */
  const vtext = viP()[0].querySelector('.vi').textContent;
  selectChars(engP()[0], words[0].at, words[0].at + words[0].w.length);
  await wait(150);
  ok('a word whose Vietnamese is in the paragraph lights those very words',
     !!phrase() && phrase().textContent === 'tớiđích',
     phrase() ? phrase().textContent : 'nothing narrower than a sentence');
  ok('  and the sentence around them steps back', litVs(0).length === 0, litVs(0).join());
  ok('  with the Vietnamese itself left exactly as it was',
     viP()[0].querySelector('.vi').textContent === vtext, 'text intact');

  /* "đích" is a whole Vietnamese word, and here it is only the end of a longer
     made-up one: that is not a match, and the sentence stands in for it */
  selectChars(engP()[0], words[2].at, words[2].at + words[2].w.length);
  await wait(150);
  ok('  a rendering found only inside a longer word is not taken for it',
     !phrase() && litVs(0).length === 1, phrase() ? phrase().textContent : litVs(0).join());

  ph.window.getSelection().removeAllRanges();
  engP()[0].dispatchEvent(new ph.window.Event('mouseup', { bubbles: true }));
  await wait(60);
  ok('letting the selection go takes the words out of the wash again',
     !phrase() && litVs(0).length === 0 &&
     [...viP()[0].querySelectorAll('.vs')].every(n => n.childNodes.length === 1),
     'sentences whole');

  ok('the very words wear the same wash as a sentence',
     /\.ai-para \.vp \{[^}]*background: var\(--lit\)/.test(read('app.css')),
     'one wash');

  /* --- asking again, and closing ------------------------------------------ */
  posts.length = 0;
  answer = (body) => ({ ok: true, by: 'Gemini',
    paras: (body.paras || []).map((_, i) => i === 0 ? 'Lần hai.' : 'Nữa.') });
  click(w, doc.getElementById('ai-again'));
  await wait(300);
  ok('it can be asked again', posts.some(p => p.body.action === 'aitranslate') &&
     doc.querySelector('.ai-para .vi').textContent === 'Nữa.',
     doc.querySelector('.ai-para .vi').textContent);
  ok('  the title with it, rather than the old one left standing over new prose',
     doc.querySelector('.ai-h1').textContent === 'Lần hai.',
     doc.querySelector('.ai-h1').textContent);

  click(w, doc.getElementById('ai-close'));
  ok('closing it gives the passage its measure back',
     !doc.querySelector('.aipane') && !!doc.querySelector('.read .prose') &&
     doc.getElementById('detail-inner').className === 'detail-inner wide',
     doc.getElementById('detail-inner').className);

  /* --- what it keeps ------------------------------------------------------ */
  const AI_STORE = 'engrowdict:aitr:v1';
  ok('the translation is kept, so coming back does not mean asking again',
     !!JSON.parse(a.store[AI_STORE] || '{}')['r0'],
     Object.keys(JSON.parse(a.store[AI_STORE] || '{}')).join(', '));

  // the pane was closed a moment ago, which is remembered too; open it again
  openMenu(a);
  click(w, doc.getElementById('passage-ai'));
  await wait(60);
  posts.length = 0;
  click(w, doc.getElementById('tab-dictionary'));
  await wait(40);
  click(w, doc.getElementById('tab-passages'));
  await wait(40);
  click(w, doc.querySelector('.hit'));
  await wait(80);
  ok('  a trip to another tab and back puts it straight back up',
     !!doc.querySelector('.aipane') &&
     !!doc.querySelector('.ai-para .vi').textContent,
     doc.querySelector('.ai-para .vi') && doc.querySelector('.ai-para .vi').textContent);
  ok('    without asking the model a second time',
     !posts.some(p => p.body.action === 'aitranslate'),
     posts.map(p => p.body.action).join(', ') || 'nothing asked');

  click(w, doc.getElementById('ai-close'));
  await wait(40);
  click(w, doc.getElementById('tab-dictionary'));
  await wait(40);
  click(w, doc.getElementById('tab-passages'));
  await wait(40);
  click(w, doc.querySelector('.hit'));
  await wait(80);
  ok('  but one closed on purpose stays closed', !doc.querySelector('.aipane'));
  openMenu(a);
  click(w, doc.getElementById('passage-ai'));
  await wait(40);
  ok('    and opens again from what was kept, still without asking',
     !!doc.querySelector('.aipane') &&
     !posts.some(p => p.body.action === 'aitranslate'),
     posts.map(p => p.body.action).join(', ') || 'nothing asked');

  /* --- a passage translated before there were titles ----------------------
     Folding the title into the stamp that decides whether a kept translation
     is still good would have thrown away every passage already paid for, on
     the day this page learned to translate titles at all. The paragraphs of
     those are perfectly good. Only the one line is asked for. */
  const older = JSON.parse(a.store[AI_STORE]);
  const paraCount = older.r0.paras.length;
  delete older.r0.title;
  delete older.r0.en;
  older.r0.shut = true;
  a.store[AI_STORE] = JSON.stringify(older);

  posts.length = 0;
  answer = (body) => ({ ok: true, by: 'Gemini',
    paras: (body.paras || []).map(() => 'Tên bài dịch muộn.') });
  openMenu(a);
  click(w, doc.getElementById('passage-ai'));
  await wait(200);
  const asked = posts.filter(p => p.body.action === 'aitranslate');
  ok('a passage kept from before titles asks for the title alone',
     asked.length === 1 && asked[0].body.paras.length === 1 &&
     asked[0].body.paras[0] === title,
     asked.length + ' asks, ' + JSON.stringify(asked.map(x => x.body.paras.length)));
  ok('  and the paragraphs already paid for are not asked for again',
     doc.querySelectorAll('.ai-para').length === paraCount &&
     doc.querySelector('.ai-para .vi').textContent !== 'Tên bài dịch muộn.',
     doc.querySelectorAll('.ai-para').length + ' paragraphs, first reads '
       + doc.querySelector('.ai-para .vi').textContent);
  ok('  the title then stands over the column with them',
     (doc.querySelector('.ai-h1') || {}).textContent === 'Tên bài dịch muộn.',
     (doc.querySelector('.ai-h1') || {}).textContent);
  ok('    and is kept, so the next visit does not ask even for that',
     JSON.parse(a.store[AI_STORE]).r0.title === 'Tên bài dịch muộn.' &&
     JSON.parse(a.store[AI_STORE]).r0.en === title,
     JSON.stringify(JSON.parse(a.store[AI_STORE]).r0.title));

  /* Most translations are seen again by opening the passage from the list
     rather than from the menu, and in a later session at that — the pane is
     built back out of the store, by a different door into the same room. A
     heading still owing has to be fetched at both. */
  const before = JSON.parse(a.store[AI_STORE]);
  delete before.r0.title;
  delete before.r0.en;
  before.r0.shut = false;
  const laterStore = Object.assign({}, a.store, { [AI_STORE]: JSON.stringify(before) });
  const postsLater = [];
  const later = page(laterStore, postsLater, (body) => ({ ok: true, by: 'Gemini',
    paras: (body.paras || []).map(() => 'Tên bài dịch muộn.') }));
  await wait(900);
  click(later.window, later.doc.getElementById('tab-passages'));
  await wait(40);
  click(later.window, later.doc.querySelector('.hit'));
  await wait(250);
  const asked2 = postsLater.filter(p => p.body.action === 'aitranslate');
  ok('a later visit that opens the passage fetches a heading still owing',
     asked2.length === 1 && asked2[0].body.paras.length === 1,
     asked2.length + ' asks, ' + JSON.stringify(asked2.map(x => x.body.paras)));
  ok('  and stands it over the paragraphs that were already kept',
     (later.doc.querySelector('.ai-h1') || {}).textContent === 'Tên bài dịch muộn.' &&
     later.doc.querySelectorAll('.ai-para').length === paraCount,
     (later.doc.querySelector('.ai-h1') || {}).textContent || 'no title');

  /* --- another passage does not keep the last one's translation ------------ */
  click(w, doc.getElementById('passage-ai'));   // gone with the pane
  await wait(50);
  click(w, doc.querySelectorAll('.hit')[1]);
  await wait(60);
  ok('opening another passage leaves the translation behind',
     !doc.querySelector('.aipane'));

  /* --- when it will not answer -------------------------------------------- */
  const posts2 = [];
  const b = page(unlockedStore(CFG), posts2,
    () => ({ ok: false, error: 'No key for the Vietnamese column is set.' }));
  await wait(900);
  click(b.window, b.doc.getElementById('tab-passages'));
  await wait(40);
  click(b.window, b.doc.querySelector('.hit'));
  await wait(60);
  openMenu(b);
  click(b.window, b.doc.getElementById('passage-ai'));
  await wait(300);
  ok('with no key set it says so in the column rather than sitting blank',
     /No key/.test((b.doc.querySelector('.ai-none') || {}).textContent || ''),
     (b.doc.querySelector('.ai-none') || {}).textContent);

  /* --- with no sheet linked at all ---------------------------------------- */
  const c = page(unlockedStore(), [], () => ({ ok: true }));
  await wait(900);
  click(c.window, c.doc.getElementById('tab-passages'));
  await wait(40);
  click(c.window, c.doc.querySelector('.hit'));
  await wait(60);
  openMenu(c);
  click(c.window, c.doc.getElementById('passage-ai'));
  await wait(60);
  ok('with no sheet linked it asks for the link instead of asking nobody',
     !c.doc.querySelector('.aipane') &&
     /Settings/.test(c.doc.getElementById('toast').textContent),
     c.doc.getElementById('toast').textContent);

  /* --- the script side ---------------------------------------------------- */
  const gridsPath = path.join(__dirname, 'grids.json');
  if (!fs.existsSync(gridsPath)) {
    ok('skipped the script side: no grids.json yet', true);
    done(a.errs.concat(b.errs, c.errs, later.errs, ph.errs));
    return;
  }
  const grids = JSON.parse(fs.readFileSync(gridsPath, 'utf8'));
  const sandbox = appsScriptSandbox(grids,
    { SOTRATU_KEY: CFG.key, SOTRATU_AI_KEY: 'AIzaSomethingLongEnough' });
  vm.createContext(sandbox);
  vm.runInContext(read('sheet-sync.gs') + '\nthis.__doPost = doPost;', sandbox);

  const asks = [];
  sandbox.net.reply = (url, opts) => {
    asks.push({ url, body: JSON.parse(opts.payload) });
    return { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{
      text: '["Câu một.", "Câu hai."]' } ] } }] }) };
  };
  const res = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'aitranslate',
      paras: ['The first paragraph.', 'The second one.'],
    }) },
  }));
  ok('doPost handles the aitranslate action', res.ok === true, JSON.stringify(res));
  ok('  and hands back one Vietnamese paragraph per English one',
     res.paras.length === 2 && res.paras[0] === 'Câu một.', JSON.stringify(res.paras));
  ok('  naming the model that wrote it', res.by === 'Gemini', res.by);
  ok('  the paragraphs are numbered for it, so they come back in order',
     /1\. The first paragraph/.test(asks[0].body.contents[0].parts[0].text) &&
     /2\. The second one/.test(asks[0].body.contents[0].parts[0].text),
     asks[0].body.contents[0].parts[0].text.slice(0, 60));
  ok('  and it is told to translate exactly and naturally, nothing summarised',
     /Translate the meaning exactly/.test(asks[0].body.system_instruction.parts[0].text) &&
     /Natural written Vietnamese/.test(asks[0].body.system_instruction.parts[0].text),
     asks[0].body.system_instruction.parts[0].text.slice(0, 80));

  /* --- an answer with a stray backslash in it ------------------------------
     "SyntaxError: Bad Unicode escape in JSON at position 6412" is what a
     reader got where a passage should have been: the model had written a
     backslash-u with nothing behind it, and JSON.parse took the whole passage
     down with it. */
  const BS = String.fromCharCode(92);
  sandbox.net.reply = () => ({ code: 200, body: JSON.stringify({ candidates: [{
    content: { parts: [{ text: '["Câu một.", "Câu ' + BS + 'uZZZZ hai."]' }] } }] }) });
  const mended = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'aitranslate',
      paras: ['The first paragraph.', 'The second one.'],
    }) },
  }));
  ok('an escape that escapes nothing is mended rather than thrown',
     mended.ok === true && mended.paras.length === 2 &&
     mended.paras[1] === 'Câu uZZZZ hai.', JSON.stringify(mended.paras));

  sandbox.net.reply = () => ({ code: 200, body: JSON.stringify({ candidates: [{
    content: { parts: [{ text: '1. Câu một.' + String.fromCharCode(10)
      + '2. Câu hai.' }] } }] }) });
  const lined = JSON.parse(sandbox.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'aitranslate',
      paras: ['The first paragraph.', 'The second one.'],
    }) },
  }));
  ok('  and an answer that is a numbered list rather than a JSON one is read too',
     lined.ok === true && lined.paras.length === 2 &&
     lined.paras[0] === 'Câu một.' && lined.paras[1] === 'Câu hai.',
     JSON.stringify(lined.paras));

  const noKey = appsScriptSandbox(grids, { SOTRATU_KEY: CFG.key });
  vm.createContext(noKey);
  vm.runInContext(read('sheet-sync.gs') + '\nthis.__doPost = doPost;', noKey);
  const bare = JSON.parse(noKey.__doPost({
    postData: { contents: JSON.stringify({
      key: CFG.key, action: 'aitranslate', paras: ['Something.'],
    }) },
  }));
  ok('with no key in the script it says which menu item sets one',
     bare.ok === false && /Key for the Vietnamese column/.test(bare.error), bare.error);

  done(a.errs.concat(b.errs, c.errs, later.errs, ph.errs));
})();
