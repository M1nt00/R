import { E32 } from '../art/palette';
import { CHEM_COLOR, type ChemTerm, type Reagent } from '../chem/chemistry';

/**
 * 도감: 발견한 물질과 반응식.
 * - 물질은 처음 손에 넣거나(핫바에 들어옴) 처음 반응에 나올 때, 반응식은 처음 일으킬 때 등록된다.
 * - 등록 전에는 ??? 칸으로만 보인다 (칸 수는 보임).
 * - 구역을 넘어 이어지는 기록이라 브라우저(localStorage)에 따로 저장한다.
 * 화면은 UIScene.openCodex (Tab), 등록은 UIScene이 화학 이벤트와 가진 시약을 보고 부른다.
 */

export type MatterState = '기체' | '액체' | '고체' | '수용액';

export interface CodexSubstance {
  id: string;
  /** 화면에 쓰는 화학식 */
  f: string;
  name: string;
  state: MatterState;
  color: number;
  desc: string;
}

export interface CodexReaction {
  id: string;
  lhs: ChemTerm[];
  rhs: ChemTerm[];
  /** 일어나는 조건 */
  cond: string;
  desc: string;
  /** 이 반응을 일으키면 같이 등록되는 물질 */
  subs: string[];
}

const S = (id: string, f: string, name: string, state: MatterState, color: number, desc: string): CodexSubstance => ({ id, f, name, state, color, desc });

export const SUBSTANCES: CodexSubstance[] = [
  S('H2', 'H2', '수소', '기체', CHEM_COLOR.H, '가장 가벼운 기체예요. 산소·염소·아이오딘과 섞어 불을 붙이면 반응해요. 수소만 있는 구름에는 불이 붙지 않아요.'),
  S('O2', 'O2', '산소', '기체', CHEM_COLOR.O, '무언가 타려면 있어야 하는 기체예요. 아르고스의 공기에는 없어서 산소탑이 만들어요. 불을 뿜을 때마다 하나씩 써요.'),
  S('H2O', 'H2O', '물', '액체', E32.cyan, '수소가 타면 생겨요. 웅덩이로 고이고, 플라스크에 담아 갈 수 있어요. 산소탑의 산소 생산을 올리는 재료예요.'),
  S('Na', 'Na', '나트륨', '고체', CHEM_COLOR.Na, '칼로 잘릴 만큼 무른 금속이에요. 물에 닿으면 지글거리다 터지면서 수소를 내놓아요.'),
  S('NaOH', 'NaOH', '수산화나트륨', '수용액', CHEM_COLOR.naoh, '나트륨이 물과 반응하고 남는 강한 염기예요.'),
  S('I2', 'I2', '아이오딘', '고체', CHEM_COLOR.I, '검보라색으로 반짝이는 결정이에요. 데우면 녹지 않고 바로 보라색 기체가 돼요 (승화). 이름은 그리스어로 "보랏빛"이라는 뜻이에요.'),
  S('HI', 'HI', '아이오딘화수소', '기체', CHEM_COLOR.HI, '수소와 아이오딘 기체에 불을 붙이면 생겨요. 구름에 닿은 적이 계속 피해를 입고, 물에 아주 잘 녹아요.'),
  S('HIaq', 'HI(aq)', '아이오딘화수소산', '수용액', CHEM_COLOR.HI, '아이오딘화수소가 물에 녹은 강한 산이에요. 그 물 위에 선 적이 계속 피해를 입어요.'),
  S('C', 'C', '탄소', '고체', CHEM_COLOR.C, '검은 가루예요. 산소가 넉넉하면 이산화탄소로, 모자라면 일산화탄소로 타요.'),
  S('CO2', 'CO2', '이산화탄소', '기체', CHEM_COLOR.CO2, '탄소가 산소를 넉넉히 만나 타면 생겨요. 물 위에 여섯이 모이면 광합성의 재료가 돼요.'),
  S('CO', 'CO', '일산화탄소', '기체', CHEM_COLOR.CO, '산소가 모자란 채로 탄소가 타면 생기는 기체예요.'),
  S('C6H12O6', 'C6H12O6', '포도당', '고체', CHEM_COLOR.glucose, '광합성으로 열리는 열매예요. 주우면 세포 호흡으로 HP를 회복해요.'),
  S('Cl2', 'Cl2', '염소', '기체', CHEM_COLOR.Cl, '황록색 독가스예요. 구름 안의 적이 계속 피해를 입어요.'),
  S('HCl', 'HCl', '염화수소', '기체', CHEM_COLOR.HCl, '수소와 염소가 터지면 구름에 남는 기체예요. 물에 녹으면 염산이 돼요.'),
  S('HClaq', 'HCl(aq)', '염산', '수용액', CHEM_COLOR.acid, '염화수소가 물에 녹은 강한 산이에요. 그 웅덩이 위에 선 적이 계속 피해를 입어요.'),
  S('NaCl', 'NaCl', '염화나트륨', '고체', CHEM_COLOR.NaCl, '나트륨이 염소 속에서 타고 남는 흰 결정, 소금이에요.'),
  S('N2', 'N2', '질소', '기체', CHEM_COLOR.N, '좀처럼 반응하지 않는 기체예요. 수소 구름에 닿아 있으면 불이 붙지 않게 막아 줘요.'),
  S('NH3', 'NH3', '암모니아', '기체', CHEM_COLOR.NH3, '질소 하나에 수소 셋이 붙은 기체예요. 염화수소와 만나면 흰 연기가 돼요.'),
  S('NH4Cl', 'NH4Cl', '염화암모늄', '고체', CHEM_COLOR.NH4Cl, '암모니아와 염화수소가 만나 생기는 흰 연기예요. 안에 든 적이 느려져요.'),
  S('NO2', 'NO2', '이산화질소', '기체', CHEM_COLOR.NO2, '적갈색 독가스예요. 질소와 산소가 폭발의 열을 받으면 생겨요.'),
];

