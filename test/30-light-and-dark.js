/* A palette to read in.

   The stylesheet had two, and followed the machine. What it lacked was a
   way to disagree with the machine — dark on a laptop set to light, warm
   paper in a bright room, a dimmer page at night. There are five now, and
   the machine's own choice above them. With nothing chosen the machine
   still decides; once a palette is chosen it is kept, and it is applied in
   the head of the page so that nobody who reads in dark is shown a white
   page while the script loads.

   The colours themselves are measured here, not admired: text that is too
   bright on a page that is too dark blooms at the edges, and an hour of
   reading is an hour of squinting. Every palette has to sit inside the
   band, the same way VS Code's own do. */
const { read, boot, ok, done, wait, click } = require('./helpers');

const shell = read('docs/index.html');
const art = read('engrowdict.html');
const css = read('app.css');
const THEME_KEY = 'engrowdict:theme:v1';

const mk = store => boot({
  html: shell, full: true, store: store || {}, width: 1400,
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  dataFile: 'docs/data.json',
});

const btn = g => g.doc.getElementById('theme-btn');
const theme = g => g.doc.documentElement.getAttribute('data-theme');
const rows = g => [...g.doc.querySelectorAll('#theme-menu .theme-item')];
const named = r => r.textContent.replace('✓', '').trim();
const ticked = g => rows(g).filter(r => r.getAttribute('aria-checked') === 'true').map(named);
const metas = g => [...g.doc.querySelectorAll('meta[name=theme-color]')]
  .map(m => m.getAttribute('content'));

