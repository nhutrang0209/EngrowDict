/* Adding several words at once, without waiting for any of them.

   A lookup is Cambridge and a model and takes as long as they take; writing a
   word into the sheet is somebody else's server. Neither is worth watching, so
   pressing Auto Fill or Save word puts the form on the rail down the
   right-hand side and gets on with it. The rail says what each card is doing —
   looking up, in line, writing to the sheet — and the line at the bottom of
   the screen says, in green, when something has finished. Press a card to have
   the form back with whatever arrived while it was away.

   Two lookups at a time. The stub below holds every draft request open until
   the test answers it, which is the only way to watch a queue actually
   queue. */
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
const toastOf = g => g.doc.getElementById('toast');
/* A card is labelled by its word and, once it has one, its part of speech:
   "abaft · n". */
const cardNamed = (g, name) => [...g.doc.querySelectorAll('#card-list .card-open')]
  .find(b => b.querySelector('.card-word').textContent.split(' · ')[0] === name);

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
  const realStub = net.fetch;
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

  /* --- Auto Fill sends the form to the rail with it ----------------------- */
  type(g, '#form-dlg [name=word]', 'abaft');
  type(g, '#form-dlg [name=note]', 'from the boat page');
  press(g, 'form-fill');
  await wait(30);
  ok('Auto Fill sends the word off and the form with it',
     dlg(g).open === false && rail(g).join(' | ') === 'abaft:looking up…',
     rail(g).join(' | '));
  ok('  and it asks for the Vietnamese, since that box is ticked',
     net.asked()[0].vi === true && net.asked()[0].eg === false);

  /* --- and another, and another ------------------------------------------- */
  ask(g, 'susurrus');
  await wait(30);
  ask(g, 'thole');
  await wait(30);
  ok('each Add word starts a clean form, and each Auto Fill parks it',
     dlg(g).open === false &&
     rail(g).join(' | ') === 'abaft:looking up… | susurrus:looking up… | thole:in line',
     rail(g).join(' | '));
  ok('  two go at a time and the third waits its turn',
     net.inFlight().join(',') === 'abaft,susurrus', net.inFlight().join(','));

  /* --- what comes back says so, and waits --------------------------------- */
  net.answer('abaft', draftOf('abaft', 'at the back of a ship or boat'));
  await wait(60);
  ok('a word that comes back is ready on the rail',
     rail(g)[0] === 'abaft:ready' && dlg(g).open === false, rail(g).join(' | '));
  ok('  and says so at the bottom of the screen, in green',
     /abaft came back/.test(toastOf(g).textContent) &&
     toastOf(g).className === 'toast good',
     toastOf(g).textContent + ' / ' + toastOf(g).className);
  ok('  the one waiting starts as soon as a place is free',
     net.inFlight().join(',') === 'susurrus,thole', net.inFlight().join(','));

  click(w, cardNamed(g, 'abaft'));
  await wait(40);
  ok('pressing a card brings the form back with the draft in it',
     dlg(g).open && val(g, '#form-dlg [name=word]') === 'abaft' &&
     val(g, '#sense-list [name=def]') === 'at the back of a ship or boat',
     val(g, '#sense-list [name=def]'));
  ok('  and with what was typed into it before it was sent',
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

  /* --- the three ways of putting a form down ------------------------------ */
  press(g, 'form-hide');
  await wait(20);
  ok('Hide puts it back on the rail with everything in it',
     dlg(g).open === false && rail(g).some(r => r.startsWith('abaft')),
     rail(g).join(' | '));
  click(w, cardNamed(g, 'abaft'));
  await wait(40);
  press(g, 'form-x');
  await wait(20);
  ok('  the × in the corner does the same as Hide', dlg(g).open === false);
  click(w, cardNamed(g, 'abaft'));
  await wait(40);
  dlg(g).dispatchEvent(new w.KeyboardEvent('keydown',
    { key: 'Escape', bubbles: true, cancelable: true }));
  await wait(20);
  ok('  and so does Escape, which a form with no backdrop does not get for free',
     dlg(g).open === false && rail(g).some(r => r.startsWith('abaft')),
     rail(g).join(' | '));

  /* --- throwing one away -------------------------------------------------- */
  const before = net.inFlight().length;
  click(w, [...doc.querySelectorAll('#card-list .card-row')]
    .find(r => /thole/.test(r.textContent)).querySelector('.card-x'));
  await wait(20);
  ok('the × on the rail throws a card away',
     !rail(g).some(r => r.startsWith('thole')), rail(g).join(' | '));
  net.answer('thole', draftOf('thole', 'a pin in the side of a boat'));
  await wait(40);
  ok('  and an answer that arrives for it afterwards is thrown away too',
     !rail(g).some(r => r.startsWith('thole')) && before === 2,
     rail(g).join(' | '));

  /* --- a word nothing has ------------------------------------------------- */
  net.refuse('susurrus', 'No entry for "susurrus" in Cambridge or Merriam-Webster.');
  await wait(60);
  ok('a word neither dictionary has says so on the rail rather than vanishing',
     rail(g).some(r => r === 'susurrus:no luck'), rail(g).join(' | '));
  ok('  and that is not said in green', toastOf(g).className === 'toast',
     toastOf(g).className + ' — ' + toastOf(g).textContent);

  click(w, cardNamed(g, 'susurrus'));
  await wait(40);
  ok('  opening it gives the reason in the form',
     /No entry for/.test(doc.getElementById('form-msg').textContent),
     doc.getElementById('form-msg').textContent);
  press(g, 'form-hide');
  await wait(20);
  [...doc.querySelectorAll('#card-list .card-x')].forEach(x => click(w, x));
  await wait(20);
  ok('the rail empties as its cards are dealt with', doc.getElementById('card-rail').hidden);

  /* --- dragged about like a window ---------------------------------------- */
  press(g, 'add-word');
  const head = doc.getElementById('form-head');
  const grab = (x, y, kind) => head.dispatchEvent(
    new w.MouseEvent(kind, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
  const slide = (x, y, kind) => doc.dispatchEvent(
    new w.MouseEvent(kind, { clientX: x, clientY: y, button: 0, bubbles: true }));

  grab(300, 60, 'mousedown');
  slide(420, 120, 'mousemove');
  slide(420, 120, 'mouseup');
  await wait(30);      // the move is written once a frame, not once a pixel
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

  /* --- and pulled about by its edges --------------------------------------- */
  /* jsdom does no layout, so the form is told what size it is on screen. */
  dlg(g).getBoundingClientRect = () => ({
    left: 100, top: 80, width: 600, height: 400, right: 700, bottom: 480,
  });
  const grip = dir => doc.querySelector('#form-dlg .rs-' + dir);
  const pull = (dir, from, to) => {
    grip(dir).dispatchEvent(new w.MouseEvent('mousedown',
      { clientX: from[0], clientY: from[1], button: 0, bubbles: true, cancelable: true }));
    slide(to[0], to[1], 'mousemove');
    slide(to[0], to[1], 'mouseup');
  };

  pull('e', [700, 280], [900, 280]);
  ok('the right edge makes it wider and leaves the left where it was',
     dlg(g).style.width === '800px' && dlg(g).style.left === '100px',
     dlg(g).style.width + ' at ' + dlg(g).style.left);
  ok('  and a form with a size of its own gives the extra room to the senses',
     dlg(g).classList.contains('sized') && dlg(g).style.height === '400px',
     dlg(g).className + ' ' + dlg(g).style.height);

  pull('w', [100, 280], [220, 280]);
  ok('the left edge narrows it and takes the form with it',
     dlg(g).style.width === '480px' && dlg(g).style.left === '220px',
     dlg(g).style.width + ' at ' + dlg(g).style.left);

  pull('n', [400, 80], [400, 180]);
  ok('the top edge does the same the other way round',
     dlg(g).style.height === '300px' && dlg(g).style.top === '180px',
     dlg(g).style.height + ' at ' + dlg(g).style.top);

  pull('se', [700, 480], [200, 100]);
  ok('  and nothing shrinks past the point of being usable',
     dlg(g).style.width === '380px' && dlg(g).style.height === '260px',
     dlg(g).style.width + ' by ' + dlg(g).style.height);

  head.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  ok('  two taps on the head put it back in the middle, at the size it was',
     dlg(g).style.left === '' && dlg(g).style.transform === '' &&
     dlg(g).style.width === '' && !dlg(g).classList.contains('sized'),
     JSON.stringify(dlg(g).style.left + ',' + dlg(g).style.width));

  press(g, 'form-x');
  await wait(20);
  [...doc.querySelectorAll('#card-list .card-x')].forEach(x => click(w, x));
  await wait(20);

  /* --- a word that is four parts of speech --------------------------------- */
  /* Cambridge stacks an entry body per part of speech and they are still one
     word: they come back as one entry, in one form. */
  ask(g, 'rough');
  await wait(30);
  net.answer('rough', {
    ok: true, source: 'Cambridge', glossed: 3, by: 'Gemini', translated: 0, warning: '',
    entry: { type: 'word', word: 'rough', verb: '', particle: '', pos: 'adj, v, n, adv',
             ipa: '/rʌf/', note: '', senses: [
               { def: 'not even or smooth', eg: [], vi: 'gồ ghề' },
               { def: 'to live temporarily in uncomfortable conditions', eg: [], vi: 'sống tạm bợ' },
               { def: 'a first quick drawing of something', eg: [], vi: 'bản phác' },
             ] },
  });
  await wait(60);
  click(w, cardNamed(g, 'rough'));
  await wait(40);
  ok('every part of speech lands in the one form, listed in the one field',
     val(g, '#form-dlg [name=pos]') === 'adj, v, n, adv',
     val(g, '#form-dlg [name=pos]'));
  ok('  with the senses of all of them under it, in the order the page gives',
     [...doc.querySelectorAll('#sense-list [name=def]')].map(x => x.value).join(' | ') ===
       'not even or smooth | to live temporarily in uncomfortable conditions | a first quick drawing of something',
     doc.querySelectorAll('#sense-list [name=def]').length + ' senses');
  ok('  and nothing else is put on the rail behind it',
     doc.getElementById('card-rail').hidden, rail(g).join(' | '));

  /* --- senses put in the order they matter --------------------------------- */
  const defs = () => [...doc.querySelectorAll('#sense-list [name=def]')].map(x => x.value).join(',');
  const labels = () => [...doc.querySelectorAll('#sense-list .lab')].map(x => x.textContent).join(',');
  const grips = () => [...doc.querySelectorAll('#sense-list .sense-grip')];
  const senseDefs = [...doc.querySelectorAll('#sense-list [name=def]')];
  senseDefs[0].value = 'one';
  senseDefs[1].value = 'two';
  senseDefs[2].value = 'three';
  ok('the senses arrive in the order the dictionary gives them',
     defs() === 'one,two,three', defs());

  grips()[2].dispatchEvent(new w.KeyboardEvent('keydown',
    { key: 'ArrowUp', bubbles: true, cancelable: true }));
  ok('an arrow key on the handle moves a sense up the list',
     defs() === 'one,three,two', defs());
  ok('  and they are renumbered where they land',
     labels() === 'Sense 1,Sense 2,Sense 3', labels());

  /* dragging: jsdom does no layout, so each box is told where it is */
  const boxes = [...doc.querySelectorAll('#sense-list .sense-edit')];
  boxes.forEach((b, i) => {
    Object.defineProperty(b, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100 * i, height: 100, bottom: 100 * i + 100, left: 0, width: 400 }),
    });
  });
  const lifted = boxes[2];
  grips()[2].dispatchEvent(new w.MouseEvent('mousedown',
    { clientY: 250, button: 0, bubbles: true, cancelable: true }));
  ok('  a lifted sense says so while it is held', lifted.classList.contains('lifting'));
  doc.dispatchEvent(new w.MouseEvent('mousemove', { clientY: 10, bubbles: true }));
  doc.dispatchEvent(new w.MouseEvent('mouseup', { clientY: 10, bubbles: true }));
  ok('dragging the handle past the box above puts it above',
     defs() === 'two,one,three', defs());
  ok('  and it is put down again when the mouse is',
     !lifted.classList.contains('lifting'));

  /* a sense wanted between two others goes between them */
  const adds = () => [...doc.querySelectorAll('#sense-list .sense-add')];
  ok('every sense but the last carries a + in the gap under it',
     adds().length === 3 && adds().filter(b => !b.hidden).length === 2,
     adds().map(b => b.hidden).join(','));
  click(w, adds()[0]);
  ok('pressing it puts an empty sense there, not at the end',
     defs() === 'two,,one,three', JSON.stringify(defs()));
  ok('  and everything below is renumbered',
     labels() === 'Sense 1,Sense 2,Sense 3,Sense 4', labels());
  click(w, doc.querySelectorAll('#sense-list .drop')[1]);
  ok('  Remove takes it back out again', defs() === 'two,one,three', defs());

  press(g, 'form-hide');
  await wait(20);
  click(w, cardNamed(g, 'rough'));
  await wait(40);
  ok('the order survives the card being put on the rail and taken back',
     defs() === 'two,one,three', defs());
  press(g, 'form-x');
  await wait(20);
  [...doc.querySelectorAll('#card-list .card-x')].forEach(x => click(w, x));
  await wait(20);

  /* --- Save word puts the form down as well -------------------------------- */
  let letSheetFinish = null;
  const savedTo = [];
  net.fetch = (url, opts) => {
    const body = opts && opts.method === 'POST' && JSON.parse(opts.body);
    if (body && body.action === 'add') {
      savedTo.push(body.entry.word);
      return new Promise(resolve => {
        letSheetFinish = () => resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      });
    }
    return realStub(url, opts);
  };
  g.window.fetch = (url, opts) => net.fetch(url, opts) || realFetch(url, opts);

  press(g, 'add-word');
  type(g, '#form-dlg [name=word]', 'gangland');
  type(g, '#sense-list [name=def]', 'the people and places of violent crime');
  press(g, 'form-save');
  await wait(30);
  ok('Save word sends it off and puts the form down at once',
     dlg(g).open === false && savedTo.join(',') === 'gangland',
     'open ' + dlg(g).open + ', sent ' + savedTo.join(','));
  ok('  the rail says what is happening to it',
     rail(g).some(r => r === 'gangland:writing to the sheet…'), rail(g).join(' | '));

  click(w, cardNamed(g, 'gangland'));
  await wait(40);
  ok('  brought back mid-write it still says so, and cannot be sent twice',
     doc.getElementById('form-save').disabled === true &&
     doc.getElementById('form-save').textContent === 'Writing to the sheet…',
     doc.getElementById('form-save').textContent);
  press(g, 'form-hide');
  await wait(20);

  letSheetFinish();
  await wait(200);
  ok('when the sheet answers, the card leaves the rail',
     !rail(g).some(r => r.startsWith('gangland')), rail(g).join(' | '));
  ok('  and the word said so in green',
     /Wrote “gangland” into the sheet/.test(toastOf(g).textContent) &&
     toastOf(g).className === 'toast good',
     toastOf(g).textContent + ' / ' + toastOf(g).className);
  ok('  with no form dragged open behind it', dlg(g).open === false);
  net.fetch = realStub;          // the sheet answers straight away again

  /* --- a word added while a passage is being read --------------------------
     Saving one used to select it in whatever list was on screen. In the
     passages that is a word among passages, which is nothing: the passage went
     blank and the place in it was lost. */
  click(w, doc.getElementById('tab-passages'));
  await wait(40);
  click(w, doc.querySelector('.hit'));
  await wait(60);
  const paras = () => doc.querySelectorAll('.read .prose p').length;
  const reading = paras();
  ok('a passage is open and has its paragraphs', reading > 0, reading + ' paragraphs');

  press(g, 'add-word');
  type(g, '#form-dlg [name=word]', 'parole officer');
  type(g, '#sense-list [name=def]', 'the officer who supervises a released prisoner');
  type(g, '#sense-list [name=vi]', 'cán bộ quản chế');
  press(g, 'form-save');
  await wait(250);
  ok('saving a word from a passage leaves the passage where it was',
     paras() === reading && doc.body.dataset.view === 'detail',
     paras() + ' paragraphs, view ' + doc.body.dataset.view);
  ok('  and says so rather than saying something went wrong',
     /parole officer/.test(toastOf(g).textContent) &&
     !/went wrong/.test(toastOf(g).textContent),
     toastOf(g).textContent);
  ok('  with nothing thrown along the way', g.errs.length === 0, JSON.stringify(g.errs));

  done(g.errs);
})();
