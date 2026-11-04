import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { Actor } from './actor';
import type { Element } from '../element/types';
import { ELEMENTS } from '../element/types';
import { ELEMENT_COLOR, ELEMENT_LIGHT, toCss } from '../art/palette';
import enemiesJson from '../data/enemies.json';
import { DATA, colorOf, type ReactionDef } from '../element/data';
import type { HitInfo, HitResult } from '../combat/damage';
import { ENEMY_ANIMS } from '../art/enemySprites';
import type { AnimDef } from '../art/heroSprites';
import { DEPTH, FONT, RENDER_SCALE } from '../config';
import { playSfx } from '../audio/sfx';

export type EnemyKind = 'charger' | 'shooter' | 'bomber' | 'shielder' | 'summoner' | 'wisp';
export const ENEMY_KINDS: EnemyKind[] = ['charger', 'shooter', 'bomber', 'shielder', 'summoner'];

export interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  radius: number;
  gold: number;
  cost: number;
  attack: {
    range: number;
    windup: number;
    damage?: number;
    knockback?: number;
    cooldown?: number;
    duration?: number;
    lungeSpeed?: number;
    keepDistance?: number;
    projectileSpeed?: number;
    radius?: number;
    turnRate?: number;
    summonCount?: number;
    maxMinions?: number;
  };
}

export const ENEMY_DEFS = enemiesJson as unknown as Record<EnemyKind, EnemyDef>;

export type EliteMod = 'swift' | 'giant' | 'dual' | 'split' | 'shield';
export const ELITE_MODS: EliteMod[] = ['swift', 'giant', 'dual', 'split', 'shield'];
export const ELITE_NAME: Record<EliteMod, string> = {
  swift: '신속',
  giant: '거대화',
  dual: '이중 원소',
  split: '분열',
  shield: '원소 실드',
};

const WISP_ANIMS: Record<string, AnimDef> = Object.fromEntries(
  ['idle', 'walk', 'windup', 'attack', 'hurt'].map((k) => [k, { start: 0, count: 4, fps: 10, loop: true }]),
);

export interface EnemyOpts {
  elite?: EliteMod;
  hpMult?: number;
  dmgMult?: number;
  small?: boolean;
  owner?: Enemy;
}

type AiState = 'chase' | 'windup' | 'attack' | 'recover';

/**
 * 일반 적 = 행동 유형 × 원소. 원소는 원소 레이어 색으로만 구분.
 * 적의 공격에 맞으면 플레이어에게도 그 원소가 부착된다.
 */
export class Enemy extends Actor {
  readonly def: EnemyDef;
  readonly elite: EliteMod | null;
  readonly element2: Element | null;
  readonly small: boolean;
  readonly owner: Enemy | null;
  shieldReaction: string | null = null;
  minions = 0;
  onDeathHook: (() => void) | null = null;
  private readonly dmgMult: number;
  private readonly speedMult: number;
  private ai: AiState = 'chase';
  private aiT = 0;
  private atkCd: number;
  private dir = new Phaser.Math.Vector2(1, 0);
  private faceAngle = 0;
  private hitDone = false;
  private strafe = Math.random() < 0.5 ? -1 : 1;
  private wander = new Phaser.Math.Vector2();
  private wanderT = 0;
  private hurtT = 0;
  private readonly warn: Phaser.GameObjects.Graphics;
  private bombWarn: { cancel: () => void } | null = null;
  private tag: Phaser.GameObjects.Text | null = null;

  constructor(
    s: RoomScene,
    group: Phaser.Physics.Arcade.Group,
    readonly kind: EnemyKind,
    readonly element: Element,
    x: number,
    y: number,
    o: EnemyOpts = {},
  ) {
    const d = ENEMY_DEFS[kind];
    const giant = o.elite === 'giant';
    super(s, group, x, y, {
      sheet: kind,
      anims: kind === 'wisp' ? WISP_ANIMS : ENEMY_ANIMS,
      radius: Math.round(d.radius * (giant ? 1.35 : o.small ? 0.75 : 1)),
      hp: Math.round(d.hp * (o.hpMult ?? 1) * (o.elite ? 2.2 : 1) * (giant ? 1.4 : 1) * (o.small ? 0.4 : 1)),
      team: 'enemy',
      tint: ELEMENT_COLOR[element],
      originY: kind === 'wisp' ? 13 / 16 : 26.5 / 32,
      height: kind === 'wisp' ? 10 : giant ? 26 : 18,
    });
    this.def = d;
    this.elite = o.elite ?? null;
    this.small = o.small === true;
    this.owner = o.owner ?? null;
    this.dmgMult = (o.dmgMult ?? 1) * (giant ? 1.3 : 1);
    this.speedMult = o.elite === 'swift' ? 1.5 : 1;
    this.element2 = o.elite === 'dual' ? Phaser.Utils.Array.GetRandom(ELEMENTS.filter((e) => e !== element)) : null;
    if (o.elite === 'shield') this.shieldReaction = Phaser.Utils.Array.GetRandom(DATA.primary).id;
    this.atkCd = 0.8 + Math.random() * 0.8;
    this.warn = s.add.graphics().setDepth(DEPTH.telegraph);
    this.spawnT = 0.45;
    this.elementImmune = false;
    this.play('walk');
    if (giant) this.squashX = this.squashY = 1.35;
    if (o.small) this.squashX = this.squashY = 0.75;
    if (this.elite) {
      this.tag = s.add
        .text(x, y, ELITE_NAME[this.elite], { fontFamily: FONT, fontSize: '6px', color: '#ffe08a', stroke: '#0e0b14', strokeThickness: 2 })
        .setOrigin(0.5, 1)
        .setResolution(RENDER_SCALE)
        .setDepth(DEPTH.text - 1);
    }
  }

