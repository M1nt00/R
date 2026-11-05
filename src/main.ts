import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { RoomScene } from './scenes/RoomScene';
import { UIScene } from './scenes/UIScene';
import { VIEW_W, VIEW_H } from './config';

const params = new URLSearchParams(location.search);

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
  // 테스트 환경(프레임이 매우 낮음)에서만 프레임 간격 보정을 끈다
  fps: params.has('maxdt') ? { smoothStep: false } : undefined,
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH, zoom: integerZoom() },
  scene: [BootScene, RoomScene, UIScene],
});

window.addEventListener('resize', () => game.scale.setZoom(integerZoom()));

// 개발 중 콘솔에서 상태 확인용
(window as unknown as { game: Phaser.Game }).game = game;
