"""PixelLab 원본 프레임 → 게임용 hero_body.png / hero_elem.png

※ 더 이상 쓰지 않음: 지금 시트는 Aseprite에서 다시 그린 동작을 섞어 8열로 만든다
  (C:/Users/reojh/aseprite-work/hero/build_sheet.lua). 이 스크립트는 6열 시트를 만들어 게임과 맞지 않으므로
  실수로 덮어쓰지 않게 --force 없이는 실행되지 않는다. 이전 결과는 art/hero/backup/ 에 있다.

사용법 (저장소 루트에서):
    python3 art/hero/pixellab/build_sheet.py

입력: art/hero/pixellab/raw/  (PixelLab 캐릭터 ZIP을 푼 폴더. <state>/animations/<이름>/<방향>/frame_NNN.png)
출력: art/hero/hero_body.png, art/hero/hero_elem.png  (48×48 칸, 6열 × 24줄)

- 방향: 아래=south, 위=north, 옆=east (왼쪽은 게임이 좌우 반전)
- 동작별로 어떤 PixelLab 애니메이션의 몇 번 프레임을 쓸지는 아래 PICK 표에서 정한다
- 원소 레이어 분리: 청록색(원소색) 픽셀은 hero_elem으로 옮겨 회색 단계로 바꾸고,
  가장 밝은 흰빛 심(core)은 본체에 중립 흰색으로 남겨 어떤 원소든 빛나 보이게 한다
"""

from __future__ import annotations

import colorsys
import glob
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, 'raw')
OUT = os.path.dirname(ROOT)

CELL = 48
FOOT = CELL - 6  # 발밑선 y (게임 쪽 heroOriginY 와 같은 규칙)
CX = CELL // 2
COLS = 6

DIRS = [('down', 'south'), ('up', 'north'), ('side', 'east')]
ORDER = ['idle', 'run', 'roll', 'attack', 'attack2', 'cast', 'hurt', 'death']
COUNT = {'idle': 4, 'run': 6, 'roll': 5, 'attack': 4, 'attack2': 4, 'cast': 4, 'hurt': 2, 'death': 3}

# 동작 → 방향별 (PixelLab 애니메이션 이름, 쓸 프레임 번호들)
# 생성된 순서가 게임 순서(예비동작 → 스미어 → 타격 정지 → 회복)와 다르면 번호로 재배치한다
ALL = ('south', 'north', 'east')


def same(anim: str, idxs: list[int]) -> dict[str, tuple[str, list[int]]]:
    return {d: (anim, idxs) for d in ALL}


PICK: dict[str, dict[str, tuple[str, list[int]]]] = {
    'idle': same('idle', [0, 1, 2, 3]),
    'run': same('run', [0, 1, 2, 3, 4, 5]),
    # 0번은 웅크림(예비동작)
    'roll': same('roll', [1, 2, 3, 4, 5]),
    'attack': {
        'south': ('slash_down', [1, 2, 3, 0]),
        'north': ('slash_down', [0, 1, 2, 3]),
        'east': ('slash_down', [0, 2, 3, 3]),
    },
    'attack2': {
        'south': ('slash_up', [3, 1, 2, 0]),
        'north': ('slash_up', [0, 1, 2, 3]),
        'east': ('slash_up', [2, 1, 0, 3]),
    },
    'cast': same('cast', [0, 1, 2, 3]),
    'hurt': {
        'south': ('hurt', [1, 2]),
        # 뒷모습 피격은 생성하지 못해서 대기 0번을 1px 밀어 만든다 (게임의 흰 번쩍임과 함께 보임)
        'north': ('@nudge:idle', [0, 0]),
        'east': ('hurt', [1, 2]),
    },
    # 사망도 따로 생성하지 못해서 정면 피격 프레임 → 주저앉음 → 옆으로 쓰러짐으로 합성
    'death': same('@death', [0, 1, 2]),
}


def is_elem(r: int, g: int, b: int) -> bool:
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    h *= 360
    if 198 < h <= 204:
        # 하늘색 마법 빛(시전 때 후드에 비치는 빛 등). 망토 하이라이트(207°~, 채도 0.55 미만)와 구분
        return s >= 0.55 and v >= 0.85
    if not (172 <= h <= 198):
        return False
    # 밝은 청록 + 검날의 어두운 청록 그림자까지 (회청색 망토는 색상 207° 이상이라 제외됨)
    return v >= 0.75 or (s >= 0.5 and v >= 0.5)


def is_core(r: int, g: int, b: int) -> bool:
    _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return s < 0.15 and v > 0.96


def elem_gray(r: int, g: int, b: int) -> int:
    lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255
    if lum >= 0.68:
        return 0xFF
    if lum >= 0.55:
        return 0xCD
    if lum >= 0.42:
        return 0x98
    return 0x50


def find_state() -> str:
    states = [d for d in glob.glob(os.path.join(RAW, '*')) if os.path.isdir(os.path.join(d, 'animations'))]
    if not states:
        sys.exit(f'원본이 없어요: {RAW}/<state>/animations/... (PixelLab 캐릭터 ZIP을 raw/ 에 풀어 주세요)')
    return states[0]


