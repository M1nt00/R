import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { DEPTH } from '../config';
import { E32 } from '../art/palette';
import { playSfx } from '../audio/sfx';
import { formulaLine, joinTerms } from './formula';
import { playFx, type FxKey } from './fx';

/**
 * 화학 반응 시험판 (설계 문서: 「화학 반응 액션 로그라이트 설계 문서」)
 * 시약병에는 실제로 있는 그대로 담겨 있다: 기체는 분자(H₂·O₂·Cl₂·N₂), 나트륨(Na)·탄소(C)는 고체 덩어리·가루.
 * 첫 줄 H₂·O₂·Na·C, F로 바꾸는 둘째 줄 Cl₂·N₂. 화염방사기로 불씨를 붙인다.
 * 공기에는 산소가 없다고 친다: 불은 던져 넣은 것끼리만 반응시키고, 반응식 계수만큼 다 모여야 반응한다.
 *   2H₂ + O₂ → 2H₂O              불 → 큰 폭발, 물이 남음 (짝이 안 맞는 수소·산소는 그대로 남음)
 *   H₂ + Cl₂ → 2HCl              불 → 초록빛 폭발, 염화수소가 구름에 남음
 *   N₂ + 3H₂ → 2NH₃              질소가 섞인 수소 구름에 불: 터지지 않고 암모니아 (촉매·압력은 생략)
 *                                질소 구름이 닿아 있거나 수소가 셋보다 모자라면 불이 안 붙음 (연쇄도 멈춤)
 *   NH₃ + HCl → NH₄Cl            같은 구름이거나 두 구름이 닿으면 흰 연기 (안의 적이 느려짐)
 *   N₂ + 2O₂ → 2NO₂              산소 둘이 섞인 질소 구름이 폭발에 휘말리면 이산화질소 (갈색 독가스)
 *   C + O₂ → CO₂, 2C + O₂ → 2CO  산소 구름 아래 탄소 가루에 불: 산소가 넉넉하면 CO₂, 모자라면 CO
 *   2Na + 2H₂O → 2NaOH + H₂      같은 자리 나트륨 둘이 물에 닿으면 지글 → 폭발, 생긴 수소는 구름으로 남음
 *   2Na + Cl₂ → 2NaCl            염소 구름 속 나트륨 둘이 노랗게 타오르다 터지고 소금이 남음
 *   HCl + H₂O → H₃O⁺ + Cl⁻       염화수소 구름이 물 위에 있으면 염산 웅덩이 (위에 선 적이 피해)
 *   6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂  CO₂ 여섯이 든 구름이 물 6 이상인 웅덩이 위에 있으면 광합성 (빛·식물은 생략)
 *                                → 포도당 열매, 그 구름의 CO₂가 O₂로 바뀜
 *   C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O  열매를 먹으면 세포 호흡으로 HP 회복
 *   Cl₂·NO₂ 구름은 독가스 (안의 적이 피해)
 * 폭발은 근처 수소 구름에 옮겨붙는다 (연쇄). 플레이어는 자기 반응에 맞지 않는다.
 * 화면 위 화학식은 무언가와 합쳐질 때만 뜨고 잠시 뒤 사라진다 (땅의 구름·물·나트륨·탄소·열매 라벨은 남음).
 */

/**
 * 병에 든 그대로: 기체는 분자, 나트륨·탄소·아이오딘은 고체, 물은 액체 (웅덩이에서 담아 옴).
 * 같은 물질의 다른 상태는 이름 뒤에 붙임: I2g = 기체 아이오딘 (고체를 점화해 승화), HIaq = 아이오딘화수소산 (HI가 물에 녹음).
 * 화면에는 붙인 글자 없이 (I₂, HI) 나오고 상태는 아이콘(시험관·플라스크)으로 구분
 */
export type Reagent = 'H2' | 'O2' | 'Na' | 'C' | 'Cl2' | 'N2' | 'I2' | 'H2O' | 'I2g' | 'HI' | 'HIaq';
export const REAGENTS: readonly Reagent[] = ['H2', 'O2', 'Na', 'C', 'Cl2', 'N2', 'I2', 'H2O', 'I2g', 'HI', 'HIaq'];
/** 화면에 쓰는 화학식 (상태 글자 떼기) */
export const formulaText = (f: string): string => f.replace('I2g', 'I2').replace('HIaq', 'HI');
type Solid = 'Na' | 'C' | 'I2';
const isSolid = (r: Reagent): r is Solid => r === 'Na' || r === 'C' || r === 'I2';
/** 액체 시약 (핫바 아이콘이 삼각 플라스크) */
export const LIQUID_REAGENTS: readonly Reagent[] = ['H2O', 'HIaq'];
/** 시약 줄 두 개 × 4칸: 1~4는 지금 줄의 칸을 던지고, F로 줄을 바꾼다. null = 빈 칸 (새 시약 자리) */
export const BELTS: readonly (readonly (Reagent | null)[])[] = [
  ['H2', 'O2', 'Na', 'C'],
  ['Cl2', 'N2', 'I2', null],
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
  /** 아이오딘: 관례색은 짙은 보라인데 E32의 plum은 어두운 칸·바닥에서 안 읽혀서, 아이오딘 증기 같은 밝은 보라 (E32 밖 색) */
  I: 0xa884f3,
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
  /** 아이오딘화수소: 색 없는 기체라 분홍으로 (보라 아이오딘 구름과 구분) */
  HI: E32.pink,
  acid: E32.lime,
  op: E32.steel,
} as const;

/** 시약병·슬롯 색 (원소 관례색) */
export const REAGENT_COLOR: Record<Reagent, number> = {
  H2: CHEM_COLOR.H,
  O2: CHEM_COLOR.O,
  Na: CHEM_COLOR.Na,
  C: CHEM_COLOR.C,
  Cl2: CHEM_COLOR.Cl,
  N2: CHEM_COLOR.N,
  I2: CHEM_COLOR.I,
  /** 물: 파란 웅덩이·어두운 칸에서도 읽히게 밝은 청록 (땅 라벨과 같은 색) */
  H2O: E32.cyan,
  I2g: CHEM_COLOR.I,
  HI: CHEM_COLOR.HI,
  HIaq: CHEM_COLOR.HI,
};

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
type Species = 'H2' | 'O2' | 'CO' | 'CO2' | 'Cl2' | 'N2' | 'HCl' | 'NH3' | 'NH4Cl' | 'NO2' | 'I2g' | 'HI';
const SPECIES_COLOR: Record<Species, number> = {
  H2: CHEM_COLOR.H,
  O2: CHEM_COLOR.O,
  CO: CHEM_COLOR.CO,
  CO2: CHEM_COLOR.CO2,
  Cl2: CHEM_COLOR.Cl,
  N2: CHEM_COLOR.N,
  HCl: CHEM_COLOR.HCl,
  NH3: CHEM_COLOR.NH3,
  NH4Cl: CHEM_COLOR.NH4Cl,
  NO2: CHEM_COLOR.NO2,
  I2g: CHEM_COLOR.I,
  HI: CHEM_COLOR.HI,
};

const term = (f: string, color: number): ChemTerm => ({ f: formulaText(f), color });

/** 반응식 검산용: 항들의 원자 수 합 ("2H2O" → H 4, O 2. 앞 숫자는 계수) */
function atomCount(terms: ChemTerm[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const { f } of terms) {
    const [, k, rest] = /^(\d*)(.*)$/.exec(f)!;
    for (const [, el, n] of rest.matchAll(/([A-Z][a-z]?)(\d*)/g)) m.set(el, (m.get(el) ?? 0) + Number(k || 1) * Number(n || 1));
  }
  return m;
}

/** 구름 안에서 저절로 일어나는 반응. 불이 필요한 반응은 ignite()·burnCarbon()에서 */
interface CloudReaction {
  need: Partial<Record<Species, number>>;
  make: Species[];
  lhs: ChemTerm[];
  rhs: ChemTerm[];
  reveal: number;
}

const CLOUD_REACTIONS: CloudReaction[] = [
  { need: { NH3: 1, HCl: 1 }, make: ['NH4Cl'], lhs: [term('NH3', CHEM_COLOR.NH3), term('HCl', CHEM_COLOR.HCl)], rhs: [term('NH4Cl', CHEM_COLOR.NH4Cl)], reveal: 0.35 },
];

