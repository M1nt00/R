import Phaser from 'phaser';
import { VIEW_W, VIEW_H, COLOR } from '../config';
import { DUMMY, DUMMY_PALETTE, DUMMY_FOOT_Y } from '../art/dummy';

/** 빈 공간 + 가운데 허수아비 */
export class PlayScene extends Phaser.Scene {
  constructor() {
    super('Play');
  }

  create(): void {
    if (!this.textures.exists('dummy')) {
      this.textures.generate('dummy', { data: DUMMY, pixelWidth: 1, palette: DUMMY_PALETTE as unknown as Phaser.Types.Create.Palette });
    }

    this.cameras.main.setBackgroundColor(COLOR.floor);

    const x = VIEW_W / 2;
    const y = Math.round(VIEW_H * 0.6);

    this.add.ellipse(x, y - 1, 20, 6, COLOR.shadow);
    this.add.image(x, y, 'dummy').setOrigin(0.5, DUMMY_FOOT_Y / DUMMY.length);
  }
}
