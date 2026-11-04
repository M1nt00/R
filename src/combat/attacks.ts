import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import type { Player } from '../entities/player';
import type { Element } from '../element/types';
import type { HitInfo } from './damage';
import { ELEMENT_COLOR, ELEMENT_LIGHT } from '../art/palette';
import { playSfx } from '../audio/sfx';

/**
 * 원소별 공격 세트 (고정, 런마다 안 바뀜)
 *  불   빠른 화염 3연타(근접)   / 화염 돌진
 *  물   물줄기(원거리)          / 물웅덩이 장판
 *  바람 넓은 부채꼴 베기        / 회오리 투척
 *  번개 느리지만 강한 낙뢰      / 순간이동 후 방전
 * 일반 공격 피해는 낮게 — 딜의 대부분은 반응에서 나온다.
 */

export interface Payload {
  element: Element;
  dmgMult: number;
  attachDuration: number;
  extra: Element | null;
  empowered: boolean;
}

export interface AttackTiming {
  cooldown: number;
  /** 공격 중 이동 감속 시간 */
  lock: number;
}

export const SKILL_COOLDOWN: Record<Element, number> = { fire: 4, water: 6, wind: 5, lightning: 6 };

const hitWith = (pay: Payload, damage: number, extra: Partial<HitInfo> = {}): HitInfo => ({
  damage: damage * pay.dmgMult,
  element: pay.element,
  extra: pay.extra,
  attachDuration: pay.attachDuration,
  ...extra,
});

function clampAim(p: Player, max: number): { x: number; y: number } {
  const d = Phaser.Math.Distance.Between(p.x, p.y, p.aimX, p.aimY);
  if (d <= max) return { x: p.aimX, y: p.aimY };
  return { x: p.x + Math.cos(p.aimAngle) * max, y: p.y + Math.sin(p.aimAngle) * max };
}

export function basicAttack(s: RoomScene, p: Player, pay: Payload): AttackTiming {
  const a = p.aimAngle;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const color = ELEMENT_COLOR[pay.element];

  switch (pay.element) {
    case 'fire': {
      const step = p.comboStep;
      const heavy = step === 2;
      const range = heavy ? 30 : 26;
      const half = heavy ? 1.4 : 1.1;
      s.vfx.slash(p.x, p.y - 4, a, range, half, color, heavy);
      p.lunge(heavy ? 90 : 60);
      for (const t of s.combat.inArc(p.x, p.y, range, a, half, 'enemy')) {
        s.combat.hit(t, hitWith(pay, heavy ? 7 : 4, { knockback: heavy ? 170 : 50, fromX: p.x, fromY: p.y, hitstop: 0.05 }));
      }
      s.terrain.applyElement(p.x + cos * range * 0.6, p.y + sin * range * 0.6, 10, 'fire');
      playSfx('slash');
      p.comboStep = (step + 1) % 3;
      p.comboT = 0.6;
      return { cooldown: heavy ? 0.42 : 0.17, lock: 0.12 };
    }
    case 'water': {
      const sp = 290;
      s.projectiles.spawn({
        x: p.x + cos * 6,
        y: p.y - 4 + sin * 6,
        vx: cos * sp,
        vy: sin * sp,
        radius: 4,
        life: 0.55,
        team: 'player',
        texture: 'bolt',
        color,
        element: 'water',
        hit: hitWith(pay, 3, { knockback: 40, hitstop: 0.04 }),
      });
      playSfx('shoot');
      return { cooldown: 0.22, lock: 0.06 };
    }
    case 'wind': {
      const range = 38;
      const half = 1.05;
      s.vfx.slash(p.x, p.y - 4, a, range, half, color, true);
      p.lunge(40);
      for (const t of s.combat.inArc(p.x, p.y, range, a, half, 'enemy')) {
        s.combat.hit(t, hitWith(pay, 3, { knockback: 130, fromX: p.x, fromY: p.y, hitstop: 0.045 }));
      }
      for (const k of [-0.5, 0, 0.5]) {
        s.terrain.applyElement(p.x + Math.cos(a + k) * range * 0.6, p.y + Math.sin(a + k) * range * 0.6, 9, 'wind');
      }
      playSfx('whoosh');
      return { cooldown: 0.36, lock: 0.14 };
    }
    case 'lightning': {
      const { x: tx, y: ty } = clampAim(p, 130);
      const r = 16;
      s.vfx.telegraph(tx, ty, r, ELEMENT_LIGHT.lightning, 0.2);
      s.scheduler.after(0.2, () => {
        s.vfx.strike(tx, ty, color, r);
        playSfx('strike');
        for (const t of s.combat.inCircle(tx, ty, r, 'enemy')) {
          s.combat.hit(t, hitWith(pay, 10, { knockback: 40, fromX: tx, fromY: ty - 1, hitstop: 0.07, shake: 0.004 }));
        }
        s.terrain.applyElement(tx, ty, r, 'lightning');
      });
      return { cooldown: 0.72, lock: 0.22 };
    }
  }
}

