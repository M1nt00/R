import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import type { Element } from './types';
import { COLS, ROWS, TILE, DEPTH } from '../config';
import { DATA, type TerrainFx, type TerrainReactionDef } from './data';
import { C } from '../art/palette';
import { paintRoom, type Theme } from '../art/tileset';
import { hash2 } from '../art/pixel';
import { playSfx } from '../audio/sfx';
import type { Lighting } from '../combat/lighting';

export type TileKind = 'floor' | 'wall' | 'puddle' | 'grass' | 'channel' | 'ash';

export interface TileInfo {
  kind: TileKind;
  fx: TerrainFx;
  dirX: number;
  dirY: number;
}

const DIRS: Record<string, [number, number]> = { '>': [1, 0], '<': [-1, 0], '^': [0, -1], v: [0, 1] };
const ASH_REGROW = 18;

interface PuddleInst {
  tiles: number[];
  t: number;
}

/**
 * 방의 지형. 지형 타일도 원소를 가지고 있어서 공격 원소와 반응한다.
 * 고정 부분(바닥·벽·웅덩이·통로)은 한 장으로 굽고, 풀·재·임시 웅덩이·지형 효과는 매 프레임 그린다.
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
  private puddles: PuddleInst[] = [];
  private readonly dyn: Phaser.GameObjects.Graphics;
  private readonly reactionByKey = new Map<string, TerrainReactionDef>();
  private readonly lastText = new Map<string, number>();

  constructor(
    private readonly s: RoomScene,
    readonly layout: string[],
    theme: Theme,
  ) {
    for (const r of DATA.terrain) this.reactionByKey.set(`${r.terrain}|${r.element}`, r);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const ch = layout[row]?.[col] ?? '#';
        let kind: TileKind = 'floor';
        let d: [number, number] = [0, 0];
        if (ch === '#' || ch === 'o' || ch === 'b') kind = 'wall';
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
    paintRoom(s, 'room_static', layout, theme);
    s.add.image(0, 0, 'room_static', '0').setOrigin(0).setDepth(DEPTH.floor);
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

  isBlocked(x: number, y: number, r: number): boolean {
    return this.isWallAt(x - r, y - r) || this.isWallAt(x + r, y - r) || this.isWallAt(x - r, y + r) || this.isWallAt(x + r, y + r);
  }

  infoAt(x: number, y: number): TileInfo {
    const i = this.tileOf(x, y);
    if (i < 0) return { kind: 'wall', fx: 'none', dirX: 0, dirY: 0 };
    return { kind: this.kindAt(i), fx: this.fx[i], dirX: this.dirX[i], dirY: this.dirY[i] };
  }

  /** 물 스킬: 물웅덩이 장판 생성. cap개를 넘으면 오래된 것부터 마름 */
  addPuddle(x: number, y: number, radius: number, duration: number, cap = 1): void {
    const tiles: number[] = [];
    this.forTilesInCircle(x, y, radius, (i) => {
      const b = this.base[i];
      if (b === 'floor' || b === 'ash' || b === 'grass' || b === 'puddle') {
        if (this.fx[i] === 'burning') this.fx[i] = 'none';
        this.tempPuddle[i] = Math.max(this.tempPuddle[i], duration);
        tiles.push(i);
      }
    });
    this.puddles.push({ tiles, t: duration });
    while (this.puddles.length > cap) {
      const old = this.puddles.shift()!;
      for (const i of old.tiles) {
        if (!this.puddles.some((p) => p.tiles.includes(i))) {
          this.tempPuddle[i] = 0;
          if (this.base[i] !== 'puddle' && (this.fx[i] === 'electric' || this.fx[i] === 'ice')) this.fx[i] = 'none';
        }
      }
    }
  }

  /** 원소 공격이 지형에 닿았을 때 — 지형 반응 */
  applyElement(x: number, y: number, radius: number, el: Element): void {
    this.forTilesInCircle(x, y, radius, (i) => {
      const kind = this.kindAt(i);
      const fx = this.fx[i];
      if (kind === 'puddle' && el === 'fire' && fx === 'ice') {
        this.flood(i, 'none', 0);
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
    const color = def.fx === 'ice' ? C.water0 : def.fx === 'electric' || def.fx === 'current' ? C.light1 : C.fire1;
    this.s.vfx.floatText(x, y - 10, def.name, color, 6, 0.8, 12, true);
    this.s.lighting.flash(x, y, 60, color, 0.3);
    playSfx('terrain');
  }

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
    for (const p of this.puddles) p.t -= dt;
    this.puddles = this.puddles.filter((p) => p.t > 0);
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
        if (Math.random() < dt * 3) {
          const x = (i % COLS) * TILE + 2 + Math.random() * 12;
          const y = Math.floor(i / COLS) * TILE + 4 + Math.random() * 10;
          this.s.vfx.spark(x, y, Math.random() < 0.5 ? C.fire1 : C.fire0, 1, 15, 50);
        }
        if (this.fxT[i] <= 0) {
          this.base[i] = 'ash';
          this.ashT[i] = ASH_REGROW;
          this.s.vfx.scorch((i % COLS) * TILE + 8, Math.floor(i / COLS) * TILE + 8, 0.6, 0.5);
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

  /** 지형이 내는 빛 (불타는 풀·전기장·화염 통로) */
  emitLights(l: Lighting, time: number): void {
    const n = COLS * ROWS;
    for (let i = 0; i < n; i++) {
      const fx = this.fx[i];
      if (fx === 'none' || fx === 'ice') continue;
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      if ((c + r) % 2 !== 0) continue;
      const x = c * TILE + 8;
      const y = r * TILE + 8;
      const flick = 0.75 + 0.25 * Math.sin(time * 17 + i);
      if (fx === 'burning' || fx === 'fireChannel') l.add(x, y, 34, C.fire1, 0.55 * flick);
      else l.add(x, y, 30, C.light1, 0.45 * flick);
    }
  }

  draw(time: number): void {
    const g = this.dyn;
    g.clear();
    const n = COLS * ROWS;
    for (let i = 0; i < n; i++) {
      const kind = this.kindAt(i);
      const fx = this.fx[i];
      if (kind === 'wall' || (kind === 'floor' && fx === 'none')) continue;
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      const x = c * TILE;
      const y = r * TILE;
      const flick = hash2(i, Math.floor(time * 12), 3);

      if (kind === 'puddle') {
        const temp = this.base[i] !== 'puddle';
        if (temp) this.drawTempWater(g, i, c, r, time);
        if (fx === 'ice') {
          g.fillStyle(0xc8f4ff, 0.92);
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle(0xffffff, 0.9);
          const h = hash2(c, r, 2);
          g.fillRect(x + (h % 9) + 2, y + ((h >> 2) % 9) + 3, 4, 1);
          g.fillRect(x + (h % 9) + 3, y + ((h >> 2) % 9) + 2, 1, 1);
          g.fillStyle(0x8fd4f0, 0.8);
          g.fillRect(x, y + 15, TILE, 1);
        } else if (!temp) {
          // 잔물결
          const off = Math.floor(time * 6 + hash2(c, r, 8) / 100) % 16;
          g.fillStyle(C.water1, 0.55);
          g.fillRect(x + off, y + 5 + (hash2(c, r, 6) % 6), 3, 1);
        }
        if (fx === 'electric') {
          g.fillStyle(C.light1, 0.18 + (flick % 30) / 100);
          g.fillRect(x, y, TILE, TILE);
          if (flick % 3 === 0) {
            g.lineStyle(1, C.light0, 1);
            g.beginPath();
            g.moveTo(x + 2, y + 8);
            g.lineTo(x + 6, y + 4);
            g.lineTo(x + 9, y + 11);
            g.lineTo(x + 14, y + 6);
            g.strokePath();
          }
        }
      } else if (kind === 'grass') {
        this.drawGrass(g, i, c, r, time, fx === 'burning');
      } else if (kind === 'ash') {
        g.fillStyle(0x221c26, 0.85);
        g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
        g.fillStyle(0x4d4652);
        const h = hash2(c, r, 5);
        g.fillRect(x + (h % 12) + 1, y + ((h >> 3) % 12) + 1, 2, 1);
        if (this.ashT[i] > ASH_REGROW - 2) {
          g.fillStyle(C.fire2, 0.8);
          g.fillRect(x + (h % 10) + 3, y + ((h >> 2) % 10) + 3, 1, 1);
        }
      } else if (kind === 'channel') {
        const dx = this.dirX[i];
        const dy = this.dirY[i];
        const speed = fx === 'current' ? 140 : 46;
        const h = hash2(c, r, 1);
        const col = fx === 'fireChannel' ? C.fire0 : fx === 'current' ? C.light0 : C.wind1;
        g.fillStyle(col, fx === 'none' ? 0.55 : 0.95);
        for (let k = 0; k < 2; k++) {
          const off = (time * speed + (h % 16) + k * 8) % TILE;
          if (dx !== 0) g.fillRect(dx > 0 ? x + off : x + TILE - off - 3, y + 4 + k * 6 + (h % 3), 3, 1);
          else g.fillRect(x + 4 + k * 6 + (h % 3), dy > 0 ? y + off : y + TILE - off - 3, 1, 3);
        }
        if (fx === 'fireChannel') {
          g.fillStyle(C.fire1, 0.3 + (flick % 20) / 100);
          g.fillRect(x, y, TILE, TILE);
        } else if (fx === 'current') {
          g.fillStyle(C.light1, 0.18 + (flick % 30) / 100);
          g.fillRect(x, y, TILE, TILE);
        }
      }
    }
  }

  private drawTempWater(g: Phaser.GameObjects.Graphics, i: number, c: number, r: number, time: number) {
    const x = c * TILE;
    const y = r * TILE;
    const t = this.tempPuddle[i];
    const fade = Math.min(1, t);
    const wet = (dc: number, dr: number) => {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) return false;
      return this.kindAt(this.idx(nc, nr)) === 'puddle';
    };
    g.fillStyle(C.water2, 0.85 * fade);
    const inset = (cond: boolean) => (cond ? 0 : 2);
    const l = inset(wet(-1, 0));
    const rr = inset(wet(1, 0));
    const u = inset(wet(0, -1));
    const d = inset(wet(0, 1));
    g.fillRect(x + l, y + u, TILE - l - rr, TILE - u - d);
    g.fillStyle(C.water1, 0.6 * fade);
    const off = Math.floor(time * 5 + hash2(c, r, 3) / 100) % 12;
    g.fillRect(x + 2 + off, y + 6 + (hash2(c, r, 2) % 5), 3, 1);
  }

  private drawGrass(g: Phaser.GameObjects.Graphics, i: number, c: number, r: number, time: number, burning: boolean) {
    const x = c * TILE;
    const y = r * TILE;
    g.fillStyle(burning ? 0x3a1810 : C.grass2, 0.9);
    g.fillRect(x, y + 1, TILE, TILE - 1);
    for (let k = 0; k < 6; k++) {
      const h = hash2(i, k, 4);
      const hx = x + (h % 14) + 1;
      const hy = y + ((h >> 4) % 12) + 4;
      const sway = Math.round(Math.sin(time * 2.2 + hx * 0.3) * 1);
      if (burning) {
        const f = hash2(i, k + Math.floor(time * 14), 9);
        g.fillStyle(f % 3 === 0 ? C.fire0 : C.fire1, 1);
        g.fillRect(hx + sway, hy - 3 - (f % 3), 1, 3 + (f % 3));
        g.fillStyle(C.fire2, 1);
        g.fillRect(hx, hy, 2, 1);
      } else {
        g.fillStyle(k % 2 ? C.grass1 : C.grass0, 1);
        g.fillRect(hx, hy - 1, 1, 2);
        g.fillRect(hx + sway, hy - 3, 1, 2);
        g.fillStyle(C.grass1, 1);
        g.fillRect(hx + 1, hy - 1, 1, 2);
      }
    }
  }
}
