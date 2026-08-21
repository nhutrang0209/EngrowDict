/* Adding several words at once, without waiting for any of them.

   A lookup is Cambridge and a model and takes as long as they take. So the
   form is a card: Hide puts it on the rail down the right-hand side with its
   lookup still going, Add word opens another, and pressing a card on the rail
   brings it back with whatever arrived while it was away. Two lookups at a
   time; the rest wait in line.

   The stub below holds every draft request open until the test answers it,
   which is the only way to watch a queue actually queue. */
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
      senses: [{ def: def, eg: ['an example of ' + word], vi: 'nghĩa của ' + word }],
    },
  };
}

function held() {
  const waiting = [];
  return {
    inFlight: () => waiting.filter(w => !w.settled).map(w => w.body.word),
    asked: () => waiting.map(w => w.body),
    answer(word, reply) {
      const one = waiting.find(w => w.body.word === word && !w.settled);
      if (!one) throw new Error('nothing in flight for ' + word);
      one.settled = true;
      one.resolve({ ok: true, json: () => Promise.resolve(reply) });
    },
    refuse(word, why) {
      const one = waiting.find(w => w.body.word === word && !w.settled);
      if (!one) throw new Error('nothing in flight for ' + word);
      one.settled = true;
      one.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: why }) });
    },
    fetch(url, opts) {
      if (!opts || opts.method !== 'POST') return null;
      const body = JSON.parse(opts.body);
      // writing the word into the sheet is not what is under test here
      if (body.action !== 'draft') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      return new Promise(resolve => { waiting.push({ body, resolve, settled: false }); });
    },
  };
}

const rail = g => [...g.doc.querySelectorAll('#card-list .card-row')]
  .map(r => r.querySelector('.card-word').textContent + ':' +
            r.querySelector('.card-state').textContent);
const dlg = g => g.doc.getElementById('form-dlg');
const val = (g, sel) => g.doc.querySelector(sel).value;
const type = (g, sel, v) => { g.doc.querySelector(sel).value = v; };
const press = (g, id) => click(g.window, g.doc.getElementById(id));

