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
     /theme-color" media="\(prefers-color-scheme: dark\)" content="#151917"/.test(index));
  ok('  the manifest is linked and the worker registered',
     /<link rel="manifest" href="manifest\.webmanifest">/.test(index) &&
     /navigator\.serviceWorker\.register\("sw\.js"\)/.test(index));

  /* The machinery, not the word. The page itself mentions a service worker
     now — it lets go of one before reloading, when it finds it is holding a
     copy the server has moved past — and that line ships in both copies and
     does nothing in the one that was never installed. What must not be in
     the artifact is the installing: a manifest, a registration, a viewport
     that reaches under a notch there is none of. */
  ok('none of it is put in the artifact copy, which has no origin to install from',
     !/manifest\.webmanifest/.test(artifact)
     && !/serviceWorker\.register/.test(artifact)
     && !/viewport-fit/.test(artifact));
  ok('  and it does not go looking for a newer copy of itself either',
     !/name="build" content=/.test(artifact)
     && /MODE !== "static"/.test(read('app.js')),
     'nothing to compare itself with');

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

  /* --- knowing it is not the newest copy of itself ------------------------

     A browser keeps what it was given for as long as it was told to, and a
     service worker keeps it longer than that. So a reader can be pressing
     the thing that was fixed and watching it do what it used to do, with
     nothing on the screen to say which of the two copies they have — and
     reloading asks the cache, which is the thing that is wrong.

     The build writes what it built into the page and into a file beside it.
     Two strings: different means somebody has published since this tab
     opened. */
  const stamp = (index.match(/name="build" content="([a-f0-9]+)"/) || [])[1];
  ok('the build writes what it built into the page',
     !!stamp && stamp.length === 12, stamp || 'no stamp');
  ok('  and the same, on its own, into a file beside it',
     read('docs/build.txt').trim() === stamp, read('docs/build.txt').trim());

  const asked = [];
  const served = said => boot({
    html: shell, full: true, ua: DESKTOP, store: {},
    url: 'https://nhutrang0209.github.io/EngrowDict/',
    fetchStub: url => {
      const u = String(url);
      if (u.includes('build.txt')) {
        asked.push(u);
        return Promise.resolve({ ok: true, status: 200,
                                 text: () => Promise.resolve(said) });
      }
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(read('docs/data.json'))) });
    },
  });

  const same = served(stamp + '\n');
  await wait(900);
  ok('a page that is the newest copy of itself says nothing about it',
     same.doc.getElementById('banner').hidden,
     same.doc.getElementById('banner').textContent.slice(0, 40) || 'quiet');
  ok('  having asked the server with a question on the end, so nothing answers'
     + ' it out of a cache',
     asked.length === 1 && /build\.txt\?ts=\d+/.test(asked[0]), asked[0] || 'never asked');

  const stale = served('0123456789ab\n');
  await wait(900);
  const said = stale.doc.getElementById('banner');
  ok('a page the server has moved past says so, rather than leaving it to be found',
     !said.hidden && /newer version/.test(said.textContent),
     said.textContent.slice(0, 54));
  ok('  and offers the one thing that gets the newer one',
     [...said.querySelectorAll('button')].some(b => b.textContent === 'Reload'),
     [...said.querySelectorAll('button')].map(b => b.textContent).join(', '));

  done(phone.errs.concat(again.errs, desktop.errs, same.errs, stale.errs));
})();
