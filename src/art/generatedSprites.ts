import Phaser from 'phaser';
import { hex } from './palette';

/**
 * 프로토타입용 코드 생성 아트 (1~3단계는 도형 아트로 충분).
 * - 캐릭터·적: 32×32 프레임, 본체 레이어 + 원소 레이어(흰색 → 코드에서 setTint)
 * - 투사체: 기획서 예시처럼 문자열 그리드로 생성 (문자 하나 = 팔레트 색 하나, . = 투명)
 * 나중에 손그림으로 바꿀 때 같은 키·같은 규격으로 덮어쓰면 코드 수정 없음.
 */

type Rect = [color: string, x: number, y: number, w: number, h: number];

function drawLayered(scene: Phaser.Scene, key: string, body: Rect[], elem: Rect[]): void {
  const size = 32;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // 외곽선 1px (본체 + 원소 레이어 모두 감쌈)
  g.fillStyle(hex('0'));
  for (const [, x, y, w, h] of [...body, ...elem]) g.fillRect(x - 1, y - 1, w + 2, h + 2);
  for (const [c, x, y, w, h] of body) {
    g.fillStyle(hex(c));
    g.fillRect(x, y, w, h);
  }
  g.generateTexture(`${key}_body`, size, size);
  g.clear();
  for (const [c, x, y, w, h] of elem) {
    g.fillStyle(hex(c));
    g.fillRect(x, y, w, h);
  }
  g.generateTexture(`${key}_elem`, size, size);
  g.destroy();
}

const FIRE_BOLT = ['..22..', '.2332.', '233332', '.2332.', '..22..'];
const ORB = ['.222.', '23332', '23332', '23332', '.222.'];
const SHARD = ['.3.', '333', '.3.'];

export function generateSprites(scene: Phaser.Scene): void {
  const tex = scene.textures;
  // 2·3번 색만 쓰는 흰색 계열 → setTint로 원소색을 입힌다
  const tintable = { '2': '#c8c8c8', '3': '#ffffff' } as unknown as Phaser.Types.Create.Palette;
  tex.generate('bolt', { data: FIRE_BOLT, pixelWidth: 1, palette: tintable });
  tex.generate('orb', { data: ORB, pixelWidth: 1, palette: tintable });
  tex.generate('shard', { data: SHARD, pixelWidth: 1, palette: tintable });

  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff);
  g.fillRect(0, 0, 2, 2);
  g.generateTexture('px', 2, 2);
  g.clear();
  g.fillStyle(0x000000, 0.35);
  g.fillEllipse(8, 3, 16, 6);
  g.generateTexture('shadow', 16, 6);
  g.destroy();

  // 플레이어 (오른쪽을 봄, 왼쪽은 좌우 반전)
  drawLayered(
    scene,
    'player',
    [
      ['6', 12, 6, 8, 3],
      ['1', 12, 9, 8, 5],
      ['2', 12, 13, 8, 1],
      ['0', 16, 10, 1, 2],
      ['0', 18, 10, 1, 2],
      ['5', 11, 15, 10, 6],
      ['4', 11, 15, 2, 6],
      ['6', 12, 21, 3, 4],
      ['6', 17, 21, 3, 4],
    ],
    [
      ['7', 10, 13, 12, 2],
      ['7', 7, 14, 4, 5],
      ['7', 9, 18, 2, 3],
      ['7', 21, 18, 2, 3],
    ],
  );

  // 돌격형: 뿔 달린 짐승
  drawLayered(
    scene,
    'enemy_charger',
    [
      ['a', 8, 12, 16, 11],
      ['8', 9, 13, 13, 2],
      ['0', 19, 16, 2, 2],
      ['0', 22, 16, 1, 2],
      ['a', 9, 23, 3, 2],
      ['a', 20, 23, 3, 2],
    ],
    [
      ['7', 19, 8, 2, 4],
      ['7', 23, 9, 2, 3],
      ['7', 10, 11, 8, 2],
      ['7', 19, 16, 1, 1],
    ],
  );

  // 사수형: 두건 쓴 시전자 + 지팡이 구슬
  drawLayered(
    scene,
    'enemy_shooter',
    [
      ['a', 12, 7, 8, 7],
      ['0', 14, 10, 5, 3],
      ['6', 11, 14, 10, 10],
      ['a', 11, 14, 2, 10],
      ['3', 23, 12, 1, 12],
    ],
    [
      ['7', 16, 11, 1, 1],
      ['7', 18, 11, 1, 1],
      ['7', 22, 8, 3, 4],
      ['7', 11, 22, 10, 2],
    ],
  );

  // 자폭형: 둥근 폭탄
  drawLayered(
    scene,
    'enemy_bomber',
    [
      ['a', 10, 12, 12, 12],
      ['a', 9, 14, 14, 8],
      ['8', 11, 13, 4, 2],
      ['3', 15, 8, 2, 4],
    ],
    [
      ['7', 13, 16, 6, 4],
      ['7', 14, 15, 4, 6],
      ['7', 15, 6, 2, 2],
    ],
  );
}