(async () => {
  /* --- nothing chosen: the machine decides -------------------------------- */
  const a = mk({});
  await wait(900);
  ok('with nothing chosen the machine decides, and here it reads as light',
     theme(a) === 'paper', String(theme(a)));
  ok('  and nothing is kept, so it keeps following the machine',
     a.store[THEME_KEY] === undefined, String(a.store[THEME_KEY]));

  const wrap = btn(a) && btn(a).parentNode;
  ok('the switch is last in the bar, after Settings, so Sync keeps its place by the gear',
     !!wrap && !wrap.nextElementSibling &&
     !!wrap.previousElementSibling && wrap.previousElementSibling.id === 'settings-btn',
     wrap ? 'after ' + (wrap.previousElementSibling || {}).id : 'no switch');
  ok('  it says what it is, and that it opens a list rather than toggling',
     btn(a).getAttribute('aria-label') === 'Theme' &&
     btn(a).getAttribute('aria-haspopup') === 'true' &&
     btn(a).getAttribute('aria-expanded') === 'false',
     btn(a).getAttribute('aria-label') + ' / haspopup '
       + btn(a).getAttribute('aria-haspopup'));
  ok('  and shows which way the page is lit: a moon, on a light page',
     !!btn(a).querySelector('svg path') && /Theme: System/.test(btn(a).title),
     btn(a).title);

  /* --- what is on offer ---------------------------------------------------- */
  click(a.window, btn(a));
  await wait(20);
  ok('it opens a list of palettes, the machine first and then the five',
     rows(a).map(named).join(', ')
       === 'System, Paper, Sepia, Slate, Nord, Midnight',
     rows(a).map(named).join(', ') || 'nothing');
  ok('  each one shows itself, so grey is not five words for grey',
     rows(a).every(r => !!r.querySelector('.sw')) &&
     rows(a).slice(1).every(r => !!r.querySelector('.sw i')),
     rows(a).filter(r => r.querySelector('.sw')).length + ' of ' + rows(a).length);
  ok('  and the one in use is the one ticked',
     ticked(a).join(', ') === 'System', ticked(a).join(', ') || 'none');

  /* --- choosing ------------------------------------------------------------ */
  click(a.window, rows(a).find(r => named(r) === 'Slate'));
  await wait(30);
  ok('choosing a palette paints the page in it', theme(a) === 'slate', String(theme(a)));
  ok('  and keeps it for the next visit', a.store[THEME_KEY] === 'slate',
     String(a.store[THEME_KEY]));
  ok('  the browser’s own bar is told too, since it reads the meta and not the page',
     metas(a).length > 0 && metas(a).every(c => c === '#151917'),
     metas(a).join(', ') || 'no meta');
  ok('  the button turns into a sun, the page being dark now',
     !!btn(a).querySelector('svg circle') && /Theme: Slate/.test(btn(a).title),
     btn(a).title);
  click(a.window, btn(a));
  await wait(20);
  ok('  and the tick has moved to it', ticked(a).join(', ') === 'Slate',
     ticked(a).join(', ') || 'none');
  /* A tick beside every name says no more than no tick at all: the list
     shipped that way for an afternoon, marked up correctly and unreadable. */
  const showing = r => a.window.getComputedStyle(r.querySelector('.tick')).visibility !== 'hidden';
  ok('    and it is the only tick showing, which is what makes it a tick',
     rows(a).filter(showing).map(named).join(', ') === 'Slate',
     rows(a).filter(showing).map(named).join(', ') || 'none showing');

  click(a.window, rows(a).find(r => named(r) === 'System'));
  await wait(30);
  ok('handing it back to the machine forgets the choice, rather than keeping a third state',
     a.store[THEME_KEY] === undefined && theme(a) === 'paper',
     String(a.store[THEME_KEY]) + ' / ' + theme(a));

  /* --- a later visit -------------------------------------------------------- */
  const b = mk({ [THEME_KEY]: 'nord' });
  await wait(900);
  ok('a later visit opens in the palette that was chosen', theme(b) === 'nord',
     String(theme(b)));

  /* The switch shipped before these had names, and kept "dark" or "light".
     Nobody should have to choose twice because the names changed. */
  const c = mk({ [THEME_KEY]: 'dark' });
  await wait(900);
  ok('a choice made before the palettes had names still opens dark',
     theme(c) === 'slate', String(theme(c)));

  /* --- no white flash -------------------------------------------------------- */
  const head = shell.slice(0, shell.indexOf('<style'));
  ok('the palette is settled in the head, before the stylesheet draws anything',
     head.indexOf(THEME_KEY) > -1 && /setAttribute\("data-theme"/.test(head),
     'read in the head');
  ok('  including the machine’s own, which is the one most readers are on',
     /prefers-color-scheme: dark\)"\)\.matches/.test(head), 'asked in the head');
  ok('  in the artifact copy too', art.slice(0, art.indexOf('<style')).indexOf(THEME_KEY) > -1,
     'read in the artifact head');
  ok('  and the key is one key, read in both places',
     read('app.js').indexOf('"' + THEME_KEY + '"') > -1, THEME_KEY);

  /* --- the colours themselves ------------------------------------------------ */
  const rgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const lin = k => { k /= 255; return k <= 0.04045 ? k / 12.92 : ((k + 0.055) / 1.055) ** 2.4; };
  const lum = h => { const [r, g, bl] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const ratio = (f, g) => (Math.max(lum(f), lum(g)) + 0.05) / (Math.min(lum(f), lum(g)) + 0.05);
  const star = h => { const y = lum(h); return y > 0.008856 ? 116 * y ** (1 / 3) - 16 : 903.3 * y; };

  /* Paper is the stylesheet's base; the rest are written over it. A theme's
     name heads more than one rule — the dark three share their shadows —
     so the palette is the block that says what colour the page is. */
  const blockAt = at => css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  const palette = id => {
    const sel = id === 'paper' ? ':root {' : ':root[data-theme="' + id + '"] {';
    for (let at = css.indexOf(sel); at > -1; at = css.indexOf(sel, at + 1)) {
      if (blockAt(at).indexOf('--ground') > -1) return blockAt(at);
    }
    return '';
  };
  const tone = (id, n) =>
    (new RegExp('--' + n + ':\\s*(#[0-9a-f]{6})').exec(palette(id)) || [])[1];

  const all = ['paper', 'sepia', 'slate', 'nord', 'midnight'];
  ok('all five palettes are in the stylesheet, each with a full set of tones',
     all.every(id => ['ground', 'surface', 'ink', 'muted', 'accent', 'on-accent']
       .every(n => !!tone(id, n))),
     all.filter(id => !tone(id, 'on-accent')).join(', ') || 'all there');

  const dark = { slate: 1, nord: 1, midnight: 1 };
  const off = [];
  for (const id of all) {
    const body = ratio(tone(id, 'ink'), tone(id, 'surface'));
    const lo = dark[id] ? 7 : 9, hi = dark[id] ? 12 : 19;
    if (body < lo || body > hi) off.push(id + ' body ' + body.toFixed(1) + ':1');
    if (ratio(tone(id, 'muted'), tone(id, 'surface')) < 4) off.push(id + ' quiet text');
    if (ratio(tone(id, 'on-accent'), tone(id, 'accent')) < 4.5) off.push(id + ' on the accent');
    if (dark[id] && star(tone(id, 'ink')) > 90) off.push(id + ' text near white');
  }
  ok('every palette is readable, and none of the dark ones glares',
     off.length === 0, off.join('; ') || all.map(id =>
       id + ' ' + ratio(tone(id, 'ink'), tone(id, 'surface')).toFixed(1) + ':1').join(', '));

  ok('  the dark ones keep their text off white, where an editor keeps its own',
     ['slate', 'nord', 'midnight'].every(id => {
       const L = star(tone(id, 'ink'));
       return L >= 68 && L <= 90;
     }),
     ['slate', 'nord', 'midnight'].map(id =>
       id + ' L* ' + star(tone(id, 'ink')).toFixed(0)).join(', '));
  ok('  and their pages off black, which is what white letters bloom against',
     ['slate', 'nord'].every(id => star(tone(id, 'ground')) >= 6),
     ['slate', 'nord', 'midnight'].map(id =>
       id + ' L* ' + star(tone(id, 'ground')).toFixed(1)).join(', '));

  /* One palette, written once. The pair that had to be kept in step was a
     standing invitation to change one and forget the other. */
  ok('each palette is written once, with no second copy to drift from',
     css.split('--ground:').length - 1 === all.length &&
     css.indexOf('prefers-color-scheme: dark') < 0,
     (css.split('--ground:').length - 1) + ' pages for ' + all.length
       + ' palettes, and no media query');
  ok('  and what is legible on the accent is a tone, not a rule per button',
     css.indexOf('color: #') < 0 && css.split('var(--on-accent)').length - 1 >= 6,
     (css.split('var(--on-accent)').length - 1) + ' buttons reading one tone');

  done(a.errs.concat(b.errs, c.errs));
})();
