"""Ghép dataset.json + app.css + app.js thành trang hoàn chỉnh.

    python build.py

so-tra-tu.html   — bản publish làm Artifact trên claude.ai. Dữ liệu nhúng
                   thẳng trong tệp vì artifact không được phép tải gì từ ngoài;
                   trang tự publish lại chính nó nên từ mới lưu lên máy chủ.
docs/index.html  — bản web tĩnh cho GitHub Pages. Nhẹ, tải dữ liệu từ
docs/data.json     data.json cùng thư mục — nhờ vậy nút Đồng bộ trong Google
                   Sheet chỉ cần ghi đè data.json là web đổi theo, không cần
                   build lại gì cả. Bản này không kèm bài đọc.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BS = chr(92)

data = json.load(open(os.path.join(HERE, 'dataset.json'), encoding='utf-8'))
entries, readings = data['entries'], data['readings']

# Bản công khai bỏ phần bài đọc: đó là nguyên văn bài của TED-Ed và BBC, giữ
# trong sổ riêng thì được, đăng lên web mở thì thành phát tán lại có bản quyền.
public = {'entries': entries, 'readings': []}


def dumps(payload):
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':'))


css = open(os.path.join(HERE, 'app.css'), encoding='utf-8').read()
js = open(os.path.join(HERE, 'app.js'), encoding='utf-8').read()
for name, text in (('app.css', css), ('app.js', js)):
    for bad in ('</style', '</script'):
        assert bad not in text, name + ' chứa ' + bad

FONTS = ("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700"
         "&amp;family=IBM+Plex+Mono:wght@400;500;600"
         "&amp;family=IBM+Plex+Sans:wght@400;450;500;600&amp;display=swap")

HEAD = (
    '<title>Sổ Tra Từ</title>\n'
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="' + FONTS + '">\n'
    '<style id="css">' + css + '</style>\n'
)


def body(mode, embedded):
    """embedded = None nghĩa là trang sẽ tự tải data.json khi mở."""
    out = ['<div id="app"></div>\n',
           '<script type="application/json" id="mode">"' + mode + '"</script>\n']
    if embedded is not None:
        out.append('<script type="application/json" id="base">'
                   + dumps(embedded).replace('<', BS + 'u003c') + '</script>\n')
    out.append('<script type="application/json" id="added">[]</script>\n')
    out.append('<script type="text/plain" id="appjs">' + js + '</script>\n')
    out.append("<script>new Function(document.getElementById('appjs').textContent)()</script>\n")
    return ''.join(out)


# --- bản Artifact: khung <head> do claude.ai bọc, chỉ cần phần thân ---
art = os.path.join(HERE, 'so-tra-tu.html')
open(art, 'w', encoding='utf-8').write(HEAD + body('artifact', data))

# --- bản web tĩnh ---
site = os.path.join(HERE, 'docs')
if not os.path.isdir(site):
    os.mkdir(site)
open(os.path.join(site, '.nojekyll'), 'w').write('')

dat = os.path.join(site, 'data.json')
open(dat, 'w', encoding='utf-8').write(dumps(public))

index = os.path.join(site, 'index.html')
open(index, 'w', encoding='utf-8').write(
    '<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<meta name="description" content="Tra ' + '{:,}'.format(len(entries)).replace(',', '.')
    + ' mục từ Anh-Việt: phiên âm, định nghĩa tiếng Anh, nghĩa tiếng Việt.">\n'
    '<link rel="preload" href="data.json" as="fetch" crossorigin>\n'
    + HEAD
    + '</head>\n<body>\n' + body('static', None) + '</body>\n</html>\n')

kb = lambda p: round(os.path.getsize(p) / 1024)
print('mục', len(entries),
      '· nghĩa', sum(len(e['senses']) for e in entries),
      '· bài đọc', len(readings), '(chỉ trong bản artifact)')
print('so-tra-tu.html  %5d KB  artifact, dữ liệu nhúng sẵn' % kb(art))
print('docs/index.html %5d KB  web tĩnh, vỏ trang' % kb(index))
print('docs/data.json  %5d KB  dữ liệu công khai' % kb(dat))
