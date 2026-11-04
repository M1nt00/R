import Phaser from 'phaser';
import { DEPTH, WORLD_W, WORLD_H } from '../config';

interface Flash {
  x: number;
  y: number;
  r: number;
  color: number;
  t: number;
  dur: number;
}

/**
 * 조명: 주변광으로 어둡게 칠한 레이어 위에 빛을 더해서, 곱하기(MULTIPLY)로 화면에 얹는다.
 * 화로·원소 공격·반응 폭발·불타는 풀이 실제로 방을 밝힌다.
 */
export class Lighting {
  private readonly rt: Phaser.GameObjects.RenderTexture;
  private readonly stamp: Phaser.GameObjects.Image;
  private lights: { x: number; y: number; r: number; color: number; a: number }[] = [];
  private flashes: Flash[] = [];
  ambient: number;

  constructor(scene: Phaser.Scene, ambient: number) {
    this.ambient = ambient;
    this.rt = scene.add.renderTexture(0, 0, WORLD_W, WORLD_H).setOrigin(0).setDepth(DEPTH.light);
    this.rt.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.stamp = scene.make.image({ key: 'light', add: false }).setBlendMode(Phaser.BlendModes.ADD);
  }

  add(x: number, y: number, r: number, color: number, a = 1): void {
    this.lights.push({ x, y, r, color, a });
  }

  flash(x: number, y: number, r: number, color: number, dur = 0.25): void {
    this.flashes.push({ x, y, r, color, t: 0, dur });
  }

  update(dt: number): void {
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < f.dur);
  }

  render(): void {
    const rt = this.rt;
    rt.clear();
    rt.fill(this.ambient, 1);
    rt.beginDraw();
    const draw = (x: number, y: number, r: number, color: number, a: number) => {
      this.stamp.setPosition(x, y).setScale(r / 32).setTint(color).setAlpha(Math.min(1, a));
      rt.batchDraw(this.stamp);
    };
    for (const l of this.lights) draw(l.x, l.y, l.r, l.color, l.a);
    for (const f of this.flashes) {
      const k = 1 - f.t / f.dur;
      draw(f.x, f.y, f.r * (0.7 + 0.3 * k), f.color, k);
    }
    rt.endDraw();
    this.lights = [];
  }
}