export function skillAttack(s: RoomScene, p: Player, pay: Payload): void {
  const a = p.aimAngle;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const color = ELEMENT_COLOR[pay.element];

  switch (pay.element) {
    case 'fire': {
      // 화염 돌진: 지나가는 적 전부에게 불 부착
      p.startDash(a, (t) => {
        s.combat.hit(t, hitWith(pay, 6, { knockback: 150, fromX: p.x, fromY: p.y, hitstop: 0.05 }));
      });
      playSfx('whoosh');
      break;
    }
    case 'water': {
      // 물웅덩이 장판: 지형을 직접 만든다
      const { x, y } = clampAim(p, 110);
      const r = 26;
      s.terrain.addPuddle(x, y, r, 8);
      s.vfx.ring(x, y, 4, r, color, 0.3, 2);
      s.vfx.burst(x, y, ELEMENT_LIGHT.water, 14);
      for (const t of s.combat.inCircle(x, y, r, 'enemy')) s.combat.hit(t, hitWith(pay, 2, { hitstop: 0.03 }));
      playSfx('splash');
      break;
    }
    case 'wind': {
      // 회오리 투척: 천천히 날아가며 적을 빨아들이고 바람 부착
      s.fields.spawn({
        x: p.x + cos * 12,
        y: p.y + sin * 12,
        vx: cos * 100,
        vy: sin * 100,
        radius: 15,
        duration: 1.7,
        tick: 0.25,
        damage: 2 * pay.dmgMult,
        attach: 'wind',
        attachDuration: pay.attachDuration,
        noStack: true,
        extra: pay.extra,
        affect: 'enemy',
        kind: 'tornado',
        color,
        pull: 90,
        terrainElement: 'wind',
      });
      playSfx('vortex');
      break;
    }
    case 'lightning': {
      // 순간이동 후 방전
      let { x: tx, y: ty } = clampAim(p, 95);
      for (let k = 0; k < 30 && s.terrain.isBlocked(tx, ty, p.radius + 1); k++) {
        tx -= cos * 4;
        ty -= sin * 4;
      }
      s.vfx.afterimage(p, color);
      s.vfx.bolt(p.x, p.y - 6, tx, ty - 6, color);
      p.teleport(tx, ty);
      p.hurtInvulnT = Math.max(p.hurtInvulnT, 0.2);
      const r = 38;
      s.vfx.explosion(tx, ty, r, color);
      s.shake(0.1, 0.005);
      for (const t of s.combat.inCircle(tx, ty, r, 'enemy')) {
        s.combat.hit(t, hitWith(pay, 7, { knockback: 120, fromX: tx, fromY: ty, hitstop: 0.07 }));
      }
      s.terrain.applyElement(tx, ty, 30, 'lightning');
      playSfx('zap');
      break;
    }
  }
}
