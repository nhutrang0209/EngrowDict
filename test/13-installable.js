/* The static copy as something you can install on a phone.

   What makes it installable is three files beside index.html and a handful of
   tags inside it. None of that shows up in the page's own behaviour, so it is
   checked here rather than left to be noticed missing on a phone. */
const fs = require('fs');
const path = require('path');
const { ROOT, read, boot, ok, done, wait, click, unlockedStore } = require('./helpers');

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** Width and height straight out of the PNG header. */
function pngSize(rel) {
  const b = fs.readFileSync(path.join(ROOT, rel));
  const magic = b.slice(0, 8).toString('hex');
  if (magic !== '89504e470d0a1a0a') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

(async () => {
  const index = read('docs/index.html');
  const artifact = read('engrowdict.html');
  const sw = read('docs/sw.js');
  const manifest = JSON.parse(read('docs/manifest.webmanifest'));

  // --- the manifest -------------------------------------------------------
  ok('the manifest names the app and asks for a window of its own',
     manifest.name === 'EngrowDict' && manifest.display === 'standalone' &&
     manifest.start_url === './' && manifest.scope === './',
     manifest.display + ' ' + manifest.start_url);
  ok('  its icons are all present, and one is maskable for Android',
     manifest.icons.every(i => !!pngSize('docs/' + i.src)) &&
     manifest.icons.some(i => i.purpose === 'maskable'),
     manifest.icons.map(i => i.src).join(' '));
  ok('  the icons are the sizes they claim',
     manifest.icons.every(i => {
       const got = pngSize('docs/' + i.src);
       return i.sizes === got.w + 'x' + got.h;
     }));
  ok('  and iOS gets its own 180px one, which it takes from a link tag',
     pngSize('docs/icon-180.png').w === 180 &&
     /<link rel="apple-touch-icon" href="icon-180\.png">/.test(index));

  // --- what iOS in particular needs ---------------------------------------
  ok('the page asks iOS for a full screen',
     /<meta name="apple-mobile-web-app-capable" content="yes">/.test(index) &&
     /<meta name="apple-mobile-web-app-title" content="EngrowDict">/.test(index));
  ok('  and reaches under the notch rather than beside it',
     /viewport-fit=cover/.test(index));
  ok('  the tab colour follows the theme, both ways',
     /theme-color" media="\(prefers-color-scheme: light\)" content="#eef0ec"/.test(index) &&
     /theme-color" media="\(prefers-color-scheme: dark\)" content="#0a0f0c"/.test(index));
  ok('  the manifest is linked and the worker registered',
     /<link rel="manifest" href="manifest\.webmanifest">/.test(index) &&
     /navigator\.serviceWorker\.register\("sw\.js"\)/.test(index));

  ok('none of it is put in the artifact copy, which has no origin to install from',
     !/manifest\.webmanifest/.test(artifact) && !/serviceWorker/.test(artifact) &&
     !/viewport-fit/.test(artifact));

  // --- the worker ---------------------------------------------------------
  ok('the worker is stamped with a version rather than the placeholder',
     /var VERSION = '[0-9a-f]{12}';/.test(sw) && !/__STAMP__/.test(sw),
     (sw.match(/var VERSION = '([0-9a-f]+)'/) || [])[1]);
  ok('  it takes the dictionary in on install, so a word can be looked up offline',
     /'\.\/index\.html'/.test(sw) && /'\.\/data\.json'/.test(sw) &&
     /caches\.open\(CACHE\)[\s\S]*addAll\(SHELL\)/.test(sw));
  ok('  it keeps its hands off other origins and off writing',
     /req\.method !== 'GET'/.test(sw) && /url\.origin !== self\.location\.origin/.test(sw));
  ok('  and off the cache-busting reload the Sync button does',
     /if \(url\.search\) return;/.test(sw));
  ok('  an old version is thrown away when a new one takes over',
     /caches\.keys\(\)/.test(sw) && /caches\.delete\(n\)/.test(sw));
  ok('  a page opened with no network still gets the copy it had',
     /req\.mode === 'navigate'/.test(sw) && /caches\.match\('\.\/index\.html'/.test(sw));

  // --- the hint, which only an iPhone needs -------------------------------
  const shell = read('docs/index.html');
  const mk = (ua, store) => boot({
    html: shell, full: true, ua, store: store || {},
    url: 'https://nhutrang0209.github.io/EngrowDict/', dataFile: 'docs/data.json',
  });

  const phone = mk(IOS);
  await wait(900);
  const bar = phone.doc.getElementById('a2hs');
  ok('an iPhone is told where the install button is hiding',
     !!bar && /Add to Home Screen/.test(bar.textContent), bar ? bar.textContent.slice(0, 58) : 'no hint');

  click(phone.window, bar.querySelector('.x'));
  ok('  dismissing it puts it away for good',
     !phone.doc.getElementById('a2hs') && !!phone.store['engrowdict:a2hs:v1']);
  const again = mk(IOS, phone.store);
  await wait(900);
  ok('  and it stays away on the next visit', !again.doc.getElementById('a2hs'));

  const desktop = mk(DESKTOP);
  await wait(900);
  ok('nobody else is bothered with it', !desktop.doc.getElementById('a2hs'));

  done(phone.errs.concat(again.errs, desktop.errs));
})();