const HCL_EQ = { lhs: [term('H2', CHEM_COLOR.H), term('Cl2', CHEM_COLOR.Cl)], rhs: [term('2HCl', CHEM_COLOR.HCl)] };
const HI_EQ = { lhs: [term('H2', CHEM_COLOR.H), term('I2', CHEM_COLOR.I)], rhs: [term('2HI', CHEM_COLOR.HI)] };
const NO2_EQ = { lhs: [term('N2', CHEM_COLOR.N), term('2O2', CHEM_COLOR.O)], rhs: [term('2NO2', CHEM_COLOR.NO2)] };

const H2O_EQ = { lhs: [term('2H2', CHEM_COLOR.H), term('O2', CHEM_COLOR.O)], rhs: [term('2H2O', CHEM_COLOR.water)] };
const CO2_EQ = { lhs: [term('C', CHEM_COLOR.C), term('O2', CHEM_COLOR.O)], rhs: [term('CO2', CHEM_COLOR.CO2)] };
const CO_EQ = { lhs: [term('2C', CHEM_COLOR.C), term('O2', CHEM_COLOR.O)], rhs: [term('2CO', CHEM_COLOR.CO)] };

export const THROW_CD = 0.25;
const RANGE = 150;
/** 던진 병이 맵 경계에서 이만큼 안쪽에 떨어짐 */
const BOUND_PAD = 6;
const CLOUD_R = 16;
/** 두 구름이 눈에 보이게 닿는 거리 (중심끼리). 던진 시약은 CLOUD_R + 8 안이면 같은 구름에 합쳐짐 */
const TOUCH = 44;
const CLOUD_LIFE = 14;
/** 고체(나트륨·탄소)는 바닥에 떨어진 뒤 사라지지 않음 */
const LUMP_LIFE = Infinity;
/** E로 다시 담을 수 있는 거리 (덩어리·구름 중심에서) */
const PICK_R = 22;
/** 다시 담을 수 있는 기체 = 시약병에 든 기체. 반응으로 생긴 기체(HCl·CO₂ 등)는 안 담김 */
/** 기체 시약 = 구름으로 담고 던지는 것 (구름 속 이름과 같음). 2HI도 담을 수 있음 */
export const GAS_REAGENTS = ['H2', 'O2', 'Cl2', 'N2', 'I2g', 'HI'] as const;
/** 물웅덩이 반지름: H₂O 1개 / 2개 이상. 탑다운이라 세로는 납작하게 */
/** 물웅덩이 반지름: H₂O 1개 = 10px, 하나 늘 때마다 5px, 최대 20px (2026-11-10 줄임: 전엔 1개 20 · 2개 이상 30) */
const WATER_R = 10;
const WATER_R_STEP = 5;
const WATER_R_MAX = 20;
const WATER_SQUASH = 0.7;
const WATER_LIFE = 20;
const WATER_GROW = 0.25;
const WATER_DRAIN = 0.3;
const NA_REVEAL = 0.7;
/** 불이 닿고 구름이 터지기까지 (불길이 구름에 번지는 시간) */
const IGNITE_FUSE = 0.3;
/** 폭발이 옆 구름에 옮겨붙기까지 */
const CHAIN_DELAY = 0.12;
/** 앞 반응식 뒤에 이어지는 반응식을 보여주기까지 */
const NA_BURN_EQ_DELAY = 0.6;
/** 연달아 일어나는 반응 사이: 앞 반응 결과를 보여주는 시간 */
const CHAIN_GAP = 0.75;
/** 나트륨 반응의 폭발 (쿨롱 폭발 + 생긴 수소가 그 열로 탐). 피해는 반응한 나트륨 수(계수)에 따라 (9 · 14 · 18 …) */
const NA_BLAST_R = 32;
const NA_BASE_DAMAGE = 9;
/** 수소 폭발 반지름. 산소와 탄 폭발(→ 물)은 생긴 H₂O 수(계수)에 따라 (6 · 9 · 12 …), 염소하고만 탄 폭발(→ HCl)은 아직 고정 10 */
const BOOM_R = 24;
const H2_BASE_DAMAGE = 6;
const BOOM_DAMAGE = 10;
/**
 * 계수에 따라 피해가 늘어남 (2026-11-10 사용자가 정함): 계수가 하나 늘 때마다 기본 피해의 50%를 더하고 그때마다 반올림.
 * 나트륨 9 → 13.5 → 14 → 18.5 → 19 (9 · 14 · 19 · 24), 수소 6 · 9 · 12 · 15, 아이오딘화수소 3 · 5 · 7 · 9
 */
const coefDamage = (base: number, k: number) => {
  let d = base;
  for (let i = 1; i < k; i++) d = Math.round(d + base * 0.5);
  return d;
};
/** 아이오딘화수소: 구름(2HI 기준, 계수에 따라)·녹은 웅덩이(고정)에 닿은 적에게 0.5초마다 */
const HI_DMG = 3;
/** 광합성: 반응식이 나오고 열매가 열리기까지, 같은 구름의 다음 광합성까지 */
const PHOTO_REVEAL = 0.6;
/** 광합성 한 번에 쓰는 CO₂·물 (반응식 계수 그대로) */
const PHOTO_N = 6;
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
const FRUIT_HEAL = 60;
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
/** 불이 안 붙었다는 표시를 다시 띄우기까지 (불줄기는 매 프레임 닿음) */
const QUENCH_CD = 0.8;
/** 나트륨·탄소를 이 거리 안에 또 던지면 같은 무더기에 쌓임 */
const LUMP_MERGE = 16;
/** 탄소가 타고 결과가 구름에 보이기까지 */
const CARBON_REVEAL = 0.4;

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

/** 광물에서 튕겨 나와 날아가는 고체 하나. 땅에 닿으면 덩어리가 됨 */
interface Flying {
  kind: Solid;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
}
const FLY_SEC = 0.5;
const LUMP_TEX: Record<Solid, string> = { Na: 'na_lump', C: 'c_pile', I2: 'i2_pile' };

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
  /** 수소 구멍 위 구름: 수소가 들어 있는 동안은 안 사라짐 */
  keep?: boolean;
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
  /** 기체 효과(독·느려짐) 다음 틱까지 */
  tick: number;
  puffs: Puff[];
  label: Phaser.GameObjects.Container | null;
  labelW: number;
}

/** 나트륨 덩어리·탄소 가루·아이오딘 결정. 같은 자리에 또 던지면 쌓여 n개가 됨 */
interface Lump {
  kind: Solid;
  n: number;
  x: number;
  y: number;
  t: number;
  /** 나트륨이 물·염소와 반응 중 (남은 시간), -1 = 아직 반응 안 함 */
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
  /** 염화수소가 녹아 염산이 됨 */
  acid: boolean;
  /** 아이오딘화수소가 녹음 (아이오딘화수소산, 분홍 웅덩이). 둘 다 다음 피해 틱까지 tick */
  hi: boolean;
  tick: number;
  label: Phaser.GameObjects.Container | null;
  labelW: number;
  /** 웅덩이 그림 (닿은 원들을 한 장으로). sig = 마지막으로 그린 모양 */
  img?: Phaser.GameObjects.Image;
  sig?: string;
}

/** 웅덩이 그림 텍스처 이름 번호 (씬을 다시 시작해도 안 겹치게 모듈에 둠) */
let waterTexSeq = 0;

