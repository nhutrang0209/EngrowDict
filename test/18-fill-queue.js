/* Looking words up without sitting through it.

   Auto Fill used to hold the form until Cambridge and the model had answered,
   which is a long time to look at a form you cannot use. Now the word goes
   into a queue: the form is yours straight away, the answers wait in the tray
   at the corner, and a word still going round can be dropped. Two at a time,
   because each one is its own request to the same Apps Script.

   The stub below hands back a promise per request that the test resolves when
   it chooses, which is the only way to see a queue actually queue. */
const { read, boot, ok, done, wait, click, unlockedStore } = require('./helpers');

const shell = read('docs/index.html');
const CFG = {
  sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC/edit',
  webApp: 'https://script.google.com/macros/s/XYZ/exec',
  key: 'test-key',
};

function draftOf(word, def) {
  return {
    ok: true, source: 'Cambridge', glossed: 1, by: 'Gemini', translated: 0, warning: '',
    entry: {
      type: 'word', word: word, verb: '', particle: '', pos: 'n', ipa: '/x/', note: '',
      senses: [{ def: def, eg: [], vi: 'nghĩa của ' + word }],
    },
  };
}

/* Every POST is held open until the test answers it by word. */
function held() {
  const waiting = [];
  return {
    waiting,
    posts: () => waiting.map(w => w.body),
    inFlight: () => waiting.filter(w => !w.settled).map(w => w.body.word),
    answer(word, reply) {
      const one = waiting.find(w => w.body.word === word && !w.settled);
      if (!one) throw new Error('nothing in flight for ' + word);
      one.settled = true;
      one.resolve({ ok: true, json: () => Promise.resolve(reply) });
    },
    refuse(word, why) {
      const one = waiting.find(w => w.body.word === word && !w.settled);
      one.settled = true;
      one.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: why }) });
    },
    fetch(url, opts) {
      if (!opts || opts.method !== 'POST') return null;
      const body = JSON.parse(opts.body);
      // writing a word into the sheet is not what is under test here
      if (body.action !== 'draft') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      return new Promise(resolve => { waiting.push({ body, resolve, settled: false }); });
    },
  };
}

const rows = (g, id) =>
  [...g.doc.querySelectorAll('#' + id + ' .fill-row')]
    .map(r => r.querySelector('.fill-open').textContent + ':' + r.querySelector('.fill-state').textContent);

const openForm = g => click(g.window, g.doc.getElementById('add-word'));
const type = (g, sel, v) => { g.doc.querySelector(sel).value = v; };

