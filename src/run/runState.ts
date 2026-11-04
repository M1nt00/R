import Phaser from 'phaser';
import boonsJson from '../data/boons.json';
import relicsJson from '../data/relics.json';
import type { IconName } from '../art/propSprites';
import { COMBAT_TEMPLATES, type RoomKind } from './rooms';
import { meta, playerBase, saveMeta } from './meta';

export interface BoonDef {
  id: string;
  reaction: string;
  name: string;
  desc: string;
  max: number;
  mod?: { damage?: number; radius?: number; duration?: number; targets?: number; allDamage?: number; heal?: number };
  flag?: string;
}

export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  icon: IconName;
}

export const BOONS = boonsJson as BoonDef[];
export const RELICS = relicsJson as RelicDef[];

export type RewardKind = 'boon' | 'gold' | 'relic' | 'shop' | 'heal' | 'boss';

export interface RoomSpec {
  kind: RoomKind;
  reward: RewardKind;
  template: string;
  depth: number;
}

export const REGION = { name: '잿빛 회랑', length: 8 };

export interface RunState {
  depth: number;
  hp: number;
  maxHp: number;
  gold: number;
  essence: number;
  potions: number;
  boons: Record<string, number>;
  relics: string[];
  room: RoomSpec;
  recentTemplates: string[];
  shopSeen: boolean;
  time: number;
  stats: { kills: number; reactions: number; perfect: number; byReaction: Record<string, number> };
}

let current: RunState | null = null;
export const getRun = (): RunState | null => current;

function pickTemplate(run: { recentTemplates: string[] } | null): string {
  const recent = run?.recentTemplates ?? [];
  const pool = COMBAT_TEMPLATES.filter((t) => !recent.includes(t.id));
  return Phaser.Utils.Array.GetRandom(pool.length ? pool : COMBAT_TEMPLATES).id;
}

export function startRun(): RunState {
  const base = playerBase();
  const first = pickTemplate(null);
  current = {
    depth: 1,
    hp: base.maxHp,
    maxHp: base.maxHp,
    gold: 0,
    essence: 0,
    potions: base.potions,
    boons: {},
    relics: [],
    room: { kind: 'combat', reward: 'boon', template: first, depth: 1 },
    recentTemplates: [first],
    shopSeen: false,
    time: 0,
    stats: { kills: 0, reactions: 0, perfect: 0, byReaction: {} },
  };
  meta.runs++;
  saveMeta();
  return current;
}

/** 런 종료 — 원소 정수와 숙련도는 메타로 넘어감 */
export function endRun(victory: boolean): void {
  if (!current) return;
  meta.essence += current.essence;
  meta.bestDepth = Math.max(meta.bestDepth, current.depth);
  if (victory) meta.wins++;
  for (const [id, n] of Object.entries(current.stats.byReaction)) meta.mastery[id] = (meta.mastery[id] ?? 0) + n;
  saveMeta();
  current = null;
}

const REWARD_ROOM: Record<RewardKind, RoomKind> = {
  boon: 'combat',
  gold: 'combat',
  relic: 'elite',
  shop: 'shop',
  heal: 'heal',
  boss: 'boss',
};

/** 방을 클리어하면 열리는 문들. 문에 표시된 보상을 보고 경로를 정한다. */
export function doorOptions(run: RunState): RoomSpec[] {
  const d = run.depth + 1;
  if (d >= REGION.length) return [{ kind: 'boss', reward: 'boss', template: 'boss', depth: d }];
  const weights: [RewardKind, number][] = [
    ['boon', 50],
    ['gold', 14],
    ['relic', d >= 2 ? 18 : 0],
    ['shop', d >= 3 && !run.shopSeen ? 12 : 0],
    ['heal', d >= 3 && run.hp < run.maxHp * 0.8 ? 12 : d >= 4 ? 5 : 0],
  ];
  const count = d >= 3 && Math.random() < 0.35 ? 3 : 2;
  const chosen: RewardKind[] = [];
  if (d === REGION.length - 1 && !run.shopSeen) chosen.push('shop');
  while (chosen.length < count) {
    const pool = weights.filter(([k, w]) => w > 0 && !chosen.includes(k));
    if (!pool.length) break;
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let roll = Math.random() * total;
    for (const [k, w] of pool) {
      roll -= w;
      if (roll <= 0) {
        chosen.push(k);
        break;
      }
    }
  }
  return chosen.map((reward) => ({
    kind: REWARD_ROOM[reward],
    reward,
    template: REWARD_ROOM[reward] === 'combat' || REWARD_ROOM[reward] === 'elite' ? pickTemplate(run) : REWARD_ROOM[reward],
    depth: d,
  }));
}

export function enterRoom(run: RunState, spec: RoomSpec): void {
  run.room = spec;
  run.depth = spec.depth;
  if (spec.kind === 'shop') run.shopSeen = true;
  if (spec.kind === 'combat' || spec.kind === 'elite') {
    run.recentTemplates = [...run.recentTemplates, spec.template].slice(-3);
  }
}

export const boonLevel = (run: RunState | null, id: string): number => run?.boons[id] ?? 0;

/** 반응 강화 3지선다 — 이미 고른 반응 쪽으로 약간 기울여서 "이번 판은 감전 빌드"가 자연스럽게 생기게 */
export function rollBoons(run: RunState, n = 3): BoonDef[] {
  const avail = BOONS.filter((b) => boonLevel(run, b.id) < b.max);
  const owned = new Set(BOONS.filter((b) => boonLevel(run, b.id) > 0).map((b) => b.reaction));
  const out: BoonDef[] = [];
  while (out.length < n) {
    const pool = avail.filter((b) => !out.includes(b));
    if (!pool.length) break;
    const favored = pool.filter((b) => owned.has(b.reaction));
    const src = favored.length && Math.random() < 0.45 ? favored : pool;
    out.push(Phaser.Utils.Array.GetRandom(src));
  }
  return out;
}

export function rollRelics(run: RunState, n = 3): RelicDef[] {
  const pool = Phaser.Utils.Array.Shuffle(RELICS.filter((r) => !run.relics.includes(r.id)));
  return pool.slice(0, n);
}

export const MAX_RELICS = 5;
