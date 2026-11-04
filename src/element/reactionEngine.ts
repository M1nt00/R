import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import type { Actor } from '../entities/actor';
import type { Element } from './types';
import { otherTeam } from './types';
import { DATA, RULES, colorOf, type EffectDef, type ReactionDef } from './data';
import type { HitInfo } from '../combat/damage';
import { playSfx } from '../audio/sfx';

const pairKey = (a: Element, b: Element): string => [a, b].sort().join('+');

export interface ApplyOpts {
  attachDuration?: number;
  /** 지형·장판 틱처럼 중첩 횟수에 세지 않는 부착 */
  noStack?: boolean;
  /** 원소를 실어 보낸 위치 (돌풍 넉백 방향 등) */
  fromX?: number;
  fromY?: number;
}

/**
 * 반응 판정을 한 곳에서 처리한다.
 * 플레이어·적 구분 없이 같은 규칙 → "적이 나한테 반응 걸기"도 추가 코드 없이 동작.
 */
export class ReactionEngine {
  secondaryUnlocked = false;
  private frameCount = 0;
  private readonly primary = new Map<string, ReactionDef>();
  private readonly stack = new Map<Element, ReactionDef>();
  private readonly secondary = new Map<string, ReactionDef>();

  constructor(private readonly s: RoomScene) {
    for (const r of DATA.primary) this.primary.set(pairKey(r.inputs![0], r.inputs![1]), r);
    for (const r of DATA.stack) this.stack.set(r.element!, r);
    for (const r of DATA.secondary) this.secondary.set(`${r.residue}|${r.element}`, r);
  }

  /** 매 프레임 시작 시 호출 — 한 프레임에 처리하는 반응 수 상한(무한 연쇄 방지) */
  beginFrame(): void {
    this.frameCount = 0;
  }

  apply(target: Actor, el: Element, opts: ApplyOpts = {}): ReactionDef | null {
    if (target.dead) return null;
    const es = target.es;
    const canReact = this.frameCount < RULES.maxReactionsPerFrame;

    // 1) 잔여 상태 + 원소 → 2차 반응 (메타 해금 후)
    if (canReact && this.secondaryUnlocked && es.residue) {
      const def = this.secondary.get(`${es.residue}|${el}`);
      if (def) {
        es.residue = null;
        es.residueT = 0;
        this.trigger(target, def, opts);
        return def;
      }
    }

    // 2) 부착 원소 + 다른 원소 → 1차 반응
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

    // 3) 부착 + 중첩 카운트
    es.attach(el, opts.attachDuration ?? RULES.attachDuration);
    if (!opts.noStack) {
      if (es.stackEl === el && es.stackT > 0) es.stackCount++;
      else {
        es.stackEl = el;
        es.stackCount = 1;
      }
      es.stackT = RULES.stackWindow;
      if (canReact && es.stackCount >= RULES.stackCount) {
        const def = this.stack.get(el)!;
        es.resetStack();
        es.clearAttached();
        this.trigger(target, def, opts);
        return def;
      }
    }
    return null;
  }

  private trigger(target: Actor, def: ReactionDef, opts: ApplyOpts): void {
    const s = this.s;
    this.frameCount++;
    s.stats.reactions++;
    s.stats.byReaction[def.id] = (s.stats.byReaction[def.id] ?? 0) + 1;

    const color = colorOf(def.color);
    const x = target.x;
    const y = target.y;

    // 반응 피드백: 이름 텍스트 + 원소색 이펙트 + 고유 효과음 (+2차는 흔들림·히트스탑 강화)
    s.vfx.reactionText(x, y - 20, def.name, color, def.tier);
    s.vfx.ring(x, y, 3, def.tier === 2 ? 34 : 24, color, 0.28, 2);
    s.vfx.burst(x, y, color, def.tier === 2 ? 22 : 12);
    playSfx(def.sfx);
    if (def.tier === 2) {
      playSfx('secondary');
      s.hitstop.request(0.14);
      s.shake(0.14, 0.008);
    } else if (def.tier === 1) {
      s.hitstop.request(0.1);
      s.shake(0.08, 0.004);
    } else {
      s.hitstop.request(0.06);
    }

    this.runEffect(def.effect, target, color, opts);
  }

