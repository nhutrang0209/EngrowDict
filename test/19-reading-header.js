/* The top bar, out of the way while reading.

   On a wide window the tabs, the search and the buttons sit on one line and
   cost nothing. Under 760px they wrap to three lines over the column of text
   that is the whole reason the page was opened, so reading down folds them
   away and turning back brings them out — and the bar takes its space with it,
   or the passage would be read through the gap where it used to be. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');

function reading(width) {
  return boot({
    html: shell, full: true, width: width,
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    dataFile: 'docs/data.json',
  });
}

/* jsdom does no layout, so the bar is told how tall it is. */
function scrollTo(g, y) {
  const box = g.doc.querySelector('.detail');
  box.scrollTop = y;
  box.dispatchEvent(new g.window.Event('scroll'));
}

const barTop = g => g.doc.querySelector('.top').style.marginTop;

async function openPassage(g) {
  click(g.window, g.doc.getElementById('tab-passages'));
  await wait(40);
  click(g.window, g.doc.querySelector('.hit'));
  await wait(60);
  Object.defineProperty(g.doc.querySelector('.top'), 'offsetHeight',
    { value: 128, configurable: true });
}

(async () => {
  /* --- a phone-sized window ------------------------------------------------ */
  const g = reading(420);
  await wait(900);
  await openPassage(g);
  ok('a passage opens with the bar where it always was',
     barTop(g) === '', JSON.stringify(barTop(g)));

  scrollTo(g, 40);
  ok('  a nudge is not a decision: the first screenful keeps it',
     barTop(g) === '', JSON.stringify(barTop(g)));

  scrollTo(g, 400);
  ok('reading down folds the bar away, space and all',
     barTop(g) === '-128px', JSON.stringify(barTop(g)));

  scrollTo(g, 404);
  ok('  a few pixels of wobble leaves it alone',
     barTop(g) === '-128px', JSON.stringify(barTop(g)));

  scrollTo(g, 330);
  ok('turning back brings it out again',
     barTop(g) === '', JSON.stringify(barTop(g)));

  scrollTo(g, 900);
  ok('  and reading on folds it away once more',
     barTop(g) === '-128px', JSON.stringify(barTop(g)));

  scrollTo(g, 20);
  ok('  the top of the passage always has it',
     barTop(g) === '', JSON.stringify(barTop(g)));

  /* --- back out of the passage --------------------------------------------- */
  scrollTo(g, 900);
  const back = [...g.doc.querySelectorAll('.back')].find(b => b.offsetParent !== undefined);
  if (back) click(g.window, back);
  await wait(30);
  ok('stepping back to the list is not done behind a folded bar',
     barTop(g) === '', JSON.stringify(barTop(g)));

  scrollTo(g, 900);
  click(g.window, g.doc.getElementById('tab-dictionary'));
  await wait(40);
  ok('  and neither is changing tab',
     barTop(g) === '', JSON.stringify(barTop(g)));

  /* --- a window wide enough for one line ----------------------------------- */
  const wide = reading(1200);
  await wait(900);
  await openPassage(wide);
  scrollTo(wide, 900);
  ok('a window wide enough for the bar on one line keeps it, however far down',
     barTop(wide) === '', JSON.stringify(barTop(wide)));

  /* --- and the fold is a transition, not a jump ---------------------------- */
  ok('the fold is animated where the bar wraps, and only there',
     /@media \(max-width: 760px\)[\s\S]*\.top \{ transition: margin-top/.test(read('app.css')));

  done(g.errs.concat(wide.errs));
})();
