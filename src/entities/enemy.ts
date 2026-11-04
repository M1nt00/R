import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { Actor } from './actor';
import type { Element } from '../element/types';
import { ELEMENT_COLOR, ELEMENT_LIGHT } from '../art/palette';
import enemiesJson from '../data/enemies.json';
import { DEPTH } from '../config';
import { playSfx } from '../audio/sfx';

export type EnemyKind = 'charger' | 'shooter' | 'bomber';
export const ENEMY_KINDS: EnemyKind[] = ['charger', 'shooter', 'bomber'];

interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  radius: number;
  attack: {
    range: number;
    windup: number;
    damage: number;
    knockback: number;
    cooldown?: number;
    duration?: number;
    lungeSpeed?: number;
    keepDistance?: number;
    projectileSpeed?: number;
    radius?: number;
  };
}

export const ENEMY_DEFS = enemiesJson as unknown as Record<EnemyKind, EnemyDef>;

type AiState = 'chase' | 'windup' | 'attack' | 'recover';

/**
 * 일반 적 = 행동 유형 × 원소. 원소는 원소 레이어 색으로만 구분.
 * 적의 공격에 맞으면 플레이어에게도 그 원소가 부착된다.
 */
export class Enemy extends Actor {
  readonly def: EnemyDef;
  private ai: AiState = 'chase';
  private aiT = 0;
  private atkCd: number;
  private dir = new Phaser.Math.Vector2(1, 0);
  private hitDone = false;
  private strafe = Math.random() < 0.5 ? -1 : 1;
  private wander = new Phaser.Math.Vector2();
  private wanderT = 0;
  private readonly warn: Phaser.GameObjects.Graphics;
  private bombWarn: { cancel: () => void } | null = null;

  constructor(
    s: RoomScene,
    group: Phaser.Physics.Arcade.Group,
    readonly kind: EnemyKind,
    readonly element: Element,
    x: number,
    y: number,
  ) {
    super(s, group, x, y, `enemy_${kind}_body`, `enemy_${kind}_elem`, ENEMY_DEFS[kind].radius, ENEMY_DEFS[kind].hp, 'enemy', ELEMENT_COLOR[element]);
    this.def = ENEMY_DEFS[kind];
    this.atkCd = 0.8 + Math.random() * 0.8;
    this.warn = s.add.graphics().setDepth(DEPTH.telegraph);
  }

