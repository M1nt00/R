import type { Element } from '../element/types';

/**
 * Endesga 32 (Lospec) — 모든 스프라이트·타일·UI·이펙트가 이 32색만 쓴다.
 * https://lospec.com/palette-list/endesga-32
 */
export const E32 = {
  rust: 0xbe4a2f,
  clay: 0xd77643,
  sand: 0xead4aa,
  peach: 0xe4a672,
  tan: 0xb86f50,
  brown: 0x733e39,
  darkbrown: 0x3e2731,
  crimson: 0xa22633,
  red: 0xe43b44,
  orange: 0xf77622,
  amber: 0xfeae34,
  yellow: 0xfee761,
  lime: 0x63c74d,
  green: 0x3e8948,
  forest: 0x265c42,
  teal: 0x193c3e,
  navy: 0x124e89,
  blue: 0x0099db,
  cyan: 0x2ce8f5,
  white: 0xffffff,
  silver: 0xc0cbdc,
  steel: 0x8b9bb4,
  slate: 0x5a6988,
  indigo: 0x3a4466,
  night: 0x262b44,
  black: 0x181425,
  hotpink: 0xff0044,
  plum: 0x68386c,
  magenta: 0xb55088,
  pink: 0xf6757a,
  skin: 0xe8b796,
  skinShade: 0xc28569,
} as const;

export const PALETTE_LIST: number[] = Object.values(E32);

/**
 * 용도별 색 이름. 단계마다 색조를 옮긴다:
 * 그림자 → 파랑·보라 쪽, 하이라이트 → 노랑 쪽 (예: 빨강 코트 = 분홍 → 빨강 → 진홍 → 자주)
 */
export const C = {
  out: E32.black,
  ink: E32.black,
  stone0: E32.night,
  stone1: E32.indigo,
  stone2: E32.slate,
  stone3: E32.steel,
  stone4: E32.silver,
  white: E32.white,

  skin0: E32.sand,
  skin1: E32.skin,
  skin2: E32.skinShade,
  hair0: E32.plum,
  hair1: E32.darkbrown,
  cloth0: E32.blue,
  cloth1: E32.navy,
  cloth2: E32.night,
  // 주인공: 진홍 코트 (명도·채도 높게 → 어두운 배경에서 안 묻힘)
  coat0: E32.orange,
  coat1: E32.red,
  coat2: E32.crimson,
  coat3: E32.plum,
  steel0: E32.white,
  steel1: E32.silver,
  steel2: E32.steel,
  hairS0: E32.white,
  hairS1: E32.silver,
  hairS2: E32.steel,
  pants0: E32.indigo,
  pants1: E32.night,
  leather0: E32.tan,
  leather1: E32.brown,
  gold0: E32.yellow,
  gold1: E32.amber,
  gold2: E32.orange,

  fire0: E32.yellow,
  fire1: E32.orange,
  fire2: E32.crimson,
  water0: E32.cyan,
  water1: E32.blue,
  water2: E32.navy,
  wind0: E32.lime,
  wind1: E32.lime,
  wind2: E32.forest,
  light0: E32.white,
  light1: E32.yellow,
  light2: E32.amber,

  floor0: E32.black,
  floor1: E32.night,
  floor2: E32.indigo,
  grass0: E32.tan,
  grass1: E32.brown,
  grass2: E32.darkbrown,
  blood: E32.red,
  essence: E32.magenta,
  essenceLight: E32.pink,
} as const;

/** 원소 레이어는 회색 4단계로 그리고, 원소별 색 램프로 구워서 바꿔 끼운다 */
export const E0 = 0xffffff;
export const E1 = 0xcdcdcd;
export const E2 = 0x989898;
export const E3 = 0x505050;
export const ELEM_GRAYS = [E0, E1, E2, E3];

/** raw = 회색 단계 그대로 (setTint로 색을 입힐 때) */
export type LookName = Element | 'neutral' | 'arcane' | 'raw';

/** [하이라이트, 중간, 그림자, 외곽선] — 하이라이트는 노랑 쪽, 그림자는 파랑·보라 쪽으로 */
export const ELEMENT_RAMP: Record<LookName, [number, number, number, number]> = {
  fire: [E32.yellow, E32.orange, E32.red, E32.brown],
  water: [E32.cyan, E32.blue, E32.navy, E32.night],
  wind: [E32.yellow, E32.lime, E32.green, E32.teal],
  lightning: [E32.white, E32.yellow, E32.amber, E32.brown],
  neutral: [E32.white, E32.silver, E32.steel, E32.indigo],
  raw: [E0, E1, E2, E3],
  arcane: [E32.pink, E32.magenta, E32.plum, E32.darkbrown],
};

export const ELEMENT_COLOR: Record<Element, number> = {
  fire: E32.orange,
  water: E32.blue,
  wind: E32.lime,
  lightning: E32.yellow,
};

export const ELEMENT_LIGHT: Record<Element, number> = {
  fire: E32.yellow,
  water: E32.cyan,
  wind: E32.lime,
  lightning: E32.white,
};

export const ELEMENT_DARK: Record<Element, number> = {
  fire: E32.crimson,
  water: E32.navy,
  wind: E32.forest,
  lightning: E32.orange,
};

/** 셀아웃: 외곽선은 순검정 대신 안쪽 색의 진한(파랑·보라로 옮긴) 버전 */
export const SELOUT: Record<number, number> = {
  [E32.white]: E32.slate,
  [E32.silver]: E32.slate,
  [E32.steel]: E32.indigo,
  [E32.slate]: E32.night,
  [E32.indigo]: E32.black,
  [E32.night]: E32.black,
  [E32.black]: E32.black,
  [E32.sand]: E32.brown,
  [E32.skin]: E32.brown,
  [E32.skinShade]: E32.brown,
  [E32.peach]: E32.brown,
  [E32.tan]: E32.darkbrown,
  [E32.clay]: E32.brown,
  [E32.rust]: E32.darkbrown,
  [E32.brown]: E32.darkbrown,
  [E32.darkbrown]: E32.black,
  [E32.yellow]: E32.rust,
  [E32.amber]: E32.brown,
  [E32.orange]: E32.brown,
  [E32.red]: E32.plum,
  [E32.hotpink]: E32.plum,
  [E32.pink]: E32.plum,
  [E32.crimson]: E32.darkbrown,
  [E32.magenta]: E32.plum,
  [E32.plum]: E32.darkbrown,
  [E32.cyan]: E32.navy,
  [E32.blue]: E32.navy,
  [E32.navy]: E32.night,
  [E32.lime]: E32.forest,
  [E32.green]: E32.forest,
  [E32.forest]: E32.teal,
  [E32.teal]: E32.black,
};

const lum = (c: number) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
export const luminance = lum;

export const toCss = (c: number): string => '#' + c.toString(16).padStart(6, '0');

/** 두 색을 t(0~1)만큼 섞기 — 원소 색이 서서히 바뀌는 데 사용 */
export function mixColor(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t);
  return (r << 16) | (g << 8) | bl;
}

/** 색에 밝기 배율 곱하기 */
export function scaleColor(c: number, k: number): number {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}
