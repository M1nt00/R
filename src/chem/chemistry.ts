import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { DEPTH } from '../config';
import { E32 } from '../art/palette';
import { playSfx } from '../audio/sfx';
import { formulaLine, joinTerms } from './formula';

/**
 * 화학 반응 시험판: 수소(H)·산소(O)·나트륨(Na)을 던지고, 불(화염방사기)로 불을 붙인다.
 *   H + H          → H₂            저절로 (같은 구름 안에서)
 *   O + O          → O₂            저절로
 *   수소와 산소는 섞기만 하면 아무 일도 없고, 불씨가 닿아야 탄다. 수소가 타면 언제나 물이 남는다:
 *   2H₂ + O₂ / H₂ + O  → 물     산소가 섞여 있으면 한순간에 "쾅" (한 방 + 넉백)
 *   2H₂ + O₂(공기)     → 2H₂O   산소 없이 공기로 타면 "불덩이" (몇 초 동안 넓게 화상, 다 타면 물)
 *   수소가 더 많으면 쾅 다음에 남은 수소가 불덩이로 이어서 탄다
 *   2H₂O + 2Na     → 2NaOH + H₂    물에 나트륨 → 지글거리다 쾅 + 생긴 수소가 노란 불덩이로 탐
 *                                  (물 2개를 쓰고 불덩이에서 1개가 돌아옴 → 결과적으로 1 줄어듦)
 * 쾅·불덩이는 근처 수소 구름에 옮겨붙는다 (연쇄).
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
type Species = 'H' | 'H2' | 'O' | 'O2';
const SPECIES_COLOR: Record<Species, number> = { H: CHEM_COLOR.H, H2: CHEM_COLOR.H, O: CHEM_COLOR.O, O2: CHEM_COLOR.O };

const term = (f: string, color: number): ChemTerm => ({ f, color });

/** 구름 안에서 저절로 일어나는 반응 (원자끼리 결합). 불이 필요한 반응은 ignite()에서 */
interface CloudReaction {
  need: Partial<Record<Species, number>>;
  make: Species[];
  lhs: ChemTerm[];
  rhs: ChemTerm[];
  reveal: number;
}

const CLOUD_REACTIONS: CloudReaction[] = [
  { need: { H: 2 }, make: ['H2'], lhs: [term('H', CHEM_COLOR.H), term('H', CHEM_COLOR.H)], rhs: [term('H2', CHEM_COLOR.H)], reveal: 0.35 },
  { need: { O: 2 }, make: ['O2'], lhs: [term('O', CHEM_COLOR.O), term('O', CHEM_COLOR.O)], rhs: [term('O2', CHEM_COLOR.O)], reveal: 0.35 },
];

/** 수소가 공기 중 산소로 타는 반응식 */
const AIR_BURN = {
  lhs: [term('2H2', CHEM_COLOR.H), term('O2(공기)', CHEM_COLOR.O)],
  rhs: [term('2H2O', CHEM_COLOR.water)],
};

export const THROW_CD = 0.25;
const RANGE = 150;
const CLOUD_R = 16;
const CLOUD_LIFE = 14;
const LUMP_LIFE = 15;
/** 물웅덩이 반지름: H₂O 1개 / 2개 이상. 탑다운이라 세로는 납작하게 */
const WATER_R = 20;
const WATER_R_BIG = 30;
const WATER_SQUASH = 0.7;
const WATER_LIFE = 14;
const WATER_GROW = 0.25;
const WATER_DRAIN = 0.3;
const NA_REVEAL = 0.7;
/** 불이 닿고 구름이 터지기까지 (불길이 구름에 번지는 시간) */
const IGNITE_FUSE = 0.3;
/** 폭발이 옆 구름에 옮겨붙기까지 */
const CHAIN_DELAY = 0.12;
/** 나트륨 반응식 뒤에 "수소가 탔다" 반응식을 이어서 보여주기까지 */
const NA_BURN_EQ_DELAY = 0.6;
/** 연달아 일어나는 반응 사이: 앞 반응 결과를 보여주는 시간 */
const CHAIN_GAP = 0.75;
/** 나트륨 반응의 쾅 (쿨롱 폭발): 뒤이어 노란 불덩이 */
const NA_BLAST_R = 32;
const NA_DAMAGE = 25;
/** 쾅: 던진 산소와 반응한 수소(= 생긴 물) 양에 비례 */
const boomRadius = (water: number) => Math.min(56, 26 + 5 * water);
const boomDamage = (water: number) => 16 + 8 * water;
/** 불덩이 화상 피해 간격 */
const FIREBALL_TICK = 0.35;

type FireKind = 'hydrogen' | 'sodium';
/** 불꽃 색 [가장 뜨거운 속, 가운데, 바깥] */
const FIRE_COLORS: Record<FireKind, [number, number, number]> = {
  // 수소 불꽃은 실제로 거의 안 보이는 옅은 파랑
  hydrogen: [E32.white, E32.cyan, E32.blue],
  // 나트륨이 섞인 불꽃은 노랑 (나트륨 원자가 내는 빛)
  sodium: [E32.white, E32.yellow, E32.amber],
};

