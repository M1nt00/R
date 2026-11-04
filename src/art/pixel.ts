import Phaser from 'phaser';

/** 투명 */
export const NONE = -1;

/** CPU에서 픽셀을 찍는 작은 버퍼. 모든 스프라이트·타일을 코드로 생성한다. */
export class Px {
  readonly d: Int32Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.d = new Int32Array(w * h).fill(NONE);
  }

  set(x: number, y: number, c: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = c;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return NONE;
    return this.d[y * this.w + x];
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  hline(x0: number, x1: number, y: number, c: number): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: number): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
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

  /** 픽셀아트용 원 (가장자리가 덜 각지게 약간 보정) */
  disc(cx: number, cy: number, r: number, c: number | ((dx: number, dy: number) => number)): void {
    const rr = r * r + r * 0.6;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy <= rr) this.set(cx + dx, cy + dy, typeof c === 'number' ? c : c(dx, dy));
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number | ((dx: number, dy: number) => number)): void {
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        const v = (dx * dx) / (rx * rx + rx * 0.5) + (dy * dy) / (ry * ry + ry * 0.5);
        if (v <= 1) this.set(cx + dx, cy + dy, typeof c === 'number' ? c : c(dx, dy));
      }
    }
  }

  /** 이미 칠해진 픽셀만 바꾼다 (음영 덧칠용) */
  shade(fn: (x: number, y: number, c: number) => number): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.d[y * this.w + x];
        if (c !== NONE) this.d[y * this.w + x] = fn(x, y, c);
      }
    }
  }

  blit(src: Px, ox: number, oy: number): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.d[y * src.w + x];
        if (c !== NONE) this.set(ox + x, oy + y, c);
      }
    }
  }

  flipX(): Px {
    const p = new Px(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) p.d[y * this.w + x] = this.d[y * this.w + (this.w - 1 - x)];
    return p;
  }
}

/** 본체+원소 레이어 합집합 둘레에 1px 외곽선을 본체 레이어에 그린다 */
export function outline(body: Px, elem: Px | null, color: number): void {
  const w = body.w;
  const h = body.h;
  const filled = (x: number, y: number) => body.get(x, y) !== NONE || (elem !== null && elem.get(x, y) !== NONE);
  const add: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) add.push(y * w + x);
    }
  }
  for (const i of add) body.d[i] = color;
}

/** 스프라이트 픽셀 데이터 보관 — 사망 시 픽셀 파티클 분해에 사용 */
export const SPRITE_PIXELS = new Map<string, Px[]>();

/** 프레임들을 가로로 이어 붙여 텍스처로 등록. 프레임 이름은 '0', '1', ... */
export function registerSheet(scene: Phaser.Scene, key: string, frames: Px[]): void {
  const fw = frames[0].w;
  const fh = frames[0].h;
  const canvas = document.createElement('canvas');
  canvas.width = fw * frames.length;
  canvas.height = fh;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, fh);
  frames.forEach((f, i) => {
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const c = f.d[y * fw + x];
        if (c === NONE) continue;
        const o = (y * canvas.width + i * fw + x) * 4;
        img.data[o] = (c >> 16) & 255;
        img.data[o + 1] = (c >> 8) & 255;
        img.data[o + 2] = c & 255;
        img.data[o + 3] = 255;
      }
    }
  });
  ctx.putImageData(img, 0, 0);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, canvas)!;
  frames.forEach((_, i) => tex.add(String(i), 0, i * fw, 0, fw, fh));
  SPRITE_PIXELS.set(key, frames);
}

/** 알파가 있는 텍스처(빛·광채)용 */
export function registerCanvas(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
}

/** 결정적 의사난수 (타일 무늬가 매번 같게) */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export const hash2 = (x: number, y: number, s = 0): number =>
  (Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177) >>> 0) % 1000;