  private runEffect(e: EffectDef, target: Actor, color: number, opts: ApplyOpts): void {
    const s = this.s;
    const team = target.team; // 반응은 "당한 쪽" 진영에 효과를 준다
    const onPlayer = team === 'player';
    const ctl = onPlayer ? RULES.playerControlMult : 1;
    const x = target.x;
    const y = target.y;
    const dmg = e.damage ?? 0;
    const hit = (a: Actor, damage: number, extra: Partial<HitInfo> = {}) =>
      s.combat.hit(a, { damage, isReaction: true, color, ...extra });
    const dist = (a: Actor) => Phaser.Math.Distance.Between(x, y, a.x, a.y);

    switch (e.type) {
      case 'damage': {
        if (e.unfreeze) target.frozenT = 0;
        hit(target, dmg);
        break;
      }
      case 'chain': {
        hit(target, dmg);
        const others = s
          .actorsOfTeam(team)
          .filter((a) => a !== target && dist(a) <= (e.range ?? 72))
          .sort((a, b) => dist(a) - dist(b))
          .slice(0, e.targets ?? 3);
        let px = x;
        let py = y;
        for (const o of others) {
          s.vfx.bolt(px, py - 4, o.x, o.y - 4, color);
          hit(o, dmg);
          px = o.x;
          py = o.y;
        }
        break;
      }
      case 'freeze': {
        hit(target, dmg);
        target.freeze((target.isBoss ? e.bossDuration ?? 0.5 : e.duration ?? 2) * ctl);
        break;
      }
      case 'field': {
        const kind = e.kind ?? 'flames';
        s.fields.spawn({
          x,
          y,
          radius: e.radius ?? 30,
          duration: e.duration ?? 3,
          tick: e.tick ?? 0.5,
          damage: dmg,
          attach: e.attach ?? null,
          noStack: true,
          affect: team,
          kind,
          color,
          pull: e.pull ?? 0,
          isReaction: true,
          terrainElement: kind === 'plasma' ? 'lightning' : kind === 'steam' ? null : 'fire',
        });
        break;
      }
      case 'explosion': {
        this.explode(x, y, e.radius ?? 30, dmg, e.knockback ?? 0, team, color);
        break;
      }
      case 'pull': {
        const r = e.radius ?? 80;
        s.vfx.ring(x, y, r, 4, color, 0.3, 2);
        for (const a of s.combat.inCircle(x, y, r, team)) {
          const d = dist(a);
          if (a !== target && d > 2) {
            // 감쇠하는 충격량으로 정확히 중심점까지 끌어당김 (decay 9 → 이동거리 = v/9)
            const k = 9 * Math.min(d, r);
            a.impulse.set(((x - a.x) / d) * k, ((y - a.y) / d) * k);
          }
          hit(a, dmg);
        }
        break;
      }
      case 'slow': {
        target.slow(e.factor ?? 0.4, (e.duration ?? 3) * (onPlayer ? 0.6 : 1));
        break;
      }
      case 'knockback': {
        const fx = opts.fromX ?? x;
        const fy = opts.fromY ?? y - 1;
        hit(target, dmg, { knockback: e.knockback ?? 300, fromX: fx, fromY: fy === y && fx === x ? y - 1 : fy });
        break;
      }
      case 'stun': {
        hit(target, dmg);
        target.stun((target.isBoss ? e.bossDuration ?? 0.3 : e.duration ?? 1) * ctl);
        break;
      }
      case 'shards': {
        target.frozenT = 0;
        hit(target, dmg);
        const n = e.count ?? 8;
        const sp = e.speed ?? 220;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          s.projectiles.spawn({
            x,
            y: y - 4,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            radius: 3,
            life: 0.45,
            team: otherTeam(team),
            texture: 'shard',
            color,
            element: null,
            ignore: target,
            hit: { damage: dmg, isReaction: true, color, knockback: 60 },
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
            for (const a of s.combat.inCircle(tx, ty, r, team)) hit(a, dmg);
          });
        }
        break;
      }
      case 'aoeSlow': {
        const r = e.radius ?? 70;
        s.vfx.ring(x, y, 4, r, color, 0.35, 3);
        for (const a of s.combat.inCircle(x, y, r, team)) {
          hit(a, dmg);
          a.slow(e.factor ?? 0.4, (e.duration ?? 3) * (onPlayer ? 0.6 : 1));
        }
        break;
      }
      case 'chainExplosion': {
        const r = e.radius ?? 28;
        const kb = e.knockback ?? 100;
        this.explode(x, y, r, dmg, kb, team, color);
        const next = s
          .actorsOfTeam(team)
          .filter((a) => a !== target && dist(a) <= (e.range ?? 90))
          .sort((a, b) => dist(a) - dist(b))
          .slice(0, e.jumps ?? 3);
        next.forEach((a, i) => {
          s.scheduler.after(0.12 * (i + 1), () => {
            if (!a.dead) this.explode(a.x, a.y, r, dmg, kb, team, color);
          });
        });
        break;
      }
    }
  }

  private explode(x: number, y: number, r: number, dmg: number, kb: number, team: Actor['team'], color: number) {
    const s = this.s;
    s.vfx.explosion(x, y, r, color);
    for (const a of s.combat.inCircle(x, y, r, team)) {
      s.combat.hit(a, { damage: dmg, isReaction: true, color, knockback: kb, fromX: x, fromY: y });
    }
  }
}
