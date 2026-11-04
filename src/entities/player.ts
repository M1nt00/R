import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { Actor } from './actor';
import { ELEMENTS, ELEMENT_NAME, type Element } from '../element/types';
import { ELEMENT_COLOR, ELEMENT_LIGHT, C, E32, SELOUT, mixColor, scaleColor } from '../art/palette';
import { RULES } from '../element/data';
import type { HitInfo, HitResult } from '../combat/damage';
import { basicAttack, skillAttack, SKILL_COOLDOWN, type Payload, type SwingAnim } from '../combat/attacks';
import { heroOriginY } from '../art/customArt';
import { HERO_ANIMS, HERO_ANCHORS, HERO_SOURCE, HERO_SPRING, type Dir } from '../art/heroSprites';
import { SpringChain } from './spring';
import { DEPTH } from '../config';
import { playSfx } from '../audio/sfx';

const SPEED = 105;
const ROLL_SPEED = 230;
const ROLL_TIME = 0.3; // 무적 0.3초
const ROLL_RECHARGE = 1.1;
const SWITCH_CD = 0.5; // 전환 쿨다운 (전체 공용)
const PERFECT_WINDOW = 0.15;
const DASH_SPEED = 440;
const DASH_TIME = 0.16;
const HURT_INVULN = 0.6;

type Keys = Record<'W' | 'A' | 'S' | 'D' | 'SPACE' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'Q', Phaser.Input.Keyboard.Key>;

export interface PlayerStats {
  maxHp: number;
  hp: number;
  atk: number;
  speed: number;
  rollMax: number;
  attach: number;
  potions: number;
}

export class Player extends Actor {
  element: Element = 'fire';
  switchCd = 0;
  readonly skillCd: Record<Element, number> = { fire: 0, water: 0, wind: 0, lightning: 0 };
  attackCd = 0;
  lockT = 0;
  comboStep = 0;
  comboT = 0;
  atkMult: number;
  speedMult: number;
  attachBase: number;
  potions: number;
  freeLightningT = 0;
  private boostT = 0;

  rollMax: number;
  rollCharges: number;
  rollRecharge = 0;
  rollT = 0;
  private rollStart = -99;
  private rollDir = new Phaser.Math.Vector2(0, 1);
  private perfectThisRoll = false;

  private dashT = 0;
  private dashDir = new Phaser.Math.Vector2();
  private dashHit = new Set<Actor>();
  private onDashHit: ((t: Actor) => void) | null = null;

  hurtInvulnT = 0;
  private hurtAnimT = 0;
  private actionT = 0;
  private action: SwingAnim = 'attack';
  private swingFlip = false;
  private dir: Dir = 'down';
  private stepT = 0;
  private deathT = 0;
  empowered = 0;
  absorbed: Element | null = null;

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
  private glowFx: { color: number } | null = null;
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
    this.attachBase = st.attach;
    this.potions = st.potions;
    this.keys = s.input.keyboard!.addKeys('W,A,S,D,SPACE,ONE,TWO,THREE,FOUR,Q') as Keys;
    this.aura = s.add.graphics().setDepth(4);
    this.springBack = s.add.graphics();
    this.springFront = s.add.graphics();
    this.hair = new SpringChain(HERO_SPRING.count, 2, x, y - 20);
    this.ribbons = [new SpringChain(5, 2, x, y - 18, 0.84), new SpringChain(4, 2, x, y - 18, 0.8)];
    // 검날(원소 레이어)에만 은은한 글로우
    const fx = this.elemImg.preFX?.addGlow(ELEMENT_COLOR[element], 1.2, 0, false, 0.1, 4);
    this.glowFx = fx ?? null;
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
    // 원소 색이 스르륵 바뀜 (약 0.25초)
    const target = ELEMENT_COLOR[this.element];
    if (this.elemTint !== target) {
      const k = 1 - Math.exp(-dt * 14);
      const next = mixColor(this.elemTint ?? target, target, k);
      this.elemTint = next === this.elemTint ? target : next;
      if (this.glowFx) this.glowFx.color = this.elemTint;
    }

