"""Bóc bản xuất Google Sheet thành dataset.json.

    python parse_sheet.py

Chỉ cần chạy lại khi sheet gốc đổi. SRC là bản xuất phẳng của sheet;
nếu không còn tệp đó thì cứ dùng dataset.json đã có sẵn trong repo.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r"C:\Users\Admin\.claude\projects\d--TrangNN\b289c23c-c29a-45d8-b94a-fb6acdb0f556\tool-results\mcp-claude_ai_Google_Drive-read_file_content-1787108761708.txt"

BS = chr(92)
MERGED = BS + '[merged' + BS + ']'
PUNCT = set(BS + '`*_{}[]()#+-.!>|~=')

lines = json.load(open(SRC, encoding='utf-8'))['fileContent'].split('\n')


def unesc(s):
    """Gỡ escape của markdown, giữ nguyên khoảng trắng."""
    out = []
    i = 0
    while i < len(s):
        if s[i] == BS and i + 1 < len(s) and s[i + 1] in PUNCT:
            out.append(s[i + 1])
            i += 2
        else:
            out.append(s[i])
            i += 1
    return ''.join(out).replace('\u00a0', ' ')


def flat(s):
    return re.sub(r'\s+', ' ', s).strip()


def cells(l):
    s = l.strip()
    if not s.startswith('|'):
        return None
    out = []
    for c in s.strip('|').split('|'):
        c = unesc(c).strip()
        if c.startswith(MERGED.replace(BS, '')):
            c = c[len('[merged]'):]
        out.append(c)
    return out


EG_SPLIT = re.compile(r'\s{2,}[-\u2013\u2014]\s*')
PARA_SPLIT = re.compile(r'\s{2,}')


def sense(def_cell, vi_cell):
    """Tách ví dụ (xuống dòng + gạch đầu dòng) khỏi phần định nghĩa."""
    parts = EG_SPLIT.split(def_cell)
    return {
        'def': flat(parts[0]),
        'eg': [flat(p) for p in parts[1:] if flat(p)],
        'vi': flat(vi_cell),
    }


IPA_RE = re.compile(r'/[^/]{1,60}/')
POS_RE = re.compile(r'[a-zA-Z,. /]+')


def parse_head(cell):
    """'abattoir (n) /IPA/ US: slaughterhouse' -> (word, pos, ipa, note)"""
    cell = flat(cell)
    ipa = ''
    m = IPA_RE.search(cell)
    if m:
        ipa = m.group(0)
        cell = cell[:m.start()] + ' \x00 ' + cell[m.end():]
    pos = ''
    m = re.search(r'\(([^()]{1,25})\)', cell)
    if m and POS_RE.fullmatch(m.group(1)):
        pos = m.group(1).strip()
        cell = cell[:m.start()] + ' \x00 ' + cell[m.end():]
    parts = [p.strip() for p in cell.split('\x00')]
    return parts[0].strip(), pos, ipa, ' '.join(p for p in parts[1:] if p).strip(' -=')


entries = []
readings = []


def add(**kw):
    kw.setdefault('note', '')
    kw.setdefault('pos', '')
    kw.setdefault('ipa', '')
    kw['senses'] = [s for s in kw['senses'] if s['def'] or s['vi']]
    if kw['senses']:
        entries.append(kw)


def group(lo, hi, ncell, key=lambda c: c[0]):
    """Trả về từng cụm dòng liền nhau có cùng khoá (ô bị gộp trong sheet)."""
    cur, buf = None, []
    for i in range(lo, hi):
        c = cells(lines[i])
        if not c or len(c) != ncell or not any(c):
            continue
        k = flat(key(c)) if isinstance(key(c), str) else key(c)
        if k != cur:
            if buf:
                yield cur, buf
            cur, buf = k, [c]
        else:
            buf.append(c)
    if buf:
        yield cur, buf


# 1. bảng từ A–Z
for k, rows in group(4, 834, 3):
    if len(set(flat(x) for x in rows[0])) == 1:      # dòng chia theo chữ cái
        continue
    w, pos, ipa, note = parse_head(rows[0][0])
    if w:
        add(type='word', word=w, pos=pos, ipa=ipa, note=note,
            senses=[sense(r[1], r[2]) for r in rows])

# 2. phrasal verb
for k, rows in group(838, 1461, 4, key=lambda c: (flat(c[0]), flat(c[1]))):
    verb, part = flat(rows[0][0]), flat(rows[0][1])
    if verb:
        add(type='phrasal', word=(verb + ' ' + part).strip(), verb=verb, particle=part,
            senses=[sense(r[2], r[3]) for r in rows])

# 3. thành ngữ
for k, rows in group(1465, 1863, 3):
    if k and not k.isdigit():
        add(type='idiom', word=k, senses=[sense(r[1], r[2]) for r in rows])

# 4. cụm từ / cách nói
for k, rows in group(1869, 2192, 3):
    if not k or k.isdigit():
        continue
    w, pos, ipa, note = parse_head(k)
    add(type='expression', word=w or k, pos=pos, ipa=ipa, note=note,
        senses=[sense(r[1], r[2]) for r in rows])

# 5. nhóm từ dễ nhầm
for i in range(2198, 2210):
    c = cells(lines[i])
    if c and len(c) == 4 and flat(c[1]):
        add(type='compare', word=flat(c[1]), group=flat(c[0]), senses=[sense(c[2], c[3])])

# 6. bài đọc — mỗi chỉ số có 2 dòng: tiêu đề rồi nội dung
buf = {}
for i in range(2214, len(lines)):
    c = cells(lines[i])
    if not c or len(c) != 2 or not flat(c[1]):
        continue
    idx = flat(c[0])
    if idx not in buf or 'paras' in buf[idx]:
        if idx in buf:
            readings.append(buf.pop(idx))
        buf[idx] = {'index': idx, 'title': flat(c[1])}
    else:
        buf[idx]['paras'] = [flat(p) for p in PARA_SPLIT.split(c[1].strip()) if flat(p)]
for v in buf.values():
    readings.append(v)
readings = [r for r in readings if r.get('paras')]

for n, e in enumerate(entries):
    e['id'] = 's' + str(n)

data = {'entries': entries, 'readings': readings}
blob = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', BS + 'u003c')
json.dump(data, open(os.path.join(HERE, 'dataset.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)


from collections import Counter
print(Counter(e['type'] for e in entries))
print('mục', len(entries),
      '· nghĩa', sum(len(e['senses']) for e in entries),
      '· ví dụ', sum(len(s['eg']) for e in entries for s in e['senses']),
      '· bài đọc', len(readings))
