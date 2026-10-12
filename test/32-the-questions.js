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
/* The pane beside the passage, not the preview in the form: both draw the
   same questions with the same renderer, and a count that took in both would
   quietly double once the form was open. */
const tasks = g => [...g.doc.querySelectorAll('#quiz-pane .task')];
const rows = g => [...g.doc.querySelectorAll('#quiz-pane .qrow')];
const nums = g => [...g.doc.querySelectorAll('#quiz-pane .qnum, #quiz-pane .gap-n')]
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
  const opt = b.doc.querySelectorAll('#quiz-pane .qrow .opt')[1];   // FALSE on question 1
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
     c.doc.querySelectorAll('#quiz-pane .opt[aria-pressed="true"]').length === 1,
     String(c.doc.querySelectorAll('#quiz-pane .opt[aria-pressed="true"]').length));

  click(c.window, c.doc.querySelector('#quiz-pane .opt[aria-pressed="true"]'));
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
     [...late.doc.querySelectorAll('#quiz-pane .opt')].slice(0, 1)
       .map(b => b.textContent).join('') === 'AWisdom seems to be a quality found only in humans.',
     [...late.doc.querySelectorAll('#quiz-pane .opt')][0].textContent);

  ok('  and a question whose options were written without letters gets them all the same',
     [...late.doc.querySelectorAll('#quiz-pane .qrow')][1]
       .querySelectorAll('.opt-l').length === 2,
     [...[...late.doc.querySelectorAll('#quiz-pane .qrow')][1].querySelectorAll('.opt-l')]
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
     /^\* A\. opinions$/m.test(said) && /^# Key features/m.test(said),
     (said.match(/^\* .*/gm) || []).join(' | '));
  ok('  a sentence broken around its box put back together, box and all',
     /amount of ___\{\} about the limits of our own knowledge\./.test(said),
     (said.match(/It is important.*/) || [])[0]);
  ok('  and the three words that were three buttons left out of the statements',
     !/^(TRUE|FALSE|NOT GIVEN)$/m.test(said) && !/^(!|Report)$/m.test(said),
     'no leftovers');

  ok('it says how many it found and how many still want an answer',
     /5 questions read/.test(tmsg()) && /5 still want an answer/.test(tmsg()),
     tmsg());

  click(t.window, t.doc.getElementById('quiz-tidy'));
  await wait(30);
  ok('  and tidying what is already tidy says so rather than mangling it',
     tbox.value === said && /already written in marks/.test(tmsg()), tmsg());

  /* The answers are the one thing a paste cannot carry: the page was showing
     its questions, not its answers. So they are typed in, and then it saves. */
  tbox.value = said.replace('opening paragraph? = ', 'opening paragraph? = C');
  t.doc.getElementById('quiz-for').value = 'r0';
  const saved = tbox.value;
  click(t.window, t.doc.getElementById('quiz-save'));
  await wait(80);
  ok('what comes out of it saves, and numbers itself from where the page did',
     nums(t).slice(0, 3).join(' ') === '27 28 29', nums(t).join(' '));
  ok('  with the answer that was typed in standing against its question',
     JSON.parse(t.store['engrowdict:quizzes:v1'])[base.readings[0].title]
       .includes('opening paragraph? = C'), 'C');

  /* --- and what it will look like, while it is being written --------------

     The marks are written to be read by the page, not by a person. A form
     that showed only the marks asked its writer to hold the rendering in
     their head and check it there — and the question a writer has is always
     whether this is right yet. */
  const prev = () => t.doc.getElementById('quiz-preview');
  const ptally = () => t.doc.getElementById('quiz-tally').textContent;
  const typeQ = v => {
    t.doc.getElementById('quiz-body').value = v;
    t.doc.getElementById('quiz-body').dispatchEvent(new t.window.Event('input'));
  };

  click(t.window, t.doc.getElementById('quiz-edit'));
  await wait(40);
  ok('the form has the box on one side and what it comes out as on the other',
     !!prev() && prev().parentNode.parentNode.classList.contains('quiz-split'),
     prev() ? prev().parentNode.parentNode.className : 'no preview');
  ok('  showing what is already written the moment it opens',
     prev().querySelectorAll('.task').length === 3,
     prev().querySelectorAll('.task').length + ' tasks');
  ok('  and counting them, with the numbers they will carry',
     /5 questions/.test(ptally()) && /27–31/.test(ptally()), ptally());

  typeQ('? tfng 12\nOne statement. = T\nAnother. = F');
  await wait(300);
  ok('it follows the typing rather than waiting to be asked',
     prev().querySelectorAll('.qrow').length === 2
     && [...prev().querySelectorAll('.qnum')].map(n => n.textContent).join(' ')
        === '12. 13.',
     [...prev().querySelectorAll('.qnum')].map(n => n.textContent).join(' '));
  ok('  and says when nothing is owing, as well as when something is',
     /2 questions/.test(ptally()) && !/unanswered/.test(ptally()), ptally());

  typeQ('? tfng\nOne statement.');
  await wait(300);
  ok('  an answer not yet written is counted, not hidden',
     /1 unanswered/.test(ptally()), ptally());

  typeQ('');
  await wait(300);
  ok('an empty box says what the space is for rather than standing blank',
     /appears here/.test(prev().textContent) && ptally() === '',
     prev().textContent.trim().slice(0, 40));

  /* Nothing put into the preview is an answer to anything: it is a writer
     looking at their own work, and it has no business in what a reader has
     put down. */
  typeQ('? tfng\nOne statement. = T');
  await wait(300);
  const before = JSON.stringify(t.store['engrowdict:ans:v1'] || null);
  click(t.window, prev().querySelector('.opt'));
  await wait(40);
  ok('pressing an answer in the preview answers nothing for anybody',
     JSON.stringify(t.store['engrowdict:ans:v1'] || null) === before,
     String(t.store['engrowdict:ans:v1']));

  /* --- dropping a paste in, and doing nothing else ------------------------

     The tidying is what a paste is for, so the paste does it. Asking for a
     button afterwards means knowing there is one — and what sits in the box
     until it is pressed is a page of prose with nothing answerable in it,
     which draws in the preview as exactly that, and is exactly as useless. */
  const pasteInto = (g, text) => {
    const box = g.doc.getElementById('quiz-body');
    box.value = text;                       // the browser's own part of it
    box.dispatchEvent(new g.window.Event('paste'));
  };

  const d2 = mk(null, unlockedStore());
  await wait(900);
  click(d2.window, tabQ(d2));
  await wait(50);
  click(d2.window, d2.doc.getElementById('add-word'));
  await wait(40);

  pasteInto(d2, PASTE);
  await wait(60);
  ok('a paste reads itself, without a button being found first',
     /^\? choice 27$/m.test(d2.doc.getElementById('quiz-body').value),
     d2.doc.getElementById('quiz-body').value.split('\n')[1]);
  ok('  and the preview is questions, with something to press on each',
     d2.doc.querySelectorAll('#quiz-preview .opt').length > 0
     && d2.doc.querySelectorAll('#quiz-preview .qnum')[0].textContent === '27.',
     d2.doc.querySelectorAll('#quiz-preview .opt').length + ' to choose from');
  ok('  saying what it read and what is still owing',
     /5 questions read/.test(d2.doc.getElementById('quiz-msg').textContent),
     d2.doc.getElementById('quiz-msg').textContent);

  /* Something already in marks is not a paste to be read, and a paste with
     nothing in it that looks like a question is left where it was put. */
  pasteInto(d2, '? tfng 5\nA statement. = T');
  await wait(60);
  ok('a paste already in marks is left exactly as it was pasted',
     d2.doc.getElementById('quiz-body').value === '? tfng 5\nA statement. = T',
     d2.doc.getElementById('quiz-body').value);

  pasteInto(d2, 'Just a paragraph of prose, with nothing to answer.');
  await wait(300);          // nothing to read, so the preview is the slow one
  ok('and a paste that is not questions at all is left alone too',
     d2.doc.getElementById('quiz-body').value
       === 'Just a paragraph of prose, with nothing to answer.',
     d2.doc.getElementById('quiz-body').value);
  ok('  with the preview saying what it is rather than drawing it as prose',
     /still looks like a paste/.test(d2.doc.getElementById('quiz-preview').textContent)
     && !!d2.doc.getElementById('prev-tidy'),
     d2.doc.getElementById('quiz-preview').textContent.trim().slice(0, 34));

  click(d2.window, d2.doc.getElementById('prev-tidy'));
  await wait(40);
  ok('  and the button to do something about it standing in the preview itself',
     /Nothing in that looked like questions/
       .test(d2.doc.getElementById('quiz-msg').textContent),
     d2.doc.getElementById('quiz-msg').textContent);

  /* --- when the sheet will not take them ----------------------------------

     The script in a sheet is a copy taken by hand, so it is older than the
     page whenever the page has learnt something new — and the refusal it
     sends back for a word it does not know is the one thing a reader cannot
     decode on their own. "Could not reach the sheet" was printed over a
     sheet that had been reached perfectly well and had answered. */
  const CFG = {
    sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC/edit',
    webApp: 'https://script.google.com/macros/s/XYZ/exec',
    key: 'a-secret-key',
  };
  function sheetSays(reply) {
    const store = unlockedStore(CFG);
    const g = mk(null, store);
    g.window.fetch = () => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve(reply),
    });
    return g;
  }

  const old88 = sheetSays({ ok: false, error: 'Unknown request' });
  await wait(900);
  click(old88.window, tabQ(old88));
  await wait(50);
  click(old88.window, old88.doc.getElementById('add-word'));
  await wait(40);
  old88.doc.getElementById('quiz-for').value = 'r0';
  old88.doc.getElementById('quiz-body').value = '? tfng 27\nA statement. = T';
  click(old88.window, old88.doc.getElementById('quiz-save'));
  await wait(120);

  const why = old88.doc.getElementById('banner').textContent;
  ok('a sheet whose script is older than the page is told so in those words',
     /older than this page/.test(why) && /sheet-sync\.gs/.test(why), why.slice(0, 90));
  ok('  and not told it could not be reached, which it plainly could',
     !/could not reach/i.test(why), why.slice(0, 60));
  ok('  while the questions are kept here rather than typed out again',
     JSON.parse(old88.store['engrowdict:quizzes:v1'] || '{}')[base.readings[0].title]
       === '? tfng 27\nA statement. = T'
     && !!old88.doc.querySelector('#quiz-pane .qrow'),
     old88.store['engrowdict:quizzes:v1']);
  ok('  and the form is shut, because the writing is done either way',
     !old88.doc.getElementById('quiz-dlg').open, 'shut');

  const down = sheetSays(null);          // nothing came back at all
  await wait(900);
  click(down.window, tabQ(down));
  await wait(50);
  click(down.window, down.doc.getElementById('add-word'));
  await wait(40);
  down.doc.getElementById('quiz-for').value = 'r0';
  down.doc.getElementById('quiz-body').value = '? tfng\nA statement. = T';
  click(down.window, down.doc.getElementById('quiz-save'));
  await wait(120);
  ok('a sheet that answers nothing at all is the one that could not be reached',
     /could not reach the sheet/i.test(down.doc.getElementById('banner').textContent),
     down.doc.getElementById('banner').textContent.slice(0, 60));

  const dark = mk(null, unlockedStore(CFG));
  await wait(900);
  dark.window.fetch = () => Promise.reject(new Error('Failed to fetch'));
  click(dark.window, tabQ(dark));
  await wait(50);
  click(dark.window, dark.doc.getElementById('add-word'));
  await wait(40);
  dark.doc.getElementById('quiz-for').value = 'r0';
  dark.doc.getElementById('quiz-body').value = '? tfng\nA statement. = T';
  click(dark.window, dark.doc.getElementById('quiz-save'));
  await wait(120);
  ok('  as is a sheet there is no network to reach, and the set survives both',
     /could not reach the sheet/i.test(dark.doc.getElementById('banner').textContent)
     && !!JSON.parse(dark.store['engrowdict:quizzes:v1'] || '{}')[base.readings[0].title],
     dark.doc.getElementById('banner').textContent.slice(0, 50));

  /* --- the diagram a set is about -----------------------------------------

     A figure is one line: the file or the address of it, and whatever goes
     under it after a bar. A name with no scheme in front of it is one of
     ours, and is looked for in this browser first and beside the page
     second — a set written here has its figures here before it has them
     anywhere, and one that came down from the sheet has them beside the page
     and never here. Looked for in that order, both work without the mark
     having to say which kind it is. */
  const FIGQ = [
    '! Label the diagram below.',
    '? notes',
    '@ https://example.org/aqueduct.png | The aqueduct, as surveyed',
    '- the channel runs under the ___{hill}',
    '- the two teams met at the ___{centre}',
  ].join('\n');

  const fig = mk(FIGQ);
  await wait(900);
  click(fig.window, tabQ(fig));
  await wait(50);
  click(fig.window, fig.doc.querySelector('.hit'));
  await wait(100);

  const figure = fig.doc.querySelector('#quiz-pane .qfig');
  ok('a figure is drawn where it was written, above the questions it labels',
     !!figure && figure.parentNode.classList.contains('qbody')
     && figure.parentNode.firstElementChild === figure
     && /qline/.test(figure.nextElementSibling.className),
     figure ? 'first, with the questions under it' : 'no figure');
  ok('  with what was written after the bar under it',
     figure.querySelector('figcaption').textContent === 'The aqueduct, as surveyed',
     (figure.querySelector('figcaption') || {}).textContent);
  ok('  and an address anybody can fetch used as it stands',
     figure.querySelector('img').getAttribute('src') === 'https://example.org/aqueduct.png',
     figure.querySelector('img').getAttribute('src'));
  ok('  while the questions under it are still questions',
     fig.doc.querySelectorAll('#quiz-pane .gap').length === 2,
     fig.doc.querySelectorAll('#quiz-pane .gap').length + ' blanks');

  /* A name is ours, and where ours live is not the writer's business. */
  const named = mk('? notes\n@ 90p1-a7f3c2.png\n- the channel runs under the ___{hill}');
  await wait(900);
  click(named.window, tabQ(named));
  await wait(50);
  click(named.window, named.doc.querySelector('.hit'));
  await wait(150);
  ok('a bare name is looked for beside the page, in the sheet\u2019s own folder',
     named.doc.querySelector('#quiz-pane .qfig img').getAttribute('src')
       === 'img/90p1-a7f3c2.png',
     named.doc.querySelector('#quiz-pane .qfig img').getAttribute('src'));

  ok('the figures a set carries are the names in it, not the addresses',
     /function figsIn/.test(read('app.js'))
     && /\^@\\s\+\(\\S\+\)/.test(read('app.js')),
     'read off the marks');
  ok('  and they go to the sheet before the cell that mentions them does',
     read('app.js').indexOf('sendFigs(figs')
       < read('app.js').indexOf('action: "questions", passage: got.r.title'),
     'figures first');
  ok('  by a route that does not encode the bytes a second time',
     /function ghPutB64\(repo, token, branch, path, b64, sha, message\)/
       .test(read('sheet-sync.gs'))
     && /content: b64,/.test(read('sheet-sync.gs')),
     'already base64, left alone');
  ok('  into a name nothing can climb out of',
     /indexOf\('\.\.'\) > -1/.test(read('sheet-sync.gs'))
     && /\[\^A-Za-z0-9\._-\]/.test(read('sheet-sync.gs')),
     'the name is scrubbed');

  /* The shelf is in the same database, and a migration that took a shelf out
     to put a folder in would be a migration nobody forgives. */
  const js = read('app.js');
  ok('the store for them is added beside the books, not instead of them',
     /createObjectStore\("images"/.test(js) && /createObjectStore\("books"/.test(js)
     && /var DB_V = 2;/.test(js),
     'both stores, version two');

  /* --- a page that words its instruction its own way ----------------------

     "Do the following statements agree with the information given in the
     Reading Passage?" and "Do the statements below agree with the information
     provided in the Reading Passage?" are the same instruction. A recogniser
     tied to the first read the second as a question, left the task unopened,
     and then had nothing to tell it the three words under each statement were
     buttons — so they were read as part of the statement.

     The words are the surer sign. A page may word its instruction any way at
     all; a statement to be judged is always followed by TRUE, FALSE and NOT
     GIVEN, because those were the three things to press. */
  const OTHERWORDS = [
    'Do the statements below agree with the information provided in the Reading Passage?',
    '',
    '7.',
    'The first claim is one the passage supports.',
    '',
    'TRUE',
    'FALSE',
    'NOT GIVEN',
    '8.',
    'The second claim is one the passage says nothing about.',
    '',
    'TRUE',
    'FALSE',
    'NOT GIVEN',
    '',
    'Answer the questions below, using NO MORE THAN TWO WORDS for each answer.',
    '',
    '9.',
    'What was found at the site?',
  ].join('\n');

  const other = mk(null, unlockedStore());
  await wait(900);
  click(other.window, tabQ(other));
  await wait(50);
  click(other.window, other.doc.getElementById('add-word'));
  await wait(40);
  other.doc.getElementById('quiz-body').value = OTHERWORDS;
  click(other.window, other.doc.getElementById('quiz-tidy'));
  await wait(60);
  const got = other.doc.getElementById('quiz-body').value;

  ok('an instruction worded another way is still an instruction',
     /^! Do the statements below agree/m.test(got),
     got.split('\n')[0]);
  ok('  and the three words under each statement say what the task is',
     /^\? tfng 7$/m.test(got), (got.match(/^\?.*$/gm) || []).join(' | '));
  ok('  so they are left out of the statements rather than read as part of them',
     !/TRUE|FALSE|NOT GIVEN/.test(got)
     && /^The first claim is one the passage supports\. = $/m.test(got),
     (got.match(/^The first.*$/m) || [])[0]);
  ok('  and the task after it is read as its own, numbered on from there',
     /^\? short$/m.test(got) && /^What was found at the site\? =/m.test(got),
     (got.match(/^\?.*$/gm) || []).join(' | '));

  /* Where a page prints the three on the end of the statement instead of
     under it, they are still not part of what is being judged. */
  other.doc.getElementById('quiz-body').value =
    'Some statement about the passage. TRUE FALSE NOT GIVEN\n'
    + 'Another statement about it. TRUE FALSE NOT GIVEN';
  click(other.window, other.doc.getElementById('quiz-tidy'));
  await wait(60);
  const inline = other.doc.getElementById('quiz-body').value;
  ok('the same three printed on the end of a statement are taken off it too',
     /^\? tfng$/m.test(inline)
     && /^Some statement about the passage\. = $/m.test(inline),
     inline.replace(/\n/g, ' | '));

  /* --- matching headings -------------------------------------------------

     A list of headings is numbered i to viii, which is three characters
     where a box of words is one, and it arrives as a single line: the page
     set the list out as a block and the clipboard took the block as a
     paragraph. So the instruction, the word that introduces the list, and
     all eight headings come across run together, and the whole thing read as
     one enormous question with nothing to answer it. */
  const HEADS = [
    'The Reading Passage has six sections, A-F. Choose the correct heading '
      + 'for each section from the list of headings below. Headings '
      + 'i. The first one here ii. The second one here iii. The third one here '
      + 'iv. The fourth one here v. The fifth one here vi. The sixth one here',
    '',
    '27.',
    'Section A --',
    '28.',
    'Section B --',
  ].join('\n');

  const heads = mk(null, unlockedStore());
  await wait(900);
  click(heads.window, tabQ(heads));
  await wait(50);
  click(heads.window, heads.doc.getElementById('add-word'));
  await wait(40);
  heads.doc.getElementById('quiz-body').value = HEADS;
  click(heads.window, heads.doc.getElementById('quiz-tidy'));
  await wait(80);
  const hgot = heads.doc.getElementById('quiz-body').value;

  ok('a list of headings run together with its instruction comes apart again',
     /^\? match 27$/m.test(hgot)
     && (hgot.match(/^\* /gm) || []).length === 6,
     (hgot.match(/^\* .*/gm) || []).length + ' headings');
  ok('  the instruction keeping the words that are the instruction',
     /^! The Reading Passage has six sections, A-F\./m.test(hgot)
     && !/^!.*The first one here/m.test(hgot)
     && !/^!.*\bHeadings\s*$/m.test(hgot),
     (hgot.match(/^!.*/m) || [])[0].slice(-40));
  ok('  and each heading keeping the numeral it was written with',
     /^\* i\. The first one here$/m.test(hgot)
     && /^\* vi\. The sixth one here$/m.test(hgot),
     (hgot.match(/^\* .*/gm) || []).slice(0, 2).join(' | '));
  ok('  with the box the page left for the answer taken off the question',
     /^Section A = $/m.test(hgot) && !/--/.test(hgot),
     (hgot.match(/^Section A.*/m) || [])[0]);

  ok('the numerals are what the sections are answered with, as written',
     [...heads.doc.querySelectorAll('#quiz-preview .bank-l')]
       .map(n => n.textContent).join(',') === 'i,ii,iii,iv,v,vi',
     [...heads.doc.querySelectorAll('#quiz-preview .bank-l')]
       .map(n => n.textContent).join(','));
  /* Six of them is past the four a row of buttons can carry, so a section
     is answered from a list — which is what the paper does too. */
  ok('  and i is i rather than I, a numeral being not quite a letter',
     [...heads.doc.querySelectorAll('#quiz-preview .opts select')[0].options]
       .map(o => o.value).filter(Boolean).join(',') === 'i,ii,iii,iv,v,vi',
     [...heads.doc.querySelectorAll('#quiz-preview .opts select')[0].options]
       .map(o => o.value).join(','));

  /* Two numerals in a sentence are two numerals in a sentence. */
  heads.doc.getElementById('quiz-body').value =
    '? tfng\nThe i. and ii. in this sentence are not a list of headings. = T';
  click(heads.window, heads.doc.getElementById('quiz-tidy'));
  await wait(40);
  ok('two numerals in a line are not a list, and nothing is broken over them',
     /already written in marks/.test(heads.doc.getElementById('quiz-msg').textContent),
     heads.doc.getElementById('quiz-msg').textContent.slice(0, 40));

  /* --- a heading list set out one to a line ------------------------------

     The same list, copied off a page that set each heading on its own line
     rather than running them together. Only the one-character numerals — i
     and v — were read as labels, because the thing that read a label could
     read one character; the other six fell through, and six sections came
     out with two headings to choose between. */
  const DOWN = [
    'Choose the correct heading for each section from the list below.',
    '',
    'Headings',
    'i. The first heading goes here',
    'ii. The second heading goes here',
    'iii. The third heading goes here',
    'iv. The fourth heading goes here',
    'v. The fifth heading goes here',
    'vi. The sixth heading goes here',
    '',
    '27.',
    'Section A --',
    '28.',
    'Section B --',
  ].join('\n');

  const listed = mk(null, unlockedStore());
  await wait(900);
  click(listed.window, tabQ(listed));
  await wait(50);
  click(listed.window, listed.doc.getElementById('add-word'));
  await wait(40);
  listed.doc.getElementById('quiz-body').value = DOWN;
  click(listed.window, listed.doc.getElementById('quiz-tidy'));
  await wait(80);
  const dgot = listed.doc.getElementById('quiz-body').value;

  ok('a heading to a line is read as a heading, numeral and all',
     (dgot.match(/^\* /gm) || []).length === 6
     && /^\* vi\. The sixth heading goes here$/m.test(dgot),
     (dgot.match(/^\* .*/gm) || []).length + ' read');
  ok('  and the word that introduces the list is not one of the questions',
     !/^Headings/m.test(dgot) && /^Section A = $/m.test(dgot),
     (dgot.match(/^Section A.*/m) || [])[0] || 'missing');
  ok('  so the sections are numbered from where the page numbered them',
     nums(listed).length === 0 && /27–28/.test(listed.doc.getElementById('quiz-tally').textContent),
     listed.doc.getElementById('quiz-tally').textContent);

  /* --- eight of them is a list to choose from, not a wall of buttons ------

     Three words to judge a statement by are three buttons and read as three
     buttons. Eight headings against six sections are forty-eight, and a
     paper does not print them that way either: it prints the list once,
     above, and leaves a box to write the number in. */
  ok('past four bare labels the answer is chosen from a list',
     listed.doc.querySelectorAll('#quiz-preview .opts select').length === 2
     && listed.doc.querySelectorAll('#quiz-preview .opt').length === 0,
     listed.doc.querySelectorAll('#quiz-preview .opts select').length + ' lists, '
       + listed.doc.querySelectorAll('#quiz-preview .opt').length + ' buttons');
  ok('  carrying every heading there is, as written',
     [...listed.doc.querySelector('#quiz-preview .opts select').options]
       .map(o => o.value).filter(Boolean).join(',') === 'i,ii,iii,iv,v,vi',
     [...listed.doc.querySelector('#quiz-preview .opts select').options]
       .map(o => o.value).filter(Boolean).join(','));

  listed.doc.getElementById('quiz-body').value =
    '? tfng\nA statement to judge. = T\n\n? choice\nA question? = A\n'
    + '- The first answer\n- The second answer';
  listed.doc.getElementById('quiz-body')
    .dispatchEvent(new listed.window.Event('input'));
  await wait(300);
  ok('  while three words, and answers that carry their own, stay buttons',
     listed.doc.querySelectorAll('#quiz-preview .opts select').length === 0
     && listed.doc.querySelectorAll('#quiz-preview .opt').length === 5,
     listed.doc.querySelectorAll('#quiz-preview .opt').length + ' buttons');

  /* --- a set an older build left in a mess -------------------------------

     A set written before any of this knew a numeral could be a label
     carries the whole list of headings glued to the end of a question, and
     the dashes a page drew its answer boxes with left in the words. Tidy
     refused to look at it, because it was already in marks — and said there
     was nothing to put right, over a set the reader could see was wrong.

     Re-reading the whole thing is not on offer: the answers in it were typed
     by hand. So only what is unmistakably wrong is put right, and every
     other line is left exactly as it stands. */
  const STUCK = [
    '? short 27',
    'The Reading Passage has six sections, A-F. Choose the correct heading '
      + 'for each from the list below. Headings i. The first one here '
      + 'ii. The second one here iii. The third one here iv. The fourth one '
      + 'here v. The fifth one here vi. The sixth one here = ',
    'Section A -- = ',
    'Section B -- = ',
    '',
    '! Choose the correct letter.',
    '? choice',
    'What is the purpose of Section A? = B',
    '- A. offering a solution',
    '- B. defending a viewpoint',
  ].join('\n');

  const stuck = mk(null, unlockedStore());
  await wait(900);
  click(stuck.window, tabQ(stuck));
  await wait(50);
  click(stuck.window, stuck.doc.getElementById('add-word'));
  await wait(40);
  stuck.doc.getElementById('quiz-body').value = STUCK;
  click(stuck.window, stuck.doc.getElementById('quiz-tidy'));
  await wait(80);
  const sgot = stuck.doc.getElementById('quiz-body').value;

  ok('a set already in marks is looked at before it is said to be fine',
     /put right/.test(stuck.doc.getElementById('quiz-msg').textContent),
     stuck.doc.getElementById('quiz-msg').textContent);
  ok('  the list of headings glued to a question is set out as a list',
     (sgot.match(/^\* /gm) || []).length === 6 && /^\? match 27$/m.test(sgot),
     (sgot.match(/^\?.*/gm) || []).join(' | '));
  ok('  with the words in front of it kept as the instruction they are',
     /^! The Reading Passage has six sections/m.test(sgot)
     && !/^!.*The first one here/m.test(sgot),
     (sgot.match(/^!.*/m) || [])[0].slice(0, 46));
  ok('  and the box a page drew taken out of the words',
     /^Section A = $/m.test(sgot) && !/--/.test(sgot),
     (sgot.match(/^Section A.*/m) || [])[0]);

  /* The point of doing only this much. */
  ok('everything else is left exactly as it stands, answers and all',
     /^What is the purpose of Section A\? = B$/m.test(sgot)
     && /^- A\. offering a solution$/m.test(sgot)
     && /^! Choose the correct letter\.$/m.test(sgot),
     (sgot.match(/^What is.*/m) || [])[0]);
  ok('  so the answer that was typed is still the answer',
     /3 questions/.test(stuck.doc.getElementById('quiz-tally').textContent)
     && /2 unanswered/.test(stuck.doc.getElementById('quiz-tally').textContent),
     stuck.doc.getElementById('quiz-tally').textContent);

  click(stuck.window, stuck.doc.getElementById('quiz-tidy'));
  await wait(60);
  ok('and a set with nothing wrong in it is told so, rather than read again',
     /nothing in it needs putting right/
       .test(stuck.doc.getElementById('quiz-msg').textContent)
     && stuck.doc.getElementById('quiz-body').value === sgot,
     stuck.doc.getElementById('quiz-msg').textContent.slice(0, 46));

  /* --- labelling a diagram ------------------------------------------------

     The one task where the answer comes before the words: a box, then what
     the box is labelling. A page draws that box and writes something faint
     inside to show it is a box — three dots — and copying the page copies
     the dots, because the dots are the only part of a box that is text.

     Read as words they became part of the label; and the label itself, being
     short and carrying no full stop, was then read as a title over a set of
     notes, which ate every line and left nothing anybody could answer. */
  const LABELS = [
    'Label the diagrams below using ONE WORD ONLY for each answer.',
    '',
    '1.',
    '...',
    'Markers set out over a hillside to keep the tunnel on its route',
    '2.',
    '...',
    'Waterway that receives the flow from the outlet',
  ].join('\n');

  const lab = mk(null, unlockedStore());
  await wait(900);
  click(lab.window, tabQ(lab));
  await wait(50);
  click(lab.window, lab.doc.getElementById('add-word'));
  await wait(40);
  lab.doc.getElementById('quiz-body').value = LABELS;
  click(lab.window, lab.doc.getElementById('quiz-tidy'));
  await wait(80);
  const lgot = lab.doc.getElementById('quiz-body').value;

  ok('"Label the diagrams below" is an instruction, not question one',
     /^! Label the diagrams below/m.test(lgot) && /^\? notes$/m.test(lgot),
     lgot.split('\n').slice(0, 2).join(' / '));
  ok('  the box a page drew is read as the box it was, not as three dots',
     !/\.\.\./.test(lgot)
     && /^- ___\{\} Markers set out over a hillside/m.test(lgot),
     (lgot.match(/^- .*/m) || [])[0]);
  ok('  standing in front of what it labels, which is where the page had it',
     (lgot.match(/^- ___\{\} /gm) || []).length === 2,
     (lgot.match(/^- ___\{\} .*/gm) || []).length + ' labelled');
  ok('  and a short label is not read as a title over the rest of them',
     !/^# /m.test(lgot), lgot.replace(/\n/g, ' | ').slice(0, 60));

  ok('each label is a question, numbered from where the page numbered it',
     lab.doc.querySelectorAll('#quiz-preview .gap').length === 2
     && [...lab.doc.querySelectorAll('#quiz-preview .gap-n')]
          .map(n => n.textContent).join(',') === '1,2',
     [...lab.doc.querySelectorAll('#quiz-preview .gap-n')]
       .map(n => n.textContent).join(','));
  ok('  with the box in front of the words, as the paper has it',
     /^1\s+Markers set out/.test(
       lab.doc.querySelector('#quiz-preview .qline').textContent.trim()),
     lab.doc.querySelector('#quiz-preview .qline').textContent.trim().slice(0, 40));

  /* A title over a set of notes is still a title where no box precedes it. */
  lab.doc.getElementById('quiz-body').value =
    'Complete the notes below.\nThe Uffington White Horse\n'
    + 'close to a trackway called the ...\nRidgeway';
  click(lab.window, lab.doc.getElementById('quiz-tidy'));
  await wait(60);
  ok('a short line with no box in front of it is still a title',
     /^# The Uffington White Horse$/m.test(lab.doc.getElementById('quiz-body').value),
     lab.doc.getElementById('quiz-body').value.replace(/\n/g, ' | ').slice(0, 70));

  /* --- asked before anything is typed, not found out by a failed save -----

     The script in a sheet is a copy taken by hand and deployed by hand, so it
     is older than the page whenever the page has learnt something new. The
     page cannot tell from here; it can only ask for the new thing and be
     refused, and that refusal used to arrive after fourteen questions had
     been typed. */
  function pings(reply) {
    const g = mk(null, unlockedStore(CFG));
    g.window.fetch = (url, init) => {
      const body = JSON.parse((init && init.body) || '{}');
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(body.action === 'ping' ? reply : { ok: true }),
      });
    };
    return g;
  }

  const stale = pings({ ok: true, pong: true, script: 'x', ai: '' });
  await wait(900);
  click(stale.window, tabQ(stale));
  await wait(50);
  click(stale.window, stale.doc.getElementById('add-word'));
  await wait(120);
  ok('a script that did not say it can file questions is said so, as the form opens',
     /may be older than the page/.test(stale.doc.getElementById('quiz-msg').textContent),
     stale.doc.getElementById('quiz-msg').textContent.slice(0, 60));
  /* A missing field is weak evidence — a script one line older than the field
     can still file questions perfectly well — and weak evidence does not get
     to stop the save. It need not: a save that fails says why and keeps the
     work here regardless. */
  ok('  but the tick stays on, because saying so might be wrong',
     stale.doc.getElementById('quiz-to-sheet').checked === true, 'still ticked');

  const fresh = pings({ ok: true, pong: true, script: 'x', can: ['questions'], ai: '' });
  await wait(900);
  click(fresh.window, tabQ(fresh));
  await wait(50);
  click(fresh.window, fresh.doc.getElementById('add-word'));
  await wait(120);
  ok('a script that can file them says nothing and leaves the tick alone',
     fresh.doc.getElementById('quiz-msg').textContent === ''
     && fresh.doc.getElementById('quiz-to-sheet').checked === true,
     fresh.doc.getElementById('quiz-msg').textContent || 'silent');

  ok('and the script answers the ping with what it knows how to be asked',
     /can: \['questions', 'figures'\]/.test(read('sheet-sync.gs')),
     'the ping carries it');

  /* --- the band between a phone and a laptop ------------------------------

     A window dragged narrower used to put the questions under the passage,
     and under eight hundred words of passage is not somewhere a reader
     answering question 27 about the opening paragraph can reach. From the
     chair it read as the questions having gone.

     jsdom does no layout, so what is checked is the grid the stylesheet asks
     for and the attribute the page hangs it on — which is the whole of the
     mechanism either way. */
  const band = mk(QUIZ, unlockedStore(), { width: 880 });
  await wait(900);
  click(band.window, tabQ(band));
  await wait(50);
  click(band.window, band.doc.querySelector('.hit'));
  await wait(80);
  ok('the split says which pane is standing in it, not only how many',
     band.doc.querySelector('.readsplit').dataset.pane === 'quiz',
     band.doc.querySelector('.readsplit').dataset.pane);

  const css = read('app.css');
  /* There is more than one block at each width — the forms have one of their
     own — so it is the one that lays the split out that is wanted. */
  const block = what => {
    const open = '@media (max-width: ' + what + 'px) {';
    for (let at = css.indexOf(open); at > -1; at = css.indexOf(open, at + 1)) {
      const body = css.slice(at, css.indexOf('\n}\n', at));
      if (body.indexOf('.readsplit') > -1) return body;
    }
    return '';
  };
  ok('between a phone and a laptop the translation stacks and the questions do not',
     /:not\(\[data-pane~="quiz"\]\) \{ grid-template-columns: minmax\(0, 1fr\)/
       .test(block(900))
     && !/^\s*\.readsplit \{ grid-template-columns: minmax\(0, 1fr\)/m.test(block(900)),
     'the questions keep their column');
  ok('  and on a phone they stack too, there being no column to give them',
     /\[data-pane="quiz"\] \{ grid-template-columns: minmax\(0, 1fr\)/.test(block(760)),
     'stacked on a phone');
  /* Answering is not reading one thing after another: it is looking at
     question 31, then at the paragraph it is about, and back. Scrolled
     together, getting down to question 36 took the opening paragraph off the
     screen — and half the questions are about the opening paragraph. */
  const quizRule = (() => {
    // the rule itself, not one of the ones nested in a media query
    const at = css.indexOf('\n.quizpane {');
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  })();
  ok('the questions stand where they are and scroll inside themselves',
     /position: sticky/.test(quizRule) && /max-height:/.test(quizRule),
     quizRule.replace(/\s+/g, ' ').slice(0, 70));
  ok('  so the passage is not dragged along by them',
     /\.quizpane > \.quiz \{[^}]*overflow-y: auto/.test(css),
     'its own scroller');
  ok('  and does not take over when they reach their end',
     /\.quizpane > \.quiz \{[^}]*overscroll-behavior: contain/.test(css),
     'the wheel stays where it was put');
  ok('  except stacked on a phone, where the column is the page',
     /\[data-pane~="quiz"\] \.quizpane \{[^}]*position: static/.test(block(760)),
     'the page scrolls instead');

  ok('  with the column never taking more than half the window it stands in',
     /\[data-pane="quiz"\][\s\S]{0,120}min\(var\(--q-w[^)]*\), 46vw\)/.test(css),
     'clamped');

  done(a.errs.concat(b.errs, c.errs, wide.errs, tight.errs, none.errs,
                     w.errs, back.errs, late.errs, t.errs, d2.errs,
                     old88.errs, down.errs, dark.errs, stale.errs, fresh.errs,
                     band.errs, other.errs, fig.errs, named.errs, heads.errs,
                     lab.errs, listed.errs, stuck.errs));
})();
