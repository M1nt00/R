import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { Actor } from './actor';
import { DEPTH, FONT, RENDER_SCALE, TILE } from '../config';
import { C, ELEMENT_COLOR, toCss } from '../art/palette';
import { ICON, type IconName } from '../art/propSprites';
import type { RoomSpec, RewardKind } from '../run/runState';
import type { AnimDef } from '../art/heroSprites';
import type { HitInfo } from '../combat/damage';
import type { Element } from '../element/types';
import { playSfx } from '../audio/sfx';

export const REWARD_ICON: Record<RewardKind, IconName> = {
  boon: 'boon',
  gold: 'gold',
  relic: 'relic',
  shop: 'shop',
  heal: 'heal',
  boss: 'boss',
};

export const REWARD_COLOR: Record<RewardKind, number> = {
  boon: 0xffe08a,
  gold: C.gold0,
  relic: C.water0,
  shop: C.leather0,
  heal: 0xff8a9a,
  boss: C.fire1,
};

export const REWARD_LABEL: Record<RewardKind, string> = {
  boon: '반응 강화',
  gold: '골드',
  relic: '유물 (엘리트)',
  shop: '상점',
  heal: '회복의 샘',
  boss: '보스',
};

const label = (s: Phaser.Scene, x: number, y: number, text: string, color = '#ffffff') =>
  s.add
    .text(x, y, text, { fontFamily: FONT, fontSize: '6px', color, stroke: '#0e0b14', strokeThickness: 2 })
    .setOrigin(0.5, 1)
    .setResolution(RENDER_SCALE)
    .setDepth(DEPTH.text - 2);

/** 위쪽 벽의 문. 열리면 다음 방 보상 아이콘이 문 위에 뜬다. */
export class Door {
  readonly x: number;
  readonly y: number;
  readonly img: Phaser.GameObjects.Image;
  private icon: Phaser.GameObjects.Image | null = null;
  private text: Phaser.GameObjects.Text | null = null;
  spec: RoomSpec | null = null;
  open = false;

  constructor(
    private readonly s: RoomScene,
    col: number,
  ) {
    this.x = col * TILE + TILE;
    this.y = TILE * 2;
    this.img = s.add.image(this.x, this.y, 'door', '0').setOrigin(0.5, 1).setDepth(DEPTH.terrain + 0.5);
  }

  openWith(spec: RoomSpec): void {
    this.spec = spec;
    this.open = true;
    this.img.setFrame('1');
    this.icon = this.s.add.image(this.x, this.y - 16, 'icons', String(ICON[REWARD_ICON[spec.reward]])).setDepth(DEPTH.text - 3);
    this.text = label(this.s, this.x, this.y + 12, REWARD_LABEL[spec.reward], toCss(REWARD_COLOR[spec.reward]));
    this.s.vfx.spark(this.x, this.y - 4, REWARD_COLOR[spec.reward], 12, 60, 60);
    playSfx('door');
  }

  update(time: number): void {
    if (!this.open || !this.spec) return;
    this.icon?.setY(Math.round(this.y - 16 + Math.sin(time * 3 + this.x) * 1.5));
    this.s.lighting.add(this.x, this.y - 8, 50, REWARD_COLOR[this.spec.reward], 0.75);
  }

  contains(px: number, py: number): boolean {
    return this.open && Math.abs(px - this.x) < 12 && py < this.y + 8;
  }
}

export type PickupKind = 'coin' | 'essence' | 'reward' | 'heart';

/** 동전·원소 정수(자동 흡수), 보상 구슬(가서 E) */
export class Pickup {
  readonly img: Phaser.GameObjects.Image;
  private glow: Phaser.GameObjects.Image | null = null;
  x: number;
  y: number;
  z = 0;
  vz: number;
  vx: number;
  vy: number;
  t = 0;
  alive = true;

  constructor(
    private readonly s: RoomScene,
    readonly kind: PickupKind,
    x: number,
    y: number,
    readonly value: number,
    readonly reward: RewardKind | null = null,
  ) {
    this.x = x;
    this.y = y;
    const a = Math.random() * Math.PI * 2;
    const sp = kind === 'reward' ? 0 : 30 + Math.random() * 50;
    this.vx = Math.cos(a) * sp;
    this.vy = Math.sin(a) * sp * 0.6;
    this.vz = kind === 'reward' ? 0 : 60 + Math.random() * 40;
    const key = kind === 'coin' ? 'coin' : kind === 'essence' ? 'essence' : kind === 'heart' ? 'icons' : 'reward_orb_elem';
    this.img = s.add.image(x, y, key, kind === 'heart' ? String(ICON.heart) : '0').setOrigin(0.5, 1).setDepth(DEPTH.actor + y);
    if (kind === 'reward') {
      this.img.setTint(REWARD_COLOR[reward ?? 'boon']);
      this.glow = s.add.image(x, y - 8, 'glow').setBlendMode(Phaser.BlendModes.ADD).setTint(REWARD_COLOR[reward ?? 'boon']).setDepth(DEPTH.glow);
      this.z = 6;
    }
  }

