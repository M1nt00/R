import type { Element } from '../element/types';

/**
 * 고정 팔레트 24색 (원소색 4계열 포함).
 * 문자 하나 = 색 하나. textures.generate()의 문자열 그리드에서 그대로 쓴다.
 */
export const PALETTE: Record<string, string> = {
  '0': '#14121c', // 외곽선
  '1': '#f2d3b3', // 피부 밝음
  '2': '#d39b7a', // 피부 중간
  '3': '#8e5a48', // 피부/나무 어둠
  '4': '#6a7bb0', // 옷 밝음
  '5': '#46518a', // 옷 중간
  '6': '#2c3260', // 옷 어둠
  '7': '#ffffff', // 원소 레이어 (코드에서 setTint)
  '8': '#a9b4c8', // 돌 밝음
  'a': '#363c52', // 돌 어둠
  'b': '#ffc070', // 불 밝음
  'c': '#ff6a3d', // 불 중간
  'd': '#b0302a', // 불 어둠
  'e': '#a8e6ff', // 물 밝음
  'f': '#3fa7ff', // 물 중간
  'g': '#245fb0', // 물 어둠
  'h': '#c6ffd9', // 바람 밝음
  'i': '#5fe0a0', // 바람 중간
  'j': '#2a9168', // 바람 어둠
  'k': '#fff3a0', // 번개 밝음
  'l': '#ffd447', // 번개 중간
  'm': '#c08a1e', // 번개 어둠
  'n': '#221e2b', // 바닥 어둠
  'o': '#2b2636', // 바닥 밝음
};

export const hex = (key: string): number => parseInt(PALETTE[key].slice(1), 16);

export const ELEMENT_COLOR: Record<Element, number> = {
  fire: hex('c'),
  water: hex('f'),
  wind: hex('i'),
  lightning: hex('l'),
};

export const ELEMENT_LIGHT: Record<Element, number> = {
  fire: hex('b'),
  water: hex('e'),
  wind: hex('h'),
  lightning: hex('k'),
};

export const toCss = (c: number): string => '#' + c.toString(16).padStart(6, '0');
