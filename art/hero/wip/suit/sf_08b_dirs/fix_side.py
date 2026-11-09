# Shrink the side-view helmet to the front helmet's size using only the original pixels:
# delete helmet rows/columns, then repeat straight body rows so the feet stay on the bottom line.
import sys
from PIL import Image

DEL_ROWS = [3, 8]          # dome row and a straight visor row (original row numbers)
DEL_COLS = [11, 12]        # back of the dome, removed only in helmet rows
HELMET_LAST = 13           # original rows 0..13 are helmet
DUP_ROWS = [20, 27]        # torso/arm row and leg row, repeated once each

src = Image.open('E.png').convert('RGBA')
W, H = src.size
px = [[src.getpixel((x, y)) for x in range(W)] for y in range(H)]
# one black for the outline, like the front view
px = [[(0, 0, 0, 255) if p[3] and max(p[:3]) < 25 else p for p in row] for row in px]

rows = []
for y, row in enumerate(px):
    if y in DEL_ROWS:
        continue
    if y <= HELMET_LAST:
        row = [p for x, p in enumerate(row) if x not in DEL_COLS] + [(0, 0, 0, 0)] * len(DEL_COLS)
    rows.append(row)
    if y in DUP_ROWS:
        rows.append(list(row))
assert len(rows) == H, len(rows)

out = Image.new('RGBA', (W, H))
for y, row in enumerate(rows):
    for x, p in enumerate(row):
        out.putpixel((x, y), p)
out.save('E_fix.png')
out.transpose(Image.FLIP_LEFT_RIGHT).save('W_fix.png')
bb = out.getchannel('A').getbbox()
print('E_fix fig', bb[2] - bb[0], 'x', bb[3] - bb[1], bb)
