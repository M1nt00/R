import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import type { Actor } from '../entities/actor';
import type { Element, Team } from '../element/types';
import type { FieldKind } from '../element/data';
import { DEPTH } from '../config';

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
  kind: FieldKind;
  color: number;
  vx?: number;
  vy?: number;
  pull?: number;
  isReaction?: boolean;
  terrainElement?: Element | null;
}

interface Field {
  spec: FieldSpec;
  x: number;
  y: number;
  t: number;
  tickT: number;
  touched: Set<Actor>;
}

/** 장판 (화염폭풍 불길, 증기 장막, 회오리 등) */
export class FieldSystem {
  private list: Field[] = [];
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(private readonly s: RoomScene) {
    this.g = s.add.graphics().setDepth(DEPTH.field);
  }

  spawn(spec: FieldSpec): void {
    this.list.push({ spec, x: spec.x, y: spec.y, t: 0, tickT: 0, touched: new Set() });
  }

  inSteam(x: number, y: number): boolean {
    return this.list.some(
      (f) => f.spec.kind === 'steam' && Phaser.Math.Distance.Between(x, y, f.x, f.y) <= f.spec.radius,
    );
  }

  update(dt: number): void {
    const s = this.s;
    for (const f of this.list) {
      const sp = f.spec;
      f.t += dt;
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
      if (f.tickT <= 0) {
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
              environmental: !sp.isReaction,
              color: sp.color,
            });
          }
        }
        if (sp.terrainElement) s.terrain.applyElement(f.x, f.y, sp.radius * 0.6, sp.terrainElement);
        if (sp.kind !== 'steam') s.vfx.burst(f.x + Phaser.Math.Between(-sp.radius, sp.radius) * 0.6, f.y, sp.color, 2);
      }
    }
    this.list = this.list.filter((f) => f.t < f.spec.duration);
  }

  draw(time: number): void {
    const g = this.g;
    g.clear();
    for (const f of this.list) {
      const sp = f.spec;
      const life = 1 - f.t / sp.duration;
      const fade = Math.min(1, life * 4) * Math.min(1, f.t * 8);
      const r = sp.radius;
      switch (sp.kind) {
        case 'flames':
        case 'plasma': {
          g.fillStyle(sp.color, 0.2 * fade);
          g.fillCircle(f.x, f.y, r);
          g.lineStyle(1, sp.color, 0.6 * fade);
          g.strokeCircle(f.x, f.y, r);
          for (let k = 0; k < 8; k++) {
            const a = k * 0.785 + time * (sp.kind === 'plasma' ? 4 : 1.3);
            const rr = r * (0.3 + 0.6 * (((k * 37 + Math.floor(time * 10)) % 10) / 10));
            g.fillStyle(sp.kind === 'plasma' ? 0xffffff : 0xffc070, 0.8 * fade);
            g.fillRect(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr * 0.7, 2, 3);
          }
          break;
        }
        case 'steam': {
          for (let k = 0; k < 7; k++) {
            const a = k * 0.9 + time * 0.4;
            g.fillStyle(0xe6eef5, 0.22 * fade);
            g.fillCircle(f.x + Math.cos(a) * r * 0.45, f.y + Math.sin(a) * r * 0.35, r * 0.55);
          }
          break;
        }
        case 'tornado':
        case 'fireTornado': {
          g.fillStyle(sp.color, 0.12 * fade);
          g.fillCircle(f.x, f.y, r);
          for (let k = 0; k < 3; k++) {
            const a = time * 12 + k * 2.094;
            g.lineStyle(2, sp.color, 0.85 * fade);
            g.beginPath();
            g.arc(f.x, f.y - 2, r * (0.35 + k * 0.22), a, a + 1.8, false);
            g.strokePath();
          }
          break;
        }
      }
    }
  }
}
