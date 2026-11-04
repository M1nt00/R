import type Phaser from 'phaser';
import { Px, outline, registerSheet } from './pixel';
import { C, E0, E1, E2 } from './palette';

/**
 * 주인공 스프라이트 (32×32, 발밑 y=26). 방향 3개(아래·위·옆 — 왼쪽은 좌우 반전).
 * 본체 레이어 + 원소 레이어(목도리·망토·장갑, 흰색 3단계 → setTint).
 */

export type Dir = 'down' | 'up' | 'side';
export const DIRS: Dir[] = ['down', 'up', 'side'];

interface Pose {
  bob: number;
  legA: number;
  legB: number;
  liftA: number;
  liftB: number;
  armA: number;
  armB: number;
  reach: number;
  raise: number;
  lean: number;
  scarf: number;
  hurt: boolean;
  glow: number;
}

const P = (o: Partial<Pose> = {}): Pose => ({
  bob: 0,
  legA: 0,
  legB: 0,
  liftA: 0,
  liftB: 0,
  armA: 0,
  armB: 0,
  reach: 0,
  raise: 0,
  lean: 0,
  scarf: 0,
  hurt: false,
  glow: 0,
  ...o,
});

export interface AnimDef {
  start: number;
  count: number;
  fps: number;
  loop: boolean;
}

const runPose = (k: number): Pose => {
  const s = Math.sin((k / 6) * Math.PI * 2);
  const leg = Math.round(s * 2);
  return P({
    legA: leg,
    legB: -leg,
    liftA: s > 0.4 ? 1 : 0,
    liftB: s < -0.4 ? 1 : 0,
    armA: -leg,
    armB: leg,
    bob: Math.abs(s) > 0.7 ? 1 : 0,
    scarf: k % 4,
  });
};

const POSES = {
  idle: [P({ scarf: 0 }), P({ scarf: 1 }), P({ bob: 1, scarf: 2 }), P({ bob: 1, scarf: 3 })],
  run: [0, 1, 2, 3, 4, 5].map(runPose),
  roll: [0, 1, 2, 3, 4].map(() => P()),
  attack: [
    P({ reach: -2, lean: -1, scarf: 1 }),
    P({ reach: 6, lean: 1, glow: 2, scarf: 2 }),
    P({ reach: 5, lean: 1, glow: 1, scarf: 3 }),
    P({ reach: 2, scarf: 0 }),
  ],
  cast: [P({ raise: 1, scarf: 1 }), P({ raise: 2, glow: 2, scarf: 2 }), P({ raise: 2, glow: 1, scarf: 3, bob: 1 }), P({ raise: 1 })],
  hurt: [P({ hurt: true, lean: -1 }), P({ hurt: true, lean: -1, bob: 1 })],
  death: [P({ hurt: true, bob: 1 }), P({ hurt: true, bob: 3, liftA: 3, liftB: 3 }), P({ hurt: true })],
} as const;

type AnimName = keyof typeof POSES;
const ORDER: AnimName[] = ['idle', 'run', 'roll', 'attack', 'cast', 'hurt', 'death'];
const FPS: Record<AnimName, [number, boolean]> = {
  idle: [5, true],
  run: [13, true],
  roll: [18, false],
  attack: [18, false],
  cast: [14, false],
  hurt: [10, false],
  death: [5, false],
};

export const HERO_FRAMES_PER_DIR = ORDER.reduce((n, a) => n + POSES[a].length, 0);

/** 애니메이션 표: 'idle_down' 같은 키 → 프레임 범위 */
export const HERO_ANIMS: Record<string, AnimDef> = (() => {
  const out: Record<string, AnimDef> = {};
  DIRS.forEach((dir, di) => {
    let o = di * HERO_FRAMES_PER_DIR;
    for (const a of ORDER) {
      const [fps, loop] = FPS[a];
      out[`${a}_${dir}`] = { start: o, count: POSES[a].length, fps, loop };
      o += POSES[a].length;
    }
  });
  return out;
})();

// ───────────────────────────── 부위별 그리기 ─────────────────────────────

function glove(e: Px, x: number, y: number, glow: number) {
  if (glow > 0) e.disc(x + 0.5, y + 0.5, glow + 0.5, E1);
  e.rect(x, y, 2, 2, E0);
  e.set(x + 1, y + 1, E1);
}

