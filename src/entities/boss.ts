import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { Actor } from './actor';
import { BOSS_ANIMS } from '../art/enemySprites';
import { C } from '../art/palette';
import { DATA, colorOf, type ReactionDef } from '../element/data';
import { ELEMENTS } from '../element/types';
import type { HitInfo, HitResult } from '../combat/damage';
import { DEPTH, WORLD_W, WORLD_H } from '../config';
import { playSfx } from '../audio/sfx';

type State =
  | 'intro'
  | 'walk'
  | 'slamWindup'
  | 'slamRecover'
  | 'lavaCast'
  | 'chargeWindup'
  | 'charge'
  | 'crashed'
  | 'burstWindup'
  | 'summon'
  | 'stagger'
  | 'transition';

/** 페이즈마다 실드를 깨는 반응이 바뀐다 → 공격 순서를 계속 바꿔야 함 */
const PHASE_SHIELD: Record<number, string> = { 1: 'vaporize', 2: 'freeze', 3: 'overload' };

interface Shockwave {
  x: number;
  y: number;
  r: number;
  max: number;
  hit: boolean;
}

/** 지역 1 보스: 잿불 골렘 */
export class Golem extends Actor {
  readonly displayName = '잿불 골렘';
  phase = 1;
  shieldReaction: string | null = PHASE_SHIELD[1];
  private shieldRegenT = 0;
  private state: State = 'intro';
  private stateT = 2.2;
  private patternCd = 1.5;
  private dir = new Phaser.Math.Vector2();
  private target = new Phaser.Math.Vector2();
  private chargeHit = false;
  private waves: Shockwave[] = [];
  private readonly warn: Phaser.GameObjects.Graphics;
  private minions = 0;

  constructor(s: RoomScene, group: Phaser.Physics.Arcade.Group, x: number, y: number, hpMult: number) {
    super(s, group, x, y, {
      sheet: 'golem',
      anims: BOSS_ANIMS,
      radius: 14,
      hp: Math.round(950 * hpMult),
      team: 'enemy',
      tint: C.fire1,
      originY: 58 / 64,
      height: 46,
      bigShadow: true,
      look: 'fire',
    });
    this.isBoss = true;
    this.phys.body.pushable = false;
    this.warn = s.add.graphics().setDepth(DEPTH.telegraph);
    this.play('idle');
    this.elementImmune = true;
  }

  get shieldDef(): ReactionDef | null {
    return this.shieldReaction ? DATA.primary.find((r) => r.id === this.shieldReaction) ?? null : null;
  }

  get staggered(): boolean {
    return this.state === 'stagger';
  }

