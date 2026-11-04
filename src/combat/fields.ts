import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import type { Actor } from '../entities/actor';
import type { Element, Team } from '../element/types';
import type { FieldKind } from '../element/data';
import { DEPTH } from '../config';
import { C } from '../art/palette';

export interface FieldSpec {
  x: number;
  y: number;
  radius: number;
  duration: number;
  tick: number;
  damage: number;
  attach: Element | null;
  attachDuration?: number;
  noStack?: boolean;
  /** 첫 접촉 때 한 번만 추가로 실어 보낼 원소 (완벽 회피 흡수) */
  extra?: Element | null;
  /** 효과를 받는 진영 */
  affect: Team | 'all';
  /** 장판을 만든 쪽 (화염폭풍 장판 위 이속 증가 판정용) */
  owner?: Team;
  kind: FieldKind;
  color: number;
  vx?: number;
  vy?: number;
  pull?: number;
  isReaction?: boolean;
  reactionId?: string;
  /** 가장 가까운 적을 천천히 쫓아감 (화염폭풍 극의) */
  chase?: boolean;
  terrainElement?: Element | null;
  perfectDodgeable?: boolean;
}

interface Field {
  spec: FieldSpec;
  x: number;
  y: number;
  t: number;
  tickT: number;
  touched: Set<Actor>;
}

/** 장판 (화염폭풍 불길, 증기 장막, 회오리, 용암 등) */
export class FieldSystem {
  private list: Field[] = [];
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(private readonly s: RoomScene) {
    // 장판은 바닥에 깔리되 ADD로 발광
    this.g = s.add.graphics().setDepth(DEPTH.field).setBlendMode(Phaser.BlendModes.ADD);
  }

  spawn(spec: FieldSpec): void {
    this.list.push({ spec, x: spec.x, y: spec.y, t: 0, tickT: 0, touched: new Set() });
  }

  inSteam(x: number, y: number): boolean {
    return this.list.some((f) => f.spec.kind === 'steam' && Phaser.Math.Distance.Between(x, y, f.x, f.y) <= f.spec.radius);
  }

  /** 플레이어 쪽이 만든 불길 장판 위인지 */
  onFriendlyFlames(x: number, y: number): boolean {
    return this.list.some(
      (f) => f.spec.kind === 'flames' && f.spec.owner === 'player' && Phaser.Math.Distance.Between(x, y, f.x, f.y) <= f.spec.radius,
    );
  }

  update(dt: number): void {
    const s = this.s;
    for (const f of this.list) {
      const sp = f.spec;
      f.t += dt;
      if (sp.chase) {
        const targets = s.actorsOfTeam(sp.affect);
        let best: Actor | null = null;
        let bd = 1e9;
        for (const a of targets) {
          const d = Phaser.Math.Distance.Between(f.x, f.y, a.x, a.y);
          if (d < bd) {
            bd = d;
            best = a;
          }
        }
        if (best && bd > 4) {
          sp.vx = ((best.x - f.x) / bd) * 28;
          sp.vy = ((best.y - f.y) / bd) * 28;
        }
      }
      if (sp.vx || sp.vy) {
        const nx = f.x + (sp.vx ?? 0) * dt;
        const ny = f.y + (sp.vy ?? 0) * dt;
        if (s.terrain.isWallAt(nx, ny)) {
          sp.vx = 0;
          sp.vy = 0;
        } else {
          f.x = nx;
          f.y = ny;
        }
      }
      if (sp.pull) {
        for (const a of s.combat.inCircle(f.x, f.y, sp.radius * 1.6, sp.affect)) {
          const d = Phaser.Math.Distance.Between(a.x, a.y, f.x, f.y);
          if (d > 2) a.push.add(new Phaser.Math.Vector2(((f.x - a.x) / d) * sp.pull, ((f.y - a.y) / d) * sp.pull));
        }
      }
      f.tickT -= dt;
      if (f.tickT <= 0 && f.t > (sp.kind === 'lava' ? 0.15 : 0)) {
        f.tickT += sp.tick;
        if (sp.damage > 0 || sp.attach) {
          for (const a of s.combat.inCircle(f.x, f.y, sp.radius, sp.affect)) {
            const first = !f.touched.has(a);
            f.touched.add(a);
            s.combat.hit(a, {
              damage: sp.damage,
              element: sp.attach,
              attachDuration: sp.attachDuration,
              noStack: sp.noStack,
              extra: first ? sp.extra : null,
              isReaction: sp.isReaction,
              reactionId: sp.reactionId,
              environmental: !sp.isReaction,
              color: sp.color,
            });
          }
        }
        if (sp.terrainElement) s.terrain.applyElement(f.x, f.y, sp.radius * 0.6, sp.terrainElement);
        if (sp.kind !== 'steam') s.vfx.spark(f.x + Phaser.Math.Between(-sp.radius, sp.radius) * 0.6, f.y, sp.color, 2, 20, 50);
      }
    }
    this.list = this.list.filter((f) => f.t < f.spec.duration);
  }

