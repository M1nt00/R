import type Phaser from 'phaser';
import { Px, outline, registerSheet } from './pixel';
import { C, E0, E1, E2 } from './palette';

/**
 * 주인공: 롱코트 검사 (32×32, 발밑 y=26). 방향 3개(아래·위·옆 — 왼쪽은 좌우 반전).
 * 원소 레이어 = 검날 · 머리띠 · 허리띠 (흰색 3단계 → setTint) → 원소를 바꾸면 검이 그 원소로 빛난다.
 * 공격: 내려베기(attack) / 올려베기(attack2) — 콤보에서 번갈아 나오고 검 궤적 잔상이 남는다.
 */

export type Dir = 'down' | 'up' | 'side';
export const DIRS: Dir[] = ['down', 'up', 'side'];

export interface AnimDef {
  start: number;
  count: number;
  fps: number;
  loop: boolean;
}

interface Pose {
  bob: number;
  legA: number;
  legB: number;
  liftA: number;
  liftB: number;
  lean: number;
  tail: number;
  hurt: boolean;
  /** 검을 쥔 손 위치와 검 각도(라디안, 0 = 오른쪽) */
  hand: [number, number];
  ang: number;
  /** 휘두른 궤적 잔상 [시작각, 끝각] */
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
  tail: 0,
  hurt: false,
  ...o,
});

type AnimName = 'idle' | 'run' | 'roll' | 'attack' | 'attack2' | 'cast' | 'hurt' | 'death';
const ORDER: AnimName[] = ['idle', 'run', 'roll', 'attack', 'attack2', 'cast', 'hurt', 'death'];
const COUNT: Record<AnimName, number> = { idle: 4, run: 6, roll: 5, attack: 4, attack2: 4, cast: 4, hurt: 2, death: 3 };
const FPS: Record<AnimName, [number, boolean]> = {
  idle: [5, true],
  run: [13, true],
  roll: [18, false],
  attack: [22, false],
  attack2: [22, false],
  cast: [14, false],
  hurt: [10, false],
  death: [5, false],
};

export const HERO_FRAMES_PER_DIR = ORDER.reduce((n, a) => n + COUNT[a], 0);

export const HERO_ANIMS: Record<string, AnimDef> = (() => {
  const out: Record<string, AnimDef> = {};
  DIRS.forEach((dir, di) => {
    let o = di * HERO_FRAMES_PER_DIR;
    for (const a of ORDER) {
      const [fps, loop] = FPS[a];
      out[`${a}_${dir}`] = { start: o, count: COUNT[a], fps, loop };
      o += COUNT[a];
    }
  });
  return out;
})();

const runLegs = (k: number) => {
  const s = Math.sin((k / 6) * Math.PI * 2);
  const leg = Math.round(s * 2);
  return { legA: leg, legB: -leg, liftA: s > 0.4 ? 1 : 0, liftB: s < -0.4 ? 1 : 0, bob: Math.abs(s) > 0.7 ? 1 : 0, tail: k % 4 };
};

