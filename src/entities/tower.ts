import Phaser from 'phaser';
import { DEPTH } from '../config';
import { C, E32 } from '../art/palette';

/** 맞은 뒤 이만큼(초) 지나면 하얀 잔상이 줄기 시작 */
const GHOST_HOLD = 0.35;
/** 잔상이 줄어드는 빠르기 (1초에 최대 HP의 몇 배) */
const GHOST_RATE = 0.6;
/** 맞은 직후 테두리가 하얗게 번쩍이고 막대가 떨리는 시간 (초) */
export const TOWER_FLASH_SEC = 0.12;
/** 이 비율 아래면 위험: 빨갛게 깜빡임 */
export const TOWER_LOW = 0.25;
/** 탑 위 막대: 안쪽 폭·높이, 탑 발밑에서 위로 */
const BAR_W = 40;
const BAR_H = 4;
const BAR_UP = 90;

/** HP 비율에 따른 색 [몸통, 윗줄 하이라이트, 아랫줄 그늘]: 넉넉하면 청록, 절반 아래 호박, 1/4 아래 빨강 */
export function towerHpRamp(frac: number): [number, number, number] {
  if (frac > 0.5) return [E32.cyan, E32.white, E32.blue];
  if (frac > TOWER_LOW) return [E32.amber, E32.yellow, E32.orange];
  return [E32.red, E32.pink, E32.crimson];
}

/** 위험할 때 0.25초마다 켜졌다 꺼짐 (ms 시각) */
export const towerBlink = (nowMs: number): boolean => Math.floor(nowMs / 250) % 2 === 0;

/**
 * 지켜야 하는 산소탑. HP와 탑 위 HP 막대를 가진다.
 * 막대: 검은 외곽 + 회청 테두리, 색은 HP 비율을 따라 바뀌고, 방금 깎인 만큼은 하얀 잔상으로 남았다가 줄어듦.
 * HP가 가득이면 숨김 (늘 보이는 건 화면 왼쪽 위 HUD 막대, UIScene이 여기 값을 읽어서 그림).
 */
export class OxygenTower {
  hp: number;
  maxHp: number;
  /** 막대에서 천천히 따라 내려오는 값 (hp보다 크면 그 차이가 하얀 잔상) */
  ghost: number;
  /** 마지막으로 맞은 뒤 흐른 시간 (초) */
  sinceHit = 99;
  private readonly bar: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly x: number,
    readonly y: number,
    readonly img: Phaser.GameObjects.Sprite,
    maxHp: number,
  ) {
    this.hp = this.maxHp = this.ghost = maxHp;
    this.bar = scene.add.graphics().setDepth(DEPTH.hud).setAlpha(0);
  }

  get frac(): number {
    return this.hp / this.maxHp;
  }

  damage(n: number): void {
    this.hp = Math.max(0, this.hp - n);
    this.sinceHit = 0;
  }

  /** 수리: 가득 채움 */
  repair(): void {
    this.hp = this.ghost = this.maxHp;
  }

  /** 최대 HP를 바꾸면 늘어난 만큼 지금 HP도 같이 늘어남 */
  setMaxHp(n: number): void {
    this.hp = Math.max(1, this.hp + n - this.maxHp);
    this.maxHp = n;
    this.ghost = Math.max(this.hp, Math.min(this.ghost, n));
  }

  update(dt: number): void {
    this.sinceHit += dt;
    if (this.sinceHit > GHOST_HOLD) this.ghost = Math.max(this.hp, this.ghost - this.maxHp * GHOST_RATE * dt);
    // 다친 동안만 보이고, 가득 차면 서서히 사라짐
    const show = this.hp < this.maxHp ? 1 : 0;
    this.bar.alpha = Phaser.Math.Clamp(this.bar.alpha + (show ? 6 : -3) * dt, 0, 1);
    if (this.bar.alpha > 0) this.draw();
  }

  private draw(): void {
    const g = this.bar;
    const f = this.frac;
    const flash = this.sinceHit < TOWER_FLASH_SEC;
    // 맞은 직후 좌우로 1px 떨림
    const left = Math.round(this.x - BAR_W / 2) + (flash ? (Math.floor(this.sinceHit / 0.03) % 2 ? 1 : -1) : 0);
    const top = this.y - BAR_UP;
    const [main, hi, lo] = towerHpRamp(f);
    const low = f <= TOWER_LOW && this.hp > 0;
    const frame = flash ? E32.white : low && towerBlink(this.scene.time.now) ? E32.red : E32.slate;
    g.clear();
    g.fillStyle(C.out, 1).fillRect(left - 2, top - 2, BAR_W + 4, BAR_H + 4);
    g.fillStyle(frame, 1).fillRect(left - 1, top - 1, BAR_W + 2, BAR_H + 2);
    g.fillStyle(E32.night, 1).fillRect(left, top, BAR_W, BAR_H);
    const fw = this.hp > 0 ? Math.max(1, Math.round(BAR_W * f)) : 0;
    const gw = Math.round((BAR_W * this.ghost) / this.maxHp);
    if (gw > fw) g.fillStyle(E32.white, 1).fillRect(left + fw, top, gw - fw, BAR_H);
    if (fw > 0) {
      g.fillStyle(main, 1).fillRect(left, top, fw, BAR_H);
      g.fillStyle(hi, 1).fillRect(left, top, fw, 1);
      g.fillStyle(lo, 1).fillRect(left, top + BAR_H - 1, fw, 1);
    }
    // 1/4마다 눈금 (아래 두 줄)
    g.fillStyle(C.out, 0.55);
    for (let k = 1; k < 4; k++) g.fillRect(left + (BAR_W * k) / 4, top + 2, 1, BAR_H - 2);
  }
}
