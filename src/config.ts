/** 게임 내부 해상도(월드 좌표). 기획서 규격: 480 × 270 */
export const VIEW_W = 480;
export const VIEW_H = 270;
/** 캔버스는 2배로 그려서 한글 텍스트를 선명하게 유지 (월드는 그대로 480×270) */
export const RENDER_SCALE = 2;

export const TILE = 16;
export const COLS = 30;
export const ROWS = 17;

/** 한글 픽셀 폰트 (Galmuri11 Bold, OFL) */
export const FONT = 'Galmuri, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

export const DEPTH = {
  floor: 0,
  terrain: 1,
  decal: 2,
  field: 3,
  telegraph: 4,
  shadow: 5,
  actor: 10,
  projectile: 4000,
  vfx: 5000,
  light: 5800,
  glow: 5850,
  hud: 5900,
  text: 6000,
  vignette: 6500,
} as const;