/** 방향·동작별 자세 (손 위치와 검 각도를 프레임마다 직접 지정) */
function poseFor(dir: Dir, a: AnimName, i: number): Pose {
  if (dir === 'side') {
    switch (a) {
      case 'idle':
        return P({ hand: [19, 19], ang: 0.75, bob: i >= 2 ? 1 : 0, tail: i });
      case 'run':
        return P({ hand: [18, 18], ang: 2.55, ...runLegs(i) });
      case 'attack':
        return [
          P({ hand: [14, 11], ang: -2.4, lean: -1, tail: 1 }),
          P({ hand: [20, 13], ang: -0.5, lean: 1, smear: [-2.4, -0.5], tail: 2 }),
          P({ hand: [21, 18], ang: 0.95, lean: 1, smear: [-0.6, 0.95], tail: 3, legA: 2, legB: -1 }),
          P({ hand: [20, 19], ang: 0.75, tail: 0, legA: 1 }),
        ][i];
      case 'attack2':
        return [
          P({ hand: [20, 20], ang: 1.25, tail: 1 }),
          P({ hand: [21, 15], ang: -0.2, lean: 1, smear: [1.25, -0.2], tail: 2, legA: 2, legB: -1 }),
          P({ hand: [17, 11], ang: -1.85, lean: 0, smear: [-0.2, -1.85], tail: 3 }),
          P({ hand: [18, 14], ang: -1.1, tail: 0 }),
        ][i];
      case 'cast':
        return [
          P({ hand: [19, 14], ang: -1.0, tail: 1 }),
          P({ hand: [18, 10], ang: -1.45, glow: 2, tail: 2 }),
          P({ hand: [18, 10], ang: -1.45, glow: 1, bob: 1, tail: 3 }),
          P({ hand: [19, 15], ang: -0.6, tail: 0 }),
        ][i];
      case 'hurt':
        return P({ hand: [16, 19], ang: 1.9, lean: -1, hurt: true, bob: i });
      default:
        return P({ hand: [19, 19], ang: 0.75, noSword: a === 'roll' });
    }
  }
  if (dir === 'down') {
    switch (a) {
      case 'idle':
        return P({ hand: [21, 19], ang: 1.25, bob: i >= 2 ? 1 : 0, tail: i });
      case 'run':
        return P({ hand: [21, 18], ang: 0.95, ...runLegs(i) });
      case 'attack':
        return [
          P({ hand: [22, 12], ang: -1.2, tail: 1 }),
          P({ hand: [20, 18], ang: 0.85, smear: [-1.2, 0.85], tail: 2 }),
          P({ hand: [15, 20], ang: 2.2, smear: [0.85, 2.2], tail: 3, bob: 1 }),
          P({ hand: [17, 20], ang: 1.9, tail: 0 }),
        ][i];
      case 'attack2':
        return [
          P({ hand: [12, 19], ang: 2.1, tail: 1 }),
          P({ hand: [16, 21], ang: 1.3, smear: [2.1, 1.3], tail: 2, bob: 1 }),
          P({ hand: [22, 17], ang: 0.1, smear: [1.3, 0.1], tail: 3 }),
          P({ hand: [21, 18], ang: 0.8, tail: 0 }),
        ][i];
      case 'cast':
        return [
          P({ hand: [21, 14], ang: -1.2, tail: 1 }),
          P({ hand: [20, 10], ang: -1.5, glow: 2, tail: 2 }),
          P({ hand: [20, 10], ang: -1.5, glow: 1, bob: 1, tail: 3 }),
          P({ hand: [21, 16], ang: -0.6, tail: 0 }),
        ][i];
      case 'hurt':
        return P({ hand: [21, 20], ang: 1.3, hurt: true, bob: i });
      case 'death':
        return i === 0 ? P({ hand: [21, 20], ang: 1.3, hurt: true, bob: 1 }) : P({ hand: [22, 23], ang: 0.2, hurt: true, bob: 3, liftA: 3, liftB: 3 });
      default:
        return P({ hand: [21, 19], ang: 1.25, noSword: true });
    }
  }
  // up (뒷모습)
  switch (a) {
    case 'idle':
      return P({ hand: [21, 19], ang: -1.2, bob: i >= 2 ? 1 : 0, tail: i, swordBehind: true });
    case 'run':
      return P({ hand: [21, 18], ang: -1.0, swordBehind: true, ...runLegs(i) });
    case 'attack':
      return [
        P({ hand: [22, 20], ang: 0.9, tail: 1 }),
        P({ hand: [20, 13], ang: -1.2, smear: [0.9, -1.2], tail: 2 }),
        P({ hand: [13, 12], ang: -2.2, smear: [-1.2, -2.2], tail: 3, swordBehind: true }),
        P({ hand: [12, 15], ang: -2.6, tail: 0, swordBehind: true }),
      ][i];
    case 'attack2':
      return [
        P({ hand: [10, 19], ang: 2.3, tail: 1 }),
        P({ hand: [12, 13], ang: -1.9, smear: [2.3 - Math.PI * 2, -1.9], tail: 2, swordBehind: true }),
        P({ hand: [20, 12], ang: -0.9, smear: [-1.9, -0.9], tail: 3, swordBehind: true }),
        P({ hand: [21, 15], ang: -0.6, tail: 0, swordBehind: true }),
      ][i];
    case 'cast':
      return [
        P({ hand: [21, 14], ang: -1.2, tail: 1, swordBehind: true }),
        P({ hand: [20, 10], ang: -1.5, glow: 2, tail: 2, swordBehind: true }),
        P({ hand: [20, 10], ang: -1.5, glow: 1, bob: 1, tail: 3, swordBehind: true }),
        P({ hand: [21, 16], ang: -0.8, tail: 0, swordBehind: true }),
      ][i];
    case 'hurt':
      return P({ hand: [21, 20], ang: 1.0, hurt: true, bob: i });
    default:
      return P({ hand: [21, 19], ang: -1.2, noSword: a === 'roll', swordBehind: true });
  }
}

