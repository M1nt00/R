import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import type { Actor } from '../entities/actor';
import type { Element } from './types';
import { otherTeam } from './types';
import { DATA, RULES, colorOf, type EffectDef, type ReactionDef } from './data';
import type { HitInfo } from '../combat/damage';
import { computeMods, type Mods } from '../run/mods';
import { playSfx } from '../audio/sfx';

const pairKey = (a: Element, b: Element): string => [a, b].sort().join('+');

/** 공허의 파편: 중첩 반응도 잔여 상태를 남김 */
const STACK_RESIDUE: Record<string, string> = {
  scorch: 'overheat',
  drench: 'moist',
  gale: 'vortex',
  overcurrent: 'charged',
};

export interface ApplyOpts {
  attachDuration?: number;
  noStack?: boolean;
  fromX?: number;
  fromY?: number;
}

/**
 * 반응 판정을 한 곳에서 처리한다.
 * 플레이어·적 구분 없이 같은 규칙 → "적이 나한테 반응 걸기"도 추가 코드 없이 동작.
 * 플레이어가 적에게 일으킨 반응에만 반응 강화·유물 수정치가 붙는다.
 */
export class ReactionEngine {
  /** 해금된 2차 반응 id (허브 체험 모드면 전부) */
  secondaryUnlocked = new Set<string>();
  mods: Mods = computeMods(null);
  private frameCount = 0;
  private readonly primary = new Map<string, ReactionDef>();
  private readonly stack = new Map<Element, ReactionDef>();
  private readonly secondary = new Map<string, ReactionDef>();

  constructor(private readonly s: RoomScene) {
    for (const r of DATA.primary) this.primary.set(pairKey(r.inputs![0], r.inputs![1]), r);
    for (const r of DATA.stack) this.stack.set(r.element!, r);
    for (const r of DATA.secondary) this.secondary.set(`${r.residue}|${r.element}`, r);
  }

  beginFrame(): void {
    this.frameCount = 0;
  }

  get stackCount(): number {
    return this.mods.flags.has('stack_two') ? 2 : RULES.stackCount;
  }

  apply(target: Actor, el: Element, opts: ApplyOpts = {}): ReactionDef | null {
    if (target.dead || target.elementImmune) return null;
    const es = target.es;
    const canReact = this.frameCount < RULES.maxReactionsPerFrame;

    if (canReact && es.residue) {
      const def = this.secondary.get(`${es.residue}|${el}`);
      if (def && this.secondaryUnlocked.has(def.id)) {
        es.residue = null;
        es.residueT = 0;
        this.trigger(target, def, opts);
        return def;
      }
    }

    if (canReact && es.attached && es.attached !== el) {
      const def = this.primary.get(pairKey(es.attached, el));
      if (def) {
        es.clearAttached();
        es.resetStack();
        if (def.leaves) {
          es.residue = def.leaves;
          es.residueT = RULES.residueDuration;
        }
        this.trigger(target, def, opts);
        return def;
      }
    }

    es.attach(el, opts.attachDuration ?? RULES.attachDuration);
    // 피뢰침: 나에게 번개가 붙으면 주변 적 전부에게 번개
    if (el === 'lightning' && target.team === 'player' && this.mods.relics.has('lightning_rod')) {
      for (const e of this.s.combat.inCircle(target.x, target.y, 90, 'enemy')) {
        this.s.vfx.bolt(target.x, target.y - 10, e.x, e.y - 8, 0xffd447);
        this.apply(e, 'lightning', { noStack: true });
      }
    }
    if (!opts.noStack) {
      if (es.stackEl === el && es.stackT > 0) es.stackCount++;
      else {
        es.stackEl = el;
        es.stackCount = 1;
      }
      es.stackT = RULES.stackWindow;
      if (canReact && es.stackCount >= this.stackCount) {
        const def = this.stack.get(el)!;
        es.resetStack();
        es.clearAttached();
        if (this.mods.relics.has('void_shard') && target.team === 'enemy') {
          es.residue = STACK_RESIDUE[def.id];
          es.residueT = RULES.residueDuration;
        }
        this.trigger(target, def, opts);
        return def;
      }
    }
    return null;
  }

