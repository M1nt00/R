import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { DEPTH } from '../config';
import { E32 } from '../art/palette';
import { playSfx } from '../audio/sfx';
import { formulaLine, joinTerms } from './formula';
import { playFx, type FxKey } from './fx';

/**
 * 화학 반응 시험판 (설계 문서: 「화학 반응 액션 로그라이트 설계 문서」)
 * 시약 수소(H)·산소(O)·나트륨(Na)·탄소(C) (첫 줄), 염소(Cl)·질소(N) (F로 바꾸는 둘째 줄)을 던지고, 화염방사기로 불씨를 붙인다.
 *   H + H → H₂, O + O → O₂      원자끼리는 저절로 결합 (같은 구름 안에서)
 *   C + O → CO, CO + O → CO₂, C + O₂ → CO₂
 *   수소와 산소는 섞기만 하면 그대로, 불씨가 닿아야 터진다. 수소가 타면 언제나 물이 남는다:
 *   2H₂ + O₂ → 2H₂O             수소만 있으면 공기 중 산소로 타서 약한 폭발
 *   H₂ + O / 2H₂ + O₂ → 물      산소가 섞여 있으면 큰 폭발
 *   2H₂O + 2Na → 2NaOH + H₂     물에 나트륨 → 지글 → 폭발 (생긴 수소도 바로 타서 물 2를 쓰고 1이 돌아옴)
 *   6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂ CO₂가 든 구름이 물웅덩이 위에 있으면 광합성 (빛·식물은 생략)
 *                               → 포도당 열매, 그 구름의 CO₂가 O₂로 바뀜
 *   C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O 열매를 먹으면 세포 호흡으로 HP 회복
 *   Cl + Cl → Cl₂, N + N → N₂   Cl₂는 독가스 (안의 적이 피해), N₂는 타지 않음
 *   H₂ + Cl₂ → 2HCl             불을 붙이면 초록빛 폭발, 염화수소가 구름에 남음
 *   2Na + Cl₂ → 2NaCl           염소 구름 속 나트륨이 노랗게 타오르다 터지고 소금이 남음
 *   HCl + H₂O → H₃O⁺ + Cl⁻      염화수소 구름이 물 위에 있으면 염산 웅덩이 (위에 선 적이 피해)
 *   N₂가 든 구름이 닿아 있으면 그 수소 구름엔 불이 안 붙음 (연쇄도 멈춤)
 *   N₂ + 3H₂ → 2NH₃             질소가 섞인 수소 구름에 불: 터지지 않고 암모니아 (촉매·압력은 생략)
 *   NH₃ + HCl → NH₄Cl           같은 구름이거나 두 구름이 닿으면 흰 연기 (안의 적이 느려짐)
 *   N₂ + 2O₂ → 2NO₂             폭발에 휘말린 질소는 공기 중 산소와 이산화질소 (갈색 독가스)
 * 폭발은 근처 수소 구름에 옮겨붙는다 (연쇄). 플레이어는 자기 반응에 맞지 않는다.
 * 화면 위 화학식은 무언가와 합쳐질 때만 뜨고 잠시 뒤 사라진다 (땅의 구름·물·나트륨·열매 라벨은 남음).
 */

export type Reagent = 'H' | 'O' | 'Na' | 'C' | 'Cl' | 'N';
export const REAGENTS: readonly Reagent[] = ['H', 'O', 'Na', 'C', 'Cl', 'N'];
/** 시약 줄 두 개 × 4칸: 1~4는 지금 줄의 칸을 던지고, F로 줄을 바꾼다. null = 빈 칸 (새 시약 자리) */
export const BELTS: readonly (readonly (Reagent | null)[])[] = [
  ['H', 'O', 'Na', 'C'],
  ['Cl', 'N', null, null],
];
const SLOT_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR'];

/** 분자 모형 관례색(CPK): 수소 흰색, 산소 빨강, 나트륨 보라, 탄소 짙은 회색, 염소 초록, 질소 파랑 */
export const CHEM_COLOR = {
  H: E32.white,
  O: E32.red,
  Na: E32.magenta,
  C: E32.slate,
  Cl: E32.lime,
  N: E32.blue,
  /** 일산화탄소·이산화탄소는 색 없는 기체라 회색으로 */
  CO: E32.steel,
  CO2: E32.steel,
  water: E32.blue,
  glucose: E32.amber,
  naoh: E32.sand,
  /** 염화수소·암모니아는 색 없는 기체라 라벨만 염소·질소 색, 염화암모늄·소금은 흰 연기·흰 결정, 이산화질소는 적갈색 */
  HCl: E32.lime,
  NH3: E32.blue,
  NH4Cl: E32.white,
  NO2: E32.clay,
  NaCl: E32.white,
  acid: E32.lime,
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
type Species = 'H' | 'H2' | 'O' | 'O2' | 'C' | 'CO' | 'CO2' | 'Cl' | 'Cl2' | 'N' | 'N2' | 'HCl' | 'NH3' | 'NH4Cl' | 'NO2';
const SPECIES_COLOR: Record<Species, number> = {
  H: CHEM_COLOR.H,
  H2: CHEM_COLOR.H,
  O: CHEM_COLOR.O,
  O2: CHEM_COLOR.O,
  C: CHEM_COLOR.C,
  CO: CHEM_COLOR.CO,
  CO2: CHEM_COLOR.CO2,
  Cl: CHEM_COLOR.Cl,
  Cl2: CHEM_COLOR.Cl,
  N: CHEM_COLOR.N,
  N2: CHEM_COLOR.N,
  HCl: CHEM_COLOR.HCl,
  NH3: CHEM_COLOR.NH3,
  NH4Cl: CHEM_COLOR.NH4Cl,
  NO2: CHEM_COLOR.NO2,
};

const term = (f: string, color: number): ChemTerm => ({ f, color });

/** 반응식 검산용: 항들의 원자 수 합 ("2H2O" → H 4, O 2. 앞 숫자는 계수) */
function atomCount(terms: ChemTerm[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const { f } of terms) {
    const [, k, rest] = /^(\d*)(.*)$/.exec(f)!;
    for (const [, el, n] of rest.matchAll(/([A-Z][a-z]?)(\d*)/g)) m.set(el, (m.get(el) ?? 0) + Number(k || 1) * Number(n || 1));
  }
  return m;
}

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
  { need: { C: 1, O2: 1 }, make: ['CO2'], lhs: [term('C', CHEM_COLOR.C), term('O2', CHEM_COLOR.O)], rhs: [term('CO2', CHEM_COLOR.CO2)], reveal: 0.35 },
  { need: { C: 1, O: 1 }, make: ['CO'], lhs: [term('C', CHEM_COLOR.C), term('O', CHEM_COLOR.O)], rhs: [term('CO', CHEM_COLOR.CO)], reveal: 0.35 },
  { need: { CO: 1, O: 1 }, make: ['CO2'], lhs: [term('CO', CHEM_COLOR.CO), term('O', CHEM_COLOR.O)], rhs: [term('CO2', CHEM_COLOR.CO2)], reveal: 0.35 },
  { need: { Cl: 2 }, make: ['Cl2'], lhs: [term('Cl', CHEM_COLOR.Cl), term('Cl', CHEM_COLOR.Cl)], rhs: [term('Cl2', CHEM_COLOR.Cl)], reveal: 0.35 },
  { need: { N: 2 }, make: ['N2'], lhs: [term('N', CHEM_COLOR.N), term('N', CHEM_COLOR.N)], rhs: [term('N2', CHEM_COLOR.N)], reveal: 0.35 },
  { need: { NH3: 1, HCl: 1 }, make: ['NH4Cl'], lhs: [term('NH3', CHEM_COLOR.NH3), term('HCl', CHEM_COLOR.HCl)], rhs: [term('NH4Cl', CHEM_COLOR.NH4Cl)], reveal: 0.35 },
];

