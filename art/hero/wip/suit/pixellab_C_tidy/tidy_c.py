"""Gentle tidy of original C: keep every pixel's place, only merge near-same colours and tone down lone specks."""
import sys
sys.argv = ['x', 'suitC', 'unused']
exec(open('clean_c.py').read().split('for d in DS:')[0])
KEY = {'out': 'o', 'v0': 'a', 'v1': 'b', 'v2': 'c', 's0': 'd', 's1': 'e', 's2': 'f', 's3': 'g', 'w': 'w', 'or': 'r', 'cy': 'y', 'gl': 'l'}
CH = {KEY[k]: v for k, v in PAL.items()}
inv = {v: KEY[k] for k, v in PAL.items()}
LIGHT, DARK = set('wgl'), set('oab')

def tidy(d):
    im = Image.open(f'suitC/{d}.png').convert('RGBA')
    g = [['.' if im.getpixel((x, y))[3] == 0 else inv[nearest(im.getpixel((x, y))[:3])] for x in range(32)] for y in range(32)]
    at = lambda x, y: g[y][x] if 0 <= x < 32 and 0 <= y < 32 else '.'
    n8 = lambda x, y: [at(x + i, y + j) for i in (-1, 0, 1) for j in (-1, 0, 1) if i or j]
    n4 = lambda x, y: [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)]
    ch = []
    for y in range(32):
        for x in range(32):
            c = g[y][x]
            if c == '.' or '.' in n4(x, y): continue          # silhouette edge untouched
            nb = n8(x, y)
            if c == 'o' and sum(n in DARK for n in nb) <= 1 and sum(n in LIGHT for n in nb) >= 3:
                ch.append((x, y, 'c'))                         # lone black dot in white suit -> dark blue-grey
            elif c in 'wg' and not any(n in LIGHT for n in nb) and sum(n in DARK for n in nb) >= 3:
                ch.append((x, y, 'f'))                         # lone white dot in dark area -> light grey
    for x, y, c in ch: g[y][x] = c
    return g, len(ch)

if __name__ == '__main__':
    import os
    os.makedirs('suitC_tidy', exist_ok=True)
    for d in ['south', 'east', 'north', 'west']:
        g, n = tidy(d)
        out = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
        for y in range(32):
            for x in range(32):
                if g[y][x] != '.': out.putpixel((x, y), CH[g[y][x]] + (255,))
        out.save(f'suitC_tidy/{d}.png')
        open(f'suitC_tidy/{d}.txt', 'w').write('\n'.join(''.join(r) for r in g))
        print(d, 'changed', n)
