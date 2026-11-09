import Phaser from 'phaser';
import { Px, registerSheet, hash2 } from './pixel';
import { C, E32 } from './palette';
import { COLS, ROWS, TILE } from '../config';

export type Theme = 'ash' | 'shrine' | 'boss' | 'lab' | 'dust';

interface ThemeColors {
  slab: [number, number];
  mortar: number;
  hi: number;
  speck: number;
  ember: number | null;
  wallTop: number;
  wallFace: [number, number, number];
}

const THEMES: Record<Theme, ThemeColors> = {
  ash: {
    slab: [C.floor1, C.floor1],
    mortar: C.floor0,
    hi: C.floor2,
    speck: C.stone1,
    ember: C.fire2,
    wallTop: C.stone0,
    wallFace: [C.stone1, C.stone2, C.stone0],
  },
  shrine: {
    slab: [C.floor1, C.floor1],
    mortar: C.floor0,
    hi: C.floor2,
    speck: C.floor2,
    ember: null,
    wallTop: 0x262b44,
    wallFace: [0x3a4466, 0x5a6988, 0x181425],
  },
  boss: {
    slab: [0x3e2731, 0x3e2731],
    mortar: 0x181425,
    hi: 0x733e39,
    speck: 0x733e39,
    ember: C.fire1,
    wallTop: 0x181425,
    wallFace: [0x3e2731, 0x3e2731, 0x181425],
  },
  // 실험실: 바닥·벽은 paintLab*가 따로 그리고, 여기 값은 벽 아래 그림자 색에만 쓰인다
  lab: {
    slab: [E32.slate, E32.slate],
    mortar: E32.night,
    hi: E32.steel,
    speck: E32.steel,
    ember: null,
    wallTop: E32.night,
    wallFace: [E32.indigo, E32.slate, E32.black],
  },
  // 보라 먼지 평원: 바닥은 paintDustFloor가 따로 그리고 벽은 없음 (값은 혹시 벽이 생기면 쓰는 기본값)
  dust: {
    slab: [E32.plum, E32.plum],
    mortar: E32.darkbrown,
    hi: E32.magenta,
    speck: E32.magenta,
    ember: null,
    wallTop: E32.black,
    wallFace: [E32.darkbrown, E32.plum, E32.black],
  },
};

const isWallCh = (ch: string | undefined) => ch === undefined || ch === '#' || ch === 'o' || ch === 'b';
const isWaterCh = (ch: string | undefined) => ch === '~';
const isChanCh = (ch: string | undefined) => ch === '>' || ch === '<' || ch === '^' || ch === 'v';

/** 방의 고정 부분(바닥·벽·물웅덩이·통로)을 한 장의 텍스처로 굽는다 */
export function paintRoom(scene: Phaser.Scene, key: string, layout: string[], theme: Theme): void {
  const t = THEMES[theme];
  const px = new Px(COLS * TILE, ROWS * TILE);
  const at = (c: number, r: number) => (r < 0 || r >= ROWS || c < 0 || c >= COLS ? undefined : layout[r][c]);
  const dust = theme === 'dust' ? dustField(COLS * TILE, ROWS * TILE) : null;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = at(c, r);
      const x0 = c * TILE;
      const y0 = r * TILE;
      if (isWallCh(ch)) {
        if (theme === 'lab') paintLabWall(px, c, r, x0, y0, at);
        else paintWall(px, t, c, r, x0, y0, at, ch === 'o');
      } else if (theme === 'lab') paintLabFloor(px, c, r, x0, y0, ch!, at);
      else if (dust) paintDustFloor(px, x0, y0, dust);
      else paintFloor(px, t, c, r, x0, y0, theme);
    }
  }
  // 물웅덩이·통로 (바닥 위)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = at(c, r);
      if (isWaterCh(ch)) paintWater(px, c, r, (dc, dr) => isWaterCh(at(c + dc, r + dr)));
      else if (isChanCh(ch)) paintChannel(px, c, r, (dc, dr) => isChanCh(at(c + dc, r + dr)));
    }
  }
  // 벽 아래 바닥에 그림자
  for (let r = 1; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isWallCh(at(c, r)) || !isWallCh(at(c, r - 1))) continue;
      for (let k = 0; k < 4; k++) {
        for (let x = 0; x < TILE; x++) {
          const X = c * TILE + x;
          const Y = r * TILE + k;
          if ((k === 3 && (x + Y) % 2 === 0) || k < 3) px.set(X, Y, k < 2 ? C.ink : t.mortar);
        }
      }
    }
  }
  registerSheet(scene, key, [px]);
}