  update(dt: number): void {
    this.baseUpdate(dt);
    if (this.dead) return;
    this.warn.clear();
    this.updateWaves(dt);
    const p = this.s.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    this.stateT -= dt;
    this.patternCd -= dt;
    if (!this.shieldReaction && this.state !== 'stagger' && this.state !== 'transition') {
      this.shieldRegenT -= dt;
      if (this.shieldRegenT <= 0) this.raiseShield();
    }

    // 페이즈 전환: HP 60%, 25%
    const want = this.hp <= this.maxHp * 0.25 ? 3 : this.hp <= this.maxHp * 0.6 ? 2 : 1;
    if (want > this.phase && this.state !== 'transition') {
      this.phase = want;
      this.setState('transition', 1.8);
      this.elementImmune = true;
      this.s.projectiles.clearTeam('enemy');
      this.s.banner(`${this.displayName} — ${this.phase}페이즈`, C.fire1);
      this.roar();
    }

    let vx = 0;
    let vy = 0;
    switch (this.state) {
      case 'intro':
        this.play('idle');
        if (this.stateT <= 0) {
          this.elementImmune = false;
          this.setState('walk', 0);
        }
        break;
      case 'walk': {
        this.play('walk');
        if (!p.dead && dist > 50) {
          vx = (dx / dist) * 32;
          vy = (dy / dist) * 32;
        }
        if (this.patternCd <= 0 && !p.dead) this.choosePattern(dist);
        break;
      }
      case 'slamWindup': {
        this.play('windup');
        const prog = 1 - this.stateT / 1.0;
        this.warn.lineStyle(1, C.fire1, 0.6 + 0.4 * Math.sin(prog * 40));
        this.warn.strokeEllipse(this.target.x, this.target.y, 84, 60);
        this.warn.fillStyle(C.fire1, 0.12 + 0.3 * prog);
        this.warn.fillEllipse(this.target.x, this.target.y, 84 * prog, 60 * prog);
        if (this.stateT <= 0) this.slam();
        break;
      }
      case 'slamRecover':
        this.play('slam');
        if (this.stateT <= 0) this.setState('walk', 0);
        break;
      case 'lavaCast':
        this.play('windup');
        if (this.stateT <= 0) this.setState('walk', 0);
        break;
      case 'chargeWindup': {
        this.play('windup');
        this.dir.set(dx / dist, dy / dist);
        if (this.stateT < 0.3) this.flash();
        const nx = -this.dir.y;
        const ny = this.dir.x;
        const len = 220;
        const w = 14;
        const pts = [
          { x: this.x + nx * w, y: this.y + ny * w },
          { x: this.x + this.dir.x * len + nx * w, y: this.y + this.dir.y * len + ny * w },
          { x: this.x + this.dir.x * len - nx * w, y: this.y + this.dir.y * len - ny * w },
          { x: this.x - nx * w, y: this.y - ny * w },
        ];
        this.warn.fillStyle(C.fire1, 0.12 + 0.25 * (1 - this.stateT / 0.9));
        this.warn.fillPoints(pts, true);
        this.warn.lineStyle(1, C.fire1, 0.8);
        this.warn.strokePoints(pts, true);
        if (this.stateT <= 0) {
          this.setState('charge', 1.2);
          this.chargeHit = false;
          playSfx('whoosh');
        }
        break;
      }
      case 'charge': {
        this.play('walk');
        this.animT += dt * 2;
        vx = this.dir.x * 270;
        vy = this.dir.y * 270;
        this.s.vfx.dust(this.x, this.y, 2);
        if (!this.chargeHit && !p.dead && dist < this.radius + p.radius + 6) {
          this.chargeHit = true;
          this.s.combat.hit(p, { damage: 20, element: 'fire', perfectDodgeable: true, knockback: 280, fromX: this.x, fromY: this.y });
        }
        const b = this.phys.body;
        if (b.blocked.left || b.blocked.right || b.blocked.up || b.blocked.down) {
          this.s.shake(0.3, 0.012);
          this.s.vfx.spark(this.x + this.dir.x * 14, this.y - 10, C.stone3, 30, 140, 120);
          this.s.vfx.floatText(this.x, this.y - this.height - 8, '벽에 충돌!', 0xfee761, 6, 0.9, 12, true);
          playSfx('slam');
          this.setState('crashed', 1.8);
        } else if (this.stateT <= 0) this.setState('walk', 0);
        break;
      }
      case 'crashed':
        this.play('stagger');
        if (this.stateT <= 0) this.setState('walk', 0);
        break;
      case 'burstWindup':
        this.play('windup');
        if (this.stateT < 0.25) this.flash();
        if (this.stateT <= 0) this.burst();
        break;
      case 'summon':
        this.play('windup');
        if (this.stateT <= 0) this.setState('walk', 0);
        break;
      case 'stagger':
        this.play('stagger');
        if (this.stateT <= 0) {
          this.setState('walk', 0);
          this.shieldRegenT = 7;
        }
        break;
      case 'transition':
        this.play('windup');
        if (this.stateT <= 0) {
          this.elementImmune = false;
          this.raiseShield();
          this.setState('walk', 0);
          this.patternCd = 0.6;
        }
        break;
    }
    if (Math.abs(dx) > 4 && this.state !== 'charge') this.facing = dx < 0 ? -1 : 1;
    this.move(vx, vy, dt);
  }

  private setState(s: State, t: number) {
    this.state = s;
    this.stateT = t;
    this.animT = 0;
  }

