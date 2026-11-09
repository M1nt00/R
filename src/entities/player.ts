import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { Actor } from './actor';
import type { Element } from '../element/types';
import { ELEMENT_COLOR, scaleColor } from '../art/palette';
import type { HitInfo, HitResult } from '../combat/damage';
import { heroOriginY } from '../art/customArt';
import { HERO_ANIMS, HERO_ANCHORS, HERO_SOURCE, HERO_SPRING, type Dir } from '../art/heroSprites';
import { SpringChain } from './spring';
import { DEPTH } from '../config';
import { playSfx } from '../audio/sfx';

const SPEED = 105;
const HURT_INVULN = 0.6;

type Keys = Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
type SwingAnim = 'attack' | 'attack2' | 'cast';

export interface PlayerStats {
  maxHp: number;
  hp: number;
  atk: number;
  speed: number;
}

export class Player extends Actor {
  /** 망토 안감·장갑·검날(원소 레이어) 색. 원소 전환은 지금 없음 */
  element: Element = 'fire';
  lockT = 0;
  atkMult: number;
  speedMult: number;

  hurtInvulnT = 0;
  private hurtAnimT = 0;
  private actionT = 0;
  private action: SwingAnim = 'attack';
  private dir: Dir = 'down';
  private stepT = 0;
  private deathT = 0;

  aimX = 0;
  aimY = 0;
  aimAngle = Math.PI / 2;
  private readonly keys: Keys;
  private readonly aura: Phaser.GameObjects.Graphics;
  private readonly springBack: Phaser.GameObjects.Graphics;
  private readonly springFront: Phaser.GameObjects.Graphics;
  private readonly hair: SpringChain;
  private readonly ribbons: SpringChain[];
  private lastDt = 1 / 60;
  inputLocked = false;

  constructor(s: RoomScene, group: Phaser.Physics.Arcade.Group, x: number, y: number, st: PlayerStats, element: Element) {
    super(s, group, x, y, {
      sheet: 'hero',
      anims: HERO_ANIMS,
      radius: 5,
      hp: st.maxHp,
      team: 'player',
      tint: ELEMENT_COLOR[element],
      originY: heroOriginY(),
      height: 20,
      look: 'raw',
    });
    this.elemTint = ELEMENT_COLOR[element];
    this.hp = st.hp;
    this.element = element;
    this.atkMult = st.atk;
    this.speedMult = st.speed;
    this.keys = s.input.keyboard!.addKeys('W,A,S,D') as Keys;
    this.aura = s.add.graphics().setDepth(4);
    this.springBack = s.add.graphics();
    this.springFront = s.add.graphics();
    this.hair = new SpringChain(HERO_SPRING.count, 2, x, y - 20);
    this.ribbons = [new SpringChain(5, 2, x, y - 18, 0.84), new SpringChain(4, 2, x, y - 18, 0.8)];
    // 검날(원소 레이어)에만 은은한 글로우
    this.elemImg.preFX?.addGlow(ELEMENT_COLOR[element], 1.2, 0, false, 0.1, 4);
    this.play('idle_down');
  }

