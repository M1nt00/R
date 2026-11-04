import type Phaser from 'phaser';
import { Px, outline, registerSheet } from './pixel';
import { C, E0, E1, E2 } from './palette';
import type { AnimDef } from './heroSprites';

/**
 * 적은 "행동 유형"만 그리고 원소는 원소 레이어 색으로만 낸다 → 5종 × 원소 4 = 20종.
 * 옆모습(오른쪽)만 그리고 왼쪽은 좌우 반전. 32×32, 발밑 y=26.
 * 프레임: 걷기 4 · 준비 2 · 공격 2 · 피격 1
 */
export const ENEMY_ANIMS: Record<string, AnimDef> = {
  walk: { start: 0, count: 4, fps: 8, loop: true },
  idle: { start: 0, count: 4, fps: 4, loop: true },
  windup: { start: 4, count: 2, fps: 10, loop: true },
  attack: { start: 6, count: 2, fps: 12, loop: false },
  hurt: { start: 8, count: 1, fps: 10, loop: false },
};

type Frame = 'walk' | 'windup' | 'attack' | 'hurt';
const FRAMES: [Frame, number][] = [
  ['walk', 0],
  ['walk', 1],
  ['walk', 2],
  ['walk', 3],
  ['windup', 0],
  ['windup', 1],
  ['attack', 0],
  ['attack', 1],
  ['hurt', 0],
];

type Drawer = (b: Px, e: Px, f: Frame, i: number) => void;

const shadeBody = (dy: number, dx: number, light: number, mid: number, dark: number) =>
  dy + dx * 0.4 < -2 ? light : dy + dx * 0.3 > 2 ? dark : mid;

// ───────── 돌격형: 뿔 멧돼지 ─────────
const charger: Drawer = (b, e, f, i) => {
  const step = f === 'walk' ? [0, 1, 0, -1][i] : 0;
  const lx = f === 'windup' ? -1 + (i % 2) : f === 'attack' ? 2 : f === 'hurt' ? -2 : 0;
  const by = f === 'windup' ? 1 : 0;
  const rx = f === 'attack' ? 9 : 8;
  // 다리 (뒤쪽 먼저)
  const leg = (x: number, off: number, dark: boolean) => {
    const lift = off > 0 ? 1 : 0;
    b.rect(x + off, 22 + by, 2, 4 - lift, dark ? C.stone1 : C.stone2);
    b.rect(x + off, 25 - lift + by, 2, 1, C.stone0);
  };
  leg(10 + lx, f === 'attack' ? -2 : -step, true);
  leg(19 + lx, f === 'attack' ? 1 : step, true);
  // 몸통
  b.ellipse(15 + lx, 18 + by, rx, 5, (dx, dy) => shadeBody(dy, dx, C.stone3, C.stone2, C.stone1));
  b.hline(10 + lx, 20 + lx, 22 + by, C.stone1);
  leg(12 + lx, f === 'attack' ? -3 : step, false);
  leg(21 + lx, f === 'attack' ? 2 : -step, false);
  // 머리
  const hx = 21 + lx + (f === 'attack' ? 1 : 0);
  const hy = 15 + by + (f === 'windup' ? 1 : 0);
  b.rect(hx, hy, 6, 6, C.stone2);
  b.hline(hx, hx + 5, hy, C.stone3);
  b.rect(hx + 5, hy + 3, 2, 3, C.stone3);
  b.set(hx + 6, hy + 4, C.ink);
  b.vline(hx, hy + 1, hy + 5, C.stone1);
  // 원소 레이어: 갈기 · 뿔 · 엄니 · 눈
  for (let k = 0; k < 5; k++) {
    const x = 9 + lx + k * 2;
    e.set(x, 13 + by - (k % 2), E1);
    e.set(x + 1, 13 + by, E2);
  }
  e.vline(hx + 1, hy - 3, hy - 1, E1);
  e.set(hx + 2, hy - 4, E0);
  e.vline(hx + 3, hy - 2, hy - 1, E2);
  e.hline(hx + 5, hx + 7, hy + 6, E0);
  e.set(hx + 7, hy + 5, E0);
  if (f === 'hurt') {
    b.set(hx + 3, hy + 2, C.ink);
    b.set(hx + 4, hy + 3, C.ink);
  } else e.rect(hx + 3, hy + 2, 2, 1, E0);
};

