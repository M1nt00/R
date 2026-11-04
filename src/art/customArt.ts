import type Phaser from 'phaser';
import { Px, NONE, registerSheet } from './pixel';
import { DIRS, ORDER, DURS, HERO_SOURCE, HERO_SHEET_COLS, heroCell } from './heroSprites';

/**
 * 직접 그린 주인공 스프라이트 교체.
 * art/hero/hero_body.png 와 art/hero/hero_elem.png 가 있으면 빌드에 포함되어 코드 생성 그림 대신 쓰인다.
 * (없으면 이 glob은 빈 객체 → 기존 그림 그대로)
 */
const files = import.meta.glob('../../art/hero/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const find = (name: string) => Object.entries(files).find(([k]) => k.endsWith(`/${name}`))?.[1];

const BODY_URL = find('hero_body.png');
const ELEM_URL = find('hero_elem.png');

export const hasCustomHero = (): boolean => !!(BODY_URL && ELEM_URL);

/**
 * 칸 크기는 시트 가로 / 6 으로 정한다 (32 → 192px, 48 → 288px 시트).
 * 발밑선은 칸 아래에서 6px 위 (32칸 = y26, 48칸 = y42), 가로 중심은 칸 가운데.
 */
export const HERO_CELL = { size: 32, foot: 26 };
export const heroOriginY = (): number => (HERO_CELL.foot + 1) / HERO_CELL.size;

export function preloadCustomHero(scene: Phaser.Scene): void {
  if (!hasCustomHero()) return;
  scene.load.image('custom_hero_body_src', BODY_URL!);
  scene.load.image('custom_hero_elem_src', ELEM_URL!);
}

/** 그리드 시트를 게임이 쓰는 프레임 순서로 잘라서 hero_body / hero_elem_raw 로 등록 */
export function installCustomHero(scene: Phaser.Scene): boolean {
  if (!hasCustomHero() || !scene.textures.exists('custom_hero_body_src')) return false;
  const read = (key: string): Px[] => {
    const img = scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const cell = Math.max(32, Math.round(img.width / HERO_SHEET_COLS));
    const frames: Px[] = [];
    DIRS.forEach((_, di) => {
      ORDER.forEach((anim, ai) => {
        for (let f = 0; f < DURS[anim].length; f++) {
          const { col, row } = heroCell(di, ai, f);
          const p = new Px(cell, cell);
          for (let y = 0; y < cell; y++) {
            for (let x = 0; x < cell; x++) {
              const sx = col * cell + x;
              const sy = row * cell + y;
              if (sx >= cv.width || sy >= cv.height) continue;
              const o = (sy * cv.width + sx) * 4;
              if (data[o + 3] < 128) continue;
              p.d[y * cell + x] = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
            }
          }
          frames.push(p);
        }
      });
    });
    return frames;
  };
  const bodies = read('custom_hero_body_src');
  HERO_CELL.size = bodies[0].w;
  HERO_CELL.foot = bodies[0].w - 6;
  const elems = read('custom_hero_elem_src');
  registerSheet(scene, 'hero_body', bodies);
  registerSheet(scene, 'hero_elem_raw', elems);
  // 다른 이름도 같은 그림으로 (원소별 구운 버전은 쓰지 않음)
  registerSheet(scene, 'hero_elem', elems);
  HERO_SOURCE.custom = true;
  return bodies.some((b) => b.d.some((c) => c !== NONE));
}
