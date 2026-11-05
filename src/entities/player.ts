import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { Actor } from './actor';
import type { Element } from '../element/types';
import { ELEMENT_COLOR, ELEMENT_LIGHT, E32, scaleColor } from '../art/palette';
import type { HitInfo, HitResult } from '../combat/damage';
import { heroOriginY } from '../art/customArt';
import { HERO_ANIMS, HERO_ANCHORS, HERO_SOURCE, HERO_SPRING, type Dir } from '../art/heroSprites';
import { SpringChain } from './spring';
import { DEPTH } from '../config';
import { playSfx } from '../audio/sfx';

const SPEED = 105;
const ROLL_SPEED = 230;
const ROLL_TIME = 0.3; // 무적 0.3초
const ROLL_RECHARGE = 1.1;
const HURT_INVULN = 0.6;

type Keys = Record<'W' | 'A' | 'S' | 'D' | 'SPACE' | 'Q', Phaser.Input.Keyboard.Key>;
type SwingAnim = 'attack' | 'attack2' | 'cast';

export interface PlayerStats {
  maxHp: number;
  hp: number;
  atk: number;
  speed: number;
  rollMax: number;
  potions: number;
}

export class Player extends Actor {
  /** 망토 안감·장갑·검날(원소 레이어) 색. 원소 전환은 지금 없음 */
  element: Element = 'fire';
  lockT = 0;
  atkMult: number;
  speedMult: number;
  potions: number;

  rollMax: number;
  rollCharges: number;
  rollRecharge = 0;
  rollT = 0;
  private rollDir = new Phaser.Math.Vector2(0, 1);

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
  private trailT = 0;
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
    this.rollMax = st.rollMax;
    this.rollCharges = st.rollMax;
    this.potions = st.potions;
    this.keys = s.input.keyboard!.addKeys('W,A,S,D,SPACE,Q') as Keys;
    this.aura = s.add.graphics().setDepth(4);
    this.springBack = s.add.graphics();
    this.springFront = s.add.graphics();
    this.hair = new SpringChain(HERO_SPRING.count, 2, x, y - 20);
    this.ribbons = [new SpringChain(5, 2, x, y - 18, 0.84), new SpringChain(4, 2, x, y - 18, 0.8)];
    // 검날(원소 레이어)에만 은은한 글로우
    this.elemImg.preFX?.addGlow(ELEMENT_COLOR[element], 1.2, 0, false, 0.1, 4);
    this.play('idle_down');
  }

  get rolling(): boolean {
    return this.rollT > 0;
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
    if (this.rollCharges < this.rollMax) {
      this.rollRecharge += dt;
      if (this.rollRecharge >= ROLL_RECHARGE) {
        this.rollRecharge = 0;
        this.rollCharges++;
      }
    }

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
      this.rollT = 0;
      this.squashX = this.squashY = 1;
      this.move(0, 0, dt);
      this.pickAnim(false);
      return;
    }

    if (!locked) {
      if (Phaser.Input.Keyboard.JustDown(k.Q)) this.drinkPotion();
      if (Phaser.Input.Keyboard.JustDown(k.SPACE) && this.rollCharges > 0 && this.rollT <= 0) {
        if (mx !== 0 || my !== 0) this.rollDir.set(mx / mlen, my / mlen);
        else this.rollDir.set(Math.cos(this.aimAngle), Math.sin(this.aimAngle));
        this.rollCharges--;
        this.rollT = ROLL_TIME;
        this.actionT = 0;
        this.s.vfx.dust(this.x, this.y, 5);
        playSfx('roll');
      }
    }

    let vx: number;
    let vy: number;
    let moving = false;
    if (this.rollT > 0) {
      this.rollT -= dt;
      vx = this.rollDir.x * ROLL_SPEED;
      vy = this.rollDir.y * ROLL_SPEED;
      const p = 1 - this.rollT / ROLL_TIME;
      // 살짝 떠오르며 구름 → 그림자는 작아졌다 커짐
      const arc = Math.sin(Math.PI * Math.min(1, p * 1.15));
      this.hop = arc * 4;
      this.shadowScale = 1 - arc * 0.35;
      this.trail(dt, ELEMENT_LIGHT[this.element]);
      if (this.rollT <= 0) {
        this.hop = 0;
        this.shadowScale = 1;
        this.s.vfx.dust(this.x, this.y, 4);
      }
    } else {
      const sp = SPEED * this.speedMult * (this.lockT > 0 ? 0.4 : 1);
      vx = (mx / mlen) * sp;
      vy = (my / mlen) * sp;
      moving = mx !== 0 || my !== 0;
      if (moving) {
        this.stepT -= dt;
        if (this.stepT <= 0) {
          this.stepT = 0.26;
          this.s.vfx.dust(this.x, this.y, 1);
        }
      }
    }
    this.move(vx, vy, dt);
    this.pickAnim(moving);
  }

  /** 시약 던지기 동작 (시전 동작 재사용) */
  throwPose(): void {
    if (this.dead || this.rollT > 0) return;
    this.startAction('cast');
    this.lockT = Math.max(this.lockT, 0.08);
  }

  /** 화염방사: 시전 자세를 끝 프레임에서 유지 */
  firePose(): void {
    if (this.dead || this.rollT > 0) return;
    if (this.action !== 'cast' || this.actionT <= 0) this.startAction('cast');
    this.actionT = Math.max(this.actionT, 0.1);
  }

  private startAction(anim: SwingAnim) {
    this.action = anim;
    const key = `${anim}_${this.dirFor(this.aimAngle)}`;
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

  private pickAnim(moving: boolean) {
    if (this.rollT > 0) {
      this.dir = this.dirFor(Math.atan2(this.rollDir.y, this.rollDir.x));
      this.play(`roll_${this.dir}`);
      return;
    }
    this.dir = this.dirFor(this.aimAngle);
    if (this.hurtAnimT > 0) this.play(`hurt_${this.dir}`);
    else if (this.actionT > 0) this.play(`${this.action}_${this.dir}`);
    else this.play(`${moving ? 'run' : 'idle'}_${this.dir}`);
  }

  private trail(dt: number, color: number) {
    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.04;
      this.s.vfx.afterimage(this, color);
    }
  }

  heal(n: number): void {
    if (this.dead || n <= 0) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    if (this.hp - before >= 5) this.s.vfx.floatText(this.x, this.y - 26, `+${Math.round(this.hp - before)}`, 0x63c74d, 6, 0.7, 12);
  }

  refundRoll(): void {
    this.rollCharges = Math.min(this.rollMax, this.rollCharges + 1);
  }

  drinkPotion(): void {
    if (this.potions <= 0 || this.hp >= this.maxHp) return;
    this.potions--;
    this.heal(Math.round(this.maxHp * 0.35));
    this.s.vfx.ring(this.x, this.y - 6, 4, 20, 0x63c74d, 0.4, 2);
    this.s.vfx.spark(this.x, this.y - 8, 0x63c74d, 14, 40, 70);
    playSfx('heal');
  }

  override incoming(h: HitInfo): HitResult | 'ok' {
    if (this.rollT > 0) return 'dodged';
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
