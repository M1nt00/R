import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { ElementState } from '../element/elementState';
import type { Team } from '../element/types';
import type { HitInfo, HitResult } from '../combat/damage';
import type { ReactionDef } from '../element/data';
import type { AnimDef } from '../art/heroSprites';
import { ELEMENT_COLOR, C } from '../art/palette';
import { RESIDUE_COLOR } from '../element/data';
import { DEPTH } from '../config';

export interface ActorOpts {
  sheet: string;
  anims: Record<string, AnimDef>;
  radius: number;
  hp: number;
  team: Team;
  tint: number;
  /** 스프라이트 프레임에서 발밑 위치 비율 */
  originY: number;
  /** 머리 위 표시 높이 */
  height: number;
  bigShadow?: boolean;
}

/**
 * 플레이어·적 공통. 물리 바디(보이지 않음) + 본체 레이어 + 원소 레이어(setTint) 2장 구조.
 * 프레임 애니메이션은 게임 시간으로 직접 돌려서 히트스탑 때 같이 멈춘다.
 */
export abstract class Actor {
  readonly phys: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  readonly bodyImg: Phaser.GameObjects.Image;
  readonly elemImg: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  readonly hud: Phaser.GameObjects.Graphics;
  readonly team: Team;
  readonly radius: number;
  readonly height: number;
  protected readonly anims: Record<string, AnimDef>;

  hp: number;
  maxHp: number;
  readonly es = new ElementState();
  dead = false;
  isBoss = false;
  elementImmune = false;
  lastHit: HitInfo | null = null;

  readonly impulse = new Phaser.Math.Vector2();
  readonly push = new Phaser.Math.Vector2();

  frozenT = 0;
  stunT = 0;
  slowT = 0;
  slowFactor = 1;
  flashT = 0;
  onIce = false;
  terrainTickT = 0;
  hpShownT = 0;
  spawnT = 0;
  wallSlamT = 0;

  facing = 1;
  squashX = 1;
  squashY = 1;
  elementTint: number;
  protected animName = '';
  protected animT = 0;
  private readonly animPhase = Math.random() * 10;

  protected constructor(
    readonly s: RoomScene,
    group: Phaser.Physics.Arcade.Group,
    x: number,
    y: number,
    o: ActorOpts,
  ) {
    this.team = o.team;
    this.radius = o.radius;
    this.height = o.height;
    this.anims = o.anims;
    this.hp = o.hp;
    this.maxHp = o.hp;
    this.elementTint = o.tint;
    this.phys = group.create(x, y, 'px') as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    this.phys.setVisible(false);
    this.phys.body.setCircle(o.radius, 1 - o.radius, 1 - o.radius);
    this.phys.setCollideWorldBounds(true);
    this.shadow = s.add.image(x, y, o.bigShadow ? 'shadow_big' : 'shadow').setDepth(DEPTH.shadow);
    this.bodyImg = s.add.image(x, y, `${o.sheet}_body`, '0').setOrigin(0.5, o.originY);
    this.elemImg = s.add.image(x, y, `${o.sheet}_elem`, '0').setOrigin(0.5, o.originY).setTint(o.tint);
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

  play(name: string, restart = false): void {
    if (!this.anims[name]) return;
    if (this.animName !== name || restart) {
      this.animName = name;
      this.animT = 0;
    }
  }

  get animDone(): boolean {
    const a = this.anims[this.animName];
    return !a || (!a.loop && this.animT * a.fps >= a.count);
  }

  protected baseUpdate(dt: number): void {
    this.es.update(dt);
    if (!this.disabled) this.animT += dt;
    if (this.frozenT > 0) this.frozenT -= dt;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slowFactor = 1;
    }
    if (this.flashT > 0) this.flashT -= dt;
    if (this.hpShownT > 0) this.hpShownT -= dt;
    if (this.spawnT > 0) this.spawnT -= dt;
    if (this.wallSlamT > 0) {
      this.wallSlamT -= dt;
      const b = this.phys.body;
      if (b && (b.blocked.left || b.blocked.right || b.blocked.up || b.blocked.down) && this.impulse.length() > 90) {
        this.wallSlamT = 0;
        this.s.onWallSlam(this);
      }
    }
  }

  protected move(vx: number, vy: number, dt: number): void {
    if (this.dead) return;
    const ctrl = this.disabled || this.spawnT > 0 ? 0 : this.slowT > 0 ? this.slowFactor : 1;
    const tx = vx * ctrl + this.impulse.x + this.push.x;
    const ty = vy * ctrl + this.impulse.y + this.push.y;
    const body = this.phys.body;
    if (this.onIce) {
      const k = 1 - Math.exp(-2.5 * dt);
      body.setVelocity(body.velocity.x + (tx - body.velocity.x) * k, body.velocity.y + (ty - body.velocity.y) * k);
    } else body.setVelocity(tx, ty);
    this.impulse.scale(Math.exp(-9 * dt));
    if (this.impulse.lengthSq() < 1) this.impulse.set(0, 0);
    this.push.set(0, 0);
  }

