import reactionsJson from '../data/reactions.json';
import type { Element } from './types';

export type EffectType =
  | 'damage'
  | 'chain'
  | 'freeze'
  | 'field'
  | 'explosion'
  | 'pull'
  | 'slow'
  | 'knockback'
  | 'stun'
  | 'shards'
  | 'strikes'
  | 'aoeSlow'
  | 'chainExplosion';

export type FieldKind = 'flames' | 'steam' | 'plasma' | 'fireTornado' | 'tornado';

export interface EffectDef {
  type: EffectType;
  damage?: number;
  targets?: number;
  range?: number;
  duration?: number;
  bossDuration?: number;
  radius?: number;
  tick?: number;
  attach?: Element;
  kind?: FieldKind;
  knockback?: number;
  factor?: number;
  count?: number;
  speed?: number;
  area?: number;
  jumps?: number;
  pull?: number;
  unfreeze?: boolean;
}

export interface ReactionDef {
  id: string;
  name: string;
  /** 0 = 중첩, 1 = 1차, 2 = 2차 */
  tier: 0 | 1 | 2;
  color: string;
  sfx: string;
  effect: EffectDef;
  inputs?: [Element, Element];
  element?: Element;
  residue?: string;
  leaves?: string;
}

export type TerrainFx = 'none' | 'electric' | 'ice' | 'burning' | 'fireChannel' | 'current';

export interface TerrainReactionDef {
  terrain: 'puddle' | 'grass' | 'channel';
  element: Element;
  fx: Exclude<TerrainFx, 'none'>;
  name: string;
  duration: number;
}

export interface TerrainEffectDef {
  damage: number;
  attach: Element;
  color: string;
}

export interface ReactionData {
  rules: {
    attachDuration: number;
    empoweredAttachMult: number;
    empoweredDamageMult: number;
    stackWindow: number;
    stackCount: number;
    residueDuration: number;
    maxReactionsPerFrame: number;
    playerDamageMult: number;
    playerControlMult: number;
  };
  residues: Record<string, string>;
  primary: ReactionDef[];
  stack: ReactionDef[];
  secondary: ReactionDef[];
  terrain: TerrainReactionDef[];
  terrainEffects: Partial<Record<TerrainFx, TerrainEffectDef>>;
}

export const DATA = reactionsJson as unknown as ReactionData;
export const RULES = DATA.rules;

export const colorOf = (css: string): number => parseInt(css.replace('#', ''), 16);

/** 잔여 상태 색 = 그 잔여 상태를 남긴 1차 반응의 색 */
export const RESIDUE_COLOR: Record<string, number> = Object.fromEntries(
  DATA.primary.filter((r) => r.leaves).map((r) => [r.leaves as string, colorOf(r.color)]),
);
