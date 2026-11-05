import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { DEPTH } from '../config';
import { E32 } from '../art/palette';
import { playSfx } from '../audio/sfx';
import { formulaLine, joinTerms } from './formula';

/**
 * 화학 반응 시험판: 수소(H)·산소(O)·나트륨(Na)을 던져서 실제 반응을 일으킨다.
 *   H + H        → H₂            (같은 구름 안에서)
 *   H₂ + O       → H₂O           (구름이 물로 응결 → 물웅덩이)
 *   2H₂O + 2Na   → 2NaOH + H₂    (물에 나트륨 → 폭발, 수소 구름이 남음)
 * 기체는 떨어진 자리에 구름으로 남고, 같은 구름 안에 던져야 합쳐진다.
 */

export type Reagent = 'H' | 'O' | 'Na';
export const REAGENTS: readonly Reagent[] = ['H', 'O', 'Na'];
export const REAGENT_KEY: Record<Reagent, string> = { H: 'Z', O: 'X', Na: 'C' };
export const REAGENT_NAME: Record<Reagent, string> = { H: '수소', O: '산소', Na: '나트륨' };

/** 분자 모형 관례색(CPK): 수소 흰색, 산소 빨강, 나트륨 보라 */
export const CHEM_COLOR = {
  H: E32.white,
  O: E32.red,
  Na: E32.magenta,
  water: E32.blue,
  naoh: E32.sand,
  op: E32.steel,
} as const;

export interface ChemTerm {
  f: string;
  color: number;
}

/** UI(위 가운데 화학식)로 보내는 이벤트 */
export type ChemEvent =
  | { type: 'state'; terms: ChemTerm[] }
  | { type: 'equation'; lhs: ChemTerm[]; rhs: ChemTerm[]; revealAt: number; fizz?: boolean; result: ChemTerm[] | null }
  | { type: 'clear' };

export const THROW_CD = 0.25;
const RANGE = 150;
const CLOUD_R = 16;
const CLOUD_LIFE = 14;
const LUMP_LIFE = 15;
const WATER_R = 20;
const WATER_LIFE = 14;
/** 반응이 시작되고 결과(→ 오른쪽)가 나오기까지 */
const WATER_REVEAL = 0.45;
const NA_REVEAL = 0.7;
const NA_BLAST_R = 42;
const NA_DAMAGE = 35;

interface Flask {
  r: Reagent;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  h: number;
  spin: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
}

interface Puff {
  ox: number;
  oy: number;
  r: number;
  ph: number;
}

interface Cloud {
  x: number;
  y: number;
  H: number;
  O: number;
  t: number;
  age: number;
  /** 물로 응결 중 (남은 시간) */
  condense: number;
  puffs: Puff[];
  label: Phaser.GameObjects.Container | null;
  labelW: number;
}

interface Lump {
  x: number;
  y: number;
  t: number;
  /** 물과 반응 중 (남은 시간), -1 = 아직 반응 안 함 */
  fizz: number;
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Container;
  labelW: number;
}

interface Water {
  x: number;
  y: number;
  t: number;
}

const FLASK = ['..ccc..', '..oGo..', '..oGo..', '.oLLLo.', 'oLWLLLo', 'oLLLLlo', 'oLLLllo', '.olllo.', '..ooo..'];
const LUMP = ['.oooo.', 'oWSSso', 'oSssdo', '.oooo.'];
const LIQUID: Record<Reagent, [string, string]> = {
  H: ['#c0cbdc', '#8b9bb4'],
  O: ['#e43b44', '#a22633'],
  Na: ['#b55088', '#68386c'],
};

type Pal = Phaser.Types.Create.Palette;

function makeTextures(s: Phaser.Scene): void {
  for (const r of REAGENTS) {
    const key = `flask_${r}`;
    if (s.textures.exists(key)) continue;
    const pal = { o: '#181425', c: '#b86f50', G: '#c0cbdc', W: '#ffffff', L: LIQUID[r][0], l: LIQUID[r][1] };
    s.textures.generate(key, { data: FLASK, pixelWidth: 1, palette: pal as unknown as Pal });
  }
  if (!s.textures.exists('na_lump')) {
    const pal = { o: '#3a4466', W: '#ffffff', S: '#c0cbdc', s: '#8b9bb4', d: '#5a6988' };
    s.textures.generate('na_lump', { data: LUMP, pixelWidth: 1, palette: pal as unknown as Pal });
  }
}

