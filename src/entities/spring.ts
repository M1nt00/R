import type Phaser from 'phaser';

interface Pt {
  x: number;
  y: number;
  px: number;
  py: number;
}

/**
 * 2차 동작: 머리카락·리본 같은 끈을 스프링(버렛 적분 + 거리 제약)으로 시뮬레이션.
 * 몸(앵커)이 움직이면 늦게 따라오며 흔들린다. 그리기는 정수 좌표 1px 사각형 → 픽셀이 섞이지 않음.
 */
export class SpringChain {
  private readonly pts: Pt[] = [];

  constructor(
    count: number,
    private readonly seg: number,
    x: number,
    y: number,
    private readonly damping = 0.86,
  ) {
    for (let i = 0; i < count; i++) this.pts.push({ x, y: y + i * seg, px: x, py: y + i * seg });
  }

  reset(x: number, y: number): void {
    this.pts.forEach((p, i) => {
      p.x = p.px = x;
      p.y = p.py = y + i * this.seg;
    });
  }

  update(ax: number, ay: number, dt: number, gx: number, gy: number): void {
    const p0 = this.pts[0];
    p0.px = p0.x;
    p0.py = p0.y;
    p0.x = ax;
    p0.y = ay;
    const dt2 = dt * dt;
    for (let i = 1; i < this.pts.length; i++) {
      const p = this.pts[i];
      const vx = (p.x - p.px) * this.damping;
      const vy = (p.y - p.py) * this.damping;
      p.px = p.x;
      p.py = p.y;
      p.x += vx + gx * dt2;
      p.y += vy + gy * dt2;
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < this.pts.length; i++) {
        const a = this.pts[i - 1];
        const b = this.pts[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const k = (d - this.seg) / d;
        b.x -= dx * k;
        b.y -= dy * k;
      }
    }
  }

  /** colors[i] = i번째 마디 색, widths[i] = 두께(1~2). 외곽선은 셀아웃 색 */
  draw(g: Phaser.GameObjects.Graphics, colors: number[], widths: number[], outlineColor: number): void {
    const pix: { x: number; y: number; c: number; w: number }[] = [];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      let x0 = Math.round(a.x);
      let y0 = Math.round(a.y);
      const x1 = Math.round(b.x);
      const y1 = Math.round(b.y);
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let guard = 0; guard < 64; guard++) {
        pix.push({ x: x0, y: y0, c: colors[Math.min(i - 1, colors.length - 1)], w: widths[Math.min(i - 1, widths.length - 1)] });
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    }
    g.fillStyle(outlineColor, 1);
    for (const p of pix) g.fillRect(p.x - 1, p.y - 1, p.w + 2, p.w + 2);
    for (const p of pix) {
      g.fillStyle(p.c, 1);
      g.fillRect(p.x, p.y, p.w, p.w);
    }
  }
}
