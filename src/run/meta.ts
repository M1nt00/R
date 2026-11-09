import metaJson from '../data/meta.json';
import { DATA } from '../element/data';

/**
 * 메타 성장 (죽어도 남는 것): 원소 정수, 캐릭터 스탯, 2차 반응 해금, 반응 숙련도.
 * localStorage에만 저장 (런 중 저장은 없음).
 */

export interface StatDef {
  id: string;
  name: string;
  per: number;
  fmt: string;
  costs: number[];
}

export const META_DEF = metaJson as { stats: StatDef[]; secondaryCost: number; masteryRequired: number };

export interface MetaState {
  essence: number;
  stats: Record<string, number>;
  secondary: string[];
  mastery: Record<string, number>;
  runs: number;
  wins: number;
  bestDepth: number;
  seenIntro: boolean;
}

const KEY = 'element-juggler-meta-v1';

function fresh(): MetaState {
  return { essence: 0, stats: {}, secondary: [], mastery: {}, runs: 0, wins: 0, bestDepth: 0, seenIntro: false };
}

function load(): MetaState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    return { ...fresh(), ...(JSON.parse(raw) as Partial<MetaState>) };
  } catch {
    return fresh();
  }
}

export const meta: MetaState = load();

export function saveMeta(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(meta));
  } catch {
    /* 저장 불가 환경 (사생활 보호 모드 등) — 무시 */
  }
}

export function resetMeta(): void {
  Object.assign(meta, fresh());
  saveMeta();
}

export const statLevel = (id: string): number => meta.stats[id] ?? 0;

export function statCost(def: StatDef): number | null {
  const lv = statLevel(def.id);
  return lv < def.costs.length ? def.costs[lv] : null;
}

export function buyStat(def: StatDef): boolean {
  const cost = statCost(def);
  if (cost === null || meta.essence < cost) return false;
  meta.essence -= cost;
  meta.stats[def.id] = statLevel(def.id) + 1;
  saveMeta();
  return true;
}

/** 2차 반응 → 그 잔여 상태를 남기는 1차 반응 */
export function primaryFor(secondaryId: string): string | null {
  const sec = DATA.secondary.find((s) => s.id === secondaryId);
  if (!sec) return null;
  return DATA.primary.find((p) => p.leaves === sec.residue)?.id ?? null;
}

export function secondaryStatus(secondaryId: string): { unlocked: boolean; mastery: number; need: number; canBuy: boolean } {
  const prim = primaryFor(secondaryId);
  const mastery = prim ? meta.mastery[prim] ?? 0 : 0;
  const need = META_DEF.masteryRequired;
  const unlocked = meta.secondary.includes(secondaryId);
  return { unlocked, mastery, need, canBuy: !unlocked && mastery >= need && meta.essence >= META_DEF.secondaryCost };
}

export function buySecondary(secondaryId: string): boolean {
  if (!secondaryStatus(secondaryId).canBuy) return false;
  meta.essence -= META_DEF.secondaryCost;
  meta.secondary.push(secondaryId);
  saveMeta();
  return true;
}

/** 메타 스탯이 반영된 플레이어 기본값 */
export function playerBase() {
  return {
    maxHp: Math.round(100 * (1 + 0.1 * statLevel('hp'))),
    atk: 1 + 0.05 * statLevel('atk'),
    speed: 1 + 0.034 * statLevel('speed'),
    attach: 3 + 0.2 * statLevel('attach'),
  };
}