const waterRadius = (amount: number) => Math.min(WATER_R_MAX, WATER_R + (amount - 1) * WATER_R_STEP);
const liveSpots = (w: Water) => w.spots.filter((sp) => sp.drain <= 0 && !sp.dead);
/** 웅덩이 위쪽 가장자리 y (라벨·안내 문구 자리) */
const waterTop = (spots: WaterSpot[]) => Math.min(...spots.map((sp) => sp.y - sp.r * WATER_SQUASH));
const waterCenter = (spots: WaterSpot[]) => ({ x: spots.reduce((t, sp) => t + sp.x, 0) / spots.length, y: spots.reduce((t, sp) => t + sp.y, 0) / spots.length });
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
/** 핫바 아이콘 (모든 시약이 같은 그림): 기체는 비스듬한 시험관, 고체(나트륨·탄소)는 뚜껑 달린 병, 액체는 삼각 플라스크(ERLEN) */
const TUBE = [
  '............o....',
  '...........oLo...',
  '...........oLLo..',
  '..........oWoLLo.',
  '.........oWggoLLo',
  '........oWggggoLo',
  '.......oWgggggoo.',
  '......oWgggggo...',
  '.....oWgggggo....',
  '....oWccccso.....',
  '...oWccccso......',
  '..oWccccso.......',
  '.oWccccso........',
  'oWccccso.........',
  'occccso..........',
  '.occso...........',
  '..ooo............',
];
const JAR = [
  '.oooooooooooo.',
  'oLLLLLLLLLLLLo',
  'oSSSSSSSSSSSSo',
  '.oooooooooooo.',
  '.oWgggggggggo.',
  '.oWgggggggggo.',
  '.oWccccccccso.',
  '.oWccccccccso.',
  '.oWccccccccso.',
  '.oWccccccccso.',
  '.occcccccccso.',
  '.occcccccccso.',
  '.occcccccccso.',
  '..osssssssso..',
  '...oooooooo...',
];
/** 액체 아이콘: 삼각 플라스크 (사용자 스케치, 2026-11-10). 아직 액체 시약이 없어 핫바엔 안 나옴 */
const ERLEN = [
  '....oooooooo....',
  '....oLLLLLLo....',
  '....oooooooo....',
  '.....oWggso.....',
  '.....oWggso.....',
  '.....oWggso.....',
  '.....oWggso.....',
  '.....oWggso.....',
  '....oWggggso....',
  '....oWggggso....',
  '...oWccccccso...',
  '..oWccccccccso..',
  '..oWccccccccso..',
  '.oWccccccccccso.',
  'oWccccccccccccso',
  'osssssssssssssso',
  '.oooooooooooooo.',
];
const LUMP = ['.oooo.', 'oWSSso', 'oSssdo', '.oooo.'];
const PILE = ['...o...', '..oSo..', '.oSsdo.', 'osssddo'];
const I2_PILE = ['..o..o.', '.oMooMo', 'oMPdPPo', 'oPdddPo', '.ooooo.'];
const SALT = ['..ss..', '.sWWs.', 'sWWSSs', 'ssssss'];
const LIQUID: Record<Reagent, [string, string]> = {
  H2: ['#c0cbdc', '#8b9bb4'],
  O2: ['#e43b44', '#a22633'],
  Na: ['#b55088', '#68386c'],
  C: ['#5a6988', '#3a4466'],
  Cl2: ['#63c74d', '#3e8948'],
  N2: ['#0099db', '#124e89'],
  I2: ['#68386c', '#3e2731'],
  H2O: ['#0099db', '#124e89'],
  I2g: ['#a884f3', '#68386c'],
  HI: ['#f6757a', '#b55088'],
  HIaq: ['#f6757a', '#b55088'],
};

const liquidColor = (r: Reagent): number => parseInt(LIQUID[r][0].slice(1), 16);

type Pal = Phaser.Types.Create.Palette;

export function makeChemTextures(s: Phaser.Scene): void {
  for (const r of REAGENTS) {
    const key = `flask_${r}`;
    if (s.textures.exists(key)) continue;
    const pal = { o: '#181425', c: '#b86f50', G: '#c0cbdc', W: '#ffffff', L: LIQUID[r][0], l: LIQUID[r][1] };
    s.textures.generate(key, { data: FLASK, pixelWidth: 1, palette: pal as unknown as Pal });
  }
  const glass = { o: '#181425', L: '#c0cbdc', S: '#8b9bb4', W: '#ffffff', g: '#3a4466', c: '#8b9bb4', s: '#5a6988' };
  if (!s.textures.exists('tube')) s.textures.generate('tube', { data: TUBE, pixelWidth: 1, palette: glass as unknown as Pal });
  if (!s.textures.exists('jar')) s.textures.generate('jar', { data: JAR, pixelWidth: 1, palette: glass as unknown as Pal });
  if (!s.textures.exists('erlen')) s.textures.generate('erlen', { data: ERLEN, pixelWidth: 1, palette: glass as unknown as Pal });
  if (!s.textures.exists('glucose')) {
    const pal = { L: '#63c74d', o: '#3e2731', Y: '#fee761', A: '#feae34', r: '#f77622', W: '#ffffff' };
    s.textures.generate('glucose', { data: FRUIT, pixelWidth: 1, palette: pal as unknown as Pal });
  }
  if (!s.textures.exists('na_lump')) {
    const pal = { o: '#3a4466', W: '#ffffff', S: '#c0cbdc', s: '#8b9bb4', d: '#5a6988' };
    s.textures.generate('na_lump', { data: LUMP, pixelWidth: 1, palette: pal as unknown as Pal });
  }
  if (!s.textures.exists('i2_pile')) {
    const pal = { o: '#181425', M: '#a884f3', P: '#68386c', d: '#262b44' };
    s.textures.generate('i2_pile', { data: I2_PILE, pixelWidth: 1, palette: pal as unknown as Pal });
  }
  if (!s.textures.exists('c_pile')) {
    const pal = { o: '#181425', S: '#5a6988', s: '#3a4466', d: '#262b44' };
    s.textures.generate('c_pile', { data: PILE, pixelWidth: 1, palette: pal as unknown as Pal });
  }
  if (!s.textures.exists('salt')) {
    const pal = { s: '#8b9bb4', W: '#ffffff', S: '#c0cbdc' };
    s.textures.generate('salt', { data: SALT, pixelWidth: 1, palette: pal as unknown as Pal });
  }
}

const coef = (n: number) => (n > 1 ? String(n) : '');