function legFront(b: Px, x: number, lift: number, dark: boolean, bob: number) {
  const top = 22 + Math.min(bob, 1);
  const bottom = 26 - lift;
  const pants = dark ? C.pants1 : C.pants0;
  b.rect(x, top, 2, Math.max(1, bottom - 1 - top), pants);
  b.rect(x - (dark ? 0 : 1), bottom - 1, 3, 2, dark ? C.leather1 : C.leather0);
  b.set(x - (dark ? 0 : 1), bottom - 1, dark ? C.leather0 : C.gold1);
}

function legSide(b: Px, x: number, lift: number, dark: boolean, bob: number) {
  const top = 21 + Math.min(bob, 1);
  const bottom = 26 - lift;
  b.rect(x, top, 2, Math.max(1, bottom - 1 - top), dark ? C.pants1 : C.pants0);
  b.rect(x, bottom - 1, 3, 2, dark ? C.leather1 : C.leather0);
}

function drawSide(p: Pose, b: Px, e: Px) {
  const y0 = p.bob;
  const lx = p.lean;
  const sw = [0, -1, -1, 0][p.scarf % 4];

  // 망토 (원소 레이어, 등 뒤)
  for (let y = 15; y <= 22; y++) {
    const t = (y - 15) / 7;
    const xb = 13 + lx - Math.round(t * 2) + (y > 19 ? sw : 0);
    e.hline(xb, 14 + lx, y + y0, y > 20 ? E2 : E1);
  }
  // 뒷다리 / 뒷팔
  legSide(b, 15 + p.legB, p.liftB, true, y0);
  if (p.raise > 0) b.line(15 + lx, 15 + y0, 16 + lx, 11 + y0 - p.raise, C.cloth2);
  else b.rect(14 + lx + Math.sign(p.armB), 15 + y0, 2, 4, C.cloth2);

  // 몸통
  for (let y = 15; y <= 20; y++) {
    for (let x = 14; x <= 19; x++) {
      const c = x === 14 ? C.cloth2 : x === 18 ? C.cloth0 : C.cloth1;
      b.set(x + lx, y + y0, y === 20 ? C.leather1 : c);
    }
  }
  b.set(18 + lx, 20 + y0, C.gold0);
  b.hline(15 + lx, 18 + lx, 21 + y0, C.pants0);
  // 앞다리
  legSide(b, 16 + p.legA, p.liftA, false, y0);

  // 머리
  const hx = 13 + lx;
  const hy = 6 + y0;
  b.hline(hx + 1, hx + 5, hy, C.hair0);
  b.rect(hx, hy + 1, 7, 2, C.hair0);
  b.rect(hx, hy + 3, 2, 4, C.hair1);
  b.rect(hx + 2, hy + 3, 5, 4, C.skin0);
  b.set(hx + 6, hy + 3, C.hair0);
  b.hline(hx + 2, hx + 5, hy + 6, C.skin1);
  b.set(hx + 2, hy + 4, C.skin1);
  b.set(hx + 7, hy + 5, C.skin0);
  b.set(hx + 1, hy + 1, C.hair1);
  if (p.hurt) {
    b.set(hx + 5, hy + 5, C.ink);
    b.set(hx + 4, hy + 4, C.ink);
  } else {
    b.rect(hx + 5, hy + 4, 1, 2, C.ink);
  }

  // 목도리 + 꼬리 (원소 레이어)
  e.hline(14 + lx, 19 + lx, 13 + y0, E0);
  e.hline(14 + lx, 19 + lx, 14 + y0, E1);
  for (let i = 0; i < 5; i++) {
    const wave = i > 1 ? [0, 1, 0, -1][(i + p.scarf) % 4] : 0;
    const x = 13 + lx - i;
    const y = 13 + y0 + Math.round(i * 0.5) + wave;
    e.set(x, y, E1);
    e.set(x, y + 1, i > 2 ? E2 : E1);
  }

  // 앞팔
  if (p.raise > 0) {
    const tx = 20 + lx;
    const ty = 11 + y0 - p.raise * 2;
    b.line(17 + lx, 15 + y0, tx, ty + 2, C.cloth1);
    b.line(18 + lx, 15 + y0, tx + 1, ty + 2, C.cloth0);
    glove(e, tx, ty, p.glow);
  } else if (p.reach > 0) {
    b.rect(18 + lx, 16 + y0, p.reach, 2, C.cloth1);
    b.hline(18 + lx, 17 + lx + p.reach, 16 + y0, C.cloth0);
    glove(e, 18 + lx + p.reach, 16 + y0, p.glow);
  } else if (p.reach < 0) {
    b.rect(15 + lx, 15 + y0, 2, 3, C.cloth1);
    glove(e, 14 + lx, 18 + y0, 0);
  } else {
    const ax = 17 + lx + Math.sign(p.armA);
    b.rect(ax, 15 + y0, 2, 4, C.cloth1);
    b.vline(ax, 15 + y0, 18 + y0, C.cloth0);
    glove(e, ax, 19 + y0, 0);
  }
}