// ───────────────────────────── 부위 ─────────────────────────────

const SWORD_LEN = 12;

/** 검: 손잡이·가드는 본체, 검날은 원소 레이어 */
function sword(b: Px, e: Px, p: Pose) {
  const [hx, hy] = p.hand;
  const y = hy + p.bob;
  const dx = Math.cos(p.ang);
  const dy = Math.sin(p.ang);
  const nx = -dy;
  const ny = dx;
  // 손잡이 + 폼멜
  b.set(hx - dx, y - dy, C.leather1);
  b.set(hx - dx * 2, y - dy * 2, C.gold1);
  // 가드
  for (let k = -2; k <= 2; k++) b.set(hx + dx * 1.2 + nx * k, y + dy * 1.2 + ny * k, k === 0 ? C.gold0 : C.gold1);
  // 검날 (2px: 날 + 등)
  for (let t = 2; t <= SWORD_LEN; t++) {
    const x = hx + dx * t;
    const yy = y + dy * t;
    e.set(x, yy, t > SWORD_LEN - 2 ? E0 : E1);
    if (t < SWORD_LEN - 1) e.set(x + nx * 0.9, yy + ny * 0.9, E0);
  }
  if (p.glow) e.disc(hx + dx * SWORD_LEN, y + dy * SWORD_LEN, p.glow, E0);
  // 장갑 낀 손
  b.rect(hx - 1, y - 1, 2, 2, C.leather1);
  b.set(hx - 1, y - 1, C.leather0);
}

/** 검 궤적 잔상 (원소 레이어, 바깥쪽만) */
function smear(e: Px, p: Pose) {
  if (!p.smear) return;
  const [a0, a1] = p.smear;
  const [hx, hy] = p.hand;
  const y = hy + p.bob;
  const steps = Math.ceil(Math.abs(a1 - a0) / 0.07);
  for (let s = 0; s < steps; s++) {
    const a = a0 + ((a1 - a0) * s) / steps;
    const k = s / steps; // 최근 궤적일수록 두껍고 밝게
    e.set(hx + Math.cos(a) * (SWORD_LEN + 1), y + Math.sin(a) * (SWORD_LEN + 1), k > 0.35 ? E0 : E1);
    if (k > 0.45) e.set(hx + Math.cos(a) * SWORD_LEN, y + Math.sin(a) * SWORD_LEN, E1);
    if (k > 0.75) e.set(hx + Math.cos(a) * (SWORD_LEN - 1), y + Math.sin(a) * (SWORD_LEN - 1), E1);
  }
}

function arm(b: Px, sx: number, sy: number, p: Pose, c0: number, c1: number) {
  const [hx, hy] = p.hand;
  b.line(sx, sy, hx, hy + p.bob, c1);
  b.line(sx + 1, sy, hx + (hx < sx ? 1 : 0), hy + p.bob - 1, c0);
}

function legFront(b: Px, x: number, lift: number, dark: boolean, bob: number) {
  const top = 22 + Math.min(bob, 1);
  const bottom = 26 - lift;
  b.rect(x, top, 2, Math.max(1, bottom - 1 - top), dark ? C.pants1 : C.pants0);
  b.rect(x - (dark ? 0 : 1), bottom - 1, 3, 2, C.leather1);
  b.set(x + (dark ? 2 : -1), bottom, C.steel2);
}

function legSide(b: Px, x: number, lift: number, dark: boolean, bob: number) {
  const top = 21 + Math.min(bob, 1);
  const bottom = 26 - lift;
  b.rect(x, top, 2, Math.max(1, bottom - 1 - top), dark ? C.pants1 : C.pants0);
  b.rect(x, bottom - 1, 3, 2, dark ? C.leather1 : C.leather1);
  b.set(x + 2, bottom, C.steel2);
}

