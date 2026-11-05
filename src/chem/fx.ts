import Phaser from 'phaser';
import { DEPTH } from '../config';
import boomSUrl from '../../art/fx/boom_s.png?url';
import boomLUrl from '../../art/fx/boom_l.png?url';
import boomWUrl from '../../art/fx/boom_w.png?url';
import boomNaUrl from '../../art/fx/boom_na.png?url';
import glassUrl from '../../art/fx/shatter_glass.png?url';
import splashUrl from '../../art/fx/shatter_splash.png?url';

/**
 * 한 번 재생하고 사라지는 그림 이펙트. 그림은 art/fx/<이름>.aseprite → 가로 시트 png.
 * ox·oy = 이펙트 기준점(폭발은 불덩이 가운데, 병은 떨어진 바닥)이 그림에서 있는 자리. durs는 aseprite 프레임 시간과 같게.
 */
const BOOM = [0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.12];
const SHATTER = [0.04, 0.05, 0.06, 0.07, 0.08, 0.1];
const FX = {
  boom_s: { url: boomSUrl, w: 90, h: 109, ox: 45, oy: 64, durs: BOOM },
  boom_l: { url: boomLUrl, w: 144, h: 175, ox: 72, oy: 103, durs: BOOM },
  boom_w: { url: boomWUrl, w: 84, h: 102, ox: 42, oy: 60, durs: BOOM },
  boom_na: { url: boomNaUrl, w: 90, h: 109, ox: 45, oy: 64, durs: BOOM },
  shatter_glass: { url: glassUrl, w: 40, h: 30, ox: 20, oy: 21, durs: SHATTER },
  shatter_splash: { url: splashUrl, w: 40, h: 30, ox: 20, oy: 21, durs: SHATTER },
};
export type FxKey = keyof typeof FX;

export function preloadChemFx(scene: Phaser.Scene): void {
  for (const [key, d] of Object.entries(FX)) scene.load.spritesheet(key, d.url, { frameWidth: d.w, frameHeight: d.h });
}

/** (x, y)에 기준점을 맞춰 한 번 재생. tint는 흰~회색 그림에 색을 곱함. 트윈으로 넘겨서 히트스톱 동안은 멈춘다 */
export function playFx(s: Phaser.Scene, key: FxKey, x: number, y: number, tint?: number, depth: number = DEPTH.vfx): void {
  const d = FX[key];
  const spr = s.add.sprite(Math.round(x), Math.round(y), key, 0).setOrigin(d.ox / d.w, d.oy / d.h).setDepth(depth);
  if (tint !== undefined) spr.setTint(tint);
  const ends = d.durs.map((_, i) => d.durs.slice(0, i + 1).reduce((a, b) => a + b, 0));
  const total = ends[ends.length - 1];
  s.tweens.addCounter({
    from: 0,
    to: total,
    duration: total * 1000,
    onUpdate: (tw) => {
      const i = ends.findIndex((e) => (tw.getValue() ?? total) < e);
      spr.setFrame(i < 0 ? ends.length - 1 : i);
    },
    onComplete: () => spr.destroy(),
  });
}
