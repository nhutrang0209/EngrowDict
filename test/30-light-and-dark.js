/* A switch between light and dark.

   The stylesheet has had both palettes all along and followed the machine.
   What it lacked was a way to disagree with the system: dark on a laptop set
   to light, light on a phone set to dark. With no choice made the system still
   decides; once one is made it is kept, and it is applied in the head of the
   page so that nobody who chose dark is shown a white page while it loads. */
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

(async () => {
  /* --- nothing chosen: the system decides ---------------------------------- */
  const a = mk({});
  await wait(900);
  ok('with nothing chosen the page does not override the system',
     theme(a) === null, String(theme(a)));
  ok('the switch is last in the bar, after Settings, so Sync keeps its place by the gear',
     !!btn(a) && !!btn(a).previousElementSibling &&
     btn(a).previousElementSibling.id === 'settings-btn' && !btn(a).nextElementSibling,
     btn(a) ? 'after ' + (btn(a).previousElementSibling || {}).id : 'no switch');
  ok('  says whether dark is on, the way a switch should to a screen reader',
     btn(a).getAttribute('aria-label') === 'Dark mode' &&
     btn(a).getAttribute('aria-pressed') === 'false',
     btn(a).getAttribute('aria-label') + ' / pressed ' + btn(a).getAttribute('aria-pressed'));
  ok('  and shows where it goes: a moon, while it is light',
     /Switch to dark mode/.test(btn(a).title) && !!btn(a).querySelector('svg path'),
     btn(a).title);

  /* --- choosing ------------------------------------------------------------- */
  click(a.window, btn(a));
  await wait(20);
  ok('pressing it turns the page dark', theme(a) === 'dark', String(theme(a)));
  ok('  keeps the choice for the next visit', a.store[THEME_KEY] === 'dark',
     String(a.store[THEME_KEY]));
  ok('  and turns into a sun, with dark now on',
     btn(a).getAttribute('aria-pressed') === 'true' &&
     /Switch to light mode/.test(btn(a).title) && !!btn(a).querySelector('svg circle'),
     btn(a).title);
  const metas = [...a.doc.querySelectorAll('meta[name=theme-color]')];
  ok('  the browser’s own bar is told as well, since it reads the meta and not the page',
     metas.length > 0 && metas.every(m => m.getAttribute('content') === '#0a0f0c'),
     metas.map(m => m.getAttribute('content')).join(', ') || 'no meta');

  click(a.window, btn(a));
  await wait(20);
  ok('pressing it again turns it light, and keeps that instead',
     theme(a) === 'light' && a.store[THEME_KEY] === 'light',
     theme(a) + ' / ' + a.store[THEME_KEY]);

  /* --- a later visit --------------------------------------------------------- */
  const b = mk({ [THEME_KEY]: 'dark' });
  await wait(900);
  ok('a later visit opens in the mode that was chosen', theme(b) === 'dark',
     String(theme(b)));
  ok('  with the switch showing it', btn(b).getAttribute('aria-pressed') === 'true',
     btn(b).getAttribute('aria-pressed'));

  /* --- no white flash -------------------------------------------------------- */
  const head = shell.slice(0, shell.indexOf('<style'));
  ok('the choice is applied in the head, before the stylesheet draws anything',
     head.indexOf(THEME_KEY) > -1 && /setAttribute\("data-theme"/.test(head),
     'read in the head');
  ok('  in the artifact copy too', art.slice(0, art.indexOf('<style')).indexOf(THEME_KEY) > -1,
     'read in the artifact head');
  ok('  and the key is one key, read in both places',
     read('app.js').indexOf('"' + THEME_KEY + '"') > -1, THEME_KEY);

  /* --- the palettes it switches between -------------------------------------- */
  ok('both palettes are there to switch between, and the system still has its say',
     /:root\[data-theme="dark"\] \{/.test(css) &&
     /:root:not\(\[data-theme="light"\]\)/.test(css),
     'dark forced, light forced, and the system between');

  done(a.errs.concat(b.errs));
})();