  update(dt: number): void {
    this.baseUpdate(dt);
    if (this.dead) return;
    this.warn.clear();
    const p = this.s.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (this.disabled) {
      // 빙결·기절은 공격을 끊는다 (위기 탈출 수단)
      if (this.ai === 'windup' || this.ai === 'attack') this.cancelAttack();
      this.move(0, 0, dt);
      return;
    }

    const blinded = this.s.fields.inSteam(this.x, this.y);
    this.atkCd -= dt;
    const sp = this.def.speed;
    const atk = this.def.attack;
    let vx = 0;
    let vy = 0;

    if (this.ai === 'chase') {
      if (blinded || p.dead) {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 0.8;
          const a = Math.random() * Math.PI * 2;
          this.wander.set(Math.cos(a), Math.sin(a));
        }
        vx = this.wander.x * sp * 0.5;
        vy = this.wander.y * sp * 0.5;
      } else if (this.kind === 'shooter') {
        const keep = atk.keepDistance ?? 95;
        const toward = dist > keep + 15 ? 1 : dist < keep - 15 ? -1 : 0;
        vx = (dx / dist) * sp * toward + (-dy / dist) * sp * 0.5 * this.strafe;
        vy = (dy / dist) * sp * toward + (dx / dist) * sp * 0.5 * this.strafe;
        if (this.atkCd <= 0 && dist < atk.range) this.beginWindup(dx / dist, dy / dist);
      } else {
        vx = (dx / dist) * sp;
        vy = (dy / dist) * sp;
        if (dist < atk.range && (this.kind === 'bomber' || this.atkCd <= 0)) this.beginWindup(dx / dist, dy / dist);
      }
      this.facing = dx < 0 ? -1 : 1;
    } else if (this.ai === 'windup') {
      this.aiT -= dt;
      const prog = 1 - this.aiT / atk.windup;
      this.drawTelegraph(prog);
      if (this.kind === 'shooter' && this.aiT > 0.2) this.dir.set(dx / dist, dy / dist); // 마지막 0.2초는 조준 고정
      if (this.kind === 'bomber' && Math.floor(this.aiT * (prog > 0.6 ? 20 : 8)) % 2 === 0) this.flash();
      if (this.aiT <= 0) this.release();
    } else if (this.ai === 'attack') {
      this.aiT -= dt;
      const ls = atk.lungeSpeed ?? 220;
      vx = this.dir.x * ls;
      vy = this.dir.y * ls;
      if (!this.hitDone && !p.dead && Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y) < this.radius + p.radius + 5) {
        this.hitDone = true;
        this.s.combat.hit(p, {
          damage: atk.damage,
          element: this.element,
          perfectDodgeable: true,
          knockback: atk.knockback,
          fromX: this.x,
          fromY: this.y,
        });
      }
      if (this.aiT <= 0) {
        this.ai = 'recover';
        this.aiT = 0.55;
        this.atkCd = atk.cooldown ?? 1.3;
      }
    } else if (this.ai === 'recover') {
      this.aiT -= dt;
      if (this.aiT <= 0) this.ai = 'chase';
    }

    this.move(vx, vy, dt);
  }

  private beginWindup(nx: number, ny: number) {
    this.ai = 'windup';
    this.aiT = this.def.attack.windup;
    this.dir.set(nx, ny);
    if (this.kind === 'bomber') {
      this.bombWarn = this.s.vfx.telegraph(this.x, this.y, this.def.attack.radius ?? 34, ELEMENT_COLOR[this.element], this.def.attack.windup);
    }
    playSfx('windup');
  }

  private cancelAttack() {
    this.ai = 'recover';
    this.aiT = 0.3;
    this.atkCd = Math.max(this.atkCd, 0.6);
    this.bombWarn?.cancel();
    this.bombWarn = null;
  }

  private drawTelegraph(prog: number) {
    const g = this.warn;
    const c = ELEMENT_COLOR[this.element];
    if (this.kind === 'charger') {
      const len = 52;
      const w = 6;
      const nx = -this.dir.y;
      const ny = this.dir.x;
      const x0 = this.x;
      const y0 = this.y;
      const x1 = x0 + this.dir.x * len;
      const y1 = y0 + this.dir.y * len;
      g.fillStyle(c, 0.12 + 0.3 * prog);
      g.fillPoints(
        [
          { x: x0 + nx * w, y: y0 + ny * w },
          { x: x1 + nx * w, y: y1 + ny * w },
          { x: x1 - nx * w, y: y1 - ny * w },
          { x: x0 - nx * w, y: y0 - ny * w },
        ],
        true,
      );
      if (prog > 0.85) this.flash();
    } else if (this.kind === 'shooter') {
      g.lineStyle(1, c, 0.25 + 0.5 * prog);
      g.lineBetween(this.x, this.y - 4, this.x + this.dir.x * 160, this.y - 4 + this.dir.y * 160);
      g.fillStyle(ELEMENT_LIGHT[this.element], 0.9);
      g.fillCircle(this.x + this.facing * 8, this.y - 14, 1 + prog * 2);
    }
  }

  private release() {
    const atk = this.def.attack;
    if (this.kind === 'charger') {
      this.ai = 'attack';
      this.aiT = atk.duration ?? 0.22;
      this.hitDone = false;
      playSfx('whoosh');
      return;
    }
    if (this.kind === 'shooter') {
      const sp = atk.projectileSpeed ?? 120;
      this.s.projectiles.spawn({
        x: this.x + this.dir.x * 6,
        y: this.y - 4 + this.dir.y * 6,
        vx: this.dir.x * sp,
        vy: this.dir.y * sp,
        radius: 3,
        life: 2.4,
        team: 'enemy',
        texture: 'orb',
        color: ELEMENT_COLOR[this.element],
        element: this.element,
        hit: { damage: atk.damage, element: this.element, perfectDodgeable: true, knockback: atk.knockback },
      });
      playSfx('shoot');
      this.ai = 'recover';
      this.aiT = 0.3;
      this.atkCd = (atk.cooldown ?? 2) + Math.random() * 0.8;
      return;
    }
    // 자폭형: 자기 원소로 폭발. 근처 적에게도 원소가 묻는다 (역이용 가능)
    this.bombWarn = null;
    const r = atk.radius ?? 34;
    const c = ELEMENT_COLOR[this.element];
    const x = this.x;
    const y = this.y;
    this.s.vfx.explosion(x, y, r, c);
    this.s.shake(0.12, 0.006);
    playSfx('boom');
    const p = this.s.player;
    if (!p.dead && Phaser.Math.Distance.Between(x, y, p.x, p.y) <= r + p.radius) {
      this.s.combat.hit(p, { damage: atk.damage, element: this.element, perfectDodgeable: true, knockback: atk.knockback, fromX: x, fromY: y });
    }
    for (const e of this.s.enemies) {
      if (e !== this && !e.dead && Phaser.Math.Distance.Between(x, y, e.x, e.y) <= r + e.radius) {
        this.s.engine.apply(e, this.element, { noStack: true });
      }
    }
    this.s.terrain.applyElement(x, y, r * 0.7, this.element);
    this.die(true);
  }

  override die(exploded = false): void {
    const x = this.x;
    const y = this.y;
    this.bombWarn?.cancel();
    this.warn.destroy();
    super.die();
    this.s.vfx.burst(x, y - 6, ELEMENT_COLOR[this.element], 16);
    this.s.vfx.burst(x, y - 6, 0x8a94aa, 12);
    if (!exploded) {
      this.s.stats.kills++;
      playSfx('death');
    }
  }
}
