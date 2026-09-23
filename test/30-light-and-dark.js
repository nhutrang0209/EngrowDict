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
     metas.length > 0 && metas.every(m => m.getAttribute('content') === '#151917'),
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

  /* --- dark that can be read for an hour ------------------------------------
     White letters on a near-black page bloom at their edges, and reading
     through that is an hour of squinting. The first dark palette here was
     16:1 — brighter than anything an editor ships. These hold it where VS
     Code holds its own: a page that is dark grey, text that is light grey,
     about 11:1, which is still well inside AAA. */
  const rgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = h => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (f, b) => (Math.max(lum(f), lum(b)) + 0.05) / (Math.min(lum(f), lum(b)) + 0.05);
  const star = h => { const y = lum(h); return y > 0.008856 ? 116 * y ** (1 / 3) - 16 : 903.3 * y; };

  const forced = css.slice(css.indexOf(':root[data-theme="dark"] {'));
  const tone = n => (new RegExp('--' + n + ':\\s*(#[0-9a-f]{6})').exec(forced) || [])[1];

  const onPane = ratio(tone('ink'), tone('surface'));
  ok('dark text is lighter than its page by about as much as VS Code makes it',
     onPane >= 7 && onPane <= 12, onPane.toFixed(1) + ':1, wanted 7 to 12');
  ok('  the page is dark grey, not the black that white letters bloom against',
     star(tone('ground')) >= 6 && star(tone('ground')) <= 14,
     'L* ' + star(tone('ground')).toFixed(1) + ', wanted 6 to 14');
  ok('  and the text is light grey, not white',
     star(tone('ink')) >= 74 && star(tone('ink')) <= 88,
     'L* ' + star(tone('ink')).toFixed(1) + ', wanted 74 to 88');
  ok('  quiet text is still quiet, and still readable',
     ratio(tone('muted'), tone('surface')) >= 4.5 &&
     ratio(tone('muted'), tone('surface')) < onPane,
     ratio(tone('muted'), tone('surface')).toFixed(1) + ':1');
  ok('  and the ochre and the mark carry against the page as well',
     ratio(tone('term'), tone('surface')) >= 4.5 &&
     ratio(tone('mark'), tone('surface')) >= 4.5,
     'ochre ' + ratio(tone('term'), tone('surface')).toFixed(1)
       + ':1, mark ' + ratio(tone('mark'), tone('surface')).toFixed(1) + ':1');

  /* Two copies of the palette, one for the choice and one for the system.
     They are only worth having if they say the same thing. */
  const tidy = s => s.replace(/\s+/g, ' ').trim();
  const bodyOf = at => tidy(css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at)));
  ok('the forced palette and the one the system gets are the same palette',
     bodyOf(css.indexOf(':root[data-theme="dark"]')) ===
     bodyOf(css.indexOf(':root:not([data-theme="light"])')),
     'in step');

  done(a.errs.concat(b.errs));
})();