export class ChemSystem {
  throwCd = 0;
  private flasks: Flask[] = [];
  private clouds: Cloud[] = [];
  private lumps: Lump[] = [];
  private waters: Water[] = [];
  /** 위 화면에 화학식이 떠 있는 대상 */
  private active: object | null = null;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly keys: Record<Reagent, Phaser.Input.Keyboard.Key>;

  constructor(private readonly s: RoomScene) {
    makeTextures(s);
    // 조명 위에 그려서 어두운 방에서도 기체가 보이게
    this.g = s.add.graphics().setDepth(DEPTH.vfx - 10);
    const kb = s.input.keyboard!;
    this.keys = { H: kb.addKey(REAGENT_KEY.H), O: kb.addKey(REAGENT_KEY.O), Na: kb.addKey(REAGENT_KEY.Na) };
    this.emit({ type: 'clear' });
  }

  private emit(ev: ChemEvent): void {
    this.s.game.events.emit('chem', ev);
  }

  private setActive(obj: object, terms: ChemTerm[]): void {
    this.active = obj;
    this.emit({ type: 'state', terms });
  }

  private dropActive(obj: object): void {
    if (this.active !== obj) return;
    this.active = null;
    this.emit({ type: 'clear' });
  }

  // ───────────────────────── 던지기 ─────────────────────────

  update(dt: number): void {
    this.throwCd = Math.max(0, this.throwCd - dt);
    const p = this.s.player;
    if (!p.dead && !p.inputLocked && !p.rolling && this.s.combatEnabled && this.throwCd <= 0) {
      for (const r of REAGENTS) {
        if (Phaser.Input.Keyboard.JustDown(this.keys[r])) {
          this.throwReagent(r);
          break;
        }
      }
    }
    this.updateFlasks(dt);
    this.updateClouds(dt);
    this.updateLumps(dt);
    for (const w of this.waters) w.t -= dt;
    for (const w of this.waters.filter((w) => w.t <= 0)) this.dropActive(w);
    this.waters = this.waters.filter((w) => w.t > 0);
  }

  private throwReagent(r: Reagent): void {
    const s = this.s;
    const p = s.player;
    const dx = p.aimX - p.x;
    const dy = p.aimY - p.y;
    const a = Math.atan2(dy, dx);
    const d = Math.min(RANGE, Math.hypot(dx, dy));
    let tx = p.x + Math.cos(a) * d;
    let ty = p.y + Math.sin(a) * d;
    for (let k = 0; k < 40 && s.terrain.isBlocked(tx, ty, 3); k++) {
      tx -= Math.cos(a) * 4;
      ty -= Math.sin(a) * 4;
    }
    const sx = p.x + Math.cos(a) * 5;
    const sy = p.y;
    const dist = Math.hypot(tx - sx, ty - sy);
    const img = s.add.image(sx, sy - 12, `flask_${r}`).setDepth(DEPTH.projectile);
    const shadow = s.add.ellipse(sx, sy, 6, 3, E32.black, 0.45).setDepth(DEPTH.shadow);
    this.flasks.push({ r, sx, sy, tx, ty, t: 0, dur: 0.16 + dist / 650, h: 8 + dist * 0.16, spin: Math.cos(a) < 0 ? -1 : 1, img, shadow });
    p.throwPose();
    this.throwCd = THROW_CD;
    playSfx('throw');
  }

