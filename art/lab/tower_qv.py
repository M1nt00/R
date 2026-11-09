"""산소탑 쿼터뷰 (40×80, 8프레임). 옛 탑(32×64)의 모양 언어(돔 뚜껑+안테나, 기둥 둘 사이 유리관 속 청록 액체와 기포,
화면 달린 받침, 넓은 판)를 유지하고, 둥근 것은 윗면 타원이, 상자는 윗면이 보이게. 빛은 왼쪽 위.
usage: py -I tower_qv.py <out_dir>"""
import sys
from PIL import Image

W, H = 40, 80
PAL = {
    'O': (0x18, 0x14, 0x25), 'W': (0xff, 0xff, 0xff), 'c': (0xc0, 0xcb, 0xdc), 'e': (0x8b, 0x9b, 0xb4),
    'b': (0x5a, 0x69, 0x88), 'f': (0x3a, 0x44, 0x66), 'i': (0x26, 0x2b, 0x44), 'd': (0x2c, 0xe8, 0xf5),
    'h': (0x00, 0x99, 0xdb), 'n': (0x12, 0x4e, 0x89),
}
CX = 19.5  # 가운데 (x 0~39)


def metal(t):
    """둥근 금속: t = -1(왼쪽 끝) ~ 1(오른쪽 끝)"""
    return 'W' if t < -0.72 else 'c' if t < -0.15 else 'e' if t < 0.35 else 'b' if t < 0.75 else 'f'


