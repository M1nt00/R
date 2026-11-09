"""Pixel touch-ups on top of tidy pass 1 (suitC_tidy/*.txt). Each entry: (x, y, new key)."""
import sys, json
from PIL import Image
exec(open('tidy_c.py').read().split("if __name__")[0])
FIX = {
 'south': [
  (10,3,'o'), (9,4,'o'), (10,4,'f'),
  (9,5,'f'), (9,6,'f'), (9,7,'f'), (9,8,'f'), (9,9,'f'), (10,7,'f'), (10,8,'f'),
  (20,6,'f'), (20,7,'f'), (20,8,'f'), (21,4,'f'), (21,5,'e'), (21,6,'e'), (21,7,'e'), (21,8,'e'), (21,9,'e'),
  (22,5,'o'), (22,6,'o'), (22,9,'o'),
  (18,13,'o'), (11,14,'o'), (10,15,'c'), (11,15,'o'),
  (19,14,'o'), (20,14,'c'), (19,15,'o'), (20,15,'c'), (20,16,'c'),
  (9,17,'c'), (7,18,'c'), (11,18,'o'), (19,18,'o'), (8,16,'f'), (8,19,'d'),
  (13,19,'f'), (17,19,'f'), (22,19,'c'), (24,20,'c'), (13,21,'d'), (14,22,'d'), (10,22,'o'), (7,22,'f'),
  (13,23,'e'), (10,23,'o'), (17,24,'c'), (12,26,'c'), (18,26,'c'), (19,26,'c'), (18,29,'c'),
 ],
 'east': [
  (10,5,'w'), (9,7,'g'), (10,9,'g'), (9,16,'f'), (9,17,'f'), (7,11,'o'), (7,19,'o'), (13,6,'c'), (11,10,'o'),
  (18,14,'o'), (18,15,'o'), (12,15,'c'), (14,16,'c'), (15,16,'c'), (18,17,'o'), (14,18,'g'), (21,18,'o'),
  (13,19,'d'), (11,20,'o'), (12,20,'c'), (20,21,'e'), (14,22,'c'), (14,23,'c'), (15,23,'c'), (16,25,'c'),
  (14,27,'c'), (16,27,'c'), (13,29,'c'),
 ],
 'north': [
  (14,4,'c'), (16,4,'c'), (20,4,'o'), (12,5,'w'), (21,11,'f'), (13,12,'g'), (9,16,'f'), (6,18,'o'), (7,16,'o'),
  (13,17,'a'), (13,19,'w'), (7,20,'c'), (8,20,'c'), (9,21,'c'), (13,21,'d'), (8,22,'o'), (11,24,'c'),
 ],
}

# Round 2 (user request): east belly bump pulled back to the body line; south visor from a 9x8 circle to a 9x6 oval.
ROWS = {
 'south': {3: (10, 'owwooooowfo'), 4: (8, 'oofoolbbbbooffo'), 5: (8, 'offolbbbbbbofeo'),
           6: (8, 'offobbbbbaaofeo'), 7: (8, 'offoobaaaaoofeo'), 8: (8, 'offffooooofffeo'),
           9: (8, 'efffggggfffffeo')},
}
FIX['east'] += [(21, 20, 'o'), (22, 20, '.'), (21, 21, 'o'), (22, 21, '.')]
for d, rows in ROWS.items():
    for y, (x0, seg) in rows.items():
        FIX[d] += [(x0 + i, y, c) for i, c in enumerate(seg)]

def load(d):
    return [list(r) for r in open(f'suitC_tidy/{d}.txt').read().split('\n')]
def save(g, path):
    out = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    for y in range(32):
        for x in range(32):
            if g[y][x] != '.': out.putpixel((x, y), CH[g[y][x]] + (255,))
    out.save(path)
if __name__ == '__main__':
    import os; os.makedirs('suitC_fix', exist_ok=True)
    for d, fx in FIX.items():
        g = load(d)
        for x, y, c in fx: g[y][x] = c
        save(g, f'suitC_fix/{d}.png')
        open(f'suitC_fix/{d}.txt', 'w').write('\n'.join(''.join(r) for r in g))
        print(d, len(fx), 'fixes')
    Image.open('suitC_fix/east.png').transpose(Image.FLIP_LEFT_RIGHT).save('suitC_fix/west.png')
