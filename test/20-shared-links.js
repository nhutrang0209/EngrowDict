/* The links, carried from one device to the next.

   The sheet link, the Web App link and the sync key live in one browser and
   nowhere else — which is what stops a stranger with the address from writing
   into the sheet, and what made every new device a trip through Settings with
   three fields copied off another screen.

   So they are published, locked with the passcode: docs/link.json is a salt, a
   nonce and a block of AES-GCM. A device that knows the passcode types it once
   and has the links. Anyone else has noise, and the passcode is never in the
   file, never in the page, and never leaves the browser it is typed in. */
const { read, boot, ok, done, wait, click, btn, unlockedStore, PASSCODE } =
  require('./helpers');

const shell = read('docs/index.html');
const API = 'https://api.github.com/repos/nhutrang0209/EngrowDict/contents/';
const CFG = {
  sheetUrl: 'https://docs.google.com/spreadsheets/d/ABC/edit',
  webApp: 'https://script.google.com/macros/s/XYZ/exec',
  key: 'a5ca7518-8f7b-440f-a470-6c6cef87b673',
};

const reply = (status, body) => Promise.resolve({
  ok: status < 300, status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
});

/* A repo that holds one file, and a site that serves whatever is in it. */
function site() {
  const kept = {};
  return {
    kept,
    published: () => kept['docs/link.json'] && kept['docs/link.json'].text,
    stub(url, init) {
      const u = String(url);
      if (u.startsWith(API)) {
        const path = u.slice(API.length);
        const method = (init && init.method) || 'GET';
        if ((init && init.headers && init.headers.Authorization) !== 'Bearer github_pat_test') {
          return reply(401, { message: 'Bad credentials' });
        }
        if (method === 'GET') {
          return kept[path]
            ? reply(200, { sha: kept[path].sha,
                           content: Buffer.from(kept[path].text, 'utf8').toString('base64') })
            : reply(404, { message: 'Not Found' });
        }
        const body = JSON.parse(init.body);
        kept[path] = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: 's1' };
        return reply(200, { content: { path } });
      }
      // the site serving the published file, and the dictionary behind it
      if (/link\.json/.test(u)) {
        return kept['docs/link.json']
          ? reply(200, kept['docs/link.json'].text)
          : reply(404, 'not found');
      }
      if (init && init.method === 'POST') return reply(200, { ok: true, pong: true });
      return reply(200, JSON.parse(read('docs/data.json')));
    },
  };
}

const page = (net, store) => boot({
  html: shell, full: true, store: store,
  url: 'https://nhutrang0209.github.io/EngrowDict/',
  fetchStub: (u, i) => net.stub(u, i),
});

const unlock = (g, pass) => {
  click(g.window, g.doc.getElementById('settings-btn'));
  g.doc.getElementById('pass-in').value = pass;
  click(g.window, g.doc.getElementById('pass-go'));
};

(async () => {
  const net = site();

  /* --- the device that has them ------------------------------------------- */
  const first = page(net, unlockedStore(
    Object.assign({ ghToken: 'github_pat_test' }, CFG)));
  await wait(900);
  click(first.window, first.doc.getElementById('settings-btn'));
  const share = first.doc.getElementById('share-links');
  ok('Settings offers to publish the links', !!share && !share.disabled,
     share ? 'enabled' : 'no button');

  click(first.window, share);
  await wait(600);
  const file = net.published();
  ok('  which writes one file to the repo',
     !!file && !!net.kept['docs/link.json'], Object.keys(net.kept).join(', '));

  const box = JSON.parse(file);
  ok('  a salt, a nonce and a block of AES-GCM, and nothing else',
     box.v === 1 && !!box.salt && !!box.iv && !!box.data &&
     Object.keys(box).sort().join(',') === 'data,iv,rounds,salt,v',
     Object.keys(box).join(','));
  ok('  with none of the three fields readable in it',
     !file.includes(CFG.key) && !file.includes('script.google.com') &&
     !file.includes('docs.google.com'),
     file.slice(0, 60) + '…');
  ok('  and the passcode nowhere near it',
     !file.includes(PASSCODE), 'no passcode in the file');
  ok('  stretched enough to be worth attacking slowly',
     box.rounds >= 200000, String(box.rounds));

  /* --- a device that has nothing but the address -------------------------- */
  const fresh = page(net, {});
  await wait(900);
  ok('a new device has no sync button, having no links',
     fresh.doc.getElementById('sync-sheet').hidden);

  unlock(fresh, PASSCODE);
  await wait(700);
  ok('the right passcode brings the links down with it',
     fresh.doc.getElementById('val-webapp').textContent === CFG.webApp,
     fresh.doc.getElementById('val-webapp').textContent);
  ok('  the sheet link comes too',
     fresh.doc.getElementById('val-sheet').textContent === CFG.sheetUrl,
     fresh.doc.getElementById('val-sheet').textContent);
  ok('  the key comes masked, the way a key is shown',
     fresh.doc.getElementById('val-key').textContent.indexOf('a5c') === 0 &&
     fresh.doc.getElementById('val-key').textContent.includes('•'),
     fresh.doc.getElementById('val-key').textContent);
  ok('  and the sync button is there without a field being typed into',
     !fresh.doc.getElementById('sync-sheet').hidden);
  ok('  said out loud, in green',
     /links came with the passcode/.test(fresh.doc.getElementById('toast').textContent) &&
     fresh.doc.getElementById('toast').className === 'toast good',
     fresh.doc.getElementById('toast').textContent);

  /* --- a device with the address and nothing else -------------------------- */
  const nosy = page(net, {});
  await wait(900);
  unlock(nosy, 'not-the-passcode');
  await wait(700);
  ok('the wrong passcode opens neither the page nor the file',
     nosy.doc.getElementById('sync-sheet').hidden &&
     /Wrong passcode/.test(nosy.doc.getElementById('set-msg').textContent),
     nosy.doc.getElementById('set-msg').textContent);

  /* --- a site with no file published -------------------------------------- */
  const bare = site();
  const alone = page(bare, {});
  await wait(900);
  unlock(alone, PASSCODE);
  await wait(500);
  ok('where nothing was published, the passcode still unlocks and says nothing',
     alone.doc.getElementById('sync-sheet').hidden &&
     !/came with the passcode/.test(alone.doc.getElementById('toast').textContent),
     alone.doc.getElementById('toast').textContent || '(nothing said)');

  /* --- and it takes a token to publish ------------------------------------ */
  const noToken = page(site(), unlockedStore(CFG));
  await wait(900);
  click(noToken.window, noToken.doc.getElementById('settings-btn'));
  ok('publishing needs the GitHub token, and says so rather than failing',
     noToken.doc.getElementById('share-links').disabled === true,
     noToken.doc.getElementById('share-links').title);

  done(first.errs.concat(fresh.errs, nosy.errs, alone.errs));
})();
