import type { RunState } from './runState';
import { BOONS } from './runState';
import { DATA } from '../element/data';

/** 반응 강화·유물이 반응 엔진과 플레이어에 주는 수정치 */
export interface ReactionMod {
  damage: number;
  radius: number;
  duration: number;
  targets: number;
}

export interface Mods {
  reaction: Record<string, ReactionMod>;
  allDamage: number;
  heal: number;
  flags: Set<string>;
  relics: Set<string>;
  /** 강화 3단계 이상 → 극의 */
  mastery: Set<string>;
}

export const MASTERY_DESC: Record<string, string> = {
  vaporize: '증발 극의 — 주변 적에게도 증발 피해 50%',
  electro_charged: '감전 극의 — 연쇄가 마지막 대상에서 한 번 더 퍼짐',
  freeze: '빙결 극의 — 빙결된 적이 받는 피해 +50%',
  firestorm: '화염폭풍 극의 — 불길 장판이 2배 오래가며 적을 쫓아감',
  overload: '과부하 극의 — 0.35초 뒤 한 번 더 폭발',
  thunderwind: '뇌풍 극의 — 끌려온 적들에게 낙뢰',
};

export const REACTION_NAME: Record<string, string> = {
  ...Object.fromEntries([...DATA.primary, ...DATA.stack, ...DATA.secondary].map((r) => [r.id, r.name])),
  stack: '중첩',
  common: '공통',
};

export function reactionLevel(run: RunState | null, reaction: string): number {
  if (!run) return 0;
  return BOONS.filter((b) => b.reaction === reaction).reduce((s, b) => s + (run.boons[b.id] ?? 0), 0);
}

export function computeMods(run: RunState | null): Mods {
  const m: Mods = { reaction: {}, allDamage: 0, heal: 0, flags: new Set(), relics: new Set(run?.relics ?? []), mastery: new Set() };
  if (!run) return m;
  for (const b of BOONS) {
    const lv = run.boons[b.id] ?? 0;
    if (lv <= 0) continue;
    if (b.flag) m.flags.add(b.flag);
    if (b.mod) {
      const r = (m.reaction[b.reaction] ??= { damage: 0, radius: 0, duration: 0, targets: 0 });
      r.damage += (b.mod.damage ?? 0) * lv;
      r.radius += (b.mod.radius ?? 0) * lv;
      r.duration += (b.mod.duration ?? 0) * lv;
      r.targets += (b.mod.targets ?? 0) * lv;
      m.allDamage += (b.mod.allDamage ?? 0) * lv;
      m.heal += (b.mod.heal ?? 0) * lv;
    }
  }
  for (const id of Object.keys(MASTERY_DESC)) if (reactionLevel(run, id) >= 3) m.mastery.add(id);
  return m;
}