const HCL_EQ = { lhs: [term('H2', CHEM_COLOR.H), term('Cl2', CHEM_COLOR.Cl)], rhs: [term('2HCl', CHEM_COLOR.HCl)] };
const NO2_EQ = { lhs: [term('N2', CHEM_COLOR.N), term('2O2', CHEM_COLOR.O)], rhs: [term('2NO2', CHEM_COLOR.NO2)] };

/** 수소가 공기 중 산소로 타는 반응식 */
const AIR_BURN = {
  lhs: [term('2H2', CHEM_COLOR.H), term('O2', CHEM_COLOR.O)],
  rhs: [term('2H2O', CHEM_COLOR.water)],
};

export const THROW_CD = 0.25;
const RANGE = 150;
const CLOUD_R = 16;
/** 두 구름이 눈에 보이게 닿는 거리 (중심끼리). 던진 시약은 CLOUD_R + 8 안이면 같은 구름에 합쳐짐 */
const TOUCH = 44;
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
/** 나트륨 반응의 폭발 (쿨롱 폭발 + 생긴 수소가 그 열로 탐) */
const NA_BLAST_R = 32;
const NA_DAMAGE = 25;
/** 큰 폭발: 던진 산소와 반응한 수소 양에 비례 */
const boomRadius = (h2: number) => Math.min(56, 26 + 5 * h2);
const boomDamage = (h2: number) => 16 + 8 * h2;
/** 약한 폭발: 공기 중 산소로 탄 수소 양에 비례 */
const weakRadius = (h2: number) => Math.min(40, 22 + 4 * h2);
const weakDamage = (h2: number) => 8 + 4 * h2;
/** 광합성: 반응식이 나오고 열매가 열리기까지, 같은 구름의 다음 광합성까지 */
const PHOTO_REVEAL = 0.6;
const PHOTO_CD = 1.2;
/** 구름(바닥 기준 자리)이 물웅덩이 위로 쳐주는 여유 */
const PHOTO_MARGIN = 6;
/** 광합성 때 위에서 내리쬐는 빛: 바닥까지 내려오는 시간, 사라지기 시작하는 때, 사라지는 시간 */
const BEAM_IN = 0.18;
const BEAM_HOLD = 1.0;
const BEAM_OUT = 0.5;
/** 해는 왼쪽 위: 위로 갈수록 왼쪽으로 기울어짐 (높이 1px당) */
const BEAM_TILT = 0.18;
/** 열매를 먹으면 회복하는 HP, 열매가 남아 있는 시간 */
const FRUIT_HEAL = 25;
const FRUIT_LIFE = 30;
/** 독가스(Cl₂·NO₂)·염산·흰 연기가 적에게 효과를 주는 간격과 세기 */
const GAS_TICK = 0.5;
const POISON_DMG = 3;
const ACID_DMG = 3;
const SMOKE_SLOW = 0.45;
/** 반응식이 나오고 결과가 보이기까지: 암모니아, 염산 */
const AMMONIA_REVEAL = 0.5;
const ACID_REVEAL = 0.5;
/** 염소 속 나트륨이 타고 터지는 크기, 남은 소금이 있는 시간 */
const NA_CL_R = 26;
const NA_CL_DAMAGE = 18;
const SALT_LIFE = 12;
/** 질소에 막혀 불이 안 붙었다는 표시를 다시 띄우기까지 (불줄기는 매 프레임 닿음) */
const QUENCH_CD = 0.8;

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
  /** 지난 몇 프레임의 병 위치 (꼬리) */
  trail: { x: number; y: number }[];
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
  /** 다음 광합성까지 남은 시간 */
  photoCd: number;
  /** 예약된 반응 연출이 끝나는 시각 */
  busyUntil: number;
  /** 라벨 순서 번호: 늦게 끝나는 옛 연출이 새 상태를 덮어쓰지 않게 */
  seq: number;
  shownSeq: number;
  /** 기체 효과(독·느려짐) 다음 틱까지, 불이 막혔다는 표시 다시 띄우기까지 */
  tick: number;
  quenchCd: number;
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
  /** 염소 속에서 타는 중 (물이 아니라) */
  salt: boolean;
}

