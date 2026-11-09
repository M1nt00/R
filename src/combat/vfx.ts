import Phaser from 'phaser';
import { DEPTH, FONT_S, FONT_M, FONT_L, RENDER_SCALE, WORLD_W, WORLD_H } from '../config';
import { toCss } from '../art/palette';
import { NONE, SPRITE_PIXELS } from '../art/pixel';
import type { Actor } from '../entities/actor';
import type { Lighting } from './lighting';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: number;
  life: number;
  max: number;
  ground: boolean;
}


/** 이펙트 모음: 파티클, 픽셀 잔해, 그을음 자국, 광채, 텍스트(풀링) */
export class Vfx {
  private readonly emitters = new Map<number, Emitter>();
  private readonly textPool: Phaser.GameObjects.Text[] = [];
  private debris: Debris[] = [];
  private readonly debrisG: Phaser.GameObjects.Graphics;
  private readonly decals: Phaser.GameObjects.RenderTexture;
  private readonly decalStamp: Phaser.GameObjects.Image;
  lighting: Lighting | null = null;

  constructor(private readonly s: Phaser.Scene) {
    this.debrisG = s.add.graphics().setDepth(DEPTH.debris);
    this.decals = s.add.renderTexture(0, 0, WORLD_W, WORLD_H).setOrigin(0).setDepth(DEPTH.decal);
    this.decalStamp = s.make.image({ key: 'scorch', add: false });
  }

  private emitter(color: number): Emitter {
    let e = this.emitters.get(color);
    if (!e) {
      e = this.s.add.particles(0, 0, 'px', {
        lifespan: { min: 200, max: 480 },
        speed: { min: 25, max: 115 },
        scale: { start: 1, end: 0 },
        alpha: { start: 1, end: 0.3 },
        tint: color,
        blendMode: Phaser.BlendModes.ADD,
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

  // ───── 픽셀 잔해 (가짜 높이 z + 중력) ─────
  spark(x: number, y: number, color: number, n: number, speed = 70, up = 60): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.debris.push({
        x,
        y,
        z: 4,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6,
        vz: up * (0.4 + Math.random() * 0.8),
        color,
        life: 0,
        max: 0.35 + Math.random() * 0.35,
        ground: false,
      });
    }
  }

  dust(x: number, y: number, n = 3): void {
    for (let i = 0; i < n; i++) {
      this.debris.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 2,
        z: 1,
        vx: (Math.random() - 0.5) * 20,
        vy: (Math.random() - 0.5) * 6,
        vz: 10 + Math.random() * 15,
        color: 0x5a6988,
        life: 0,
        max: 0.3 + Math.random() * 0.2,
        ground: false,
      });
    }
  }

  /** 사망 분해: 지금 보이는 프레임의 픽셀을 그대로 파티클로 흩뿌린다 */
  disintegrate(a: Actor, _tint: number): void {
    const img = a.bodyImg;
    const bodyFrames = SPRITE_PIXELS.get(img.texture.key);
    const elemFrames = SPRITE_PIXELS.get(a.elemImg.texture.key);
    if (!bodyFrames) return;
    const fi = Number(img.frame.name) || 0;
    const body = bodyFrames[fi];
    const elem = elemFrames?.[fi];
    const step = body.w > 48 ? 2 : 1;
    const ox = img.x - img.displayOriginX;
    const oy = img.y - img.displayOriginY;
    for (let y = 0; y < body.h; y += step) {
      for (let x = 0; x < body.w; x += step) {
        const e = elem ? elem.get(x, y) : NONE;
        const b = body.get(x, y);
        const c = e !== NONE ? e : b;
        if (c === NONE) continue;
        const wx = ox + (img.flipX ? body.w - 1 - x : x);
        const height = img.y - (oy + y);
        const dx = wx - img.x;
        this.debris.push({
          x: wx,
          y: img.y,
          z: height,
          vx: dx * 4 + (Math.random() - 0.5) * 50,
          vy: (Math.random() - 0.5) * 40,
          vz: 20 + Math.random() * 70,
          color: c,
          life: 0,
          max: 0.7 + Math.random() * 0.8,
          ground: false,
        });
      }
    }
  }

  updateDebris(dt: number): void {
    const g = this.debrisG;
    g.clear();
    for (const d of this.debris) {
      d.life += dt;
      if (!d.ground) {
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vz -= 260 * dt;
        d.z += d.vz * dt;
        if (d.z <= 0) {
          d.z = 0;
          if (Math.abs(d.vz) > 40) {
            d.vz = -d.vz * 0.35;
            d.vx *= 0.5;
            d.vy *= 0.5;
          } else d.ground = true;
        }
      }
      const fade = d.life > d.max * 0.6 ? 1 - (d.life - d.max * 0.6) / (d.max * 0.4) : 1;
      g.fillStyle(d.color, Math.max(0, fade));
      g.fillRect(Math.round(d.x), Math.round(d.y - d.z), 1, 1);
    }
    this.debris = this.debris.filter((d) => d.life < d.max);
  }

