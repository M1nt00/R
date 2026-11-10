import Phaser from 'phaser';
import type { RoomScene } from './RoomScene';
import { DEPTH } from '../config';
import { E32 } from '../art/palette';
import { playSfx } from '../audio/sfx';
import { Interactable } from '../entities/props';
import type { Reagent } from '../chem/chemistry';

/**
 * 보라 먼지 평원의 하루 (설계 문서 4장·14장).
 * - 하루 18시간 (아르곤 원자 번호 18), 실제 10초 = 1시간. 0~10시 낮(100초), 10~18시 밤(80초).
 * - 목표는 구역 산소화 100%: 산소탑이 1%/시간 (낮·밤 모두, 빨리 감기 땐 같이 빨라짐). 날 수 제한은 없음.
 * - 낮에 N을 누르면 밤까지 빨리 감기 (그동안 수소 구멍 타이머·날씨도 빨리 돎).
 * - 처음 아이오딘 광석 8·나트륨 광석 4·수소 구멍 5를 랜덤으로. 이틀마다 아침(3·5·7·9일차)에 아이오딘 2·나트륨 1이
 *   투명했다가 천천히 나타남. E로 캐기 (곡괭이 세 번).
 *   광물 그림은 art/minerals/*_ore.png (24×24 칸마다 모양 하나, 놓을 때 랜덤으로 고름).
 * - 산소: 산소 5개 들고 시작, 불 뿜기(점화) 한 번에 하나. 가운데 산소탑이 0.5개/시간으로 최대 2개까지 모아 두고,
 *   탑에서 E → 창이 떠서 받음. 같은 창에 업그레이드·상점 탭 (비용은 아직 안 정해서 틀만).
 * - 수소 구멍: 위에 수소가 없으면 6시간 뒤 수소 하나를 내뿜음 (게임 시작 때 바로 하나). 밤에도.
 */
export const DAY_HOURS = 18;
export const NIGHT_AT = 10;
const SEC_PER_HOUR = 10;
/** 밤 5초 전부터 가운데에 "밤까지 5 · 4 · 3 · 2 · 1". 빨리 감기(N)도 여기서 멈춤 */
const COUNTDOWN_SEC = 5;
export const NIGHT_WARN_AT = NIGHT_AT - COUNTDOWN_SEC / SEC_PER_HOUR;
/** 구역 산소화 목표 (%). 다 차면 이 구역을 다 개척한 것 */
export const OXY_GOAL = 100;
const HOLE_HOURS = 6;
/** 빨리 감기 배속: 낮 10시간도 6초 남짓 */
export const FF_SPEED = 16;
const START_O2 = 5;
/** 산소탑이 모아 두는 산소 개수 */
export const TOWER_MAX = 2;

/**
 * 산소탑 업그레이드. 단계마다 값이 step씩 늘고 (0단계 = base), max번까지.
 * 비용은 가진 시약으로 치름: 첫 비용 cost.base개, 한 번 올릴 때마다 cost.step개씩 늘어남.
 * cost가 null이면 아직 안 정한 것 (게임에서는 못 올리고, ?dev 에서만 그냥 올려 볼 수 있음).
 */
