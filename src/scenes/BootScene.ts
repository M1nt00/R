import Phaser from 'phaser';
import fontUrl from 'galmuri/dist/Galmuri11-Bold.woff2?url';
import { buildHeroSprites } from '../art/heroSprites';
import { buildEnemySprites } from '../art/enemySprites';
import { buildPropSprites } from '../art/propSprites';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    buildPropSprites(this);
    buildHeroSprites(this);
    buildEnemySprites(this);
    const start = () => {
      this.scene.start('Room', { hub: true });
      this.scene.launch('UI');
    };
    // 한글 픽셀 폰트를 먼저 불러온 뒤 시작 (실패해도 기본 글꼴로 진행)
    const face = new FontFace('Galmuri', `url(${fontUrl})`);
    Promise.race([
      face.load().then((f) => {
        document.fonts.add(f);
      }),
      new Promise((r) => setTimeout(r, 2500)),
    ])
      .catch(() => undefined)
      .finally(start);
  }
}
