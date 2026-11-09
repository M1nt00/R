# Finds outline holes: transparent pixels enclosed by the sprite, and dents (transparent with 3+ opaque 4-neighbours).
from PIL import Image
def scan(f):
    px = f.load(); W, H = f.size
    op = lambda x, y: 0 <= x < W and 0 <= y < H and px[x, y][3] > 0
    seen = set(); stack = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < W and 0 <= y < H) or op(x, y): continue
        seen.add((x, y)); stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    inner = [(x, y) for y in range(H) for x in range(W) if not op(x, y) and (x, y) not in seen]
    dents = [(x, y) for y in range(H) for x in range(W) if not op(x, y) and (x, y) in seen
             and sum(op(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))) >= 3]
    return inner, dents