function paintFloor(px: Px, t: ThemeColors, c: number, r: number, x0: number, y0: number, theme: Theme) {
  const h = hash2(c, r, 7);
  // 큰 판석 위주, 가끔 4조각. 이음매는 오른쪽·아래만 진하게, 하이라이트는 왼쪽 위 모서리 몇 픽셀만 (빛 방향 통일)
  const split = h % 10 < 2;
  const slabs = split
    ? [
        [0, 0, 8, 8],
        [8, 0, 8, 8],
        [0, 8, 8, 8],
        [8, 8, 8, 8],
      ]
    : [[0, 0, 16, 16]];
  slabs.forEach(([sx, sy, sw, sh], k) => {
    const col = t.slab[hash2(c * 3 + k, r * 5 + k, 3) % 100 < 50 ? 0 : 1];
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let v = col;
        if (x === sw - 1 || y === sh - 1) v = t.mortar;
        else if ((x === 0 && y < 3) || (y === 0 && x < 3)) v = t.hi;
        px.set(x0 + sx + x, y0 + sy + y, v);
      }
    }
  });
  // 성긴 디더 얼룩으로 판석마다 미세한 차이
  if (h % 4 === 0) {
    for (let k = 0; k < 6; k++) {
      const hh = hash2(c * 7 + k, r * 11, 13);
      const x = 2 + (hh % 11);
      const y = 2 + ((hh >> 4) % 11);
      if ((x + y) % 2 === 0) px.set(x0 + x, y0 + y, t.mortar);
    }
  }
  for (let k = 0; k < 2; k++) {
    const hh = hash2(c, r, 11 + k);
    if (hh % 4 !== 0) continue;
    px.set(x0 + 2 + (hh % 11), y0 + 2 + ((hh >> 4) % 11), t.speck);
  }
  if (h % 17 === 0) {
    let x = x0 + 3 + (h % 6);
    let y = y0 + 3;
    for (let k = 0; k < 7; k++) {
      px.set(x, y, t.mortar);
      x += (hash2(c, r, k) % 3) - 1;
      y += 1;
    }
  }
  if (t.ember !== null && h % 23 === 0) px.set(x0 + 4 + (h % 8), y0 + 5 + ((h >> 3) % 6), t.ember);
  if (theme === 'shrine') {
    const cx = COLS / 2 - 0.5;
    const cy = ROWS / 2;
    const d = Math.hypot(c - cx, (r - cy) * 1.2);
    if (Math.abs(d - 5) < 0.6 || Math.abs(d - 3) < 0.4) {
      for (let k = 0; k < 4; k++) px.set(x0 + 4 + k * 3, y0 + 7, C.stone2);
    }
  }
}

function paintWall(
  px: Px,
  t: ThemeColors,
  c: number,
  r: number,
  x0: number,
  y0: number,
  at: (c: number, r: number) => string | undefined,
  pillar: boolean,
) {
  const below = at(c, r + 1);
  const face = below !== undefined && !isWallCh(below);
  if (face) {
    // 벽면: 위 4줄 갓돌 + 벽돌
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let v: number;
        if (y < 3) v = y === 0 ? t.wallFace[1] : t.wallFace[0];
        else if (y === 15) v = C.ink;
        else {
          const row = Math.floor((y - 3) / 4);
          const off = row % 2 ? 4 : 0;
          const bx = (x + off + c * 16) % 8;
          const by = (y - 3) % 4;
          if (by === 3 || bx === 7) v = t.wallFace[2];
          else if (by === 0 || bx === 0) v = t.wallFace[1];
          else v = t.wallFace[0];
          if (hash2(c * 16 + x, r * 16 + y, 5) % 37 === 0) v = t.wallFace[2];
        }
        px.set(x0 + x, y0 + y, v);
      }
    }
    if (pillar) {
      px.vline(x0, y0, y0 + 15, C.out);
      px.vline(x0 + 15, y0, y0 + 15, C.out);
    }
    return;
  }
  // 벽 윗면
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let v = t.wallTop;
      if (hash2(c * 16 + x, r * 16 + y, 9) % 23 === 0) v = C.ink;
      px.set(x0 + x, y0 + y, v);
    }
  }
  const edge = t.wallFace[0];
  if (!isWallCh(at(c - 1, r)) && at(c - 1, r) !== undefined) px.vline(x0, y0, y0 + 15, edge);
  if (!isWallCh(at(c + 1, r)) && at(c + 1, r) !== undefined) px.vline(x0 + 15, y0, y0 + 15, edge);
  if (!isWallCh(at(c, r - 1)) && at(c, r - 1) !== undefined) px.hline(x0, x0 + 15, y0, t.wallFace[1]);
}

