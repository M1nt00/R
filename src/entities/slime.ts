import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { Actor } from './actor';
import type { AnimDef } from '../art/heroSprites';
import type { HitInfo } from '../combat/damage';
import { TILE } from '../config';
import { playSfx } from '../audio/sfx';

/** art/lab/slime.png: 16×16 4프레임 (보통 · 눌림 · 늘어남 · 눌림) */
const SLIME_ANIMS: Record<string, AnimDef> = {
  walk: { start: 0, count: 4, durs: [0.14, 0.08, 0.2, 0.1], loop: true },
  idle: { start: 0, count: 2, durs: [0.4, 0.25], loop: true },
};
const HP = 20;
const SPEED = 30;
const DAMAGE = 5;
const COOLDOWN = 1;

// shortcut: LAB_TEMPLATE 전용 길 (합류 구역 열 19, 방 행 4~15). 맵이 여러 개가 되면 탱크까지 거리 지도(BFS)로 바꾸기
const JOIN_X = 19 * TILE + 8;
const ROOM_TOP = 4 * TILE + 8;
const ROOM_BOTTOM = 15 * TILE + 8;

/** 실험실 슬라임 (HP 20, 방어력 0): 통로를 따라 왼쪽으로 와서 아르곤 탱크를 때린다. 붙어 있는 플레이어도 때린다 */
export class Slime extends Actor {
  readonly kind = 'slime';
  private atkCd = 0;

  constructor(s: RoomScene, group: Phaser.Physics.Arcade.Group, x: number, y: number) {
    super(s, group, x, y, { sheet: 'slime', anims: SLIME_ANIMS, radius: 6, hp: HP, team: 'enemy', tint: 0x63c74d, originY: 15 / 16, height: 12 });
    this.elemImg.setVisible(false); // 원소 레이어 없음 (Actor가 두 장을 요구해서 같은 그림을 넣어 둠)
    this.spawnT = 0.45;
    this.play('walk');
  }

  update(dt: number): void {
    this.baseUpdate(dt);
    if (this.dead) return;
    this.atkCd -= dt;
    const s = this.s;
    const p = s.player;
    const tank = s.tank;
    if (this.spawnT > 0 || this.disabled || !tank) {
      this.move(0, 0, dt);
      return;
    }
    if (!p.dead && Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y) < this.radius + p.radius + 4) {
      if (this.atkCd <= 0) {
        this.atkCd = COOLDOWN;
        s.combat.hit(p, { damage: DAMAGE, knockback: 80, fromX: this.x, fromY: this.y });
      }
      this.stand(dt);
      return;
    }
    if (Phaser.Math.Distance.Between(this.x, this.y, tank.x, tank.y - 8) < 26) {
      if (this.atkCd <= 0) {
        this.atkCd = COOLDOWN;
        s.hitTank(DAMAGE);
      }
      this.stand(dt);
      return;
    }
    // 합류 구역까지는 통로를 따라 왼쪽으로, 그다음 탱크로 곧장
    const inLane = this.x > JOIN_X + 4;
    const tx = inLane ? JOIN_X : tank.x;
    const ty = inLane ? Phaser.Math.Clamp(this.y, ROOM_TOP, ROOM_BOTTOM) : tank.y - 8;
    const d = Math.hypot(tx - this.x, ty - this.y) || 1;
    const vx = ((tx - this.x) / d) * SPEED;
    const vy = ((ty - this.y) / d) * SPEED;
    if (Math.abs(vx) > 1) this.facing = vx < 0 ? -1 : 1;
    this.move(vx, vy, dt);
    this.play('walk');
  }

  private stand(dt: number) {
    this.move(0, 0, dt);
    this.play('idle');
  }

  override onDamaged(h: HitInfo, dmg: number): void {
    super.onDamaged(h, dmg);
    playSfx('hit');
  }

  override die(): void {
    super.die();
    playSfx('death');
  }
}