  update(dt: number): void {
    this.lastDt = dt;
    if (this.dead) {
      this.updateDeath(dt);
      return;
    }
    this.baseUpdate(dt);
    this.lockT = Math.max(0, this.lockT - dt);
    this.hurtInvulnT = Math.max(0, this.hurtInvulnT - dt);
    this.hurtAnimT = Math.max(0, this.hurtAnimT - dt);
    this.actionT = Math.max(0, this.actionT - dt);

    const aim = this.s.pointerWorld();
    this.aimX = aim.x;
    this.aimY = aim.y;
    this.aimAngle = Math.atan2(aim.y - (this.y - 8), aim.x - this.x);

    const k = this.keys;
    const locked = this.inputLocked;
    const mx = locked ? 0 : (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0);
    const my = locked ? 0 : (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0);
    const mlen = Math.hypot(mx, my) || 1;

    if (this.disabled) {
      this.squashX = this.squashY = 1;
      this.move(0, 0, dt);
      this.pickAnim(false);
      return;
    }

    const sp = SPEED * this.speedMult * (this.lockT > 0 ? 0.4 : 1);
    const moving = mx !== 0 || my !== 0;
    if (moving) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.26;
        this.s.vfx.dust(this.x, this.y, 1);
      }
    }
    this.move((mx / mlen) * sp, (my / mlen) * sp, dt);
    this.pickAnim(moving);
  }

  /** 시약 던지기 동작 (시전 동작 재사용) */
  throwPose(): void {
    if (this.dead) return;
    this.startAction('cast');
    this.lockT = Math.max(this.lockT, 0.08);
  }

  private startAction(anim: SwingAnim) {
    this.action = anim;
    const key = this.animKey(anim, this.dirFor(this.aimAngle));
    this.actionT = HERO_ANIMS[key].durs.reduce((a, b) => a + b, 0);
    this.play(key, true);
  }

  private dirFor(angle: number): Dir {
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    if (Math.abs(ax) >= Math.abs(ay) * 0.9) {
      this.facing = ax < 0 ? -1 : 1;
      return 'side';
    }
    return ay > 0 ? 'down' : 'up';
  }

  /** 왼쪽 옆모습 그림이 따로 있으면 그걸 쓰고, 없으면 오른쪽 그림을 뒤집는다 (actor.ts) */
  private animKey(anim: string, dir: Dir): string {
    return dir === 'side' && this.facing < 0 && HERO_SOURCE.left ? `${anim}_left` : `${anim}_${dir}`;
  }

  private pickAnim(moving: boolean) {
    this.dir = this.dirFor(this.aimAngle);
    if (this.hurtAnimT > 0) this.play(this.animKey('hurt', this.dir));
    else if (this.actionT > 0) this.play(this.animKey(this.action, this.dir));
    else this.play(this.animKey(moving ? 'run' : 'idle', this.dir));
  }

  heal(n: number): void {
    if (this.dead || n <= 0) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    if (this.hp - before >= 5) this.s.vfx.floatText(this.x, this.y - 26, `+${Math.round(this.hp - before)}`, 0x63c74d, 6, 0.7, 12);
  }

  override incoming(h: HitInfo): HitResult | 'ok' {
    if (this.hurtInvulnT > 0 && !h.isReaction && !h.environmental) return 'ignored';
    return 'ok';
  }

  override onDamaged(h: HitInfo, _dmg: number): void {
    if (h.isReaction || h.environmental) {
      this.hurtInvulnT = Math.max(this.hurtInvulnT, 0.05);
      return;
    }
    this.hurtInvulnT = HURT_INVULN;
    this.hurtAnimT = 0.2;
    this.s.shake(0.15, 0.006);
    this.s.vfx.spark(this.x, this.y - 10, 0xf6757a, 8, 60, 60);
    this.s.vfx.splat(this.x, this.y, 0x3e2731, 3, 4);
    playSfx('hurt');
  }

  override die(): void {
    this.dead = true;
    this.deathT = 0.9;
    this.phys.body.stop();
    this.aura.clear();
    this.play('death_down', true);
    this.s.hitstop.request(0.25);
    playSfx('death');
    this.s.onPlayerDeath();
  }

  private updateDeath(dt: number) {
    if (this.deathT <= 0) return;
    this.animT += dt;
    this.deathT -= dt;
    if (this.deathT <= 0) {
      this.s.vfx.disintegrate(this, this.elementTint);
      this.s.vfx.glow(this.x, this.y - 10, 30, this.elementTint, 0.5);
      this.aura.destroy();
      this.springBack.destroy();
      this.springFront.destroy();
      this.destroyVisuals();
    }
  }

  /** 포니테일·리본: 프레임별 앵커에 매달린 스프링을 몸 앞/뒤에 그린다 */
  private drawSprings(frame: number) {
    const an = HERO_ANCHORS[frame];
    if (!an || HERO_SOURCE.custom) {
      this.springBack.clear();
      this.springFront.clear();
      return;
    }
    const img = this.bodyImg;
    const flip = img.flipX;
    const toWorld = (c: number, r: number): [number, number] => [
      img.x + (flip ? 15 - c : c - 16) + 0.5,
      img.y - 27 + r + 0.5,
    ];
    const [hx, hy] = toWorld(an.hair[0], an.hair[1]);
    const [bx, by] = toWorld(an.band[0], an.band[1]);
    const dt = Math.min(this.lastDt, 1 / 30);
    const t = this.s.gameTime;
    // 바라보는 반대쪽으로 살짝 날림 + 미세한 바람
    const away = this.facing * -60;
    const wind = Math.sin(t * 3.1) * 25;
    this.hair.update(hx, hy, dt, away * 0.6 + wind * 0.4, HERO_SPRING.gravity);
    this.ribbons[0].update(bx, by, dt, away + wind, 300 + Math.sin(t * 7) * 60);
    this.ribbons[1].update(bx, by + 1, dt, away * 0.8 - wind * 0.5, 340 + Math.cos(t * 6) * 60);
    const tint = this.elemTint ?? ELEMENT_COLOR[this.element];
    const ramp = [tint, scaleColor(tint, 0.85), scaleColor(tint, 0.65), scaleColor(tint, 0.35)];
    const depth = DEPTH.actor + Math.round(this.y);
    const back = this.springBack.setDepth(depth - 0.2);
    const front = this.springFront.setDepth(depth + 0.02);
    back.clear();
    front.clear();
    const gHair = an.front ? front : back;
    const gBand = (an.bandFront ?? an.front) ? front : back;
    this.hair.draw(gHair, HERO_SPRING.colors, HERO_SPRING.widths, HERO_SPRING.outline);
    this.ribbons[0].draw(gBand, [ramp[1], ramp[1], ramp[2], ramp[2]], [1], ramp[3]);
    this.ribbons[1].draw(gBand, [ramp[1], ramp[2], ramp[2]], [1], ramp[3]);
  }

  override syncVisuals(): void {
    if (this.dead) {
      if (this.deathT > 0) {
        const a = this.anims[this.animName];
        const idx = this.frameIndex(a, this.animT);
        this.bodyImg.setFrame(String(a.start + idx)).setScale(1).clearTint().setAlpha(1);
        this.elemImg.setFrame(String(a.start + idx)).setScale(1);
        this.hud.clear();
        this.drawSprings(a.start + idx);
      }
      return;
    }
    super.syncVisuals();
    const blink = this.hurtInvulnT > 0.06 && Math.floor(this.s.gameTime * 20) % 2 === 0;
    this.bodyImg.setAlpha(blink ? 0.4 : 1);
    this.elemImg.setAlpha(blink ? 0.4 : 1);
    this.springBack.setAlpha(blink ? 0.4 : 1);
    this.springFront.setAlpha(blink ? 0.4 : 1);
    this.drawSprings(Number(this.bodyImg.frame.name));

    const g = this.aura;
    g.clear();
    // 조준 표시 (발밑 원 위의 점)
    g.fillStyle(0xffffff, 0.55);
    g.fillRect(Math.round(this.x + Math.cos(this.aimAngle) * 14) - 1, Math.round(this.y - 4 + Math.sin(this.aimAngle) * 10) - 1, 2, 2);
    // 플레이어 주변 빛
    this.s.lighting.add(this.x, this.y - 8, 95, 0xffffff, 0.75);
    this.s.lighting.add(this.x, this.y - 8, 40, ELEMENT_COLOR[this.element], 0.5);
  }
}
