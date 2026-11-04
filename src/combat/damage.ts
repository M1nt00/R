import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import type { Actor } from '../entities/actor';
import type { Element, Team } from '../element/types';
import { RULES } from '../element/data';

export interface HitInfo {
  damage: number;
  /** 대상에게 부착할 원소 (모든 공격은 맞은 대상에게 자기 원소를 부착) */
  element?: Element | null;
  /** 완벽 회피로 흡수해서 실어 보내는 추가 원소 */
  extra?: Element | null;
  attachDuration?: number;
  noStack?: boolean;
  knockback?: number;
  fromX?: number;
  fromY?: number;
  hitstop?: number;
  shake?: number;
  /** 플레이어가 구르기 시작 직후라면 완벽 회피 판정 대상 */
  perfectDodgeable?: boolean;
  isReaction?: boolean;
  reactionId?: string;
  /** 지형·장판 틱 */
  environmental?: boolean;
  /** 위에서 떨어지는 공격 (방패 무시) */
  fromAbove?: boolean;
  color?: number;
}

export type HitResult = 'hit' | 'dodged' | 'perfect' | 'ignored' | 'blocked';

export class Combat {
  constructor(private readonly s: RoomScene) {}

  inCircle(x: number, y: number, r: number, team: Team | 'all'): Actor[] {
    return this.s.actorsOfTeam(team).filter((a) => Phaser.Math.Distance.Between(x, y, a.x, a.y) <= r + a.radius);
  }

  inArc(x: number, y: number, range: number, angle: number, half: number, team: Team | 'all'): Actor[] {
    return this.s.actorsOfTeam(team).filter((a) => {
      const d = Phaser.Math.Distance.Between(x, y, a.x, a.y);
      if (d > range + a.radius) return false;
      if (d <= a.radius + 4) return true;
      const ang = Phaser.Math.Angle.Between(x, y, a.x, a.y);
      return Math.abs(Phaser.Math.Angle.Wrap(ang - angle)) <= half;
    });
  }

  hit(target: Actor, h: HitInfo): HitResult {
    if (target.dead) return 'ignored';
    const res = target.incoming(h);
    if (res !== 'ok') return res;

    let dmg = h.damage;
    if (target.team === 'player' && h.isReaction) dmg *= RULES.playerDamageMult;
    if (target.team === 'enemy') {
      const m = this.s.engine.mods;
      if (target.frozenT > 0) {
        if (m.relics.has('frozen_heart')) dmg = 0;
        else if (m.mastery.has('freeze')) dmg *= 1.5;
      }
      dmg *= target.damageTakenMult();
    }
    target.lastHit = h;
    if (dmg > 0) {
      target.hp = Math.max(0, target.hp - dmg);
      target.flash();
      const col = h.color ?? (target.team === 'player' ? 0xf6757a : 0xffffff);
      this.s.vfx.number(target.x, target.y - target.height - 2, dmg, col, h.isReaction === true);
      target.onDamaged(h, dmg);
    }

    if (h.knockback && h.fromX !== undefined && h.fromY !== undefined) {
      const dx = target.x - h.fromX;
      const dy = target.y - h.fromY;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) target.knock(dx / len, dy / len, h.knockback);
    }
    if (h.hitstop) this.s.hitstop.request(h.hitstop);
    if (h.shake) this.s.shake(0.08, h.shake);

    const opts = { attachDuration: h.attachDuration, noStack: h.noStack, fromX: h.fromX, fromY: h.fromY };
    if (h.element) this.s.engine.apply(target, h.element, opts);
    if (h.extra) this.s.engine.apply(target, h.extra, { ...opts, noStack: true });

    if (target.hp <= 0 && !target.dead) target.die();
    return 'hit';
  }
}
