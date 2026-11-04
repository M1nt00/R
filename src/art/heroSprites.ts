import type Phaser from 'phaser';
import { Px, outline, registerActor } from './pixel';
import { C, E0, E1, E2 } from './palette';

/**
 * 주인공: 은발 진홍 코트 검사 (32×32, 발밑 y=26). 방향 3개(아래·위·옆 — 왼쪽은 좌우 반전).
 * 원소 레이어 = 검날 · 머리띠 · 허리띠 → 원소별 색 램프로 구워서 바꿔 끼운다.
 * 포니테일·머리띠 리본은 스프라이트에 굽지 않고 코드(스프링)로 그린다 → 프레임별 매달 위치만 기록.
 * 공격 = 예비동작 → 스미어(궤적을 늘인 1프레임) → 타격 정지 → 회복, 프레임마다 시간이 다르다.
 */

export type Dir = 'down' | 'up' | 'side';
export const DIRS: Dir[] = ['down', 'up', 'side'];

export interface AnimDef {
  start: number;
  count: number;
  /** 프레임별 시간(초) */
  durs: number[];
  loop: boolean;
}

/** 스프링(머리카락·리본)을 매달 위치 — 프레임 좌표 */
export interface Anchor {
  hair: [number, number];
  band: [number, number];
  /** 스프링을 몸 앞에 그릴지 (뒷모습일 때) */
  front: boolean;
}

interface Pose {
  bob: number;
  legA: number;
  legB: number;
  liftA: number;
  liftB: number;
  lean: number;
  hurt: boolean;
  hand: [number, number];
  ang: number;
  /** 스미어 프레임: [시작각, 끝각] 사이를 검 궤적으로 채움 */
  smear?: [number, number];
  glow?: number;
  swordBehind?: boolean;
  noSword?: boolean;
}

const P = (o: Partial<Pose> & { hand: [number, number]; ang: number }): Pose => ({
  bob: 0,
  legA: 0,
  legB: 0,
  liftA: 0,
  liftB: 0,
  lean: 0,
  hurt: false,
  ...o,
});

export type AnimName = 'idle' | 'run' | 'roll' | 'attack' | 'attack2' | 'cast' | 'hurt' | 'death';
export const ORDER: AnimName[] = ['idle', 'run', 'roll', 'attack', 'attack2', 'cast', 'hurt', 'death'];
export const DURS: Record<AnimName, number[]> = {
  idle: [0.32, 0.16, 0.32, 0.16],
  run: [0.07, 0.07, 0.07, 0.07, 0.07, 0.07],
  // 0: 예비동작(움츠림) → 1~4: 구르기
  roll: [0.04, 0.06, 0.06, 0.06, 0.08],
  // 예비동작 70ms → 스미어 40ms → 타격 정지 110ms → 회복 80ms
  attack: [0.07, 0.04, 0.11, 0.08],
  attack2: [0.07, 0.04, 0.11, 0.08],
  cast: [0.09, 0.05, 0.14, 0.08],
  hurt: [0.08, 0.12],
  death: [0.15, 0.2, 0.6],
};
const LOOP: Partial<Record<AnimName, boolean>> = { idle: true, run: true };

export const HERO_FRAMES_PER_DIR = ORDER.reduce((n, a) => n + DURS[a].length, 0);

export const HERO_ANIMS: Record<string, AnimDef> = (() => {
  const out: Record<string, AnimDef> = {};
  DIRS.forEach((dir, di) => {
    let o = di * HERO_FRAMES_PER_DIR;
    for (const a of ORDER) {
      out[`${a}_${dir}`] = { start: o, count: DURS[a].length, durs: DURS[a], loop: LOOP[a] === true };
      o += DURS[a].length;
    }
  });
  return out;
})();

/** 시작 후 이 시간이 지나면 칼이 닿는다 (예비동작 길이) */
export const SWING_HIT_DELAY = DURS.attack[0];
export const CAST_HIT_DELAY = DURS.cast[0];

export const HERO_ANCHORS: Anchor[] = [];

/** 직접 그린 PNG를 쓰는 중인지 (그때는 스프링 앵커가 없으므로 2차 동작을 끈다) */
export const HERO_SOURCE = { custom: false };

/** 시트 배치: 행 = 방향 × 동작 (아래·위·옆 순, 동작은 ORDER 순), 열 = 프레임 번호 */
export const HERO_SHEET_COLS = 6;
export function heroCell(dirIdx: number, animIdx: number, frame: number): { col: number; row: number } {
  return { col: frame, row: dirIdx * 8 + animIdx };
}

