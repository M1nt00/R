import Phaser from 'phaser';
import { generateSprites } from '../art/generatedSprites';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    generateSprites(this);
    this.scene.start('Room');
    this.scene.launch('UI');
  }
}