function paintWater(px: Px, c: number, r: number, water: (dc: number, dr: number) => boolean) {
  const x0 = c * TILE;
  const y0 = r * TILE;
  const up = water(0, -1);
  const dn = water(0, 1);
  const lf = water(-1, 0);
  const rt = water(1, 0);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // 바깥 모서리 둥글게
      const cornerTL = !up && !lf && x + y < 4;
      const cornerTR = !up && !rt && 15 - x + y < 4;
      const cornerBL = !dn && !lf && x + 15 - y < 4;
      const cornerBR = !dn && !rt && 30 - x - y < 4;
      if (cornerTL || cornerTR || cornerBL || cornerBR) continue;
      let v: number = C.water2;
      if (!up && y < 2) v = y === 0 ? C.ink : 0x124e89;
      else if (!dn && y > 13) v = y === 15 ? C.water1 : C.water2;
      else if ((!lf && x === 0) || (!rt && x === 15)) v = 0x124e89;
      else if ((y + Math.floor(hash2(c, r, 1) / 100)) % 6 === 3 && (x + c * 3) % 9 < 4) v = 0x0099db;
      px.set(x0 + x, y0 + y, v);
    }
  }
  const h = hash2(c, r, 4);
  if (h % 3 === 0) px.hline(x0 + 3 + (h % 6), x0 + 5 + (h % 6), y0 + 6 + (h % 5), C.water1);
}

function paintChannel(px: Px, c: number, r: number, chan: (dc: number, dr: number) => boolean) {
  const x0 = c * TILE;
  const y0 = r * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let v = (x + y) % 4 === 0 ? 0x193c3e : 0x262b44;
      if (!chan(0, -1) && y === 0) v = C.stone2;
      if (!chan(0, 1) && y === 15) v = C.stone1;
      if (!chan(-1, 0) && x === 0) v = C.stone2;
      if (!chan(1, 0) && x === 15) v = C.stone1;
      px.set(x0 + x, y0 + y, v);
    }
  }
}

// ───────────────────────── 보라 먼지 평원 테마 ─────────────────────────

/** 2차원 값 노이즈 0~1 (맵 픽셀 좌표에 붙어서 타일 경계 없이 이어짐) */
function vnoise(x: number, y: number, seed: number) {
  const X = Math.floor(x), Y = Math.floor(y);
  const u = x - X, v = y - Y, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(X, Y, seed), b = hash2(X + 1, Y, seed), c = hash2(X, Y + 1, seed), d = hash2(X + 1, Y + 1, seed);
  return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) / 999;
}

/** 먼지 평원의 큰 무늬 (4px마다 계산하고 사이는 이어 붙임 — 픽셀마다 노이즈를 돌리면 맵 굽기가 느려서) */
const DUST_STEP = 4;
interface DustField {
  w: number;
  /** 언덕 비탈 밝기 (표준편차 0.5, +는 빛 받는 비탈) */
  shade: Float32Array;
  /** 물결이 생기는 자리 (0~1), 물결 휨 */
  ripple: Float32Array;
  warp: Float32Array;
}

function dustField(W: number, H: number): DustField {
  const w = Math.ceil(W / DUST_STEP) + 2, h = Math.ceil(H / DUST_STEP) + 2;
  const mk = () => new Float32Array(w * h);
  const f: DustField = { w, shade: mk(), ripple: mk(), warp: mk() };
  // 큰 언덕 + 작은 둔덕 높이. 빛은 왼쪽 위에서 오니까 오른쪽·아래로 갈수록 높아지는 비탈이 밝다
  const height = (x: number, y: number) => vnoise(x / 90, y / 70, 1) * 0.7 + vnoise(x / 34, y / 28, 2) * 0.3;
  let ss = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = i * DUST_STEP, y = j * DUST_STEP, k = j * w + i;
      const s = height(x + 6, y) - height(x - 6, y) + height(x, y + 6) - height(x, y - 6);
      f.shade[k] = s;
      ss += s * s;
      f.ripple[k] = vnoise(x / 40, y / 40, 31);
      f.warp[k] = vnoise(x / 48, y / 48, 17) * 40;
    }
  }
  const sd = Math.sqrt(ss / (w * h)) || 1;
  for (let k = 0; k < w * h; k++) f.shade[k] *= 0.5 / sd;
  return f;
}

