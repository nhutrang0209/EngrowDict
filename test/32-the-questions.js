/* The questions set on a passage.

   A paper asks a dozen things about one passage in four different ways, and
   underneath all four there are only two: a list of questions with the answer
   at the end of each, and a body of notes with the answers blanked out of it.
   Every kind is one of those two with a different set to choose from — which
   is why the parser below has two shapes in it and not seven.

   They live in a cell of the sheet the way a passage does, keyed on the
   passage's title, and the page is what reads the shape out of the text. */
const vm = require('vm');
const { read, boot, ok, done, wait, click, unlockedStore,
        appsScriptSandbox } = require('./helpers');

const shell = read('docs/index.html');
const base = JSON.parse(read('docs/data.json'));

const QUIZ = [
  '# Questions 1-3',
  '! Do the following statements agree with the information given?',
  '? tfng',
  "The majority of England's geoglyphs are in one particular region. = F",
  'Horse-shaped geoglyphs outnumber those shaped like any other creature. = NG',
  'A recent re-dating revealed the assumed age was incorrect. = TRUE',
  '',
  '# Questions 4-5',
  '! Complete the notes below. Choose ONE WORD ONLY from the passage.',
  '? notes',
  '# The Uffington White Horse',
  '- close to an ancient trackway called the ___{Ridgeway}',
  '- earliest mention is found in ___{documents} dating from the 1070s',
  '',
  '# Question 6',
  '! Complete the summary using the list of words, A-D, below.',
  '? summary',
  '* A solution',
  '* B partnership',
  '* C destruction',
  '* D nutrition',
  'Only a small proportion are responsible for ___{C}.',
  '',
  '# Question 7',
  '! Choose the correct letter.',
  '? choice',
  'What does the writer say about geoglyphs? = B',
  '- They are usually found on hillsides.',
  '- They were never meant to be permanent.',
  '- They are easiest to see from nearby.',
].join('\n');

/* The first passage carries a set; the second deliberately does not, which is
   half of what the Questions tab is for saying. */
function dataWith(quiz) {
  const d = JSON.parse(JSON.stringify(base));
  if (quiz) d.readings[0].quiz = quiz;
  return d;
}

const mk = (quiz, store, extra) => boot(Object.assign({
  html: shell, full: true, store: store || unlockedStore(),
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  fetchStub: () => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(dataWith(quiz)),
  }),
}, extra || {}));

/* A translation already made and put away, so the Vietnamese column can be
   opened here without a sheet to ask for one. Kept shut, so it opens when the
   test asks and not before. */
function withTranslation(store) {
  const r = base.readings[0];
  const stamp = r.paras.length + ':'
    + r.paras.map(p => p.text).join('').length;
  store['engrowdict:aitr:v1'] = JSON.stringify({
    r0: { stamp, at: Date.now(), by: 'a test', shut: true,
          paras: r.paras.map(() => 'Tiếng Việt.') },
  });
  return store;
}

const tabQ = g => g.doc.getElementById('tab-questions');
const hits = g => [...g.doc.querySelectorAll('.hit .hw')].map(n => n.textContent);
const tasks = g => [...g.doc.querySelectorAll('.quiz .task')];
const rows = g => [...g.doc.querySelectorAll('.quiz .qrow')];
const nums = g => [...g.doc.querySelectorAll('.quiz .qnum, .quiz .gap-n')]
  .map(n => n.textContent.replace('.', ''));

