"""Bóc source.xlsx (bản tải về của Google Sheet) thành dataset.json.

    python parse_sheet.py

Chỉ cần chạy lại khi sheet gốc đổi. Ô bị gộp trong Excel chỉ mang giá trị ở
dòng đầu, nên dòng có ô đầu trống được hiểu là nghĩa tiếp theo của mục trên.
"""
import json
import os
import re

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source.xlsx')

IPA_RE = re.compile(r'/[^/\n]{1,80}/')
POS_RE = re.compile(r'^[a-zA-Z][a-zA-Z,. /]{0,24}$')
EG_SPLIT = re.compile(r'\n\s*[-–—]\s*')


def txt(v):
    return '' if v is None else str(v).replace('\r\n', '\n').replace('\r', '\n').strip()


def flat(s):
    return re.sub(r'[ \t]+', ' ', txt(s).replace('\n', ' ')).strip()


def sense(def_cell, vi_cell):
    """Tách ví dụ (dòng bắt đầu bằng gạch đầu dòng) khỏi phần định nghĩa."""
    parts = EG_SPLIT.split(txt(def_cell))
    return {
        'def': flat(parts[0]),
        'eg': [flat(p) for p in parts[1:] if flat(p)],
        'vi': flat(vi_cell),
    }


def parse_head(cell):
    """'aardvark (n)\\n/ˈɑːd.vɑːk/\\n= initio' -> (word, pos, ipa, note)"""
    cell = txt(cell)
    ipa = ''
    m = IPA_RE.search(cell)
    if m:
        ipa = m.group(0).strip()
        cell = cell[:m.start()] + '\n' + cell[m.end():]
    lines = [l.strip() for l in cell.split('\n') if l.strip()]
    first = lines[0] if lines else ''
    pos = ''
    m = re.search(r'\(([^()]{1,25})\)\s*$', first)
    if m and POS_RE.match(m.group(1).strip()):
        pos = m.group(1).strip()
        first = first[:m.start()].strip()
    note = ' '.join(lines[1:]).strip(' -=')
    return flat(first), pos, ipa, flat(note)


entries = []
readings = []


def add(**kw):
    kw.setdefault('note', '')
    kw.setdefault('pos', '')
    kw.setdefault('ipa', '')
    kw['senses'] = [s for s in kw['senses'] if s['def'] or s['vi']]
    if kw['word'] and kw['senses']:
        entries.append(kw)


def blocks(ws, key_cols, skip_header=1):
    """Gom các dòng liền nhau thành một mục: dòng có ô khoá trống là nghĩa
    tiếp theo của mục ngay trên (dấu vết của ô gộp trong Excel)."""
    cur, buf = None, []
    for n, row in enumerate(ws.iter_rows(values_only=True)):
        if n < skip_header:
            continue
        row = list(row) + [None] * 8
        key = tuple(txt(row[c]) for c in key_cols)
        if not any(txt(c) for c in row):
            continue
        if any(key):
            if buf:
                yield cur, buf
            cur, buf = key, [row]
        elif buf:
            buf.append(row)
    if buf:
        yield cur, buf


wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)

# --- Vocabulary: A = từ (+ từ loại + phiên âm), B = definition, C = nghĩa ---
for key, rows in blocks(wb['Vocabulary'], [0], skip_header=1):
    head = rows[0]
    # dòng chia mục theo chữ cái: chỉ có một chữ ở cột A, không định nghĩa
    if not txt(head[1]) and not txt(head[2]) and len(txt(head[0])) <= 2:
        continue
    word, pos, ipa, note = parse_head(head[0])
    add(type='word', word=word, pos=pos, ipa=ipa, note=note,
        senses=[sense(r[1], r[2]) for r in rows])

# --- Phrasal Verb: A = động từ, B = giới từ, C = explain, D = nghĩa ---
# Ô động từ gộp qua tất cả giới từ của nó, nên phải nhớ động từ đang xét:
# có giới từ mới = mục mới, cả hai ô trống = nghĩa tiếp theo của mục hiện tại.
def flush_phrasal(verb, part, rows):
    if rows and verb:
        add(type='phrasal', word=flat(verb + ' ' + part), verb=flat(verb), particle=flat(part),
            senses=[sense(r[2], r[3]) for r in rows])


cur_verb, cur_part, buf = '', '', []
for n, row in enumerate(wb['Phrasal Verb'].iter_rows(values_only=True)):
    if n < 1:
        continue
    row = list(row) + [None] * 8
    a, b = txt(row[0]), txt(row[1])
    if not any(txt(c) for c in row[:4]):
        continue
    if a or b:
        flush_phrasal(cur_verb, cur_part, buf)
        if a:
            cur_verb = a
        cur_part = b
        buf = [row]
    else:
        buf.append(row)
flush_phrasal(cur_verb, cur_part, buf)

# --- Idioms / Common: A = mục từ, B = explain, C = nghĩa ---
for sheet, kind in (('Idioms', 'idiom'), ('Common', 'expression')):
    for key, rows in blocks(wb[sheet], [0], skip_header=1):
        word, pos, ipa, note = parse_head(rows[0][0])
        add(type=kind, word=word, pos=pos, ipa=ipa, note=note,
            senses=[sense(r[1], r[2]) for r in rows])

# --- Grammar: A = số nhóm, B = từ, C = explain, D = nghĩa (nhóm dễ nhầm) ---
group = ''
for n, row in enumerate(wb['Grammar'].iter_rows(values_only=True)):
    if n < 1:
        continue
    row = list(row) + [None] * 8
    if txt(row[0]):
        group = txt(row[0]).replace('.0', '')
    if txt(row[1]):
        add(type='compare', word=flat(txt(row[1])), group=group,
            senses=[sense(row[2], row[3])])

# --- Reading Passage: mỗi bài hai dòng, tiêu đề rồi nội dung ---
pend = None
for n, row in enumerate(wb['Reading Passage'].iter_rows(values_only=True)):
    if n < 1:
        continue
    row = list(row) + [None] * 4
    body = txt(row[1])
    if not body:
        continue
    if txt(row[0]):
        pend = {'index': txt(row[0]).replace('.0', ''), 'title': flat(body)}
    elif pend:
        pend['paras'] = [flat(p) for p in body.split('\n') if flat(p)]
        readings.append(pend)
        pend = None

for n, e in enumerate(entries):
    e['id'] = 's' + str(n)

data = {'entries': entries, 'readings': readings}
json.dump(data, open(os.path.join(HERE, 'dataset.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

# Ảnh chụp thô của từng tab, để test đối chiếu bản bóc bằng Apps Script
# (sheet-sync.gs) với bản bóc bằng Python này. Tệp phái sinh, không commit.
grids = {}
for name in ('Vocabulary', 'Phrasal Verb', 'Idioms', 'Common', 'Grammar'):
    ws = wb[name]
    g = []
    for row in ws.iter_rows(values_only=True):
        g.append([('' if c is None else str(c)) for c in (list(row) + [None] * 4)[:4]])
    grids[name] = g
test_dir = os.path.join(HERE, 'test')
if os.path.isdir(test_dir):
    json.dump(grids, open(os.path.join(test_dir, 'grids.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))

from collections import Counter
print(Counter(e['type'] for e in entries))
print('mục', len(entries),
      '· nghĩa', sum(len(e['senses']) for e in entries),
      '· ví dụ', sum(len(s['eg']) for e in entries for s in e['senses']),
      '· bài đọc', len(readings))
print('dataset.json', round(os.path.getsize(os.path.join(HERE, 'dataset.json')) / 1024), 'KB')