function drawFront(p: Pose, b: Px, e: Px) {
  const y0 = p.bob;
  // 다리
  legFront(b, 13, p.liftA, false, y0);
  legFront(b, 17, p.liftB, true, y0);
  b.hline(13, 18, 22 + y0, C.pants0);

  // 팔 (몸통 뒤쪽 부분)
  const armL = (yOff: number) => {
    b.rect(10, 16 + y0 + yOff, 2, 4, C.cloth1);
    b.vline(10, 16 + y0 + yOff, 19 + y0 + yOff, C.cloth0);
    glove(e, 10, 20 + y0 + yOff, 0);
  };
  if (p.raise > 0) {
    b.rect(10, 11 + y0 - p.raise, 2, 5 + p.raise, C.cloth1);
    b.rect(20, 11 + y0 - p.raise, 2, 5 + p.raise, C.cloth2);
    glove(e, 10, 9 + y0 - p.raise, p.glow);
    glove(e, 20, 9 + y0 - p.raise, p.glow);
  } else armL(Math.max(-1, Math.min(1, p.armA)));

  // 몸통
  for (let y = 16; y <= 21; y++) {
    for (let x = 12; x <= 19; x++) {
      const c = x <= 13 ? C.cloth0 : x >= 18 ? C.cloth2 : C.cloth1;
      b.set(x, y + y0, y === 21 ? C.leather1 : c);
    }
  }
  b.rect(15, 21 + y0, 2, 1, C.gold0);
  b.set(15, 16 + y0, C.skin1);
  b.set(16, 16 + y0, C.skin1);

  if (p.raise === 0) {
    if (p.reach > 0) {
      b.rect(19, 16 + y0, 2, 3 + p.reach, C.cloth2);
      glove(e, 19, 19 + y0 + p.reach, p.glow);
    } else if (p.reach < 0) {
      b.rect(20, 14 + y0, 2, 3, C.cloth2);
      glove(e, 20, 12 + y0, 0);
    } else {
      const yOff = Math.max(-1, Math.min(1, p.armB));
      b.rect(20, 16 + y0 + yOff, 2, 4, C.cloth2);
      glove(e, 20, 20 + y0 + yOff, 0);
    }
  }

  // 머리
  const hy = 6 + y0;
  b.hline(13, 18, hy, C.hair0);
  b.rect(12, hy + 1, 8, 2, C.hair0);
  b.set(14, hy + 1, C.stone4);
  b.rect(12, hy + 3, 1, 4, C.hair1);
  b.rect(19, hy + 3, 1, 4, C.hair1);
  b.rect(13, hy + 3, 6, 4, C.skin0);
  b.set(13, hy + 3, C.hair0);
  b.set(14, hy + 3, C.hair0);
  b.set(16, hy + 3, C.hair0);
  b.vline(18, hy + 4, hy + 6, C.skin1);
  b.hline(14, 17, hy + 7, C.skin1);
  if (p.hurt) {
    b.hline(14, 15, hy + 5, C.ink);
    b.hline(17, 18, hy + 5, C.ink);
  } else {
    b.rect(14, hy + 4, 1, 2, C.ink);
    b.rect(17, hy + 4, 1, 2, C.ink);
  }

  // 목도리 + 매듭
  e.hline(12, 19, 14 + y0, E0);
  e.hline(12, 19, 15 + y0, E1);
  const kx = 17 + [0, 0, 1, 1][p.scarf % 4];
  e.rect(kx, 16 + y0, 2, 2, E1);
  e.set(kx + 1, 18 + y0, E2);
}

