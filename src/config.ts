/** 게임 내부 해상도 = 실제 렌더 해상도. 캔버스 전체를 정수배로만 확대한다 (스프라이트 개별 확대 금지 → 믹셀 없음) */
export const VIEW_W = 480;
export const VIEW_H = 270;
export const RENDER_SCALE = 1;

export const TILE = 16;
/** 맵 크기(칸). 맵마다 달라서 RoomScene이 맵을 만들 때 setWorldSize로 바꾼다 (import한 쪽도 바뀐 값을 봄) */
export let COLS = 36;
export let ROWS = 21;
export let WORLD_W = COLS * TILE;
export let WORLD_H = ROWS * TILE;
// shortcut: 맵 크기가 전역 하나라 Room 장면 두 개를 동시에 띄우면 안 됨, 그럴 일이 생기면 Terrain이 크기를 갖게
export function setWorldSize(cols: number, rows: number) {
  COLS = cols;
  ROWS = rows;
  WORLD_W = cols * TILE;
  WORLD_H = rows * TILE;
}

/** 한글 픽셀 폰트 (Galmuri, OFL) — 설계 크기 그대로만 쓴다 */
export const FONT_S = 'Galmuri7'; // 8px
export const FONT_M = 'Galmuri9'; // 10px
export const FONT_L = 'Galmuri11B'; // 12px · 24px
export const FONT = FONT_M;

export const DEPTH = {
  floor: 0,
  terrain: 1,
  decal: 2,
  field: 3,
  telegraph: 4,
  shadow: 5,
  actor: 10,
  projectile: 4000,
  debris: 4400,
  light: 4500,
  /** 원소 이펙트(ADD)는 조명 위에서 빛나게 */
  vfx: 5000,
  glow: 5100,
  hud: 5900,
  text: 6000,
  vignette: 6500,
} as const;
