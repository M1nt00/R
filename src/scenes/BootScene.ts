import Phaser from 'phaser';
import fontL from 'galmuri/dist/Galmuri11-Bold.woff2?url';
import fontM from 'galmuri/dist/Galmuri9.woff2?url';
import fontS from 'galmuri/dist/Galmuri7.woff2?url';
import { buildHeroSprites } from '../art/heroSprites';
import { buildEnemySprites } from '../art/enemySprites';
import { buildPropSprites } from '../art/propSprites';
import { preloadCustomHero, installCustomHero } from '../art/customArt';
import { preloadBreath } from '../chem/flamethrower';
import { preloadChemFx } from '../chem/fx';
import { loadSamples } from '../audio/sfx';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    preloadCustomHero(this);
    preloadBreath(this);
    preloadChemFx(this);
    loadSamples();
  }

  create(): void {
    buildPropSprites(this);
    buildEnemySprites(this);
    // art/hero/ 에 직접 그린 그림이 있으면 그걸 쓰고, 없을 때만 코드로 그림
    if (installCustomHero(this)) console.info('[art] 직접 그린 주인공 스프라이트 사용');
    else buildHeroSprites(this);
    const start = () => {
      this.scene.start('Room', { hub: true });
      this.scene.launch('UI');
    };
    // 한글 픽셀 폰트를 먼저 불러온 뒤 시작 (실패해도 기본 글꼴로 진행)
    const faces = [new FontFace('Galmuri11B', `url(${fontL})`), new FontFace('Galmuri9', `url(${fontM})`), new FontFace('Galmuri7', `url(${fontS})`)];
    Promise.race([
      Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff)))),
      new Promise((r) => setTimeout(r, 2500)),
    ])
      .catch(() => undefined)
      .finally(start);
  }
}