  knock(dx: number, dy: number, strength: number): void {
    let m = this.isBoss ? 0.15 : 1;
    if (this.frozenT > 0) m *= 0.4;
    this.impulse.x += dx * strength * m;
    this.impulse.y += dy * strength * m;
  }

  armWallSlam(): void {
    this.wallSlamT = 0.6;
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

  incoming(_h: HitInfo): HitResult | 'ok' {
    return 'ok';
  }
  onDamaged(_h: HitInfo, _dmg: number): void {
    this.hpShownT = 3;
  }
  onReaction(_def: ReactionDef): void {}
  damageTakenMult(): number {
    return 1;
  }

  die(): void {
    this.dead = true;
    this.s.vfx.disintegrate(this, this.elementTint);
    this.s.vfx.glow(this.x, this.y - this.height / 2, this.height, this.elementTint, 0.35);
    this.destroyVisuals();
  }

  destroyVisuals(): void {
    this.phys.destroy();
    this.bodyImg.destroy();
    this.elemImg.destroy();
    this.shadow.destroy();
    this.hud.destroy();
  }

  /** 애니메이션 프레임 + 절차적 움직임(숨쉬기·바운스·스쿼시) + 색 처리 */
  syncVisuals(): void {
    if (this.dead) return;
    const a = this.anims[this.animName];
    if (a) {
      let idx = Math.floor(this.animT * a.fps);
      idx = a.loop ? idx % a.count : Math.min(idx, a.count - 1);
      const f = String(a.start + idx);
      this.bodyImg.setFrame(f);
      this.elemImg.setFrame(f);
    }
    const t = this.s.gameTime;
    let sx = this.squashX;
    let sy = this.squashY;
    if (!this.disabled && this.animName.startsWith('idle')) sy *= 1 + Math.sin(t * 3 + this.animPhase) * 0.025;
    if (this.spawnT > 0) {
      const k = 1 - this.spawnT / 0.45;
      sy *= Math.min(1, k * 1.3);
      sx *= 1 + (1 - k) * 0.4;
    }
    const x = this.phys.x;
    const y = this.phys.y;
    const depth = DEPTH.actor + y;
    this.bodyImg.setPosition(x, y).setScale(sx, sy).setFlipX(this.facing < 0).setDepth(depth);
    this.elemImg.setPosition(x, y).setScale(sx, sy).setFlipX(this.facing < 0).setDepth(depth + 0.01);
    this.shadow.setPosition(x, y + 1);

    if (this.flashT > 0) {
      this.bodyImg.setTintFill(0xffffff);
      this.elemImg.setTintFill(0xffffff);
    } else if (this.spawnT > 0) {
      this.bodyImg.setTintFill(this.elementTint);
      this.elemImg.setTintFill(0xffffff);
    } else if (this.frozenT > 0) {
      this.bodyImg.setTint(0xb0ecff);
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
    const x = Math.round(this.phys.x);
    const top = Math.round(this.phys.y - this.height - 6);
    const es = this.es;
    let barY = top + 6;

    if (this.team === 'enemy' && this.hpShownT > 0 && !this.isBoss) {
      const w = 16;
      g.fillStyle(C.out, 0.9);
      g.fillRect(x - w / 2 - 1, top + 5, w + 2, 3);
      g.fillStyle(C.blood);
      g.fillRect(x - w / 2, top + 6, Math.ceil(w * (this.hp / this.maxHp)), 1);
      barY += 3;
    }
    if (es.attached) {
      const c = ELEMENT_COLOR[es.attached];
      g.fillStyle(C.out);
      this.diamond(g, x, top, 4);
      g.fillStyle(c);
      this.diamond(g, x, top, 3);
      g.fillStyle(0xffffff, 0.8);
      g.fillRect(x - 1, top - 2, 1, 1);
      g.fillStyle(c, 0.85);
      g.fillRect(x - 4, barY, Math.ceil(8 * (es.attachT / es.attachMax)), 1);
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
      g.fillStyle(C.light0);
      g.fillRect(x + Math.cos(a) * 6, top + 3 + Math.sin(a) * 2, 2, 2);
      g.fillRect(x - Math.cos(a) * 6, top + 3 - Math.sin(a) * 2, 2, 2);
    }
  }
}
