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
  glow: Phaser.GameObjects.Image;
  fx: { color: number } | null;
  x: number;
  y: number;
  life: number;
  hitSet: Set<Actor>;
  lastTile: number;
  trailT: number;
  alive: boolean;
}

/** 투사체 — 이미지 오브젝트 풀링, 광채·꼬리 */
export class ProjectileSystem {
  private readonly pool: { img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; fx: { color: number } | null }[] = [];
  private list: Projectile[] = [];

  constructor(private readonly s: RoomScene) {}

  spawn(spec: ProjectileSpec): void {
    const o =
      this.pool.pop() ??
      {
        img: this.s.add.image(0, 0, spec.texture).setBlendMode(Phaser.BlendModes.ADD),
        glow: this.s.add.image(0, 0, 'glow', '0').setBlendMode(Phaser.BlendModes.ADD),
        fx: null as { color: number } | null,
      };
    // 원소 투사체에만 은은한 글로우 (postFX)
    if (!o.fx) o.fx = o.img.preFX?.addGlow(spec.color, 1.5, 0, false, 0.1, 4) ?? null;
    if (o.fx) o.fx.color = spec.color;
    o.img
      .setTexture(spec.texture, '0')
      .setTint(spec.color)
      .setActive(true)
      .setVisible(true)
      .setDepth(DEPTH.projectile)
      .setPosition(spec.x, spec.y)
      .setRotation(Math.atan2(spec.vy, spec.vx));
    o.glow.setTint(spec.color).setActive(true).setVisible(true).setDepth(DEPTH.glow).setScale(1).setAlpha(0.45);
    const hitSet = new Set<Actor>();
    if (spec.ignore) hitSet.add(spec.ignore);
    this.list.push({ spec, img: o.img, glow: o.glow, fx: o.fx, x: spec.x, y: spec.y, life: spec.life, hitSet, lastTile: -1, trailT: 0, alive: true });
  }

  update(dt: number): void {
    const s = this.s;
    for (const p of this.list) {
      if (!p.alive) continue;
      const sp = p.spec;
      p.x += sp.vx * dt;
      p.y += sp.vy * dt;
      p.life -= dt;
      p.img.setPosition(Math.round(p.x), Math.round(p.y));
      p.glow.setPosition(Math.round(p.x), Math.round(p.y));
      p.trailT -= dt;
      if (p.trailT <= 0) {
        p.trailT = 0.03;
        s.vfx.spark(p.x, p.y + 6, sp.color, 1, 8, 5);
      }
      // 투사체는 몸통 높이(-6)로 날아감 → 바닥 판정은 +6
      if (p.life <= 0 || s.terrain.isWallAt(p.x, p.y + 6)) {
        this.kill(p);
        continue;
      }
      if (sp.element) {
        const tile = s.terrain.tileOf(p.x, p.y + 6);
        if (tile !== p.lastTile) {
          p.lastTile = tile;
          s.terrain.applyElement(p.x, p.y + 6, 2, sp.element);
        }
      }
      for (const a of s.actorsOfTeam(otherTeam(sp.team))) {
        if (p.hitSet.has(a)) continue;
        if (Phaser.Math.Distance.Between(p.x, p.y + 6, a.x, a.y) > sp.radius + a.radius + 1) continue;
        p.hitSet.add(a);
        const len = Math.hypot(sp.vx, sp.vy) || 1;
        const res = s.combat.hit(a, { ...sp.hit, fromX: a.x - (sp.vx / len) * 10, fromY: a.y - (sp.vy / len) * 10 });
        if ((res === 'hit' || res === 'blocked') && !sp.pierce) {
          this.kill(p);
          break;
        }
      }
    }
    this.list = this.list.filter((p) => p.alive);
  }

  emitLights(): void {
    for (const p of this.list) this.s.lighting.add(p.x, p.y + 4, 26, p.spec.color, 0.6);
  }

  clearTeam(team: Team): void {
    for (const p of this.list) if (p.spec.team === team) this.kill(p);
    this.list = this.list.filter((p) => p.alive);
  }

  private kill(p: Projectile): void {
    p.alive = false;
    this.s.vfx.spark(p.x, p.y + 6, p.spec.color, 5, 50, 40);
    p.img.setActive(false).setVisible(false);
    p.glow.setActive(false).setVisible(false);
    this.pool.push({ img: p.img, glow: p.glow, fx: p.fx });
  }
}
