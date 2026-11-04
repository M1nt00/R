import Phaser from 'phaser';
import { DEPTH, FONT, RENDER_SCALE } from '../config';
import { toCss } from '../art/palette';
import type { Actor } from '../entities/actor';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

/** 이펙트 모음. 피해 숫자 텍스트는 오브젝트 풀로 재사용. */
export class Vfx {
  private readonly emitters = new Map<number, Emitter>();
  private readonly textPool: Phaser.GameObjects.Text[] = [];

  constructor(private readonly s: Phaser.Scene) {}

  private emitter(color: number): Emitter {
    let e = this.emitters.get(color);
    if (!e) {
      e = this.s.add.particles(0, 0, 'px', {
        lifespan: { min: 180, max: 450 },
        speed: { min: 25, max: 110 },
        scale: { start: 1, end: 0 },
        alpha: { start: 1, end: 0.3 },
        tint: color,
        emitting: false,
      });
      e.setDepth(DEPTH.vfx);
      this.emitters.set(color, e);
    }
    return e;
  }

  burst(x: number, y: number, color: number, count = 10): void {
    this.emitter(color).explode(count, x, y);
  }

  private animate(dur: number, draw: (g: Phaser.GameObjects.Graphics, t: number) => void, depth: number = DEPTH.vfx) {
    const g = this.s.add.graphics().setDepth(depth);
    draw(g, 0);
    this.s.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur * 1000,
      onUpdate: (tw) => {
        g.clear();
        draw(g, tw.getValue() ?? 1);
      },
      onComplete: () => g.destroy(),
    });
    return g;
  }

  ring(x: number, y: number, r0: number, r1: number, color: number, dur = 0.25, width = 1.5): void {
    this.animate(dur, (g, t) => {
      g.lineStyle(width, color, 1 - t);
      g.strokeCircle(x, y, r0 + (r1 - r0) * t);
    });
  }

  slash(x: number, y: number, angle: number, range: number, half: number, color: number, heavy = false): void {
    const a0 = angle - half;
    const a1 = angle + half;
    this.animate(heavy ? 0.16 : 0.12, (g, t) => {
      const r = range * (0.85 + 0.15 * t);
      g.fillStyle(color, 0.75 * (1 - t));
      g.beginPath();
      g.arc(x, y, r, a0, a1, false);
      g.arc(x, y, r * (0.55 + 0.3 * t), a1, a0, true);
      g.closePath();
      g.fillPath();
      g.lineStyle(1, 0xffffff, 0.9 * (1 - t));
      g.beginPath();
      g.arc(x, y, r, a0 + half * 0.2, a1 - half * 0.2, false);
      g.strokePath();
    });
  }

  private jagged(x1: number, y1: number, x2: number, y2: number, segs: number, amp: number): Phaser.Math.Vector2[] {
    const pts: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(x1, y1)];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const o = (Math.random() * 2 - 1) * amp;
      pts.push(new Phaser.Math.Vector2(x1 + dx * t + nx * o, y1 + dy * t + ny * o));
    }
    pts.push(new Phaser.Math.Vector2(x2, y2));
    return pts;
  }

  bolt(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const pts = this.jagged(x1, y1, x2, y2, 6, 4);
    this.animate(0.18, (g, t) => {
      g.lineStyle(2, color, 1 - t);
      g.strokePoints(pts);
      g.lineStyle(1, 0xffffff, 1 - t);
      g.strokePoints(pts);
    });
  }

  strike(x: number, y: number, color: number, r: number): void {
    const pts = this.jagged(x, y - 90, x, y, 7, 5);
    this.animate(0.2, (g, t) => {
      g.lineStyle(3, color, 1 - t);
      g.strokePoints(pts);
      g.lineStyle(1, 0xffffff, 1 - t);
      g.strokePoints(pts);
      g.fillStyle(color, 0.45 * (1 - t));
      g.fillCircle(x, y, r * (0.6 + 0.4 * t));
    });
    this.burst(x, y, color, 8);
  }

  explosion(x: number, y: number, r: number, color: number): void {
    this.animate(0.3, (g, t) => {
      g.fillStyle(0xffffff, 0.6 * (1 - t * 3 > 0 ? 1 - t * 3 : 0));
      g.fillCircle(x, y, r * 0.6);
      g.fillStyle(color, 0.35 * (1 - t));
      g.fillCircle(x, y, r * (0.4 + 0.6 * t));
      g.lineStyle(2, color, 1 - t);
      g.strokeCircle(x, y, r * (0.5 + 0.5 * t));
    });
    this.burst(x, y, color, 16);
  }

  /** 바닥 경고 영역: 원 테두리 + 차오르는 채움. cancel()로 취소 가능 */
  telegraph(x: number, y: number, r: number, color: number, dur: number): { cancel: () => void } {
    const g = this.s.add.graphics().setDepth(DEPTH.telegraph);
    const tw = this.s.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur * 1000,
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 1;
        g.clear();
        g.lineStyle(1, color, 0.9);
        g.strokeCircle(x, y, r);
        g.fillStyle(color, 0.12 + 0.25 * t);
        g.fillCircle(x, y, r * t);
      },
      onComplete: () => g.destroy(),
    });
    return {
      cancel: () => {
        tw.stop();
        g.destroy();
      },
    };
  }

  afterimage(a: Actor, color: number): void {
    for (const src of [a.bodyImg, a.elemImg]) {
      const img = this.s.add
        .image(src.x, src.y, src.texture.key)
        .setOrigin(src.originX, src.originY)
        .setFlipX(src.flipX)
        .setScale(src.scaleX, src.scaleY)
        .setTintFill(color)
        .setAlpha(0.45)
        .setDepth(src.depth - 0.5);
      this.s.tweens.add({ targets: img, alpha: 0, duration: 220, onComplete: () => img.destroy() });
    }
  }

  private text(): Phaser.GameObjects.Text {
    const t =
      this.textPool.pop() ??
      this.s.add
        .text(0, 0, '', { fontFamily: FONT, fontStyle: 'bold', stroke: '#120e18', strokeThickness: 2 })
        .setOrigin(0.5)
        .setResolution(RENDER_SCALE);
    t.setActive(true).setVisible(true).setAlpha(1).setScale(1).setDepth(DEPTH.text);
    return t;
  }

  private release(t: Phaser.GameObjects.Text) {
    t.setActive(false).setVisible(false);
    this.textPool.push(t);
  }

  floatText(x: number, y: number, str: string, color: number, size = 8, dur = 0.7, rise = 12, pop = false): void {
    const t = this.text();
    t.setText(str).setFontSize(size).setColor(toCss(color)).setPosition(x, y);
    if (pop) {
      t.setScale(1.6);
      this.s.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.Out' });
    }
    this.s.tweens.add({
      targets: t,
      y: y - rise,
      duration: dur * 1000,
      ease: 'Cubic.Out',
      onComplete: () => this.release(t),
    });
    this.s.tweens.add({ targets: t, alpha: 0, delay: dur * 600, duration: dur * 400 });
  }

  number(x: number, y: number, dmg: number, color: number, big: boolean): void {
    const v = Math.max(1, Math.round(dmg));
    this.floatText(x + Phaser.Math.Between(-4, 4), y, String(v), color, big ? 8 : 6, 0.55, 10);
  }

  reactionText(x: number, y: number, name: string, color: number, tier: number): void {
    this.floatText(x, y, name, color, tier === 2 ? 11 : tier === 1 ? 10 : 8, 0.9, 14, true);
  }
}