function drawBack(p: Pose, b: Px, e: Px) {
  const y0 = p.bob;
  legFront(b, 13, p.liftA, true, y0);
  legFront(b, 17, p.liftB, true, y0);

  const yA = Math.max(-1, Math.min(1, p.armA));
  const yB = Math.max(-1, Math.min(1, p.armB));
  if (p.raise > 0) {
    b.rect(10, 11 + y0 - p.raise, 2, 5 + p.raise, C.cloth2);
    b.rect(20, 11 + y0 - p.raise, 2, 5 + p.raise, C.cloth2);
    glove(e, 10, 9 + y0 - p.raise, p.glow);
    glove(e, 20, 9 + y0 - p.raise, p.glow);
  } else {
    b.rect(10, 16 + y0 + yA, 2, 4, C.cloth2);
    glove(e, 10, 20 + y0 + yA, 0);
    if (p.reach > 0) {
      b.rect(20, 14 + y0 - p.reach, 2, 3 + p.reach, C.cloth2);
      glove(e, 20, 12 + y0 - p.reach, p.glow);
    } else {
      b.rect(20, 16 + y0 + yB, 2, 4, C.cloth2);
      glove(e, 20, 20 + y0 + yB, 0);
    }
  }
  b.rect(12, 16 + y0, 8, 6, C.cloth2);

  // 망토 (원소 레이어가 등 전체를 덮음 → 뒤에서도 원소가 바로 읽힘)
  const sw = [0, 1, 0, -1][p.scarf % 4];
  for (let y = 16; y <= 22; y++) {
    for (let x = 12; x <= 19; x++) {
      if (y === 22 && (x + sw) % 2 === 0) continue;
      const c = y === 16 || x === 12 ? E0 : y >= 21 || x === 19 ? E2 : x === 15 ? E2 : E1;
      e.set(x, y + y0, c);
    }
  }

  const hy = 6 + y0;
  b.hline(13, 18, hy, C.hair0);
  b.rect(12, hy + 1, 8, 5, C.hair0);
  b.rect(12, hy + 4, 8, 3, C.hair1);
  b.hline(13, 18, hy + 7, C.hair1);
  b.set(14, hy + 1, C.stone4);
  b.set(15, hy + 1, C.stone3);
  e.hline(12, 19, 14 + y0, E0);
  e.hline(12, 19, 15 + y0, E1);
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
    if (u < 0.28) return light === 0 ? C.hair0 : C.hair1;
    if (u < 0.82) return [C.cloth0, C.cloth1, C.cloth2][light];
    return light === 2 ? C.pants1 : C.pants0;
  });
  for (let k = -6; k <= 6; k++) {
    const a = rot + 1.9;
    const x = Math.round(cx + Math.cos(a) * k * 0.9 + Math.cos(a + Math.PI / 2) * 0);
    const y = Math.round(cy + Math.sin(a) * k * 0.9);
    if (b.get(x, y) !== -1) e.set(x, y, Math.abs(k) > 4 ? E2 : E0);
  }
  const ex = Math.round(cx + Math.cos(rot + 0.6) * 4);
  const ey = Math.round(cy + Math.sin(rot + 0.6) * 4);
  e.rect(ex, ey, 2, 2, E1);
}

function drawDeathFinal(b: Px, e: Px) {
  b.rect(8, 21, 6, 4, C.hair0);
  b.rect(10, 22, 3, 3, C.skin0);
  b.rect(14, 21, 8, 5, C.cloth1);
  b.hline(14, 21, 21, C.cloth0);
  b.rect(22, 22, 5, 3, C.pants0);
  b.rect(26, 22, 2, 3, C.leather0);
  e.rect(13, 20, 2, 6, E1);
  e.rect(15, 26, 6, 1, E2);
}

export function buildHeroSprites(scene: Phaser.Scene): void {
  const bodies: Px[] = [];
  const elems: Px[] = [];
  for (const dir of DIRS) {
    for (const a of ORDER) {
      POSES[a].forEach((pose, i) => {
        const b = new Px(32, 32);
        const e = new Px(32, 32);
        if (a === 'roll') drawRoll(i, b, e);
        else if (a === 'death' && i === 2) drawDeathFinal(b, e);
        else if (a === 'death') drawFront(pose, b, e);
        else if (dir === 'side') drawSide(pose, b, e);
        else if (dir === 'down') drawFront(pose, b, e);
        else drawBack(pose, b, e);
        outline(b, e, C.out);
        bodies.push(b);
        elems.push(e);
      });
    }
  }
  registerSheet(scene, 'hero_body', bodies);
  registerSheet(scene, 'hero_elem', elems);
}
