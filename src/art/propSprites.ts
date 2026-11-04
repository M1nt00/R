import type Phaser from 'phaser';
import { Px, outline, registerSheet, registerCanvas } from './pixel';
import { C, E0, E1, E2 } from './palette';

/** 아이콘 시트 인덱스 (12×12, UI·HUD·문 위 보상 표시) */
export const ICON = {
  fire: 0,
  water: 1,
  wind: 2,
  lightning: 3,
  boon: 4,
  relic: 5,
  gold: 6,
  shop: 7,
  heal: 8,
  boss: 9,
  essence: 10,
  potion: 11,
  feather: 12,
  boots: 13,
  frozenHeart: 14,
  boilingBlood: 15,
  twinHands: 16,
  lightningRod: 17,
  stillWater: 18,
  voidShard: 19,
  common: 20,
  stack: 21,
  heart: 22,
} as const;
export type IconName = keyof typeof ICON;

function sheet(scene: Phaser.Scene, key: string, frames: Px[], elems?: Px[]) {
  frames.forEach((b, i) => outline(b, elems ? elems[i] : null, C.out));
  registerSheet(scene, `${key}`, frames);
  if (elems) registerSheet(scene, `${key}_elem`, elems);
}

function icons(scene: Phaser.Scene) {
  const list: Px[] = [];
  const mk = (draw: (p: Px) => void) => {
    const p = new Px(12, 12);
    draw(p);
    list.push(p);
  };
  // 원소
  mk((p) => {
    p.disc(6, 7, 3.5, C.fire1);
    p.line(6, 1, 6, 5, C.fire1);
    p.line(4, 3, 4, 5, C.fire1);
    p.disc(6, 8, 1.8, C.fire0);
    p.set(6, 2, C.fire0);
  });
  mk((p) => {
    p.disc(6, 7, 3.5, C.water1);
    p.line(6, 1, 4, 5, C.water1);
    p.line(6, 1, 8, 5, C.water1);
    p.vline(6, 1, 4, C.water1);
    p.set(5, 6, C.water0);
    p.set(5, 7, C.water0);
  });
  mk((p) => {
    p.hline(2, 8, 4, C.wind1);
    p.hline(1, 9, 7, C.wind0);
    p.hline(3, 7, 10, C.wind1);
    p.set(9, 3, C.wind1);
    p.set(10, 6, C.wind0);
    p.set(8, 9, C.wind1);
  });
  mk((p) => {
    p.line(7, 0, 3, 6, C.light1);
    p.line(8, 0, 4, 6, C.light1);
    p.hline(3, 8, 6, C.light1);
    p.line(8, 6, 4, 11, C.light1);
    p.line(7, 6, 5, 9, C.light0);
  });
  // 반응 강화 (소용돌이 구슬)
  mk((p) => {
    p.disc(6, 6, 4.5, C.stone4);
    p.disc(6, 6, 3, C.white);
    p.line(3, 6, 9, 6, C.gold1);
    p.line(6, 3, 6, 9, C.gold1);
  });
  // 유물 (보석)
  mk((p) => {
    p.hline(3, 8, 2, C.water0);
    p.rect(1, 3, 10, 2, C.water1);
    p.line(1, 5, 6, 10, C.water2);
    p.line(10, 5, 6, 10, C.water2);
    for (let y = 5; y < 10; y++) p.hline(1 + (y - 5), 10 - (y - 5), y, C.water1);
    p.set(4, 4, C.white);
  });
  // 골드
  mk((p) => {
    p.disc(6, 6, 4.5, C.gold1);
    p.disc(6, 6, 3, C.gold0);
    p.vline(6, 4, 8, C.gold1);
  });
  // 상점 (주머니)
  mk((p) => {
    p.disc(6, 8, 3.5, C.leather0);
    p.rect(4, 2, 4, 3, C.leather1);
    p.hline(3, 8, 4, C.gold1);
    p.set(5, 8, C.gold0);
  });
  // 회복 (샘)
  mk((p) => {
    p.disc(4, 5, 2.5, C.blood);
    p.disc(8, 5, 2.5, C.blood);
    p.line(1, 6, 6, 11, C.blood);
    p.line(11, 6, 6, 11, C.blood);
    for (let y = 6; y < 11; y++) p.hline(1 + (y - 6), 11 - (y - 6), y, C.blood);
    p.set(3, 4, C.white);
  });
  // 보스 (해골)
  mk((p) => {
    p.disc(6, 5, 4.5, C.stone4);
    p.rect(3, 8, 6, 3, C.stone4);
    p.rect(3, 4, 2, 2, C.ink);
    p.rect(7, 4, 2, 2, C.ink);
    p.vline(5, 9, 10, C.stone2);
    p.vline(7, 9, 10, C.stone2);
  });
  // 원소 정수 (결정)
  mk((p) => {
    p.line(6, 0, 2, 6, 0xd9b8ff);
    p.line(6, 0, 10, 6, 0xd9b8ff);
    p.line(2, 6, 6, 11, 0x9a6fd6);
    p.line(10, 6, 6, 11, 0x9a6fd6);
    for (let y = 1; y < 11; y++) {
      const half = y <= 6 ? Math.round((y / 6) * 4) : Math.round(((11 - y) / 5) * 4);
      p.hline(6 - half, 6 + half, y, y < 6 ? 0xc59cff : 0x9a6fd6);
    }
    p.vline(5, 2, 6, C.white);
  });
  // 포션
  mk((p) => {
    p.rect(5, 1, 2, 3, C.stone4);
    p.disc(6, 7, 4, C.blood);
    p.hline(3, 9, 5, 0xff98a2);
    p.set(4, 6, C.white);
  });
  // 유물 아이콘 8종
  mk((p) => {
    p.line(2, 10, 9, 2, C.stone4);
    for (let k = 0; k < 6; k++) p.line(3 + k, 8 - k, 5 + k, 9 - k, k % 2 ? C.wind0 : C.wind1);
  });
  mk((p) => {
    p.rect(3, 2, 4, 6, C.leather0);
    p.rect(3, 8, 7, 3, C.leather1);
    p.line(2, 3, 2, 6, C.light1);
    p.line(1, 5, 1, 7, C.light0);
  });
  mk((p) => {
    p.disc(4, 5, 2.5, C.water0);
    p.disc(8, 5, 2.5, C.water0);
    for (let y = 6; y < 11; y++) p.hline(1 + (y - 6), 11 - (y - 6), y, C.water1);
    p.set(3, 4, C.white);
  });
  mk((p) => {
    p.disc(6, 7, 4, C.fire2);
    p.line(6, 1, 6, 5, C.fire2);
    p.disc(6, 8, 2, C.blood);
    p.set(5, 3, C.fire1);
  });
  mk((p) => {
    p.rect(1, 4, 4, 5, C.skin1);
    p.rect(7, 4, 4, 5, C.skin1);
    p.vline(2, 2, 4, C.skin1);
    p.vline(8, 2, 4, C.skin1);
    p.set(3, 6, C.gold0);
    p.set(9, 6, C.gold0);
  });
  mk((p) => {
    p.vline(6, 3, 11, C.stone4);
    p.hline(4, 8, 11, C.stone3);
    p.line(4, 0, 7, 3, C.light1);
    p.line(8, 0, 5, 3, C.light0);
  });
  mk((p) => {
    p.disc(6, 7, 4, C.water1);
    p.hline(2, 10, 7, C.water0);
    p.hline(4, 8, 9, C.water2);
  });
  mk((p) => {
    p.line(6, 0, 9, 6, 0x9a6fd6);
    p.line(9, 6, 5, 11, 0x5b3c8a);
    p.line(5, 11, 3, 5, 0x5b3c8a);
    p.line(3, 5, 6, 0, 0x9a6fd6);
    p.vline(6, 2, 8, 0xd9b8ff);
  });
  // 공통 (별), 중첩 (세 점), 하트
  mk((p) => {
    p.line(6, 0, 6, 11, C.gold0);
    p.line(0, 5, 11, 5, C.gold0);
    p.disc(6, 5, 2, C.white);
  });
  mk((p) => {
    p.disc(3, 6, 2, C.stone4);
    p.disc(6, 3, 2, C.stone4);
    p.disc(9, 6, 2, C.stone4);
  });
  mk((p) => {
    p.disc(4, 5, 2.5, C.blood);
    p.disc(8, 5, 2.5, C.blood);
    for (let y = 6; y < 11; y++) p.hline(1 + (y - 6), 11 - (y - 6), y, C.blood);
  });
  sheet(scene, 'icons', list);
}