function headbandTails(e: Px, x: number, y: number, dir: -1 | 1, phase: number, down = false) {
  for (let i = 0; i < 5; i++) {
    const wave = i > 1 ? [0, 1, 0, -1][(i + phase) % 4] : 0;
    if (down) {
      e.set(x + wave, y + i, i > 2 ? E2 : E1);
    } else {
      e.set(x + dir * i, y + Math.round(i * 0.4) + wave, i > 2 ? E2 : E1);
      if (i < 3) e.set(x + dir * i, y + 1 + Math.round(i * 0.4) + wave, E2);
    }
  }
}

function drawSide(p: Pose, b: Px, e: Px) {
  const y0 = p.bob;
  const lx = p.lean;
  const flare = [0, -1, -1, 0][p.tail % 4];

  // 코트 자락 (뒤로 펄럭임)
  for (let y = 19; y <= 24; y++) {
    const t = (y - 19) / 5;
    const xb = 13 + lx - Math.round(t * 2) + (y > 21 ? flare : 0);
    b.hline(xb, 15 + lx, y + y0, y > 22 ? C.coat2 : C.coat1);
  }
  legSide(b, 15 + p.legB, p.liftB, true, y0);
  // 몸통 (롱코트)
  for (let y = 13; y <= 20; y++) {
    for (let x = 14; x <= 19; x++) {
      const c = x === 14 ? C.coat2 : x >= 18 ? C.coat0 : C.coat1;
      b.set(x + lx, y + y0, c);
    }
  }
  b.vline(18 + lx, 13 + y0, 16 + y0, C.steel0);
  b.hline(14 + lx, 19 + lx, 19 + y0, C.leather1);
  b.set(18 + lx, 19 + y0, C.gold0);
  e.hline(14 + lx, 19 + lx, 20 + y0, E1);
  e.set(13 + lx, 21 + y0, E2);
  legSide(b, 16 + p.legA, p.liftA, false, y0);
  // 어깨 갑옷
  b.rect(16 + lx, 13 + y0, 3, 2, C.steel1);
  b.hline(16 + lx, 18 + lx, 13 + y0, C.steel0);

  // 머리 (은발, 뒤로 뻗친 머리)
  const hx = 14 + lx;
  const hy = 6 + y0;
  b.rect(hx, hy, 7, 3, C.hairS0);
  b.set(hx + 2, hy - 1, C.hairS0);
  b.set(hx + 4, hy - 1, C.hairS0);
  b.set(hx + 3, hy - 2, C.hairS0);
  b.rect(hx - 2, hy, 2, 2, C.hairS1);
  b.set(hx - 3, hy - 1, C.hairS1);
  b.set(hx - 3, hy + 2, C.hairS2);
  b.rect(hx - 1, hy + 2, 1, 2, C.hairS1);
  b.rect(hx, hy + 3, 2, 4, C.hairS1);
  b.set(hx, hy + 6, C.hairS2);
  b.hline(hx, hx + 6, hy + 2, C.hairS1);
  b.rect(hx + 2, hy + 3, 5, 4, C.skin0);
  b.set(hx + 6, hy + 3, C.hairS0);
  b.set(hx + 5, hy + 3, C.hairS1);
  b.set(hx + 7, hy + 5, C.skin0);
  b.hline(hx + 2, hx + 5, hy + 6, C.skin1);
  b.set(hx + 2, hy + 4, C.skin1);
  if (p.hurt) {
    b.set(hx + 5, hy + 4, C.ink);
    b.set(hx + 4, hy + 5, C.ink);
  } else {
    b.hline(hx + 4, hx + 5, hy + 4, C.ink);
    b.set(hx + 5, hy + 5, C.ink);
  }
  b.rect(hx + 2, hy + 7, 4, 1, C.coat0);
  // 머리띠 + 꼬리
  e.hline(hx, hx + 6, hy + 2, E0);
  headbandTails(e, hx - 1, hy + 2, -1, p.tail);

  // 팔 + 검
  if (!p.noSword) {
    arm(b, 17 + lx, 15 + y0, p, C.coat0, C.coat1);
    sword(b, e, p);
    smear(e, p);
  }
}

