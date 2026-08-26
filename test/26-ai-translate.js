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

function page(store, posts, reply) {
  const g = boot({
    html: shell, full: true, store, width: 1500,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    dataFile: 'docs/data.json',
  });
  const realFetch = g.window.fetch;
  g.window.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') {
      posts.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply()) });
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
  let answer = () => ({ ok: true, by: 'Gemini',
    paras: ['Đoạn một.', 'Đoạn hai.', 'Đoạn ba.'] });
  const a = page(unlockedStore(CFG), posts, () => answer());
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
  ok('  a few paragraphs at a time, so the first of it can be read at once',
     !!sent && sent.body.paras.length <= 4 && sent.body.paras[0] === firstEnglish,
     sent && sent.body.paras.length + ' in the first ask');
  ok('  and every paragraph of it in the end, in order', (() => {
    const all = posts.filter(p => p.body.action === 'aitranslate')
      .reduce((list, p) => list.concat(p.body.paras), []);
    return all.length === paras && all[0] === firstEnglish;
  })(), posts.filter(p => p.body.action === 'aitranslate').length + ' asks for '
     + paras + ' paragraphs');

  const said = [...doc.querySelectorAll('.ai-para .vi')].map(n => n.textContent);
  ok('what comes back is read down the right', said[0] === 'Đoạn một.' &&
     said[1] === 'Đoạn hai.', said.slice(0, 2).join(' | '));
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

  /* --- picking a paragraph out on one side, and finding it on the other ----
     Paragraph for paragraph is the only pairing there is: the model was given
     a paragraph at a time and never said which of its clauses answers which of
     the English ones, so a sentence lights the paragraph it belongs to. */
  const pick = (from, to) => {
    const range = doc.createRange();
    range.setStart(from.firstChild || from, 0);
    const end = to || from;
    range.setEnd(end.lastChild || end, (end.lastChild || end).length || 0);
    w.getSelection().removeAllRanges();
    w.getSelection().addRange(range);
    from.dispatchEvent(new w.Event('mouseup', { bubbles: true }));
  };
  const lit = () => [...aiBody.querySelectorAll('.ai-para')]
    .map((n, i) => (n.classList.contains('lit') ? i : -1)).filter(i => i > -1);

  pick(ens[1]);
  await wait(40);
  ok('selecting a paragraph of the English lights its Vietnamese',
     lit().join() === '1', lit().join() || 'none');

  pick(ens[0]);
  await wait(40);
  ok('  and only the one, so moving on takes the last one off again',
     lit().join() === '0', lit().join() || 'none');

  pick(ens[0], ens[2]);
  await wait(40);
  ok('  a selection across three paragraphs lights all three',
     lit().join() === '0,1,2', lit().join() || 'none');

  const inside = doc.createRange();
  const words = ens[1].lastChild;
  inside.setStart(words, 0);
  inside.setEnd(words, Math.min(12, words.length));
  w.getSelection().removeAllRanges();
  w.getSelection().addRange(inside);
  ens[1].dispatchEvent(new w.Event('mouseup', { bubbles: true }));
  await wait(40);
  ok('  a few words inside one light the paragraph they belong to',
     lit().join() === '1', lit().join() || 'none');

  w.getSelection().removeAllRanges();
  ens[1].dispatchEvent(new w.Event('mouseup', { bubbles: true }));
  await wait(40);
  ok('  and letting the selection go puts the Vietnamese back as it was',
     lit().length === 0, lit().join());

  ok('what is lit is washed behind the words, not dressed up as a selection',
     /\.ai-para\.lit::before \{ opacity: 1/.test(read('app.css')) &&
     /pointer-events: none/.test(read('app.css').slice(
       read('app.css').indexOf('.ai-para::before {'),
       read('app.css').indexOf('.ai-para::before {') + 260)),
     'washed');

  /* --- asking again, and closing ------------------------------------------ */
  posts.length = 0;
  answer = () => ({ ok: true, by: 'Gemini', paras: ['Lần hai.', 'Hai.', 'Ba.'] });
  click(w, doc.getElementById('ai-again'));
  await wait(300);
  ok('it can be asked again', posts.some(p => p.body.action === 'aitranslate') &&
     doc.querySelector('.ai-para .vi').textContent === 'Lần hai.',
     doc.querySelector('.ai-para .vi').textContent);

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
    done(a.errs.concat(b.errs, c.errs));
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

  done(a.errs.concat(b.errs, c.errs));
})();
