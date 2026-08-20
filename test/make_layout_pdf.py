"""Draw a PDF that behaves like a printed novel, for the importers to be tested on.

    python test/make_layout_pdf.py

Everything here is something a real book does and a reader does not want to see:
a running header on every page, a page number, a chapter opening set with letter
spacing, a drop capital drawn beside its own word rather than as part of it, a
word broken across a line ending, and paragraphs marked only by an indent. The
shouting is there on purpose too — "SEIZE HIM!" is a line of the story, and an
importer that mistakes capitals for a heading will eat it.
"""
import os

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'layout-test.pdf')

CHAPTERS = [
    ('C H A P T E R  O N E', 'THE BOY WHO LIVED'),
    ('C H A P T E R  T W O', 'THE VANISHING GLASS'),
    ('C H A P T E R  T H R E E', 'THE LETTERS FROM NO ONE'),
]

# Each paragraph is a list of lines, already broken as a typesetter would break
# them. The first line of each is indented by the drawing code below.
PARAGRAPHS = [
    ['r. and Mrs. Dursley, of number four, Privet Drive, were proud to',
     'say that they were perfectly normal, thank you very much. They',
     'were the last people you would expect to be involved in anything',
     'strange, because they simply did not hold with such nonsense.'],
    ['The owl swooped low over the garden wall, hung there a moment in',
     'the cold air, and then went swoop-',
     'ing back over the hedge and out of sight behind the chimney pots.'],
    ['"I WANT MY LETTER!" he shouted.'],
    ['SEIZE HIM!'],
    ['They had a small son called Dudley and in their opinion there was',
     'no finer boy anywhere in the whole of the world, which was a view',
     'nobody outside the house had ever been heard to share.'],
]

LEAD = 15.0
INDENT = 18
LEFT = 72
TOP = 96
BOTTOM = 720


def draw(doc, chapter, page_no, opening):
    page = doc.new_page()
    spaced, name = CHAPTERS[chapter]
    # the running header: the chapter on the left page, its name on the right
    page.insert_text((LEFT, 56), spaced.upper() if page_no % 2 else name, fontsize=8)

    y = TOP
    if opening:
        page.insert_text((LEFT, y), spaced, fontsize=13)
        y += 34
        page.insert_text((LEFT, y), name, fontsize=17)
        y += 44

    first = True
    while y < BOTTOM:
        for par in PARAGRAPHS:
            for i, line in enumerate(par):
                if y >= BOTTOM:
                    break
                x = LEFT
                if i == 0 and not (first and opening):
                    x = LEFT + INDENT          # a paragraph is marked by an indent
                if first and opening and i == 0:
                    # the drop capital, drawn beside the word it belongs to
                    page.insert_text((LEFT - 2, y + 6), 'M', fontsize=30)
                    x = LEFT + 26
                page.insert_text((x, y), line, fontsize=10.5)
                y += LEAD
            y += 0                              # no extra space between paragraphs
            first = False
        if y < BOTTOM:
            break
    page.insert_text((300, 762), str(page_no), fontsize=9)


def main():
    doc = pymupdf.open()
    toc, n = [], 0
    for c in range(len(CHAPTERS)):
        for p in range(3):
            n += 1
            if p == 0:
                toc.append([1, CHAPTERS[c][1], n])
            draw(doc, c, n, p == 0)
    doc.set_toc(toc)
    doc.save(OUT)
    print('%s — %d pages' % (os.path.relpath(OUT, os.path.dirname(HERE)), doc.page_count))


if __name__ == '__main__':
    main()