  // ───── 바닥 자국 ─────
  scorch(x: number, y: number, size = 1, alpha = 0.8): void {
    this.decalStamp.setPosition(x, y).setScale(size, size * 0.8).setAlpha(alpha).setRotation(Math.random() * 6);
    this.decals.draw(this.decalStamp);
  }

  splat(x: number, y: number, color: number, n = 6, spread = 8): void {
    for (let i = 0; i < n; i++) {
      this.decals.fill(color, 0.5, Math.round(x + (Math.random() - 0.5) * spread * 2), Math.round(y + (Math.random() - 0.5) * spread), 1, 1);
    }
  }

  /** 원소 이펙트: ADD 블렌드로 그려서 조명 위에서 빛나게 */
  private animate(dur: number, draw: (g: Phaser.GameObjects.Graphics, t: number) => void, depth: number = DEPTH.vfx, add = true) {
    const g = this.s.add.graphics().setDepth(depth);
    if (add) g.setBlendMode(Phaser.BlendModes.ADD);
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

  /** 더하기 광채 (조명 위에 얹혀 빛나 보임) */
  glow(x: number, y: number, r: number, color: number, dur = 0.25, alpha = 0.9): void {
    // 부드러운 광채라 반지름 그대로 키움 (32px 그림 = 반지름 16)
    const sc = r / 16;
    const img = this.s.add.image(Math.round(x), Math.round(y), 'glow', '0').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.glow);
    img.setScale(sc).setAlpha(alpha);
    this.s.tweens.add({ targets: img, alpha: 0, duration: dur * 1000, onComplete: () => img.destroy() });
  }

  ring(x: number, y: number, r0: number, r1: number, color: number, dur = 0.25, width = 1.5): void {
    x = Math.round(x);
    y = Math.round(y);
    this.animate(dur, (g, t) => {
      const r = Math.round(r0 + (r1 - r0) * t);
      g.lineStyle(Math.max(1, Math.round(width * (1 - t * 0.5))), color, 1 - t);
      g.strokeEllipse(x, y, r * 2, Math.round(r * 1.5));
    });
  }

  /** 검 궤적: 휘두른 방향의 반대쪽 끝부터 사라지는 초승달 (reverse = 올려베기) */
  slash(x: number, y: number, angle: number, range: number, half: number, color: number, heavy = false, reverse = false): void {
    const a0 = angle - half;
    const a1 = angle + half;
    this.animate(heavy ? 0.16 : 0.12, (g, t) => {
      const r = range * (0.85 + 0.15 * t);
      const cut = half * 2 * t * 0.7;
      const s0 = reverse ? a0 : a0 + cut;
      const s1 = reverse ? a1 - cut : a1;
      // 처음 30%는 밝은 원색 그대로, 이후 단계적으로 사라짐
      g.fillStyle(color, t < 0.3 ? 1 : 0.6 * (1 - t));
      g.beginPath();
      g.arc(x, y, r, s0, s1, false);
      g.arc(x, y, r * ((heavy ? 0.72 : 0.8) + 0.14 * t), s1, s0, true);
      g.closePath();
      g.fillPath();
      g.lineStyle(1, 0xffffff, 0.95 * (1 - t));
      g.beginPath();
      g.arc(x, y, r, s0 + (s1 - s0) * 0.2, s1 - (s1 - s0) * 0.05, false);
      g.strokePath();
    });
    // 칼끝 불티
    const tip = reverse ? a0 : a1;
    this.spark(x + Math.cos(tip) * range, y + 8 + Math.sin(tip) * range, color, heavy ? 6 : 3, 60, 40);
    this.lighting?.flash(x + Math.cos(angle) * range * 0.5, y + Math.sin(angle) * range * 0.5, range * 1.6, color, 0.15);
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
    this.lighting?.flash((x1 + x2) / 2, (y1 + y2) / 2, 50, color, 0.15);
  }

  strike(x: number, y: number, color: number, r: number): void {
    const pts = this.jagged(x, y - 120, x, y, 8, 5);
    this.animate(0.22, (g, t) => {
      g.lineStyle(3, color, 1 - t);
      g.strokePoints(pts);
      g.lineStyle(1, 0xffffff, 1 - t);
      g.strokePoints(pts);
      g.fillStyle(color, 0.45 * (1 - t));
      g.fillEllipse(x, y, r * 2 * (0.6 + 0.4 * t), r * 1.5 * (0.6 + 0.4 * t));
    });
    this.spark(x, y, color, 10, 80, 70);
    this.glow(x, y - 6, r * 1.4, color, 0.25);
    this.lighting?.flash(x, y, r * 6, color, 0.22);
    this.scorch(x, y, 0.6, 0.5);
  }