  private trigger(target: Actor, def: ReactionDef, opts: ApplyOpts): void {
    const s = this.s;
    this.frameCount++;
    const byPlayer = target.team === 'enemy';
    if (byPlayer) s.recordReaction(def.id);

    const color = colorOf(def.color);
    const x = target.x;
    const y = target.y;

    s.vfx.reactionText(x, y - target.height - 6, def.name, color, def.tier);
    s.vfx.ring(x, y, 3, def.tier === 2 ? 34 : 24, color, 0.28, 2);
    s.vfx.burst(x, y - 6, color, def.tier === 2 ? 22 : 12);
    s.vfx.glow(x, y - 6, def.tier === 2 ? 40 : 26, color, 0.3);
    s.lighting.flash(x, y, def.tier === 2 ? 140 : 90, color, 0.35);
    playSfx(def.sfx);
    if (def.tier === 2) {
      playSfx('secondary');
      s.hitstop.request(0.14);
      s.shake(0.14, 0.008);
    } else if (def.tier === 1) {
      s.hitstop.request(0.1);
      s.shake(0.08, 0.004);
    } else s.hitstop.request(0.06);

    if (byPlayer) {
      const m = this.mods;
      if (m.heal > 0) s.player.heal(m.heal);
      if (def.id === 'vaporize' && m.flags.has('vaporize_roll')) s.player.refundRoll();
      if (def.id === 'thunderwind' && m.flags.has('thunderwind_cd')) s.player.freeLightningT = 3;
    }
    target.onReaction(def);
    this.runEffect(def, target, color, opts);
  }

  /** 플레이어가 일으킨 반응이면 강화 수정치 적용 */
  private scaled(def: ReactionDef, target: Actor) {
    const e = def.effect;
    const base = {
      damage: e.damage ?? 0,
      radius: e.radius ?? 30,
      duration: e.duration ?? 2,
      targets: e.targets ?? 3,
    };
    if (target.team !== 'enemy') return base;
    const m = this.mods;
    const rm = m.reaction[def.id] ?? { damage: 0, radius: 0, duration: 0, targets: 0 };
    let mult = (1 + rm.damage) * (1 + m.allDamage) * this.s.player.atkMult;
    if (m.relics.has('boiling_blood') && this.s.player.hp <= this.s.player.maxHp / 2) mult *= 1.4;
    let duration = base.duration + rm.duration;
    if (def.id === 'freeze' && m.relics.has('frozen_heart')) duration *= 2;
    if (def.id === 'firestorm' && m.mastery.has('firestorm')) duration *= 2;
    return {
      damage: base.damage * mult,
      radius: base.radius * (1 + rm.radius),
      duration,
      targets: base.targets + rm.targets,
    };
  }

