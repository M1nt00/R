// 개발용: 지정한 주인공 프레임만 크게 한 줄로 (?f=0,15,16&tint=f77622&scale=6)
import Phaser from 'phaser';
import { buildHeroSprites, HERO_ANIMS } from '../src/art/heroSprites';
const q = new URLSearchParams(location.search);
const scale = Number(q.get('scale') ?? 6);
const tint = Number('0x' + (q.get('tint') ?? 'f77622'));
const names = (q.get('a') ?? 'idle_down:0,attack_down:0,attack_down:1,attack_down:2,idle_side:0,run_side:2,attack2_side:1,idle_up:0,cast_up:1,roll_side:2,death_down:2').split(',');
class S extends Phaser.Scene {
  create() {
    buildHeroSprites(this);
    names.forEach((n, i) => {
      const [anim, fi] = n.split(':');
      const f = String(HERO_ANIMS[anim].start + Number(fi));
      const x = 8 + i * (32 * scale + 6);
      this.add.image(x, 8, 'hero_body', f).setOrigin(0).setScale(scale);
      this.add.image(x, 8, 'hero_elem_raw', f).setOrigin(0).setScale(scale).setTint(tint);
    });
  }
}
new Phaser.Game({ type: Phaser.AUTO, width: 8 + names.length * (32 * scale + 6), height: 32 * scale + 16, backgroundColor: '#262b44', pixelArt: true, scene: [S] });