  explosion(x: number, y: number, r: number, color: number): void {
    this.animate(0.32, (g, t) => {
      const k = Math.max(0, 1 - t * 3);
      g.fillStyle(0xffffff, 0.7 * k);
      g.fillEllipse(x, y, r * 1.2, r * 0.9);
      g.fillStyle(color, 0.4 * (1 - t));
      g.fillEllipse(x, y, r * 2 * (0.4 + 0.6 * t), r * 1.5 * (0.4 + 0.6 * t));
      g.lineStyle(2, color, 1 - t);
      g.strokeEllipse(x, y, r * 2 * (0.5 + 0.5 * t), r * 1.5 * (0.5 + 0.5 * t));
    });
    this.burst(x, y, color, 14);
    this.spark(x, y, color, 16, 120, 90);
    this.glow(x, y, r * 1.2, color, 0.3);
    this.lighting?.flash(x, y, r * 5, color, 0.35);
    this.scorch(x, y, r / 18, 0.75);
  }

  /** 바닥 경고 영역: 테두리 + 차오르는 채움. cancel()로 취소 */
  telegraph(x: number, y: number, r: number, color: number, dur: number): { cancel: () => void } {
    const g = this.s.add.graphics().setDepth(DEPTH.telegraph);
    const tw = this.s.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur * 1000,
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 1;
        g.clear();
        this.lighting?.add(x, y, r * 2.5, color, 0.35 + 0.3 * t);
        g.lineStyle(1, color, 0.6 + 0.4 * Math.sin(t * 30));
        g.strokeEllipse(x, y, r * 2, r * 1.5);
        g.fillStyle(color, 0.12 + 0.28 * t);
        g.fillEllipse(x, y, r * 2 * t, r * 1.5 * t);
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

  /** 잔상: 원소색으로 채워 ADD로 겹침 → 탁해지지 않고 빛나는 꼬리 */
  afterimage(a: Actor, color: number, alpha = 0.5): void {
    for (const src of [a.bodyImg, a.elemImg]) {
      const img = this.s.add
        .image(src.x, src.y, src.texture.key, src.frame.name)
        .setOrigin(src.originX, src.originY)
        .setFlipX(src.flipX)
        .setScale(src.scaleX, src.scaleY)
        .setTintFill(color)
        .setAlpha(alpha)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.vfx - 1);
      this.s.tweens.add({ targets: img, alpha: 0, duration: 200, ease: 'Stepped', easeParams: [4], onComplete: () => img.destroy() });
    }
  }

  private text(): Phaser.GameObjects.Text {
    const t =
      this.textPool.pop() ??
      this.s.add
        .text(0, 0, '', { fontFamily: FONT_S, fontSize: '8px' })
        .setOrigin(0.5)
        .setResolution(RENDER_SCALE)
        .setShadow(1, 1, '#181425', 0, false, true);
    t.setActive(true).setVisible(true).setAlpha(1).setScale(1).setDepth(DEPTH.text);
    return t;
  }

  private release(t: Phaser.GameObjects.Text) {
    t.setActive(false).setVisible(false);
    this.textPool.push(t);
  }

  /** size: 8(작게) · 10(보통) · 12(굵게) · 24 — 픽셀 폰트 설계 크기만 사용, 확대 연출 없음 */
  floatText(x: number, y: number, str: string, color: number, size = 8, dur = 0.7, rise = 12, pop = false): void {
    const t = this.text();
    const family = size >= 12 ? FONT_L : size >= 10 ? FONT_M : FONT_S;
    const px = size >= 24 ? 24 : size >= 12 ? 12 : size >= 10 ? 10 : 8;
    t.setFontFamily(family).setFontSize(px).setText(str).setColor(toCss(color)).setPosition(Math.round(x), Math.round(y));
    if (pop) {
      // 크기 대신 위로 톡 튀는 움직임으로 강조 (정수 좌표 유지)
      t.y += 4;
    }
    this.s.tweens.add({
      targets: t,
      y: Math.round(y - rise),
      duration: dur * 1000,
      ease: 'Cubic.Out',
      onUpdate: () => t.setY(Math.round(t.y)),
      onComplete: () => this.release(t),
    });
    this.s.tweens.add({ targets: t, alpha: 0, delay: dur * 600, duration: dur * 400 });
  }

  number(x: number, y: number, dmg: number, color: number, big: boolean): void {
    const v = Math.max(1, Math.round(dmg));
    this.floatText(x + Phaser.Math.Between(-5, 5), y, String(v), color, 8, big ? 0.7 : 0.5, big ? 14 : 10, big);
  }

  reactionText(x: number, y: number, name: string, color: number, tier: number): void {
    this.floatText(x, y, name, color, tier === 2 ? 12 : 10, 0.9, 16, true);
  }
}
