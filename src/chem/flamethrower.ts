import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { DEPTH } from '../config';
import { E32 } from '../art/palette';
import { playSfx } from '../audio/sfx';

/**
 * 화염방사기: 좌클릭을 누르고 있는 동안 마우스 쪽으로 불을 뿜는다.
 * 불길(부채꼴)에 닿은 수소 구름에 불이 붙고, 적에게는 약한 화상 피해.
 */
const RANGE = 64;
const HALF = 0.32;
/** 초당 불꽃 입자 수 */
const RATE = 120;
const DAMAGE = 3;
const DAMAGE_TICK = 0.2;
const SFX_TICK = 0.11;
/** 불꽃이 연기로 바뀌는 시점 (수명 비율) */
const SMOKE_AT = 0.72;

interface Flame {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
}

export class Flamethrower {
  firing = false;
  private flames: Flame[] = [];
  private acc = 0;
  private damageT = 0;
  private sfxT = 0;
  private readonly fire: Phaser.GameObjects.Graphics;
  private readonly smoke: Phaser.GameObjects.Graphics;

  constructor(private readonly s: RoomScene) {
    this.smoke = s.add.graphics().setDepth(DEPTH.vfx - 2);
    // 불꽃은 더하기로 겹쳐서 가운데가 하얗게 달아오르게
    this.fire = s.add.graphics().setDepth(DEPTH.vfx - 1).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** 불이 나오는 곳 (손 높이) */
  private nozzle() {
    const p = this.s.player;
    const a = p.aimAngle;
    return { x: p.x + Math.cos(a) * 9, y: p.y - 9 + Math.sin(a) * 6, a };
  }

  update(dt: number): void {
    const s = this.s;
    const p = s.player;
    this.firing = !p.dead && !p.inputLocked && !p.rolling && s.combatEnabled && s.input.activePointer.leftButtonDown();
    if (this.firing) {
      const n = this.nozzle();
      p.firePose();
      this.acc += dt * RATE;
      while (this.acc >= 1) {
        this.acc -= 1;
        const ang = n.a + (Math.random() - 0.5) * 2 * HALF;
        const sp = 270 + Math.random() * 70;
        this.flames.push({
          x: n.x + (Math.random() - 0.5) * 2,
          y: n.y + (Math.random() - 0.5) * 2,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp * 0.85,
          t: Math.random() * 0.02,
          life: 0.3 + Math.random() * 0.12,
        });
      }
      s.chem.igniteCone(p.x, p.y, n.a, RANGE, HALF);
      this.damageT -= dt;
      if (this.damageT <= 0) {
        this.damageT = DAMAGE_TICK;
        for (const t of s.combat.inArc(p.x, p.y, RANGE, n.a, HALF, 'enemy')) {
          s.combat.hit(t, { damage: DAMAGE * p.atkMult, knockback: 15, fromX: p.x, fromY: p.y, color: E32.orange });
        }
      }
      this.sfxT -= dt;
      if (this.sfxT <= 0) {
        this.sfxT = SFX_TICK;
        playSfx('flame');
      }
    } else {
      this.acc = 0;
      this.damageT = 0;
      this.sfxT = 0;
    }
    for (const f of this.flames) {
      f.t += dt;
      // 공기 저항으로 끝에서 뭉게뭉게, 열기는 위로
      const drag = Math.exp(-dt * 2.6);
      f.vx *= drag;
      f.vy = f.vy * drag - 28 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.flames = this.flames.filter((f) => f.t < f.life);
  }

  draw(): void {
    const g = this.fire;
    const sm = this.smoke;
    g.clear();
    sm.clear();
    for (const f of this.flames) {
      const k = f.t / f.life;
      const x = Math.round(f.x);
      const y = Math.round(f.y);
      if (k > SMOKE_AT) {
        const a = 0.45 * (1 - (k - SMOKE_AT) / (1 - SMOKE_AT));
        const r = 3 + Math.round(k * 3);
        sm.fillStyle(E32.darkbrown, a);
        sm.fillRect(x - (r >> 1), y - (r >> 1), r, r);
        continue;
      }
      // 하얀 심지 → 노랑 → 주황 → 빨강
      const col = k < 0.12 ? E32.white : k < 0.3 ? E32.yellow : k < 0.48 ? E32.amber : k < 0.62 ? E32.orange : E32.rust;
      const size = Math.max(1, Math.round(2 + Math.sin(Math.PI * Math.min(1, k / SMOKE_AT)) * 4));
      g.fillStyle(col, 0.9);
      g.fillRect(x - (size >> 1), y - (size >> 1), size, size);
    }
  }

  emitLights(): void {
    if (!this.firing) return;
    const n = this.nozzle();
    const L = this.s.lighting;
    L.add(n.x, n.y, 50, E32.orange, 0.9);
    L.add(n.x + Math.cos(n.a) * 35, n.y + Math.sin(n.a) * 30, 70, E32.amber, 0.7);
  }
}