export type UpgradeId = 'oxy' | 'make' | 'hp';
export interface TowerUpgrade {
  id: UpgradeId;
  name: string;
  base: number;
  step: number;
  max: number;
  /** 값 앞뒤에 붙는 글: "" + 1.1 + "%/시간", "최대 HP " + 150 + "" */
  pre: string;
  unit: string;
  cost: { reagent: Reagent; name: string; base: number; step: number } | null;
}
export const TOWER_UPGRADES: TowerUpgrade[] = [
  // 구역 산소화 (%/시간): 1 → 2. 산소 5 · 10 · 15 … 50개
  { id: 'oxy', name: '산소화 속도', base: 1, step: 0.1, max: 10, pre: '', unit: '%/시간', cost: { reagent: 'O2', name: '산소', base: 5, step: 5 } },
  // 탑이 모으는 산소 (개/시간): 0.5 → 1.5. 물 2 · 4 · 6 … 20개
  { id: 'make', name: '산소 생산', base: 0.5, step: 0.1, max: 10, pre: '', unit: '개/시간', cost: { reagent: 'H2O', name: '물', base: 2, step: 2 } },
  // 탑 최대 HP (base는 RoomScene의 TANK_HP와 같아야 함). 숫자는 임시, 비용 미정
  { id: 'hp', name: '내구도', base: 100, step: 50, max: 3, pre: '최대 HP ', unit: '', cost: null },
];
/** 업그레이드의 lv단계 값 (0.1씩 더한 값이 0.30000000000000004처럼 되지 않게 다듬음) */
export const upgradeValue = (u: TowerUpgrade, lv: number): number => Math.round((u.base + u.step * lv) * 1000) / 1000;
/** lv단계에서 다음 단계로 올리는 비용 (개). 비용을 안 정한 항목은 null */
export const upgradeCost = (u: TowerUpgrade, lv: number): number | null => (u.cost ? u.cost.base + u.cost.step * lv : null);
/** 처음 광석 수, 그리고 SPAWN_EVERY일마다 아침에 새로 생기는 광석 수 */
const START_ORES = { iodine_ore: 8, sodium_ore: 4 } as const;
const SPAWN_EVERY = 2;
const SPAWN_ORES = { iodine_ore: 2, sodium_ore: 1 } as const;
/** 새 광석이 투명에서 다 보이기까지 (초) */
const ORE_FADE_SEC = 1.6;
const DAY_AMBIENT = 0xc0cbdc;
const NIGHT_AMBIENT = 0x5a6988;

/** 캐기: 곡괭이가 세 번 내리치고 세 번째에 부서짐. 한 번 = 들어 올림 → 내리침 → 잠깐 멈춤 */
const STRIKES = 3;
const STRIKE_SEC = 0.34;
/** 한 번 안에서 날이 광물에 닿는 순간 (0~1) */
const HIT_AT = 0.75;
const RAISE = Phaser.Math.DegToRad(-65);
/** 이 각도에서 곡괭이 오른쪽 날 끝이 손잡이 끝보다 (12, 2) 아래 오른쪽 */
const HIT_ANGLE = Phaser.Math.DegToRad(20);
const MINE_R = 24;
const DROPS = { Na: 2, I2: 1 } as const;
const ORE_KIND = { sodium_ore: 'Na', iodine_ore: 'I2' } as const;
const ORE_CHIP = { Na: E32.silver, I2: 0xa884f3 } as const;

interface Mineral {
  kind: 'Na' | 'I2';
  /** 놓인 자리 (캐면 비워서 새 광석이 올 수 있게) */
  spot: { x: number; y: number };
  img: Phaser.GameObjects.Image;
  body: Phaser.Physics.Arcade.Sprite;
  it: Interactable;
}

interface Mining {
  m: Mineral;
  t: number;
  pick: Phaser.GameObjects.Image;
  /** 플레이어가 광물 오른쪽에 있으면 곡괭이를 뒤집어 오른쪽에서 내리침 */
  side: 1 | -1;
}

/** a → b 색 섞기 (k = 0~1) */
function mix(a: number, b: number, k: number): number {
  let out = 0;
  for (const sh of [16, 8, 0]) out |= Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k) << sh;
  return out;
}

interface Hole {
  x: number;
  y: number;
  /** 다음 수소까지 남은 게임 시간(시간 단위). 위에 수소가 있는 동안은 6시간에 멈춰 있음 */
  left: number;
}

export class DustZone {
  day = 1;
  hour = 0;
  /** 밤까지 빨리 감는 중 */
  ff = false;
  /** 구역 산소화 (0 ~ OXY_GOAL %) */
  oxy = 0;
  /** 산소화를 다 채움 (시계 멈춤) */
  done = false;
  /** 산소탑 업그레이드 단계 */
  readonly levels: Record<UpgradeId, number> = { oxy: 0, make: 0, hp: 0 };
  private holes: Hole[] = [];
  /** 놓인 것들 자리 (서로 겹치지 않게) */
  private spots: { x: number; y: number }[] = [];
  /** 산소탑에 모인 산소, 다음 하나까지 찬 정도 (0~1). 가득 차 있는 동안은 0에 멈춤 */
  towerO2 = 0;
  towerNext = 0;
  private readonly keyN: Phaser.Input.Keyboard.Key;
  /** 광물 몸통 (플레이어만 부딪힘) */
  private readonly solid: Phaser.Physics.Arcade.StaticGroup;
  private mining: Mining | null = null;
  /** 마지막으로 띄운 카운트다운 숫자 (0 = 아직) */
  private shownCount = 0;

