import Phaser from 'phaser';
import { PlayScene } from './scenes/PlayScene';
import { VIEW_W, VIEW_H } from './config';

/** 창에 들어가는 가장 큰 정수 배율 */
const integerZoom = () => Math.max(1, Math.floor(Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H)));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: '#181425',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH, zoom: integerZoom() },
  scene: [PlayScene],
});

window.addEventListener('resize', () => game.scale.setZoom(integerZoom()));