/** 남은 소금 (2Na + Cl₂ → 2NaCl) */
interface Salt {
  x: number;
  y: number;
  t: number;
  ph: number;
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Container;
  labelW: number;
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
  /** 염화수소가 녹아 염산이 됨, 다음 피해 틱까지 */
  acid: boolean;
  tick: number;
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

/** 광합성 때 위에서 내리쬐는 빛줄기 (x, y = 빛이 닿는 바닥) */
interface SunBeam {
  x: number;
  y: number;
  t: number;
  ph: number;
}

/** 포도당 열매 */
interface Fruit {
  x: number;
  y: number;
  t: number;
  /** 열린 뒤 떨어지는 중 0 → 1 */
  drop: number;
  ph: number;
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Container;
  labelW: number;
}

const FRUIT = ['...L...', '..oLo..', '.oYYAo.', 'oYWYAAo', 'oYYAAro', '.oAAro.', '..ooo..'];

const FLASK = ['..ccc..', '..oGo..', '..oGo..', '.oLLLo.', 'oLWLLLo', 'oLLLLlo', 'oLLLllo', '.olllo.', '..ooo..'];
const LUMP = ['.oooo.', 'oWSSso', 'oSssdo', '.oooo.'];
const SALT = ['..ss..', '.sWWs.', 'sWWSSs', 'ssssss'];
const LIQUID: Record<Reagent, [string, string]> = {
  H: ['#c0cbdc', '#8b9bb4'],
  O: ['#e43b44', '#a22633'],
  Na: ['#b55088', '#68386c'],
  C: ['#5a6988', '#3a4466'],
  Cl: ['#63c74d', '#3e8948'],
  N: ['#0099db', '#124e89'],
};

const liquidColor = (r: Reagent): number => parseInt(LIQUID[r][0].slice(1), 16);

type Pal = Phaser.Types.Create.Palette;

function makeTextures(s: Phaser.Scene): void {
  for (const r of REAGENTS) {
    const key = `flask_${r}`;
    if (s.textures.exists(key)) continue;
    const pal = { o: '#181425', c: '#b86f50', G: '#c0cbdc', W: '#ffffff', L: LIQUID[r][0], l: LIQUID[r][1] };
    s.textures.generate(key, { data: FLASK, pixelWidth: 1, palette: pal as unknown as Pal });
  }
  if (!s.textures.exists('glucose')) {
    const pal = { L: '#63c74d', o: '#3e2731', Y: '#fee761', A: '#feae34', r: '#f77622', W: '#ffffff' };
    s.textures.generate('glucose', { data: FRUIT, pixelWidth: 1, palette: pal as unknown as Pal });
  }
  if (!s.textures.exists('na_lump')) {
    const pal = { o: '#3a4466', W: '#ffffff', S: '#c0cbdc', s: '#8b9bb4', d: '#5a6988' };
    s.textures.generate('na_lump', { data: LUMP, pixelWidth: 1, palette: pal as unknown as Pal });
  }
  if (!s.textures.exists('salt')) {
    const pal = { s: '#8b9bb4', W: '#ffffff', S: '#c0cbdc' };
    s.textures.generate('salt', { data: SALT, pixelWidth: 1, palette: pal as unknown as Pal });
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
  private salts: Salt[] = [];
  private fruits: Fruit[] = [];
  private beams: SunBeam[] = [];
  private readonly g: Phaser.GameObjects.Graphics;
  /** 물웅덩이는 바닥 높이 (캐릭터 아래) */
  private readonly wg: Phaser.GameObjects.Graphics;
  /** 광합성 빛줄기 (더하기 블렌드, 조명 위) */
  private readonly beamG: Phaser.GameObjects.Graphics;
  private readonly keys: Phaser.Input.Keyboard.Key[];
  private readonly beltKey: Phaser.Input.Keyboard.Key;
  /** 지금 쓰는 시약 줄 (BELTS 번호) */
  belt = 0;

  constructor(private readonly s: RoomScene) {
    makeTextures(s);
    // 조명 위에 그려서 어두운 방에서도 기체가 보이게
    this.g = s.add.graphics().setDepth(DEPTH.vfx - 10);
    this.wg = s.add.graphics().setDepth(DEPTH.terrain + 0.5);
    this.beamG = s.add.graphics().setDepth(DEPTH.vfx - 20).setBlendMode(Phaser.BlendModes.ADD);
    const kb = s.input.keyboard!;
    this.keys = SLOT_KEYS.map((k) => kb.addKey(k));
    this.beltKey = kb.addKey('F');
    this.emit({ type: 'clear' });
  }

  /** 화면 위에 보낸 화학식 수 (예약해 둔 화학식이 더 새 화학식을 덮지 않게) */
  private shownCount = 0;

  private emit(ev: ChemEvent): void {
    // 개발 중 자체 검사: 화면에 띄우는 반응식은 모두 여기를 지나므로, 양쪽 원자 수가 다르면 콘솔에 오류
    if (import.meta.env.DEV && ev.type === 'equation') {
      const l = atomCount(ev.lhs);
      const r = atomCount(ev.rhs);
      const ok = l.size === r.size && [...l].every(([el, n]) => r.get(el) === n);
      console.assert(ok, `[chem] 원자 수가 안 맞는 반응식: ${ev.lhs.map((t) => t.f).join(' + ')} → ${ev.rhs.map((t) => t.f).join(' + ')}`);
    }
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
    if (!p.dead && !p.inputLocked && this.s.combatEnabled) {
      if (Phaser.Input.Keyboard.JustDown(this.beltKey)) {
        this.belt = (this.belt + 1) % BELTS.length;
        playSfx('tick');
      }
      if (!p.rolling && this.throwCd <= 0) {
        const r = BELTS[this.belt][this.keys.findIndex((k) => Phaser.Input.Keyboard.JustDown(k))];
        if (r) this.throwReagent(r);
      }
    }
    this.updateFlasks(dt);
    this.updateClouds(dt);
    this.updateLumps(dt);
    this.updateWaters(dt);
    this.updatePhotosynthesis(dt);
    this.updateAcid();
    this.updateSalts(dt);
    for (const b of this.beams) b.t += dt;
    this.beams = this.beams.filter((b) => b.t < BEAM_HOLD + BEAM_OUT);
    this.updateFruits(dt);
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
    this.flasks.push({ r, sx, sy, tx, ty, t: 0, dur: 0.16 + dist / 650, h: 8 + dist * 0.16, spin: Math.cos(a) < 0 ? -1 : 1, img, shadow, trail: [] });
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
      f.trail.push({ x: f.img.x, y: f.img.y });
      if (f.trail.length > 4) f.trail.shift();
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
    if (f.r !== 'Na') playFx(s, 'shatter_splash', f.tx, f.ty, liquidColor(f.r), DEPTH.vfx - 1);
    playFx(s, 'shatter_glass', f.tx, f.ty);
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
    this.s.vfx.burst(x, y - 8, this.gasColors([r])[0], 8);
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

  /** 구름에 물질이 더해짐 → 일어날 수 있는 반응을 차례로 예약. 반응이 없으면 합쳐진 모습만 잠깐 보여줌 (quiet면 안 보여줌) */
  private addToCloud(c: Cloud, sp: Species, quiet = false): void {
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
      if (!quiet) this.emit({ type: 'mix', terms: [...before, term(sp, SPECIES_COLOR[sp])] });
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
      const col = this.gasColors(rx.make)[0];
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
    // 연쇄 점화는 0.12초 뒤에 오므로 그사이 시간이 다 돼 사라진 구름은 건너뜀
    if (!this.flammable(c) || !this.clouds.includes(c)) return;
    const s = this.s;
    const sp = c.species;
    // 같은 구름의 질소는 수소와 암모니아가 되고, 옆에 닿은 질소 구름은 불길을 덮어 막는다
    if (sp.includes('N2')) return this.makeAmmonia(c);
    if (this.clouds.some((o) => o !== c && o.species.includes('N2') && Phaser.Math.Distance.Between(o.x, o.y, c.x, c.y) <= TOUCH)) return this.quench(c);
    let hcl = 0;
    while (count(sp, 'H2') >= 1 && count(sp, 'Cl2') >= 1) {
      take(sp, 'H2', 1);
      take(sp, 'Cl2', 1);
      hcl += 1;
    }
    let mixed = 0;
    let usedO2 = false;
    let usedO = false;
    while (count(sp, 'H2') >= 2 && count(sp, 'O2') >= 1) {
      take(sp, 'H2', 2);
      take(sp, 'O2', 1);
      mixed += 2;
      usedO2 = true;
    }
    while (count(sp, 'H2') >= 1 && count(sp, 'O') >= 1) {
      take(sp, 'H2', 1);
      take(sp, 'O', 1);
      mixed += 1;
      usedO = true;
    }
    // 수소 분자가 하나만 남아도 산소 분자와 섞여 있으면 같이 터짐 (계수는 표기용)
    if (count(sp, 'H2') === 1 && count(sp, 'O2') >= 1) {
      take(sp, 'H2', 1);
      take(sp, 'O2', 1);
      mixed += 1;
      usedO2 = true;
    }
    const air = count(sp, 'H2');
    take(sp, 'H2', air);
    const eq = usedO2
      ? { lhs: [term('2H2', CHEM_COLOR.H), term('O2', CHEM_COLOR.O)], rhs: [term('2H2O', CHEM_COLOR.water)] }
      : usedO
        ? { lhs: [term('H2', CHEM_COLOR.H), term('O', CHEM_COLOR.O)], rhs: [term('H2O', CHEM_COLOR.water)] }
        : AIR_BURN;
    // 염소와 탄 수소가 있으면 그 반응식이 먼저, 산소·공기로 탄 수소는 이어서
    this.emit({ type: 'equation', ...(hcl > 0 ? HCL_EQ : eq), revealAt: IGNITE_FUSE });
    if (hcl > 0 && mixed + air > 0) this.showAfter(IGNITE_FUSE + NA_BURN_EQ_DELAY, eq);
    const after = [...sp];
    const seq = ++c.seq;
    c.burning = IGNITE_FUSE;
    c.busyUntil = Math.max(c.busyUntil, s.gameTime + IGNITE_FUSE + 0.1);
    playSfx('ignite');
    s.scheduler.after(IGNITE_FUSE, () => {
      c.burning = 0;
      this.showSpecies(c, after, seq);
      const { x, y } = c;
      if (mixed > 0) {
        // 산소가 섞여 있으면 큰 폭발 (남는 수소가 있으면 공기로 같이 타서 조금 더 커짐)
        const r = Math.min(64, boomRadius(mixed) + 3 * air);
        this.blast(x, y - 4, r, boomDamage(mixed) + 4 * air, true, E32.yellow, E32.orange, 'kaboom', r > 44 ? 'boom_l' : 'boom_s');
        if (air > 0 && hcl === 0) this.showAfter(NA_BURN_EQ_DELAY, AIR_BURN);
      } else if (hcl > 0) {
        // 수소·염소 폭발: 초록빛 (염소 색)
        const r = Math.min(64, boomRadius(hcl) + 3 * air);
        this.blast(x, y - 4, r, boomDamage(hcl) + 4 * air, true, E32.lime, E32.yellow, 'kaboom', 'boom_w', E32.lime);
      } else {
        // 산소 없이 공기 중 산소로 타면 약한 폭발 (수소 불꽃 색인 옅은 파랑)
        this.blast(x, y - 4, weakRadius(air), weakDamage(air), false, E32.cyan, E32.white, 'boom', 'boom_w');
      }
      // 염화수소는 그 구름에 남고 (2HCl), 산소·공기로 탄 수소는 물이 된다
      for (let i = 0; i < hcl * 2; i++) this.addToCloud(c, 'HCl', true);
      if (mixed + air > 0) s.scheduler.after(0.15, () => this.makeWater(x, y, mixed + air));
    });
  }

  /** 질소가 섞인 수소 구름에 불: 터지지 않고 암모니아 (게임이라 촉매·압력 생략, 계수는 표기용) */
  private makeAmmonia(c: Cloud): void {
    const s = this.s;
    let made = 0;
    while (c.species.includes('N2') && c.species.includes('H2')) {
      take(c.species, 'N2', 1);
      take(c.species, 'H2', Math.min(3, count(c.species, 'H2')));
      made += 2;
    }
    this.emit({ type: 'equation', lhs: [term('N2', CHEM_COLOR.N), term('3H2', CHEM_COLOR.H)], rhs: [term('2NH3', CHEM_COLOR.NH3)], revealAt: AMMONIA_REVEAL });
    c.busyUntil = Math.max(c.busyUntil, s.gameTime + AMMONIA_REVEAL + 0.1);
    playSfx('ignite');
    s.scheduler.after(AMMONIA_REVEAL, () => {
      if (!this.clouds.includes(c)) return;
      for (let i = 0; i < made; i++) this.addToCloud(c, 'NH3', true);
      s.vfx.ring(c.x, c.y - 9, 4, 20, CHEM_COLOR.N, 0.3, 1);
      s.vfx.glow(c.x, c.y - 9, 22, CHEM_COLOR.N, 0.3);
    });
  }

  /** 옆 질소 구름이 불길을 덮음: 연기만 나고 안 붙음 (불줄기는 매 프레임 닿으니 표시는 가끔) */
  private quench(c: Cloud): void {
    if (c.quenchCd > 0) return;
    c.quenchCd = QUENCH_CD;
    const s = this.s;
    this.emit({ type: 'mix', terms: [...speciesTerms(c.species), term('N2', CHEM_COLOR.N)] });
    s.vfx.spark(c.x, c.y - 9, E32.steel, 8, 30, 40);
    s.vfx.ring(c.x, c.y - 9, 4, 16, CHEM_COLOR.N, 0.3, 1);
    playSfx('sizzle');
  }

  /** 조금 뒤에 이어서 보여줄 반응식 (그 사이 다른 반응이 떴으면 생략) */
  private showAfter(delay: number, eq: { lhs: ChemTerm[]; rhs: ChemTerm[] }): void {
    const mark = this.shownCount;
    this.s.scheduler.after(delay, () => {
      if (this.shownCount === mark) this.emit({ type: 'equation', ...eq, revealAt: IGNITE_FUSE });
    });
  }

  /** 폭발: 피해·넉백 (적만), 근처 수소 구름에 옮겨붙음 */
  private blast(x: number, y: number, r: number, damage: number, big: boolean, color: number, color2: number, sfx: string, fx: FxKey, tint?: number): void {
    const s = this.s;
    playFx(s, fx, x, y - 4, tint);
    s.vfx.scorch(x, y, r / 18, 0.75);
    s.vfx.ring(x, y, 6, r + 10, color, 0.35, 2);
    s.vfx.spark(x, y, color, 10 + Math.round(r / 4), 130, 90);
    s.vfx.spark(x, y, color2, 8 + Math.round(r / 5), 90, 70);
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
      // 폭발에 휘말린 질소는 공기 중 산소와 이산화질소 (수소 구름에 닿아 불을 막고 있는 질소는 그대로)
      const guarding = this.clouds.some((o) => this.flammable(o) && Phaser.Math.Distance.Between(o.x, o.y, c.x, c.y) <= TOUCH);
      if (c.burning <= 0 && !guarding && c.species.includes('N2') && Phaser.Math.Distance.Between(c.x, c.y, x, y) <= r + CLOUD_R) this.makeNO2(c);
    }
  }

  private makeNO2(c: Cloud): void {
    const s = this.s;
    const n = count(c.species, 'N2');
    take(c.species, 'N2', n);
    for (let i = 0; i < n * 2; i++) c.species.push('NO2');
    const after = [...c.species];
    const seq = ++c.seq;
    c.t = CLOUD_LIFE;
    c.busyUntil = Math.max(c.busyUntil, s.gameTime + NA_BURN_EQ_DELAY + IGNITE_FUSE + 0.1);
    this.showAfter(NA_BURN_EQ_DELAY, NO2_EQ);
    s.scheduler.after(NA_BURN_EQ_DELAY + IGNITE_FUSE, () => {
      this.showSpecies(c, after, seq);
      s.vfx.ring(c.x, c.y - 9, 4, 20, CHEM_COLOR.NO2, 0.35, 1);
      s.vfx.glow(c.x, c.y - 9, 22, CHEM_COLOR.NO2, 0.3);
    });
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

  /** 나트륨이 물과 반응해 폭발. 그 열로 막 생긴 수소도 바로 탄다 (수소는 안 남음) */
  private explodeSodium(lump: Lump): void {
    const s = this.s;
    const { x, y } = lump;
    this.removeLump(lump);
    // 반응식대로 물은 2H₂O만 쓴다 (나트륨이 떨어진 자리부터)
    const w = this.waterAt(x, y, 4);
    const used = w ? this.consumeWater(w, x, y, 2) : 0;
    s.vfx.spark(x, y, E32.cyan, 18, 150, 110);
    this.blast(x, y, NA_BLAST_R, NA_DAMAGE, true, E32.amber, E32.yellow, 'kaboom', 'boom_na');
    // 생긴 수소(H₂)가 타서 물 1이 돌아옴 (물 2개를 썼을 때)
    const back = Math.floor(used / 2);
    if (back > 0) s.scheduler.after(0.2, () => this.makeWater(x, y, back));
    this.showAfter(NA_BURN_EQ_DELAY, AIR_BURN);
  }

  /** 염소 구름 속 나트륨: 노랗게 타오름 (2Na + Cl₂ → 2NaCl) */
  private startSalt(lump: Lump, c: Cloud): void {
    take(c.species, 'Cl2', 1);
    this.showSpecies(c, [...c.species], ++c.seq);
    c.busyUntil = Math.max(c.busyUntil, this.s.gameTime + NA_REVEAL + 0.1);
    lump.fizz = NA_REVEAL;
    lump.salt = true;
    this.emit({
      type: 'equation',
      lhs: [term('2Na', CHEM_COLOR.Na), term('Cl2', CHEM_COLOR.Cl)],
      rhs: [term('2NaCl', CHEM_COLOR.NaCl)],
      revealAt: NA_REVEAL,
      fizz: true,
    });
    playSfx('ignite');
  }

  /** 다 타고 작게 터진 뒤 소금이 남음 */
  private burnSodium(lump: Lump): void {
    const { x, y } = lump;
    this.removeLump(lump);
    this.blast(x, y, NA_CL_R, NA_CL_DAMAGE, false, E32.yellow, E32.white, 'boom', 'boom_na');
    const img = this.s.add.image(Math.round(x), Math.round(y), 'salt').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
    const l = this.makeLabel([term('NaCl', CHEM_COLOR.NaCl)]);
    this.salts.push({ x, y, t: SALT_LIFE, ph: Math.random() * 10, img, label: l.c, labelW: l.w });
  }

  private updateSalts(dt: number): void {
    for (const sa of this.salts) {
      sa.t -= dt;
      const a = Math.min(1, sa.t / 1.5);
      sa.img.setAlpha(a);
      sa.label.setAlpha(a);
      if (sa.t <= 0) {
        sa.img.destroy();
        sa.label.destroy();
      }
    }
    this.salts = this.salts.filter((sa) => sa.t > 0);
  }

  // ───────────────────────── 염산 ─────────────────────────

  /** 염화수소가 든 구름이 물 위에 있으면 녹아서 염산 (HCl + H₂O → H₃O⁺ + Cl⁻) */
  private updateAcid(): void {
    const s = this.s;
    const now = s.gameTime;
    for (const c of this.clouds) {
      if (c.burning > 0 || now < c.busyUntil || !c.species.includes('HCl')) continue;
      const w = this.waterAt(c.x, c.y, PHOTO_MARGIN);
      if (!w) continue;
      take(c.species, 'HCl', 1);
      const after = [...c.species];
      const seq = ++c.seq;
      c.busyUntil = now + ACID_REVEAL + 0.1;
      this.emit({
        type: 'equation',
        lhs: [term('HCl', CHEM_COLOR.HCl), term('H2O', CHEM_COLOR.water)],
        rhs: [term('H3O+', CHEM_COLOR.acid), term('Cl-', CHEM_COLOR.Cl)],
        revealAt: ACID_REVEAL,
      });
      playSfx('fizz');
      s.scheduler.after(ACID_REVEAL, () => {
        this.showSpecies(c, after, seq);
        w.acid = true;
        w.t = WATER_LIFE;
        this.refreshWaterLabel(w);
        s.vfx.spark(c.x, c.y - 4, E32.lime, 12, 40, 50);
        s.vfx.ring(c.x, c.y, 4, 26, E32.lime, 0.3, 1);
      });
    }
  }

  // ───────────────────────── 광합성 ─────────────────────────

  /**
   * CO₂가 든 구름이 물웅덩이 위에 있으면 광합성 (빛·식물은 게임이라 생략):
   * 그 구름의 CO₂ 하나 + 물 1 → 포도당 열매 하나, CO₂는 O₂가 되어 같은 구름에 남음
   */
  private updatePhotosynthesis(dt: number): void {
    const s = this.s;
    const now = s.gameTime;
    for (const c of this.clouds) {
      c.photoCd = Math.max(0, c.photoCd - dt);
      // 앞 반응 연출(예: CO + O → CO₂)이 끝난 뒤에
      if (c.photoCd > 0 || c.burning > 0 || now < c.busyUntil || !c.species.includes('CO2')) continue;
      const w = this.waterAt(c.x, c.y, PHOTO_MARGIN);
      if (!w) continue;
      // 라벨은 열매가 열릴 때 CO₂ → O₂로 바뀜
      take(c.species, 'CO2', 1);
      this.consumeWater(w, c.x, c.y, 1);
      c.photoCd = PHOTO_CD;
      c.t = CLOUD_LIFE;
      c.busyUntil = Math.max(c.busyUntil, now + PHOTO_REVEAL + 0.1);
      this.emit({
        type: 'equation',
        lhs: [term('6CO2', CHEM_COLOR.CO2), term('6H2O', CHEM_COLOR.water)],
        rhs: [term('C6H12O6', CHEM_COLOR.glucose), term('6O2', CHEM_COLOR.O)],
        revealAt: PHOTO_REVEAL,
      });
      playSfx('photo');
      // 빛과 식물은 생략했지만 연출로 위에서 빛이 내리쬠
      this.beams.push({ x: c.x, y: c.y, t: 0, ph: Math.random() * 10 });
      s.scheduler.after(PHOTO_REVEAL, () => {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.addFruit(c.x + side * (16 + Math.random() * 6), c.y + 2 + Math.random() * 4);
        // 나온 산소는 그 구름에 남음 (수소와 섞어 불을 붙이면 큰 폭발)
        if (this.clouds.includes(c) && c.burning <= 0) this.addToCloud(c, 'O2', true);
        else this.addCloud(c.x, c.y, ['O2']);
        s.vfx.ring(c.x, c.y - 9, 4, 24, E32.lime, 0.35, 2);
        s.vfx.spark(c.x, c.y - 10, E32.lime, 14, 50, 60);
        s.lighting.flash(c.x, c.y - 9, 120, E32.lime, 0.5);
      });
    }
  }

  /** 빛줄기 세기: 들어올 때 차오르고, 열매가 열리는 순간 한 번 더 환해졌다가, 서서히 사라짐 */
  private beamPower(b: SunBeam): number {
    const fadeIn = Math.min(1, b.t / BEAM_IN);
    const fadeOut = b.t > BEAM_HOLD ? Math.max(0, 1 - (b.t - BEAM_HOLD) / BEAM_OUT) : 1;
    const pulse = b.t >= PHOTO_REVEAL ? 0.7 * Math.exp(-(b.t - PHOTO_REVEAL) * 7) : 0;
    return fadeIn * fadeOut + pulse * fadeOut;
  }

  private addFruit(x: number, y: number): void {
    const img = this.s.add.image(Math.round(x), Math.round(y - 10), 'glucose').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
    const l = this.makeLabel([term('C6H12O6', CHEM_COLOR.glucose)]);
    this.fruits.push({ x, y, t: FRUIT_LIFE, drop: 0, ph: Math.random() * 10, img, label: l.c, labelW: l.w });
  }

  private removeFruit(f: Fruit): void {
    f.img.destroy();
    f.label.destroy();
    this.fruits = this.fruits.filter((o) => o !== f);
  }

  /** 열매를 주우면(HP가 닳았을 때) 세포 호흡: 포도당을 태워 에너지 → HP 회복 */
  private updateFruits(dt: number): void {
    const s = this.s;
    const p = s.player;
    for (const f of [...this.fruits]) {
      f.t -= dt;
      f.drop = Math.min(1, f.drop + dt / 0.3);
      if (f.drop >= 1 && !p.dead && p.hp < p.maxHp && Phaser.Math.Distance.Between(p.x, p.y, f.x, f.y) <= 12) {
        this.removeFruit(f);
        p.heal(FRUIT_HEAL);
        this.emit({
          type: 'equation',
          lhs: [term('C6H12O6', CHEM_COLOR.glucose), term('6O2', CHEM_COLOR.O)],
          rhs: [term('6CO2', CHEM_COLOR.CO2), term('6H2O', CHEM_COLOR.water)],
          revealAt: 0.35,
        });
        s.vfx.ring(p.x, p.y - 6, 4, 20, E32.lime, 0.4, 2);
        s.vfx.spark(p.x, p.y - 10, E32.lime, 12, 40, 70);
        playSfx('heal');
        continue;
      }
      if (f.t <= 0) this.removeFruit(f);
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
      photoCd: 0,
      busyUntil: 0,
      seq: 0,
      shownSeq: 0,
      tick: GAS_TICK,
      quenchCd: 0,
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
    const now = this.s.gameTime;
    for (const c of this.clouds) {
      // 비어 가는 구름은 건너뜀 (광합성처럼 곧 무언가 생길 구름은 받음)
      if (c.burning > 0 || (c.species.length === 0 && now >= c.busyUntil)) continue;
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

  /** 구름에 든 기체별 색: 수소 은색, 산소 빨강, 탄소 짙은 회색, 일산화·이산화탄소 회색, 염소 연두, 질소 파랑 (나머지는 CHEM_COLOR) */
  private gasColors(list: readonly Species[]): number[] {
    const cols: number[] = [];
    if (this.hasH(list) || list.includes('NH3')) cols.push(E32.silver);
    if (this.hasO(list)) cols.push(E32.red);
    if (list.includes('C')) cols.push(E32.slate);
    if (list.includes('CO') || list.includes('CO2')) cols.push(E32.steel);
    if (list.includes('Cl') || list.includes('Cl2')) cols.push(E32.lime);
    if (list.includes('N') || list.includes('N2')) cols.push(E32.blue);
    // 염화수소는 색 없는 기체: 수소 은색 + 염소 연두를 섞어 염소 구름보다 옅게
    if (list.includes('HCl')) cols.push(E32.silver, E32.lime);
    for (const sp of ['NH4Cl', 'NO2'] as const) if (list.includes(sp)) cols.push(CHEM_COLOR[sp]);
    return cols.length ? cols : [E32.silver];
  }

  private updateClouds(dt: number): void {
    const now = this.s.gameTime;
    for (const c of this.clouds) {
      c.age += dt;
      if (c.burning > 0) {
        // 불길이 구름에 번지는 중. 남은 시간을 줄여 그리기에서 부풀고 밝아지게 함 (0으로 만드는 건 점화 예약 쪽)
        c.burning = Math.max(0.01, c.burning - dt);
        if (Math.random() < dt * 40) this.s.vfx.spark(c.x + (Math.random() - 0.5) * 18, c.y - 8 + (Math.random() - 0.5) * 8, Math.random() < 0.5 ? E32.yellow : E32.orange, 1, 30, 40);
        continue;
      }
      if (!c.shown.length) continue;
      c.t -= dt;
      c.quenchCd = Math.max(0, c.quenchCd - dt);
      c.tick -= dt;
      if (c.tick <= 0) {
        c.tick = GAS_TICK;
        this.gasEffect(c);
      }
      if (Math.random() < dt * 3) {
        const cols = this.gasColors(c.shown);
        const col = cols[Math.floor(Math.random() * cols.length)];
        this.s.vfx.spark(c.x + (Math.random() - 0.5) * 18, c.y - 8 + (Math.random() - 0.5) * 8, col, 1, 6, 14);
      }
    }
    this.mixSmoke(now);
    const gone = (c: Cloud) => c.burning <= 0 && (c.t <= 0 || (c.species.length === 0 && now >= c.busyUntil));
    for (const c of this.clouds) if (gone(c)) c.label?.destroy();
    this.clouds = this.clouds.filter((c) => !gone(c));
  }

  /** 독가스(Cl₂·NO₂)는 안의 적에게 피해, 흰 연기(NH₄Cl)는 느려지게. 화면에 보이는 물질 기준 */
  private gasEffect(c: Cloud): void {
    const s = this.s;
    const poison = count(c.shown, 'Cl2') + count(c.shown, 'NO2');
    const smoke = c.shown.includes('NH4Cl');
    if (!poison && !smoke) return;
    const color = c.shown.includes('Cl2') ? E32.lime : CHEM_COLOR.NO2;
    for (const a of s.combat.inCircle(c.x, c.y, CLOUD_R + 4, 'enemy')) {
      if (poison) s.combat.hit(a, { damage: POISON_DMG * poison * s.player.atkMult, isReaction: true, reactionId: 'chem_gas', color });
      if (smoke) a.slow(SMOKE_SLOW, GAS_TICK + 0.2);
    }
  }

  /** 암모니아 구름과 염화수소 구름이 닿으면 염화수소가 옮겨가 흰 연기 (NH₃ + HCl → NH₄Cl) */
  private mixSmoke(now: number): void {
    const idle = (c: Cloud) => c.burning <= 0 && now >= c.busyUntil;
    for (const a of this.clouds) {
      if (!idle(a) || !a.species.includes('NH3')) continue;
      const b = this.clouds.find((o) => o !== a && idle(o) && o.species.includes('HCl') && Phaser.Math.Distance.Between(o.x, o.y, a.x, a.y) <= TOUCH);
      if (!b) continue;
      take(b.species, 'HCl', 1);
      this.showSpecies(b, [...b.species], ++b.seq);
      this.addToCloud(a, 'HCl', true);
    }
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
      const w: Water = { spots: [spot], t: WATER_LIFE, ph: Math.random() * 10, acid: false, tick: 0, label: null, labelW: 0 };
      this.waters.push(w);
      this.refreshWaterLabel(w);
      return;
    }
    const [main, ...rest] = touching;
    for (const o of rest) {
      main.spots.push(...o.spots);
      main.acid ||= o.acid;
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
      const nw: Water = { spots: g, t: w.t, ph: Math.random() * 10, acid: w.acid, tick: 0, label: null, labelW: 0 };
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
    const water = term(`${coef(amount)}H2O`, E32.cyan);
    const l = this.makeLabel(w.acid ? [water, term('HCl', CHEM_COLOR.acid)] : [water]);
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
      if (w.acid && (w.tick -= dt) <= 0) {
        w.tick = GAS_TICK;
        this.acidBurn(w);
      }
    }
    const gone = (w: Water) => w.t <= 0 || w.spots.length === 0;
    for (const w of this.waters) if (gone(w)) w.label?.destroy();
    this.waters = this.waters.filter((w) => !gone(w));
  }

  /** 염산 위에 선 적이 피해 */
  private acidBurn(w: Water): void {
    const s = this.s;
    const seen = new Set<unknown>();
    for (const sp of liveSpots(w)) {
      for (const a of s.combat.inCircle(sp.x, sp.y, sp.r, 'enemy')) {
        if (seen.has(a) || this.waterAt(a.x, a.y, a.radius) !== w) continue;
        seen.add(a);
        s.combat.hit(a, { damage: ACID_DMG * s.player.atkMult, isReaction: true, reactionId: 'chem_acid', color: CHEM_COLOR.acid });
      }
    }
  }

  /** 둥근 물웅덩이: 테두리 → 물 → 윗쪽 밝은 띠 → 물결·반짝임. 닿은 원들은 테두리를 먼저 다 그려서 하나로 이어 보이게 */
  private drawWaters(time: number): void {
    const g = this.wg;
    g.clear();
    for (const w of this.waters) {
      const k = Math.min(1, w.t / 1.5);
      // 염산은 초록빛
      const [deep, mid, hi] = w.acid ? [E32.forest, E32.green, E32.lime] : [E32.navy, E32.blue, E32.cyan];
      const size = (sp: WaterSpot) => Math.max(0, sp.grow * (sp.drain > 0 ? sp.drain / WATER_DRAIN : 0.6 + 0.4 * k));
      const ell = (sp: WaterSpot, pad: number, dy = 0, shrink = 1) => {
        const s = size(sp) * shrink;
        const ww = Math.round(sp.r * 2 * s) + pad * 2;
        const hh = Math.round(sp.r * 2 * WATER_SQUASH * s) + pad * 2;
        if (ww > 2 && hh > 2) g.fillEllipse(Math.round(sp.x), Math.round(sp.y + dy), ww, hh);
      };
      g.fillStyle(deep, 1);
      for (const sp of w.spots) ell(sp, 1);
      g.fillStyle(mid, 1);
      for (const sp of w.spots) ell(sp, 0);
      // 아래쪽은 살짝 깊어 보이게
      g.fillStyle(deep, 0.35);
      for (const sp of w.spots) ell(sp, 0, Math.round(sp.r * 0.25), 0.7);
      // 윗쪽 밝은 띠 (빛은 왼쪽 위)
      g.fillStyle(hi, 0.35);
      for (const sp of w.spots) ell(sp, 0, -Math.round(sp.r * 0.3), 0.55);
      g.fillStyle(mid, 1);
      for (const sp of w.spots) ell(sp, 0, -Math.round(sp.r * 0.18), 0.55);
      const live = liveSpots(w);
      // 표면의 짧은 물결 (반짝이며 살짝 흔들림)
      for (const sp of live) {
        const sz = size(sp);
        const n = Math.round(sp.r / 2.5);
        for (const d of sp.dashes.slice(0, n)) {
          const a = 0.25 + 0.3 * Math.sin(time * 2.2 + d.ph);
          if (a <= 0.05) continue;
          g.fillStyle(hi, a);
          const dx = Math.round(sp.x + d.u * sp.r * sz + Math.sin(time * 0.9 + d.ph) * 1.2);
          const dy = Math.round(sp.y + d.v * sp.r * WATER_SQUASH * sz);
          g.fillRect(dx, dy, d.len, 1);
        }
      }
      // 물결: 가운데서 퍼지는 고리
      for (const sp of live) {
        const p = ((time * 0.7 + w.ph + sp.x * 0.01) % 1 + 1) % 1;
        const rr = sp.r * size(sp) * (0.25 + 0.65 * p);
        g.lineStyle(1, hi, 0.5 * (1 - p));
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
    const lump: Lump = { x, y, t: LUMP_LIFE, fizz: -1, img, label: l.c, labelW: l.w, ph: Math.random() * 10, salt: false };
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
        if (l.fizz <= 0) {
          if (l.salt) this.burnSodium(l);
          else this.explodeSodium(l);
        }
        continue;
      }
      l.t -= dt;
      l.label.setAlpha(Math.min(1, l.t / 1.5));
      const cl = this.clouds.find((c) => c.burning <= 0 && c.shown.includes('Cl2') && c.species.includes('Cl2') && Phaser.Math.Distance.Between(c.x, c.y, l.x, l.y) <= CLOUD_R + 4);
      if (this.isWater(l.x, l.y)) this.startSodium(l);
      else if (cl) this.startSalt(l, cl);
      else if (l.t <= 0) this.removeLump(l);
    }
  }

  // ───────────────────────── 그리기 ─────────────────────────

  draw(time: number): void {
    this.drawWaters(time);
    this.drawBeams(time);
    const g = this.g;
    g.clear();
    for (const f of this.flasks) {
      const col = liquidColor(f.r);
      // 병 그림 위로는 안 긋게 직전 위치까지만
      for (let i = 1; i < f.trail.length; i++) {
        g.lineStyle(1, col, 0.2 * i);
        g.lineBetween(f.trail[i - 1].x, f.trail[i - 1].y, f.trail[i].x, f.trail[i].y);
      }
    }
    for (const c of this.clouds) {
      if (!c.shown.length) continue;
      const fade = Math.min(1, c.t / 1.5) * Math.min(1, c.age / 0.25);
      // 타는 중: 불길이 번지며 부풀고, 노랑·주황·빨강으로 일렁임
      const burn = c.burning > 0 ? 1 - c.burning / IGNITE_FUSE : 0;
      const swell = 1 + burn * 0.45;
      const scale = (0.85 + 0.1 * Math.min(c.shown.length, 4)) * swell;
      const cols = this.gasColors(c.shown);
      const fire = [E32.yellow, E32.amber, E32.orange, E32.red];
      c.puffs.forEach((pf, i) => {
        const col = c.burning > 0 ? fire[(i + Math.floor(time * 18)) % fire.length] : cols[i % cols.length];
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
    for (const sa of this.salts) sa.label.setPosition(Math.round(sa.x - sa.labelW / 2), Math.round(sa.y - 18 + bob(time, sa.ph)));
    for (const l of this.lumps) l.label.setPosition(Math.round(l.x - l.labelW / 2), Math.round(l.y - 18 + bob(time, l.ph)));
    for (const f of this.fruits) {
      // 열매가 톡 떨어지고, 사라지기 전 3초 동안 깜빡임
      const fall = Math.round((1 - f.drop) * 10);
      const blink = f.t < 3 && Math.floor(f.t * 6) % 2 === 0;
      f.img.setPosition(Math.round(f.x), Math.round(f.y - fall)).setAlpha(blink ? 0.35 : 1);
      f.label.setPosition(Math.round(f.x - f.labelW / 2), Math.round(f.y - 20 + bob(time, f.ph))).setAlpha(f.drop >= 1 ? (blink ? 0.35 : 1) : 0);
    }
  }

  /** 위(화면 밖)에서 바닥까지 비스듬히 내리쬐는 빛. 1px 단위 가로줄로 쌓아서 가장자리가 픽셀로 또렷하게 */
  private drawBeams(time: number): void {
    const g = this.beamG;
    g.clear();
    const top = Math.floor(this.s.cameras.main.worldView.y) - 4;
    for (const b of this.beams) {
      const k = this.beamPower(b);
      if (k <= 0.01) continue;
      const h = b.y - top;
      if (h <= 0) continue;
      // 위에서 바닥까지 빠르게 내려옴
      const reach = Math.min(1, b.t / BEAM_IN);
      const bottom = top + Math.round(h * reach);
      const shimmer = 1 + 0.12 * Math.sin(time * 9 + b.ph);
      const cxAt = (y: number) => b.x - (b.y - y) * BEAM_TILT;
      const widthAt = (y: number) => 14 + 30 * ((y - top) / h);
      // 열매가 열리는 순간 빛기둥 한가운데가 하얗게 번쩍
      const flash = b.t >= PHOTO_REVEAL ? Math.exp(-(b.t - PHOTO_REVEAL) * 7) : 0;
      for (let y = top; y < bottom; y += 2) {
        const cx = cxAt(y);
        const w = widthAt(y);
        if (flash > 0.02) {
          g.fillStyle(E32.white, 0.35 * flash);
          g.fillRect(Math.round(cx - w * 0.1), y, Math.max(2, Math.round(w * 0.2)), 2);
        }
        // 번진 가장자리 → 따뜻한 빛 → 노란 심
        g.fillStyle(E32.sand, 0.04 * k * shimmer);
        g.fillRect(Math.round(cx - w * 0.7), y, Math.round(w * 1.4), 2);
        g.fillStyle(E32.amber, 0.08 * k * shimmer);
        g.fillRect(Math.round(cx - w / 2), y, Math.round(w), 2);
        g.fillStyle(E32.yellow, 0.1 * k * shimmer);
        g.fillRect(Math.round(cx - w / 4), y, Math.round(w / 2), 2);
        // 빛 속의 가는 줄기 두 개 (일렁임)
        for (let i = 0; i < 2; i++) {
          const a = 0.05 * k * (0.5 + 0.5 * Math.sin(time * 3 + i * 2.3 + b.ph));
          g.fillStyle(E32.white, a);
          g.fillRect(Math.round(cx + (i === 0 ? -0.3 : 0.18) * w), y, 2, 2);
        }
      }
      // 바닥에 닿은 빛 웅덩이
      if (reach >= 1) {
        g.fillStyle(E32.amber, 0.14 * k);
        g.fillEllipse(Math.round(b.x), Math.round(b.y), 56, 18);
        g.fillStyle(E32.yellow, 0.16 * k);
        g.fillEllipse(Math.round(b.x), Math.round(b.y), 34, 11);
      }
      // 빛 속을 천천히 떠내려오는 먼지
      for (let i = 0; i < 7; i++) {
        const p = (time * 0.3 + i / 7 + b.ph) % 1;
        const y = top + p * h;
        if (y > bottom) continue;
        const w = widthAt(y);
        const x = cxAt(y) + Math.sin(time * 1.7 + i * 2.1 + b.ph) * w * 0.35;
        g.fillStyle(E32.white, 0.6 * Math.min(1, k) * Math.sin(Math.PI * p));
        g.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      // 빛을 받은 웅덩이에서 방울이 흔들리며 올라옴
      if (reach >= 1) {
        for (let i = 0; i < 6; i++) {
          const p = (b.t * 0.8 + i / 6) % 1;
          const x = b.x + Math.sin(i * 2.4 + b.ph) * 12 + Math.sin(time * 5 + i) * 1.5;
          const sz = i % 3 === 0 ? 2 : 1;
          g.fillStyle(i % 2 ? E32.lime : E32.white, 0.8 * Math.min(1, k) * Math.sin(Math.PI * p));
          g.fillRect(Math.round(x), Math.round(b.y - 2 - p * 36), sz, sz);
        }
      }
    }
    // 열매가 맺혀 떨어지는 동안 십자 반짝임 (draw()의 열매 위치와 같게)
    for (const f of this.fruits) {
      if (f.drop >= 1) continue;
      const n = Math.round(1 + 4 * Math.sin(Math.PI * f.drop));
      const x = Math.round(f.x);
      const y = Math.round(f.y - (1 - f.drop) * 10) - 4;
      g.fillStyle(E32.white, 0.9);
      g.fillRect(x - n, y, n * 2 + 1, 1);
      g.fillRect(x, y - n, 1, n * 2 + 1);
      g.fillStyle(E32.yellow, 0.6);
      g.fillRect(x - 1, y - 1, 3, 3);
    }
  }

  emitLights(): void {
    const L = this.s.lighting;
    for (const c of this.clouds) {
      if (!c.shown.length) continue;
      if (c.burning > 0) L.add(c.x, c.y - 9, 70, E32.orange, 0.9);
      else L.add(c.x, c.y - 9, 34, this.gasColors(c.shown)[0], 0.25);
    }
    for (const l of this.lumps) if (l.fizz >= 0) L.add(l.x, l.y - 2, 70, E32.amber, 0.9);
    for (const w of this.waters) for (const sp of liveSpots(w)) L.add(sp.x, sp.y, sp.r * 2.4, w.acid ? E32.lime : E32.blue, 0.5 * sp.grow);
    for (const f of this.fruits) L.add(f.x, f.y - 4, 26, E32.amber, 0.4);
    for (const sa of this.salts) L.add(sa.x, sa.y - 2, 24, E32.white, 0.4 * Math.min(1, sa.t / 1.5));
    // 빛줄기가 바닥과 그 위 구름을 밝힘
    for (const b of this.beams) {
      const k = Math.min(1, this.beamPower(b)) * Math.min(1, b.t / BEAM_IN);
      if (k <= 0.01) continue;
      L.add(b.x, b.y, 80, E32.yellow, 0.9 * k);
      L.add(b.x - 30 * BEAM_TILT, b.y - 30, 50, E32.sand, 0.6 * k);
    }
  }
}
