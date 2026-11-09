"""Rule cleanup for astronaut C: merge palette, soften interior black lines, drop lone specks."""
import sys
from collections import Counter
from PIL import Image

SRC, DST = sys.argv[1], sys.argv[2]
DS = 'south south-east east north-east north north-west west south-west'.split()
OUT = (0x0a, 0x0c, 0x24)
PAL = {  # name: rgb
    'out': OUT, 'v0': (0x0b, 0x1e, 0x47), 'v1': (0x24, 0x3a, 0x64), 'v2': (0x3a, 0x58, 0x7f),
    's0': (0x58, 0x77, 0x96), 's1': (0x80, 0x9c, 0xaf), 's2': (0xa2, 0xb9, 0xcd), 's3': (0xd0, 0xdd, 0xe9),
    'w': (0xf8, 0xfb, 0xe8), 'or': (0xec, 0x48, 0x17), 'cy': (0x3b, 0xf0, 0xd0), 'gl': (0xbf, 0xeb, 0xfd),
}
SOFT = PAL['v2']  # what an interior black line between light pixels becomes
lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

def nearest(c):
    r, g, b = c
    sat = max(c) - min(c)
    if r > 180 and g < 120: return PAL['or']                     # orange family
    if g > 150 and b > 150 and r < 120 and sat > 90: return PAL['cy']  # cyan lights
    if r < 30 and g < 40 and b < 60 and lum(c) < 25: return OUT       # all near-blacks
    if 20 <= r <= 70 and 20 <= g <= 70 and 20 <= b <= 70 and sat < 20: return OUT  # neutral dark greys
    pool = [v for k, v in PAL.items() if k not in ('or', 'cy', 'out')]
    return min(pool, key=lambda p: sum((a - b) ** 2 for a, b in zip(p, c)))

for d in DS:
    im = Image.open(f'{SRC}/{d}.png').convert('RGBA')
    w, h = im.size
    px = im.load()
    g = [[None if px[x, y][3] == 0 else nearest(px[x, y][:3]) for x in range(w)] for y in range(h)]
    at = lambda x, y: g[y][x] if 0 <= x < w and 0 <= y < h else None
    n4 = lambda x, y: [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)]
    n8 = lambda x, y: n4(x, y) + [at(x + 1, y + 1), at(x - 1, y - 1), at(x + 1, y - 1), at(x - 1, y + 1)]
    # 1) interior black pixels touching 2+ light pixels -> soft dark blue (inner lines lighter than the silhouette outline)
    soft = []
    for y in range(h):
        for x in range(w):
            if g[y][x] != OUT: continue
            nb = n4(x, y)
            if None in nb: continue  # silhouette edge keeps the outline
            if sum(1 for c in nb if lum(c) > 140) >= 2: soft.append((x, y))
    for x, y in soft: g[y][x] = SOFT
    # 2) lone specks: no same colour among 8 neighbours -> most common neighbour colour (orange and outline kept)
    fix = []
    for y in range(h):
        for x in range(w):
            c = g[y][x]
            if c is None or c in (PAL['or'], OUT): continue
            nb = [n for n in n8(x, y) if n is not None]
            if len(nb) < 8 or c in nb: continue
            fix.append((x, y, Counter(n for n in nb if n != OUT).most_common(1)))
    for x, y, mc in fix:
        if mc: g[y][x] = mc[0][0]
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for y in range(h):
        for x in range(w):
            if g[y][x]: out.putpixel((x, y), g[y][x] + (255,))
    out.save(f'{DST}/{d}.png')
    print(d, 'soft', len(soft), 'speck', len(fix))