const runLegs = (k: number) => {
  const s = Math.sin((k / 6) * Math.PI * 2);
  const leg = Math.round(s * 2);
  return { legA: leg, legB: -leg, liftA: s > 0.4 ? 1 : 0, liftB: s < -0.4 ? 1 : 0, bob: Math.abs(s) > 0.7 ? 1 : 0 };
};

const TAU = Math.PI * 2;

function poseFor(dir: Dir, a: AnimName, i: number): Pose {
  if (a === 'roll') return P({ hand: [19, 21], ang: 0.9, bob: 2, lean: dir === 'side' ? 1 : 0, noSword: i > 0 });
  if (dir === 'side') {
    switch (a) {
      case 'idle':
        return P({ hand: [19, 19], ang: 0.75, bob: i >= 2 ? 1 : 0 });
      case 'run':
        return P({ hand: [18, 18], ang: 2.55, ...runLegs(i) });
      case 'attack':
        return [
          P({ hand: [14, 12], ang: -2.4, lean: -1, bob: 1 }),
          P({ hand: [21, 16], ang: 0.6, lean: 1, smear: [-2.4, 0.6], legA: 2, legB: -1 }),
          P({ hand: [21, 18], ang: 0.95, lean: 1, legA: 2, legB: -1 }),
          P({ hand: [20, 19], ang: 0.8, legA: 1 }),
        ][i];
      case 'attack2':
        return [
          P({ hand: [19, 21], ang: 1.4, lean: -1, bob: 1 }),
          P({ hand: [19, 12], ang: -1.6, lean: 1, smear: [1.4, -1.6], legA: 2, legB: -1 }),
          P({ hand: [17, 11], ang: -1.9 }),
          P({ hand: [18, 14], ang: -1.1 }),
        ][i];
      case 'cast':
        return [
          P({ hand: [19, 19], ang: 0.6, bob: 1, lean: -1 }),
          P({ hand: [18, 10], ang: -1.45, glow: 2, smear: [0.6, -1.45] }),
          P({ hand: [18, 10], ang: -1.45, glow: 1 }),
          P({ hand: [19, 15], ang: -0.6 }),
        ][i];
      case 'hurt':
        return P({ hand: [16, 19], ang: 1.9, lean: -1, hurt: true, bob: i });
      default:
        return P({ hand: [19, 19], ang: 0.75 });
    }
  }
  if (dir === 'down') {
    switch (a) {
      case 'idle':
        return P({ hand: [21, 19], ang: 1.25, bob: i >= 2 ? 1 : 0 });
      case 'run':
        return P({ hand: [21, 18], ang: 0.95, ...runLegs(i) });
      case 'attack':
        return [
          P({ hand: [22, 12], ang: -1.1, bob: 1 }),
          P({ hand: [17, 20], ang: 2.0, smear: [-1.1, 2.0] }),
          P({ hand: [15, 20], ang: 2.25, bob: 1 }),
          P({ hand: [17, 20], ang: 1.9 }),
        ][i];
      case 'attack2':
        return [
          P({ hand: [11, 19], ang: 2.3, bob: 1 }),
          P({ hand: [21, 17], ang: 0.2, smear: [2.3, 0.2] }),
          P({ hand: [22, 17], ang: 0.05 }),
          P({ hand: [21, 18], ang: 0.8 }),
        ][i];
      case 'cast':
        return [
          P({ hand: [21, 20], ang: 1.0, bob: 1 }),
          P({ hand: [20, 10], ang: -1.5, glow: 2, smear: [1.0, -1.5] }),
          P({ hand: [20, 10], ang: -1.5, glow: 1 }),
          P({ hand: [21, 16], ang: -0.6 }),
        ][i];
      case 'hurt':
        return P({ hand: [21, 20], ang: 1.3, hurt: true, bob: i });
      case 'death':
        return i === 0 ? P({ hand: [21, 20], ang: 1.3, hurt: true, bob: 1 }) : P({ hand: [22, 23], ang: 0.2, hurt: true, bob: 3, liftA: 3, liftB: 3 });
      default:
        return P({ hand: [21, 19], ang: 1.25 });
    }
  }
  switch (a) {
    case 'idle':
      return P({ hand: [21, 19], ang: -1.2, bob: i >= 2 ? 1 : 0, swordBehind: true });
    case 'run':
      return P({ hand: [21, 18], ang: -1.0, swordBehind: true, ...runLegs(i) });
    case 'attack':
      return [
        P({ hand: [22, 20], ang: 0.9, bob: 1 }),
        P({ hand: [14, 12], ang: -2.1, smear: [0.9, -2.1] }),
        P({ hand: [13, 12], ang: -2.3, swordBehind: true }),
        P({ hand: [12, 15], ang: -2.6, swordBehind: true }),
      ][i];
    case 'attack2':
      return [
        P({ hand: [10, 19], ang: 2.3, bob: 1 }),
        P({ hand: [20, 12], ang: -0.9, smear: [2.3, TAU - 0.9] }),
        P({ hand: [21, 13], ang: -0.7, swordBehind: true }),
        P({ hand: [21, 15], ang: -0.6, swordBehind: true }),
      ][i];
    case 'cast':
      return [
        P({ hand: [21, 20], ang: 1.0, bob: 1 }),
        P({ hand: [20, 10], ang: -1.5, glow: 2, swordBehind: true }),
        P({ hand: [20, 10], ang: -1.5, glow: 1, swordBehind: true }),
        P({ hand: [21, 16], ang: -0.8, swordBehind: true }),
      ][i];
    case 'hurt':
      return P({ hand: [21, 20], ang: 1.0, hurt: true, bob: i });
    default:
      return P({ hand: [21, 19], ang: -1.2, swordBehind: true });
  }
}