/** 큰 무늬 하나를 픽셀 (X,Y)에서 읽기 (이웃 4점 사이를 이어서) */
function sampleField(f: DustField, a: Float32Array, X: number, Y: number) {
  const gx = X / DUST_STEP, gy = Y / DUST_STEP, i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j, k = j * f.w + i;
  return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + f.w] * (1 - u) + a[k + f.w + 1] * u) * v;
}

/**
 * 먼지 바닥 (보라 바탕, 돌·갈라진 땅 없는 모래 평원):
 * - 언덕: 그늘진 비탈은 진갈색 모래알, 빛 받는 비탈은 자홍 모래알이 점점 많아짐 (경계가 부드럽게)
 * - 비스듬한 모래 물결 (꼭대기 자홍 1px + 그 아래 그늘 1px), 군데군데만. 그늘 비탈에선 꼭대기가 안 빛남
 * - 가끔 분홍 반짝임
 */
function paintDustFloor(px: Px, x0: number, y0: number, f: DustField) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const X = x0 + x, Y = y0 + y;
      const s = sampleField(f, f.shade, X, Y);
      const g = hash2(X, Y, 53) / 999;
      let v: number = E32.plum;
      const dark = 0.03 + Math.max(0, -s - 0.25) * 0.7;
      const lite = 0.015 + Math.max(0, s - 0.35) * 0.4;
      if (g < dark) v = E32.darkbrown;
      else if (g > 1 - lite) v = E32.magenta;
      if (sampleField(f, f.ripple, X, Y) > 0.42) {
        const ph = (((Y + X * 0.35 + sampleField(f, f.warp, X, Y)) % 11) + 11) % 11;
        if (ph < 1) v = s < -0.4 ? E32.plum : E32.magenta;
        else if (ph < 2) v = E32.darkbrown;
      }
      if (v === E32.magenta && hash2(X, Y, 59) < 15) v = E32.pink; // 반짝이는 먼지
      px.set(X, Y, v);
    }
  }
}

/**
 * 미니맵 바탕: 구워 둔 먼지 바닥(floorKey)의 (x0,y0)부터 cell×cell마다 한 점 (w×h).
 * 칸마다 진갈색 알갱이·자홍 물결이 얼마나 많은지 세고 둘레와 고르게 펴서, 가장 많은 곳만 표시:
 * 그늘진 곳은 진갈색 (조금 많으면 체크무늬), 물결 많은 곳은 자홍 가로줄. 나머지는 자두색이라 차분함.
 */
export function paintDustMinimap(scene: Phaser.Scene, key: string, floorKey: string, x0: number, y0: number, w: number, h: number, cell: number): void {
  const cw = w * cell, ch = h * cell;
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(scene.textures.get(floorKey).getSourceImage() as CanvasImageSource, x0, y0, cw, ch, 0, 0, cw, ch);
  const d = ctx.getImageData(0, 0, cw, ch).data;
  const dark = new Float32Array(w * h), lite = new Float32Array(w * h);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const o = (y * cw + x) * 4, c = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2], k = Math.floor(y / cell) * w + Math.floor(x / cell);
      if (c === E32.darkbrown) dark[k]++;
      else if (c === E32.magenta || c === E32.pink) lite[k]++;
    }
  }
  // 5×5 칸 평균 (점점이 흩어지지 않고 덩어리로)
  const blur = (a: Float32Array) => {
    const o = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let t = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) t += a[Phaser.Math.Clamp(j + dy, 0, h - 1) * w + Phaser.Math.Clamp(i + dx, 0, w - 1)];
      o[j * w + i] = t;
    }
    return o;
  };
  const pct = (a: Float32Array, p: number) => [...a].sort((u, v) => u - v)[Math.floor(p * (a.length - 1))];
  const D = blur(dark), L = blur(lite);
  const d1 = pct(D, 0.85), d2 = pct(D, 0.96), l1 = pct(L, 0.88), l2 = pct(L, 0.97);
  const px = new Px(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let c: number = E32.plum;
      if (D[k] > d2 || (D[k] > d1 && (i + j) % 2 === 0)) c = E32.darkbrown;
      else if (L[k] > l2 || (L[k] > l1 && j % 2 === 0)) c = E32.magenta;
      px.set(i, j, c);
    }
  }
  registerSheet(scene, key, [px]);
}

// ───────────────────────── 실험실 테마 ─────────────────────────

