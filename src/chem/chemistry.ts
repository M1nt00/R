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
 * 화면 위 화학식은 무언가와 합쳐질 때만 뜨고 잠시 뒤 사라진다 (땅의 구름·물·나트륨 라벨은 남음).
 */

export type Reagent = 'H' | 'O' | 'Na';
export const REAGENTS: readonly Reagent[] = ['H', 'O', 'Na'];
/** 화면에 보이는 키 이름 */
export const REAGENT_KEY: Record<Reagent, string> = { H: '1', O: '2', Na: '3' };
const KEY_CODE: Record<Reagent, string> = { H: 'ONE', O: 'TWO', Na: 'THREE' };

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
  /** 반응: 왼쪽 → 오른쪽. revealAt초에 결과가 나옴 */
  | { type: 'equation'; lhs: ChemTerm[]; rhs: ChemTerm[]; revealAt: number; fizz?: boolean }
  /** 합쳐졌지만 반응은 안 일어남 (예: H + O) */
  | { type: 'mix'; terms: ChemTerm[] }
  | { type: 'clear' };

/** 구름 속 물질 */
type Species = 'H' | 'H2' | 'O';
const SPECIES_COLOR: Record<Species, number> = { H: CHEM_COLOR.H, H2: CHEM_COLOR.H, O: CHEM_COLOR.O };
type Step = 'h2' | 'water';

export const THROW_CD = 0.25;
const RANGE = 150;
const CLOUD_R = 16;
const CLOUD_LIFE = 14;
const CLOUD_MAX = 6;
const LUMP_LIFE = 15;
const WATER_R = 20;
const WATER_LIFE = 14;
/** 반응이 시작되고 결과(→ 오른쪽)가 나오기까지 */
const REVEAL: Record<Step, number> = { h2: 0.35, water: 0.45 };
const NA_REVEAL = 0.7;
/** 연달아 일어나는 반응 사이: 앞 반응 결과를 보여주는 시간 */
const CHAIN_GAP = 0.75;
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
  /** 실제 들어 있는 물질 (반응은 던진 순간 계산) */
  species: Species[];
  /** 화면에 보여주는 물질 (반응 연출에 맞춰 늦게 바뀜) */
  shown: Species[];
  t: number;
  age: number;
  /** 물로 응결 중 (남은 시간) */
  condense: number;
  /** 예약된 반응 연출이 끝나는 시각 */
  busyUntil: number;
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
}

interface Water {
  x: number;
  y: number;
  t: number;
  label: Phaser.GameObjects.Container;
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

/** ['H2','H2','O'] → 2H₂ + O (처음 나온 순서대로, 같은 건 계수로 묶음) */
function speciesTerms(list: readonly Species[]): ChemTerm[] {
  const order: Species[] = [];
  const n = new Map<Species, number>();
  for (const sp of list) {
    if (!n.has(sp)) order.push(sp);
    n.set(sp, (n.get(sp) ?? 0) + 1);
  }
  return order.map((sp) => ({ f: `${n.get(sp)! > 1 ? n.get(sp) : ''}${sp}`, color: SPECIES_COLOR[sp] }));
}

function take(list: Species[], sp: Species, k: number): void {
  for (let i = 0; i < k; i++) list.splice(list.indexOf(sp), 1);
}

const count = (list: readonly Species[], sp: Species) => list.filter((x) => x === sp).length;

export class ChemSystem {
  throwCd = 0;
  private flasks: Flask[] = [];
  private clouds: Cloud[] = [];
  private lumps: Lump[] = [];
  private waters: Water[] = [];
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly keys: Record<Reagent, Phaser.Input.Keyboard.Key>;

  constructor(private readonly s: RoomScene) {
    makeTextures(s);
    // 조명 위에 그려서 어두운 방에서도 기체가 보이게
    this.g = s.add.graphics().setDepth(DEPTH.vfx - 10);
    const kb = s.input.keyboard!;
    this.keys = { H: kb.addKey(KEY_CODE.H), O: kb.addKey(KEY_CODE.O), Na: kb.addKey(KEY_CODE.Na) };
    this.emit({ type: 'clear' });
  }

