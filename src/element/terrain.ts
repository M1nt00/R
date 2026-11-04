import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import type { Element } from './types';
import { COLS, ROWS, TILE, DEPTH } from '../config';
import { DATA, type TerrainFx, type TerrainReactionDef } from './data';
import { hex } from '../art/palette';
import { playSfx } from '../audio/sfx';

export type TileKind = 'floor' | 'wall' | 'puddle' | 'grass' | 'channel' | 'ash';

export interface TileInfo {
  kind: TileKind;
  fx: TerrainFx;
  dirX: number;
  dirY: number;
}

const DIRS: Record<string, [number, number]> = { '>': [1, 0], '<': [-1, 0], '^': [0, -1], v: [0, 1] };
const hash = (n: number): number => (Math.imul(n ^ 0x9e3779b9, 2654435761) >>> 0) % 1000;
const ASH_REGROW = 15;

/**
 * 방의 지형. 지형 타일도 원소를 가지고 있어서 공격 원소와 반응한다.
 * 레이아웃 문자: # 벽, . 바닥, ~ 물웅덩이, , 마른 풀, > < ^ v 바람 통로(방향)
 */
export class Terrain {
  readonly base: TileKind[] = [];
  readonly dirX: number[] = [];
  readonly dirY: number[] = [];
  readonly tempPuddle: number[] = [];
  readonly fx: TerrainFx[] = [];
  readonly fxT: number[] = [];
  readonly spreadT: number[] = [];
  readonly ashT: number[] = [];
  private readonly dyn: Phaser.GameObjects.Graphics;
  private readonly reactionByKey = new Map<string, TerrainReactionDef>();
  private lastText = new Map<string, number>();

  constructor(private readonly s: RoomScene, layout: string[]) {
    for (const r of DATA.terrain) this.reactionByKey.set(`${r.terrain}|${r.element}`, r);
    for (let row = 0; row < ROWS; row++) {
      const line = (layout[row] ?? '').padEnd(COLS, '#');
      for (let col = 0; col < COLS; col++) {
        const ch = row === 0 || row === ROWS - 1 || col === 0 || col === COLS - 1 ? '#' : line[col];
        let kind: TileKind = 'floor';
        let d: [number, number] = [0, 0];
        if (ch === '#') kind = 'wall';
        else if (ch === '~') kind = 'puddle';
        else if (ch === ',') kind = 'grass';
        else if (DIRS[ch]) {
          kind = 'channel';
          d = DIRS[ch];
        }
        this.base.push(kind);
        this.dirX.push(d[0]);
        this.dirY.push(d[1]);
        this.tempPuddle.push(0);
        this.fx.push('none');
        this.fxT.push(0);
        this.spreadT.push(0);
        this.ashT.push(0);
      }
    }
    this.drawStatic();
    this.dyn = s.add.graphics().setDepth(DEPTH.terrain);
  }

  idx(col: number, row: number): number {
    return row * COLS + col;
  }

  tileOf(x: number, y: number): number {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return -1;
    return this.idx(c, r);
  }

  kindAt(i: number): TileKind {
    const b = this.base[i];
    if (this.tempPuddle[i] > 0 && (b === 'floor' || b === 'ash' || b === 'grass')) return 'puddle';
    return b;
  }

  isWallAt(x: number, y: number): boolean {
    const i = this.tileOf(x, y);
    return i < 0 || this.base[i] === 'wall';
  }

  /** 반지름 r짜리 원이 벽과 겹치는지 */
  isBlocked(x: number, y: number, r: number): boolean {
    return (
      this.isWallAt(x - r, y - r) || this.isWallAt(x + r, y - r) || this.isWallAt(x - r, y + r) || this.isWallAt(x + r, y + r)
    );
  }

  infoAt(x: number, y: number): TileInfo {
    const i = this.tileOf(x, y);
    if (i < 0) return { kind: 'wall', fx: 'none', dirX: 0, dirY: 0 };
    return { kind: this.kindAt(i), fx: this.fx[i], dirX: this.dirX[i], dirY: this.dirY[i] };
  }

  /** 물 스킬: 물웅덩이 장판을 직접 만든다 */
  addPuddle(x: number, y: number, radius: number, duration: number): void {
    this.forTilesInCircle(x, y, radius, (i) => {
      const b = this.base[i];
      if (b === 'floor' || b === 'ash' || b === 'grass' || b === 'puddle') {
        if (b === 'grass' && this.fx[i] === 'burning') this.fx[i] = 'none';
        this.tempPuddle[i] = Math.max(this.tempPuddle[i], duration);
      }
    });
  }

