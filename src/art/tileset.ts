import type Phaser from 'phaser';
import { Px, registerSheet, hash2 } from './pixel';
import { C } from './palette';
import { COLS, ROWS, TILE } from '../config';

export type Theme = 'ash' | 'shrine' | 'boss';

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
};

const isWallCh = (ch: string | undefined) => ch === undefined || ch === '#' || ch === 'o' || ch === 'b';
const isWaterCh = (ch: string | undefined) => ch === '~';
const isChanCh = (ch: string | undefined) => ch === '>' || ch === '<' || ch === '^' || ch === 'v';

/** 방의 고정 부분(바닥·벽·물웅덩이·통로)을 한 장의 텍스처로 굽는다 */
export function paintRoom(scene: Phaser.Scene, key: string, layout: string[], theme: Theme): void {
  const t = THEMES[theme];
  const px = new Px(COLS * TILE, ROWS * TILE);
  const at = (c: number, r: number) => (r < 0 || r >= ROWS || c < 0 || c >= COLS ? undefined : layout[r][c]);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = at(c, r);
      const x0 = c * TILE;
      const y0 = r * TILE;
      if (isWallCh(ch)) paintWall(px, t, c, r, x0, y0, at, ch === 'o');
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
