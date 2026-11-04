/** 게임 내부 해상도 = 실제 렌더 해상도. 캔버스 전체를 정수배로만 확대한다 (스프라이트 개별 확대 금지 → 믹셀 없음) */
export const VIEW_W = 480;
export const VIEW_H = 270;
export const RENDER_SCALE = 1;

export const TILE = 16;
/** 방은 화면보다 조금 커서 카메라가 따라다닌다 */
export const COLS = 36;
export const ROWS = 21;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

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
