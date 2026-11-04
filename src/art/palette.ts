import type { Element } from '../element/types';

/**
 * 고정 팔레트. 모든 스프라이트·타일·UI가 이 색만 쓴다 → 색이 통일되어 정돈돼 보임.
 * (프로토타입 24색에서 피부·옷·금속 단계를 늘려 32색 근처로 확장)
 */
export const C = {
  out: 0x0e0b14, // 외곽선
  ink: 0x1b1626,
  stone0: 0x2a2338,
  stone1: 0x3e3552,
  stone2: 0x5c5274,
  stone3: 0x887ea3,
  stone4: 0xc2bad6,
  white: 0xffffff,

  skin0: 0xf6d2b0,
  skin1: 0xd99a7a,
  skin2: 0x9e5f52,
  hair0: 0x6b3f5a,
  hair1: 0x44233b,
  cloth0: 0x86b0e0,
  cloth1: 0x4f74b4,
  cloth2: 0x2f4580,
  coat0: 0x5f74b8,
  coat1: 0x36437c,
  coat2: 0x1f274c,
  steel0: 0xe2deef,
  steel1: 0xa29cbc,
  steel2: 0x645e80,
  hairS0: 0xe4e0f2,
  hairS1: 0xa9a3c6,
  hairS2: 0x6f6990,
  pants0: 0x3d3658,
  pants1: 0x28233d,
  leather0: 0xb07a4c,
  leather1: 0x6e4630,
  gold0: 0xffe08a,
  gold1: 0xd49a3a,

  fire0: 0xffc070,
  fire1: 0xff6a3d,
  fire2: 0xb0302a,
  water0: 0xa8e6ff,
  water1: 0x3fa7ff,
  water2: 0x245fb0,
  wind0: 0xc6ffd9,
  wind1: 0x5fe0a0,
  wind2: 0x2a9168,
  light0: 0xfff3a0,
  light1: 0xffd447,
  light2: 0xc08a1e,

  floor0: 0x1c1726,
  floor1: 0x241e31,
  floor2: 0x2d263c,
  grass0: 0xc9b46a,
  grass1: 0x9a8642,
  grass2: 0x5e5128,
  blood: 0xff5566,
} as const;

/** 원소 레이어는 흰색 3단계로 그리고 setTint로 원소색을 입힌다 (음영 유지) */
export const E0 = 0xffffff;
export const E1 = 0xcdcdcd;
export const E2 = 0x989898;

export const ELEMENT_COLOR: Record<Element, number> = {
  fire: C.fire1,
  water: C.water1,
  wind: C.wind1,
  lightning: C.light1,
};

export const ELEMENT_LIGHT: Record<Element, number> = {
  fire: C.fire0,
  water: C.water0,
  wind: C.wind0,
  lightning: C.light0,
};

export const ELEMENT_DARK: Record<Element, number> = {
  fire: C.fire2,
  water: C.water2,
  wind: C.wind2,
  lightning: C.light2,
};

export const toCss = (c: number): string => '#' + c.toString(16).padStart(6, '0');
