import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { ElementState } from '../element/elementState';
import type { Team } from '../element/types';
import type { HitInfo, HitResult } from '../combat/damage';
import type { ReactionDef } from '../element/data';
import type { AnimDef } from '../art/heroSprites';
import { ELEMENT_COLOR, C, E32, type LookName } from '../art/palette';
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
  /** 원소 레이어 모양 (원소별로 구운 텍스처) */
  look?: LookName;
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
  readonly sheet: string;
  protected readonly anims: Record<string, AnimDef>;
  /** 구르기 등으로 몸이 뜨는 높이 (그림자는 바닥에 남음) */
  hop = 0;
  shadowScale = 1;
  look: LookName = 'neutral';
  /** 원소 레이어를 흰색으로 두고 색을 입힐 때 (null이면 구운 색 그대로) */
  elemTint: number | null = null;

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
    this.sheet = o.sheet;
    this.hp = o.hp;
    this.maxHp = o.hp;
    this.elementTint = o.tint;
    this.phys = group.create(x, y, 'px') as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
    this.phys.setVisible(false);
    this.phys.body.setCircle(o.radius, 1 - o.radius, 1 - o.radius);
    this.phys.setCollideWorldBounds(true);
    this.shadow = s.add.image(x, y, o.bigShadow ? 'shadow_big' : 'shadow', '0').setDepth(DEPTH.shadow).setAlpha(0.45);
    this.bodyImg = s.add.image(x, y, `${o.sheet}_body`, '0').setOrigin(0.5, o.originY);
    this.elemImg = s.add.image(x, y, `${o.sheet}_elem`, '0').setOrigin(0.5, o.originY);
    this.setLook(o.look ?? 'neutral');
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

  /** 원소 레이어를 그 원소 색 램프로 구운 텍스처로 바꿔 끼운다 */
  setLook(look: LookName): void {
    this.look = look;
    const key = look === 'neutral' ? `${this.sheet}_elem` : `${this.sheet}_elem_${look}`;
    const k = this.s.textures.exists(key) ? key : `${this.sheet}_elem`;
    this.elemImg.setTexture(k, this.elemImg.frame?.name ?? '0');
  }

  /** 지금 재생 중인 프레임 번호 (프레임별 시간을 누적해서 계산) */
  protected frameIndex(a: AnimDef, t: number): number {
    const total = a.durs.reduce((x, y) => x + y, 0);
    let tt = a.loop ? t % total : Math.min(t, total - 1e-6);
    for (let i = 0; i < a.count; i++) {
      if (tt < a.durs[i]) return i;
      tt -= a.durs[i];
    }
    return a.count - 1;
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
    return !a || (!a.loop && this.animT >= a.durs.reduce((x, y) => x + y, 0));
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
      const f = String(a.start + this.frameIndex(a, this.animT));
      this.bodyImg.setFrame(f);
      this.elemImg.setFrame(f);
    }
    const sx = this.squashX;
    const sy = this.squashY;
    // 등장: 크기를 바꾸지 않고 아래에서부터 드러냄 (스케일 대신 크롭 → 픽셀 유지)
    if (this.spawnT > 0) {
      const k = Math.min(1, (1 - this.spawnT / 0.45) * 1.2);
      const fh = this.bodyImg.frame.height;
      const vis = Math.round(fh * k);
      this.bodyImg.setCrop(0, fh - vis, this.bodyImg.frame.width, vis);
      this.elemImg.setCrop(0, fh - vis, this.elemImg.frame.width, vis);
    } else if (this.bodyImg.isCropped) {
      this.bodyImg.setCrop();
      this.elemImg.setCrop();
    }
    const x = Math.round(this.phys.x);
    const y = Math.round(this.phys.y);
    const depth = DEPTH.actor + y;
    const vy = y - Math.round(this.hop);
    this.bodyImg.setPosition(x, vy).setScale(sx, sy).setFlipX(this.facing < 0).setDepth(depth);
    this.elemImg.setPosition(x, vy).setScale(sx, sy).setFlipX(this.facing < 0).setDepth(depth + 0.01);
    // 빛이 왼쪽 위 → 그림자는 오른쪽 아래로 살짝
    this.shadow.setPosition(x + 1, y + 1).setScale(this.shadowScale);

    if (this.flashT > 0) {
      this.bodyImg.setTintFill(E32.white);
      this.elemImg.setTintFill(E32.white);
    } else if (this.spawnT > 0) {
      this.bodyImg.setTintFill(this.elementTint);
      this.elemImg.setTintFill(E32.white);
    } else if (this.frozenT > 0) {
      this.bodyImg.setTint(E32.silver);
      this.elemImg.setTint(E32.silver);
    } else {
      this.bodyImg.clearTint();
      if (this.elemTint !== null) this.elemImg.setTint(this.elemTint);
      else this.elemImg.clearTint();
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