  /** 원소 공격이 지형에 닿았을 때 — 지형 반응 */
  applyElement(x: number, y: number, radius: number, el: Element): void {
    this.forTilesInCircle(x, y, radius, (i) => {
      const kind = this.kindAt(i);
      const fx = this.fx[i];
      if (kind === 'puddle' && el === 'fire' && fx === 'ice') {
        this.flood(i, 'none', 0); // 얼음 녹이기
        return;
      }
      if (kind === 'wall' || kind === 'floor' || kind === 'ash') return;
      const def = this.reactionByKey.get(`${kind}|${el}`);
      if (!def) return;
      if (kind === 'puddle' && fx === 'ice') return;
      if (kind === 'grass') {
        if (fx === 'burning') return;
        this.fx[i] = 'burning';
        this.fxT[i] = def.duration;
        this.spreadT[i] = 0.3;
      } else {
        const fresh = fx !== def.fx;
        this.flood(i, def.fx, def.duration);
        if (!fresh) return;
      }
      this.announce(def, x, y);
    });
  }

  private announce(def: TerrainReactionDef, x: number, y: number) {
    const now = this.s.gameTime;
    if (now - (this.lastText.get(def.name) ?? -9) < 0.8) return;
    this.lastText.set(def.name, now);
    const color = def.fx === 'ice' ? hex('e') : def.fx === 'electric' || def.fx === 'current' ? hex('l') : hex('c');
    this.s.vfx.floatText(x, y - 10, def.name, color, 8, 0.8, 12);
    playSfx('terrain');
  }