  get displayName(): string {
    return this.def.name;
  }

  update(dt: number): void {
    this.baseUpdate(dt);
    if (this.dead) return;
    this.warn.clear();
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.spawnT > 0) {
      this.move(0, 0, dt);
      return;
    }
    const p = this.s.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (this.disabled) {
      if (this.ai === 'windup' || this.ai === 'attack') this.cancelAttack();
      this.move(0, 0, dt);
      return;
    }

    const blinded = this.s.fields.inSteam(this.x, this.y);
    this.atkCd -= dt * (this.elite === 'swift' ? 1.4 : 1);
    const sp = this.def.speed * this.speedMult;
    const atk = this.def.attack;
    let vx = 0;
    let vy = 0;

    // 방패형은 천천히 돌아선다 (뒤로 돌면 공략 가능)
    const want = Math.atan2(dy, dx);
    if (this.kind === 'shielder') {
      const turn = (atk.turnRate ?? 2) * dt * (this.ai === 'chase' ? 1 : 0.3);
      this.faceAngle += Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(want - this.faceAngle), -turn, turn);
    } else this.faceAngle = want;

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
      } else if (this.kind === 'shooter' || this.kind === 'summoner') {
        const keep = atk.keepDistance ?? 100;
        const toward = dist > keep + 15 ? 1 : dist < keep - 15 ? -1 : 0;
        vx = (dx / dist) * sp * toward + (-dy / dist) * sp * 0.5 * this.strafe;
        vy = (dy / dist) * sp * toward + (dx / dist) * sp * 0.5 * this.strafe;
        const canSummon = this.kind !== 'summoner' || this.minions < (atk.maxMinions ?? 4);
        if (this.atkCd <= 0 && dist < atk.range && canSummon) this.beginWindup(dx / dist, dy / dist);
      } else if (this.kind === 'shielder') {
        vx = Math.cos(this.faceAngle) * sp;
        vy = Math.sin(this.faceAngle) * sp;
        if (dist < atk.range && this.atkCd <= 0 && Math.abs(Phaser.Math.Angle.Wrap(want - this.faceAngle)) < 0.5) {
          this.beginWindup(Math.cos(this.faceAngle), Math.sin(this.faceAngle));
        }
      } else {
        vx = (dx / dist) * sp;
        vy = (dy / dist) * sp;
        if (dist < atk.range && (this.kind === 'bomber' || this.atkCd <= 0)) this.beginWindup(dx / dist, dy / dist);
      }
      if (this.strafe && Math.random() < dt * 0.3) this.strafe *= -1;
    } else if (this.ai === 'windup') {
      this.aiT -= dt;
      const prog = 1 - this.aiT / Math.max(0.01, atk.windup);
      this.drawTelegraph(prog);
      if (this.kind === 'shooter' && this.aiT > 0.2) this.dir.set(dx / dist, dy / dist);
      if (this.kind === 'bomber' && Math.floor(this.aiT * (prog > 0.6 ? 20 : 8)) % 2 === 0) this.flash();
      if (this.aiT <= 0) this.release();
    } else if (this.ai === 'attack') {
      this.aiT -= dt;
      const ls = atk.lungeSpeed ?? 220;
      vx = this.dir.x * ls;
      vy = this.dir.y * ls;
      if (!this.hitDone && !p.dead && Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y) < this.radius + p.radius + 6) {
        this.hitDone = true;
        this.hitPlayer(atk.damage ?? 10, atk.knockback ?? 150);
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

    // 위습: 몸통 박치기
    if (this.kind === 'wisp' && this.ai === 'chase' && this.atkCd <= 0 && !p.dead && dist < this.radius + p.radius + 6) {
      this.hitPlayer(atk.damage ?? 5, atk.knockback ?? 60);
      this.atkCd = atk.cooldown ?? 0.9;
      this.impulse.set((-dx / dist) * 160, (-dy / dist) * 160);
    }

    if (Math.abs(vx) > 1) this.facing = vx < 0 ? -1 : 1;
    if (this.ai !== 'chase') this.facing = Math.cos(this.faceAngle) < 0 ? -1 : 1;
    if (this.kind === 'shielder') this.facing = Math.cos(this.faceAngle) < 0 ? -1 : 1;
    this.move(vx, vy, dt);

    if (this.hurtT > 0) this.play('hurt');
    else if (this.ai === 'windup') this.play('windup');
    else if (this.ai === 'attack') this.play('attack');
    else this.play(Math.hypot(vx, vy) > 5 ? 'walk' : 'idle');
  }

  private hitPlayer(dmg: number, kb: number) {
    this.s.combat.hit(this.s.player, {
      damage: dmg * this.dmgMult,
      element: this.element,
      extra: this.element2,
      perfectDodgeable: true,
      knockback: kb,
      fromX: this.x,
      fromY: this.y,
    });
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
    if (this.kind === 'charger' || this.kind === 'shielder') {
      const len = this.kind === 'charger' ? 54 : 40;
      const w = this.kind === 'charger' ? 6 : 9;
      const nx = -this.dir.y;
      const ny = this.dir.x;
      const x0 = this.x;
      const y0 = this.y;
      const x1 = x0 + this.dir.x * len;
      const y1 = y0 + this.dir.y * len;
      g.fillStyle(c, 0.1 + 0.3 * prog);
      g.fillPoints(
        [
          { x: x0 + nx * w, y: y0 + ny * w },
          { x: x1 + nx * w, y: y1 + ny * w },
          { x: x1 - nx * w, y: y1 - ny * w },
          { x: x0 - nx * w, y: y0 - ny * w },
        ],
        true,
      );
      g.lineStyle(1, c, 0.5 + 0.5 * prog);
      g.strokePoints(
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
      g.lineStyle(1, c, 0.2 + 0.6 * prog);
      g.lineBetween(this.x, this.y - 6, this.x + this.dir.x * 170, this.y - 6 + this.dir.y * 170);
    } else if (this.kind === 'summoner') {
      for (let k = 0; k < 2; k++) {
        const a = (k / 2) * Math.PI * 2 + prog * 6;
        g.lineStyle(1, c, prog);
        g.strokeCircle(this.x + Math.cos(a) * 16, this.y + Math.sin(a) * 8, 4 * prog + 1);
      }
    }
  }

  private release() {
    const atk = this.def.attack;
    if (this.kind === 'charger' || this.kind === 'shielder') {
      this.ai = 'attack';
      this.aiT = atk.duration ?? 0.22;
      this.hitDone = false;
      this.s.vfx.dust(this.x, this.y, 4);
      playSfx('whoosh');
      return;
    }
    if (this.kind === 'shooter') {
      const sp = atk.projectileSpeed ?? 120;
      this.s.projectiles.spawn({
        x: this.x + this.dir.x * 8,
        y: this.y - 8 + this.dir.y * 8,
        vx: this.dir.x * sp,
        vy: this.dir.y * sp,
        radius: 3,
        life: 2.4,
        team: 'enemy',
        texture: 'orb',
        color: ELEMENT_COLOR[this.element],
        element: this.element,
        hit: {
          damage: (atk.damage ?? 8) * this.dmgMult,
          element: this.element,
          extra: this.element2,
          perfectDodgeable: true,
          knockback: atk.knockback,
        },
      });
      playSfx('shoot');
      this.ai = 'recover';
      this.aiT = 0.3;
      this.atkCd = (atk.cooldown ?? 2) + Math.random() * 0.8;
      return;
    }
    if (this.kind === 'summoner') {
      const n = Math.min(atk.summonCount ?? 2, (atk.maxMinions ?? 4) - this.minions);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const x = this.x + Math.cos(a) * 16;
        const y = this.y + Math.sin(a) * 10;
        if (this.s.terrain.isBlocked(x, y, 4)) continue;
        this.s.spawnEnemy('wisp', this.element, x, y, { owner: this });
        this.minions++;
      }
      this.s.vfx.ring(this.x, this.y, 4, 26, ELEMENT_COLOR[this.element], 0.35, 2);
      playSfx('spawn');
      this.ai = 'recover';
      this.aiT = 0.5;
      this.atkCd = atk.cooldown ?? 4.8;
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
      this.s.combat.hit(p, {
        damage: (atk.damage ?? 16) * this.dmgMult,
        element: this.element,
        extra: this.element2,
        perfectDodgeable: true,
        knockback: atk.knockback,
        fromX: x,
        fromY: y,
      });
    }
    for (const e of this.s.enemies) {
      if (e !== this && !e.dead && Phaser.Math.Distance.Between(x, y, e.x, e.y) <= r + e.radius) {
        this.s.engine.apply(e, this.element, { noStack: true });
      }
    }
    this.s.terrain.applyElement(x, y, r * 0.7, this.element);
    this.die(true);
  }

  // ───── 방패형 정면 방어 / 엘리트 실드 ─────
  override incoming(h: HitInfo): HitResult | 'ok' {
    if (this.spawnT > 0) return 'ignored';
    if (this.kind === 'shielder' && !h.isReaction && !h.environmental && !h.fromAbove && h.fromX !== undefined && h.fromY !== undefined) {
      const from = Math.atan2(h.fromY - this.y, h.fromX - this.x);
      if (Math.abs(Phaser.Math.Angle.Wrap(from - this.faceAngle)) < 1.2) {
        this.s.vfx.floatText(this.x, this.y - this.height - 4, '막힘', 0xc2bad6, 6, 0.4, 8);
        this.s.vfx.spark(this.x + Math.cos(this.faceAngle) * 8, this.y - 8, 0xffffff, 6, 60, 40);
        playSfx('block');
        return 'blocked';
      }
    }
    return 'ok';
  }

  override damageTakenMult(): number {
    return this.shieldReaction ? 0.15 : 1;
  }

  override onReaction(def: ReactionDef): void {
    if (this.shieldReaction && def.id === this.shieldReaction) {
      this.shieldReaction = null;
      this.s.vfx.floatText(this.x, this.y - this.height - 10, '실드 파괴!', 0xffffff, 6, 0.9, 14, true);
      this.s.vfx.explosion(this.x, this.y - 6, 24, colorOf(def.color));
      this.stun(1.2);
      playSfx('shatter');
    }
  }

  override onDamaged(h: HitInfo, dmg: number): void {
    super.onDamaged(h, dmg);
    if (!h.environmental) {
      this.hurtT = 0.12;
      this.s.vfx.spark(this.x, this.y - 8, h.color ?? 0xffffff, 4, 60, 40);
      playSfx('hit');
    }
  }

  override die(exploded = false): void {
    const x = this.x;
    const y = this.y;
    this.bombWarn?.cancel();
    this.warn.destroy();
    this.tag?.destroy();
    super.die();
    this.s.vfx.scorch(x, y, 0.5, 0.35);
    if (this.owner) this.owner.minions = Math.max(0, this.owner.minions - 1);
    this.onDeathHook?.();
    this.s.onEnemyDeath(this, exploded);
    if (!exploded) playSfx('death');
  }

  override syncVisuals(): void {
    super.syncVisuals();
    if (this.dead) return;
    if (this.tag) this.tag.setPosition(Math.round(this.x), Math.round(this.y - this.height - 10));
    const g = this.hud;
    const t = this.s.gameTime;
    if (this.elite) {
      g.lineStyle(1, 0xffe08a, 0.5 + 0.3 * Math.sin(t * 6));
      g.strokeEllipse(this.x, this.y + 1, this.radius * 3.4, this.radius * 1.6);
    }
    if (this.shieldReaction) {
      const def = DATA.primary.find((r) => r.id === this.shieldReaction)!;
      const c = colorOf(def.color);
      g.lineStyle(1, c, 0.7 + 0.3 * Math.sin(t * 8));
      const r = this.height * 0.75;
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + t * 0.5;
        pts.push({ x: this.x + Math.cos(a) * r, y: this.y - this.height / 2 + Math.sin(a) * r });
      }
      g.strokePoints(pts, true);
      g.fillStyle(c, 0.12);
      g.fillPoints(pts, true);
      if (this.tag) this.tag.setText(`실드: ${def.name}`).setColor(toCss(c));
    } else if (this.tag && this.elite === 'shield') this.tag.setText(ELITE_NAME.shield).setColor('#ffe08a');
    if (this.element2) {
      g.fillStyle(ELEMENT_COLOR[this.element2]);
      g.fillRect(Math.round(this.x) + 6, Math.round(this.y - this.height - 2), 2, 2);
    }
    if (this.kind === 'wisp' || this.kind === 'summoner' || (this.kind === 'bomber' && this.ai === 'windup')) {
      this.s.lighting.add(this.x, this.y - 6, this.kind === 'wisp' ? 22 : 30, ELEMENT_LIGHT[this.element], 0.5);
    }
    if (this.kind === 'summoner') {
      for (let k = 0; k < 3; k++) {
        const a = t * 2 + (k / 3) * Math.PI * 2;
        g.fillStyle(ELEMENT_COLOR[this.element], 0.9);
        g.fillRect(Math.round(this.x + Math.cos(a) * 12), Math.round(this.y - 10 + Math.sin(a) * 5), 2, 2);
      }
    }
  }

  static pickElite(): EliteMod {
    return Phaser.Utils.Array.GetRandom(ELITE_MODS);
  }
}