// ───────── 사수형: 두건 쓴 주술사 (떠다님) ─────────
const shooter: Drawer = (b, e, f, i) => {
  const fy = f === 'walk' ? [0, -1, -1, 0][i] : f === 'windup' ? -1 : 0;
  const lx = f === 'hurt' ? -1 : 0;
  // 로브
  for (let y = 13; y <= 24; y++) {
    const t = (y - 13) / 11;
    const half = Math.round(3 + t * 3);
    for (let x = 15 - half; x <= 15 + half; x++) {
      if (y === 24 && (x + i) % 3 === 0) continue;
      const c = x >= 15 + half - 1 ? C.stone1 : x <= 15 - half + 1 ? C.stone3 : C.stone2;
      b.set(x + lx, y + fy, c);
    }
  }
  // 두건
  b.ellipse(15 + lx, 10 + fy, 4, 4, (dx, dy) => (dy < -1 && dx < 1 ? C.stone3 : C.stone2));
  b.rect(16 + lx, 9 + fy, 3, 4, C.ink);
  e.set(17 + lx, 10 + fy, E0);
  e.set(18 + lx, 10 + fy, E1);
  // 로브 룬
  e.set(14 + lx, 17 + fy, E2);
  e.set(15 + lx, 18 + fy, E1);
  e.set(14 + lx, 19 + fy, E2);
  e.set(15 + lx, 21 + fy, E2);
  // 지팡이 + 구슬
  const sx = f === 'attack' ? 23 : 21;
  const sy = f === 'windup' ? -2 : 0;
  b.vline(sx + lx, 9 + fy + sy, 25 + fy + sy, C.leather1);
  b.rect(17 + lx, 15 + fy, sx - 16, 2, C.stone2);
  const orb = f === 'windup' ? 3 : f === 'attack' ? 2 : 2;
  e.disc(sx + lx, 7 + fy + sy, orb, (dx, dy) => (dx + dy < -1 ? E0 : dx + dy > 1 ? E2 : E1));
};

// ───────── 자폭형: 화약 도깨비 ─────────
const bomber: Drawer = (b, e, f, i) => {
  const swell = f === 'windup' || f === 'attack' ? 1 : 0;
  const bob = f === 'walk' ? [0, 1, 0, 1][i] : 0;
  const lx = f === 'walk' ? [0, 0, 1, 1][i] - 0 : f === 'hurt' ? -1 : 0;
  b.rect(12 + lx + (f === 'walk' ? [0, -1, 0, 1][i] : 0), 23, 2, 3, C.stone1);
  b.rect(18 + lx - (f === 'walk' ? [0, -1, 0, 1][i] : 0), 23, 2, 3, C.stone1);
  b.disc(16 + lx, 18 + bob, 6 + swell, (dx, dy) => shadeBody(dy, dx, C.stone3, C.stone2, C.stone1));
  // 눈 + 화난 눈썹
  b.set(18 + lx, 16 + bob, C.ink);
  b.set(20 + lx, 16 + bob, C.ink);
  b.hline(17 + lx, 18 + lx, 15 + bob, C.ink);
  // 균열 (원소 레이어로 빛남)
  const crack: [number, number][] = [
    [14, 19],
    [15, 20],
    [16, 19],
    [17, 20],
    [18, 21],
    [13, 21],
    [19, 19],
  ];
  crack.slice(0, swell ? 7 : 4).forEach(([x, y], k) => e.set(x + lx, y + bob, k % 2 ? E1 : E0));
  if (swell) {
    e.set(12 + lx, 17 + bob, E1);
    e.set(20 + lx, 21 + bob, E1);
  }
  // 심지 + 불꽃
  b.line(15 + lx, 12 + bob - swell, 14 + lx, 9 + bob - swell, C.leather1);
  const sp = [
    [13, 7],
    [14, 6],
    [12, 7],
    [14, 7],
  ][i % 4];
  e.rect(sp[0] + lx, sp[1] + bob - swell, 2, 2, E0);
  if (swell) e.set(sp[0] + lx - 1, sp[1] + bob - swell - 1, E1);
};