function drawFront(p: Pose, b: Px, e: Px) {
  const y0 = p.bob;
  if (!p.noSword && p.swordBehind) sword(b, e, p);
  legFront(b, 13, p.liftA, false, y0);
  legFront(b, 17, p.liftB, true, y0);
  // 코트 자락 (가운데 트임)
  for (let y = 21; y <= 24; y++) {
    const w = y - 21;
    b.hline(11 - (w > 1 ? 1 : 0), 14, y + y0, C.coat1);
    b.hline(17, 20 + (w > 1 ? 1 : 0), y + y0, C.coat2);
  }
  // 왼팔 (검 안 든 손)
  b.rect(10, 15 + y0, 2, 5, C.coat1);
  b.vline(10, 15 + y0, 19 + y0, C.coat0);
  b.rect(10, 20 + y0, 2, 2, C.leather1);
  // 몸통
  for (let y = 13; y <= 20; y++) {
    for (let x = 12; x <= 19; x++) {
      let c = x <= 13 ? C.coat0 : x >= 18 ? C.coat2 : C.coat1;
      if ((x === 14 || x === 17) && y <= 17) c = C.coat0;
      b.set(x, y + y0, c);
    }
  }
  b.rect(15, 13 + y0, 2, 3, C.steel0);
  b.set(15, 16 + y0, C.steel1);
  b.hline(12, 19, 19 + y0, C.leather1);
  b.rect(15, 19 + y0, 2, 1, C.gold0);
  e.hline(12, 19, 20 + y0, E1);
  e.vline(18, 21 + y0, 22 + y0, E2);
  // 어깨 갑옷 (왼쪽)
  b.rect(10, 13 + y0, 4, 2, C.steel1);
  b.hline(10, 13, 13 + y0, C.steel0);
  b.set(9, 14 + y0, C.steel2);

  // 머리 (은발, 뾰족하게)
  const hy = 6 + y0;
  b.hline(14, 14, hy - 2, C.hairS0);
  b.hline(17, 17, hy - 2, C.hairS0);
  b.hline(13, 14, hy - 1, C.hairS0);
  b.hline(16, 18, hy - 1, C.hairS0);
  b.rect(12, hy, 8, 2, C.hairS0);
  b.hline(11, 20, hy + 1, C.hairS1);
  b.set(13, hy, C.white);
  b.rect(11, hy + 3, 2, 4, C.hairS1);
  b.rect(19, hy + 3, 2, 4, C.hairS1);
  b.set(11, hy + 6, C.hairS2);
  b.set(20, hy + 6, C.hairS2);
  b.rect(13, hy + 3, 6, 4, C.skin0);
  // 앞머리가 한쪽 눈썹을 덮음
  b.hline(13, 15, hy + 3, C.hairS0);
  b.set(13, hy + 4, C.hairS1);
  b.set(18, hy + 3, C.hairS1);
  b.vline(18, hy + 4, hy + 6, C.skin1);
  b.hline(14, 17, hy + 7, C.skin1);
  if (p.hurt) {
    b.hline(14, 15, hy + 5, C.ink);
    b.hline(17, 18, hy + 5, C.ink);
  } else {
    b.hline(14, 15, hy + 4, C.ink);
    b.hline(17, 18, hy + 4, C.ink);
    b.set(15, hy + 5, C.ink);
    b.set(17, hy + 5, C.ink);
  }
  // 머리띠 (매듭 꼬리는 옆으로)
  e.hline(12, 19, hy + 2, E0);
  headbandTails(e, 20, hy + 2, 1, p.tail);

  if (!p.noSword && !p.swordBehind) {
    arm(b, 19, 14 + y0, p, C.coat1, C.coat2);
    sword(b, e, p);
  } else if (!p.noSword) arm(b, 19, 14 + y0, p, C.coat1, C.coat2);
  if (!p.noSword) smear(e, p);
}

