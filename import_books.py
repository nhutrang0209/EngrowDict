"""Turn a book into the shape the reader wants.

    python import_books.py books/*.pdf books/*.epub

Reads PDF and EPUB alike -- MuPDF opens both, and both usually carry a table of
contents, so chapters are read rather than guessed. What has to be undone is
everything a page layout adds and a reader does not want: the running header on
every page, the page number, the drop capital that comes out of the text layer
adrift from its own word, and words broken in half by a line ending.

Output lands in books/out/, which is not committed, so a personal copy stays
on the machine it was made on. Add --publish to write to docs/books/ instead,
which is served with the site to anyone who has the address: that is for books
that are out of copyright.
"""
import json
import os
import re
import sys
from collections import Counter

import pymupdf

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'books', 'out')

# a page number alone on its line, however the book dresses it up
PAGE_NO = re.compile(r'^[\s*.\-]*\d{1,4}[\s*.\-]*$')
# "C H A P T E R  O N E" -- headings set with letter spacing
SPACED = re.compile(r'^(?:\w[\s ]){3,}\w[\s.]*$')
# "CHAPTER XIV", "Chapter 3.", "PART TWO" -- and nothing longer than a heading
NUMBERED = re.compile(r'^\s*(chapter|part|book)\b[\s\d.,:ivxlcdm-]*$', re.I)


def unspace(s):
    return re.sub(r'\s+', '', s) if SPACED.match(s) else s


def key(s):
    """What two lines have to share to count as the same line."""
    return re.sub(r'[^a-z0-9]+', '', unspace(s).lower())[:40]


