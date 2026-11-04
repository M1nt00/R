import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import type { Actor } from '../entities/actor';
import type { Element, Team } from '../element/types';
import { otherTeam } from '../element/types';
import type { HitInfo } from './damage';
import { DEPTH } from '../config';

export interface ProjectileSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  /** 쏜 쪽 진영 */
  team: Team;
  texture: string;
  color: number;
  hit: HitInfo;
  /** 지나가는 지형에 적용할 원소 */
  element: Element | null;
  pierce?: boolean;
  ignore?: Actor;
}

interface Projectile {
  spec: ProjectileSpec;
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  life: number;
  hitSet: Set<Actor>;
  lastTile: number;
  alive: boolean;
}

/** 투사체 — 이미지 오브젝트 풀링 */
export class ProjectileSystem {
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private list: Projectile[] = [];

  constructor(private readonly s: RoomScene) {}

  spawn(spec: ProjectileSpec): void {
    const img = this.pool.pop() ?? this.s.add.image(0, 0, spec.texture);
    img
      .setTexture(spec.texture)
      .setTint(spec.color)
      .setActive(true)
      .setVisible(true)
      .setDepth(DEPTH.projectile)
      .setPosition(spec.x, spec.y)
      .setRotation(Math.atan2(spec.vy, spec.vx));
    const hitSet = new Set<Actor>();
    if (spec.ignore) hitSet.add(spec.ignore);
    this.list.push({ spec, img, x: spec.x, y: spec.y, life: spec.life, hitSet, lastTile: -1, alive: true });
  }

  update(dt: number): void {
    const s = this.s;
    for (const p of this.list) {
      if (!p.alive) continue;
      const sp = p.spec;
      p.x += sp.vx * dt;
      p.y += sp.vy * dt;
      p.life -= dt;
      p.img.setPosition(p.x, p.y);
      if (p.life <= 0 || s.terrain.isWallAt(p.x, p.y)) {
        this.kill(p);
        continue;
      }
      if (sp.element) {
        const tile = s.terrain.tileOf(p.x, p.y);
        if (tile !== p.lastTile) {
          p.lastTile = tile;
          s.terrain.applyElement(p.x, p.y, 2, sp.element);
        }
      }
      // 발밑 판정이 아니라 몸통 높이로 판정 (투사체는 몸통 높이 -4에서 날아감)
      for (const a of s.actorsOfTeam(otherTeam(sp.team))) {
        if (p.hitSet.has(a)) continue;
        if (Phaser.Math.Distance.Between(p.x, p.y + 4, a.x, a.y) > sp.radius + a.radius) continue;
        p.hitSet.add(a);
        const len = Math.hypot(sp.vx, sp.vy) || 1;
        const res = s.combat.hit(a, { ...sp.hit, fromX: a.x - (sp.vx / len) * 10, fromY: a.y - (sp.vy / len) * 10 });
        if (res === 'hit' && !sp.pierce) {
          this.kill(p);
          break;
        }
      }
    }
    this.list = this.list.filter((p) => p.alive);
  }

  private kill(p: Projectile): void {
    p.alive = false;
    this.s.vfx.burst(p.x, p.y, p.spec.color, 4);
    p.img.setActive(false).setVisible(false);
    this.pool.push(p.img);
  }
}