// ───────────────────────────── 부위 ─────────────────────────────

const LEN = 12;

/** 검: 손잡이·가드는 본체, 검날은 원소 레이어. 빛은 왼쪽 위 → 날 위쪽 면이 밝다 */
function sword(b: Px, e: Px, p: Pose) {
  const [hx, hy] = p.hand;
  const y = hy + p.bob;
  const dx = Math.cos(p.ang);
  const dy = Math.sin(p.ang);
  // 날의 두 면 중 왼쪽 위를 향한 쪽이 하이라이트
  let nx = -dy;
  let ny = dx;
  if (nx + ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  b.set(hx - dx, y - dy, C.leather1);
  b.set(hx - dx * 2, y - dy * 2, C.gold1);
  for (let k = -2; k <= 2; k++) b.set(hx + dx * 1.2 + -dy * k, y + dy * 1.2 + dx * k, k === 0 ? C.gold0 : C.gold1);
  for (let t = 2; t <= LEN; t++) {
    const x = hx + dx * t;
    const yy = y + dy * t;
    e.set(x, yy, t >= LEN - 1 ? E0 : E1);
    if (t < LEN - 1) e.set(x + nx * 0.9, yy + ny * 0.9, E0);
    if (t > 3 && t < LEN - 2) e.set(x - nx * 0.9, yy - ny * 0.9, E2);
  }
  if (p.glow) e.disc(hx + dx * LEN, y + dy * LEN, p.glow, E0);
  b.rect(hx - 1, y - 1, 2, 2, C.leather1);
  b.set(hx - 1, y - 1, C.leather0);
}

/** 스미어: 휘두른 구간 전체를 검 궤적으로 채운다 (최근일수록 밝고 두껍게) */
function smear(e: Px, p: Pose) {
  if (!p.smear) return;
  const [a0, a1] = p.smear;
  const [hx, hy] = p.hand;
  const y = hy + p.bob;
  const steps = Math.ceil(Math.abs(a1 - a0) / 0.035);
  for (let s = 0; s <= steps; s++) {
    const k = s / steps;
    const a = a0 + (a1 - a0) * k;
    const inner = Math.round(LEN - 2 - k * 6);
    for (let r = inner; r <= LEN + 1; r++) {
      const c = r >= LEN ? (k > 0.25 ? E0 : E1) : r >= LEN - 3 ? (k > 0.5 ? E1 : E2) : E2;
      e.set(hx + Math.cos(a) * r, y + Math.sin(a) * r, c);
    }
  }
}

function arm(b: Px, sx: number, sy: number, p: Pose, c0: number, c1: number) {
  const [hx, hy] = p.hand;
  b.line(sx, sy, hx, hy + p.bob, c1);
  b.line(sx + 1, sy, hx + (hx < sx ? 1 : 0), hy + p.bob - 1, c0);
}

function legFront(b: Px, x: number, lift: number, dark: boolean, bob: number) {
  const top = 22 + Math.min(bob, 1);
  const bottom = 26 - lift - Math.max(0, bob - 1);
  b.rect(x, top, 2, Math.max(1, bottom - 1 - top), dark ? C.pants1 : C.pants0);
  b.rect(x - (dark ? 0 : 1), bottom - 1, 3, 2, C.leather1);
  b.set(x - (dark ? 0 : 1), bottom - 1, C.leather0);
}

function legSide(b: Px, x: number, lift: number, dark: boolean, bob: number) {
  const top = 21 + Math.min(bob, 1);
  const bottom = 26 - lift - Math.max(0, bob - 1);
  b.rect(x, top, 2, Math.max(1, bottom - 1 - top), dark ? C.pants1 : C.pants0);
  b.rect(x, bottom - 1, 3, 2, C.leather1);
  b.set(x, bottom - 1, dark ? C.leather1 : C.leather0);
}

function drawSide(p: Pose, b: Px, e: Px): Anchor {
  const y0 = p.bob;
  const lx = p.lean;
  // 코트 자락 (뒤)
  for (let y = 19; y <= 24; y++) {
    const t = (y - 19) / 5;
    b.hline(13 + lx - Math.round(t * 2), 15 + lx, y + y0, y > 22 ? C.coat3 : C.coat2);
  }
  legSide(b, 15 + p.legB, p.liftB, true, y0);
  for (let y = 13; y <= 20; y++) {
    for (let x = 14; x <= 19; x++) {
      const c = x === 14 ? C.coat2 : x === 18 && y <= 16 ? C.coat0 : C.coat1;
      b.set(x + lx, y + y0, y === 20 ? C.coat2 : c);
    }
  }
  b.vline(19 + lx, 14 + y0, 18 + y0, C.coat1);
  b.hline(14 + lx, 19 + lx, 19 + y0, C.leather1);
  b.set(18 + lx, 19 + y0, C.gold0);
  e.hline(14 + lx, 18 + lx, 20 + y0, E1);
  e.set(14 + lx, 20 + y0, E2);
  legSide(b, 16 + p.legA, p.liftA, false, y0);
  // 어깨 갑옷 (위쪽이 밝음)
  b.rect(16 + lx, 13 + y0, 3, 2, C.steel1);
  b.hline(16 + lx, 18 + lx, 13 + y0, C.steel0);
  b.set(18 + lx, 14 + y0, C.steel2);

  const hx = 14 + lx;
  const hy = 6 + y0;
  b.rect(hx, hy, 7, 3, C.hairS0);
  b.set(hx + 2, hy - 1, C.hairS0);
  b.set(hx + 4, hy - 1, C.hairS0);
  b.set(hx + 3, hy - 2, C.hairS0);
  b.rect(hx - 1, hy + 1, 1, 3, C.hairS1);
  b.rect(hx, hy + 3, 2, 4, C.hairS1);
  b.set(hx, hy + 6, C.hairS2);
  b.hline(hx + 1, hx + 6, hy + 2, C.hairS1);
  b.rect(hx + 2, hy + 3, 5, 4, C.skin1);
  b.hline(hx + 3, hx + 6, hy + 3, C.skin0);
  b.set(hx + 6, hy + 3, C.hairS0);
  b.set(hx + 5, hy + 3, C.hairS1);
  b.set(hx + 7, hy + 5, C.skin1);
  b.hline(hx + 2, hx + 5, hy + 6, C.skin2);
  b.set(hx + 2, hy + 4, C.skin2);
  if (p.hurt) {
    b.set(hx + 5, hy + 4, C.ink);
    b.set(hx + 4, hy + 5, C.ink);
  } else {
    b.hline(hx + 4, hx + 5, hy + 4, C.ink);
    b.set(hx + 5, hy + 5, C.ink);
  }
  b.rect(hx + 2, hy + 7, 4, 1, C.coat1);
  e.hline(hx, hx + 6, hy + 2, E0);
  e.set(hx - 1, hy + 2, E1);

  if (!p.noSword) {
    arm(b, 17 + lx, 15 + y0, p, C.coat0, C.coat1);
    smear(e, p);
    sword(b, e, p);
  }
  return { hair: [hx, hy], band: [hx - 1, hy + 2], front: false };
}

function drawFront(p: Pose, b: Px, e: Px): Anchor {
  const y0 = p.bob;
  if (!p.noSword && p.swordBehind) sword(b, e, p);
  legFront(b, 13, p.liftA, false, y0);
  legFront(b, 17, p.liftB, true, y0);
  for (let y = 21; y <= 24; y++) {
    const w = y - 21;
    b.hline(11 - (w > 1 ? 1 : 0), 14, y + y0, y > 22 ? C.coat2 : C.coat1);
    b.hline(17, 20 + (w > 1 ? 1 : 0), y + y0, y > 22 ? C.coat3 : C.coat2);
  }
  b.rect(10, 15 + y0, 2, 5, C.coat1);
  b.vline(10, 15 + y0, 17 + y0, C.coat0);
  b.rect(10, 20 + y0, 2, 2, C.leather1);
  for (let y = 13; y <= 20; y++) {
    for (let x = 12; x <= 19; x++) {
      let c = x === 12 ? C.coat0 : x >= 18 ? C.coat2 : C.coat1;
      if (x === 14 && y <= 16) c = C.coat0;
      if (x === 17 && y <= 16) c = C.coat2;
      b.set(x, y + y0, c);
    }
  }
  b.rect(15, 13 + y0, 2, 3, C.steel0);
  b.set(16, 15 + y0, C.steel1);
  b.set(15, 16 + y0, C.steel2);
  b.hline(12, 19, 19 + y0, C.leather1);
  b.rect(15, 19 + y0, 2, 1, C.gold0);
  e.hline(12, 19, 20 + y0, E1);
  e.vline(18, 21 + y0, 22 + y0, E2);
  b.rect(10, 13 + y0, 4, 2, C.steel1);
  b.hline(10, 13, 13 + y0, C.steel0);
  b.set(9, 14 + y0, C.steel2);

  const hy = 6 + y0;
  b.set(14, hy - 2, C.hairS0);
  b.set(17, hy - 2, C.hairS0);
  b.hline(13, 14, hy - 1, C.hairS0);
  b.hline(16, 18, hy - 1, C.hairS0);
  b.rect(12, hy, 8, 2, C.hairS0);
  b.hline(11, 20, hy + 1, C.hairS1);
  b.rect(11, hy + 3, 2, 4, C.hairS1);
  b.rect(19, hy + 3, 2, 4, C.hairS2);
  b.set(11, hy + 6, C.hairS2);
  b.rect(13, hy + 3, 6, 4, C.skin1);
  b.hline(14, 17, hy + 3, C.skin0);
  b.hline(13, 15, hy + 3, C.hairS0);
  b.set(13, hy + 4, C.hairS1);
  b.set(18, hy + 3, C.hairS1);
  b.vline(18, hy + 4, hy + 6, C.skin2);
  b.hline(14, 17, hy + 7, C.skin2);
  if (p.hurt) {
    b.hline(14, 15, hy + 5, C.ink);
    b.hline(17, 18, hy + 5, C.ink);
  } else {
    b.hline(14, 15, hy + 4, C.ink);
    b.hline(17, 18, hy + 4, C.ink);
    b.set(15, hy + 5, C.ink);
    b.set(17, hy + 5, C.ink);
  }
  e.hline(12, 19, hy + 2, E0);
  e.set(20, hy + 2, E1);

  if (!p.noSword) {
    arm(b, 19, 14 + y0, p, C.coat1, C.coat2);
    smear(e, p);
    if (!p.swordBehind) sword(b, e, p);
  }
  return { hair: [16, hy], band: [20, hy + 2], front: false };
}

function drawBack(p: Pose, b: Px, e: Px): Anchor {
  const y0 = p.bob;
  if (!p.noSword && p.swordBehind) {
    smear(e, p);
    sword(b, e, p);
  }
  legFront(b, 13, p.liftA, true, y0);
  legFront(b, 17, p.liftB, true, y0);
  b.rect(10, 15 + y0, 2, 5, C.coat2);
  b.rect(10, 20 + y0, 2, 2, C.leather1);
  for (let y = 13; y <= 24; y++) {
    for (let x = 12; x <= 19; x++) {
      if (y >= 21 && (x === 15 || x === 16)) continue;
      const c = x === 12 ? C.coat1 : x === 19 ? C.coat3 : y >= 21 ? C.coat3 : C.coat2;
      b.set(x, y + y0, c);
    }
  }
  b.vline(15, 14 + y0, 20 + y0, C.coat3);
  b.hline(12, 19, 19 + y0, C.leather1);
  e.hline(12, 19, 20 + y0, E1);
  b.rect(10, 13 + y0, 4, 2, C.steel1);
  b.hline(10, 13, 13 + y0, C.steel0);
  const hy = 6 + y0;
  b.set(14, hy - 2, C.hairS0);
  b.set(17, hy - 2, C.hairS0);
  b.hline(13, 18, hy - 1, C.hairS0);
  b.rect(11, hy, 10, 4, C.hairS0);
  b.rect(11, hy + 4, 10, 3, C.hairS1);
  b.hline(12, 19, hy + 7, C.hairS2);
  b.set(20, hy + 5, C.hairS2);
  e.hline(11, 20, hy + 2, E0);
  if (!p.noSword && !p.swordBehind) {
    arm(b, 19, 14 + y0, p, C.coat1, C.coat2);
    smear(e, p);
    sword(b, e, p);
  } else if (!p.noSword) b.rect(20, 15 + y0, 2, 4, C.coat2);
  return { hair: [16, hy + 3], band: [16, hy + 2], front: true };
}

function drawRoll(i: number, b: Px, e: Px): Anchor {
  const rot = ((i - 1) / 4) * Math.PI * 2;
  const cx = 16;
  const cy = 21;
  b.disc(cx, cy, 6, (dx, dy) => {
    let a = Math.atan2(dy, dx) - rot;
    a = ((a % TAU) + TAU) % TAU;
    const u = a / TAU;
    // 빛은 왼쪽 위: 왼쪽 위 = 밝은 색, 오른쪽 아래 = 그림자 색
    const light = dx + dy < -3 ? 0 : dx + dy > 3 ? 2 : 1;
    if (u < 0.25) return [C.hairS0, C.hairS1, C.hairS2][light];
    if (u < 0.8) return [C.coat0, C.coat1, C.coat2][light];
    return light === 2 ? C.pants1 : C.pants0;
  });
  for (let k = -5; k <= 5; k++) {
    const a = rot + 1.6;
    const x = Math.round(cx + Math.cos(a) * k);
    const y = Math.round(cy + Math.sin(a) * k);
    if (b.get(x, y) !== -1) e.set(x, y, Math.abs(k) > 3 ? E2 : E1);
  }
  const ta = rot + 3.4;
  e.line(cx + Math.cos(ta) * 5, cy + Math.sin(ta) * 4, cx + Math.cos(ta) * 9, cy + Math.sin(ta) * 7, E0);
  return { hair: [Math.round(cx + Math.cos(rot) * 4), Math.round(cy + Math.sin(rot) * 4)], band: [cx, cy], front: false };
}

function drawDeathFinal(b: Px, e: Px): Anchor {
  b.rect(7, 21, 6, 4, C.hairS1);
  b.rect(9, 22, 3, 3, C.skin1);
  b.rect(13, 21, 9, 5, C.coat1);
  b.hline(13, 21, 21, C.coat0);
  b.rect(22, 22, 5, 3, C.pants0);
  b.rect(26, 22, 2, 3, C.leather1);
  e.vline(12, 20, 25, E1);
  b.set(17, 28, C.gold1);
  b.rect(18, 27, 1, 3, C.gold0);
  e.hline(19, 30, 28, E1);
  e.hline(19, 28, 27, E0);
  return { hair: [7, 22], band: [8, 21], front: false };
}

export function buildHeroSprites(scene: Phaser.Scene): void {
  const bodies: Px[] = [];
  const elems: Px[] = [];
  HERO_ANCHORS.length = 0;
  for (const dir of DIRS) {
    for (const a of ORDER) {
      for (let i = 0; i < DURS[a].length; i++) {
        const b = new Px(32, 32);
        const e = new Px(32, 32);
        const pose = poseFor(dir, a, i);
        let anchor: Anchor;
        if (a === 'roll' && i > 0) anchor = drawRoll(i, b, e);
        else if (a === 'death' && i === 2) anchor = drawDeathFinal(b, e);
        else if (a === 'death') anchor = drawFront(poseFor('down', 'death', i), b, e);
        else if (dir === 'side') anchor = drawSide(pose, b, e);
        else if (dir === 'down') anchor = drawFront(pose, b, e);
        else anchor = drawBack(pose, b, e);
        outline(b, e);
        bodies.push(b);
        elems.push(e);
        HERO_ANCHORS.push(anchor);
      }
    }
  }
  registerActor(scene, 'hero', bodies, elems, ['raw']);
  HERO_SOURCE.custom = false;
}