interface Fireball {
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
  tickT: number;
  sfxT: number;
  damage: number;
  /** 다 타고 나서 남는 물 */
  water: number;
  kind: FireKind;
  tongues: { ox: number; ph: number }[];
}

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
  /** 불이 붙어 타는 중 (터지기까지 남은 시간), 0 = 아님 */
  burning: number;
  /** 예약된 반응 연출이 끝나는 시각 */
  busyUntil: number;
  /** 라벨 순서 번호: 늦게 끝나는 옛 연출이 새 상태를 덮어쓰지 않게 */
  seq: number;
  shownSeq: number;
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
  /** 라벨이 둥둥 뜨는 박자 */
  ph: number;
}

/** 물웅덩이 원 하나. 반응 한 번에 하나씩 생기고, 자기 몫의 물(H₂O 개수)을 가진다 */
interface WaterSpot {
  x: number;
  y: number;
  /** 지금 반지름 (목표 반지름으로 부드럽게 바뀜) */
  r: number;
  targetR: number;
  amount: number;
  /** 생기는 중 0 → 1 */
  grow: number;
  /** 나트륨 반응으로 마르는 중 (남은 시간), 0 = 아님 */
  drain: number;
  dead: boolean;
  /** 물 표면의 짧은 물결 (웅덩이 안 위치 u·v는 -1~1) */
  dashes: { u: number; v: number; len: number; ph: number }[];
}

/** 눈에 보이게 서로 닿은 원들 = 물웅덩이 하나. 라벨은 전체 양 (예: 3H₂O) */
interface Water {
  spots: WaterSpot[];
  t: number;
  ph: number;
  label: Phaser.GameObjects.Container | null;
  labelW: number;
}

const waterRadius = (amount: number) => (amount >= 2 ? WATER_R_BIG : WATER_R);
const liveSpots = (w: Water) => w.spots.filter((sp) => sp.drain <= 0 && !sp.dead);
const waterAmount = (w: Water) => liveSpots(w).reduce((t, sp) => t + sp.amount, 0);

/** 두 원(납작한 타원)이 눈에 보이게 닿거나 겹치는지 */
function spotsTouch(a: WaterSpot, b: WaterSpot): boolean {
  return Math.hypot(a.x - b.x, (a.y - b.y) / WATER_SQUASH) <= a.targetR + b.targetR;
}

/** 라벨이 둥둥 뜨는 높이 (정수 픽셀, -2 ~ 2) */
const bob = (time: number, ph: number) => Math.round(Math.sin(time * 2.4 + ph) * 1.5);

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

const coef = (n: number) => (n > 1 ? String(n) : '');

/** ['H2','H2','O'] → 2H₂ + O (처음 나온 순서대로, 같은 건 계수로 묶음) */
function speciesTerms(list: readonly Species[]): ChemTerm[] {
  const order: Species[] = [];
  const n = new Map<Species, number>();
  for (const sp of list) {
    if (!n.has(sp)) order.push(sp);
    n.set(sp, (n.get(sp) ?? 0) + 1);
  }
  return order.map((sp) => term(`${coef(n.get(sp)!)}${sp}`, SPECIES_COLOR[sp]));
}

const count = (list: readonly Species[], sp: Species) => list.filter((x) => x === sp).length;

function take(list: Species[], sp: Species, k: number): void {
  for (let i = 0; i < k; i++) list.splice(list.indexOf(sp), 1);
}

function canReact(list: readonly Species[], rx: CloudReaction): boolean {
  return (Object.entries(rx.need) as [Species, number][]).every(([sp, k]) => count(list, sp) >= k);
}

function consume(list: Species[], rx: CloudReaction): void {
  for (const [sp, k] of Object.entries(rx.need) as [Species, number][]) {
    for (let i = 0; i < k; i++) list.splice(list.indexOf(sp), 1);
  }
  list.push(...rx.make);
}

export class ChemSystem {
  throwCd = 0;
  private flasks: Flask[] = [];
  private clouds: Cloud[] = [];
  private lumps: Lump[] = [];
  private waters: Water[] = [];
  private fireballs: Fireball[] = [];
  private readonly g: Phaser.GameObjects.Graphics;
  /** 물웅덩이는 바닥 높이 (캐릭터 아래) */
  private readonly wg: Phaser.GameObjects.Graphics;
  /** 불덩이 (더하기 블렌드로 달아오르게) */
  private readonly fg: Phaser.GameObjects.Graphics;
  private readonly keys: Record<Reagent, Phaser.Input.Keyboard.Key>;

