/* The top bar, out of the way while reading.

   On a wide window the tabs, the search and the buttons sit on one line and
   cost nothing. Under 760px they wrap to three lines over the column of text
   the page was opened for, so the bar gets out of the way — by being lifted
   out of the flow and slid, one pixel for each pixel the thumb moved, while
   the passage reads underneath it. The passage itself never moves: two things
   moving at once for one gesture is what made the first attempt unbearable. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const BAR = 132;

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

const bar = g => g.doc.querySelector('.top');
const lift = g => bar(g).style.transform;
const settling = g => bar(g).classList.contains('settling');

async function openPassage(g) {
  click(g.window, g.doc.getElementById('tab-passages'));
  await wait(40);
  click(g.window, g.doc.querySelector('.hit'));
  await wait(60);
  Object.defineProperty(bar(g), 'offsetHeight', { value: BAR, configurable: true });
}

(async () => {
  /* --- a phone-sized window ------------------------------------------------ */
  const g = reading(420);
  await wait(900);
  await openPassage(g);
  scrollTo(g, 0);
  ok('a passage opens with the bar where it always was',
     lift(g) === '', JSON.stringify(lift(g)));
  ok('  and the bar hands its height to the stylesheet, which cannot measure it',
     g.doc.getElementById('app').style.getPropertyValue('--bar-h') === BAR + 'px',
     g.doc.getElementById('app').style.getPropertyValue('--bar-h'));

  scrollTo(g, 100);
  ok('  the first screenful belongs to the bar: nothing gained by hiding it there',
     lift(g) === '', JSON.stringify(lift(g)));

  scrollTo(g, 190);
  ok('past that it follows the thumb, pixel for pixel',
     lift(g) === 'translateY(-90px)', lift(g));
  ok('  without animating, or it would lag behind the finger',
     settling(g) === false);

  scrollTo(g, 230);
  ok('  further down, further up, and no further than its own height',
     lift(g) === 'translateY(-130px)', lift(g));
  scrollTo(g, 400);
  ok('  once it is gone it stays gone',
     lift(g) === 'translateY(-132px)', lift(g));

  scrollTo(g, 380);
  ok('turning back brings it down by what was turned back',
     lift(g) === 'translateY(-112px)', lift(g));

  await wait(200);
  ok('  and when the scrolling stops it settles the short way, animated',
     lift(g) === 'translateY(-132px)' && settling(g) === true, lift(g));

  scrollTo(g, 300);
  await wait(200);
  ok('  the other short way when that is the short way',
     lift(g) === '' && settling(g) === true, JSON.stringify(lift(g)));

  scrollTo(g, 40);
  ok('the top of the passage always has it', lift(g) === '', JSON.stringify(lift(g)));

  /* --- back out of the passage --------------------------------------------- */
  scrollTo(g, 400);
  click(g.window, g.doc.getElementById('tab-dictionary'));
  await wait(40);
  ok('changing tab is not done behind a bar that is half gone',
     lift(g) === '', JSON.stringify(lift(g)));

  /* --- a window wide enough for one line ----------------------------------- */
  const wide = reading(1200);
  await wait(900);
  await openPassage(wide);
  scrollTo(wide, 900);
  ok('a window wide enough for the bar on one line keeps it, however far down',
     lift(wide) === '', JSON.stringify(lift(wide)));

  /* --- and the passage is not moved by any of it --------------------------- */
  const css = read('app.css');
  ok('under that breakpoint the bar is out of the flow, so nothing else moves',
     /@media \(max-width: 760px\)[\s\S]*\.top \{\s*position: fixed/.test(css));
  ok('  and the passage is padded past it rather than pushed by it',
     /body\[data-view="detail"\] \.detail-inner \{ padding-top: calc\(26px \+ var\(--bar-h/
       .test(css));

  done(g.errs.concat(wide.errs));
})();