  /** 같은 종류로 이어진 지형 전체에 효과 (웅덩이 전체가 전기장 등) */
  private flood(start: number, fx: TerrainFx, duration: number): void {
    const kind = this.kindAt(start);
    const seen = new Set<number>([start]);
    const queue = [start];
    while (queue.length) {
      const i = queue.pop()!;
      this.fx[i] = fx;
      this.fxT[i] = duration;
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const n = this.idx(nc, nr);
        if (!seen.has(n) && this.kindAt(n) === kind) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }

  private forTilesInCircle(x: number, y: number, r: number, fn: (i: number) => void): void {
    const c0 = Math.max(0, Math.floor((x - r) / TILE));
    const c1 = Math.min(COLS - 1, Math.floor((x + r) / TILE));
    const r0 = Math.max(0, Math.floor((y - r) / TILE));
    const r1 = Math.min(ROWS - 1, Math.floor((y + r) / TILE));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const nx = Phaser.Math.Clamp(x, col * TILE, col * TILE + TILE);
        const ny = Phaser.Math.Clamp(y, row * TILE, row * TILE + TILE);
        if ((nx - x) ** 2 + (ny - y) ** 2 <= r * r) fn(this.idx(col, row));
      }
    }
  }

  update(dt: number): void {
    const n = COLS * ROWS;
    for (let i = 0; i < n; i++) {
      if (this.tempPuddle[i] > 0) {
        this.tempPuddle[i] -= dt;
        if (this.tempPuddle[i] <= 0) {
          this.tempPuddle[i] = 0;
          if (this.base[i] !== 'puddle' && (this.fx[i] === 'electric' || this.fx[i] === 'ice')) this.fx[i] = 'none';
        }
      }
      if (this.base[i] === 'ash') {
        this.ashT[i] -= dt;
        if (this.ashT[i] <= 0) this.base[i] = 'grass';
      }
      if (this.fx[i] === 'none') continue;
      this.fxT[i] -= dt;
      if (this.fx[i] === 'burning') {
        if (this.spreadT[i] > 0) {
          this.spreadT[i] -= dt;
          if (this.spreadT[i] <= 0) this.spreadFire(i);
        }
        if (this.fxT[i] <= 0) {
          this.base[i] = 'ash';
          this.ashT[i] = ASH_REGROW;
        }
      }
      if (this.fxT[i] <= 0) this.fx[i] = 'none';
    }
  }

  private spreadFire(i: number) {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const n = this.idx(nc, nr);
      if (this.kindAt(n) === 'grass' && this.fx[n] === 'none') {
        this.fx[n] = 'burning';
        this.fxT[n] = 3;
        this.spreadT[n] = 0.35;
      }
    }
  }

  private drawStatic(): void {
    const g = this.s.add.graphics().setDepth(DEPTH.floor);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = this.idx(col, row);
        const x = col * TILE;
        const y = row * TILE;
        if (this.base[i] === 'wall') {
          g.fillStyle(hex('a'));
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle(0x4a5270);
          g.fillRect(x, y, TILE, 4);
          g.fillStyle(hex('0'));
          g.fillRect(x, y + TILE - 2, TILE, 2);
        } else {
          g.fillStyle((col + row) % 2 === 0 ? hex('n') : hex('o'));
          g.fillRect(x, y, TILE, TILE);
          const h = hash(i);
          if (h % 5 === 0) {
            g.fillStyle(0x342e42);
            g.fillRect(x + (h % 11) + 2, y + ((h >> 3) % 11) + 2, 2, 1);
          }
        }
      }
    }
  }

  draw(time: number): void {
    const g = this.dyn;
    g.clear();
    const n = COLS * ROWS;
    for (let i = 0; i < n; i++) {
      const kind = this.kindAt(i);
      if (kind === 'floor' || kind === 'wall') continue;
      const x = (i % COLS) * TILE;
      const y = Math.floor(i / COLS) * TILE;
      const fx = this.fx[i];
      const h = hash(i);
      const flick = hash(i + Math.floor(time * 12) * 977);

      if (kind === 'puddle') {
        if (fx === 'ice') {
          g.fillStyle(0xc8f4ff, 0.9);
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle(0xffffff, 0.9);
          g.fillRect(x + (h % 9) + 2, y + ((h >> 2) % 9) + 3, 4, 1);
          continue;
        }
        const fade = this.base[i] !== 'puddle' && this.tempPuddle[i] < 1 ? this.tempPuddle[i] : 1;
        g.fillStyle(hex('g'), 0.8 * fade);
        g.fillRect(x, y, TILE, TILE);
        g.fillStyle(hex('f'), 0.7 * fade);
        const wob = Math.floor(Math.sin(time * 2 + h) * 2);
        g.fillRect(x + (h % 8) + 2 + wob, y + ((h >> 3) % 10) + 3, 4, 1);
        if (fx === 'electric') {
          g.fillStyle(hex('l'), 0.25 + (flick % 30) / 100);
          g.fillRect(x, y, TILE, TILE);
          if (flick % 3 === 0) {
            g.lineStyle(1, hex('k'), 1);
            g.beginPath();
            g.moveTo(x + 2, y + 8);
            g.lineTo(x + 6, y + 4);
            g.lineTo(x + 9, y + 11);
            g.lineTo(x + 14, y + 6);
            g.strokePath();
          }
        }
      } else if (kind === 'grass') {
        g.fillStyle(0x6b5f30);
        g.fillRect(x, y, TILE, TILE);
        g.fillStyle(0xb9a659);
        for (let k = 0; k < 4; k++) {
          const hx = (hash(i * 7 + k) % 13) + 1;
          const hy = (hash(i * 13 + k) % 11) + 3;
          g.fillRect(x + hx, y + hy, 1, 3);
          g.fillRect(x + hx + 1, y + hy - 1, 1, 2);
        }
        if (fx === 'burning') {
          g.fillStyle(hex('d'), 0.75);
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle(flick % 2 ? hex('c') : hex('b'), 1);
          g.fillRect(x + (flick % 10) + 2, y + 4 + (flick % 5), 3, 5);
          g.fillRect(x + ((flick >> 2) % 10) + 2, y + 6 + ((flick >> 3) % 5), 2, 4);
        }
      } else if (kind === 'ash') {
        g.fillStyle(0x2f2a33);
        g.fillRect(x, y, TILE, TILE);
        g.fillStyle(0x4d4652);
        g.fillRect(x + (h % 12) + 1, y + ((h >> 3) % 12) + 1, 2, 1);
      } else if (kind === 'channel') {
        g.fillStyle(0x1d3436, 0.9);
        g.fillRect(x, y, TILE, TILE);
        const dx = this.dirX[i];
        const dy = this.dirY[i];
        const speed = fx === 'current' ? 120 : 40;
        const off = (time * speed + (h % 16)) % TILE;
        const col = fx === 'fireChannel' ? hex('b') : fx === 'current' ? hex('k') : hex('i');
        g.fillStyle(col, fx === 'none' ? 0.45 : 0.95);
        if (dx !== 0) {
          const off2 = (off + 8) % TILE;
          g.fillRect(dx > 0 ? x + off : x + TILE - off - 4, y + 4 + (h % 3), 4, 1);
          g.fillRect(dx > 0 ? x + off2 : x + TILE - off2 - 3, y + 10 + (h % 3), 3, 1);
        } else {
          const py = dy > 0 ? y + off : y + TILE - off;
          g.fillRect(x + 4 + (h % 3), py, 1, 4);
        }
        if (fx === 'fireChannel') {
          g.fillStyle(hex('c'), 0.35 + (flick % 20) / 100);
          g.fillRect(x, y, TILE, TILE);
        } else if (fx === 'current') {
          g.fillStyle(hex('l'), 0.2 + (flick % 30) / 100);
          g.fillRect(x, y, TILE, TILE);
        }
      }
    }
  }
}
