// 개발용: 생성된 스프라이트 시트를 확대해서 보여준다 (npm run dev → /dev/preview.html)
import Phaser from 'phaser';
import { SPRITE_PIXELS } from '../src/art/pixel';
import { buildHeroSprites } from '../src/art/heroSprites';
import { buildEnemySprites } from '../src/art/enemySprites';
import { buildPropSprites } from '../src/art/propSprites';

const params = new URLSearchParams(location.search);
const only = params.get('sheet');
const scale = Number(params.get('scale') ?? 3);

class Preview extends Phaser.Scene {
  create() {
    buildHeroSprites(this);
    buildEnemySprites(this);
    buildPropSprites(this);
    const mods = (window as unknown as { extraBuilders?: ((s: Phaser.Scene) => void)[] }).extraBuilders ?? [];
    for (const m of mods) m(this);
    let y = 8;
    for (const [key, frames] of SPRITE_PIXELS) {
      if (only && !key.startsWith(only)) continue;
      if (key.includes('_elem')) continue;
      const elemKey = key.replace(/_body$/, '_elem_fire');
      const hasElem = key.endsWith('_body') && SPRITE_PIXELS.has(elemKey);
      this.add.text(4, y, key, { fontSize: '12px', color: '#fff' });
      y += 14;
      const fw = frames[0].w * scale;
      const perRow = Math.max(1, Math.floor(1200 / (fw + 4)));
      frames.forEach((_, i) => {
        const x = 4 + (i % perRow) * (fw + 4);
        const yy = y + Math.floor(i / perRow) * (frames[0].h * scale + 4);
        this.add.image(x, yy, key, String(i)).setOrigin(0).setScale(scale);
        if (hasElem) this.add.image(x, yy, elemKey, String(i)).setOrigin(0).setScale(scale);
      });
      y += Math.ceil(frames.length / perRow) * (frames[0].h * scale + 4) + 8;
    }
  }
}

new Phaser.Game({ type: Phaser.AUTO, width: 1240, height: 2400, backgroundColor: '#262b44', pixelArt: true, scene: [Preview] });