  private emit(ev: ChemEvent): void {
    this.s.game.events.emit('chem', ev);
  }

  /** 땅 위 작은 화학식 라벨 */
  private makeLabel(terms: ChemTerm[]): { c: Phaser.GameObjects.Container; w: number } {
    const line = formulaLine(this.s, joinTerms(terms, CHEM_COLOR.op), 'small');
    line.c.setDepth(DEPTH.text - 1);
    return { c: line.c, w: line.w };
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
    this.updateWaters(dt);
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
      return;
    }
    this.s.vfx.burst(x, y - 8, r === 'H' ? E32.silver : E32.red, 8);
    playSfx('gas');
    const c = this.cloudAt(x, y);
    // 빈 곳에 떨어지면 혼자 구름이 될 뿐, 화면 위에는 안 뜸
    if (!c) this.addCloud(x, y, [r]);
    else this.addToCloud(c, r);
  }

  private isWater(x: number, y: number): boolean {
    return this.s.terrain.infoAt(x, y).kind === 'puddle';
  }

  /** 구름에 물질이 더해짐 → 일어날 수 있는 반응을 차례로 예약. 반응이 없으면 합쳐진 모습만 잠깐 보여줌 */
  private addToCloud(c: Cloud, sp: Species): void {
    c.t = CLOUD_LIFE;
    if (c.species.length >= CLOUD_MAX) return;
    const before = speciesTerms(c.species);
    c.species.push(sp);
    const steps: { step: Step; after: Species[] }[] = [];
    for (;;) {
      if (count(c.species, 'H') >= 2) {
        take(c.species, 'H', 2);
        c.species.push('H2');
        steps.push({ step: 'h2', after: [...c.species] });
      } else if (c.species.includes('H2') && c.species.includes('O')) {
        take(c.species, 'H2', 1);
        take(c.species, 'O', 1);
        steps.push({ step: 'water', after: [...c.species] });
      } else break;
    }
    if (!steps.length) {
      this.emit({ type: 'mix', terms: [...before, { f: sp, color: SPECIES_COLOR[sp] }] });
      c.shown = [...c.species];
      this.refreshLabel(c);
      return;
    }
    // 앞 반응 연출이 남아 있으면 그 뒤에 이어서
    const now = this.s.gameTime;
    let at = Math.max(0, c.busyUntil - now);
    for (const st of steps) {
      this.s.scheduler.after(at, () => this.runStep(c, st.step, st.after));
      at += REVEAL[st.step] + CHAIN_GAP;
    }
    c.busyUntil = now + at;
  }

  private runStep(c: Cloud, step: Step, after: Species[]): void {
    const s = this.s;
    const reveal = REVEAL[step];
    if (step === 'h2') {
      this.emit({
        type: 'equation',
        lhs: [
          { f: 'H', color: CHEM_COLOR.H },
          { f: 'H', color: CHEM_COLOR.H },
        ],
        rhs: [{ f: 'H2', color: CHEM_COLOR.H }],
        revealAt: reveal,
      });
      s.scheduler.after(reveal, () => {
        c.shown = after;
        this.refreshLabel(c);
        s.vfx.ring(c.x, c.y - 9, 4, 18, E32.silver, 0.25, 1);
        s.vfx.glow(c.x, c.y - 9, 20, E32.silver, 0.25);
      });
      return;
    }
    // H₂ + O → H₂O : 구름이 물방울로 응결해서 물웅덩이가 된다
    this.emit({
      type: 'equation',
      lhs: [
        { f: 'H2', color: CHEM_COLOR.H },
        { f: 'O', color: CHEM_COLOR.O },
      ],
      rhs: [{ f: 'H2O', color: CHEM_COLOR.water }],
      revealAt: reveal,
    });
    c.condense = reveal;
    s.scheduler.after(reveal, () => {
      c.shown = after;
      this.refreshLabel(c);
      s.terrain.addPuddle(c.x, c.y, WATER_R, WATER_LIFE, 6, 'chem');
      this.addWater(c.x, c.y);
      s.vfx.ring(c.x, c.y, 4, WATER_R + 6, E32.blue, 0.3, 2);
      s.vfx.spark(c.x, c.y - 6, E32.cyan, 14, 60, 50);
      s.vfx.glow(c.x, c.y - 4, 28, E32.blue, 0.3);
      s.lighting.flash(c.x, c.y, 90, E32.blue, 0.35);
      playSfx('splash');
    });
  }