(async () => {
  const net = held();
  const g = boot({
    html: shell, full: true,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    store: unlockedStore(CFG),
    dataFile: 'docs/data.json',
  });
  const realFetch = g.window.fetch;
  g.window.fetch = (url, opts) => net.fetch(url, opts) || realFetch(url, opts);
  await wait(900);
  const { doc, window: w } = g;

  /* --- three words at once, two at a time --------------------------------- */
  openForm(g);
  type(g, '#form-dlg [name=word]', 'abaft');
  type(g, '#fill-next', 'susurrus, thole');
  click(w, doc.getElementById('form-fill'));
  await wait(30);

  ok('the whole list goes into the queue, the word in the form first',
     rows(g, 'form-queue').length === 3 &&
     rows(g, 'form-queue')[0].startsWith('abaft'),
     rows(g, 'form-queue').join(' | '));
  ok('  but only two are in the air at once',
     net.inFlight().join(',') === 'abaft,susurrus', net.inFlight().join(','));
  ok('  the third says it is waiting',
     rows(g, 'form-queue')[2] === 'thole:waiting', rows(g, 'form-queue')[2]);
  ok('  and the box for the rest of the list is emptied',
     doc.getElementById('fill-next').value === '');
  ok('the form is usable while they are looked up',
     doc.getElementById('form-fill').disabled === false &&
     doc.getElementById('form-dlg').open === true);

  /* --- shut the form and carry on ---------------------------------------- */
  doc.getElementById('form-dlg').close();
  await wait(20);
  ok('the tray at the corner shows the queue once the form is shut',
     !doc.getElementById('fill-tray').hidden && rows(g, 'fill-tray-list').length === 3,
     rows(g, 'fill-tray-list').join(' | '));
  ok('  and says how many are still going round',
     doc.getElementById('fill-tray-head').textContent === '3 words being looked up',
     doc.getElementById('fill-tray-head').textContent);

  net.answer('abaft', draftOf('abaft', 'at the back of a ship or boat'));
  await wait(60);
  ok('a word that lands with the form shut waits in the tray, ready',
     rows(g, 'fill-tray-list')[0] === 'abaft:ready' &&
     doc.getElementById('form-dlg').open === false,
     rows(g, 'fill-tray-list').join(' | '));
  ok('  and the one that was waiting starts as soon as a place is free',
     net.inFlight().join(',') === 'susurrus,thole', net.inFlight().join(','));

  /* --- opening what came back -------------------------------------------- */
  click(w, doc.querySelector('#fill-tray-list .fill-open'));
  await wait(40);
  ok('pressing the word opens the form with the draft in it',
     doc.getElementById('form-dlg').open &&
     doc.querySelector('#form-dlg [name=word]').value === 'abaft' &&
     doc.querySelector('#sense-list textarea[name=def]').value ===
       'at the back of a ship or boat',
     doc.querySelector('#sense-list textarea[name=def]').value);
  ok('  with the line under it saying where it came from',
     /Filled from Cambridge/.test(doc.getElementById('form-msg').textContent) &&
     /written by Gemini/.test(doc.getElementById('form-msg').textContent),
     doc.getElementById('form-msg').textContent);
  ok('  and it leaves the queue on the way out',
     rows(g, 'form-queue').map(r => r.split(':')[0]).join(',') === 'susurrus,thole',
     rows(g, 'form-queue').join(' | '));

  /* --- dropping one that is still going round ----------------------------- */
  const before = net.inFlight().length;
  click(w, doc.querySelectorAll('#form-queue .fill-x')[1]);
  await wait(20);
  ok('the × drops a word out of the queue',
     rows(g, 'form-queue').map(r => r.split(':')[0]).join(',') === 'susurrus',
     rows(g, 'form-queue').join(' | '));

  /* an answer that arrives for a dropped word is not put anywhere */
  net.answer('thole', draftOf('thole', 'a pin in the side of a boat'));
  await wait(40);
  ok('  and an answer that arrives for it afterwards is thrown away',
     rows(g, 'form-queue').map(r => r.split(':')[0]).join(',') === 'susurrus' &&
     doc.querySelector('#form-dlg [name=word]').value === 'abaft',
     rows(g, 'form-queue').join(' | '));
  ok('  nothing else was disturbed', before === 2);

  /* --- a word Cambridge does not have ------------------------------------- */
  net.refuse('susurrus', 'No entry for "susurrus" in Cambridge or Merriam-Webster.');
  await wait(60);
  ok('a word nothing has says so in the queue rather than vanishing',
     rows(g, 'form-queue')[0] === 'susurrus:no luck', rows(g, 'form-queue').join(' | '));

  /* --- saving one opens the next that is ready ---------------------------- */
  doc.getElementById('form-dlg').close();
  await wait(20);
  openForm(g);
  type(g, '#form-dlg [name=word]', 'zzz');
  type(g, '#fill-next', '');
  click(w, doc.getElementById('form-fill'));
  await wait(30);
  net.answer('zzz', draftOf('zzz', 'a thing of no account'));
  await wait(60);
  ok('a word that lands while its own form is open goes straight in',
     doc.querySelector('#sense-list textarea[name=def]').value === 'a thing of no account',
     doc.querySelector('#sense-list textarea[name=def]').value);

  click(w, doc.getElementById('form-save'));
  await wait(200);
  ok('saving it opens the next one that came back, without going through the shelf',
     doc.getElementById('form-dlg').open &&
     doc.querySelector('#form-dlg [name=word]').value === 'susurrus',
     doc.querySelector('#form-dlg [name=word]').value + ' / open ' +
       doc.getElementById('form-dlg').open);
  ok('  and the queue is empty at the end of it',
     doc.getElementById('fill-tray').hidden && rows(g, 'form-queue').length === 0);

  done(g.errs);
})();