  private updateFlasks(dt: number): void {
    for (const f of this.flasks) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const gx = Phaser.Math.Linear(f.sx, f.tx, k);
      const gy = Phaser.Math.Linear(f.sy, f.ty, k);
      // 손 높이(12)에서 출발해 포물선을 그리며 바닥(0)에 떨어짐
      const z = (1 - k) * 12 + Math.sin(Math.PI * k) * f.h;
      f.img.setPosition(Math.round(gx), Math.round(gy - z));
      // 픽셀이 깨지지 않게 90도 단위로만 회전
      f.img.setRotation(Math.floor(f.t / 0.07) * (Math.PI / 2) * f.spin);
      f.shadow.setPosition(Math.round(gx), Math.round(gy));
      if (k >= 1) this.land(f);
    }
    this.flasks = this.flasks.filter((f) => f.t < f.dur);
  }

  private land(f: Flask): void {
    const s = this.s;
    f.img.destroy();
    f.shadow.destroy();
    const col = f.r === 'O' ? E32.red : E32.silver;
    s.vfx.spark(f.tx, f.ty, E32.white, 6, 60, 45);
    s.vfx.spark(f.tx, f.ty, col, 5, 45, 35);
    s.vfx.ring(f.tx, f.ty, 2, 10, col, 0.2, 1);
    playSfx('glass');
    this.apply(f.r, f.tx, f.ty);
  }

  // ───────────────────────── 반응 ─────────────────────────

  private apply(r: Reagent, x: number, y: number): void {
    if (r === 'Na') {
      const lump = this.addLump(x, y);
      if (this.isWater(x, y)) this.startSodium(lump);
      else this.setActive(lump, [{ f: 'Na', color: CHEM_COLOR.Na }]);
      return;
    }
    let c = this.cloudAt(x, y);
    if (c) {
      c[r] = Math.min(2, c[r] + 1);
      c.t = CLOUD_LIFE;
    } else {
      c = this.addCloud(x, y, r === 'H' ? 1 : 0, r === 'O' ? 1 : 0);
    }
    this.s.vfx.burst(x, y - 8, r === 'H' ? E32.silver : E32.red, 8);
    playSfx('gas');
    if (c.H >= 2 && c.O >= 1) this.formWater(c);
    else {
      this.refreshLabel(c);
      this.setActive(c, this.cloudTerms(c));
    }
  }

  private isWater(x: number, y: number): boolean {
    return this.s.terrain.infoAt(x, y).kind === 'puddle';
  }

  /** H₂ + O → H₂O : 구름이 물방울로 응결해서 물웅덩이가 된다 */
  private formWater(c: Cloud): void {
    const s = this.s;
    c.H -= 2;
    c.O -= 1;
    c.condense = WATER_REVEAL;
    const water: Water = { x: c.x, y: c.y, t: WATER_LIFE };
    this.active = water;
    this.emit({
      type: 'equation',
      lhs: [
        { f: 'H2', color: CHEM_COLOR.H },
        { f: 'O', color: CHEM_COLOR.O },
      ],
      rhs: [{ f: 'H2O', color: CHEM_COLOR.water }],
      revealAt: WATER_REVEAL,
      result: [{ f: 'H2O', color: CHEM_COLOR.water }],
    });
    s.scheduler.after(WATER_REVEAL, () => {
      s.terrain.addPuddle(water.x, water.y, WATER_R, WATER_LIFE, 6, 'chem');
      this.waters.push(water);
      s.vfx.ring(water.x, water.y, 4, WATER_R + 6, E32.blue, 0.3, 2);
      s.vfx.spark(water.x, water.y - 6, E32.cyan, 14, 60, 50);
      s.vfx.glow(water.x, water.y - 4, 28, E32.blue, 0.3);
      s.lighting.flash(water.x, water.y, 90, E32.blue, 0.35);
      playSfx('splash');
    });
  }

  /** 물 위의 나트륨: 지글거리며 튀어 다니다가 폭발 */
  private startSodium(lump: Lump): void {
    lump.fizz = NA_REVEAL;
    this.active = lump;
    this.emit({
      type: 'equation',
      lhs: [
        { f: '2H2O', color: CHEM_COLOR.water },
        { f: '2Na', color: CHEM_COLOR.Na },
      ],
      rhs: [
        { f: '2NaOH', color: CHEM_COLOR.naoh },
        { f: 'H2', color: CHEM_COLOR.H },
      ],
      revealAt: NA_REVEAL,
      fizz: true,
      result: [{ f: 'H2', color: CHEM_COLOR.H }],
    });
    playSfx('fizz');
  }

  private explodeSodium(lump: Lump): void {
    const s = this.s;
    const { x, y } = lump;
    this.removeLump(lump, false);
    s.vfx.explosion(x, y, NA_BLAST_R, E32.amber);
    s.vfx.ring(x, y, 8, NA_BLAST_R + 12, E32.yellow, 0.35, 2);
    s.vfx.spark(x, y, E32.cyan, 18, 150, 110);
    s.vfx.spark(x, y, E32.yellow, 16, 130, 90);
    s.vfx.glow(x, y - 8, 56, E32.amber, 0.45);
    s.lighting.flash(x, y, 240, E32.amber, 0.6);
    s.shake(0.3, 0.012);
    s.hitstop.request(0.12);
    playSfx('kaboom');
    for (const a of s.combat.inCircle(x, y, NA_BLAST_R, 'enemy')) {
      s.combat.hit(a, {
        damage: NA_DAMAGE * s.player.atkMult,
        knockback: 280,
        fromX: x,
        fromY: y,
        isReaction: true,
        reactionId: 'sodium_water',
        color: E32.amber,
      });
    }
    // 물(2H₂O)은 반응으로 사라지고, 수소 기체(H₂)가 남는다
    s.terrain.drainPuddle(x, y, WATER_R + 4);
    this.waters = this.waters.filter((w) => Phaser.Math.Distance.Between(w.x, w.y, x, y) > WATER_R + 8);
    const c = this.addCloud(x, y - 2, 2, 0);
    this.refreshLabel(c);
    this.active = c;
  }

  // ───────────────────────── 구름 (기체) ─────────────────────────

  private addCloud(x: number, y: number, H: number, O: number): Cloud {
    const puffs: Puff[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      const d = 3 + Math.random() * 5;
      puffs.push({ ox: Math.cos(a) * d * 1.3, oy: Math.sin(a) * d * 0.7, r: 5 + Math.random() * 3, ph: Math.random() * 10 });
    }
    const c: Cloud = { x, y, H, O, t: CLOUD_LIFE, age: 0, condense: 0, puffs, label: null, labelW: 0 };
    this.clouds.push(c);
    return c;
  }

  private cloudAt(x: number, y: number): Cloud | null {
    let best: Cloud | null = null;
    let bd = CLOUD_R + 8;
    for (const c of this.clouds) {
      if (c.condense > 0 || c.H + c.O === 0) continue;
      const d = Phaser.Math.Distance.Between(c.x, c.y, x, y);
      if (d <= bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private cloudTerms(c: Cloud): ChemTerm[] {
    const t: ChemTerm[] = [];
    if (c.H > 0) t.push({ f: c.H >= 2 ? 'H2' : 'H', color: CHEM_COLOR.H });
    if (c.O > 0) t.push({ f: c.O >= 2 ? 'O2' : 'O', color: CHEM_COLOR.O });
    return t;
  }

  private refreshLabel(c: Cloud): void {
    c.label?.destroy();
    c.label = null;
    const terms = this.cloudTerms(c);
    if (!terms.length) return;
    const line = formulaLine(this.s, joinTerms(terms, CHEM_COLOR.op), 'small');
    line.c.setDepth(DEPTH.text - 1);
    c.label = line.c;
    c.labelW = line.w;
  }

  private updateClouds(dt: number): void {
    for (const c of this.clouds) {
      c.age += dt;
      if (c.condense > 0) {
        c.condense -= dt;
        if (Math.random() < dt * 30) this.s.vfx.spark(c.x + (Math.random() - 0.5) * 16, c.y - 8, E32.cyan, 1, 10, 5);
        if (c.condense <= 0) {
          c.condense = 0;
          this.refreshLabel(c);
        }
        continue;
      }
      c.t -= dt;
      if (Math.random() < dt * 3) {
        const col = c.O > 0 && (c.H === 0 || Math.random() < 0.5) ? E32.red : E32.silver;
        this.s.vfx.spark(c.x + (Math.random() - 0.5) * 18, c.y - 8 + (Math.random() - 0.5) * 8, col, 1, 6, 14);
      }
    }
    for (const c of this.clouds) {
      if (c.condense > 0) continue;
      if (c.t <= 0 || c.H + c.O === 0) {
        c.label?.destroy();
        this.dropActive(c);
      }
    }
    this.clouds = this.clouds.filter((c) => c.condense > 0 || (c.t > 0 && c.H + c.O > 0));
  }

  // ───────────────────────── 나트륨 덩어리 ─────────────────────────

  private addLump(x: number, y: number): Lump {
    const img = this.s.add.image(Math.round(x), Math.round(y), 'na_lump').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
    const line = formulaLine(this.s, [{ f: 'Na', color: CHEM_COLOR.Na }], 'small');
    line.c.setDepth(DEPTH.text - 1).setPosition(Math.round(x - line.w / 2), Math.round(y - 18));
    const lump: Lump = { x, y, t: LUMP_LIFE, fizz: -1, img, label: line.c, labelW: line.w };
    this.lumps.push(lump);
    return lump;
  }

  private removeLump(l: Lump, clearUi: boolean): void {
    l.img.destroy();
    l.label.destroy();
    this.lumps = this.lumps.filter((o) => o !== l);
    if (clearUi) this.dropActive(l);
  }

  private updateLumps(dt: number): void {
    for (const l of [...this.lumps]) {
      if (l.fizz >= 0) {
        l.fizz -= dt;
        // 물 위에서 지글거리며 이리저리 튐
        const jx = Math.round((Math.random() - 0.5) * 3);
        l.img.setPosition(Math.round(l.x) + jx, Math.round(l.y) - (Math.random() < 0.3 ? 1 : 0));
        if (Math.random() < dt * 40) this.s.vfx.spark(l.x, l.y - 2, Math.random() < 0.5 ? E32.yellow : E32.amber, 1, 40, 50);
        if (Math.random() < dt * 25) this.s.vfx.spark(l.x, l.y, E32.white, 1, 25, 20);
        if (l.fizz <= 0) this.explodeSodium(l);
        continue;
      }
      l.t -= dt;
      if (this.isWater(l.x, l.y)) this.startSodium(l);
      else if (l.t <= 0) this.removeLump(l, true);
    }
  }

  // ───────────────────────── 그리기 ─────────────────────────

  draw(time: number): void {
    const g = this.g;
    g.clear();
    for (const c of this.clouds) {
      const fade = Math.min(1, c.t / 1.5) * Math.min(1, c.age / 0.25);
      const shrink = c.condense > 0 ? c.condense / WATER_REVEAL : 1;
      const scale = 0.8 + 0.12 * (c.H + c.O + (c.condense > 0 ? 3 : 0));
      const both = c.H > 0 && c.O > 0;
      c.puffs.forEach((pf, i) => {
        const col = c.condense > 0 ? E32.cyan : both ? (i % 2 ? E32.red : E32.silver) : c.O > 0 ? E32.red : E32.silver;
        const px = Math.round(c.x + (pf.ox + Math.sin(time * 1.3 + pf.ph) * 2) * shrink);
        const py = Math.round(c.y - 9 + (pf.oy + Math.cos(time * 1.1 + pf.ph) * 1.5) * shrink);
        const rr = Math.max(1, Math.round(pf.r * scale * (0.35 + 0.65 * shrink)));
        g.fillStyle(col, 0.16 * fade);
        g.fillCircle(px, py, rr);
        g.fillStyle(col, 0.14 * fade);
        g.fillCircle(px - 1, py - 1, Math.max(1, rr - 3));
      });
      if (c.label) {
        c.label.setPosition(Math.round(c.x - c.labelW / 2), Math.round(c.y - 34)).setAlpha(c.condense > 0 ? shrink : fade);
      }
    }
    for (const l of this.lumps) l.label.setAlpha(l.fizz >= 0 ? 0 : Math.min(1, l.t / 1.5));
  }

  emitLights(): void {
    const L = this.s.lighting;
    for (const c of this.clouds) {
      if (c.condense > 0) continue;
      L.add(c.x, c.y - 9, 34, c.O > 0 && c.H === 0 ? E32.red : E32.silver, 0.25);
    }
    for (const l of this.lumps) if (l.fizz >= 0) L.add(l.x, l.y - 2, 70, E32.amber, 0.9);
  }
}
