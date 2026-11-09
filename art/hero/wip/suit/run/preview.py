# usage: preview.py <sheet.png> <frame size> <out.png> : splits frames, prints bbox per frame, writes an enlarged strip
import sys
from PIL import Image, ImageDraw
sheet = Image.open(sys.argv[1]).convert('RGBA'); n = int(sys.argv[2]); out = sys.argv[3]
cols, rows = sheet.width // n, sheet.height // n
frames = [sheet.crop((c * n, r * n, c * n + n, r * n + n)) for r in range(rows) for c in range(cols)]
frames = [f for f in frames if f.getchannel('A').getbbox()]
for i, f in enumerate(frames):
    bb = f.getchannel('A').getbbox(); print(i, 'bbox', bb, 'size', bb[2] - bb[0], 'x', bb[3] - bb[1], 'colors', len(set(f.getdata())))
S = 8
strip = Image.new('RGBA', (len(frames) * (n * S + 8), n * S + 20), (58, 62, 70))
d = ImageDraw.Draw(strip)
for i, f in enumerate(frames):
    strip.alpha_composite(f.resize((n * S, n * S), Image.NEAREST), (i * (n * S + 8), 20))
    d.text((i * (n * S + 8) + 4, 4), str(i), fill=(230, 230, 230))
    y = 20 + (n - 2) * S  # canvas row n-2 = intended foot line
    d.line([(i * (n * S + 8), y), (i * (n * S + 8) + n * S, y)], fill=(255, 80, 80))
strip.save(out)