// ───────── 방패형: 돌 기사 ─────────
const shielder: Drawer = (b, e, f, i) => {
  const step = f === 'walk' ? [0, 1, 0, -1][i] : 0;
  const by = f === 'windup' ? 1 : 0;
  const push = f === 'attack' ? 3 : f === 'windup' ? -1 : 0;
  const lx = f === 'hurt' ? -1 : 0;
  b.rect(12 + lx - step, 22, 2, 4, C.stone1);
  b.rect(17 + lx + step, 22, 2, 4, C.stone2);
  b.rect(11 + lx - step, 25, 3, 1, C.stone0);
  b.rect(17 + lx + step, 25, 3, 1, C.stone0);
  // 몸통 갑옷
  for (let y = 13; y <= 21; y++) {
    for (let x = 11; x <= 19; x++) {
      const c = y === 13 || x === 11 ? C.stone4 : x >= 18 || y === 21 ? C.stone2 : C.stone3;
      b.set(x + lx, y + by, c);
    }
  }
  b.hline(11 + lx, 19 + lx, 17 + by, C.stone2);
  // 투구
  b.rect(12 + lx, 6 + by, 7, 7, C.stone3);
  b.hline(12 + lx, 18 + lx, 6 + by, C.stone4);
  b.vline(18 + lx, 7 + by, 12 + by, C.stone2);
  b.hline(14 + lx, 18 + lx, 9 + by, C.ink);
  e.hline(15 + lx, 18 + lx, 9 + by, E0);
  e.rect(13 + lx, 3 + by, 3, 3, E1);
  e.set(12 + lx, 4 + by, E2);
  // 탑 방패 (정면 피해 무효)
  const sx = 20 + lx + push;
  for (let y = 9; y <= 24; y++) {
    for (let x = sx; x <= sx + 4; x++) {
      const edge = x === sx || x === sx + 4 || y === 9 || y === 24;
      b.set(x, y + by, edge ? C.stone4 : x === sx + 1 ? C.stone3 : C.stone2);
    }
  }
  e.disc(sx + 2, 16 + by, 2, (dx, dy) => (Math.abs(dx) + Math.abs(dy) <= 1 ? E0 : E1));
};

// ───────── 소환사형: 뿔 달린 흑마법사 ─────────
const summoner: Drawer = (b, e, f, i) => {
  const fy = f === 'walk' ? [0, -1, -1, 0][i] : 0;
  const raise = f === 'windup' ? 2 : f === 'attack' ? 4 : 0;
  const lx = f === 'hurt' ? -1 : 0;
  for (let y = 13; y <= 25; y++) {
    const half = Math.round(3 + ((y - 13) / 12) * 4);
    for (let x = 15 - half; x <= 15 + half; x++) {
      if (y === 25 && (x + i) % 2 === 0) continue;
      const c = x >= 15 + half - 1 ? C.ink : x <= 15 - half + 1 ? C.hair0 : C.hair1;
      b.set(x + lx, y + fy, c);
    }
  }
  b.rect(12 + lx, 7 + fy, 7, 6, C.hair1);
  b.rect(14 + lx, 9 + fy, 4, 3, C.ink);
  e.set(15 + lx, 10 + fy, E0);
  e.set(17 + lx, 10 + fy, E0);
  // 뿔
  b.line(12 + lx, 7 + fy, 10 + lx, 3 + fy, C.stone4);
  b.line(18 + lx, 7 + fy, 20 + lx, 3 + fy, C.stone4);
  b.set(10 + lx, 4 + fy, C.stone3);
  // 가슴 인장
  e.set(15 + lx, 16 + fy, E0);
  e.set(14 + lx, 17 + fy, E1);
  e.set(16 + lx, 17 + fy, E1);
  e.set(15 + lx, 18 + fy, E1);
  // 소매·손
  b.rect(19 + lx, 15 + fy - raise, 3, 4, C.hair0);
  b.rect(8 + lx, 15 + fy - raise, 3, 4, C.hair0);
  const g = raise > 2 ? 2 : 1;
  e.disc(21 + lx, 13 + fy - raise, g, E1);
  e.disc(9 + lx, 13 + fy - raise, g, E1);
};

