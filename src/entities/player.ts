import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { Actor } from './actor';
import { ELEMENTS, ELEMENT_NAME, type Element } from '../element/types';
import { ELEMENT_COLOR, ELEMENT_LIGHT } from '../art/palette';
import { RULES } from '../element/data';
import type { HitInfo, HitResult } from '../combat/damage';
import { basicAttack, skillAttack, SKILL_COOLDOWN, type Payload } from '../combat/attacks';
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

type Keys = Record<'W' | 'A' | 'S' | 'D' | 'SPACE' | 'ONE' | 'TWO' | 'THREE' | 'FOUR', Phaser.Input.Keyboard.Key>;

export class Player extends Actor {
  element: Element = 'fire';
  switchCd = 0;
  readonly skillCd: Record<Element, number> = { fire: 0, water: 0, wind: 0, lightning: 0 };
  attackCd = 0;
  lockT = 0;
  comboStep = 0;
  comboT = 0;

  rollMax = 2;
  rollCharges = 2;
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
  /** 전환 직후 첫 공격 강화 */
  empowered = false;
  /** 완벽 회피로 빼앗은 원소 → 다음 공격 1회에 추가로 실림 */
  absorbed: Element | null = null;

  aimX = 0;
  aimY = 0;
  aimAngle = 0;
  private trailT = 0;
  private readonly keys: Keys;
  private readonly aura: Phaser.GameObjects.Graphics;

  constructor(s: RoomScene, group: Phaser.Physics.Arcade.Group, x: number, y: number) {
    super(s, group, x, y, 'player_body', 'player_elem', 5, 100, 'player', ELEMENT_COLOR.fire);
    this.keys = s.input.keyboard!.addKeys('W,A,S,D,SPACE,ONE,TWO,THREE,FOUR') as Keys;
    this.aura = s.add.graphics().setDepth(3);
  }

  get rolling(): boolean {
    return this.rollT > 0;
  }

  update(dt: number): void {
    this.baseUpdate(dt);
    if (this.dead) return;

    this.switchCd = Math.max(0, this.switchCd - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.lockT = Math.max(0, this.lockT - dt);
    this.hurtInvulnT = Math.max(0, this.hurtInvulnT - dt);
    for (const el of ELEMENTS) this.skillCd[el] = Math.max(0, this.skillCd[el] - dt);
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
    this.aimAngle = Math.atan2(aim.y - (this.y - 4), aim.x - this.x);

    const k = this.keys;
    const mx = (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0);
    const my = (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0);
    const mlen = Math.hypot(mx, my) || 1;

    if (this.disabled) {
      this.rollT = 0;
      this.dashT = 0;
      this.squashX = this.squashY = 1;
      this.move(0, 0, dt);
      return;
    }

    // 원소 전환 1/2/3/4
    const swKeys = [k.ONE, k.TWO, k.THREE, k.FOUR];
    swKeys.forEach((key, i) => {
      if (Phaser.Input.Keyboard.JustDown(key)) this.trySwitch(ELEMENTS[i]);
    });

    // 구르기
    if (Phaser.Input.Keyboard.JustDown(k.SPACE) && this.rollCharges > 0 && this.rollT <= 0 && this.dashT <= 0) {
      if (mx !== 0 || my !== 0) this.rollDir.set(mx / mlen, my / mlen);
      else this.rollDir.set(Math.cos(this.aimAngle), Math.sin(this.aimAngle));
      this.rollCharges--;
      this.rollT = ROLL_TIME;
      this.rollStart = this.s.gameTime;
      this.perfectThisRoll = false;
      this.comboStep = 0;
      playSfx('roll');
    }

    // 공격
    const ptr = this.s.input.activePointer;
    if (this.rollT <= 0 && this.dashT <= 0) {
      if (ptr.rightButtonDown() && this.skillCd[this.element] <= 0) {
        this.skillCd[this.element] = SKILL_COOLDOWN[this.element];
        skillAttack(this.s, this, this.makePayload());
        this.attackCd = Math.max(this.attackCd, 0.15);
      } else if (ptr.leftButtonDown() && this.attackCd <= 0) {
        const t = basicAttack(this.s, this, this.makePayload());
        this.attackCd = t.cooldown;
        this.lockT = t.lock;
      }
    }

    // 이동
    let vx: number;
    let vy: number;
    if (this.rollT > 0) {
      this.rollT -= dt;
      vx = this.rollDir.x * ROLL_SPEED;
      vy = this.rollDir.y * ROLL_SPEED;
      const p = 1 - this.rollT / ROLL_TIME;
      // 스쿼시·스트레치: 시작은 납작, 끝은 길쭉
      this.squashX = p < 0.3 ? 1.25 : p > 0.75 ? 0.85 : 1.05;
      this.squashY = p < 0.3 ? 0.75 : p > 0.75 ? 1.18 : 0.95;
      this.facing = this.rollDir.x < 0 ? -1 : this.rollDir.x > 0 ? 1 : this.facing;
      this.trail(dt, ELEMENT_LIGHT[this.element]);
      if (this.rollT <= 0) this.squashX = this.squashY = 1;
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      vx = this.dashDir.x * DASH_SPEED;
      vy = this.dashDir.y * DASH_SPEED;
      this.trail(dt, ELEMENT_COLOR.fire);
      this.s.terrain.applyElement(this.x, this.y, 6, 'fire');
      this.s.vfx.burst(this.x, this.y - 4, ELEMENT_COLOR.fire, 2);
      for (const t of this.s.combat.inCircle(this.x, this.y, 12, 'enemy')) {
        if (this.dashHit.has(t)) continue;
        this.dashHit.add(t);
        this.onDashHit?.(t);
      }
      this.squashX = 1.3;
      this.squashY = 0.8;
      if (this.dashT <= 0) this.squashX = this.squashY = 1;
    } else {
      const sp = SPEED * (this.lockT > 0 ? 0.4 : 1);
      vx = (mx / mlen) * sp;
      vy = (my / mlen) * sp;
      this.facing = this.aimX < this.x ? -1 : 1;
    }
    this.move(vx, vy, dt);
  }

  private trail(dt: number, color: number) {
    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.04; // 0.04초마다 반투명 잔상
      this.s.vfx.afterimage(this, color);
    }
  }

