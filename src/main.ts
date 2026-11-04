import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { RoomScene } from './scenes/RoomScene';
import { UIScene } from './scenes/UIScene';
import { VIEW_W, VIEW_H, RENDER_SCALE } from './config';

const params = new URLSearchParams(location.search);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW_W * RENDER_SCALE,
  height: VIEW_H * RENDER_SCALE,
  backgroundColor: '#0d0b12',
  pixelArt: true,
  roundPixels: true,
  // 테스트 환경(프레임이 매우 낮음)에서만 프레임 간격 보정을 끈다
  fps: params.has('maxdt') ? { smoothStep: false } : undefined,
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, RoomScene, UIScene],
});

// 개발 중 콘솔에서 상태 확인용
(window as unknown as { game: Phaser.Game }).game = game;
