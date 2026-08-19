"""Ghép dataset.json + app.css + app.js thành hai trang hoàn chỉnh.

    python build.py

so-tra-tu.html  — bản đem publish làm Artifact trên claude.ai (thêm từ
                  được lưu lên máy chủ vì trang tự publish lại chính nó).
docs/index.html — bản web tĩnh cho GitHub Pages (thêm từ lưu trong
                  trình duyệt của từng người xem).
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BS = chr(92)

data = json.load(open(os.path.join(HERE, 'dataset.json'), encoding='utf-8'))
entries, readings = data['entries'], data['readings']
blob = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', BS + 'u003c')

css = open(os.path.join(HERE, 'app.css'), encoding='utf-8').read()
js = open(os.path.join(HERE, 'app.js'), encoding='utf-8').read()
for name, text in (('app.css', css), ('app.js', js)):
    for bad in ('</style', '</script'):
        assert bad not in text, name + ' chứa ' + bad

FONTS = ("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600"
         "&amp;family=IBM+Plex+Mono:wght@400;500"
         "&amp;family=IBM+Plex+Sans:wght@400;500;600&amp;display=swap")

HEAD = (
    '<title>Sổ Tra Từ</title>\n'
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="' + FONTS + '">\n'
    '<style id="css">' + css + '</style>\n'
)
BODY = (
    '<div id="app"></div>\n'
    '<script type="application/json" id="mode">"{mode}"</script>\n'
    '<script type="application/json" id="base">' + blob + '</script>\n'
    '<script type="application/json" id="added">[]</script>\n'
    '<script type="text/plain" id="appjs">' + js + '</script>\n'
    "<script>new Function(document.getElementById('appjs').textContent)()</script>\n"
)

# Bản cho Artifact: khung <head> do claude.ai bọc, nên chỉ cần phần thân.
out = os.path.join(HERE, 'so-tra-tu.html')
open(out, 'w', encoding='utf-8').write(HEAD + BODY.replace('{mode}', 'artifact'))

# Bản web tĩnh (GitHub Pages): tài liệu đầy đủ, tự đứng một mình.
site = os.path.join(HERE, 'docs')
if not os.path.isdir(site):
    os.mkdir(site)
open(os.path.join(site, '.nojekyll'), 'w').write('')
index = os.path.join(site, 'index.html')
open(index, 'w', encoding='utf-8').write(
    '<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<meta name="description" content="Tra 1.395 mục từ, thành ngữ và phrasal verb '
    'Anh-Việt: phiên âm, định nghĩa tiếng Anh, nghĩa tiếng Việt.">\n'
    + HEAD
    + '</head>\n<body>\n' + BODY.replace('{mode}', 'static') + '</body>\n</html>\n')

print('mục', len(entries),
      '· nghĩa', sum(len(e['senses']) for e in entries),
      '· bài đọc', len(readings))
print('so-tra-tu.html ', round(os.path.getsize(out) / 1024), 'KB (artifact)')
print('docs/index.html', round(os.path.getsize(index) / 1024), 'KB (web tĩnh)')