  trySwitch(el: Element): void {
    if (el === this.element || this.switchCd > 0) return;
    this.element = el;
    this.elementTint = ELEMENT_COLOR[el];
    this.switchCd = SWITCH_CD;
    this.empowered = true;
    this.comboStep = 0;
    this.s.vfx.ring(this.x, this.y - 4, 3, 22, ELEMENT_COLOR[el], 0.25, 2);
    this.s.vfx.burst(this.x, this.y - 4, ELEMENT_LIGHT[el], 10);
    playSfx('switch');
  }

  private makePayload(): Payload {
    const emp = this.empowered;
    const pay: Payload = {
      element: this.element,
      dmgMult: emp ? RULES.empoweredDamageMult : 1,
      attachDuration: RULES.attachDuration * (emp ? RULES.empoweredAttachMult : 1),
      extra: this.absorbed,
      empowered: emp,
    };
    this.empowered = false;
    this.absorbed = null;
    return pay;
  }

  lunge(strength: number): void {
    // 공격 전진: 조준 방향으로 살짝 밀기
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

  override incoming(h: HitInfo): HitResult | 'ok' {
    if (this.rollT > 0) {
      const sinceRoll = this.s.gameTime - this.rollStart;
      if (h.perfectDodgeable && h.element && sinceRoll <= PERFECT_WINDOW && !this.perfectThisRoll) {
        this.perfectThisRoll = true;
        this.onPerfectDodge(h.element);
        return 'perfect';
      }
      return 'dodged';
    }
    if (this.hurtInvulnT > 0 && !h.isReaction && !h.environmental) return 'ignored';
    if (!h.isReaction && !h.environmental && this.s.fields.inSteam(this.x, this.y) && Math.random() < 0.5) {
      this.s.vfx.floatText(this.x, this.y - 22, '회피', 0xe6eef5, 7, 0.5, 8);
      return 'dodged';
    }
    return 'ok';
  }

  private onPerfectDodge(el: Element): void {
    this.absorbed = el;
    const c = ELEMENT_COLOR[el];
    this.s.vfx.floatText(this.x, this.y - 24, `완벽 회피! +${ELEMENT_NAME[el]}`, c, 8, 0.9, 14, true);
    this.s.vfx.ring(this.x, this.y - 4, 2, 30, c, 0.3, 2);
    this.s.vfx.burst(this.x, this.y - 4, c, 16);
    this.s.hitstop.request(0.08);
    this.s.stats.perfectDodges++;
    playSfx('perfect');
  }

  override onDamaged(h: HitInfo, _dmg: number): void {
    if (h.isReaction || h.environmental) {
      this.hurtInvulnT = Math.max(this.hurtInvulnT, 0.05);
      return;
    }
    this.hurtInvulnT = HURT_INVULN;
    this.s.shake(0.15, 0.006);
    playSfx('hurt');
  }

  override die(): void {
    const x = this.x;
    const y = this.y;
    super.die();
    this.aura.destroy();
    // 사망 분해: 픽셀 파티클로 흩뿌림
    this.s.vfx.burst(x, y - 6, ELEMENT_COLOR[this.element], 30);
    this.s.vfx.burst(x, y - 6, 0x46518a, 20);
    this.s.vfx.burst(x, y - 6, 0xf2d3b3, 10);
    playSfx('death');
    this.s.onPlayerDeath();
  }

  override syncVisuals(): void {
    super.syncVisuals();
    if (this.dead) return;
    // 피격 무적 중 깜빡임
    const blink = this.hurtInvulnT > 0.06 && Math.floor(this.s.gameTime * 20) % 2 === 0;
    this.bodyImg.setAlpha(blink ? 0.4 : 1);
    this.elemImg.setAlpha(blink ? 0.4 : 1);

    const g = this.aura;
    g.clear();
    const t = this.s.gameTime;
    // 전환 강화 표시: 발밑 원소색 고리
    if (this.empowered) {
      g.lineStyle(1, ELEMENT_COLOR[this.element], 0.6 + 0.4 * Math.sin(t * 16));
      g.strokeEllipse(this.x, this.y + 2, 18, 7);
    }
    // 흡수한 원소: 몸 주위를 도는 구슬
    if (this.absorbed) {
      const a = t * 8;
      g.fillStyle(ELEMENT_COLOR[this.absorbed]);
      g.fillCircle(this.x + Math.cos(a) * 9, this.y - 8 + Math.sin(a) * 4, 2);
    }
    // 조준 표시
    g.fillStyle(0xffffff, 0.5);
    g.fillRect(this.x + Math.cos(this.aimAngle) * 14 - 1, this.y - 4 + Math.sin(this.aimAngle) * 14 - 1, 2, 2);
  }
}