  private choosePattern(dist: number) {
    const opts: [string, number][] = [
      ['slam', dist < 90 ? 45 : 15],
      ['lava', 25],
      ['charge', dist > 80 ? 35 : 15],
    ];
    if (this.phase >= 2) {
      opts.push(['burst', 25]);
      if (this.minions < 2) opts.push(['summon', 15]);
    }
    const total = opts.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    let pick = 'slam';
    for (const [k, w] of opts) {
      r -= w;
      if (r <= 0) {
        pick = k;
        break;
      }
    }
    const p = this.s.player;
    this.patternCd = this.phase === 3 ? 1.3 : this.phase === 2 ? 1.7 : 2.1;
    playSfx('windup');
    if (pick === 'slam') {
      const d = Math.min(36, Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y));
      const a = Math.atan2(p.y - this.y, p.x - this.x);
      this.target.set(this.x + Math.cos(a) * d, this.y + Math.sin(a) * d);
      this.setState('slamWindup', 1.0);
    } else if (pick === 'lava') {
      const n = this.phase >= 3 ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const tx = Phaser.Math.Clamp(p.x + (i === 0 ? 0 : Phaser.Math.Between(-60, 60)), 24, WORLD_W - 24);
        const ty = Phaser.Math.Clamp(p.y + (i === 0 ? 0 : Phaser.Math.Between(-40, 40)), 40, WORLD_H - 24);
        this.s.vfx.telegraph(tx, ty, 22, C.fire1, 0.9);
        this.s.scheduler.after(0.9, () => {
          this.s.fields.spawn({
            x: tx,
            y: ty,
            radius: 22,
            duration: 5,
            tick: 0.5,
            damage: 5,
            attach: 'fire',
            noStack: true,
            affect: 'player',
            owner: 'enemy',
            kind: 'lava',
            color: C.fire1,
            terrainElement: 'fire',
          });
          this.s.vfx.spark(tx, ty, C.fire0, 10, 60, 80);
          playSfx('sizzle');
        });
      }
      this.setState('lavaCast', 0.9);
    } else if (pick === 'charge') {
      this.setState('chargeWindup', 0.9);
    } else if (pick === 'burst') {
      this.setState('burstWindup', 0.7);
    } else {
      for (let k = 0; k < 2; k++) {
        const a = Math.random() * Math.PI * 2;
        const x = this.x + Math.cos(a) * 30;
        const y = this.y + Math.sin(a) * 20;
        if (this.s.terrain.isBlocked(x, y, 5)) continue;
        const e = this.s.spawnEnemy('wisp', Phaser.Utils.Array.GetRandom([...ELEMENTS]), x, y, {});
        this.minions++;
        e.onDeathHook = () => (this.minions = Math.max(0, this.minions - 1));
      }
      this.setState('summon', 0.8);
    }
  }

  private slam() {
    const { x, y } = this.target;
    this.s.vfx.explosion(x, y, 42, C.fire1);
    this.s.shake(0.25, 0.012);
    this.s.hitstop.request(0.08);
    playSfx('slam');
    this.s.vfx.spark(x, y, C.stone3, 26, 120, 110);
    this.s.terrain.applyElement(x, y, 30, 'fire');
    const p = this.s.player;
    if (!p.dead && Phaser.Math.Distance.Between(x, y, p.x, p.y) <= 42 + p.radius) {
      this.s.combat.hit(p, { damage: 18, element: 'fire', perfectDodgeable: true, knockback: 240, fromX: x, fromY: y });
    }
    this.waves.push({ x, y, r: 20, max: this.phase >= 2 ? 170 : 130, hit: false });
    this.setState('slamRecover', 0.7);
  }

  private burst() {
    const rings = this.phase >= 3 ? 2 : 1;
    for (let k = 0; k < rings; k++) {
      this.s.scheduler.after(k * 0.35, () => {
        const n = 12;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + k * 0.26;
          this.s.projectiles.spawn({
            x: this.x,
            y: this.y - 20,
            vx: Math.cos(a) * 90,
            vy: Math.sin(a) * 90,
            radius: 3,
            life: 3,
            team: 'enemy',
            texture: 'orb',
            color: C.fire1,
            element: 'fire',
            hit: { damage: 7, element: 'fire', perfectDodgeable: true, knockback: 60 },
          });
        }
        playSfx('shoot');
      });
    }
    this.setState('slamRecover', 0.6);
  }

  /** 충격파 고리: 고리가 지나갈 때 플레이어가 고리 위에 있으면 피격 (구르기로 넘기) */
  private updateWaves(dt: number) {
    const p = this.s.player;
    for (const w of this.waves) {
      w.r += 190 * dt;
      const k = 1 - w.r / w.max;
      this.warn.lineStyle(3, C.fire1, Math.max(0, k));
      this.warn.strokeEllipse(w.x, w.y, w.r * 2, w.r * 1.5);
      this.warn.lineStyle(1, C.fire0, Math.max(0, k));
      this.warn.strokeEllipse(w.x, w.y, w.r * 2 - 4, w.r * 1.5 - 3);
      if (!w.hit && !p.dead) {
        const dx = (p.x - w.x) / 1;
        const dy = (p.y - w.y) / 0.75;
        const d = Math.hypot(dx, dy);
        if (Math.abs(d - w.r) < 6) {
          const res = this.s.combat.hit(p, { damage: 10, element: 'fire', perfectDodgeable: true, knockback: 160, fromX: w.x, fromY: w.y });
          if (res !== 'ignored') w.hit = true;
        }
      }
    }
    this.waves = this.waves.filter((w) => w.r < w.max);
  }

  private roar() {
    this.s.shake(0.6, 0.01);
    playSfx('roar');
    this.waves.push({ x: this.x, y: this.y, r: 10, max: 110, hit: false });
    this.s.lighting.flash(this.x, this.y, 200, C.fire1, 0.6);
  }

  private raiseShield() {
    this.shieldReaction = PHASE_SHIELD[this.phase];
    const def = this.shieldDef!;
    this.s.vfx.ring(this.x, this.y - 20, 6, 40, colorOf(def.color), 0.5, 2);
    this.s.vfx.floatText(this.x, this.y - this.height - 12, `실드 — ${def.name}로 파괴`, colorOf(def.color), 6, 1.2, 10, true);
    playSfx('shield');
  }

  override incoming(h: HitInfo): HitResult | 'ok' {
    if (this.state === 'transition' || this.state === 'intro') return 'ignored';
    return 'ok';
  }

  override damageTakenMult(): number {
    if (this.shieldReaction) return 0.08;
    if (this.state === 'stagger' || this.state === 'crashed') return 1.5;
    return 1;
  }

  override onReaction(def: ReactionDef): void {
    if (this.shieldReaction && def.id === this.shieldReaction) {
      this.shieldReaction = null;
      this.s.vfx.floatText(this.x, this.y - this.height - 14, '실드 파괴!', 0xffffff, 12, 1.2, 16, true);
      this.s.vfx.explosion(this.x, this.y - 20, 50, colorOf(def.color));
      this.s.hitstop.request(0.2);
      this.s.shake(0.3, 0.01);
      playSfx('shatter');
      this.setState('stagger', 4);
      this.warn.clear();
    }
  }

  override onDamaged(h: HitInfo, dmg: number): void {
    super.onDamaged(h, dmg);
    if (!h.environmental) this.s.vfx.spark(this.x, this.y - 24, C.stone3, 3, 60, 40);
  }

  override die(): void {
    this.warn.destroy();
    this.s.shake(0.8, 0.015);
    this.s.hitstop.request(0.4);
    playSfx('roar');
    super.die();
    this.s.onBossDefeated(this);
  }

  override syncVisuals(): void {
    super.syncVisuals();
    if (this.dead) return;
    const g = this.hud;
    const def = this.shieldDef;
    if (def && this.state !== 'transition') {
      const c = colorOf(def.color);
      const t = this.s.gameTime;
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + t * 0.4;
        pts.push({ x: this.x + Math.cos(a) * 30, y: this.y - 24 + Math.sin(a) * 30 });
      }
      g.lineStyle(1, c, 0.6 + 0.3 * Math.sin(t * 6));
      g.strokePoints(pts, true);
      g.fillStyle(c, 0.08);
      g.fillPoints(pts, true);
    }
    this.s.lighting.add(this.x, this.y - 24, 120, C.fire1, this.state === 'stagger' ? 0.3 : 0.65);
  }
}