  /** 물 위의 나트륨: 지글거리며 튀어 다니다가 폭발 */
  private startSodium(lump: Lump): void {
    lump.fizz = NA_REVEAL;
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
    });
    playSfx('fizz');
  }

  private explodeSodium(lump: Lump): void {
    const s = this.s;
    const { x, y } = lump;
    this.removeLump(lump);
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
    for (const w of this.waters) {
      if (Phaser.Math.Distance.Between(w.x, w.y, x, y) <= WATER_R + 8) w.t = Math.min(w.t, 0.25);
    }
    this.addCloud(x, y - 2, ['H2']);
  }

  // ───────────────────────── 구름 (기체) ─────────────────────────

  private addCloud(x: number, y: number, species: Species[]): Cloud {
    const puffs: Puff[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      const d = 3 + Math.random() * 5;
      puffs.push({ ox: Math.cos(a) * d * 1.3, oy: Math.sin(a) * d * 0.7, r: 5 + Math.random() * 3, ph: Math.random() * 10 });
    }
    const c: Cloud = { x, y, species: [...species], shown: [...species], t: CLOUD_LIFE, age: 0, condense: 0, busyUntil: 0, puffs, label: null, labelW: 0 };
    this.clouds.push(c);
    this.refreshLabel(c);
    return c;
  }

  private cloudAt(x: number, y: number): Cloud | null {
    let best: Cloud | null = null;
    let bd = CLOUD_R + 8;
    for (const c of this.clouds) {
      if (c.species.length === 0) continue;
      const d = Phaser.Math.Distance.Between(c.x, c.y, x, y);
      if (d <= bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private refreshLabel(c: Cloud): void {
    c.label?.destroy();
    c.label = null;
    if (!c.shown.length) return;
    const l = this.makeLabel(speciesTerms(c.shown));
    c.label = l.c;
    c.labelW = l.w;
  }

  private updateClouds(dt: number): void {
    const now = this.s.gameTime;
    for (const c of this.clouds) {
      c.age += dt;
      if (c.condense > 0) {
        c.condense = Math.max(0, c.condense - dt);
        if (Math.random() < dt * 30) this.s.vfx.spark(c.x + (Math.random() - 0.5) * 16, c.y - 8, E32.cyan, 1, 10, 5);
        continue;
      }
      if (!c.shown.length) continue;
      c.t -= dt;
      if (Math.random() < dt * 3) {
        const col = c.shown.includes('O') && (!this.hasH(c.shown) || Math.random() < 0.5) ? E32.red : E32.silver;
        this.s.vfx.spark(c.x + (Math.random() - 0.5) * 18, c.y - 8 + (Math.random() - 0.5) * 8, col, 1, 6, 14);
      }
    }
    const gone = (c: Cloud) => c.t <= 0 || (c.species.length === 0 && c.condense <= 0 && now >= c.busyUntil);
    for (const c of this.clouds) if (gone(c)) c.label?.destroy();
    this.clouds = this.clouds.filter((c) => !gone(c));
  }

  private hasH(list: readonly Species[]): boolean {
    return list.includes('H') || list.includes('H2');
  }

  // ───────────────────────── 물·나트륨 ─────────────────────────

  private addWater(x: number, y: number): void {
    const l = this.makeLabel([{ f: 'H2O', color: CHEM_COLOR.water }]);
    l.c.setPosition(Math.round(x - l.w / 2), Math.round(y - 16));
    this.waters.push({ x, y, t: WATER_LIFE, label: l.c });
  }

  private updateWaters(dt: number): void {
    for (const w of this.waters) {
      w.t -= dt;
      w.label.setAlpha(Math.max(0, Math.min(1, w.t / 1.5)));
      if (w.t <= 0) w.label.destroy();
    }
    this.waters = this.waters.filter((w) => w.t > 0);
  }

  private addLump(x: number, y: number): Lump {
    const img = this.s.add.image(Math.round(x), Math.round(y), 'na_lump').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
    const l = this.makeLabel([{ f: 'Na', color: CHEM_COLOR.Na }]);
    l.c.setPosition(Math.round(x - l.w / 2), Math.round(y - 18));
    const lump: Lump = { x, y, t: LUMP_LIFE, fizz: -1, img, label: l.c };
    this.lumps.push(lump);
    return lump;
  }

  private removeLump(l: Lump): void {
    l.img.destroy();
    l.label.destroy();
    this.lumps = this.lumps.filter((o) => o !== l);
  }

  private updateLumps(dt: number): void {
    for (const l of [...this.lumps]) {
      if (l.fizz >= 0) {
        l.fizz -= dt;
        // 물 위에서 지글거리며 이리저리 튐
        const jx = Math.round((Math.random() - 0.5) * 3);
        l.img.setPosition(Math.round(l.x) + jx, Math.round(l.y) - (Math.random() < 0.3 ? 1 : 0));
        l.label.setAlpha(0);
        if (Math.random() < dt * 40) this.s.vfx.spark(l.x, l.y - 2, Math.random() < 0.5 ? E32.yellow : E32.amber, 1, 40, 50);
        if (Math.random() < dt * 25) this.s.vfx.spark(l.x, l.y, E32.white, 1, 25, 20);
        if (l.fizz <= 0) this.explodeSodium(l);
        continue;
      }
      l.t -= dt;
      l.label.setAlpha(Math.min(1, l.t / 1.5));
      if (this.isWater(l.x, l.y)) this.startSodium(l);
      else if (l.t <= 0) this.removeLump(l);
    }
  }

  // ───────────────────────── 그리기 ─────────────────────────

  draw(time: number): void {
    const g = this.g;
    g.clear();
    for (const c of this.clouds) {
      if (!c.shown.length && c.condense <= 0) continue;
      const fade = Math.min(1, c.t / 1.5) * Math.min(1, c.age / 0.25);
      const shrink = c.condense > 0 ? c.condense / REVEAL.water : 1;
      const n = c.condense > 0 ? Math.max(c.shown.length, 2) : c.shown.length;
      const scale = 0.85 + 0.1 * Math.min(n, 4);
      const hasO = c.shown.includes('O');
      const both = hasO && this.hasH(c.shown);
      c.puffs.forEach((pf, i) => {
        const col = c.condense > 0 ? E32.cyan : both ? (i % 2 ? E32.red : E32.silver) : hasO ? E32.red : E32.silver;
        const px = Math.round(c.x + (pf.ox + Math.sin(time * 1.3 + pf.ph) * 2) * shrink);
        const py = Math.round(c.y - 9 + (pf.oy + Math.cos(time * 1.1 + pf.ph) * 1.5) * shrink);
        const rr = Math.max(1, Math.round(pf.r * scale * (0.35 + 0.65 * shrink)));
        g.fillStyle(col, 0.16 * fade);
        g.fillCircle(px, py, rr);
        g.fillStyle(col, 0.14 * fade);
        g.fillCircle(px - 1, py - 1, Math.max(1, rr - 3));
      });
      c.label?.setPosition(Math.round(c.x - c.labelW / 2), Math.round(c.y - 34)).setAlpha(fade);
    }
  }

  emitLights(): void {
    const L = this.s.lighting;
    for (const c of this.clouds) {
      if (c.condense > 0 || !c.shown.length) continue;
      L.add(c.x, c.y - 9, 34, c.shown.includes('O') && !this.hasH(c.shown) ? E32.red : E32.silver, 0.25);
    }
    for (const l of this.lumps) if (l.fizz >= 0) L.add(l.x, l.y - 2, 70, E32.amber, 0.9);
  }
}