  constructor(private readonly s: RoomScene) {
    this.keyN = s.input.keyboard!.addKey('N');
    this.solid = s.physics.add.staticGroup();
    s.physics.add.collider(s.playerGroup, this.solid);
    // 시작: 산소만 들고, 나머지 원소는 캐거나 모아서 얻는다
    s.chem.setStock({ H2: 0, O2: START_O2, Na: 0, C: 0, Cl2: 0, N2: 0, I2: 0, H2O: 0, I2g: 0, HI: 0, HIaq: 0 });
    this.spots.push({ x: s.player.x, y: s.player.y });
    // 가운데 산소탑 둘레도 비워 둠 (탑이 64px 높이라 위쪽까지)
    if (s.tank) {
      this.spots.push({ x: s.tank.x, y: s.tank.y }, { x: s.tank.x, y: s.tank.y - 40 });
      s.interactables.push(new Interactable(s.tank.x, s.tank.y, 34, 'E 산소탑', () => this.openTower()));
    }
    this.placeMinerals(START_ORES);
    for (let i = 0; i < 5; i++) {
      const p = this.freeSpot();
      s.add.image(p.x, p.y, 'h2_hole').setDepth(DEPTH.terrain + 0.4);
      this.holes.push({ x: p.x, y: p.y, left: HOLE_HOURS });
      s.chem.vent(p.x, p.y);
    }
  }

  get speed(): number {
    return this.ff ? FF_SPEED : 1;
  }

  /** 0 = 낮, 1 = 밤 (9~10시 해 질 녘, 17~18시 해 뜰 녘에 바뀜) */
  get night(): number {
    const h = this.hour;
    if (h < NIGHT_AT - 1) return 0;
    if (h < NIGHT_AT) return h - (NIGHT_AT - 1);
    if (h < DAY_HOURS - 1) return 1;
    return DAY_HOURS - h;
  }

  update(dt: number): void {
    const p = this.s.player;
    if (!this.done) {
      if (Phaser.Input.Keyboard.JustDown(this.keyN) && !this.ff && this.hour < NIGHT_WARN_AT && !p.dead && !p.inputLocked) {
        this.ff = true;
        p.inputLocked = true;
        playSfx('select');
      }
      const before = this.hour;
      /** 이번 프레임에 흐른 게임 시간 (시간 단위) */
      const hours = (dt * this.speed) / SEC_PER_HOUR;
      this.hour += hours;
      if (this.ff && Math.floor(this.hour) !== Math.floor(before)) playSfx('tick');
      // 빨리 감기는 밤 5초 전에서 멈추고, 거기서부터는 보통 빠르기로 카운트다운
      if (this.ff && this.hour >= NIGHT_WARN_AT) {
        this.hour = NIGHT_WARN_AT;
        this.ff = false;
        p.inputLocked = false;
      }
      const left = Math.ceil((NIGHT_AT - this.hour) * SEC_PER_HOUR - 1e-6);
      if (this.hour >= NIGHT_WARN_AT && left >= 1 && left <= COUNTDOWN_SEC && left !== this.shownCount) {
        this.shownCount = left;
        this.s.banner(`밤까지 ${left}`, E32.silver);
        playSfx('tick');
      }
      if (before < NIGHT_AT && this.hour >= NIGHT_AT) {
        this.shownCount = 0;
        this.s.banner('밤이 왔어요', E32.steel);
      }
      if (this.hour >= DAY_HOURS) this.newDay();
      if (this.towerO2 >= TOWER_MAX) this.towerNext = 0;
      else if ((this.towerNext += hours * this.value('make')) >= 1) {
        this.towerNext -= 1;
        this.towerO2++;
      }
      this.oxy = Math.min(OXY_GOAL, this.oxy + hours * this.value('oxy'));
      if (this.oxy >= OXY_GOAL) this.finish();
      for (const h of this.holes) {
        if (this.s.chem.ventFull(h.x, h.y)) h.left = HOLE_HOURS;
        else if ((h.left -= hours) <= 0) {
          h.left = HOLE_HOURS;
          this.s.chem.vent(h.x, h.y);
        }
      }
    }
    if (this.mining) this.updateMining(dt);
    this.s.lighting.ambient = mix(DAY_AMBIENT, NIGHT_AMBIENT, this.night);
  }