/** Open a form, type a word, and press Auto Fill. */
function ask(g, word) {
  press(g, 'add-word');
  type(g, '#form-dlg [name=word]', word);
  press(g, 'form-fill');
}

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

  /* --- the boxes the lookup is asked with --------------------------------- */
  press(g, 'add-word');
  ok('the Vietnamese meaning is asked for without being asked for',
     doc.getElementById('fill-vi').checked === true &&
     doc.getElementById('fill-eg').checked === false);
  ok('  and the form is shown without a backdrop, so the page stays live',
     dlg(g).open === true && doc.getElementById('card-rail').hidden);

  /* --- one word going round, the form put aside --------------------------- */
  type(g, '#form-dlg [name=word]', 'abaft');
  type(g, '#form-dlg [name=note]', 'from the boat page');
  press(g, 'form-fill');
  await wait(30);
  ok('Auto Fill sends the word off and leaves the form alone',
     net.inFlight().join(',') === 'abaft' &&
     doc.getElementById('form-fill').disabled === false &&
     /Press Hide/.test(doc.getElementById('form-msg').textContent),
     doc.getElementById('form-msg').textContent);
  ok('  and it asks for the Vietnamese, since that box is ticked',
     net.asked()[0].vi === true && net.asked()[0].eg === false);

  press(g, 'form-hide');
  await wait(20);
  ok('Hide puts the form on the rail, still being looked up',
     dlg(g).open === false && rail(g).join(' | ') === 'abaft:looking up…',
     rail(g).join(' | '));

  /* --- a second and a third form, opened over the top of it --------------- */
  ask(g, 'susurrus');
  await wait(30);
  ok('Add word opens another form while the first is still going',
     dlg(g).open && net.inFlight().join(',') === 'abaft,susurrus' &&
     rail(g).join(' | ') === 'abaft:looking up…',
     net.inFlight().join(','));

  ask(g, 'thole');
  await wait(30);
  ok('  and the one it was opened over goes to the rail by itself',
     rail(g).join(' | ') === 'abaft:looking up… | susurrus:looking up…',
     rail(g).join(' | '));
  ok('  the third waits in line, because two go at a time',
     net.inFlight().join(',') === 'abaft,susurrus' &&
     doc.getElementById('form-msg').textContent.length > 0,
     net.inFlight().join(','));

  press(g, 'form-hide');
  await wait(20);
  ok('  all three sit on the rail together',
     rail(g).join(' | ') ===
       'abaft:looking up… | susurrus:looking up… | thole:in line',
     rail(g).join(' | '));

  /* --- what comes back waits in the card ---------------------------------- */
  net.answer('abaft', draftOf('abaft', 'at the back of a ship or boat'));
  await wait(60);
  ok('a word that lands while its form is on the rail says so there',
     rail(g)[0] === 'abaft:ready' && dlg(g).open === false, rail(g).join(' | '));
  ok('  and the one in line starts as soon as a place is free',
     net.inFlight().join(',') === 'susurrus,thole', net.inFlight().join(','));

  click(w, doc.querySelector('#card-list .card-open'));
  await wait(40);
  ok('pressing a card brings the form back with the draft in it',
     dlg(g).open && val(g, '#form-dlg [name=word]') === 'abaft' &&
     val(g, '#sense-list [name=def]') === 'at the back of a ship or boat',
     val(g, '#sense-list [name=def]'));
  ok('  and with what was typed into it before it was hidden',
     val(g, '#form-dlg [name=note]') === 'from the boat page',
     val(g, '#form-dlg [name=note]'));
  ok('  the line underneath says where it came from',
     /Filled from Cambridge/.test(doc.getElementById('form-msg').textContent) &&
     /written by Gemini/.test(doc.getElementById('form-msg').textContent),
     doc.getElementById('form-msg').textContent);
  ok('  the examples stay out, since that box was not ticked',
     !/an example of abaft/.test(val(g, '#sense-list [name=def]')));
  ok('  and the card is off the rail while it is on screen',
     rail(g).map(r => r.split(':')[0]).join(',') === 'susurrus,thole',
     rail(g).join(' | '));

  /* --- throwing one away -------------------------------------------------- */
  click(w, doc.querySelectorAll('#card-list .card-x')[1]);
  await wait(20);
  ok('the × takes a card off the rail',
     rail(g).map(r => r.split(':')[0]).join(',') === 'susurrus', rail(g).join(' | '));
  net.answer('thole', draftOf('thole', 'a pin in the side of a boat'));
  await wait(40);
  ok('  and an answer that arrives for it afterwards is thrown away too',
     rail(g).map(r => r.split(':')[0]).join(',') === 'susurrus' &&
     val(g, '#form-dlg [name=word]') === 'abaft',
     rail(g).join(' | '));

  /* --- a word nothing has ------------------------------------------------- */
  net.refuse('susurrus', 'No entry for "susurrus" in Cambridge or Merriam-Webster.');
  await wait(60);
  ok('a word neither dictionary has says so on the rail rather than vanishing',
     rail(g)[0] === 'susurrus:no luck', rail(g).join(' | '));

  /* --- saving one opens the next that came back --------------------------- */
  press(g, 'form-save');
  await wait(200);
  ok('saving a word opens the next card that is ready',
     dlg(g).open && val(g, '#form-dlg [name=word]') === 'susurrus',
     val(g, '#form-dlg [name=word]') + ' / open ' + dlg(g).open);
  ok('  which is the one nothing had, with the reason in its own line',
     /No entry for/.test(doc.getElementById('form-msg').textContent),
     doc.getElementById('form-msg').textContent);
  ok('  and the rail is empty behind it',
     doc.getElementById('card-rail').hidden, rail(g).join(' | '));

  /* --- dragged about like a window ---------------------------------------- */
  const head = doc.getElementById('form-head');
  const grab = (x, y, kind) => head.dispatchEvent(
    new w.MouseEvent(kind, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
  const slide = (x, y, kind) => doc.dispatchEvent(
    new w.MouseEvent(kind, { clientX: x, clientY: y, button: 0, bubbles: true }));

  grab(300, 60, 'mousedown');
  slide(420, 120, 'mousemove');
  slide(420, 120, 'mouseup');
  ok('the form is dragged by its head, the way a window is',
     dlg(g).style.left === '120px' && dlg(g).style.top === '60px' &&
     dlg(g).style.transform === 'none',
     dlg(g).style.left + ',' + dlg(g).style.top);

  press(g, 'form-hide');
  await wait(20);
  click(w, doc.querySelector('#card-list .card-open'));
  await wait(40);
  ok('  and comes back off the rail where it was left, not in the middle again',
     dlg(g).style.left === '120px' && dlg(g).style.top === '60px',
     dlg(g).style.left + ',' + dlg(g).style.top);

  head.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  ok('  two taps on the head put it back in the middle',
     dlg(g).style.left === '' && dlg(g).style.transform === '',
     JSON.stringify(dlg(g).style.left + ',' + dlg(g).style.transform));

  /* --- Cancel is not Hide -------------------------------------------------- */
  const cancel = [...doc.querySelectorAll('#form-dlg .dlg-foot .btn')]
    .find(b => b.textContent === 'Cancel');
  click(w, cancel);
  await wait(20);
  ok('Cancel throws the form away rather than putting it on the rail',
     dlg(g).open === false && doc.getElementById('card-rail').hidden,
     rail(g).join(' | '));

  done(g.errs);
})();