function drawBack(p: Pose, b: Px, e: Px) {
  const y0 = p.bob;
  if (!p.noSword && p.swordBehind) {
    sword(b, e, p);
    smear(e, p);
  }
  legFront(b, 13, p.liftA, true, y0);
  legFront(b, 17, p.liftB, true, y0);
  b.rect(10, 15 + y0, 2, 5, C.coat2);
  b.rect(10, 20 + y0, 2, 2, C.leather1);
  // 코트 등판 + 자락
  const flare = [0, 1, 0, -1][p.tail % 4];
  for (let y = 13; y <= 24; y++) {
    for (let x = 12; x <= 19; x++) {
      if (y >= 21 && (x === 15 || x === 16)) continue;
      if (y === 24 && (x + flare) % 3 === 0) continue;
      const c = x === 12 ? C.coat0 : x === 19 ? C.coat2 : y >= 21 ? C.coat2 : C.coat1;
      b.set(x, y + y0, c);
    }
  }
  b.vline(15, 14 + y0, 20 + y0, C.coat2);
  b.hline(12, 19, 19 + y0, C.leather1);
  e.hline(12, 19, 20 + y0, E1);
  b.rect(10, 13 + y0, 4, 2, C.steel1);
  b.hline(10, 13, 13 + y0, C.steel0);
  // 뒷머리 (은발)
  const hy = 6 + y0;
  b.hline(14, 14, hy - 2, C.hairS0);
  b.hline(17, 17, hy - 2, C.hairS0);
  b.hline(13, 18, hy - 1, C.hairS0);
  b.rect(11, hy, 10, 4, C.hairS0);
  b.rect(11, hy + 4, 10, 3, C.hairS1);
  b.hline(12, 19, hy + 7, C.hairS2);
  b.set(10, hy + 5, C.hairS1);
  b.set(21, hy + 5, C.hairS1);
  b.set(14, hy, C.white);
  e.hline(11, 20, hy + 2, E0);
  headbandTails(e, 21, hy + 2, 1, p.tail);
  if (!p.noSword && !p.swordBehind) {
    arm(b, 19, 14 + y0, p, C.coat1, C.coat2);
    sword(b, e, p);
    smear(e, p);
  } else if (!p.noSword) {
    b.rect(20, 15 + y0, 2, 4, C.coat2);
  }
}

function drawRoll(i: number, b: Px, e: Px) {
  const rot = (i / 5) * Math.PI * 2;
  const cx = 16;
  const cy = 20;
  b.disc(cx, cy, 6, (dx, dy) => {
    let a = Math.atan2(dy, dx) - rot;
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const u = a / (Math.PI * 2);
    const light = dy < -2 ? 0 : dy > 2 ? 2 : 1;
    if (u < 0.25) return light === 0 ? C.hairS0 : C.hairS1;
    if (u < 0.8) return [C.coat0, C.coat1, C.coat2][light];
    return light === 2 ? C.pants1 : C.pants0;
  });
  for (let k = -5; k <= 5; k++) {
    const a = rot + 1.6;
    const x = Math.round(cx + Math.cos(a) * k);
    const y = Math.round(cy + Math.sin(a) * k);
    if (b.get(x, y) !== -1) e.set(x, y, Math.abs(k) > 3 ? E2 : E1);
  }
  // 검 끝이 회전하며 번쩍
  const tx = cx + Math.cos(rot + 3.4) * 9;
  const ty = cy + Math.sin(rot + 3.4) * 7;
  e.line(cx + Math.cos(rot + 3.4) * 5, cy + Math.sin(rot + 3.4) * 4, tx, ty, E0);
}

function drawDeathFinal(b: Px, e: Px) {
  b.rect(7, 21, 6, 4, C.hairS0);
  b.rect(9, 22, 3, 3, C.skin0);
  b.rect(13, 21, 9, 5, C.coat1);
  b.hline(13, 21, 21, C.coat0);
  b.rect(22, 22, 5, 3, C.pants0);
  b.rect(26, 22, 2, 3, C.leather1);
  e.vline(12, 20, 25, E1);
  // 떨어진 검
  b.set(17, 28, C.gold1);
  b.rect(18, 27, 1, 3, C.gold0);
  e.hline(19, 30, 28, E1);
  e.hline(19, 28, 27, E0);
}

export function buildHeroSprites(scene: Phaser.Scene): void {
  const bodies: Px[] = [];
  const elems: Px[] = [];
  for (const dir of DIRS) {
    for (const a of ORDER) {
      for (let i = 0; i < COUNT[a]; i++) {
        const b = new Px(32, 32);
        const e = new Px(32, 32);
        const pose = poseFor(dir, a, i);
        if (a === 'roll') drawRoll(i, b, e);
        else if (a === 'death' && i === 2) drawDeathFinal(b, e);
        else if (a === 'death') drawFront(poseFor('down', 'death', i), b, e);
        else if (dir === 'side') drawSide(pose, b, e);
        else if (dir === 'down') drawFront(pose, b, e);
        else drawBack(pose, b, e);
        outline(b, e, C.out);
        bodies.push(b);
        elems.push(e);
      }
    }
  }
  registerSheet(scene, 'hero_body', bodies);
  registerSheet(scene, 'hero_elem', elems);
}