const DRAWERS: Record<string, Drawer> = { charger, shooter, bomber, shielder, summoner };

function buildWisp(scene: Phaser.Scene) {
  const bodies: Px[] = [];
  const elems: Px[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new Px(16, 16);
    const e = new Px(16, 16);
    const tip = [0, 1, 0, -1][i];
    e.disc(8, 10, 4, (dx, dy) => (dy > 1 ? E2 : dx + dy < -1 ? E0 : E1));
    e.line(8, 6, 8 + tip, 2, E1);
    e.line(6, 7, 5 - tip, 4, E2);
    e.line(10, 7, 11 + tip, 4, E2);
    b.set(7, 10, C.ink);
    b.set(9, 10, C.ink);
    b.rect(7, 12, 3, 1, C.ink);
    outline(b, e, C.out);
    bodies.push(b);
    elems.push(e);
  }
  registerSheet(scene, 'wisp_body', bodies);
  registerSheet(scene, 'wisp_elem', elems);
}

// ───────── 보스: 잿불 골렘 (64×64, 발밑 y=58) ─────────
export const BOSS_ANIMS: Record<string, AnimDef> = {
  idle: { start: 0, count: 4, fps: 4, loop: true },
  walk: { start: 4, count: 4, fps: 6, loop: true },
  windup: { start: 8, count: 2, fps: 8, loop: true },
  slam: { start: 10, count: 2, fps: 10, loop: false },
  hurt: { start: 12, count: 1, fps: 8, loop: false },
  stagger: { start: 13, count: 2, fps: 4, loop: true },
};

type BossFrame = 'idle' | 'walk' | 'windup' | 'slam' | 'hurt' | 'stagger';

