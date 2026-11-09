# Builds art/hero/hero_body.png (+ empty hero_elem.png) for the spacesuit hero: 12 cols x 32 rows of 48x48.
# Rows = direction x 8 + anim; directions down, up, side (faces right), left (optional rows read by customArt.ts).
# Run animation from run/final; every other anim is the standing pose from final_base (placeholder, like the old hero).
import sys
from collections import Counter
from pathlib import Path
from PIL import Image
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'run'))
from holes import scan

CELL, COLS, FOOT = 48, 12, 42
ORDER = ['idle', 'run', 'roll', 'attack', 'attack2', 'cast', 'hurt', 'death']
COUNT = {'idle': 8, 'run': 8, 'roll': 8, 'attack': 12, 'attack2': 12, 'cast': 4, 'hurt': 2, 'death': 3}
DIRS = [('down', 'S'), ('up', 'N'), ('side', 'E'), ('left', 'W')]

def fill_holes(im):
    px = im.load()
    dark = Counter(p for p in im.getdata() if p[3] and max(p[:3]) < 50 and p[2] - p[0] < 20)
    black = dark.most_common(1)[0][0]
    n = 0
    for _ in range(5):
        inner, dents = scan(im)
        if not inner and not dents: break
        for x, y in inner + dents: px[x, y] = black
        n += len(inner) + len(dents)
    return n

def base_cell(d):
    im = Image.open(HERE / 'final_base' / f'{d}.png').convert('RGBA')
    n = fill_holes(im)
    bb = im.getchannel('A').getbbox()
    c = Image.new('RGBA', (CELL, CELL)); c.alpha_composite(im, ((CELL - 32) // 2, FOOT + 1 - bb[3]))
    return c, n

sheet = Image.new('RGBA', (COLS * CELL, len(DIRS) * len(ORDER) * CELL))
for di, (dir_name, d) in enumerate(DIRS):
    base, n = base_cell(d)
    run = Image.open(HERE / 'run' / 'final' / f'run_{d}.png').convert('RGBA')
    run_cells = [run.crop((i * CELL, 0, i * CELL + CELL, CELL)) for i in range(run.width // CELL)]
    need_run = 6 if dir_name in ('side', 'left') else 8
    assert len(run_cells) == need_run, (d, len(run_cells))
    for ai, anim in enumerate(ORDER):
        cells = run_cells if anim == 'run' else [base] * COUNT[anim]
        for f, c in enumerate(cells):
            sheet.alpha_composite(c, (f * CELL, (di * len(ORDER) + ai) * CELL))
    print(dir_name, 'base holes filled', n, 'run frames', len(run_cells))

out = HERE.parent.parent  # art/hero
sheet.save(out / 'hero_body.png')
Image.new('RGBA', sheet.size).save(out / 'hero_elem.png')   # no element colour on the suit
print('hero_body.png', sheet.size)
