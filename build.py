"""Assemble dataset.json + app.css + app.js into the finished pages.

    python build.py

engrowdict.html  — the copy published as an Artifact on claude.ai. The data is
                   embedded because an artifact may not fetch anything from
                   outside; the page republishes itself, so added words land on
                   the server.
docs/index.html  — the static copy for GitHub Pages. A light shell that loads
docs/data.json     data.json from the same folder, which is what lets the Sync
                   button in Google Sheets update the site by overwriting one
                   file — no build step involved. Reading passages are left out.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BS = chr(92)

data = json.load(open(os.path.join(HERE, 'dataset.json'), encoding='utf-8'))
entries, readings = data['entries'], data['readings']

# The public copy drops the reading passages: they are the verbatim text of
# TED-Ed and BBC articles. Fine in a private notebook, not on an open website.
public = {'entries': entries, 'readings': []}


def dumps(payload):
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':'))


css = open(os.path.join(HERE, 'app.css'), encoding='utf-8').read()
js = open(os.path.join(HERE, 'app.js'), encoding='utf-8').read()
for name, text in (('app.css', css), ('app.js', js)):
    for bad in ('</style', '</script'):
        assert bad not in text, name + ' contains ' + bad

FONTS = ("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700"
         "&amp;family=IBM+Plex+Mono:wght@400;500;600"
         "&amp;family=IBM+Plex+Sans:wght@400;450;500;600&amp;display=swap")

HEAD = (
    '<title>EngrowDict</title>\n'
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="' + FONTS + '">\n'
    '<style id="css">' + css + '</style>\n'
)


def body(mode, embedded):
    """embedded=None means the page fetches data.json when it opens."""
    out = ['<div id="app"></div>\n',
           '<script type="application/json" id="mode">"' + mode + '"</script>\n']
    if embedded is not None:
        out.append('<script type="application/json" id="base">'
                   + dumps(embedded).replace('<', BS + 'u003c') + '</script>\n')
    out.append('<script type="application/json" id="added">[]</script>\n')
    out.append('<script type="text/plain" id="appjs">' + js + '</script>\n')
    out.append("<script>new Function(document.getElementById('appjs').textContent)()</script>\n")
    return ''.join(out)


# --- artifact copy: claude.ai wraps the <head>, so only the body is needed ---
art = os.path.join(HERE, 'engrowdict.html')
open(art, 'w', encoding='utf-8').write(HEAD + body('artifact', data))

# --- static copy ---
site = os.path.join(HERE, 'docs')
if not os.path.isdir(site):
    os.mkdir(site)
open(os.path.join(site, '.nojekyll'), 'w').write('')

dat = os.path.join(site, 'data.json')
open(dat, 'w', encoding='utf-8').write(dumps(public))

index = os.path.join(site, 'index.html')
open(index, 'w', encoding='utf-8').write(
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<meta name="description" content="Look up ' + '{:,}'.format(len(entries))
    + ' English-Vietnamese entries: phonetics, English definitions, '
      'Vietnamese meanings.">\n'
    '<link rel="preload" href="data.json" as="fetch" crossorigin>\n'
    + HEAD
    + '</head>\n<body>\n' + body('static', None) + '</body>\n</html>\n')

kb = lambda p: round(os.path.getsize(p) / 1024)
print(len(entries), 'entries ·',
      sum(len(e['senses']) for e in entries), 'senses ·',
      len(readings), 'passages (artifact copy only)')
print('engrowdict.html %5d KB  artifact, data embedded' % kb(art))
print('docs/index.html %5d KB  static shell' % kb(index))
print('docs/data.json  %5d KB  public data' % kb(dat))