  update(dt: number): void {
    this.t += dt;
    if (this.kind !== 'reward') {
      this.vz -= 300 * dt;
      this.z = Math.max(0, this.z + this.vz * dt);
      if (this.z === 0) {
        this.vz = Math.abs(this.vz) > 30 ? -this.vz * 0.4 : 0;
        this.vx *= 0.85;
        this.vy *= 0.85;
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      // 자석: 잠깐 뒤 플레이어에게 빨려감
      const p = this.s.player;
      if (!p.dead && this.t > 0.45) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
        if (d < 70) {
          const k = Math.min(1, dt * (8 + this.t * 6));
          this.x += (p.x - this.x) * k;
          this.y += (p.y - this.y) * k;
        }
        if (d < 7) this.collect();
      }
      if (this.s.terrain.isWallAt(this.x, this.y)) {
        this.vx = -this.vx;
        this.vy = -this.vy;
      }
    } else {
      this.z = 6 + Math.sin(this.t * 3) * 2;
      this.s.lighting.add(this.x, this.y - 8, 60, REWARD_COLOR[this.reward ?? 'boon'], 0.8);
    }
    const frame = this.kind === 'heart' ? String(ICON.heart) : String(Math.floor(this.t * 8) % 4);
    this.img.setFrame(frame).setPosition(Math.round(this.x), Math.round(this.y - this.z)).setDepth(DEPTH.actor + this.y);
    this.glow?.setPosition(this.x, this.y - this.z - 7).setScale(1 + Math.sin(this.t * 4) * 0.1).setAlpha(0.7);
  }

  collect(): void {
    if (!this.alive) return;
    this.alive = false;
    this.img.destroy();
    this.glow?.destroy();
    this.s.onPickup(this);
  }
}

/** E 키로 쓰는 물체 (제단, 포탈, 샘, 상점 받침대) */
export class Interactable {
  readonly sprites: Phaser.GameObjects.GameObject[] = [];
  enabled = true;
  extra: Record<string, unknown> = {};
  constructor(
    readonly x: number,
    readonly y: number,
    readonly radius: number,
    public prompt: string,
    readonly use: () => void,
  ) {}
}

const DUMMY_ANIMS: Record<string, AnimDef> = {
  idle: { start: 0, count: 1, fps: 1, loop: true },
  hit: { start: 1, count: 1, fps: 1, loop: false },
};

/** 훈련용 허수아비 — 죽지 않고, 최근 3초 피해량(DPS)을 보여준다 */
export class Dummy extends Actor {
  private hitT = 0;
  private log: { t: number; d: number }[] = [];
  private readonly text: Phaser.GameObjects.Text;

  constructor(s: RoomScene, group: Phaser.Physics.Arcade.Group, x: number, y: number) {
    super(s, group, x, y, {
      sheet: 'dummy',
      anims: DUMMY_ANIMS,
      radius: 7,
      hp: 99999,
      team: 'enemy',
      tint: 0xffffff,
      originY: 27 / 32,
      height: 22,
    });
    this.phys.body.immovable = true;
    this.phys.body.pushable = false;
    this.text = label(s, x, y + 12, '', '#c2bad6');
    this.play('idle');
  }

  update(dt: number): void {
    this.baseUpdate(dt);
    this.hitT = Math.max(0, this.hitT - dt);
    this.play(this.hitT > 0 ? 'hit' : 'idle');
    this.impulse.set(0, 0);
    this.move(0, 0, dt);
    const now = this.s.gameTime;
    this.log = this.log.filter((l) => now - l.t < 3);
    const sum = this.log.reduce((a, l) => a + l.d, 0);
    this.text.setText(sum > 0 ? `${Math.round(sum / 3)} DPS` : '');
    const el = this.es.attached as Element | null;
    this.elementTint = el ? ELEMENT_COLOR[el] : 0xffffff;
  }

  override onDamaged(h: HitInfo, dmg: number): void {
    super.onDamaged(h, dmg);
    this.hitT = 0.15;
    this.hp = this.maxHp;
    this.log.push({ t: this.s.gameTime, d: dmg });
    this.s.vfx.spark(this.x, this.y - 12, C.grass0, 3, 40, 40);
  }

  override knock(): void {}
  override freeze(d: number): void {
    super.freeze(Math.min(d, 1));
  }
}