def load_frames(state: str, anim: str, direction: str) -> list[Image.Image]:
    d = os.path.join(state, 'animations', anim, direction)
    files = sorted(glob.glob(os.path.join(d, 'frame_*.png')))
    if not files:
        sys.exit(f'프레임이 없어요: {d}')
    return [Image.open(f).convert('RGBA') for f in files]


def clip_offset(w: int, h: int) -> tuple[int, int]:
    """PixelLab은 캐릭터를 캔버스 가운데에 두고, 발밑은 캔버스 중심 + 14 줄에 온다
    (32 캔버스 = y30, 44 캔버스 = y36). 동작 전체에 같은 이동량을 써서 떨림이 없게 한다."""
    return CX - w // 2, FOOT - (h // 2 + 14)


def nudge(img: Image.Image, dx: int, dy: int) -> Image.Image:
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.alpha_composite(img, (max(dx, 0), max(dy, 0)), (max(-dx, 0), max(-dy, 0)))
    return out


def squash(img: Image.Image, k: float) -> Image.Image:
    """발밑을 고정한 채 세로로 눌러 주저앉는 느낌"""
    bb = img.getbbox()
    if not bb:
        return img
    part = img.crop(bb)
    nh = max(1, round(part.height * k))
    part = part.resize((part.width, nh), Image.NEAREST)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.alpha_composite(part, (bb[0], bb[3] - nh))
    return out


def lying(state: str, size: tuple[int, int]) -> Image.Image:
    """정면 회전 그림을 눕혀서 땅에 쓰러진 모습"""
    rot = Image.open(os.path.join(state, 'rotations', 'south.png')).convert('RGBA')
    rot = rot.crop(rot.getbbox()).transpose(Image.Transpose.ROTATE_90)
    out = Image.new('RGBA', size, (0, 0, 0, 0))
    w, h = size
    foot = h // 2 + 14
    out.alpha_composite(rot, ((w - rot.width) // 2, foot + 1 - rot.height))
    return out


def resolve(state: str, anim: str, direction: str) -> list[Image.Image]:
    if anim == '@death':
        hurt = load_frames(state, 'hurt', 'south')
        return [hurt[1], squash(hurt[2], 0.7), lying(state, hurt[0].size)]
    if anim.startswith('@nudge:'):
        base = load_frames(state, anim.split(':', 1)[1], direction)
        return [nudge(base[0], 0, 1), nudge(base[0], 0, 2)]
    return load_frames(state, anim, direction)


def split(img: Image.Image) -> tuple[Image.Image, Image.Image]:
    body = Image.new('RGBA', img.size, (0, 0, 0, 0))
    elem = Image.new('RGBA', img.size, (0, 0, 0, 0))
    bp, ep, sp = body.load(), elem.load(), img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = sp[x, y]
            if a < 128:
                continue
            if is_elem(r, g, b):
                if is_core(r, g, b):
                    bp[x, y] = (0xF4, 0xF4, 0xF4, 255)
                else:
                    gv = elem_gray(r, g, b)
                    ep[x, y] = (gv, gv, gv, 255)
            else:
                bp[x, y] = (r, g, b, 255)
    return body, elem


def main() -> None:
    if '--force' not in sys.argv:
        sys.exit('지금 시트는 Aseprite 파이프라인(8열)으로 만들어요. 6열 PixelLab 시트로 덮어쓰려면 --force')
    state = find_state()
    rows = len(DIRS) * len(ORDER)
    body_sheet = Image.new('RGBA', (CELL * COLS, CELL * rows), (0, 0, 0, 0))
    elem_sheet = Image.new('RGBA', (CELL * COLS, CELL * rows), (0, 0, 0, 0))
    for di, (_, pl_dir) in enumerate(DIRS):
        for ai, act in enumerate(ORDER):
            anim, idxs = PICK[act][pl_dir]
            frames = resolve(state, anim, pl_dir)
            dx, dy = clip_offset(*frames[0].size)
            assert len(idxs) == COUNT[act], f'{act}: 프레임 {COUNT[act]}개 필요'
            for col, fi in enumerate(idxs):
                f = frames[min(fi, len(frames) - 1)]
                b, e = split(f)
                ox, oy = col * CELL, (di * len(ORDER) + ai) * CELL
                # 칸 밖으로 넘치는 부분은 잘라서 붙인다
                for layer, sheet in ((b, body_sheet), (e, elem_sheet)):
                    cellimg = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
                    cellimg.alpha_composite(layer, (max(dx, 0), max(dy, 0)), (max(-dx, 0), max(-dy, 0)))
                    sheet.alpha_composite(cellimg, (ox, oy))
    body_sheet.save(os.path.join(OUT, 'hero_body.png'))
    elem_sheet.save(os.path.join(OUT, 'hero_elem.png'))
    print('저장:', os.path.join(OUT, 'hero_body.png'), os.path.join(OUT, 'hero_elem.png'))


if __name__ == '__main__':
    main()