const T = (f: string, color: number): ChemTerm => ({ f, color });
const R = (lhs: ChemTerm[], rhs: ChemTerm[], cond: string, desc: string, subs: string[]): CodexReaction => ({ id: reactionKey(lhs, rhs), lhs, rhs, cond, desc, subs });

/** 반응식의 열쇠: 양쪽 항을 각각 가나다순으로 (항 순서가 달라도 같은 반응) */
export function reactionKey(lhs: { f: string }[], rhs: { f: string }[]): string {
  const side = (ts: { f: string }[]) => ts.map((t) => t.f).sort().join('+');
  return `${side(lhs)}>${side(rhs)}`;
}

const C = CHEM_COLOR;
export const REACTIONS: CodexReaction[] = [
  R([T('2H2', C.H), T('O2', C.O)], [T('2H2O', C.water)], '같은 구름에 불', '수소가 타면서 터지고 물이 남아요. 산소를 안 섞어도 불 뿜기의 산소로 물이 돼요.', ['H2', 'O2', 'H2O']),
  R([T('2H2O', C.water), T('2Na', C.Na)], [T('2NaOH', C.naoh), T('H2', C.H)], '나트륨이 물에 닿으면', '지글거리다 터지고, 그 자리에 수소 구름이 생겨요.', ['H2O', 'Na', 'NaOH', 'H2']),
  R([T('H2', C.H), T('I2', C.I)], [T('2HI', C.HI)], '기체 아이오딘과 수소에 불', '터지지 않고 아이오딘화수소 구름이 돼요.', ['H2', 'I2', 'HI']),
  R([T('HI', C.HI), T('H2O', C.water)], [T('H3O+', C.HI), T('I-', C.I)], '구름이 물 위에 있으면', '아이오딘화수소가 물에 녹아 산이 돼요.', ['HI', 'H2O', 'HIaq']),
  R([T('C', C.C), T('O2', C.O)], [T('CO2', C.CO2)], '탄소 위 산소 구름, 가루에 불', '산소가 넉넉하면 이산화탄소가 구름에 남아요.', ['C', 'O2', 'CO2']),
  R([T('2C', C.C), T('O2', C.O)], [T('2CO', C.CO)], '산소가 모자란 채로 불', '산소가 모자라면 일산화탄소가 돼요.', ['C', 'O2', 'CO']),
  R([T('6CO2', C.CO2), T('6H2O', C.water)], [T('C6H12O6', C.glucose), T('6O2', C.O)], '이산화탄소 6이 물 6 위에', '광합성. 포도당 열매가 열리고 이산화탄소가 산소로 바뀌어요.', ['CO2', 'H2O', 'C6H12O6', 'O2']),
  R([T('C6H12O6', C.glucose), T('6O2', C.O)], [T('6CO2', C.CO2), T('6H2O', C.water)], '열매를 주우면', '세포 호흡. HP를 회복해요.', ['C6H12O6', 'O2', 'CO2', 'H2O']),
  R([T('H2', C.H), T('Cl2', C.Cl)], [T('2HCl', C.HCl)], '같은 구름에 불', '초록빛으로 크게 터지고 염화수소가 구름에 남아요.', ['H2', 'Cl2', 'HCl']),
  R([T('HCl', C.HCl), T('H2O', C.water)], [T('H3O+', C.acid), T('Cl-', C.Cl)], '구름이 물 위에 있으면', '염화수소가 물에 녹아 염산 웅덩이가 돼요.', ['HCl', 'H2O', 'HClaq']),
  R([T('2Na', C.Na), T('Cl2', C.Cl)], [T('2NaCl', C.NaCl)], '나트륨이 염소 구름 속에', '노랗게 타오르다 작게 터지고 소금이 남아요.', ['Na', 'Cl2', 'NaCl']),
  R([T('N2', C.N), T('3H2', C.H)], [T('2NH3', C.NH3)], '같은 구름에 불', '터지지 않고 암모니아 구름이 돼요. 수소가 셋보다 적으면 불이 안 붙어요.', ['N2', 'H2', 'NH3']),
  R([T('NH3', C.NH3), T('HCl', C.HCl)], [T('NH4Cl', C.NH4Cl)], '두 기체가 닿으면', '불 없이도 흰 연기가 돼요. 안에 든 적이 느려져요.', ['NH3', 'HCl', 'NH4Cl']),
  R([T('N2', C.N), T('2O2', C.O)], [T('2NO2', C.NO2)], '폭발 범위 안에서', '폭발의 열로 갈색 독가스가 생겨요.', ['N2', 'O2', 'NO2']),
];

