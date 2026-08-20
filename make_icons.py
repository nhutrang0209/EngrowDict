"""Draw the home-screen icons.

    python make_icons.py

iOS masks the icon into a rounded square itself, so what is drawn here is a
plain square with no transparency and no corners of its own. Android is handed
the same file as `maskable`, which is why the letter sits well inside the
middle: a circular mask must not clip it.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'docs')

GREEN = (13, 107, 79)       # --accent, the green the whole page is built on
CREAM = (238, 240, 236)     # --ground

FONTS = ['C:/Windows/Fonts/georgiab.ttf', 'C:/Windows/Fonts/timesbd.ttf',
         '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf']


def font_at(size):
    for path in FONTS:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw(px):
    img = Image.new('RGB', (px, px), GREEN)
    d = ImageDraw.Draw(img)
    f = font_at(int(px * 0.52))
    box = d.textbbox((0, 0), 'E', font=f)
    d.text(((px - box[2] - box[0]) / 2, (px - box[3] - box[1]) / 2), 'E',
           font=f, fill=CREAM)
    return img


for size in (180, 192, 512):
    p = os.path.join(OUT, 'icon-%d.png' % size)
    draw(size).save(p, optimize=True)
    print('%-22s %5d bytes' % (os.path.basename(p), os.path.getsize(p)))
