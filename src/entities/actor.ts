import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { ElementState } from '../element/elementState';
import type { Team } from '../element/types';
import type { HitInfo, HitResult } from '../combat/damage';
import { ELEMENT_COLOR, hex } from '../art/palette';
import { RESIDUE_COLOR } from '../element/data';
import { DEPTH } from '../config';

/** 스프라이트 원점 = 발밑 (32×32 프레임에서 y=22) */
export const FEET_ORIGIN_Y = 22 / 32;

/**
 * 플레이어·적 공통. 물리 바디(보이지 않음) + 본체 레이어 + 원소 레이어(setTint) 2장 구조.
 * 움직임의 절반(숨쉬기·바운스·스쿼시)은 코드로 얹는다.
 */
export abstract class Actor {
  readonly phys: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  readonly bodyImg: Phaser.GameObjects.Image;
  readonly elemImg: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  readonly hud: Phaser.GameObjects.Graphics;

  hp: number;
  maxHp: number;
  readonly es = new ElementState();
  dead = false;
  isBoss = false;

  /** 넉백·끌어당김 (감쇠) */
  readonly impulse = new Phaser.Math.Vector2();
  /** 바람 통로·회오리처럼 매 프레임 더해지는 힘 */
  readonly push = new Phaser.Math.Vector2();

  frozenT = 0;
  stunT = 0;
  slowT = 0;
  slowFactor = 1;
  flashT = 0;
  onIce = false;
  terrainTickT = 0;
  hpShownT = 0;

  facing = 1;
  squashX = 1;
  squashY = 1;
  elementTint: number;
  private readonly phase = Math.random() * 10;

  protected constructor(
    readonly s: RoomScene,
    group: Phaser.Physics.Arcade.Group,
    x: number,
    y: number,
    bodyKey: string,
    elemKey: string,
    readonly radius: number,
    hp: number,
    readonly team: Team,
    tint: number,
  ) {
    this.hp = hp;
    this.maxHp = hp;
    this.elementTint = tint;
    this.phys = group.create(x, y, 'px') as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    this.phys.setVisible(false);
    this.phys.body.setCircle(radius, 1 - radius, 1 - radius);
    this.phys.setCollideWorldBounds(true);
    this.shadow = s.add.image(x, y, 'shadow').setDepth(DEPTH.shadow);
    this.bodyImg = s.add.image(x, y, bodyKey).setOrigin(0.5, FEET_ORIGIN_Y);
    this.elemImg = s.add.image(x, y, elemKey).setOrigin(0.5, FEET_ORIGIN_Y).setTint(tint);
    this.hud = s.add.graphics().setDepth(DEPTH.hud);
  }

  get x(): number {
    return this.phys.x;
  }
  get y(): number {
    return this.phys.y;
  }
  get disabled(): boolean {
    return this.frozenT > 0 || this.stunT > 0;
  }

