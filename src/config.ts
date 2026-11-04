/** 게임 내부 해상도(월드 좌표). 기획서 규격: 480 × 270 */
export const VIEW_W = 480;
export const VIEW_H = 270;
/** 캔버스는 2배로 그려서 한글 텍스트를 선명하게 유지 (월드는 그대로 480×270) */
export const RENDER_SCALE = 2;

export const TILE = 16;
export const COLS = 30;
export const ROWS = 17;

export const FONT =
  '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

export const DEPTH = {
  floor: 0,
  terrain: 1,
  field: 2,
  telegraph: 3,
  shadow: 4,
  actor: 10,
  projectile: 4000,
  vfx: 5000,
  hud: 5500,
  text: 6000,
} as const;