(async () => {
  /* --- the tab ------------------------------------------------------------ */
  const a = mk(QUIZ);
  await wait(900);
  ok('the Questions tab is a place of its own, beside the passages',
     !!tabQ(a) && !tabQ(a).hidden, tabQ(a) ? 'there' : 'missing');

  click(a.window, tabQ(a));
  await wait(60);
  ok('  listing the passages that carry questions, and only those',
     hits(a).length === 1 && hits(a)[0] === base.readings[0].title,
     hits(a).join(' | '));
  ok('  counted as sets rather than as passages',
     /\bset\b/.test(a.doc.getElementById('count').textContent),
     a.doc.getElementById('count').textContent);

  click(a.window, a.doc.querySelector('.hit'));
  await wait(80);
  ok('picking one opens the passage with the questions already beside it',
     !!a.doc.querySelector('.readsplit .read .prose')
     && !!a.doc.querySelector('.readsplit #quiz-pane'),
     a.doc.querySelector('.readsplit') ? 'split' : 'one column');

  /* --- what a set is made of ---------------------------------------------- */
  ok('each task is its own block', tasks(a).length === 4, String(tasks(a).length));
  ok('  carrying the line that says what it is for',
     tasks(a)[0].querySelector('.tell').textContent
       === 'Do the following statements agree with the information given?',
     (tasks(a)[0].querySelector('.tell') || {}).textContent);

  /* --- the numbers run straight through, and nobody writes them ----------- */
  ok('the questions are numbered 1 to 7 across four different kinds',
     nums(a).join(' ') === '1 2 3 4 5 6 7', nums(a).join(' '));
  ok('  and no number is written anywhere in what was typed',
     !/\(\d\)/.test(QUIZ) && !/^\d+\./m.test(QUIZ), 'none written');

  /* --- true, false, not given ---------------------------------------------- */
  const first = rows(a)[0];
  ok('a statement is answered with the three words a paper offers',
     [...first.querySelectorAll('.opt')].map(b => b.textContent).join('/')
       === 'TRUE/FALSE/NOT GIVEN',
     [...first.querySelectorAll('.opt')].map(b => b.textContent).join('/'));

  /* --- notes, with the words taken out ------------------------------------- */
  const notes = tasks(a)[1];
  ok('note completion is the notes themselves, with the blanks in them',
     notes.querySelectorAll('.gap').length === 2
     && notes.querySelectorAll('.gap-in').length === 2,
     notes.querySelectorAll('.gap').length + ' blanks');
  ok('  each with its number beside it, where it is reported',
     [...notes.querySelectorAll('.gap-n')].map(n => n.textContent).join(' ') === '4 5',
     [...notes.querySelectorAll('.gap-n')].map(n => n.textContent).join(' '));

  /* --- a summary with a box of words --------------------------------------- */
  const sum = tasks(a)[2];
  ok('a list of words becomes the box a paper prints above the summary',
     sum.querySelectorAll('.bank-item').length === 4
     && sum.querySelector('.bank-l').textContent === 'A',
     sum.querySelectorAll('.bank-item').length + ' words');
  ok('  and the blank under it picks a letter rather than taking a word',
     !!sum.querySelector('.gap-pick') && !sum.querySelector('.gap-in'),
     sum.querySelector('.gap-pick') ? 'a letter' : 'typed');

  /* --- multiple choice ------------------------------------------------------ */
  const mc = tasks(a)[3];
  ok('a question with answers under it is a multiple choice, lettered as written',
     [...mc.querySelectorAll('.opt-l')].map(n => n.textContent).join('') === 'ABC',
     [...mc.querySelectorAll('.opt-l')].map(n => n.textContent).join(''));

  /* --- what the reader puts down ------------------------------------------- */
  const store = unlockedStore();
  const b = mk(QUIZ, store);
  await wait(900);
  click(b.window, tabQ(b));
  await wait(40);
  click(b.window, b.doc.querySelector('.hit'));
  await wait(80);
  const opt = b.doc.querySelectorAll('.quiz .qrow .opt')[1];   // FALSE on question 1
  click(b.window, opt);
  await wait(30);
  ok('an answer is marked where it was pressed',
     opt.getAttribute('aria-pressed') === 'true', opt.getAttribute('aria-pressed'));
  ok('  and kept under the passage it answers',
     JSON.parse(store['engrowdict:ans:v1'] || '{}')['q:r0']
     && JSON.parse(store['engrowdict:ans:v1'])['q:r0']['1'] === 'FALSE',
     store['engrowdict:ans:v1']);

  const c = mk(QUIZ, store);
  await wait(900);
  click(c.window, tabQ(c));
  await wait(40);
  click(c.window, c.doc.querySelector('.hit'));
  await wait(80);
  ok('a later visit finds the answers where they were left',
     c.doc.querySelectorAll('.quiz .opt[aria-pressed="true"]').length === 1,
     String(c.doc.querySelectorAll('.quiz .opt[aria-pressed="true"]').length));

  click(c.window, c.doc.querySelector('.quiz .opt[aria-pressed="true"]'));
  await wait(30);
  ok('  and pressing the one already chosen takes it back off',
     !JSON.parse(c.store['engrowdict:ans:v1'] || '{}')['q:r0'],
     c.store['engrowdict:ans:v1']);

  /* --- three columns, and what happens when there is no room for them ------ */
  const wide = mk(QUIZ, withTranslation(unlockedStore()), { width: 1500 });
  await wait(900);
  click(wide.window, tabQ(wide));
  await wait(40);
  click(wide.window, wide.doc.querySelector('.hit'));
  await wait(80);
  click(wide.window, wide.doc.getElementById('passage-ai'));
  await wait(80);
  ok('on a wide window the passage, the Vietnamese and the questions stand in three',
     wide.doc.querySelector('.readsplit').dataset.panes === '2'
     && !!wide.doc.getElementById('ai-pane')
     && !!wide.doc.getElementById('quiz-pane'),
     wide.doc.querySelector('.readsplit').dataset.panes + ' panes beside it');
  ok('  each with a rule of its own to drag',
     !!wide.doc.getElementById('ai-split') && !!wide.doc.getElementById('quiz-split'),
     'two rules');

  const tight = mk(QUIZ, withTranslation(unlockedStore()), { width: 1000 });
  await wait(900);
  click(tight.window, tabQ(tight));
  await wait(40);
  click(tight.window, tight.doc.querySelector('.hit'));
  await wait(80);
  click(tight.window, tight.doc.getElementById('passage-ai'));
  await wait(80);
  ok('with no room for three they share one column and take turns in it',
     tight.doc.querySelector('.readsplit').dataset.panes === '1'
     && tight.doc.querySelectorAll('.pane-tab').length === 2,
     tight.doc.querySelectorAll('.pane-tab').length + ' names on the one column');
  ok('  the strip saying which it is showing being the thing that changes it',
     tight.doc.getElementById('pane-tab-quiz').getAttribute('aria-pressed') === 'true',
     'questions showing');
  click(tight.window, tight.doc.getElementById('pane-tab-ai'));
  await wait(60);
  ok('  so the Vietnamese is one press away, not a column away',
     !!tight.doc.getElementById('ai-pane') && !tight.doc.getElementById('quiz-pane'),
     'the other one');

  /* --- a passage with none of them ----------------------------------------- */
  const none = mk(null, {});
  await wait(900);
  ok('a copy where no passage carries questions and none may be written '
     + 'does not offer the place at all',
     !tabQ(none) || tabQ(none).hidden, 'not offered');

  /* --- writing a set ------------------------------------------------------

     The passage editor hides its marks and shows the prose, because there the
     marks are scaffolding. Here they are the thing — `? tfng` is what makes
     the next six lines questions — so the box shows them and the buttons put
     in the ones nobody should have to remember. */
  const wStore = unlockedStore();
  const w = mk(null, wStore);
  await wait(900);
  click(w.window, tabQ(w));
  await wait(50);
  ok('a copy that may write them offers the place even with none written yet',
     !!tabQ(w) && !tabQ(w).hidden, 'offered');
  ok('  and offers to add some rather than to add a word',
     w.doc.getElementById('add-word').textContent === '+ Add questions',
     w.doc.getElementById('add-word').textContent);

  click(w.window, w.doc.getElementById('add-word'));
  await wait(40);
  const dlg = w.doc.getElementById('quiz-dlg');
  ok('the form opens on which passage they are on', !!dlg && dlg.open
     && w.doc.querySelectorAll('#quiz-for option').length === base.readings.length,
     w.doc.querySelectorAll('#quiz-for option').length + ' passages offered');
  ok('  and the box shows the marks rather than hiding them',
     w.doc.getElementById('quiz-body').tagName === 'TEXTAREA',
     w.doc.getElementById('quiz-body').tagName);

  const bits = [...w.doc.querySelectorAll('.quizbar .markbtn')];
  ok('  with a button for each shape, so none has to be remembered',
     bits.length >= 8 && bits.some(b => /True . False/.test(b.textContent)),
     bits.map(b => b.textContent).join(', '));

  /* A set nobody can answer is not a set, and the sheet is the wrong place to
     find that out. */
  w.doc.getElementById('quiz-body').value = 'Just some prose, with nothing to do.';
  click(w.window, w.doc.getElementById('quiz-save'));
  await wait(40);
  ok('saving something with nothing answerable in it says so and writes nothing',
     dlg.open && /cannot be answered|needs a \?/.test(w.doc.getElementById('quiz-msg').textContent),
     w.doc.getElementById('quiz-msg').textContent);

  w.doc.getElementById('quiz-for').value = 'r0';
  w.doc.getElementById('quiz-body').value = QUIZ;
  click(w.window, w.doc.getElementById('quiz-save'));
  await wait(80);
  ok('saving a real one closes the form', !dlg.open, 'closed');
  ok('  and opens it beside the passage it was written for',
     !!w.doc.querySelector('#quiz-pane .task'),
     w.doc.querySelectorAll('#quiz-pane .task').length + ' tasks');
  ok('  kept on this device under the passage it is on',
     JSON.parse(wStore['engrowdict:quizzes:v1'] || '{}')[base.readings[0].title] === QUIZ,
     Object.keys(JSON.parse(wStore['engrowdict:quizzes:v1'] || '{}')).join(', '));

  const back = mk(null, wStore);
  await wait(900);
  click(back.window, tabQ(back));
  await wait(60);
  ok('a later visit finds it there, over whatever data.json came down with',
     hits(back).length === 1 && hits(back)[0] === base.readings[0].title,
     hits(back).join(' | '));

  /* --- and taking one off --------------------------------------------------- */
  click(back.window, back.doc.querySelector('.hit'));
  await wait(80);
  click(back.window, back.doc.getElementById('quiz-edit'));
  await wait(40);
  ok('the pencil over the questions opens them to be put right',
     back.doc.getElementById('quiz-dlg').open
     && back.doc.getElementById('quiz-body').value === QUIZ,
     back.doc.getElementById('quiz-head').textContent);
  back.window.confirm = () => true;
  click(back.window, back.doc.getElementById('quiz-drop'));
  await wait(80);
  ok('  and Remove takes them off the passage and out of the store',
     !JSON.parse(wStore['engrowdict:quizzes:v1'] || '{}')[base.readings[0].title]
     && !back.doc.getElementById('quiz-pane'),
     wStore['engrowdict:quizzes:v1']);

  /* --- and in the sheet ----------------------------------------------------

     The half of this that only ever runs in Google's own runtime: the tab the
     sets live in, made if it is not there, keyed on the passage's title, and
     carried back out onto the passages the page is built from. */
  const grids = JSON.parse(read('test/grids.json'));
  const sandbox = appsScriptSandbox(grids, { SOTRATU_KEY: 'a-secret-key' });
  vm.createContext(sandbox);
  vm.runInContext(read('sheet-sync.gs')
    + '\nthis.__doPost = doPost; this.__buildData = buildData;', sandbox);
  const call = payload => JSON.parse(
    sandbox.__doPost({ postData: { contents: JSON.stringify(payload) } }));
  const PASS = grids['Reading Passage'][1][1];       // the first passage's title

  ok('a sheet written before there were any questions has no tab for them',
     !grids['Reading Questions'], 'none');

  const put = call({ key: 'a-secret-key', action: 'questions',
                     passage: PASS, body: QUIZ });
  ok('writing the first set makes the tab rather than asking for one by hand',
     put.ok === true, JSON.stringify(put));

  ok('  one row to a set: the passage it is on, and the whole of it beside',
     sandbox.__buildData().readings[0].quiz === QUIZ,
     String(sandbox.__buildData().readings[0].quiz || '').slice(0, 30));
  ok('  and the passages with none carry none',
     sandbox.__buildData().readings.filter(r => r.quiz).length === 1,
     sandbox.__buildData().readings.filter(r => r.quiz).length + ' with questions');

  const again = call({ key: 'a-secret-key', action: 'questions',
                       passage: PASS, body: '? tfng\nOne statement. = T' });
  ok('writing a second set for the same passage puts the first right, not a second row',
     again.ok && sandbox.__buildData().readings.filter(r => r.quiz).length === 1
     && /One statement/.test(sandbox.__buildData().readings[0].quiz),
     sandbox.__buildData().readings[0].quiz);

  const nope = call({ key: 'a-secret-key', action: 'questions',
                      passage: 'A passage nobody wrote', body: QUIZ });
  ok('questions for a passage that is not there are refused, not filed',
     nope.ok === false && /no passage/.test(nope.error || ''), JSON.stringify(nope));

  /* The key is the title, so the one thing that can break the link is a
     rename — which is why the rename carries them. */
  call({ key: 'a-secret-key', action: 'editpassage',
         was: { title: PASS },
         entry: { title: 'A Different Name', paras: ['Some words.', 'Some more.'] } });
  ok('a passage renamed keeps the questions set on it',
     sandbox.__buildData().readings.filter(r => r.quiz).length === 1
     && sandbox.__buildData().readings[0].title === 'A Different Name',
     sandbox.__buildData().readings[0].title);

  const off = call({ key: 'a-secret-key', action: 'questions',
                     passage: 'A Different Name', body: '' });
  ok('and an empty body is how a set is taken off again',
     off.ok && sandbox.__buildData().readings.filter(r => r.quiz).length === 0,
     JSON.stringify(off));

  /* --- a set that does not open at one -------------------------------------

     A reading test numbers 1 to 40 across three passages, so the questions on
     the third one open at 27. The ? line says so once and the rest follow on,
     through the other tasks and the other kinds — because the alternative is
     writing forty numbers by hand and keeping them in step with every edit. */
  const LATE = [
    '! Choose the correct letter, A, B, C or D.',
    '? choice 27',
    "What is the writer's main point in the opening paragraph? = C",
    '- A. Wisdom seems to be a quality found only in humans.',
    '- B. A commonly held belief about wisdom could be mistaken.',
    '- C. Notions of wisdom may vary according to the society we live in.',
    '- D. Much about the true nature of wisdom remains unknown.',
    'What does the researcher suggest about wise decisions? = A',
    '- It differs considerably between individuals.',
    '- Previous studies into it relied on flawed evidence.',
    '',
    '! Complete the notes below.',
    '? notes',
    '- the degree of wisdom shown by an ___{individual}',
  ].join('\n');

  const late = mk(LATE);
  await wait(900);
  click(late.window, tabQ(late));
  await wait(50);
  click(late.window, late.doc.querySelector('.hit'));
  await wait(80);
  ok('a set told where to start opens there, and carries on into the next task',
     nums(late).join(' ') === '27 28 29', nums(late).join(' '));

  ok('  an option pasted off a paper with its own letter is not lettered twice',
     [...late.doc.querySelectorAll('.quiz .opt')].slice(0, 1)
       .map(b => b.textContent).join('') === 'AWisdom seems to be a quality found only in humans.',
     [...late.doc.querySelectorAll('.quiz .opt')][0].textContent);

  ok('  and a question whose options were written without letters gets them all the same',
     [...late.doc.querySelectorAll('.quiz .qrow')][1]
       .querySelectorAll('.opt-l').length === 2,
     [...[...late.doc.querySelectorAll('.quiz .qrow')][1].querySelectorAll('.opt-l')]
       .map(n => n.textContent).join(''));

  ok('the buttons in the form are words, not the reading mark they borrowed',
     /\.markbtn\.mb-w::before \{ content: none/.test(read('app.css')),
     'no dot on them');

  /* --- a paste, tidied ------------------------------------------------------

     Copied off a page that already set the questions out, what comes across
     is that page's setting-out: the number on a line of its own, the options
     under it on theirs, TRUE FALSE NOT GIVEN printed as three lines because
     they were three buttons, a (31) where a box was, and the site's own
     "! Report" caught in the middle. All of it regular, so none of it has to
     be retyped — and none of it guessed at either. */
  const PASTE = [
    'Choose the correct letter, A, B, C or D.',
    '',
    '27.',
    "What is the writer's main point in the opening paragraph?",
    '',
    'A. Wisdom seems to be a quality found only in humans.',
    '',
    'B. A commonly held belief about wisdom could be mistaken.',
    '28.',
    'What does the researcher suggest about wise decisions?',
    'A. It differs considerably between individuals.',
    'B. Previous studies into it relied on flawed evidence.',
    '',
    '!',
    'Report',
    'Complete the summary using the list of words, A-J, below.',
    '',
    'Key features of wise reasoning',
    'Write the correct letter (A–J) in the boxes below.',
    '',
    'A. opinions',
    'B. confidence',
    'It is important to possess a certain amount of ',
    '(29)',
    'A-J',
    ' about the limits of our own knowledge.',
    '',
    '!',
    'Report',
    'Do the following statements agree with the information given in the Reading Passage?',
    '',
    '30.',
    'Students were free to select which viewpoint they would adopt.',
    '',
    'TRUE',
    'FALSE',
    'NOT GIVEN',
    '31.',
    'The couples knew what the research was investigating.',
    '',
    'TRUE',
    'FALSE',
    'NOT GIVEN',
  ].join('\n');

  const t = mk(null, unlockedStore());
  await wait(900);
  click(t.window, tabQ(t));
  await wait(50);
  click(t.window, t.doc.getElementById('add-word'));
  await wait(40);
  const tbox = t.doc.getElementById('quiz-body');
  const tmsg = () => t.doc.getElementById('quiz-msg').textContent;

  click(t.window, t.doc.getElementById('quiz-tidy'));
  await wait(30);
  ok('tidying an empty box asks for something to tidy',
     /Paste the questions/.test(tmsg()), tmsg());

  tbox.value = PASTE;
  click(t.window, t.doc.getElementById('quiz-tidy'));
  await wait(40);
  const said = tbox.value;

  ok('a paste comes back as marks, with the first number read off it',
     /^! Choose the correct letter/m.test(said) && /^\? choice 27$/m.test(said),
     said.split('\n').slice(0, 2).join(' / '));
  ok('  and the number is written once, not onto every task',
     (said.match(/^\? \w+ \d+$/gm) || []).length === 1
     && /^\? summary$/m.test(said) && /^\? tfng$/m.test(said),
     (said.match(/^\?.*$/gm) || []).join(' | '));
  ok('  the options keeping the letters the page gave them',
     /^- A\. Wisdom seems/m.test(said), (said.match(/^- .*/m) || [])[0]);
  ok('  the box of words read as a box and not as four more options',
     /^\* A opinions$/m.test(said) && /^# Key features/m.test(said),
     (said.match(/^\* .*/gm) || []).join(' | '));
  ok('  a sentence broken around its box put back together, box and all',
     /amount of ___\{\} about the limits of our own knowledge\./.test(said),
     (said.match(/It is important.*/) || [])[0]);
  ok('  and the three words that were three buttons left out of the statements',
     !/^(TRUE|FALSE|NOT GIVEN)$/m.test(said) && !/^(!|Report)$/m.test(said),
     'no leftovers');

  ok('it says how many it found and how many still want an answer',
     /5 questions found/.test(tmsg()) && /5 still want an answer/.test(tmsg()),
     tmsg());

  click(t.window, t.doc.getElementById('quiz-tidy'));
  await wait(30);
  ok('  and tidying what is already tidy says so rather than mangling it',
     tbox.value === said && /already written in marks/.test(tmsg()), tmsg());

  /* The answers are the one thing a paste cannot carry: the page was showing
     its questions, not its answers. So they are typed in, and then it saves. */
  tbox.value = said.replace('opening paragraph? = ', 'opening paragraph? = C');
  t.doc.getElementById('quiz-for').value = 'r0';
  click(t.window, t.doc.getElementById('quiz-save'));
  await wait(80);
  ok('what comes out of it saves, and numbers itself from where the page did',
     nums(t).slice(0, 3).join(' ') === '27 28 29', nums(t).join(' '));
  ok('  with the answer that was typed in standing against its question',
     JSON.parse(t.store['engrowdict:quizzes:v1'])[base.readings[0].title]
       .includes('opening paragraph? = C'), 'C');

  done(a.errs.concat(b.errs, c.errs, wide.errs, tight.errs, none.errs,
                     w.errs, back.errs, late.errs, t.errs));
})();