function projectiles(scene: Phaser.Scene) {
  const one = (key: string, w: number, h: number, draw: (p: Px) => void) => {
    const p = new Px(w, h);
    draw(p);
    registerSheet(scene, key, [p]);
  };
  one('bolt', 8, 5, (p) => {
    p.ellipse(4, 2, 3.5, 2, (dx) => (dx > 0 ? E0 : E1));
    p.set(0, 2, E2);
  });
  one('orb', 7, 7, (p) => p.disc(3, 3, 3, (dx, dy) => (dx + dy < -1 ? E0 : dx + dy > 2 ? E2 : E1)));
  one('shard', 5, 3, (p) => {
    p.hline(0, 4, 1, E0);
    p.set(2, 0, E1);
    p.set(2, 2, E1);
  });
  one('dot', 1, 1, (p) => p.set(0, 0, E0));
  one('px', 2, 2, (p) => p.rect(0, 0, 2, 2, E0));
}

function canvasTextures(scene: Phaser.Scene) {
  // 그림자
  registerCanvas(scene, 'shadow', 16, 6, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(8, 3, 7, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  registerCanvas(scene, 'shadow_big', 48, 14, (ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(24, 7, 22, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  // 조명 (계단식 그라데이션 → 픽셀아트 느낌)
  registerCanvas(scene, 'light', 64, 64, (ctx) => {
    const steps = 7;
    for (let s = steps; s >= 1; s--) {
      const r = (s / steps) * 32;
      const a = Math.pow(1 - (s - 1) / steps, 1.6);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(32, 32, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  registerCanvas(scene, 'glow', 32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });
  registerCanvas(scene, 'scorch', 32, 32, (ctx) => {
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 13;
      ctx.fillStyle = `rgba(8,4,10,${(0.5 - r / 30).toFixed(2)})`;
      ctx.fillRect(Math.round(16 + Math.cos(a) * r), Math.round(16 + Math.sin(a) * r * 0.7), 2, 2);
    }
  });
  registerCanvas(scene, 'vignette', 480, 270, (ctx) => {
    const g = ctx.createRadialGradient(240, 135, 120, 240, 135, 300);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 480, 270);
  });
}

function props(scene: Phaser.Scene) {
  // 문 (위쪽 벽, 32×32): 0 닫힘, 1 열림
  const door = (open: boolean) => {
    const p = new Px(32, 32);
    for (let y = 2; y < 32; y++) {
      for (let x = 2; x < 30; x++) {
        const inArch = (x - 16) ** 2 / 121 + (y - 14) ** 2 / 144 <= 1 || (y >= 14 && x >= 5 && x <= 26);
        if (!inArch) continue;
        const frame = (x - 16) ** 2 / 64 + (y - 15) ** 2 / 110 > 1 && !(y >= 15 && x >= 8 && x <= 23);
        if (frame) p.set(x, y, (x + y) % 5 === 0 ? C.stone2 : C.stone3);
        else if (open) p.set(x, y, y > 26 ? C.stone0 : C.ink);
        else p.set(x, y, x % 4 === 0 ? C.stone2 : y % 6 === 0 ? C.stone1 : C.leather1);
      }
    }
    if (!open) {
      for (let x = 8; x <= 23; x += 4) p.vline(x, 7, 31, C.stone3);
      p.hline(8, 23, 18, C.stone3);
    }
    p.rect(13, 3, 6, 3, C.stone4);
    p.set(15, 4, C.gold0);
    p.set(16, 4, C.gold0);
    return p;
  };
  sheet(scene, 'door', [door(false), door(true)]);

  // 입구 (아래쪽 벽 철창, 32×16)
  const gate = new Px(32, 16);
  gate.rect(0, 0, 32, 16, C.stone1);
  for (let x = 3; x < 30; x += 4) gate.vline(x, 1, 15, C.stone3);
  gate.hline(1, 30, 4, C.stone3);
  gate.hline(1, 30, 11, C.stone3);
  sheet(scene, 'gate', [gate]);

  // 화로 + 불꽃
  const braz = new Px(16, 16);
  braz.rect(3, 6, 10, 4, C.stone1);
  braz.hline(3, 12, 6, C.stone3);
  braz.rect(7, 10, 2, 5, C.stone1);
  braz.rect(5, 14, 6, 2, C.stone2);
  braz.rect(4, 7, 8, 1, C.fire2);
  sheet(scene, 'brazier', [braz]);
  const flames: Px[] = [];
  for (let i = 0; i < 4; i++) {
    const f = new Px(10, 12);
    const sway = [0, 1, 0, -1][i];
    f.ellipse(5, 8, 3.5, 3.5, C.fire1);
    f.line(5, 8, 5 + sway, 1, C.fire1);
    f.line(4, 8, 4 + sway, 3, C.fire1);
    f.line(6, 8, 6 + sway, 3, C.fire1);
    f.ellipse(5, 9, 2, 2, C.fire0);
    f.set(5 + sway, 5, C.fire0);
    f.set(5, 10, C.white);
    flames.push(f);
  }
  registerSheet(scene, 'flame', flames);

  // 성소 제단 (원소 정수로 메타 성장)
  const altarB = new Px(32, 32);
  const altarE = new Px(32, 32);
  altarB.rect(4, 20, 24, 8, C.stone2);
  altarB.hline(4, 27, 20, C.stone4);
  altarB.rect(4, 27, 24, 2, C.stone1);
  altarB.rect(8, 14, 16, 6, C.stone3);
  altarB.hline(8, 23, 14, C.stone4);
  altarB.rect(6, 23, 2, 2, C.gold1);
  altarB.rect(24, 23, 2, 2, C.gold1);
  altarE.line(16, 2, 12, 9, E0);
  altarE.line(16, 2, 20, 9, E1);
  for (let y = 3; y <= 12; y++) {
    const h = y <= 8 ? Math.round(((y - 2) / 6) * 4) : Math.round(((13 - y) / 4) * 4);
    altarE.hline(16 - h, 16 + h, y, y < 8 ? E0 : E1);
  }
  altarE.vline(15, 4, 9, E0);
  sheet(scene, 'altar', [altarB], [altarE]);

  // 포탈 (4프레임 소용돌이)
  const portalB: Px[] = [];
  const portalE: Px[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new Px(48, 48);
    const e = new Px(48, 48);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        const dx = x - 24;
        const dy = (y - 26) * 1.15;
        const d = Math.hypot(dx, dy);
        if (d > 22 || y > 45) continue;
        if (d > 18) b.set(x, y, (Math.floor(Math.atan2(dy, dx) * 4) + 8) % 2 ? C.stone3 : C.stone2);
        else {
          const a = Math.atan2(dy, dx) + d * 0.35 - i * (Math.PI / 2);
          const band = Math.sin(a * 3);
          e.set(x, y, band > 0.4 ? E0 : band > -0.3 ? E1 : E2);
        }
      }
    }
    portalB.push(b);
    portalE.push(e);
  }
  sheet(scene, 'portal', portalB, portalE);

  // 원소 기둥 (16×32, 꼭대기 구슬이 원소색)
  const pilB = new Px(16, 32);
  const pilE = new Px(16, 32);
  pilB.rect(4, 10, 8, 19, C.stone2);
  pilB.vline(4, 10, 28, C.stone3);
  pilB.vline(11, 10, 28, C.stone1);
  pilB.rect(2, 27, 12, 4, C.stone3);
  pilB.rect(3, 8, 10, 3, C.stone3);
  pilE.disc(8, 5, 3.5, (dx, dy) => (dx + dy < -1 ? E0 : dx + dy > 2 ? E2 : E1));
  for (let y = 13; y < 26; y += 4) pilE.set(8, y, E1);
  sheet(scene, 'pillar_el', [pilB], [pilE]);

  // 허수아비 (훈련용): 0 기본, 1 맞음
  const dummy = (hit: boolean) => {
    const b = new Px(32, 32);
    const lean = hit ? -2 : 0;
    b.vline(16, 12, 26, C.leather1);
    b.rect(13, 25, 7, 2, C.leather1);
    b.line(8 + lean, 14, 24 + lean, 14, C.leather0);
    b.ellipse(16 + lean, 17, 5, 6, (dx, dy) => (dy < -2 ? C.grass0 : dy > 3 ? C.grass2 : C.grass1));
    b.disc(16 + lean, 8, 4, (dx, dy) => (dx + dy < -1 ? C.grass0 : C.grass1));
    b.set(14 + lean, 7, C.ink);
    b.set(18 + lean, 7, C.ink);
    return b;
  };
  const dummyB = [dummy(false), dummy(true)];
  const dummyE = [0, 1].map((i) => {
    const e = new Px(32, 32);
    const lean = i ? -2 : 0;
    e.disc(16 + lean, 17, 3.5, E1);
    e.disc(16 + lean, 17, 2, E0);
    return e;
  });
  dummyB.forEach((b, i) => outline(b, dummyE[i], C.out));
  registerSheet(scene, 'dummy_body', dummyB);
  registerSheet(scene, 'dummy_elem', dummyE);

  // 회복의 샘
  const fountB: Px[] = [];
  for (let i = 0; i < 2; i++) {
    const b = new Px(32, 32);
    b.ellipse(16, 24, 13, 5, C.stone3);
    b.ellipse(16, 23, 11, 3.5, i ? C.water1 : C.water2);
    b.rect(14, 10, 4, 12, C.stone2);
    b.ellipse(16, 10, 6, 2.5, C.stone3);
    b.ellipse(16, 9.5, 4.5, 1.5, C.water1);
    b.set(13 + i * 2, 21, C.water0);
    b.set(19 - i * 2, 24, C.water0);
    b.vline(16, 4, 8, i ? C.water0 : C.water1);
    fountB.push(b);
  }
  sheet(scene, 'fountain', fountB);

  // 상점 받침대
  const ped = new Px(20, 16);
  ped.rect(3, 6, 14, 9, C.stone2);
  ped.hline(3, 16, 6, C.stone4);
  ped.rect(1, 13, 18, 3, C.stone1);
  ped.rect(5, 8, 10, 1, C.leather0);
  sheet(scene, 'pedestal', [ped]);

  // 동전 (4프레임 회전)
  const coins: Px[] = [];
  for (let i = 0; i < 4; i++) {
    const p = new Px(8, 8);
    const w = [3, 2, 1, 2][i];
    p.ellipse(4, 4, w, 3, (dx) => (dx < 0 ? C.gold0 : C.gold1));
    if (w > 1) p.vline(4, 3, 5, C.gold1);
    coins.push(p);
  }
  sheet(scene, 'coin', coins);

  // 원소 정수
  const ess: Px[] = [];
  for (let i = 0; i < 4; i++) {
    const p = new Px(8, 10);
    for (let y = 0; y < 10; y++) {
      const h = y <= 4 ? Math.round((y / 4) * 3) : Math.round(((9 - y) / 5) * 3);
      p.hline(4 - h, 4 + h - 1, y, y < 5 ? 0xc59cff : 0x8a5cc8);
    }
    p.vline(3, 1 + (i % 2), 4 + (i % 2), C.white);
    ess.push(p);
  }
  sheet(scene, 'essence', ess);

  // 보상 구슬 (원소 레이어로 종류별 색)
  const orbB: Px[] = [];
  const orbE: Px[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new Px(16, 16);
    const e = new Px(16, 16);
    e.disc(8, 8, 5, (dx, dy) => (dx + dy < -2 ? E0 : dx + dy > 3 ? E2 : E1));
    const a = (i / 4) * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      const aa = a + (k * Math.PI * 2) / 3;
      e.set(Math.round(8 + Math.cos(aa) * 7), Math.round(8 + Math.sin(aa) * 7), E0);
    }
    b.set(6, 6, C.white);
    b.set(7, 5, C.white);
    orbB.push(b);
    orbE.push(e);
  }
  sheet(scene, 'reward_orb', orbB, orbE);
}

export function buildPropSprites(scene: Phaser.Scene): void {
  canvasTextures(scene);
  projectiles(scene);
  icons(scene);
  props(scene);
}