/** ['H2','H2','O2'] → 2H₂ + O₂ (처음 나온 순서대로, 같은 건 계수로 묶음) */
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
  private flying: Flying[] = [];
  private waters: Water[] = [];
  private salts: Salt[] = [];
  /** 불이 안 붙었다는 표시를 다시 띄우기까지 */
  private fizzleCd = 0;
  private fruits: Fruit[] = [];
  private beams: SunBeam[] = [];
  private readonly g: Phaser.GameObjects.Graphics;
  /** 물웅덩이는 바닥 높이 (캐릭터 아래) */
  private readonly wg: Phaser.GameObjects.Graphics;
  /** 광합성 빛줄기 (더하기 블렌드, 조명 위) */
  private readonly beamG: Phaser.GameObjects.Graphics;
  private readonly keys: Phaser.Input.Keyboard.Key[];
  private readonly beltKey: Phaser.Input.Keyboard.Key;
  /** 지금 쓰는 시약 줄 (belts 번호) */
  belt = 0;
  /** 시약병에 남은 개수. null = 무한 (실험실·연습) */
  stock: Record<Reagent, number> | null = null;
  /** 핫바 두 줄 × 4칸. 개수가 있는 맵은 정해진 칸이 없다: 생긴 순서대로 빈 칸에 들어가고, 다 쓰면 칸이 빈다 */
  belts: (Reagent | null)[][] = BELTS.map((b) => [...b]);

  setStock(stock: Record<Reagent, number>): void {
    this.stock = stock;
    this.belts = BELTS.map((b) => b.map(() => null));
    for (const r of REAGENTS) if (stock[r] > 0) this.place(r);
  }

  /** 시약 하나 쓰기 (점화의 산소 등). 개수 없는 맵은 늘 됨. 다 쓰면 핫바 칸이 빈다 */
  spend(r: Reagent): boolean {
    if (!this.stock) return true;
    if (this.stock[r] <= 0) return false;
    if (--this.stock[r] <= 0) for (const b of this.belts) if (b.includes(r)) b[b.indexOf(r)] = null;
    return true;
  }

  /** 핫바에 없는 시약을 첫 빈 칸에 (앞 줄부터) */
  private place(r: Reagent): void {
    if (this.belts.some((b) => b.includes(r))) return;
    for (const b of this.belts) {
      const i = b.indexOf(null);
      if (i >= 0) return void (b[i] = r);
    }
  }

  constructor(private readonly s: RoomScene) {
    makeChemTextures(s);
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
    this.fizzleCd = Math.max(0, this.fizzleCd - dt);
    const p = this.s.player;
    if (!p.dead && !p.inputLocked && this.s.combatEnabled) {
      if (Phaser.Input.Keyboard.JustDown(this.beltKey)) {
        this.belt = (this.belt + 1) % this.belts.length;
        playSfx('tick');
      }
      if (this.throwCd <= 0) {
        const row = this.belts[this.belt];
        const i = this.keys.findIndex((k) => Phaser.Input.Keyboard.JustDown(k));
        const r = row[i];
        if (r) {
          if (this.stock && --this.stock[r] <= 0) row[i] = null;
          this.throwReagent(r);
        } else if (i >= 0) playSfx('deny');
      }
    }
    this.updateFlasks(dt);
    this.updateFlying(dt);
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
    let d = Math.min(RANGE, Math.hypot(dx, dy));
    // 움직일 수 있는 곳의 경계(보이지 않는 벽)에서도 멈춤: 경계 6px 안에서 떨어지게 던지는 줄을 줄임 (밖으로 나가면 다시 못 주워서)
    const b = s.physics.world.bounds;
    const cos = Math.cos(a), sin = Math.sin(a);
    if (cos > 1e-6) d = Math.min(d, (b.right - BOUND_PAD - p.x) / cos);
    else if (cos < -1e-6) d = Math.min(d, (b.x + BOUND_PAD - p.x) / cos);
    if (sin > 1e-6) d = Math.min(d, (b.bottom - BOUND_PAD - p.y) / sin);
    else if (sin < -1e-6) d = Math.min(d, (b.y + BOUND_PAD - p.y) / sin);
    d = Math.max(0, d);
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
    if (!isSolid(f.r)) playFx(s, 'shatter_splash', f.tx, f.ty, liquidColor(f.r), DEPTH.vfx - 1);
    playFx(s, 'shatter_glass', f.tx, f.ty);
    playSfx('glass');
    this.apply(f.r, f.tx, f.ty);
  }

  // ───────────────────────── 다시 담기 (E) ─────────────────────────

  /** E로 다시 담을 수 있는 가장 가까운 것: 바닥의 나트륨·탄소 덩어리, 시약 기체가 든 구름, 물웅덩이 (반응 중인 것·염산은 빼고). y는 안내 문구 자리 */
  pickable(x: number, y: number): { x: number; y: number; take: () => void } | null {
    const now = this.s.gameTime;
    let best: { x: number; y: number; take: () => void } | null = null;
    let bd = PICK_R;
    for (const l of this.lumps) {
      const d = Phaser.Math.Distance.Between(l.x, l.y, x, y);
      if (l.fizz < 0 && d < bd) {
        bd = d;
        best = { x: l.x, y: l.y - 26, take: () => this.takeLump(l) };
      }
    }
    for (const c of this.clouds) {
      if (c.burning > 0 || now < c.busyUntil || !c.species.some((sp) => (GAS_REAGENTS as readonly Species[]).includes(sp))) continue;
      const d = Phaser.Math.Distance.Between(c.x, c.y, x, y);
      if (d < bd) {
        bd = d;
        best = { x: c.x, y: c.y - 42, take: () => this.takeCloud(c) };
      }
    }
    for (const w of this.waters) {
      const live = liveSpots(w);
      // 염산은 아직 못 담음 (아이오딘화수소산은 담음). 나트륨이 지글거리는 웅덩이도 (반응에 물이 필요)
      if (w.acid || !live.length || this.lumps.some((l) => l.fizz >= 0 && this.waterAt(l.x, l.y, 4) === w)) continue;
      // 웅덩이 가장자리까지 거리 (안에 서 있으면 0)
      const d = Math.max(0, Math.min(...live.map((sp) => Math.hypot(x - sp.x, (y - sp.y) / WATER_SQUASH) - sp.r)));
      if (d < bd) {
        bd = d;
        const c = waterCenter(live);
        best = { x: c.x, y: waterTop(live) - 24, take: () => this.takeWater(w) };
      }
    }
    return best;
  }

  /** 웅덩이의 물을 통째로 (3H₂O → 물 3개, HI가 녹은 웅덩이면 아이오딘화수소산 3개). 웅덩이는 금방 마름 */
  private takeWater(w: Water): void {
    const live = liveSpots(w);
    const n = waterAmount(w);
    const c = waterCenter(live);
    for (const sp of live) {
      sp.amount = 0;
      sp.drain = WATER_DRAIN;
    }
    this.refreshWaterLabel(w);
    this.gain([[w.hi ? 'HIaq' : 'H2O', n]], c.x, c.y - 14);
  }

  /** 쌓인 덩어리를 통째로 (2Na → 나트륨 2개) */
  private takeLump(l: Lump): void {
    this.gain([[l.kind, l.n]], l.x, l.y - 14);
    this.removeLump(l);
  }

  /** 구름의 시약 기체만 모두 (H₂ + O₂ → 수소 1·산소 1). 반응으로 생긴 기체는 남음 */
  private takeCloud(c: Cloud): void {
    const got: [Reagent, number][] = [];
    for (const sp of GAS_REAGENTS) {
      const n = count(c.species, sp);
      if (!n) continue;
      got.push([sp, n]);
      take(c.species, sp, n);
      take(c.shown, sp, Math.min(n, count(c.shown, sp)));
    }
    this.refreshLabel(c);
    this.gain(got, c.x, c.y - 30);
  }

  gain(got: [Reagent, number][], x: number, y: number): void {
    if (this.stock) for (const [r, n] of got) {
      this.stock[r] += n;
      this.place(r);
    }
    // 담은 것을 화학식으로 잠깐 띄움
    const l = this.makeLabel(got.map(([r, n]) => term(`${coef(n)}${r}`, REAGENT_COLOR[r])));
    l.c.setPosition(Math.round(x - l.w / 2), Math.round(y));
    this.s.tweens.add({ targets: l.c, y: l.c.y - 12, alpha: 0, delay: 350, duration: 550, onComplete: () => l.c.destroy() });
    this.s.vfx.spark(x, y + 10, E32.silver, 6, 30, 40);
    playSfx('pickup');
  }

  /** 수소 구멍이 내뿜는 수소: 채집하거나 반응해서 수소가 없어질 때까지 안 사라짐 */
  vent(x: number, y: number): void {
    this.addCloud(x, y, ['H2']).keep = true;
    this.s.vfx.spark(x, y - 4, E32.silver, 6, 20, 50);
    playSfx('gas');
  }

  /** 구멍(x, y) 위에 아직 수소가 있는지 (구름은 움직이지 않음) */
  ventFull(x: number, y: number): boolean {
    return this.clouds.some((c) => c.keep && c.x === x && c.y === y && c.species.includes('H2'));
  }

  // ───────────────────────── 반응 ─────────────────────────

  private apply(r: Reagent, x: number, y: number): void {
    // 나트륨·탄소·아이오딘은 고체라 바닥에 남음 (같은 자리면 쌓임)
    if (isSolid(r)) {
      this.addLump(r, x, y);
      return;
    }
    // 물·아이오딘화수소산은 그 자리에 웅덩이 (닿는 웅덩이와 합쳐짐, 나트륨 위면 반응)
    if (r === 'H2O' || r === 'HIaq') {
      this.makeWater(x, y, 1, r === 'HIaq');
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

  /**
   * 불꽃 입자(공중, 손 높이)가 닿은 수소 구름·탄소 가루에 불이 붙는다. 구름은 바닥에서 9px 떠 있음.
   * breath = 이번에 뿜은 불이 가진 산소 (불 뿜기 한 번에 산소 1개를 쓰니까, 처음 붙은 구름에서 수소를 태움)
   */
  igniteAt(x: number, y: number, breath?: { o2: number }): void {
    for (const c of this.clouds) {
      if (this.flammable(c) && Math.hypot(x - c.x, y - (c.y - 9)) <= CLOUD_R) this.ignite(c, true, breath);
    }
    for (const l of [...this.lumps]) {
      if (l.kind === 'C' && Math.hypot(x - l.x, y - (l.y - 9)) <= CLOUD_R) this.burnCarbon(l, true);
      else if (l.kind === 'I2' && Math.hypot(x - l.x, y - (l.y - 9)) <= CLOUD_R) this.sublimate(l);
    }
  }

  /** 고체 아이오딘에 불: 보라 연기가 확 퍼지며 기체로 승화 (고체 n개 → 기체 n개, 그 자리 구름에. 담을 수 있음) */
  private sublimate(l: Lump): void {
    const s = this.s;
    const { x, y, n } = l;
    this.removeLump(l);
    s.vfx.burst(x, y - 8, CHEM_COLOR.I, 18);
    s.vfx.spark(x, y - 6, CHEM_COLOR.I, 14, 80, 60);
    s.vfx.spark(x, y - 6, E32.plum, 10, 50, 40);
    s.vfx.ring(x, y - 6, 4, CLOUD_R + 12, CHEM_COLOR.I, 0.45, 2);
    s.vfx.glow(x, y - 8, 28, CHEM_COLOR.I, 0.4);
    playSfx('whoosh');
    const c = this.cloudAt(x, y);
    if (c) for (let i = 0; i < n; i++) this.addToCloud(c, 'I2g', i > 0);
    else this.addCloud(x, y, Array<Species>(n).fill('I2g'));
  }

  /**
   * 불이 붙음 (공기에 산소가 없으니 던져 넣은 기체끼리만): 잠깐 불길이 번진 뒤
   * 수소 + 염소(1:1)는 초록 폭발 → 염화수소, 수소 + 산소(2:1)는 큰 폭발 → 물. 짝이 안 맞는 건 그대로 남는다.
   * 불 뿜기로 직접 붙이면 그 불의 산소 1개도 같이 타서, 남은 수소를 둘까지 물로 (수소만 있는 구름도 H₂O가 됨).
   * direct = 불줄기가 직접 닿음 (연쇄로 온 불은 안 붙어도 화학식을 안 띄움)
   */
  private ignite(c: Cloud, direct = false, breath?: { o2: number }): void {
    // 연쇄 점화는 0.12초 뒤에 오므로 그사이 시간이 다 돼 사라진 구름은 건너뜀
    if (!this.flammable(c) || !this.clouds.includes(c)) return;
    const s = this.s;
    const sp = c.species;
    // 옆에 닿은 질소 구름은 불길을 덮어 막는다
    if (this.clouds.some((o) => o !== c && o.species.includes('N2') && Phaser.Math.Distance.Between(o.x, o.y, c.x, c.y) <= TOUCH)) {
      return this.fizzle(c.x, c.y, direct ? [...speciesTerms(sp), term('N2', CHEM_COLOR.N)] : null);
    }
    // 같은 구름의 질소는 수소 셋과 암모니아가 되고, 수소가 모자라면 질소에 묻혀 안 탐
    if (sp.includes('N2')) {
      if (count(sp, 'H2') >= 3) return this.makeAmmonia(c);
      return this.fizzle(c.x, c.y, direct ? speciesTerms(sp) : null);
    }
    let hcl = 0;
    while (count(sp, 'H2') >= 1 && count(sp, 'Cl2') >= 1) {
      take(sp, 'H2', 1);
      take(sp, 'Cl2', 1);
      hcl += 1;
    }
    // 기체 아이오딘과 수소 (1:1) → 2HI. 터지지 않고 분홍빛으로 확
    let hi = 0;
    while (count(sp, 'H2') >= 1 && count(sp, 'I2g') >= 1) {
      take(sp, 'H2', 1);
      take(sp, 'I2g', 1);
      hi += 1;
    }
    let water = 0;
    while (count(sp, 'H2') >= 2 && count(sp, 'O2') >= 1) {
      take(sp, 'H2', 2);
      take(sp, 'O2', 1);
      water += 2;
    }
    // 불 뿜기의 산소 (O₂ 하나 = H₂ 둘까지). 한 번 뿜은 불의 산소는 구름 하나에만 쓰임. 수소가 하나뿐이면 물 하나
    if (breath && breath.o2 > 0 && count(sp, 'H2') >= 1) {
      const n = Math.min(2, count(sp, 'H2'));
      take(sp, 'H2', n);
      water += n;
      breath.o2 = 0;
    }
    if (hcl + hi + water === 0) return this.fizzle(c.x, c.y, direct ? speciesTerms(sp) : null);
    // 반응식은 염소 → 아이오딘 → 산소와 탄 수소 순서로 이어서
    const eqs = [hcl > 0 && HCL_EQ, hi > 0 && HI_EQ, water > 0 && H2O_EQ].filter((e): e is typeof H2O_EQ => !!e);
    this.emit({ type: 'equation', ...eqs[0], revealAt: IGNITE_FUSE });
    eqs.slice(1).forEach((e, i) => this.showAfter(IGNITE_FUSE + NA_BURN_EQ_DELAY * (i + 1), e));
    const after = [...sp];
    const seq = ++c.seq;
    c.burning = IGNITE_FUSE;
    c.busyUntil = Math.max(c.busyUntil, s.gameTime + IGNITE_FUSE + 0.1);
    playSfx('ignite');
    s.scheduler.after(IGNITE_FUSE, () => {
      c.burning = 0;
      this.showSpecies(c, after, seq);
      const { x, y } = c;
      // 산소가 섞였으면 노란 폭발, 염소하고만 탔으면 초록빛 (염소 색)
      if (water > 0) this.blast(x, y - 4, BOOM_R, coefDamage(H2_BASE_DAMAGE, water), true, E32.yellow, E32.orange, 'kaboom', 'boom_s');
      else if (hcl > 0) this.blast(x, y - 4, BOOM_R, BOOM_DAMAGE, true, E32.lime, E32.yellow, 'kaboom', 'boom_w', E32.lime);
      else {
        s.vfx.ring(x, y - 9, 4, 24, CHEM_COLOR.HI, 0.35, 1);
        s.vfx.glow(x, y - 9, 26, CHEM_COLOR.HI, 0.35);
        s.vfx.spark(x, y - 8, CHEM_COLOR.HI, 12, 50, 50);
      }
      // 염화수소·아이오딘화수소는 그 구름에 남고 (2HCl, 2HI), 산소와 탄 수소는 물이 된다
      for (let i = 0; i < hcl * 2; i++) this.addToCloud(c, 'HCl', true);
      for (let i = 0; i < hi * 2; i++) this.addToCloud(c, 'HI', true);
      if (water > 0) s.scheduler.after(0.15, () => this.makeWater(x, y, water));
    });
  }

  /** 질소 + 수소 셋에 불: 터지지 않고 암모니아 (게임이라 촉매·압력 생략) */
  private makeAmmonia(c: Cloud): void {
    const s = this.s;
    let made = 0;
    while (count(c.species, 'N2') >= 1 && count(c.species, 'H2') >= 3) {
      take(c.species, 'N2', 1);
      take(c.species, 'H2', 3);
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

  /** 불이 안 붙음 (짝이 될 기체가 없거나 질소에 덮임): 연기만 남. 불줄기는 매 프레임 닿으니 표시는 가끔, 화학식은 섞인 게 둘 이상일 때만 */
  private fizzle(x: number, y: number, terms: ChemTerm[] | null): void {
    if (this.fizzleCd > 0) return;
    this.fizzleCd = QUENCH_CD;
    const s = this.s;
    if (terms && terms.length > 1) this.emit({ type: 'mix', terms });
    s.vfx.spark(x, y - 9, E32.steel, 8, 30, 40);
    s.vfx.ring(x, y - 9, 4, 16, E32.steel, 0.3, 1);
    playSfx('sizzle');
  }

  /**
   * 산소 구름 아래 탄소 가루에 불 (공기에 산소가 없으니 구름의 O₂로만 탐):
   * 산소가 넉넉하면 C + O₂ → CO₂, 모자라면 2C + O₂ → 2CO. 생긴 기체는 그 구름에 남음
   */
  private burnCarbon(l: Lump, direct: boolean): void {
    const s = this.s;
    const c = this.clouds.find((o) => o.burning <= 0 && o.species.includes('O2') && Phaser.Math.Distance.Between(o.x, o.y, l.x, l.y) <= CLOUD_R + 4);
    if (!c) {
      if (direct) this.fizzle(l.x, l.y, null);
      return;
    }
    // 탄소 n, 산소 분자 m → 원자 수가 맞게 CO₂ a개 + CO b개 (b는 늘 짝수)
    const n = l.n;
    const m = count(c.species, 'O2');
    const a = m >= n ? n : Math.max(0, 2 * m - n);
    const b = Math.min(n, 2 * m) - a;
    take(c.species, 'O2', a + b / 2);
    for (let i = 0; i < a; i++) c.species.push('CO2');
    for (let i = 0; i < b; i++) c.species.push('CO');
    l.n -= a + b;
    if (l.n <= 0) this.removeLump(l);
    else this.refreshLumpLabel(l);
    const after = [...c.species];
    const seq = ++c.seq;
    c.t = CLOUD_LIFE;
    c.busyUntil = Math.max(c.busyUntil, s.gameTime + CARBON_REVEAL + 0.1);
    this.emit({ type: 'equation', ...(a > 0 ? CO2_EQ : CO_EQ), revealAt: CARBON_REVEAL });
    if (a > 0 && b > 0) this.showAfter(CARBON_REVEAL + NA_BURN_EQ_DELAY, CO_EQ);
    playSfx('ignite');
    s.vfx.spark(l.x, l.y - 3, E32.orange, 14, 40, 60);
    s.vfx.glow(l.x, l.y - 4, 18, E32.orange, 0.4);
    s.scheduler.after(CARBON_REVEAL, () => {
      this.showSpecies(c, after, seq);
      s.vfx.ring(c.x, c.y - 9, 4, 20, E32.steel, 0.3, 1);
    });
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
      s.combat.hit(a, { damage: damage * s.player.atkMult, knockback: r * 10, fromX: x, fromY: y, isReaction: true, reactionId: 'chem_blast', color });
    }
    for (const c of this.clouds) {
      if (this.flammable(c) && Phaser.Math.Distance.Between(c.x, c.y, x, y) <= r + CLOUD_R) {
        s.scheduler.after(CHAIN_DELAY, () => this.ignite(c));
      }
      // 산소 둘이 섞인 질소 구름이 폭발에 휘말리면 이산화질소 (수소 구름에 닿아 불을 막고 있는 질소는 그대로)
      const guarding = this.clouds.some((o) => this.flammable(o) && Phaser.Math.Distance.Between(o.x, o.y, c.x, c.y) <= TOUCH);
      if (c.burning <= 0 && !guarding && c.species.includes('N2') && count(c.species, 'O2') >= 2 && Phaser.Math.Distance.Between(c.x, c.y, x, y) <= r + CLOUD_R) this.makeNO2(c);
    }
    // 폭발 열은 산소 구름 아래 탄소 가루에도 불을 붙임
    for (const l of [...this.lumps]) {
      if (l.kind === 'C' && Phaser.Math.Distance.Between(l.x, l.y, x, y) <= r) this.burnCarbon(l, false);
      else if (l.kind === 'I2' && Phaser.Math.Distance.Between(l.x, l.y, x, y) <= r) this.sublimate(l);
    }
  }

  private makeNO2(c: Cloud): void {
    const s = this.s;
    const n = Math.min(count(c.species, 'N2'), Math.floor(count(c.species, 'O2') / 2));
    take(c.species, 'N2', n);
    take(c.species, 'O2', n * 2);
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
  private makeWater(x: number, y: number, amount: number, hi = false): void {
    const s = this.s;
    const r = waterRadius(amount);
    this.addWater(x, y, amount, hi);
    s.vfx.ring(x, y, 4, r + 6, E32.blue, 0.3, 2);
    s.vfx.spark(x, y - 6, E32.cyan, 10 + amount * 6, 60, 50);
    s.vfx.glow(x, y - 4, r + 8, E32.blue, 0.3);
    playSfx('splash');
  }

  /** 같은 자리 나트륨 둘이 물에 닿음: 지글거리며 튀어 다니다가 폭발 */
  /** false = 웅덩이 물이 이미 다른 나트륨 몫이라 반응 못 함 (기다림) */
  private startSodium(lump: Lump): boolean {
    // 나트륨 하나에 물 하나 (2Na + 2H₂O): 쌓인 나트륨 중 남은 물만큼만 반응하고 나머지는 그 자리에 남김.
    // 같은 웅덩이에서 이미 지글거리는 나트륨이 쓸 물은 빼고 셈 (물 하나로 여러 번 터지지 않게)
    const w = this.waterAt(lump.x, lump.y);
    const claimed = w ? this.lumps.filter((o) => o !== lump && o.fizz >= 0 && !o.salt && this.waterAt(o.x, o.y, 4) === w).reduce((t, o) => t + o.n, 0) : 0;
    const k = w ? Math.min(lump.n, waterAmount(w) - claimed) : lump.n;
    if (k <= 0) return false;
    if (lump.n > k) this.newLump(lump.kind, lump.x, lump.y, lump.n - k);
    lump.n = k;
    this.refreshLumpLabel(lump);
    lump.fizz = NA_REVEAL;
    this.emit({
      type: 'equation',
      lhs: [term('2H2O', CHEM_COLOR.water), term('2Na', CHEM_COLOR.Na)],
      rhs: [term('2NaOH', CHEM_COLOR.naoh), term('H2', CHEM_COLOR.H)],
      revealAt: NA_REVEAL,
      fizz: true,
    });
    playSfx('fizz');
    return true;
  }

  /** 염소 반응에는 나트륨 둘만 씀: 더 쌓여 있으면 나머지는 그 자리에 덩어리로 남김 */
  private splitLump(l: Lump): void {
    if (l.n > 2) this.newLump(l.kind, l.x, l.y, l.n - 2);
    l.n = 2;
  }

  /**
   * 나트륨 k개가 물과 반응해 폭발 (쿨롱 폭발). 물도 k개 쓰고 (나트륨이 떨어진 자리부터), 피해는 계수(k)에 따라.
   * 생긴 수소(나트륨 둘에 H₂ 하나, 반 개는 버림)는 공기에 산소가 없으니 타지 않고 구름으로 남음
   */
  private explodeSodium(lump: Lump): void {
    const s = this.s;
    const { x, y } = lump;
    const k = lump.n;
    this.removeLump(lump);
    const w = this.waterAt(x, y, 4);
    if (w) this.consumeWater(w, x, y, k);
    s.vfx.spark(x, y, E32.cyan, 18, 150, 110);
    this.blast(x, y, NA_BLAST_R, coefDamage(NA_BASE_DAMAGE, k), true, E32.amber, E32.yellow, 'kaboom', 'boom_na');
    const h2 = Math.floor(k / 2);
    if (h2 > 0) s.scheduler.after(0.2, () => {
      const c = this.cloudAt(x, y);
      if (c) for (let i = 0; i < h2; i++) this.addToCloud(c, 'H2', true);
      else this.addCloud(x, y, Array(h2).fill('H2'));
    });
  }

  /** 염소 구름 속 나트륨 둘: 노랗게 타오름 (2Na + Cl₂ → 2NaCl) */
  private startSalt(lump: Lump, c: Cloud): void {
    this.splitLump(lump);
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
      const acid = c.species.includes('HCl') ? 'HCl' : c.species.includes('HI') ? 'HI' : null;
      if (c.burning > 0 || now < c.busyUntil || !acid) continue;
      const w = this.waterAt(c.x, c.y, PHOTO_MARGIN);
      if (!w) continue;
      const col = acid === 'HCl' ? E32.lime : CHEM_COLOR.HI;
      take(c.species, acid, 1);
      const after = [...c.species];
      const seq = ++c.seq;
      c.busyUntil = now + ACID_REVEAL + 0.1;
      this.emit({
        type: 'equation',
        lhs: [term(acid, CHEM_COLOR[acid]), term('H2O', CHEM_COLOR.water)],
        rhs: [term('H3O+', acid === 'HCl' ? CHEM_COLOR.acid : CHEM_COLOR.HI), acid === 'HCl' ? term('Cl-', CHEM_COLOR.Cl) : term('I-', CHEM_COLOR.I)],
        revealAt: ACID_REVEAL,
      });
      playSfx('fizz');
      s.scheduler.after(ACID_REVEAL, () => {
        this.showSpecies(c, after, seq);
        if (acid === 'HCl') w.acid = true;
        else w.hi = true;
        w.t = WATER_LIFE;
        this.refreshWaterLabel(w);
        s.vfx.spark(c.x, c.y - 4, col, 12, 40, 50);
        s.vfx.ring(c.x, c.y, 4, 26, col, 0.3, 1);
      });
    }
  }

  // ───────────────────────── 광합성 ─────────────────────────

  /**
   * CO₂가 든 구름이 물웅덩이 위에 있으면 광합성 (빛·식물은 게임이라 생략):
   * 그 구름의 CO₂ 여섯 + 물 6 → 포도당 열매 하나, CO₂는 O₂가 되어 같은 구름에 남음 (반응식 계수 그대로)
   */
  private updatePhotosynthesis(dt: number): void {
    const s = this.s;
    const now = s.gameTime;
    for (const c of this.clouds) {
      c.photoCd = Math.max(0, c.photoCd - dt);
      // 앞 반응 연출(예: 탄소가 타서 CO₂가 됨)이 끝난 뒤에
      if (c.photoCd > 0 || c.burning > 0 || now < c.busyUntil || count(c.species, 'CO2') < PHOTO_N) continue;
      const w = this.waterAt(c.x, c.y, PHOTO_MARGIN);
      if (!w || waterAmount(w) < PHOTO_N) continue;
      // 라벨은 열매가 열릴 때 CO₂ → O₂로 바뀜
      take(c.species, 'CO2', PHOTO_N);
      this.consumeWater(w, c.x, c.y, PHOTO_N);
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
        if (this.clouds.includes(c) && c.burning <= 0) for (let i = 0; i < PHOTO_N; i++) this.addToCloud(c, 'O2', true);
        else this.addCloud(c.x, c.y, Array<Species>(PHOTO_N).fill('O2'));
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

  /** 구름에 든 기체별 색: 수소·암모니아 은색, 산소 빨강, 일산화·이산화탄소 회색, 염소 연두, 질소 파랑, 염화수소 은색+연두 (나머지는 CHEM_COLOR) */
  private gasColors(list: readonly Species[]): number[] {
    const cols: number[] = [];
    if (list.includes('H2') || list.includes('NH3')) cols.push(E32.silver);
    if (list.includes('O2')) cols.push(E32.red);
    if (list.includes('CO') || list.includes('CO2')) cols.push(E32.steel);
    if (list.includes('Cl2')) cols.push(E32.lime);
    if (list.includes('N2')) cols.push(E32.blue);
    // 염화수소는 색 없는 기체: 수소 은색 + 염소 연두를 섞어 염소 구름보다 옅게 (아이오딘화수소도 은색 + 분홍)
    if (list.includes('HCl')) cols.push(E32.silver, E32.lime);
    if (list.includes('I2g')) cols.push(CHEM_COLOR.I, E32.plum);
    if (list.includes('HI')) cols.push(E32.silver, CHEM_COLOR.HI);
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
      if (!(c.keep && c.species.includes('H2'))) c.t -= dt;
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

  /** 독가스(Cl₂·NO₂·HI)는 안의 적에게 피해, 흰 연기(NH₄Cl)는 느려지게. 화면에 보이는 물질 기준 */
  private gasEffect(c: Cloud): void {
    const s = this.s;
    const poison = count(c.shown, 'Cl2') + count(c.shown, 'NO2');
    const smoke = c.shown.includes('NH4Cl');
    // 2HI가 계수 1 (HI 둘마다 계수 하나)
    const hiK = Math.ceil(count(c.shown, 'HI') / 2);
    if (!poison && !smoke && !hiK) return;
    const color = c.shown.includes('Cl2') ? E32.lime : CHEM_COLOR.NO2;
    for (const a of s.combat.inCircle(c.x, c.y, CLOUD_R + 4, 'enemy')) {
      if (poison) s.combat.hit(a, { damage: POISON_DMG * poison * s.player.atkMult, isReaction: true, reactionId: 'chem_gas', color });
      if (smoke) a.slow(SMOKE_SLOW, GAS_TICK + 0.2);
      if (hiK) s.combat.hit(a, { damage: coefDamage(HI_DMG, hiK) * s.player.atkMult, isReaction: true, reactionId: 'chem_hi', color: CHEM_COLOR.HI });
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
  private addWater(x: number, y: number, amount: number, hi = false): void {
    const r = waterRadius(amount);
    const dashes: WaterSpot['dashes'] = [];
    for (let i = 0; i < Math.round(WATER_R_MAX / 2.5); i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * 0.75;
      dashes.push({ u: Math.cos(a) * d, v: Math.sin(a) * d, len: 2 + Math.floor(Math.random() * 3), ph: Math.random() * 10 });
    }
    const spot: WaterSpot = { x, y, r, targetR: r, amount, grow: 0, drain: 0, dead: false, dashes };
    const touching = this.waters.filter((w) => liveSpots(w).some((sp) => spotsTouch(sp, spot)));
    if (!touching.length) {
      const w: Water = { spots: [spot], t: WATER_LIFE, ph: Math.random() * 10, acid: false, hi, tick: 0, label: null, labelW: 0 };
      this.waters.push(w);
      this.refreshWaterLabel(w);
      return;
    }
    const [main, ...rest] = touching;
    for (const o of rest) {
      main.spots.push(...o.spots);
      main.acid ||= o.acid;
      main.hi ||= o.hi;
      this.dropWaterArt(o);
    }
    main.hi ||= hi;
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
      const nw: Water = { spots: g, t: w.t, ph: Math.random() * 10, acid: w.acid, hi: w.hi, tick: 0, label: null, labelW: 0 };
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
    const l = this.makeLabel([water, ...(w.acid ? [term('HCl', CHEM_COLOR.acid)] : []), ...(w.hi ? [term('HI', CHEM_COLOR.HI)] : [])]);
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
      if ((w.acid || w.hi) && (w.tick -= dt) <= 0) {
        w.tick = GAS_TICK;
        this.acidBurn(w);
      }
    }
    const gone = (w: Water) => w.t <= 0 || w.spots.length === 0;
    for (const w of this.waters) if (gone(w)) this.dropWaterArt(w);
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
        // 염산·아이오딘화수소산 각각 0.5초마다 3 (둘 다 녹았으면 더함)
        const n = (w.acid ? 1 : 0) + (w.hi ? 1 : 0);
        s.combat.hit(a, { damage: ACID_DMG * n * s.player.atkMult, isReaction: true, reactionId: 'chem_acid', color: w.acid ? CHEM_COLOR.acid : CHEM_COLOR.HI });
      }
    }
  }

  private dropWaterArt(w: Water): void {
    w.label?.destroy();
    w.label = null;
    if (!w.img) return;
    const key = w.img.texture.key;
    w.img.destroy();
    w.img = undefined;
    this.s.textures.remove(key);
  }

  /**
   * 물웅덩이: 닿은 원들을 한 장의 픽셀 그림으로 그려서 이음매 없이 하나로 보이게 (모양이 바뀔 때만 다시 그림).
   * 바깥 젖은 땅(살짝 어둡게, 대각선 쪽은 체크무늬) → 테두리(위 절반은 아주 어둡게, 아래는 진하게) → 위쪽 둑 그늘 1줄 + 체크무늬 2줄 →
   * 물 → 아래쪽 밝은 물가 1줄, 왼쪽 위에 하늘 비친 줄 두 개.
   * 그 위에 반짝이는 짧은 물결·흰 반짝임은 매 프레임 따로 (wg).
   */
  private drawWaters(time: number): void {
    const g = this.wg;
    g.clear();
    for (const w of this.waters) {
      const k = Math.min(1, w.t / 1.5);
      // 염산은 초록, 아이오딘화수소산은 분홍
      const [deep, mid, hi] = w.acid ? [E32.forest, E32.green, E32.lime] : w.hi ? [E32.plum, E32.magenta, E32.pink] : [E32.navy, E32.blue, E32.cyan];
      const size = (sp: WaterSpot) => Math.max(0, sp.grow * (sp.drain > 0 ? sp.drain / WATER_DRAIN : 0.6 + 0.4 * k));
      const shapes = w.spots
        .map((sp) => {
          const rx = Math.round(sp.r * size(sp));
          return { x: Math.round(sp.x), y: Math.round(sp.y), rx, ry: Math.round(rx * WATER_SQUASH) };
        })
        .filter((e) => e.rx >= 2 && e.ry >= 1);
      this.paintWater(w, shapes, deep, mid, hi);
      const live = liveSpots(w);
      // 표면의 짧은 물결 (반짝이며 살짝 흔들림)
      for (const sp of live) {
        const sz = size(sp);
        if (sz < 0.8) continue;
        for (const d of sp.dashes.slice(0, Math.round(sp.r / 2.5))) {
          const a = 0.25 + 0.35 * Math.sin(time * 2.2 + d.ph);
          if (a <= 0.05) continue;
          g.fillStyle(hi, a);
          const dx = Math.round(sp.x + d.u * sp.r * 0.8 * sz + Math.sin(time * 0.9 + d.ph));
          const dy = Math.round(sp.y + d.v * sp.r * WATER_SQUASH * 0.7 * sz);
          g.fillRect(dx - (d.len >> 1), dy, d.len, 1);
        }
        // 반짝임: 하늘 비친 줄 왼쪽 끝에서 가끔
        if (Math.sin(time * 3 + sp.x) > 0.4) {
          const rx = Math.round(sp.r * sz);
          g.fillStyle(E32.white, 0.9);
          g.fillRect(Math.round(sp.x) - Math.round(rx * 0.5), Math.round(sp.y) - Math.round(Math.round(rx * WATER_SQUASH) * 0.2), 1, 1);
        }
      }
      // 라벨은 웅덩이 위쪽 가장자리에서 16px 위 (물 그림을 가리지 않게, 기체 라벨처럼 떠 있게)
      if (w.label && live.length) {
        const c = waterCenter(live);
        const grow = Math.min(...live.map((sp) => sp.grow));
        w.label.setPosition(Math.round(c.x - w.labelW / 2), Math.round(waterTop(live) - 16 + bob(time, w.ph))).setAlpha(k * grow);
      }
    }
  }

  private paintWater(w: Water, shapes: { x: number; y: number; rx: number; ry: number }[], deep: number, mid: number, hi: number): void {
    const sig = `${w.acid ? 'a' : w.hi ? 'i' : 'w'}|${shapes.map((e) => `${e.x},${e.y},${e.rx}`).join(';')}`;
    if (sig === w.sig) return;
    w.sig = sig;
    if (!shapes.length) return void w.img?.setVisible(false);
    const P = 2;
    const x0 = Math.min(...shapes.map((e) => e.x - e.rx)) - P;
    const y0 = Math.min(...shapes.map((e) => e.y - e.ry)) - P;
    const W = Math.max(...shapes.map((e) => e.x + e.rx)) + P - x0 + 1;
    const H = Math.max(...shapes.map((e) => e.y + e.ry)) + P - y0 + 1;
    // 픽셀 가운데로 판정 (가로 2rx+1 · 세로 2ry+1, 좌우 대칭)
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const X = x + x0;
        const Y = y + y0;
        if (shapes.some((e) => ((X - e.x) / (e.rx + 0.5)) ** 2 + ((Y - e.y) / (e.ry + 0.5)) ** 2 <= 1)) m[y * W + x] = 1;
      }
    }
    const inM = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
    // -1 = 빈칸, -2 = 젖은 땅, -3 = 옅은 젖은 땅
    const col = new Int32Array(W * H).fill(-1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n4 = [inM(x - 1, y), inM(x + 1, y), inM(x, y - 1), inM(x, y + 1)];
        if (!inM(x, y)) {
          if (n4.some(Boolean)) col[y * W + x] = -2;
          else if ((x + y) % 2 === 0 && (inM(x - 1, y - 1) || inM(x + 1, y - 1) || inM(x - 1, y + 1) || inM(x + 1, y + 1))) col[y * W + x] = -3;
          continue;
        }
        // 위·아래 물가까지 몇 칸 (1 = 가장자리)
        let up = 1;
        while (inM(x, y - up)) up++;
        let down = 1;
        while (inM(x, y + down)) down++;
        let c = mid;
        if (!n4.every(Boolean)) c = up <= down ? E32.night : deep;
        else if (up === 2 || (up <= 4 && (x + y) % 2 === 0)) c = deep;
        else if (down === 2) c = hi;
        col[y * W + x] = c;
      }
    }
    // 하늘이 비친 줄 (원마다 왼쪽 위): 물 한가운데 색인 곳에만
    for (const e of shapes) {
      if (e.rx < 5) continue;
      const streak = (sx: number, sy: number, len: number) => {
        for (let i = 0; i < len; i++) {
          const x = sx + i - x0;
          const y = sy - y0;
          if (inM(x, y) && col[y * W + x] === mid) col[y * W + x] = hi;
        }
      };
      streak(e.x - Math.round(e.rx * 0.5), e.y - Math.round(e.ry * 0.2), Math.max(2, Math.round(e.rx * 0.45)));
      streak(e.x - Math.round(e.rx * 0.2), e.y - Math.round(e.ry * 0.2) + 2, Math.max(1, Math.round(e.rx * 0.2)));
    }
    if (!w.img) {
      const key = `water_${waterTexSeq++}`;
      this.s.textures.createCanvas(key, W, H);
      w.img = this.s.add.image(0, 0, key).setOrigin(0).setDepth(DEPTH.terrain + 0.45);
    }
    const tex = w.img.texture as Phaser.Textures.CanvasTexture;
    tex.setSize(W, H);
    const ctx = tex.getContext();
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const c = col[i];
      if (c === -1) continue;
      const o = i * 4;
      if (c < -1) {
        // 젖은 땅: 검정을 살짝 (어떤 바닥에서도 어둡게만)
        img.data[o] = 0x18;
        img.data[o + 1] = 0x14;
        img.data[o + 2] = 0x25;
        img.data[o + 3] = c === -2 ? 90 : 60;
        continue;
      }
      img.data[o] = (c >> 16) & 255;
      img.data[o + 1] = (c >> 8) & 255;
      img.data[o + 2] = c & 255;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    w.img.setTexture(tex.key).setPosition(x0, y0).setVisible(true);
  }

  /** 같은 자리(LUMP_MERGE 안)에 또 던지면 쌓여서 개수가 늘어남 (2Na, 3C) */
  private addLump(kind: Solid, x: number, y: number): void {
    const near = this.lumps.find((l) => l.kind === kind && l.fizz < 0 && Phaser.Math.Distance.Between(l.x, l.y, x, y) <= LUMP_MERGE);
    if (!near) {
      this.newLump(kind, x, y, 1);
      return;
    }
    near.n += 1;
    near.t = LUMP_LIFE;
    this.refreshLumpLabel(near);
  }

  private newLump(kind: Solid, x: number, y: number, n: number): void {
    const img = this.s.add.image(Math.round(x), Math.round(y), LUMP_TEX[kind]).setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
    const l = this.makeLabel([term(`${coef(n)}${kind}`, REAGENT_COLOR[kind])]);
    this.lumps.push({ kind, n, x, y, t: LUMP_LIFE, fizz: -1, img, label: l.c, labelW: l.w, ph: Math.random() * 10, salt: false });
  }

  /** 광물을 캐서 나온 고체 n개: 하나씩 따로 튕겨 나가 떨어짐 (E로 담음). away = 플레이어 반대쪽 방향, 그쪽으로 부채꼴로 퍼짐 */
  dropSolid(kind: Solid, x: number, y: number, n: number, away: number): void {
    for (let i = 0; i < n; i++) {
      const a = away + (n > 1 ? (i / (n - 1) - 0.5) * 1.6 : 0) + (Math.random() - 0.5) * 0.6;
      const d = 18 + Math.random() * 6;
      const img = this.s.add.image(x, y, LUMP_TEX[kind]).setOrigin(0.5, 1).setDepth(DEPTH.projectile);
      const shadow = this.s.add.ellipse(x, y, 6, 3, E32.black, 0.45).setDepth(DEPTH.shadow);
      this.flying.push({ kind, sx: x, sy: y, tx: x + Math.cos(a) * d, ty: y + Math.sin(a) * d * 0.7, t: 0, img, shadow });
    }
  }

  /** 광물 가운데쯤에서 크게 한 번 튀어 날아가고 (0~0.7), 떨어진 자리에서 작게 한 번 더 통 (0.7~1) */
  private updateFlying(dt: number): void {
    for (const f of this.flying) {
      f.t += dt;
      const k = Math.min(1, f.t / FLY_SEC);
      const hop = (q: number, h: number) => h * 4 * q * (1 - q);
      const q = k < 0.7 ? k / 0.7 : (k - 0.7) / 0.3;
      const u = k < 0.7 ? q * 0.85 : 0.85 + q * 0.15;
      const z = k < 0.7 ? hop(q, 14) + 8 * (1 - q) : hop(q, 3);
      const gx = Phaser.Math.Linear(f.sx, f.tx, u);
      const gy = Phaser.Math.Linear(f.sy, f.ty, u);
      f.img.setPosition(Math.round(gx), Math.round(gy - z));
      f.shadow.setPosition(Math.round(gx), Math.round(gy));
      if (k < 1) continue;
      f.img.destroy();
      f.shadow.destroy();
      this.newLump(f.kind, f.tx, f.ty, 1);
      this.s.vfx.dust(f.tx, f.ty, 2);
    }
    this.flying = this.flying.filter((f) => f.t < FLY_SEC);
  }

  private refreshLumpLabel(lump: Lump): void {
    lump.label.destroy();
    const l = this.makeLabel([term(`${coef(lump.n)}${lump.kind}`, REAGENT_COLOR[lump.kind])]);
    lump.label = l.c;
    lump.labelW = l.w;
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
        // 지글거리며 이리저리 튐
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
      // 물에는 나트륨 하나부터 반응 (2026-11-10). 염소는 그대로 둘이 모여야 (2Na), 하나면 염소 속에서 기다림
      if (l.kind === 'Na') {
        if (this.isWater(l.x, l.y) && this.startSodium(l)) continue;
        const cl = l.n >= 2 && this.clouds.find((c) => c.burning <= 0 && c.shown.includes('Cl2') && c.species.includes('Cl2') && Phaser.Math.Distance.Between(c.x, c.y, l.x, l.y) <= CLOUD_R + 4);
        if (cl) {
          this.startSalt(l, cl);
          continue;
        }
      }
      if (l.t <= 0) this.removeLump(l);
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
    for (const w of this.waters) for (const sp of liveSpots(w)) L.add(sp.x, sp.y, sp.r * 2.4, w.acid ? E32.lime : w.hi ? E32.pink : E32.blue, 0.5 * sp.grow);
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
