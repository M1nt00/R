import type Phaser from 'phaser';
import { Px, NONE, registerSheet } from './pixel';
import { DIRS, ORDER, dursOf, HERO_ANIMS, HERO_SOURCE, HERO_SHEET_COLS, LEFT_DIR, heroCell } from './heroSprites';
import SODIUM_URL from '../../art/minerals/sodium_ore.png?url';
import IODINE_URL from '../../art/minerals/iodine_ore.png?url';
import PICKAXE_URL from '../../art/minerals/pickaxe.png?url';
import VENT_URL from '../../art/minerals/h2_vent.png?url';

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
 * 칸 크기는 시트 가로 / HERO_SHEET_COLS(12) 로 정한다 (32 → 384px, 48 → 576px 시트).
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
    // 아래·위·옆 줄, 그다음 선택 줄인 왼쪽 옆모습 (프레임 수는 옆과 같음)
    const dirs = [...DIRS.map((dir, di) => ({ dir, di })), { dir: 'side' as const, di: LEFT_DIR }];
    dirs.forEach(({ dir, di }) => {
      ORDER.forEach((anim, ai) => {
        for (let f = 0; f < dursOf(anim, dir).length; f++) {
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
  // 원본 시트는 잘라 낸 뒤엔 쓰지 않음 (576×1152 두 장이 GPU 메모리에 남지 않게)
  scene.textures.remove('custom_hero_body_src');
  scene.textures.remove('custom_hero_elem_src');
  registerSheet(scene, 'hero_body', bodies);
  registerSheet(scene, 'hero_elem_raw', elems);
  // 다른 이름도 같은 그림으로 (원소별 구운 버전은 쓰지 않음)
  registerSheet(scene, 'hero_elem', elems);
  HERO_SOURCE.custom = true;
  HERO_SOURCE.left = bodies.slice(HERO_ANIMS.idle_left.start).some((b) => b.d.some((c) => c !== NONE));
  return bodies.some((b) => b.d.some((c) => c !== NONE));
}

/** art/lab/oxygen_tower_qv.png (40×80 × 8프레임, 쿼터뷰, 바닥 2×2칸) — 지켜야 하는 산소탑. art/lab/tower_qv.py가 그림 (옛 정면 그림은 oxygen_tower.png) */
const TANK_URL = (import.meta.glob('../../art/lab/oxygen_tower_qv.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)[
  '../../art/lab/oxygen_tower_qv.png'
];
/** art/lab/slime.png (16×16 × 4프레임) */
const SLIME_URL = (import.meta.glob('../../art/lab/slime.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)[
  '../../art/lab/slime.png'
];
export function preloadLabArt(scene: Phaser.Scene): void {
  if (TANK_URL) scene.load.spritesheet('oxygen_tower', TANK_URL, { frameWidth: 40, frameHeight: 80 });
  // 먼지 평원 광물 (Sprite Fusion): 24×24 칸마다 모양 하나, 아래 줄(23)에 맞춤. 고른 번호는 art/minerals/wip/sf_1/ids.txt
  scene.load.spritesheet('sodium_ore', SODIUM_URL, { frameWidth: 24, frameHeight: 24 });
  scene.load.spritesheet('iodine_ore', IODINE_URL, { frameWidth: 24, frameHeight: 24 });
  scene.load.image('pickaxe', PICKAXE_URL); // 16×16, 손잡이 끝 (1.5, 13.5), 오른쪽 날 끝 (13, 11)
  scene.load.image('h2_hole', VENT_URL); // 24×24 수소 구멍
  // Actor는 본체·원소 레이어 두 장을 쓴다. 슬라임은 원소 레이어가 없어서 같은 그림을 넣고 숨긴다
  if (SLIME_URL) for (const k of ['slime_body', 'slime_elem']) scene.load.spritesheet(k, SLIME_URL, { frameWidth: 16, frameHeight: 16 });
}