/** 가진 시약 → 도감 물질 (같은 물질의 다른 상태는 한 칸: 기체 아이오딘 = 아이오딘) */
const REAGENT_ENTRY: Partial<Record<Reagent, string>> = { I2g: 'I2' };
export const substanceOfReagent = (r: Reagent): string => REAGENT_ENTRY[r] ?? r;

// ───────────────────────── 기록 ─────────────────────────

const KEY = 'argos-codex-v1';
const known = { substances: new Set<string>(), reactions: new Set<string>() };
/** 이번에 켠 뒤 새로 등록됐고 아직 도감에서 안 본 것 (칸에 노란 점) */
const fresh = new Set<string>();

function load(): void {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as { substances?: string[]; reactions?: string[] };
    // 표에 없는 옛 이름은 버림
    for (const id of d.substances ?? []) if (SUBSTANCES.some((s) => s.id === id)) known.substances.add(id);
    for (const id of d.reactions ?? []) if (REACTIONS.some((r) => r.id === id)) known.reactions.add(id);
  } catch {
    /* 저장을 못 읽으면 빈 도감으로 */
  }
}
load();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, substances: [...known.substances], reactions: [...known.reactions] }));
  } catch {
    /* 저장이 막힌 브라우저에서는 켜 둔 동안만 유지 */
  }
}

export const knowsSubstance = (id: string): boolean => known.substances.has(id);
export const knowsReaction = (id: string): boolean => known.reactions.has(id);
export const isFresh = (id: string): boolean => fresh.has(id);
export const markSeen = (id: string): void => void fresh.delete(id);
export const codexCount = (): { substances: number; reactions: number } => ({ substances: known.substances.size, reactions: known.reactions.size });

/** 물질 등록. 새로 등록됐으면 그 항목, 이미 있거나 표에 없으면 null */
export function discoverSubstance(id: string): CodexSubstance | null {
  const s = SUBSTANCES.find((x) => x.id === id);
  if (!s || known.substances.has(id)) return null;
  known.substances.add(id);
  fresh.add(id);
  save();
  return s;
}

/** 반응식 등록 (나온 물질도 같이). 새로 등록된 것들을 돌려줌. 표에 없는 반응식이면 null */
export function discoverReaction(lhs: { f: string }[], rhs: { f: string }[]): { reaction: CodexReaction | null; substances: CodexSubstance[] } | null {
  const id = reactionKey(lhs, rhs);
  const r = REACTIONS.find((x) => x.id === id);
  if (!r) return null;
  const substances = r.subs.map((s) => discoverSubstance(s)).filter((s): s is CodexSubstance => !!s);
  if (known.reactions.has(id)) return { reaction: null, substances };
  known.reactions.add(id);
  fresh.add(id);
  save();
  return { reaction: r, substances };
}

/** 도감 비우기 (개발용) */
export function resetCodex(): void {
  known.substances.clear();
  known.reactions.clear();
  fresh.clear();
  save();
}