  emitLights(): void {
    for (const f of this.list) {
      const sp = f.spec;
      if (sp.kind === 'steam') continue;
      const life = Math.min(1, (sp.duration - f.t) * 3);
      this.s.lighting.add(f.x, f.y, sp.radius * 2.6, sp.color, 0.7 * life);
    }
  }

  draw(time: number): void {
    const g = this.g;
    g.clear();
    for (const f of this.list) {
      const sp = f.spec;
      const life = 1 - f.t / sp.duration;
      const fade = Math.min(1, life * 4) * Math.min(1, f.t * 8);
      const r = sp.radius;
      const ex = (rr: number) => [f.x, f.y, rr * 2, rr * 1.5] as const;
      switch (sp.kind) {
        case 'flames':
        case 'plasma': {
          g.fillStyle(sp.color, 0.18 * fade);
          g.fillEllipse(...ex(r));
          g.lineStyle(1, sp.color, 0.6 * fade);
          g.strokeEllipse(...ex(r));
          for (let k = 0; k < 10; k++) {
            const a = k * 0.628 + time * (sp.kind === 'plasma' ? 4 : 1.3);
            const rr = r * (0.25 + 0.65 * (((k * 37 + Math.floor(time * 10)) % 10) / 10));
            const h = 2 + ((k + Math.floor(time * 12)) % 3);
            g.fillStyle(sp.kind === 'plasma' ? 0xffffff : k % 2 ? C.fire0 : C.fire1, 0.9 * fade);
            g.fillRect(Math.round(f.x + Math.cos(a) * rr), Math.round(f.y + Math.sin(a) * rr * 0.7) - h, 1, h);
          }
          break;
        }
        case 'lava': {
          g.fillStyle(C.fire2, 0.85 * fade);
          g.fillEllipse(...ex(r));
          g.fillStyle(C.fire1, 0.7 * fade);
          g.fillEllipse(f.x, f.y, r * 1.4, r);
          for (let k = 0; k < 4; k++) {
            const a = k * 1.7 + Math.floor(time * 2 + k) * 0.9;
            g.fillStyle(C.fire0, fade);
            g.fillRect(Math.round(f.x + Math.cos(a) * r * 0.5), Math.round(f.y + Math.sin(a) * r * 0.35), 2, 1);
          }
          break;
        }
        case 'steam': {
          for (let k = 0; k < 8; k++) {
            const a = k * 0.8 + time * 0.4;
            g.fillStyle(0xffffff, 0.2 * fade);
            g.fillCircle(f.x + Math.cos(a) * r * 0.45, f.y + Math.sin(a) * r * 0.3 - 4, r * 0.5);
          }
          break;
        }
        case 'tornado':
        case 'fireTornado': {
          g.fillStyle(sp.color, 0.14 * fade);
          g.fillEllipse(...ex(r));
          for (let k = 0; k < 4; k++) {
            const a = time * 12 + k * 1.57;
            const rr = r * (0.3 + k * 0.2);
            g.lineStyle(2, k % 2 ? 0xffffff : sp.color, 0.85 * fade);
            g.beginPath();
            g.arc(f.x, f.y - 3 - k * 3, rr, a, a + 1.9, false);
            g.strokePath();
          }
          break;
        }
      }
    }
  }
}