  private newDay(): void {
    this.hour -= DAY_HOURS;
    this.day++;
    this.s.banner(`${this.day}일차 아침`, E32.yellow);
    if ((this.day - 1) % SPAWN_EVERY === 0) this.placeMinerals(SPAWN_ORES, true);
  }

  /** 산소화 100%: 시계가 멈추고 빨리 감기도 풀림 (그다음은 아직 없음) */
  private finish(): void {
    this.done = true;
    if (this.ff) {
      this.ff = false;
      this.s.player.inputLocked = false;
    }
    this.s.banner(`구역 산소화 ${OXY_GOAL}%!`, E32.cyan);
    playSfx('heal');
  }

  // ───────────────────────── 산소탑 ─────────────────────────

  private openTower(): void {
    if (this.mining || this.s.player.inputLocked) return;
    this.s.requestUi({ type: 'tower' });
  }

  /** 업그레이드의 지금 값 */
  value(id: UpgradeId): number {
    return upgradeValue(TOWER_UPGRADES.find((u) => u.id === id)!, this.levels[id]);
  }

  /** 가진 시약 개수 (비용 표시용) */
  have(r: Reagent): number {
    return this.s.chem.stock?.[r] ?? 0;
  }

  /** 지금 올릴 수 있나: 끝 단계가 아니고 비용만큼 가졌을 때. 비용을 안 정한 항목은 free(?dev)일 때만 */
  canUpgrade(id: UpgradeId, free = false): boolean {
    const def = TOWER_UPGRADES.find((u) => u.id === id)!;
    if (this.levels[id] >= def.max) return false;
    const cost = upgradeCost(def, this.levels[id]);
    return cost === null ? free : this.have(def.cost!.reagent) >= cost;
  }

  /** 비용을 치르고 한 단계 올림. 못 올리면 false */
  upgrade(id: UpgradeId, free = false): boolean {
    if (!this.canUpgrade(id, free)) return false;
    const def = TOWER_UPGRADES.find((u) => u.id === id)!;
    const cost = upgradeCost(def, this.levels[id]);
    if (cost !== null) for (let k = 0; k < cost; k++) this.s.chem.spend(def.cost!.reagent);
    this.levels[id]++;
    if (id === 'hp') this.s.tank?.setMaxHp(this.value('hp'));
    return true;
  }

  /** 탑 HP를 가득 채움 (비용은 아직 없음). 이미 가득이면 false */
  repair(): boolean {
    const t = this.s.tank;
    if (!t || t.hp >= t.maxHp) return false;
    t.repair();
    return true;
  }

  /** 탑에 모인 산소를 모두 받음 */
  takeTowerO2(): void {
    const n = this.towerO2;
    const t = this.s.tank;
    if (!n || !t) return;
    this.towerO2 = 0;
    this.s.chem.gain([['O2', n]], t.x, t.y - 70);
  }

  /** 광석을 종류별 개수만큼 (모양은 랜덤). fadeIn: 투명했다가 천천히 나타남 */
  private placeMinerals(counts: Record<keyof typeof ORE_KIND, number>, fadeIn = false): void {
    for (const key of ['iodine_ore', 'sodium_ore'] as const) {
      const shapes = this.s.textures.get(key).getFrameNames();
      for (let i = 0; i < counts[key]; i++) {
        const p = this.freeSpot();
        const img = this.s.add.image(p.x, p.y, key, Phaser.Utils.Array.GetRandom(shapes)).setOrigin(0.5, 1).setDepth(DEPTH.actor + p.y);
        // 몸통은 아랫부분만 (위쪽은 플레이어가 뒤로 지나가며 가려짐)
        const body = this.solid.create(p.x, p.y - 4, 'px') as Phaser.Physics.Arcade.Sprite;
        body.setVisible(false).setDisplaySize(20, 8).refreshBody();
        const m: Mineral = { kind: ORE_KIND[key], spot: p, img, body, it: new Interactable(p.x, p.y, MINE_R, 'E 캐기', () => this.startMining(m)) };
        this.s.interactables.push(m.it);
        if (fadeIn) this.s.tweens.add({ targets: img.setAlpha(0), alpha: 1, duration: ORE_FADE_SEC * 1000, ease: 'Sine.InOut' });
      }
    }
  }

  // ───────────────────────── 캐기 ─────────────────────────

