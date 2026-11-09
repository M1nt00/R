import Phaser from 'phaser';
import { E32 } from './palette';

/** 행성 아르고스 (보랏빛 아르곤 구름) 픽셀 그리기 — 메인 화면과 정착지 고르기 화면이 같이 쓴다 */

/** 왼쪽 위 앞에서 오는 빛 (화면 기준, y는 위가 +) */
const LIGHT = (() => {
  const v = [-0.55, 0.6, 0.58];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / l);
})();
const GROUND = [E32.black, E32.night, E32.indigo, E32.slate];
const CLOUD = [E32.darkbrown, E32.plum, E32.magenta, E32.pink];

const hash = (x: number, y: number, z: number) => {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const smooth = (f: number) => f * f * (3 - 2 * f);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 3차원 값 노이즈 (0~1) — 행성 표면 좌표에 붙어 있어서 같이 돈다 */
function noise(x: number, y: number, z: number) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const u = smooth(x - X), v = smooth(y - Y), w = smooth(z - Z);
  return lerp(
    lerp(lerp(hash(X, Y, Z), hash(X + 1, Y, Z), u), lerp(hash(X, Y + 1, Z), hash(X + 1, Y + 1, Z), u), v),
    lerp(lerp(hash(X, Y, Z + 1), hash(X + 1, Y, Z + 1), u), lerp(hash(X, Y + 1, Z + 1), hash(X + 1, Y + 1, Z + 1), u), v),
    w,
  );
}

/** 표면 한 점의 색. (x,y,z) 땅 좌표, (cx,cz) 구름 좌표 (구름만 따로 돌릴 때), lv 밝기 0~3 */
export function surfaceColor(x: number, y: number, z: number, cx: number, cz: number, lv: number): number {
  if (noise(cx * 2.2 + 5, y * 7, cz * 2.2) > 0.56) return CLOUD[lv];
  return GROUND[Math.max(0, Math.min(3, lv - 1 + (noise(x * 3, y * 3, z * 3) > 0.6 ? 1 : 0)))];
}

/** 배경 별 (매번 같은 자리) */
export function addStars(scene: Phaser.Scene) {
  const g = scene.add.graphics();
  const rnd = new Phaser.Math.RandomDataGenerator(['argos']);
  for (let i = 0; i < 90; i++) {
    g.fillStyle(rnd.frac() < 0.2 ? E32.silver : E32.slate, 1);
    g.fillRect(rnd.between(0, scene.scale.width - 1), rnd.between(0, scene.scale.height - 1), 1, 1);
  }
}

export function putColor(data: Uint8ClampedArray, k: number, col: number) {
  data[k] = (col >> 16) & 255;
  data[k + 1] = (col >> 8) & 255;
  data[k + 2] = col & 255;
  data[k + 3] = 255;
}

/**
 * size×size 이미지 가운데에 반지름 r 행성을 그린다. 바깥은 투명, 테두리 1px은 대기 빛.
 * shade(vx, vy, vz, lv): 화면 쪽 단위 벡터(z가 나를 향함)와 밝기 단계로 그 픽셀 색을 돌려준다.
 */
export function drawPlanet(data: Uint8ClampedArray, size: number, r: number, shade: (vx: number, vy: number, vz: number, lv: number) => number) {
  data.fill(0);
  const c = size >> 1;
  for (let py = -r - 1; py <= r + 1; py++) {
    for (let px = -r - 1; px <= r + 1; px++) {
      const d = Math.sqrt(px * px + py * py);
      const k = ((c + py) * size + c + px) * 4;
      if (d > r) {
        // 빛 받는 쪽 테두리는 밝은 보라
        if (d <= r + 1) putColor(data, k, px * LIGHT[0] - py * LIGHT[1] > 0 ? E32.magenta : E32.plum);
        continue;
      }
      const vx = px / r, vy = -py / r, vz = Math.sqrt(Math.max(0, 1 - vx * vx - vy * vy));
      const lam = vx * LIGHT[0] + vy * LIGHT[1] + vz * LIGHT[2];
      putColor(data, k, shade(vx, vy, vz, lam > 0.62 ? 3 : lam > 0.25 ? 2 : lam > -0.12 ? 1 : 0));
    }
  }
}