  private runEffect(def: ReactionDef, target: Actor, color: number, opts: ApplyOpts): void {
    const s = this.s;
    const e: EffectDef = def.effect;
    const team = target.team;
    const onPlayer = team === 'player';
    const ctl = onPlayer ? RULES.playerControlMult : 1;
    const x = target.x;
    const y = target.y;
    const v = this.scaled(def, target);
    const mastery = !onPlayer && this.mods.mastery.has(def.id);
    const hit = (a: Actor, damage: number, extra: Partial<HitInfo> = {}) =>
      s.combat.hit(a, { damage, isReaction: true, reactionId: def.id, color, ...extra });
    const dist = (a: Actor) => Phaser.Math.Distance.Between(x, y, a.x, a.y);

    switch (e.type) {
      case 'damage': {
        if (e.unfreeze) target.frozenT = 0;
        hit(target, v.damage);
        if (mastery && def.id === 'vaporize') {
          for (const a of s.combat.inCircle(x, y, 34, team)) if (a !== target) hit(a, v.damage * 0.5);
          s.vfx.ring(x, y, 4, 34, color, 0.3, 2);
        }
        break;
      }
      case 'chain': {
        hit(target, v.damage);
        const hitSet = new Set<Actor>([target]);
        const chainFrom = (fx: number, fy: number, n: number) => {
          const others = s
            .actorsOfTeam(team)
            .filter((a) => !hitSet.has(a) && Phaser.Math.Distance.Between(fx, fy, a.x, a.y) <= (e.range ?? 72))
            .sort((a, b) => Phaser.Math.Distance.Between(fx, fy, a.x, a.y) - Phaser.Math.Distance.Between(fx, fy, b.x, b.y))
            .slice(0, n);
          let px = fx;
          let py = fy;
          for (const o of others) {
            hitSet.add(o);
            s.vfx.bolt(px, py - 8, o.x, o.y - 8, color);
            hit(o, v.damage);
            px = o.x;
            py = o.y;
          }
          return { px, py };
        };
        const end = chainFrom(x, y, v.targets);
        if (mastery && def.id === 'electro_charged') chainFrom(end.px, end.py, v.targets);
        break;
      }
      case 'freeze': {
        hit(target, v.damage);
        target.freeze((target.isBoss ? e.bossDuration ?? 0.5 : v.duration) * ctl);
        break;
      }
      case 'field': {
        const kind = e.kind ?? 'flames';
        s.fields.spawn({
          x,
          y,
          radius: v.radius,
          duration: v.duration,
          tick: e.tick ?? 0.5,
          damage: v.damage,
          attach: e.attach ?? null,
          noStack: true,
          affect: team,
          kind,
          color,
          pull: e.pull ?? 0,
          isReaction: true,
          reactionId: def.id,
          chase: mastery && def.id === 'firestorm',
          terrainElement: kind === 'plasma' ? 'lightning' : kind === 'steam' ? null : 'fire',
          owner: onPlayer ? 'enemy' : 'player',
        });
        break;
      }
      case 'explosion': {
        this.explode(x, y, v.radius, v.damage, e.knockback ?? 0, team, color, def.id);
        if (mastery && def.id === 'overload') {
          s.scheduler.after(0.35, () => this.explode(x, y, v.radius * 1.2, v.damage, e.knockback ?? 0, team, color, def.id));
        }
        break;
      }
      case 'pull': {
        const r = v.radius;
        s.vfx.ring(x, y, r, 4, color, 0.3, 2);
        const pulled: Actor[] = [];
        for (const a of s.combat.inCircle(x, y, r, team)) {
          const d = dist(a);
          if (a !== target && d > 2) {
            const k = 9 * Math.min(d, r);
            a.impulse.set(((x - a.x) / d) * k, ((y - a.y) / d) * k);
          }
          pulled.push(a);
          hit(a, v.damage);
        }
        if (mastery && def.id === 'thunderwind') {
          pulled.slice(0, 4).forEach((a, i) =>
            s.scheduler.after(0.4 + i * 0.08, () => {
              if (a.dead) return;
              s.vfx.strike(a.x, a.y, color, 12);
              hit(a, 8 * s.player.atkMult);
            }),
          );
        }
        break;
      }
      case 'slow': {
        target.slow(e.factor ?? 0.4, v.duration * (onPlayer ? 0.6 : 1));
        break;
      }
      case 'knockback': {
        const fx = opts.fromX ?? x;
        const fy = opts.fromY ?? y - 1;
        hit(target, v.damage, { knockback: e.knockback ?? 300, fromX: fx, fromY: fy === y && fx === x ? y - 1 : fy });
        target.armWallSlam();
        break;
      }
      case 'stun': {
        hit(target, v.damage);
        target.stun((target.isBoss ? e.bossDuration ?? 0.3 : v.duration) * ctl);
        break;
      }
      case 'shards': {
        target.frozenT = 0;
        hit(target, v.damage);
        const n = e.count ?? 8;
        const sp = e.speed ?? 220;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          s.projectiles.spawn({
            x,
            y: y - 6,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            radius: 3,
            life: 0.45,
            team: otherTeam(team),
            texture: 'shard',
            color,
            element: null,
            ignore: target,
            hit: { damage: v.damage, isReaction: true, reactionId: def.id, color, knockback: 60 },
          });
        }
        break;
      }
      case 'strikes': {
        const n = e.count ?? 5;
        const area = e.area ?? 70;
        for (let i = 0; i < n; i++) {
          s.scheduler.after(0.06 + i * 0.09, () => {
            const pool = s.combat.inCircle(x, y, area, team);
            const pick = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
            const tx = pick ? pick.x : x + Phaser.Math.Between(-area, area) * 0.6;
            const ty = pick ? pick.y : y + Phaser.Math.Between(-area, area) * 0.6;
            const r = e.radius ?? 12;
            s.vfx.strike(tx, ty, color, r);
            playSfx('strike');
            for (const a of s.combat.inCircle(tx, ty, r, team)) hit(a, v.damage);
          });
        }
        break;
      }
      case 'aoeSlow': {
        const r = v.radius;
        s.vfx.ring(x, y, 4, r, color, 0.35, 3);
        for (const a of s.combat.inCircle(x, y, r, team)) {
          hit(a, v.damage);
          a.slow(e.factor ?? 0.4, v.duration * (onPlayer ? 0.6 : 1));
        }
        break;
      }
      case 'chainExplosion': {
        const r = v.radius;
        const kb = e.knockback ?? 100;
        this.explode(x, y, r, v.damage, kb, team, color, def.id);
        const next = s
          .actorsOfTeam(team)
          .filter((a) => a !== target && dist(a) <= (e.range ?? 90))
          .sort((a, b) => dist(a) - dist(b))
          .slice(0, e.jumps ?? 3);
        next.forEach((a, i) => {
          s.scheduler.after(0.12 * (i + 1), () => {
            if (!a.dead) this.explode(a.x, a.y, r, v.damage, kb, team, color, def.id);
          });
        });
        break;
      }
    }
  }

  private explode(x: number, y: number, r: number, dmg: number, kb: number, team: Actor['team'], color: number, id: string) {
    const s = this.s;
    s.vfx.explosion(x, y, r, color);
    for (const a of s.combat.inCircle(x, y, r, team)) {
      s.combat.hit(a, { damage: dmg, isReaction: true, reactionId: id, color, knockback: kb, fromX: x, fromY: y });
      if (kb > 150) a.armWallSlam();
    }
  }
}