def frame(f):
    px = {}

    def part(mask, color):
        """뒤에서 앞으로: 먼저 테두리(바깥 1px), 그다음 칠"""
        ring = {(x + dx, y + dy) for (x, y) in mask for dx in (-1, 0, 1) for dy in (-1, 0, 1)} - set(mask)
        for p in ring:
            px[p] = 'O'
        for (x, y) in mask:
            px[(x, y)] = color(x, y)

    def ell(x, y, r, cy, ry):
        return ((x - CX) / r) ** 2 + ((y - cy) / ry) ** 2 <= 1

    def cylinder(r, y_top, y_bot, ry):
        """세운 원기둥: 윗면 타원(y_top 중심) + 몸통 + 아래 앞쪽 곡선(y_bot 중심)"""
        m = []
        for y in range(int(y_top - ry) - 1, int(y_bot + ry) + 2):
            for x in range(W):
                if abs(x - CX) > r:
                    continue
                if ell(x, y, r + 0.01, y_top, ry) or (y_top <= y <= y_bot) or (y > y_bot and ell(x, y, r + 0.01, y_bot, ry)):
                    m.append((x, y))
        return m

    def top_face(r, y_top, ry):
        return lambda x, y: ell(x, y, r + 0.01, y_top, ry) and not ell(x, y, r - 1.5, y_top + 0.6, ry - 0.8)

    # ── 바닥 판 (네모, 윗면 + 앞면)
    plinth = [(x, y) for x in range(5, 35) for y in range(63, 78)]
    def plinth_c(x, y):
        if y <= 70:  # 윗면
            if y == 63:
                return 'W' if x < 20 else 'c'
            if (x, y) in ((7, 65), (32, 65), (7, 69), (32, 69)):
                return 'b'  # 볼트
            return 'c' if x < 30 else 'e'
        if y == 71:
            return 'e'
        if y == 77:
            return 'i'
        return 'e' if x < 11 else 'b' if x < 27 else 'f'
    part(plinth, plinth_c)

    # ── 받침 상자 (윗면 y45~50, 앞면 y51~66), 앞면에 화면
    box = [(x, y) for x in range(9, 31) for y in range(45, 67)]
    def box_c(x, y):
        if y <= 50:
            if y == 45:
                return 'W' if x < 22 else 'c'
            return 'c' if x < 27 else 'e'
        if 54 <= y <= 60 and 13 <= x <= 25:  # 화면
            if y in (54, 60) or x in (13, 25):
                return 'i'
            if y == 57 and x in (16, 19, 22):
                k = (x - 16) // 3
                return 'd' if (f // 2 + k) % 3 != 0 else 'h'
            return 'f'
        if y in (63, 64) and 12 <= x <= 26 and x % 2 == 0:
            return 'b'  # 통풍구
        if y == 51:
            return 'e' if x < 27 else 'b'  # 윗면 아래 그늘
        return 'W' if x == 9 else 'c' if x < 24 else 'e' if x < 27 else 'b' if x < 29 else 'f'
    part(box, box_c)

    def arc(yc, ry, x, r):
        """타원 앞쪽 곡선의 y (가운데가 가장 아래)"""
        t = min(1.0, abs(x - CX) / r)
        return yc + ry * (1 - t * t) ** 0.5

    def lid(r, yc, ry, color):
        """고리 윗면 (타원 전체)"""
        part([(x, y) for x in range(W) for y in range(int(yc - ry) - 1, int(yc + ry) + 2) if ell(x, y, r + 0.01, yc, ry)], color)

    def band(r, yt, yb, ry):
        """고리 옆면: 위·아래 모서리가 앞으로 휘어진 띠. 첫 줄은 밝은 테"""
        m = [(x, y) for x in range(W) for y in range(int(yt) - 1, int(yb + ry) + 2) if abs(x - CX) <= r and arc(yt, ry, x, r) <= y + 0.5 <= arc(yb, ry, x, r) + 1]
        top = {}
        for (x, y) in m:
            top[x] = min(top.get(x, 99), y)
        part(m, lambda x, y: ('c' if (x - CX) / r < 0.2 else 'e') if y == top[x] else metal((x - CX) / r + 0.35))

    R_RING, RY = 8.5, 2.5
    # ── 아래 고리 윗면 → 유리·기둥 → 아래 고리 옆면
    lid(R_RING, 42, RY, lambda x, y: 'c' if x < 24 else 'e')
    surf = 21
    bubbles = [(16, 0), (20, 9), (23, 4), (18, 15), (21, 20)]  # (x, 시작 위상): 프레임마다 3px씩 올라가 8프레임에 한 바퀴
    by = set()
    for bx, ph in bubbles:
        yy = 43 - ((ph + f * 3) % 24)
        if yy > surf + 1:
            by.add((bx, yy))
    glass = [(x, y) for x in range(14, 26) for y in range(16, 46) if y <= arc(42, 1.8, x, 6.5)]
    def glass_c(x, y):
        s_y = round(arc(surf, 1.2, x, 6.5))
        if y < s_y:  # 빈 유리 윗부분
            return 'W' if x == 14 else 'i' if x > 22 else 'f'
        if y == s_y:  # 액체 표면 (반짝임이 옆으로 흐름)
            return 'W' if (x + f) % 4 == 0 else 'd'
        if (x, y) in by:
            return 'W'
        return 'W' if x == 14 else 'd' if x <= 21 else 'h' if x <= 24 else 'n'
    part(glass, glass_c)
    for x0 in (11, 26):  # 기둥 (2px)
        post = [(x, y) for x in (x0, x0 + 1) for y in range(15, 45)]
        part(post, lambda x, y, x0=x0: ('c' if x == x0 else 'e') if x0 == 11 else ('b' if x == x0 else 'f'))
    band(R_RING, 42, 45, RY)

    # ── 위 고리 윗면 → 돔 → 위 고리 옆면
    lid(R_RING, 12, RY, lambda x, y: 'c' if x < 24 else 'e')
    dome = [(x, y) for x in range(W) for y in range(3, 16) if ell(x, y, 7.5, 12.5, 8) and y <= arc(12.5, 1.5, x, 7.5)]
    def dome_c(x, y):
        t = (x - CX) / 7.5
        if (x, y) in ((15, 7), (16, 7), (15, 8), (14, 9), (14, 10)):
            return 'W'
        return metal(t + 0.3)
    part(dome, dome_c)
    band(R_RING, 13, 16, RY)

    # ── 목 + 불빛 (깜빡임)
    neck = [(x, y) for x in (19, 20) for y in range(2, 5)]
    part(neck, lambda x, y: 'c' if x == 19 else 'b')
    on = f < 4
    lamp = [(x, y) for x in (19, 20) for y in (0, 1)]
    part(lamp, lambda x, y: ('W' if (x, y) == (19, 0) else 'd') if on else ('b' if x == 19 else 'f'))

    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for (x, y), k in px.items():
        if 0 <= x < W and 0 <= y + 1 < H:  # 1px 내려서 맨 위 불빛 테두리까지 (맨 아래 줄 79 = 바닥 테두리)
            im.putpixel((x, y + 1), PAL[k] + (255,))
    return im, on


out = sys.argv[1]
frames = [frame(f)[0] for f in range(8)]
strip = Image.new('RGBA', (W * 8, H), (0, 0, 0, 0))
for i, im in enumerate(frames):
    strip.alpha_composite(im, (i * W, 0))
strip.save(out + '/oxygen_tower_qv.png')
# 미리보기: 옛 탑 · 새 탑 0프레임 · 주인공 (보라 바닥, 6배) + 8프레임 줄
old = Image.open(sys.argv[2]).convert('RGBA')
hero = Image.open(sys.argv[3]).convert('RGBA').crop((13, 11, 34, 43))
bg = (0x68, 0x38, 0x6c, 255)
cmp_ = Image.new('RGBA', (32 + 40 + 21 + 24, 84), bg)
cmp_.alpha_composite(old, (4, 84 - 2 - 64)); cmp_.alpha_composite(frames[0], (4 + 32 + 6, 84 - 2 - 80)); cmp_.alpha_composite(hero, (4 + 32 + 6 + 40 + 6, 84 - 2 - 32))
cmp_.resize((cmp_.width * 6, cmp_.height * 6), Image.NEAREST).save(out + '/tower_qv_compare.png')
row = Image.new('RGBA', (W * 8 + 7 * 2, H), bg)
for i, im in enumerate(frames):
    row.alpha_composite(im, (i * (W + 2), 0))
row.resize((row.width * 4, row.height * 4), Image.NEAREST).save(out + '/tower_qv_frames.png')
gif = [Image.alpha_composite(Image.new('RGBA', (W, H), bg), im).resize((W * 6, H * 6), Image.NEAREST) for im in frames]
gif[0].save(out + '/tower_qv.gif', save_all=True, append_images=gif[1:], duration=110, loop=0, disposal=2)
print('ok')
