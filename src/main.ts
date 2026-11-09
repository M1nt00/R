import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { ZoneScene } from './scenes/ZoneScene';
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
  // 소리는 전부 audio/sfx.ts가 직접 냄 — Phaser가 오디오 장치를 하나 더 만들지 않게
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH, zoom: integerZoom() },
  scene: [BootScene, TitleScene, ZoneScene, RoomScene, UIScene],
});

// index.html의 "게임이 시작되지 않았어요" 안내: 로딩이 2초를 넘겨 떴더라도 여기까지 왔으면 치움
document.getElementById('notice')?.remove();

window.addEventListener('resize', () => game.scale.setZoom(integerZoom()));

// 개발 중 콘솔에서 상태 확인용
(window as unknown as { game: Phaser.Game }).game = game;