def slugify(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') or 'book'


def lines_of(par):
    return [l.strip() for l in par.split('\n') if l.strip()]


def head_of(par):
    ls = lines_of(par)
    return ls[0] if ls else ''


def pct(ns, p):
    """The leading is the gap most pairs of lines have, not the average one.

    Taking the middle of every gap assumes most of them fall inside a
    paragraph, which is true of prose and false of a page of two-line
    paragraphs, so the low quarter is taken instead.
    """
    if not ns:
        return 0
    s = sorted(ns)
    return s[min(len(s) - 1, int((len(s) - 1) * p))]


def is_cap(span, body):
    t = span['text'].strip()
    return len(t) == 1 and t.isupper() and span['size'] > body * 1.6


def lines_on(page):
    """Every line of the page: where it starts, how big it is set, what it says.

    An EPUB says where its paragraphs are and a PDF does not, so a PDF has to
    be read the way a person reads it — off the page, by the shape of it.
    """
    out = []
    caps = []
    d = page.get_text('dict')
    sizes = []
    for b in d.get('blocks', []):
        for ln in b.get('lines', []):
            for sp in ln.get('spans', []):
                if sp['text'].strip():
                    sizes.append(sp['size'])
    body = pct(sizes, 0.5) or 10

    for b in d.get('blocks', []):
        for ln in b.get('lines', []):
            spans = [sp for sp in ln.get('spans', []) if sp['text'].strip()]
            if not spans:
                continue
            # MuPDF sometimes reads the drop capital as the first span of the
            # line it opens rather than as a line of its own. Either way it is
            # the first letter of the word: join it on, and let the line keep
            # the size of the words rather than of the initial.
            if len(spans) > 1 and is_cap(spans[0], body):
                text = (spans[0]['text'].strip()
                        + ''.join(sp['text'] for sp in spans[1:]).lstrip())
                # the baseline of the words, not the top of the big letter,
                # or the line looks a paragraph's distance from the next one
                out.append({'x': spans[1]['bbox'][0], 'y': spans[1]['bbox'][1],
                            'h': max(sp['size'] for sp in spans[1:]),
                            'text': re.sub(r'[ \t]+', ' ', text).strip()})
                continue
            # A drop capital is one letter set two or three times the size of
            # the text, out in the margin, sitting on the baseline of the
            # second or third line of the paragraph rather than the first.
            # Left where it falls it lands in the middle of a sentence.
            if len(spans) == 1 and is_cap(spans[0], body):
                caps.append({'x': spans[0]['bbox'][0], 'y': ln['bbox'][1],
                             'h': spans[0]['size'], 's': spans[0]['text'].strip()})
                continue
            text = re.sub(r'[ \t]+', ' ', ''.join(sp['text'] for sp in spans)).strip()
            if text:
                out.append({'x': ln['bbox'][0], 'y': ln['bbox'][1],
                            'h': max(sp['size'] for sp in spans), 'text': text})

    out.sort(key=lambda l: (round(l['y'], 1), l['x']))
    for c in caps:
        best = None
        for l in out:
            if l['x'] <= c['x'] + c['h'] * 0.2:
                continue
            if l['y'] > c['y'] + c['h'] * 0.4 or l['y'] < c['y'] - c['h']:
                continue
            if best is None or l['y'] < best['y']:
                best = l
        if best is not None:
            best['text'] = c['s'] + best['text']
    return out


def blocks_from(lines):
    """Lines gathered into paragraphs.

    A paragraph ends where the next line is pushed further down than the
    leading explains, or where it is indented -- which in a novel is the only
    mark a new paragraph gets. The leading is measured on body lines alone: a
    heading sits further from its neighbours than any paragraph break, and
    letting it into the measurement raises the bar until real breaks stop
    clearing it.
    """
    if not lines:
        return []
    body = pct([l['h'] for l in lines], 0.5) or 10
    is_body = lambda l: abs(l['h'] - body) <= body * 0.2
    gaps = [lines[i]['y'] - lines[i - 1]['y'] for i in range(1, len(lines))
            if lines[i]['y'] - lines[i - 1]['y'] > 0.5
            and is_body(lines[i]) and is_body(lines[i - 1])]
    lead = pct(gaps, 0.25) or 12
    left = min(l['x'] for l in lines)

    out, cur = [], [lines[0]]
    for i in range(1, len(lines)):
        gap = lines[i]['y'] - lines[i - 1]['y']
        indented = lines[i]['x'] > left + max(6, lead * 0.5)
        bigger = abs(lines[i]['h'] - lines[i - 1]['h']) > 2.5
        if gap > lead * 1.35 or indented or bigger:
            out.append(cur)
            cur = []
        cur.append(lines[i])
    out.append(cur)
    return ['\n'.join(l['text'] for l in b) for b in out if b]


def blocks_of(page, pdf):
    """The page's paragraphs, top to bottom, line breaks kept.

    An EPUB is marked-up text: MuPDF's own blocks are its paragraphs and are
    better than any guess made from the geometry. A PDF is a picture of a page.
    """
    if pdf:
        return blocks_from(lines_on(page))
    out = []
    for b in sorted(page.get_text('blocks'), key=lambda b: (round(b[1]), b[0])):
        t = re.sub(r'[ \t]+', ' ', b[4]).strip()
        if t:
            out.append(t)
    return out


def furniture(pages):
    """Lines that are on the page because of the page, not because of the book.

    A running header repeats on page after page; a paragraph does not.
    """
    seen = Counter()
    for bs in pages:
        for t in bs[:1] + bs[-1:]:
            seen[key(head_of(t))] += 1
    floor = max(4, len(pages) // 20)
    return {k for k, n in seen.items() if k and n >= floor}


def clean(par):
    """One paragraph, as a person would want to read it.

    A drop capital arrives as a line holding a single letter, because on the
    page it is decoration standing beside the text rather than the first letter
    of it. Glue it back on with no space, or the chapter opens on "M r. and
    Mrs. Dursley".
    """
    out = ''
    for l in lines_of(par):
        if len(out) == 1 and out.isalpha() and out.isupper():
            out += l                       # a drop capital and its own word
        elif out.endswith('-'):
            out = out[:-1] + l             # a word split by the line ending
        elif out:
            out += ' ' + l
        else:
            out = l
    out = re.sub(r' {2,}', ' ', out)
    return out.replace('ﬁ', 'fi').replace('ﬂ', 'fl').strip()


def is_heading(line, title):
    """Only the chapter's own name, never a line of shouting.

    All-caps is no evidence: books are full of it. "SEIZE HIM!" is the story;
    "CHAPTER FOUR" is the furniture.
    """
    flat = unspace(line).strip(' .')
    if not flat:
        return True
    if title and key(flat) == key(title):
        return True
    if NUMBERED.match(flat):
        return True
    return bool(SPACED.match(line)) and len(line) < 60


def strip_head(par, title):
    ls = lines_of(par)
    while ls and is_heading(ls[0], title):
        ls.pop(0)
    return '\n'.join(ls)


def pages_of(doc):
    """Every page, cleared of what the page itself put there."""
    raw = [blocks_of(p, doc.is_pdf) for p in doc]
    junk = furniture(raw)
    out = []
    for bs in raw:
        kept, cap = [], ''
        for t in bs:
            flat = unspace(head_of(t))
            if len(lines_of(t)) == 1:
                if key(flat) in junk or PAGE_NO.match(flat):
                    continue
                if len(flat) == 1 and flat.isalpha() and flat.isupper():
                    cap = flat        # a drop capital, set in its own block
                    continue
            kept.append(t)
        if cap and kept:
            kept[0] = cap + '\n' + kept[0]
        out.append(kept)
    return out


def marks(pages):
    """Where the chapters start, for a book that never says."""
    found = []
    for i, bs in enumerate(pages):
        for t in bs[:3]:
            line = head_of(t)
            flat = unspace(line).strip(' .')
            if NUMBERED.match(flat) or (SPACED.match(line) and len(line) < 60):
                found.append((flat.title(), i))
                break
    return found


def title_keys(title):
    """What to look for in the text to find this chapter's own heading.

    A table of contents is not always tidy: the illustrated Pride and Prejudice
    lists a chapter as "He rode a black horse. CHAPTER III." because the caption
    of the facing picture sits inside the heading. The tail is the part the page
    actually prints.
    """
    keys = []
    tail = re.search(r'((?:chapter|part|book)\b[\s\d.,:ivxlcdm-]*)$', title, re.I)
    if tail:
        keys.append(key(tail.group(1)))
    keys.append(key(title))
    return [k for k in keys if k]


def find(paras, keys, lo, hi):
    """The line that opens the chapter, somewhere near where the book said."""
    for i in range(max(0, lo), min(len(paras), hi)):
        if key(head_of(paras[i])) in keys:
            return i
    return None


def read(path):
    doc = pymupdf.open(path)
    pages = pages_of(doc)

    # One stream of paragraphs. Chapters are cut where their heading falls, not
    # where the page turns: an EPUB's pages are invented by the reader, so a
    # chapter routinely starts halfway down one.
    paras, at_page = [], []
    for page in pages:
        at_page.append(len(paras))
        paras.extend(page)
    at_page.append(len(paras))

    toc = [(t[1].strip(), t[2] - 1) for t in doc.get_toc() if t[0] <= 1 and t[2] > 0]
    toc = toc or marks(pages) or [('The book', 0)]

    cuts = []
    for title, page in toc:
        lo = at_page[max(0, page - 1)]
        hi = at_page[min(len(at_page) - 1, page + 2)]
        i = find(paras, title_keys(title), lo, hi)
        cuts.append((title if i is None else head_of(paras[i]),
                     at_page[page] if i is None else i))

    chapters = []
    for n, (title, first) in enumerate(cuts):
        last = cuts[n + 1][1] if n + 1 < len(cuts) else len(paras)
        body = paras[first:last]
        while body and not strip_head(body[0], title):
            body.pop(0)
        if body:
            body[0] = strip_head(body[0], title)
        # The running header again. Counting repeats catches it in a long
        # chapter; in a short one it appears too few times to look like
        # furniture, and only the chapter knows its own name.
        body = [p for p in body
                if len(lines_of(p)) > 1 or not is_heading(p, title)]
        body = [p for p in (clean(b) for b in body) if len(p) > 1]
        if body:
            chapters.append({'n': len(chapters) + 1,
                             'title': unspace(title).strip(' .'),
                             'paras': body})

    meta = doc.metadata or {}
    stem = os.path.splitext(os.path.basename(path))[0]
    return {
        'slug': slugify(meta.get('title') or stem),
        'title': (meta.get('title') or '').strip() or stem,
        'author': (meta.get('author') or '').strip(),
        'chapters': chapters,
    }


def catalogue(folder):
    """The shelf: enough to draw the contents, not the books themselves.

    A book is megabytes; the list of what is on the shelf is a few hundred
    bytes. The page reads the shelf when it opens and a book only when it is
    opened, so adding a library costs the reader nothing until they read.
    """
    books = []
    for name in sorted(os.listdir(folder)):
        if not name.endswith('.json') or name == 'index.json':
            continue
        with open(os.path.join(folder, name), encoding='utf-8') as f:
            b = json.load(f)
        books.append({
            'slug': b['slug'],
            'title': b['title'],
            'author': b['author'],
            'chapters': [{'n': c['n'], 'title': c['title'],
                          'words': sum(len(p.split()) for p in c['paras'])}
                         for c in b['chapters']],
        })
    with open(os.path.join(folder, 'index.json'), 'w', encoding='utf-8', newline='') as f:
        json.dump(books, f, ensure_ascii=False)
    return books


def main(paths):
    """books/out by default; docs/books, which is published, only when asked.

    docs/ is served to anyone with the address. A book still in copyright goes
    to books/out and stays on the machine; --publish is for the ones that are
    out of copyright, and saying so out loud is the point of the flag.
    """
    out = OUT
    if '--publish' in paths:
        paths = [p for p in paths if p != '--publish']
        out = os.path.join(HERE, 'docs', 'books')
    os.path.isdir(out) or os.makedirs(out)
    for path in paths:
        book = read(path)
        dest = os.path.join(out, book['slug'] + '.json')
        with open(dest, 'w', encoding='utf-8', newline='') as f:
            json.dump(book, f, ensure_ascii=False)
        words = sum(len(p.split()) for c in book['chapters'] for p in c['paras'])
        print('%s - %s' % (book['title'], book['author'] or 'no author'))
        print('  %d chapters, %s words, %d KB -> %s'
              % (len(book['chapters']), format(words, ','),
                 os.path.getsize(dest) // 1024,
                 os.path.relpath(dest, HERE).replace(os.sep, '/')))
        for c in book['chapters']:
            print('   %2d. %-32s %s' % (c['n'], c['title'][:32], c['paras'][0][:56]))
    shelf = catalogue(out)
    print('%s lists %d book(s)'
          % (os.path.relpath(os.path.join(out, 'index.json'), HERE).replace(os.sep, '/'),
             len(shelf)))


if __name__ == '__main__':
    main(sys.argv[1:])