  protected baseUpdate(dt: number): void {
    this.es.update(dt);
    if (this.frozenT > 0) this.frozenT -= dt;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slowFactor = 1;
    }
    if (this.flashT > 0) this.flashT -= dt;
    if (this.hpShownT > 0) this.hpShownT -= dt;
  }

  protected move(vx: number, vy: number, dt: number): void {
    if (this.dead) return;
    const ctrl = this.disabled ? 0 : this.slowT > 0 ? this.slowFactor : 1;
    const tx = vx * ctrl + this.impulse.x + this.push.x;
    const ty = vy * ctrl + this.impulse.y + this.push.y;
    const body = this.phys.body;
    if (this.onIce) {
      // 얼음 바닥: 관성이 남아서 미끄러짐
      const k = 1 - Math.exp(-2.5 * dt);
      body.setVelocity(body.velocity.x + (tx - body.velocity.x) * k, body.velocity.y + (ty - body.velocity.y) * k);
    } else {
      body.setVelocity(tx, ty);
    }
    this.impulse.scale(Math.exp(-9 * dt));
    if (this.impulse.lengthSq() < 1) this.impulse.set(0, 0);
    this.push.set(0, 0);
  }

  knock(dx: number, dy: number, strength: number): void {
    let m = this.isBoss ? 0.2 : 1;
    if (this.frozenT > 0) m *= 0.4;
    this.impulse.x += dx * strength * m;
    this.impulse.y += dy * strength * m;
  }

  freeze(d: number): void {
    this.frozenT = Math.max(this.frozenT, d);
  }
  stun(d: number): void {
    this.stunT = Math.max(this.stunT, d);
  }
  slow(factor: number, d: number): void {
    this.slowFactor = Math.min(this.slowT > 0 ? this.slowFactor : 1, factor);
    this.slowT = Math.max(this.slowT, d);
  }
  flash(): void {
    this.flashT = 0.06;
  }

  /** 피격 직전 판정 (플레이어의 구르기 무적·완벽 회피 등) */
  incoming(_h: HitInfo): HitResult | 'ok' {
    return 'ok';
  }

  onDamaged(_h: HitInfo, _dmg: number): void {
    this.hpShownT = 3;
  }

  die(): void {
    this.dead = true;
    this.phys.destroy();
    this.bodyImg.destroy();
    this.elemImg.destroy();
    this.shadow.destroy();
    this.hud.destroy();
  }

  syncVisuals(): void {
    if (this.dead) return;
    const t = this.s.gameTime;
    const moving = this.phys.body.velocity.lengthSq() > 80;
    let sx = this.squashX;
    let sy = this.squashY;
    let oy = 0;
    if (!this.disabled) {
      if (moving) oy = -Math.abs(Math.sin(t * 14 + this.phase)) * 1.5; // 걷기 바운스
      else sy *= 1 + Math.sin(t * 3 + this.phase) * 0.04; // 숨쉬기
    }
    const x = this.phys.x;
    const y = this.phys.y;
    const depth = DEPTH.actor + y;
    this.bodyImg.setPosition(x, y + oy).setScale(sx, sy).setFlipX(this.facing < 0).setDepth(depth);
    this.elemImg.setPosition(x, y + oy).setScale(sx, sy).setFlipX(this.facing < 0).setDepth(depth + 0.01);
    this.shadow.setPosition(x, y + 3);

    if (this.flashT > 0) {
      this.bodyImg.setTintFill(0xffffff);
      this.elemImg.setTintFill(0xffffff);
    } else if (this.frozenT > 0) {
      this.bodyImg.setTint(0xa8e6ff);
      this.elemImg.setTint(0xe8fbff);
    } else {
      this.bodyImg.clearTint();
      this.elemImg.setTint(this.elementTint);
    }
    this.drawHud();
  }

  private diamond(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number) {
    g.fillPoints(
      [
        { x, y: y - r },
        { x: x + r, y },
        { x, y: y + r },
        { x: x - r, y },
      ],
      true,
    );
  }

  /** 머리 위: 부착 원소 아이콘(+남은 시간), 중첩 점, 잔여 상태, 적 HP */
  protected drawHud(): void {
    const g = this.hud;
    g.clear();
    const x = this.phys.x;
    const top = this.phys.y - 24;
    const es = this.es;

    if (this.team === 'enemy' && this.hpShownT > 0) {
      const w = 16;
      g.fillStyle(hex('0'), 0.9);
      g.fillRect(x - w / 2 - 1, top + 5, w + 2, 3);
      g.fillStyle(0xff5566);
      g.fillRect(x - w / 2, top + 6, w * (this.hp / this.maxHp), 1);
    }
    if (es.attached) {
      const c = ELEMENT_COLOR[es.attached];
      g.fillStyle(hex('0'));
      this.diamond(g, x, top, 4);
      g.fillStyle(c);
      this.diamond(g, x, top, 3);
      g.fillStyle(c, 0.8);
      g.fillRect(x - 4, top + 5 + (this.team === 'enemy' && this.hpShownT > 0 ? 3 : 0), 8 * (es.attachT / es.attachMax), 1);
    }
    if (es.stackCount > 0 && es.stackEl) {
      g.fillStyle(ELEMENT_COLOR[es.stackEl]);
      for (let k = 0; k < es.stackCount; k++) g.fillRect(x + 6 + k * 3, top - 1, 2, 2);
    }
    if (es.residue) {
      g.lineStyle(1, RESIDUE_COLOR[es.residue] ?? 0xffffff, 0.6 + 0.4 * Math.sin(this.s.gameTime * 20));
      g.strokeRect(x - 10, top - 2, 4, 4);
    }
    if (this.stunT > 0) {
      const a = this.s.gameTime * 10;
      g.fillStyle(hex('k'));
      g.fillRect(x + Math.cos(a) * 6, top + 2 + Math.sin(a) * 2, 2, 2);
      g.fillRect(x - Math.cos(a) * 6, top + 2 - Math.sin(a) * 2, 2, 2);
    }
  }
}