  constructor(private readonly s: RoomScene) {
    makeTextures(s);
    // 조명 위에 그려서 어두운 방에서도 기체가 보이게
    this.g = s.add.graphics().setDepth(DEPTH.vfx - 10);
    this.wg = s.add.graphics().setDepth(DEPTH.terrain + 0.5);
    this.fg = s.add.graphics().setDepth(DEPTH.vfx - 5).setBlendMode(Phaser.BlendModes.ADD);
    const kb = s.input.keyboard!;
    this.keys = { H: kb.addKey(KEY_CODE.H), O: kb.addKey(KEY_CODE.O), Na: kb.addKey(KEY_CODE.Na) };
    this.emit({ type: 'clear' });
  }

  /** 화면 위에 보낸 화학식 수 (예약해 둔 화학식이 더 새 화학식을 덮지 않게) */
  private shownCount = 0;

  private emit(ev: ChemEvent): void {
    if (ev.type !== 'clear') this.shownCount++;
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
    this.updateFireballs(dt);
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

  /** 반응으로 생긴 물웅덩이 또는 원래 있던 웅덩이 지형 */
  private isWater(x: number, y: number): boolean {
    return !!this.waterAt(x, y) || this.s.terrain.infoAt(x, y).kind === 'puddle';
  }

  /** 구름에 물질이 더해짐 → 일어날 수 있는 반응을 차례로 예약. 반응이 없으면 합쳐진 모습만 잠깐 보여줌 */
  private addToCloud(c: Cloud, sp: Species): void {
    c.t = CLOUD_LIFE;
    const before = speciesTerms(c.species);
    c.species.push(sp);
    const steps: { rx: CloudReaction; after: Species[]; seq: number }[] = [];
    for (;;) {
      const rx = CLOUD_REACTIONS.find((r) => canReact(c.species, r));
      if (!rx) break;
      consume(c.species, rx);
      steps.push({ rx, after: [...c.species], seq: ++c.seq });
    }
    if (!steps.length) {
      this.emit({ type: 'mix', terms: [...before, term(sp, SPECIES_COLOR[sp])] });
      this.showSpecies(c, [...c.species], ++c.seq);
      return;
    }
    // 이번에 던진 것으로 연달아 일어나는 반응은 앞 결과를 보여준 뒤 차례로 (새로 던지면 바로 시작)
    const now = this.s.gameTime;
    let at = 0;
    for (const st of steps) {
      this.s.scheduler.after(at, () => this.runStep(c, st.rx, st.after, st.seq));
      at += st.rx.reveal + CHAIN_GAP;
    }
    c.busyUntil = Math.max(c.busyUntil, now + at);
  }

  /** 라벨·구름 모습 갱신 (더 새 상태가 이미 보이고 있으면 무시) */
  private showSpecies(c: Cloud, list: Species[], seq: number): void {
    if (seq < c.shownSeq) return;
    c.shownSeq = seq;
    c.shown = list;
    this.refreshLabel(c);
  }

  /** 기체끼리 결합 (H₂, O₂) */
  private runStep(c: Cloud, rx: CloudReaction, after: Species[], seq: number): void {
    const s = this.s;
    this.emit({ type: 'equation', lhs: rx.lhs, rhs: rx.rhs, revealAt: rx.reveal });
    s.scheduler.after(rx.reveal, () => {
      this.showSpecies(c, after, seq);
      const col = rx.make.includes('O2') ? E32.red : E32.silver;
      s.vfx.ring(c.x, c.y - 9, 4, 18, col, 0.25, 1);
      s.vfx.glow(c.x, c.y - 9, 20, col, 0.25);
    });
  }

  // ───────────────────────── 불 ─────────────────────────

  /** 불에 탈 수 있는 구름: 수소 분자(H₂)가 있고 아직 안 탐 */
  private flammable(c: Cloud): boolean {
    return c.burning <= 0 && c.species.includes('H2');
  }

  /** 불꽃 입자(공중, 손 높이)가 닿은 수소 구름에 불이 붙는다. 구름은 바닥에서 9px 떠 있음 */
  igniteAt(x: number, y: number): void {
    for (const c of this.clouds) {
      if (this.flammable(c) && Math.hypot(x - c.x, y - (c.y - 9)) <= CLOUD_R) this.ignite(c);
    }
  }

  /** 불이 붙음: 잠깐 불길이 번진 뒤, 던져 넣은 산소와 섞인 수소는 쾅, 남은 수소는 공기로 타서 불덩이. 어느 쪽이든 물이 남음 */
  private ignite(c: Cloud): void {
    if (!this.flammable(c)) return;
    const s = this.s;
    const sp = c.species;
    let boom = 0;
    let usedO2 = false;
    let usedO = false;
    while (count(sp, 'H2') >= 2 && count(sp, 'O2') >= 1) {
      take(sp, 'H2', 2);
      take(sp, 'O2', 1);
      boom += 2;
      usedO2 = true;
    }
    while (count(sp, 'H2') >= 1 && count(sp, 'O') >= 1) {
      take(sp, 'H2', 1);
      take(sp, 'O', 1);
      boom += 1;
      usedO = true;
    }
    const fire = count(sp, 'H2');
    take(sp, 'H2', fire);
    const eq = usedO2
      ? { lhs: [term('2H2', CHEM_COLOR.H), term('O2', CHEM_COLOR.O)], rhs: [term('2H2O', CHEM_COLOR.water)] }
      : usedO
        ? { lhs: [term('H2', CHEM_COLOR.H), term('O', CHEM_COLOR.O)], rhs: [term('H2O', CHEM_COLOR.water)] }
        : AIR_BURN;
    this.emit({ type: 'equation', ...eq, revealAt: IGNITE_FUSE });
    const after = [...sp];
    const seq = ++c.seq;
    c.burning = IGNITE_FUSE;
    c.busyUntil = Math.max(c.busyUntil, s.gameTime + IGNITE_FUSE + 0.1);
    playSfx('ignite');
    s.scheduler.after(IGNITE_FUSE, () => {
      c.burning = 0;
      this.showSpecies(c, after, seq);
      const { x, y } = c;
      if (boom > 0) {
        this.blast(x, y - 4, boomRadius(boom), boomDamage(boom), E32.yellow, 'kaboom');
        s.scheduler.after(0.15, () => this.makeWater(x, y, boom));
        if (fire > 0) {
          s.scheduler.after(0.1, () => this.startFireball(x, y, fire, 'hydrogen', fire));
          this.showAfter(NA_BURN_EQ_DELAY, AIR_BURN);
        }
      } else this.startFireball(x, y, fire, 'hydrogen', fire);
    });
  }

  /** 조금 뒤에 이어서 보여줄 반응식 (그 사이 다른 반응이 떴으면 생략) */
  private showAfter(delay: number, eq: { lhs: ChemTerm[]; rhs: ChemTerm[] }): void {
    const mark = this.shownCount;
    this.s.scheduler.after(delay, () => {
      if (this.shownCount === mark) this.emit({ type: 'equation', ...eq, revealAt: IGNITE_FUSE });
    });
  }

  /** 폭발: 피해·넉백, 근처 수소 구름에 옮겨붙음 */
  private blast(x: number, y: number, r: number, damage: number, color: number, sfx: string): void {
    const s = this.s;
    const big = r >= 40;
    s.vfx.explosion(x, y, r, color);
    s.vfx.ring(x, y, 6, r + 10, E32.yellow, 0.35, 2);
    s.vfx.spark(x, y, E32.yellow, 10 + Math.round(r / 4), 130, 90);
    s.vfx.spark(x, y, E32.orange, 8 + Math.round(r / 5), 90, 70);
    s.vfx.glow(x, y - 8, r * 1.3, color, 0.45);
    s.lighting.flash(x, y, r * 5, color, 0.6);
    s.shake(big ? 0.3 : 0.15, big ? 0.012 : 0.006);
    s.hitstop.request(big ? 0.12 : 0.06);
    playSfx(sfx);
    for (const a of s.combat.inCircle(x, y, r, 'enemy')) {
      s.combat.hit(a, { damage: damage * s.player.atkMult, knockback: big ? 280 : 160, fromX: x, fromY: y, isReaction: true, reactionId: 'chem_blast', color });
    }
    for (const c of this.clouds) {
      if (this.flammable(c) && Phaser.Math.Distance.Between(c.x, c.y, x, y) <= r + CLOUD_R) {
        s.scheduler.after(CHAIN_DELAY, () => this.ignite(c));
      }
    }
  }

  /** 수소가 타고 남은 물웅덩이 */
  private makeWater(x: number, y: number, amount: number): void {
    const s = this.s;
    const r = waterRadius(amount);
    this.addWater(x, y, amount);
    s.vfx.ring(x, y, 4, r + 6, E32.blue, 0.3, 2);
    s.vfx.spark(x, y - 6, E32.cyan, 10 + amount * 6, 60, 50);
    s.vfx.glow(x, y - 4, r + 8, E32.blue, 0.3);
    playSfx('splash');
  }

  /** 물 위의 나트륨: 지글거리며 튀어 다니다가 폭발 */
  private startSodium(lump: Lump): void {
    lump.fizz = NA_REVEAL;
    this.emit({
      type: 'equation',
      lhs: [term('2H2O', CHEM_COLOR.water), term('2Na', CHEM_COLOR.Na)],
      rhs: [term('2NaOH', CHEM_COLOR.naoh), term('H2', CHEM_COLOR.H)],
      revealAt: NA_REVEAL,
      fizz: true,
    });
    playSfx('fizz');
  }

  /** 나트륨 반응의 열로 막 생긴 수소에 불이 붙어 폭발 (수소는 타서 안 남음) */
  private explodeSodium(lump: Lump): void {
    const s = this.s;
    const { x, y } = lump;
    this.removeLump(lump);
    // 반응식대로 물은 2H₂O만 쓴다 (나트륨이 떨어진 자리부터)
    const w = this.waterAt(x, y, 4);
    const used = w ? this.consumeWater(w, x, y, 2) : 0;
    s.vfx.spark(x, y, E32.cyan, 18, 150, 110);
    this.blast(x, y, NA_BLAST_R, NA_DAMAGE, E32.amber, 'kaboom');
    // 생긴 수소(H₂)가 그 열로 바로 타서 노란 불덩이 → 다 타면 물 1이 돌아옴 (물 2개를 썼을 때)
    this.startFireball(x, y, 1, 'sodium', Math.floor(used / 2));
    this.showAfter(NA_BURN_EQ_DELAY, AIR_BURN);
  }

  // ───────────────────────── 불덩이 ─────────────────────────

  /** 불덩이: 산소 없이 공기로 타는 수소. 피어올라 몇 초 동안 타며 화상, 다 타면 물이 남음 */
  private startFireball(x: number, y: number, h2: number, kind: FireKind, water: number): void {
    const s = this.s;
    const r = Math.min(44, 24 + 5 * h2);
    const tongues = Array.from({ length: 16 }, (_, i) => ({ ox: (Math.random() - 0.5) * 2, ph: i / 16 + Math.random() * 0.05 }));
    this.fireballs.push({ x, y, r, t: 0, life: Math.min(3.5, 2.2 + 0.4 * h2), tickT: 0.1, sfxT: 0, damage: 2 + h2, water, kind, tongues });
    const col = FIRE_COLORS[kind][1];
    s.vfx.ring(x, y, 4, r, col, 0.3, 2);
    s.vfx.glow(x, y - 10, r * 1.2, col, 0.35);
    s.lighting.flash(x, y, r * 4, col, 0.4);
    s.shake(0.1, 0.004);
    playSfx('fireball');
  }

  /** 피어오를 때 커지고, 끝날 무렵 사그라듦 */
  private fireSize(f: Fireball): number {
    const grow = Math.min(1, f.t / 0.2);
    const end = Math.max(0, Math.min(1, (f.life - f.t) / 0.6));
    return grow * (0.4 + 0.6 * end);
  }

  private updateFireballs(dt: number): void {
    const s = this.s;
    for (const f of this.fireballs) {
      f.t += dt;
      const rr = f.r * this.fireSize(f);
      const [, mid, outer] = FIRE_COLORS[f.kind];
      f.tickT -= dt;
      if (f.tickT <= 0) {
        f.tickT = FIREBALL_TICK;
        for (const a of s.combat.inCircle(f.x, f.y, rr, 'enemy')) {
          s.combat.hit(a, { damage: f.damage * s.player.atkMult, isReaction: true, reactionId: 'fireball', color: mid });
        }
      }
      // 불덩이에 닿은 수소 구름에도 불이 붙음
      for (const c of this.clouds) {
        if (this.flammable(c) && Phaser.Math.Distance.Between(c.x, c.y, f.x, f.y) <= rr + CLOUD_R) this.ignite(c);
      }
      if (Math.random() < dt * 25) s.vfx.spark(f.x + (Math.random() - 0.5) * rr, f.y - 4, Math.random() < 0.5 ? mid : outer, 1, 30, 60);
      f.sfxT -= dt;
      if (f.sfxT <= 0) {
        f.sfxT = 0.3;
        playSfx('flame');
      }
      if (f.t >= f.life) {
        s.vfx.spark(f.x, f.y - 10, E32.white, 8, 25, 40);
        // 수소가 다 타고 나면 물이 남는다
        if (f.water > 0) this.makeWater(f.x, f.y, f.water);
      }
    }
    this.fireballs = this.fireballs.filter((f) => f.t < f.life);
  }

  /** 혀처럼 날름거리며 위로 올라가다 작아지는 불꽃들 + 바닥에 비친 불빛 */
  private drawFireballs(time: number): void {
    const g = this.fg;
    g.clear();
    for (const f of this.fireballs) {
      const r = f.r * this.fireSize(f);
      if (r < 1) continue;
      const [hot, mid, outer] = FIRE_COLORS[f.kind];
      g.fillStyle(mid, 0.18);
      g.fillEllipse(Math.round(f.x), Math.round(f.y), Math.round(r * 2), Math.round(r * 1.2));
      for (const tg of f.tongues) {
        const k = (time * 1.6 + tg.ph) % 1;
        const px = Math.round(f.x + tg.ox * r * 0.6 * (1 - k * 0.6) + Math.sin(time * 9 + tg.ph * 40) * 2);
        const py = Math.round(f.y - 4 - k * r * 1.1);
        const tr = Math.max(1, Math.round(r * 0.36 * (1 - k * 0.8) * (0.85 + 0.25 * Math.sin(time * 14 + tg.ph * 30))));
        g.fillStyle(outer, 0.35);
        g.fillCircle(px, py, tr);
        g.fillStyle(mid, 0.45);
        g.fillCircle(px, py + 1, Math.max(1, Math.round(tr * 0.65)));
        if (k < 0.5) {
          g.fillStyle(hot, 0.55);
          g.fillCircle(px, py + 1, Math.max(1, Math.round(tr * 0.35)));
        }
      }
    }
  }

  // ───────────────────────── 구름 (기체) ─────────────────────────

  private addCloud(x: number, y: number, species: Species[]): Cloud {
    const puffs: Puff[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      const d = 3 + Math.random() * 5;
      puffs.push({ ox: Math.cos(a) * d * 1.3, oy: Math.sin(a) * d * 0.7, r: 5 + Math.random() * 3, ph: Math.random() * 10 });
    }
    const c: Cloud = {
      x,
      y,
      species: [...species],
      shown: [...species],
      t: CLOUD_LIFE,
      age: 0,
      burning: 0,
      busyUntil: 0,
      seq: 0,
      shownSeq: 0,
      puffs,
      label: null,
      labelW: 0,
    };
    this.clouds.push(c);
    this.refreshLabel(c);
    return c;
  }

  private cloudAt(x: number, y: number): Cloud | null {
    let best: Cloud | null = null;
    let bd = CLOUD_R + 8;
    for (const c of this.clouds) {
      if (c.species.length === 0 || c.burning > 0) continue;
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

  private hasH(list: readonly Species[]): boolean {
    return list.includes('H') || list.includes('H2');
  }

  private hasO(list: readonly Species[]): boolean {
    return list.includes('O') || list.includes('O2');
  }

  private updateClouds(dt: number): void {
    const now = this.s.gameTime;
    for (const c of this.clouds) {
      c.age += dt;
      if (c.burning > 0) {
        // 불길이 구름에 번지는 중
        if (Math.random() < dt * 40) this.s.vfx.spark(c.x + (Math.random() - 0.5) * 18, c.y - 8 + (Math.random() - 0.5) * 8, Math.random() < 0.5 ? E32.yellow : E32.orange, 1, 30, 40);
        continue;
      }
      if (!c.shown.length) continue;
      c.t -= dt;
      if (Math.random() < dt * 3) {
        const col = this.hasO(c.shown) && (!this.hasH(c.shown) || Math.random() < 0.5) ? E32.red : E32.silver;
        this.s.vfx.spark(c.x + (Math.random() - 0.5) * 18, c.y - 8 + (Math.random() - 0.5) * 8, col, 1, 6, 14);
      }
    }
    const gone = (c: Cloud) => c.burning <= 0 && (c.t <= 0 || (c.species.length === 0 && now >= c.busyUntil));
    for (const c of this.clouds) if (gone(c)) c.label?.destroy();
    this.clouds = this.clouds.filter((c) => !gone(c));
  }

  // ───────────────────────── 물·나트륨 ─────────────────────────

  /** 점이 물웅덩이(납작한 원) 안인지 */
  private waterAt(x: number, y: number, margin = 2): Water | null {
    for (const w of this.waters) {
      for (const sp of liveSpots(w)) {
        const rx = sp.r * sp.grow + margin;
        const ry = sp.r * WATER_SQUASH * sp.grow + margin;
        const dx = (x - sp.x) / rx;
        const dy = (y - sp.y) / ry;
        if (dx * dx + dy * dy <= 1) return w;
      }
    }
    return null;
  }

  /** 반응으로 생긴 물. 닿는 물이 있으면 하나로 합쳐 양(계수)을 늘린다 (여럿과 닿으면 전부 하나로) */
  private addWater(x: number, y: number, amount: number): void {
    const r = waterRadius(amount);
    const dashes: WaterSpot['dashes'] = [];
    for (let i = 0; i < Math.round(WATER_R_BIG / 2.5); i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * 0.75;
      dashes.push({ u: Math.cos(a) * d, v: Math.sin(a) * d, len: 2 + Math.floor(Math.random() * 3), ph: Math.random() * 10 });
    }
    const spot: WaterSpot = { x, y, r, targetR: r, amount, grow: 0, drain: 0, dead: false, dashes };
    const touching = this.waters.filter((w) => liveSpots(w).some((sp) => spotsTouch(sp, spot)));
    if (!touching.length) {
      const w: Water = { spots: [spot], t: WATER_LIFE, ph: Math.random() * 10, label: null, labelW: 0 };
      this.waters.push(w);
      this.refreshWaterLabel(w);
      return;
    }
    const [main, ...rest] = touching;
    for (const o of rest) {
      main.spots.push(...o.spots);
      o.label?.destroy();
    }
    this.waters = this.waters.filter((w) => !rest.includes(w));
    main.spots.push(spot);
    main.t = WATER_LIFE;
    this.refreshWaterLabel(main);
  }

  /** 반응에 물을 n개 씀: (x, y)에서 가까운 원부터. 다 쓴 원은 마르고, 덜 쓴 원은 작아진다 */
  private consumeWater(w: Water, x: number, y: number, n: number): number {
    // 원 가장자리까지 거리 (안에 있으면 음수) → 떨어진 자리의 원이 먼저
    const edge = (sp: WaterSpot) => Math.hypot(x - sp.x, (y - sp.y) / WATER_SQUASH) - sp.r;
    let need = n;
    for (const sp of liveSpots(w).sort((a, b) => edge(a) - edge(b))) {
      if (need <= 0) break;
      const take = Math.min(need, sp.amount);
      sp.amount -= take;
      need -= take;
      if (sp.amount <= 0) sp.drain = WATER_DRAIN;
      else sp.targetR = waterRadius(sp.amount);
      this.s.vfx.spark(sp.x, sp.y - 4, E32.white, 8, 40, 60);
    }
    this.splitWater(w);
    return n - need;
  }

  /** 가운데 물이 빠져서 끊기면 각자 다른 웅덩이로 나눔 */
  private splitWater(w: Water): void {
    const live = liveSpots(w);
    const groups: WaterSpot[][] = [];
    const seen = new Set<WaterSpot>();
    for (const start of live) {
      if (seen.has(start)) continue;
      const group: WaterSpot[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const sp = stack.pop()!;
        group.push(sp);
        for (const o of live) {
          if (!seen.has(o) && spotsTouch(sp, o)) {
            seen.add(o);
            stack.push(o);
          }
        }
      }
      groups.push(group);
    }
    for (const g of groups.slice(1)) {
      w.spots = w.spots.filter((sp) => !g.includes(sp));
      const nw: Water = { spots: g, t: w.t, ph: Math.random() * 10, label: null, labelW: 0 };
      this.waters.push(nw);
      this.refreshWaterLabel(nw);
    }
    this.refreshWaterLabel(w);
  }

  private refreshWaterLabel(w: Water): void {
    w.label?.destroy();
    w.label = null;
    const amount = waterAmount(w);
    if (amount <= 0) return;
    // 파란 물 위에서도 읽히게 밝은 청록
    const l = this.makeLabel([term(`${coef(amount)}H2O`, E32.cyan)]);
    w.label = l.c;
    w.labelW = l.w;
  }

  private updateWaters(dt: number): void {
    for (const w of this.waters) {
      for (const sp of w.spots) {
        sp.grow = Math.min(1, sp.grow + dt / WATER_GROW);
        sp.r += (sp.targetR - sp.r) * Math.min(1, dt * 8);
        if (sp.drain > 0) {
          sp.drain -= dt;
          if (sp.drain <= 0) sp.dead = true;
        }
      }
      w.spots = w.spots.filter((sp) => !sp.dead);
      if (liveSpots(w).length) w.t -= dt;
    }
    const gone = (w: Water) => w.t <= 0 || w.spots.length === 0;
    for (const w of this.waters) if (gone(w)) w.label?.destroy();
    this.waters = this.waters.filter((w) => !gone(w));
  }

  /** 둥근 물웅덩이: 테두리 → 물 → 윗쪽 밝은 띠 → 물결·반짝임. 닿은 원들은 테두리를 먼저 다 그려서 하나로 이어 보이게 */
  private drawWaters(time: number): void {
    const g = this.wg;
    g.clear();
    for (const w of this.waters) {
      const k = Math.min(1, w.t / 1.5);
      const size = (sp: WaterSpot) => Math.max(0, sp.grow * (sp.drain > 0 ? sp.drain / WATER_DRAIN : 0.6 + 0.4 * k));
      const ell = (sp: WaterSpot, pad: number, dy = 0, shrink = 1) => {
        const s = size(sp) * shrink;
        const ww = Math.round(sp.r * 2 * s) + pad * 2;
        const hh = Math.round(sp.r * 2 * WATER_SQUASH * s) + pad * 2;
        if (ww > 2 && hh > 2) g.fillEllipse(Math.round(sp.x), Math.round(sp.y + dy), ww, hh);
      };
      g.fillStyle(E32.navy, 1);
      for (const sp of w.spots) ell(sp, 1);
      g.fillStyle(E32.blue, 1);
      for (const sp of w.spots) ell(sp, 0);
      // 아래쪽은 살짝 깊어 보이게
      g.fillStyle(E32.navy, 0.35);
      for (const sp of w.spots) ell(sp, 0, Math.round(sp.r * 0.25), 0.7);
      // 윗쪽 밝은 띠 (빛은 왼쪽 위)
      g.fillStyle(E32.cyan, 0.35);
      for (const sp of w.spots) ell(sp, 0, -Math.round(sp.r * 0.3), 0.55);
      g.fillStyle(E32.blue, 1);
      for (const sp of w.spots) ell(sp, 0, -Math.round(sp.r * 0.18), 0.55);
      const live = liveSpots(w);
      // 표면의 짧은 물결 (반짝이며 살짝 흔들림)
      for (const sp of live) {
        const sz = size(sp);
        const n = Math.round(sp.r / 2.5);
        for (const d of sp.dashes.slice(0, n)) {
          const a = 0.25 + 0.3 * Math.sin(time * 2.2 + d.ph);
          if (a <= 0.05) continue;
          g.fillStyle(E32.cyan, a);
          const dx = Math.round(sp.x + d.u * sp.r * sz + Math.sin(time * 0.9 + d.ph) * 1.2);
          const dy = Math.round(sp.y + d.v * sp.r * WATER_SQUASH * sz);
          g.fillRect(dx, dy, d.len, 1);
        }
      }
      // 물결: 가운데서 퍼지는 고리
      for (const sp of live) {
        const p = ((time * 0.7 + w.ph + sp.x * 0.01) % 1 + 1) % 1;
        const rr = sp.r * size(sp) * (0.25 + 0.65 * p);
        g.lineStyle(1, E32.cyan, 0.5 * (1 - p));
        g.strokeEllipse(Math.round(sp.x), Math.round(sp.y), Math.round(rr * 2), Math.round(rr * 2 * WATER_SQUASH));
        // 반짝임 두 점
        const tw = Math.sin(time * 3 + sp.x) > 0.3;
        if (tw && size(sp) > 0.8) {
          g.fillStyle(E32.white, 0.8);
          g.fillRect(Math.round(sp.x - sp.r * 0.45), Math.round(sp.y - sp.r * WATER_SQUASH * 0.45), 2, 1);
          g.fillRect(Math.round(sp.x + sp.r * 0.3), Math.round(sp.y - sp.r * WATER_SQUASH * 0.2), 1, 1);
        }
      }
      if (w.label && live.length) {
        const cx = live.reduce((t, sp) => t + sp.x, 0) / live.length;
        const cy = live.reduce((t, sp) => t + sp.y, 0) / live.length;
        const grow = Math.min(...live.map((sp) => sp.grow));
        w.label.setPosition(Math.round(cx - w.labelW / 2), Math.round(cy - 6 + bob(time, w.ph))).setAlpha(k * grow);
      }
    }
  }

  private addLump(x: number, y: number): Lump {
    const img = this.s.add.image(Math.round(x), Math.round(y), 'na_lump').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
    const l = this.makeLabel([term('Na', CHEM_COLOR.Na)]);
    l.c.setPosition(Math.round(x - l.w / 2), Math.round(y - 18));
    const lump: Lump = { x, y, t: LUMP_LIFE, fizz: -1, img, label: l.c, labelW: l.w, ph: Math.random() * 10 };
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
    this.drawWaters(time);
    this.drawFireballs(time);
    const g = this.g;
    g.clear();
    for (const c of this.clouds) {
      if (!c.shown.length) continue;
      const fade = Math.min(1, c.t / 1.5) * Math.min(1, c.age / 0.25);
      // 타는 중: 불길이 번지며 부풀고, 노랑·주황·빨강으로 일렁임
      const burn = c.burning > 0 ? 1 - c.burning / IGNITE_FUSE : 0;
      const swell = 1 + burn * 0.45;
      const scale = (0.85 + 0.1 * Math.min(c.shown.length, 4)) * swell;
      const hasO = this.hasO(c.shown);
      const both = hasO && this.hasH(c.shown);
      const fire = [E32.yellow, E32.amber, E32.orange, E32.red];
      c.puffs.forEach((pf, i) => {
        const col = c.burning > 0 ? fire[(i + Math.floor(time * 18)) % fire.length] : both ? (i % 2 ? E32.red : E32.silver) : hasO ? E32.red : E32.silver;
        const px = Math.round(c.x + (pf.ox + Math.sin(time * 1.3 + pf.ph) * 2) * swell);
        const py = Math.round(c.y - 9 + (pf.oy + Math.cos(time * 1.1 + pf.ph) * 1.5) * swell);
        const rr = Math.max(1, Math.round(pf.r * scale));
        const a = c.burning > 0 ? 0.3 + 0.2 * burn : 0.16;
        g.fillStyle(col, a * fade);
        g.fillCircle(px, py, rr);
        g.fillStyle(col, (a - 0.02) * fade);
        g.fillCircle(px - 1, py - 1, Math.max(1, rr - 3));
      });
      c.label?.setPosition(Math.round(c.x - c.labelW / 2), Math.round(c.y - 34 + bob(time, c.puffs[0].ph))).setAlpha(fade);
    }
    for (const l of this.lumps) l.label.setPosition(Math.round(l.x - l.labelW / 2), Math.round(l.y - 18 + bob(time, l.ph)));
  }

  emitLights(): void {
    const L = this.s.lighting;
    for (const c of this.clouds) {
      if (!c.shown.length) continue;
      if (c.burning > 0) L.add(c.x, c.y - 9, 70, E32.orange, 0.9);
      else L.add(c.x, c.y - 9, 34, this.hasO(c.shown) && !this.hasH(c.shown) ? E32.red : E32.silver, 0.25);
    }
    for (const l of this.lumps) if (l.fizz >= 0) L.add(l.x, l.y - 2, 70, E32.amber, 0.9);
    for (const w of this.waters) for (const sp of liveSpots(w)) L.add(sp.x, sp.y, sp.r * 2.4, E32.blue, 0.5 * sp.grow);
    for (const f of this.fireballs) L.add(f.x, f.y - 10, f.r * 2.6 * this.fireSize(f), FIRE_COLORS[f.kind][1], 0.9);
  }
}