function drawGolem(b: Px, e: Px, f: BossFrame, i: number) {
  const bob = f === 'idle' ? [0, 0, 1, 1][i] : f === 'slam' ? 3 : f === 'stagger' ? 7 : 0;
  const sway = f === 'walk' ? [-1, 0, 1, 0][i] : f === 'hurt' ? -2 : 0;
  const glowLv = f === 'stagger' ? 2 : f === 'windup' || f === 'slam' ? 0 : i % 2;
  const mag = [E0, E1, E2][glowLv];
  const mag2 = [E1, E2, E2][glowLv];
  const rock = (dx: number, dy: number) => shadeBody(dy, dx * 0.6, C.stone3, C.stone2, C.stone1);

  // 다리
  const lift = f === 'walk' ? [0, 2, 0, 0][i] : 0;
  const lift2 = f === 'walk' ? [0, 0, 0, 2][i] : 0;
  if (f !== 'stagger') {
    b.rect(21 + sway, 46 - lift, 8, 11, C.stone1);
    b.rect(36 + sway, 46 - lift2, 8, 11, C.stone2);
    b.rect(20 + sway, 55 - lift, 10, 3, C.stone0);
    b.rect(35 + sway, 55 - lift2, 10, 3, C.stone1);
  } else {
    b.rect(18, 52, 12, 6, C.stone1);
    b.rect(35, 52, 12, 6, C.stone2);
  }
  // 몸통
  b.ellipse(32 + sway, 34 + bob, 16, 13, rock);
  // 어깨 바위
  b.disc(16 + sway, 27 + bob, 7, rock);
  b.disc(48 + sway, 27 + bob, 7, rock);
  // 팔 + 주먹
  const fist = (side: -1 | 1) => {
    const sx = 32 + side * 20 + sway;
    let fx = sx;
    let fy = 47 + bob;
    if (f === 'windup') {
      fx = 32 + side * 12;
      fy = 8 + i;
    } else if (f === 'slam') {
      fx = 32 + side * 8;
      fy = 55;
    } else if (f === 'stagger') {
      fx = 32 + side * 18;
      fy = 55;
    }
    // 팔: 돌덩이를 이어 붙임
    const n = 4;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const ax = Math.round(sx + (fx - sx) * t);
      const ay = Math.round(30 + bob + (fy - 30 - bob) * t);
      b.disc(ax, ay, k === 0 ? 4 : 3.5, rock);
      if (k > 0 && k < n) e.set(ax, ay, mag2);
    }
    b.disc(fx, fy, 6, rock);
    e.set(fx - 2, fy, mag2);
    e.set(fx + 1, fy + 2, mag2);
  };
  fist(-1);
  fist(1);
  // 머리
  const hy = 16 + bob + (f === 'windup' ? -1 : 0);
  b.rect(26 + sway, hy, 13, 9, C.stone3);
  b.hline(26 + sway, 38 + sway, hy, C.stone4);
  b.rect(26 + sway, hy + 3, 13, 2, C.stone1);
  b.vline(38 + sway, hy + 1, hy + 8, C.stone2);
  if (f === 'hurt' || f === 'stagger') {
    e.hline(28 + sway, 30 + sway, hy + 4, E2);
    e.hline(34 + sway, 36 + sway, hy + 4, E2);
  } else {
    e.rect(28 + sway, hy + 4, 3, 2, E0);
    e.rect(34 + sway, hy + 4, 3, 2, E0);
  }
  // 용암 균열
  const cracks: [number, number, number, number][] = [
    [24, 30, 30, 36],
    [30, 36, 28, 42],
    [30, 36, 37, 38],
    [37, 38, 41, 33],
    [37, 38, 36, 44],
    [12, 25, 18, 29],
    [46, 24, 51, 29],
  ];
  for (const [x0, y0, x1, y1] of cracks) e.line(x0 + sway, y0 + bob, x1 + sway, y1 + bob, mag);
  e.disc(32 + sway, 38 + bob, 2, mag);
}

function buildGolem(scene: Phaser.Scene) {
  const seq: [BossFrame, number][] = [
    ['idle', 0],
    ['idle', 1],
    ['idle', 2],
    ['idle', 3],
    ['walk', 0],
    ['walk', 1],
    ['walk', 2],
    ['walk', 3],
    ['windup', 0],
    ['windup', 1],
    ['slam', 0],
    ['slam', 1],
    ['hurt', 0],
    ['stagger', 0],
    ['stagger', 1],
  ];
  const bodies: Px[] = [];
  const elems: Px[] = [];
  for (const [f, i] of seq) {
    const b = new Px(64, 64);
    const e = new Px(64, 64);
    drawGolem(b, e, f, i);
    outline(b, e, C.out);
    bodies.push(b);
    elems.push(e);
  }
  registerSheet(scene, 'golem_body', bodies);
  registerSheet(scene, 'golem_elem', elems);
}

export function buildEnemySprites(scene: Phaser.Scene): void {
  for (const [kind, draw] of Object.entries(DRAWERS)) {
    const bodies: Px[] = [];
    const elems: Px[] = [];
    for (const [f, i] of FRAMES) {
      const b = new Px(32, 32);
      const e = new Px(32, 32);
      draw(b, e, f, i);
      outline(b, e, C.out);
      bodies.push(b);
      elems.push(e);
    }
    registerSheet(scene, `${kind}_body`, bodies);
    registerSheet(scene, `${kind}_elem`, elems);
  }
  buildWisp(scene);
  buildGolem(scene);
}