    this.switchCd = Math.max(0, this.switchCd - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.lockT = Math.max(0, this.lockT - dt);
    this.hurtInvulnT = Math.max(0, this.hurtInvulnT - dt);
    this.hurtAnimT = Math.max(0, this.hurtAnimT - dt);
    this.actionT = Math.max(0, this.actionT - dt);
    this.boostT = Math.max(0, this.boostT - dt);
    this.freeLightningT = Math.max(0, this.freeLightningT - dt);
    for (const el of ELEMENTS) this.skillCd[el] = Math.max(0, this.skillCd[el] - dt);
    if (this.freeLightningT > 0) this.skillCd.lightning = Math.min(this.skillCd.lightning, 0.25);
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.comboStep = 0;
    }
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
      this.dashT = 0;
      this.squashX = this.squashY = 1;
      this.move(0, 0, dt);
      this.pickAnim(false);
      return;
    }

    if (!locked) {
      [k.ONE, k.TWO, k.THREE, k.FOUR].forEach((key, i) => {
        if (Phaser.Input.Keyboard.JustDown(key)) this.trySwitch(ELEMENTS[i]);
      });
      if (Phaser.Input.Keyboard.JustDown(k.Q)) this.drinkPotion();
      if (Phaser.Input.Keyboard.JustDown(k.SPACE) && this.rollCharges > 0 && this.rollT <= 0 && this.dashT <= 0) {
        if (mx !== 0 || my !== 0) this.rollDir.set(mx / mlen, my / mlen);
        else this.rollDir.set(Math.cos(this.aimAngle), Math.sin(this.aimAngle));
        this.rollCharges--;
        this.rollT = ROLL_TIME;
        this.rollStart = this.s.gameTime;
        this.perfectThisRoll = false;
        this.comboStep = 0;
        this.actionT = 0;
        this.s.vfx.dust(this.x, this.y, 5);
        playSfx('roll');
      }
      const ptr = this.s.input.activePointer;
      if (this.rollT <= 0 && this.dashT <= 0 && this.s.combatEnabled) {
        if (ptr.rightButtonDown() && this.skillCd[this.element] <= 0) {
          this.skillCd[this.element] = this.freeLightningT > 0 && this.element === 'lightning' ? 0.25 : SKILL_COOLDOWN[this.element];
          const anim = skillAttack(this.s, this, this.makePayload());
          this.startAction(anim);
          this.attackCd = Math.max(this.attackCd, 0.15);
        } else if (ptr.leftButtonDown() && this.attackCd <= 0) {
          const t = basicAttack(this.s, this, this.makePayload());
          this.attackCd = t.cooldown;
          this.lockT = t.lock;
          this.startAction(t.anim);
        }
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
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      vx = this.dashDir.x * DASH_SPEED;
      vy = this.dashDir.y * DASH_SPEED;
      this.trail(dt, ELEMENT_COLOR.fire);
      this.s.terrain.applyElement(this.x, this.y, 6, 'fire');
      this.s.vfx.spark(this.x, this.y, ELEMENT_COLOR.fire, 2, 30, 40);
      for (const t of this.s.combat.inCircle(this.x, this.y, 12, 'enemy')) {
        if (this.dashHit.has(t)) continue;
        this.dashHit.add(t);
        this.onDashHit?.(t);
      }

    } else {
      let sp = SPEED * this.speedMult * (this.lockT > 0 ? 0.4 : 1);
      if (this.boostT > 0) sp *= 1.3;
      if (this.s.engine.mods.flags.has('flames_speed') && this.s.fields.onFriendlyFlames(this.x, this.y)) sp *= 1.3;
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

  /** 내려베기 ↔ 올려베기 번갈아 */
  nextSwing(): SwingAnim {
    this.swingFlip = !this.swingFlip;
    return this.swingFlip ? 'attack' : 'attack2';
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
    if (this.dashT > 0) this.play(`attack_${this.dir}`);
    else if (this.hurtAnimT > 0) this.play(`hurt_${this.dir}`);
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

  trySwitch(el: Element): void {
    if (el === this.element || this.switchCd > 0) return;
    this.element = el;
    this.elementTint = ELEMENT_COLOR[el];

    this.switchCd = SWITCH_CD;
    this.empowered = this.s.engine.mods.relics.has('twin_hands') ? 2 : 1;
    if (this.s.engine.mods.relics.has('boots')) this.boostT = 2;
    this.comboStep = 0;
    this.s.vfx.ring(this.x, this.y - 2, 3, 22, ELEMENT_COLOR[el], 0.25, 2);
    this.s.vfx.spark(this.x, this.y - 8, ELEMENT_LIGHT[el], 10, 60, 60);
    this.s.vfx.glow(this.x, this.y - 10, 22, ELEMENT_COLOR[el], 0.25);
    this.s.lighting.flash(this.x, this.y, 80, ELEMENT_COLOR[el], 0.3);
    playSfx('switch');
  }

  private makePayload(): Payload {
    const emp = this.empowered > 0;
    const pay: Payload = {
      element: this.element,
      dmgMult: (emp ? RULES.empoweredDamageMult : 1) * this.atkMult,
      attachDuration: this.attachBase * (emp ? RULES.empoweredAttachMult : 1),
      extra: this.absorbed,
      empowered: emp,
    };
    if (this.empowered > 0) this.empowered--;
    this.absorbed = null;
    return pay;
  }

  lunge(strength: number): void {
    this.impulse.x += Math.cos(this.aimAngle) * strength;
    this.impulse.y += Math.sin(this.aimAngle) * strength;
  }

  startDash(angle: number, onHit: (t: Actor) => void): void {
    this.dashT = DASH_TIME;
    this.dashDir.set(Math.cos(angle), Math.sin(angle));
    this.dashHit.clear();
    this.onDashHit = onHit;
  }

  teleport(x: number, y: number): void {
    this.phys.body.reset(x, y);
    this.impulse.set(0, 0);
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
    if (this.rollT > 0) {
      const sinceRoll = this.s.gameTime - this.rollStart;
      const win = PERFECT_WINDOW * (this.s.engine.mods.relics.has('feather') ? 1.5 : 1);
      if (h.perfectDodgeable && h.element && sinceRoll <= win && !this.perfectThisRoll) {
        this.perfectThisRoll = true;
        this.onPerfectDodge(h.element);
        return 'perfect';
      }
      return 'dodged';
    }
    if (this.hurtInvulnT > 0 && !h.isReaction && !h.environmental) return 'ignored';
    if (!h.isReaction && !h.environmental && this.s.fields.inSteam(this.x, this.y) && Math.random() < 0.5) {
      this.s.vfx.floatText(this.x, this.y - 26, '회피', 0xffffff, 6, 0.5, 8);
      return 'dodged';
    }
    return 'ok';
  }

  private onPerfectDodge(el: Element): void {
    this.absorbed = el;
    const c = ELEMENT_COLOR[el];
    this.s.vfx.floatText(this.x, this.y - 30, `완벽 회피! +${ELEMENT_NAME[el]}`, c, 6, 0.9, 14, true);
    this.s.vfx.ring(this.x, this.y - 4, 2, 30, c, 0.3, 2);
    this.s.vfx.spark(this.x, this.y - 8, c, 16, 90, 70);
    this.s.vfx.glow(this.x, this.y - 8, 30, c, 0.35);
    this.s.hitstop.request(0.08);
    this.s.recordPerfect();
    playSfx('perfect');
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
    const t = this.s.gameTime;
    if (this.empowered > 0) {
      g.lineStyle(1, ELEMENT_COLOR[this.element], 0.6 + 0.4 * Math.sin(t * 16));
      g.strokeEllipse(this.x, this.y + 1, 18, 7);
    }
    if (this.absorbed) {
      const a = t * 8;
      g.fillStyle(ELEMENT_COLOR[this.absorbed]);
      g.fillCircle(this.x + Math.cos(a) * 9, this.y - 10 + Math.sin(a) * 4, 2);
    }
    // 조준 표시 (발밑 원 위의 점)
    g.fillStyle(0xffffff, 0.55);
    g.fillRect(Math.round(this.x + Math.cos(this.aimAngle) * 14) - 1, Math.round(this.y - 4 + Math.sin(this.aimAngle) * 10) - 1, 2, 2);
    // 플레이어 주변 빛
    this.s.lighting.add(this.x, this.y - 8, 95, 0xffffff, 0.75);
    this.s.lighting.add(this.x, this.y - 8, 40, ELEMENT_COLOR[this.element], 0.5);
  }
}