  /** E: 곡괭이가 땅 땅 땅 세 번 내리치는 동안 플레이어는 못 움직임 */
  private startMining(m: Mineral): void {
    const p = this.s.player;
    if (this.mining || p.dead || p.inputLocked) return;
    p.inputLocked = true;
    m.it.enabled = false;
    const side = p.x > m.img.x ? -1 : 1;
    const pick = this.s.add
      .image(m.img.x - side * 12, m.img.y - 18, 'pickaxe')
      .setOrigin(side > 0 ? 1.5 / 16 : 1 - 1.5 / 16, 13.5 / 16)
      .setFlipX(side < 0)
      .setDepth(m.img.depth + 0.5);
    this.mining = { m, t: 0, pick, side };
    this.updateMining(0);
  }

  private updateMining(dt: number): void {
    const g = this.mining!;
    const before = g.t;
    g.t += dt;
    // 한 번 안에서: 들어 올림(0~0.55) → 빠르게 내리침(~HIT_AT) → 닿은 채 멈춤
    const k = (g.t % STRIKE_SEC) / STRIKE_SEC;
    const a = k < 0.55 ? Phaser.Math.Linear(HIT_ANGLE, RAISE, k / 0.55) : k < HIT_AT ? Phaser.Math.Linear(RAISE, HIT_ANGLE, ((k - 0.55) / (HIT_AT - 0.55)) ** 2) : HIT_ANGLE;
    g.pick.setRotation(a * g.side);
    for (let i = 0; i < STRIKES; i++) {
      const at = (i + HIT_AT) * STRIKE_SEC;
      if (before < at && g.t >= at) this.strike(g, i === STRIKES - 1);
    }
  }

  /** 날이 닿음: 땅! 불꽃·먼지, 광물이 반짝 흔들림. 마지막이면 부서져서 원소를 떨어뜨림 */
  private strike(g: Mining, last: boolean): void {
    const { m } = g;
    const s = this.s;
    const tx = m.img.x;
    const by = m.img.y;
    const ty = by - 16;
    s.vfx.spark(tx, ty, E32.white, 5, 50, 50);
    s.vfx.dust(tx, ty + 2, 3);
    playSfx('block');
    if (!last) {
      m.img.setTintFill(0xffffff).setX(tx + g.side);
      s.time.delayedCall(60, () => m.img.clearTint().setX(tx));
      return;
    }
    playSfx('hit');
    s.vfx.burst(tx, by - 8, ORE_CHIP[m.kind], 14);
    s.vfx.spark(tx, by - 8, ORE_CHIP[m.kind], 10, 70, 70);
    s.vfx.dust(tx, by, 8);
    s.lighting.flash(tx, by - 8, 40, E32.white, 0.6);
    m.img.destroy();
    m.body.destroy();
    s.interactables = s.interactables.filter((it) => it !== m.it);
    this.spots = this.spots.filter((o) => o !== m.spot);
    s.chem.dropSolid(m.kind, tx, by, DROPS[m.kind], Math.atan2(by - s.player.y, tx - s.player.x));
    s.tweens.add({ targets: g.pick, alpha: 0, duration: 150, onComplete: () => g.pick.destroy() });
    s.player.inputLocked = false;
    this.mining = null;
  }

  /** 움직일 수 있는 곳 안, 가장자리·플레이어·다른 것과 떨어진 랜덤 자리 */
  private freeSpot(): { x: number; y: number } {
    const b = this.s.physics.world.bounds;
    const p = this.s.player;
    let best = { x: b.centerX, y: b.centerY };
    for (let k = 0; k < 300; k++) {
      const x = Math.round(b.x + 24 + Math.random() * (b.width - 48));
      const y = Math.round(b.y + 24 + Math.random() * (b.height - 48));
      best = { x, y };
      if (Phaser.Math.Distance.Between(x, y, p.x, p.y) < 60) continue;
      if (this.spots.some((o) => Phaser.Math.Distance.Between(x, y, o.x, o.y) < 48)) continue;
      break;
    }
    this.spots.push(best);
    return best;
  }

  /** 밤에는 플레이어 둘레가 조금 밝게 */
  emitLights(): void {
    const n = this.night;
    if (n > 0) this.s.lighting.add(this.s.player.x, this.s.player.y - 6, 80, E32.silver, 0.5 * n);
  }
}