/** 실험실 바닥: '.' 타일 바닥(8px 타일 2×2, 긁힘·반사점. 배수구는 상점 장치라 바닥에 안 그림), '=' 통로 철판(다이아몬드 무늬, 벽가 경고선), 'E' 적 입구(사선 줄무늬) */
function paintLabFloor(px: Px, c: number, r: number, x0: number, y0: number, ch: string, at: (c: number, r: number) => string | undefined) {
  const h = hash2(c, r, 7);
  if (ch === 'E') {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px.set(x0 + x, y0 + y, (x + y + c * 16 + r * 16) % 8 < 4 ? E32.amber : E32.black);
    return;
  }
  if (ch === '=') {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let v: number = E32.indigo;
        const bx = (x + (Math.floor(y / 4) % 2 ? 4 : 0)) % 8; // 다이아몬드 철판 돌기
        if (y % 4 === 0 && bx < 2) v = E32.steel;
        else if (y % 4 === 1 && bx > 0 && bx < 3) v = E32.night;
        px.set(x0 + x, y0 + y, v);
      }
    }
    // 벽가 경고선 (위쪽은 벽 그림자 4px 아래에)
    if (isWallCh(at(c, r - 1))) for (let x = 0; x < TILE; x++) px.set(x0 + x, y0 + 5, (x + c * 16) % 6 < 4 ? E32.amber : E32.black);
    if (isWallCh(at(c, r + 1))) for (let x = 0; x < TILE; x++) px.set(x0 + x, y0 + 13, (x + c * 16) % 6 < 4 ? E32.amber : E32.black);
    return;
  }
  // 타일 바닥
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let v: number = E32.slate;
      const sx = x % 8;
      const sy = y % 8;
      if (sx === 7 || sy === 7) v = E32.night;
      else if ((sx === 0 && sy < 3) || (sy === 0 && sx < 3)) v = E32.steel;
      else if ((x + y) % 2 === 0 && hash2(c * 2 + Math.floor(x / 8), r * 2 + Math.floor(y / 8), 3) % 5 === 0) v = E32.indigo; // 살짝 바랜 타일
      px.set(x0 + x, y0 + y, v);
    }
  }
  if (ch === 'a') {
    // 아르곤 탱크 받침판 (볼트 박힌 철판)
    px.rect(x0, y0, TILE, TILE, E32.indigo);
    px.rect(x0, y0, TILE, 1, E32.steel);
    px.rect(x0, y0, 1, TILE, E32.steel);
    px.rect(x0, y0 + 15, TILE, 1, E32.black);
    px.rect(x0 + 15, y0, 1, TILE, E32.black);
    for (const [bx, by] of [[3, 3], [12, 3], [3, 12], [12, 12]]) {
      px.set(x0 + bx, y0 + by, E32.steel);
      px.set(x0 + bx + 1, y0 + by + 1, E32.black);
    }
  } else if (h % 7 === 0) {
    px.line(x0 + 3 + (h % 5), y0 + 4, x0 + 6 + (h % 5), y0 + 11, E32.indigo); // 긁힘
  } else if (h % 5 === 0) {
    px.set(x0 + 2 + (h % 10), y0 + 2 + ((h >> 3) % 10), E32.silver); // 반사점
  }
}

/** 실험실 벽: 윗면은 어두운 패널 격자, 벽면은 금속 패널 + 배관 + 표시등 */
function paintLabWall(px: Px, c: number, r: number, x0: number, y0: number, at: (c: number, r: number) => string | undefined) {
  const below = at(c, r + 1);
  if (below !== undefined && !isWallCh(below)) {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let v: number;
        if (y === 0) v = E32.steel;
        else if (y < 3) v = E32.slate; // 갓판
        else if (y === 15) v = C.ink;
        else if (y === 8) v = E32.steel; // 배관
        else if (y === 9) v = E32.slate;
        else if (y === 10) v = E32.night;
        else if (x === 15 || y === 3 || y === 14) v = E32.night; // 패널 이음매
        else v = E32.indigo;
        px.set(x0 + x, y0 + y, v);
      }
    }
    if (c % 3 === 0) px.rect(x0 + 6, y0 + 7, 4, 5, E32.steel); // 배관 받침
    if (hash2(c, r, 2) % 4 === 0) px.set(x0 + 3, y0 + 12, E32.cyan); // 표시등
    return;
  }
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let v: number = E32.night;
      if (x === 15 || y === 15) v = C.ink;
      else if (x === 0 || y === 0) v = E32.indigo;
      px.set(x0 + x, y0 + y, v);
    }
  }
  if (hash2(c, r, 9) % 6 === 0) for (let k = 0; k < 3; k++) px.hline(x0 + 5, x0 + 10, y0 + 5 + k * 2, E32.indigo); // 환기구
}
