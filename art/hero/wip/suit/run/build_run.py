# Touch up the Sprite Fusion run frames and lay them out as 48x48 game cells (feet on y42, centre x24).
# Only pixel fixes: near-black specks -> outline black, missing outline pixels on the silhouette edge,
# the broken helmet top in back frame 1, and the chest light on the right-facing side (mirror of left).
from collections import Counter
from pathlib import Path
from PIL import Image
from holes import scan

N_IN, CELL, FOOT = 40, 48, 42
POSE_FOOT = 37   # foot row of the 40x40 pose canvas the animations started from
RAW = set()      # every direction: lowest pixel on the foot line (user: aligned feet look more natural)
ORANGE = (236, 108, 9, 255)   # front view: the suit's right chest light is orange, left is cyan

def frames(sheet):
    s = Image.open(sheet).convert('RGBA')
    return [s.crop((i * N_IN, 0, i * N_IN + N_IN, N_IN)) for i in range(s.width // N_IN)]

def near_black(p):  # dark but not the navy visor
    return p[3] and max(p[:3]) < 50 and p[2] - p[0] < 20

def outline_black(fs):  # each sheet has its own outline black; keep it
    c = Counter(p for f in fs for p in f.getdata() if near_black(p))
    return c.most_common(1)[0][0]

def fix(f, BLACK):
    px = f.load(); W, H = f.size; n = 0
    for y in range(H):
        for x in range(W):
            if near_black(px[x, y]) and px[x, y] != BLACK:
                px[x, y] = BLACK; n += 1
    edge = []
    for y in range(H):
        for x in range(W):
            p = px[x, y]
            if not p[3] or p == BLACK: continue
            if any(not (0 <= x + dx < W and 0 <= y + dy < H) or px[x + dx, y + dy][3] == 0
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                edge.append((x, y))
    for x, y in edge:
        px[x, y] = BLACK
    # background pixels poking into the outline where two parts meet, and enclosed holes;
    # a few passes close the short slits between arm and body that open up one pixel at a time
    filled = 0
    for _ in range(5):
        inner, dents = scan(f)
        if not inner and not dents: break
        for x, y in inner + dents:
            px[x, y] = BLACK
        filled += len(inner) + len(dents)
    return n, len(edge), filled

def ground(f, raw=False):
    """48 cell, 40 canvas centred. raw: same shift for every frame; else lowest pixel on the foot line."""
    bb = f.getchannel('A').getbbox()
    c = Image.new('RGBA', (CELL, CELL))
    c.alpha_composite(f, ((CELL - N_IN) // 2, FOOT - POSE_FOOT if raw else FOOT + 1 - bb[3]))
    return c

def strip(cells):
    s = Image.new('RGBA', (CELL * len(cells), CELL))
    for i, c in enumerate(cells): s.alpha_composite(c, (i * CELL, 0))
    return s

out = Path('final'); out.mkdir(exist_ok=True)
anims = {d: frames(f'{d}_run_sheet.png') for d in ('S', 'W', 'N')}

# back frame 1: helmet top row became off-white with loose outline dots above it
f = anims['N'][1]; px = f.load(); BLACK = outline_black(anims['N'])
for x in range(N_IN): px[x, 2] = (0, 0, 0, 0)
for x in range(17, 24): px[x, 3] = BLACK

# side frame 2: the helmet top sat on the dome like a square cap; drop the two corners of its top row (user request)
f = anims['W'][2]; px = f.load(); top = f.getchannel('A').getbbox()[1]
row = [x for x in range(N_IN) if px[x, top][3]]
assert row == list(range(row[0], row[-1] + 1)) and len(row) == 6, row
for x in (row[0], row[-1]): px[x, top] = (0, 0, 0, 0)

# front: the run start pose came out one column wider than the standing pose (helmet 18 vs 17, visor 12 vs 11,
# chest panel 8 vs 7, cyan light 2 vs 1). Drop the column of the second cyan pixel in every frame (user request)
CYAN = (71, 213, 243)
for i, f in enumerate(anims['S']):
    px = f.load()
    xs = sorted({x for y in range(N_IN) for x in range(N_IN) if px[x, y][3] and px[x, y][:3] == CYAN})
    assert len(xs) == 2, (i, xs)
    n = f.copy(); n.paste((0, 0, 0, 0), (xs[1], 0, N_IN, N_IN)); n.paste(f.crop((xs[1] + 1, 0, N_IN, N_IN)), (xs[1], 0))
    anims['S'][i] = n

# front frame 8 (5th in the game's loop): the chest panel's orange light doubled downward; keep only the one
# left of the cyan light, the rest of the panel interior goes back to panel grey (user request)
is_orange = lambda p: p[3] and p[0] > 200 and 80 < p[1] < 150 and p[2] < 60
fixed = []
for i, f in enumerate(anims['S']):
    px = f.load()
    cx, cy = next((x, y) for y in range(N_IN) for x in range(N_IN) if px[x, y][3] and px[x, y][:3] == CYAN)
    assert is_orange(px[cx - 2, cy]), i
    for y in range(cy - 1, cy + 2):
        for x in range(cx - 3, cx + 2):
            if (x, y) != (cx - 2, cy) and is_orange(px[x, y]):
                px[x, y] = px[cx - 1, y]; fixed.append((i + 1, x, y))
assert [f[0] for f in fixed] == [8], fixed

for d, fs in anims.items():
    if d in RAW:
        print(d, 'kept as Sprite Fusion made it'); continue
    k = outline_black(fs)
    print(d, 'outline', k[:3], '(specks recoloured, outline pixels added, holes filled) per frame', [fix(f, k) for f in fs])

# side frames 3 and 6 (the hop frames): the round ear disc beside the visor broke. Frame 3 lost both sides of the
# ring's second row, frame 6 grew a black stub under the ring; make them the ring the other frames have (user request)
BLACK = outline_black(anims['W']); LIGHT = (186, 200, 206, 255)
f = anims['W'][2]; px = f.load(); top = f.getchannel('A').getbbox()[1]
assert px[17, top + 9] == px[20, top + 9] == BLACK and px[17, top + 8] != BLACK
for x in (17, 20): px[x, top + 8] = BLACK
f = anims['W'][5]; px = f.load(); top = f.getchannel('A').getbbox()[1]
assert px[18, top + 11] == px[18, top + 12] == px[19, top + 12] == BLACK
for x in (18, 19): px[x, top + 12] = LIGHT

anims['E'] = []
for f in anims['W']:
    e = f.transpose(Image.FLIP_LEFT_RIGHT); px = e.load()
    for y in range(N_IN):
        for x in range(N_IN):
            p = px[x, y]
            if p[3] and p[2] > p[0] + 60 and p[1] > p[0] + 60 and p[1] > 120:
                px[x, y] = ORANGE  # E reuses W's outline black via the mirror
    anims['E'].append(e)

for d, fs in anims.items():
    raw = d in RAW or (d == 'E' and 'W' in RAW)
    cells = [ground(f, raw) for f in fs]
    strip(cells).save(out / f'run_{d}.png')
    tops = [c.getchannel('A').getbbox()[1] for c in cells]
    bottoms = [c.getchannel('A').getbbox()[3] - 1 for c in cells]
    left = [scan(c) for c in cells]
    print(d, 'remaining holes per frame', [len(a) + len(b) for a, b in left])
    assert max(bottoms) == FOOT and (raw or set(bottoms) == {FOOT}), bottoms
    print(d, len(cells), 'frames, head top rows', tops, 'foot rows', bottoms)
