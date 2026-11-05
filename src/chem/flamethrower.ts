import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { DEPTH } from '../config';
import { E32 } from '../art/palette';
import { playSfx } from '../audio/sfx';
import breathUrl from '../../art/fx/breath.png?url';

/**
 * 화염방사기 → 드래곤 브레스: 좌클릭 한 번에 불줄기를 한 번 뿜고, 쿨타임 동안 다시 못 쏜다. 불씨 역할만 하고 직접 피해는 없다.
 * 그림은 art/fx/breath.aseprite (오른쪽을 보는 88×28 10프레임) → art/fx/breath.png 가로 시트.
 * 판정은 눈에 보이는 그대로: 그 프레임에서 뜨거운 색(흰·노랑·호박·주황) 픽셀이 닿은 수소 구름에 불이 붙고, 불줄기는 벽에서 잘린다.
 */
export const BREATH_CD = 1.5;
const KEY = 'breath';
const FW = 88;
const FH = 28;
/** 노즐 = 그림 왼쪽 끝, 위에서 16px (불줄기 가운데 줄) */
const NOZZLE_Y = 16;
/** 프레임 길이 (aseprite와 같게) */
const DURS = [0.04, 0.05, 0.05, 0.06, 0.06, 0.07, 0.08, 0.1, 0.1, 0.1];
const ENDS = DURS.map((_, i) => DURS.slice(0, i + 1).reduce((a, b) => a + b, 0));
const TOTAL = ENDS[ENDS.length - 1];
/** 1~5프레임은 노즐에 붙어 있는 분출 → 그동안은 손을 따라가고 시전 자세 유지. 그 뒤로는 떨어져 나가 그 자리에서 식는다 */
const ATTACHED = ENDS[4];
/** 마지막 이만큼은 서서히 투명하게 */
const FADE = 0.2;

interface FrameInfo {
  /** 뜨거운 픽셀 (2px 간격으로 추림), 노즐 기준 좌표 */
  hot: { x: number; y: number }[];
  /** 뜨거운 부분의 가운데와 크기 (조명용) */
  cx: number;
  cy: number;
  heat: number;
  /** 가장 멀리 뻗은 픽셀 */
  reach: number;
}

export function preloadBreath(scene: Phaser.Scene): void {
  scene.load.spritesheet(KEY, breathUrl, { frameWidth: FW, frameHeight: FH });
}

/** 시트에서 프레임마다 뜨거운 픽셀을 읽어 둔다 (판정·조명용) */
function readFrames(scene: Phaser.Scene): FrameInfo[] {
  const img = scene.textures.get(KEY).getSourceImage() as HTMLImageElement;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  return DURS.map((_, f) => {
    const hot: { x: number; y: number }[] = [];
    let sx = 0;
    let sy = 0;
    let n = 0;
    let reach = 0;
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const o = (y * cv.width + f * FW + x) * 4;
        if (d[o + 3] < 200) continue;
        // 흰 ffffff · 노랑 fee761 · 호박 feae34 · 주황 f77622 만 뜨겁다 (녹슨 빨강 be4a2f 아래는 식은 불)
        if (d[o] < 0xf0 || d[o + 1] < 0x70) continue;
        sx += x;
        sy += y;
        n++;
        reach = Math.max(reach, x + 1);
        if (x % 2 === 0 && y % 2 === 0) hot.push({ x: x + 0.5, y: y + 0.5 - NOZZLE_Y });
      }
    }
    return { hot, cx: n ? sx / n : 0, cy: n ? sy / n - NOZZLE_Y : 0, heat: n, reach };
  });
}

export class Flamethrower {
  /** 남은 쿨타임 (초) — UI가 읽음 */
  cd = 0;
  private t = TOTAL;
  private angle = 0;
  private flip = false;
  private ox = 0;
  private oy = 0;
  /** 벽에 막히기 전까지 뻗을 수 있는 거리 */
  private reach = FW;
  private wasDown = false;
  private readonly frames: FrameInfo[];
  private readonly sprite: Phaser.GameObjects.Sprite | null;

  constructor(private readonly s: RoomScene) {
    const ok = s.textures.exists(KEY);
    this.frames = ok ? readFrames(s) : [];
    this.sprite = ok ? s.add.sprite(0, 0, KEY, 0).setDepth(DEPTH.vfx - 1).setVisible(false) : null;
  }

  get active(): boolean {
    return this.t < TOTAL;
  }

  /** 불이 나오는 곳 (손 높이) */
  private nozzle() {
    const p = this.s.player;
    const a = p.aimAngle;
    return { x: p.x + Math.cos(a) * 9, y: p.y - 9 + Math.sin(a) * 6 };
  }

  private frameAt(t: number): number {
    const i = ENDS.findIndex((e) => t < e);
    return i < 0 ? DURS.length - 1 : i;
  }

  /** 노즐 기준 좌표 → 월드 (아래 반쪽은 왼쪽을 볼 때 뒤집혀서 불이 늘 위로 피어오름) */
  private toWorld(x: number, y: number): { x: number; y: number } {
    const c = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    const ly = this.flip ? -y : y;
    return { x: this.ox + c * x - sn * ly, y: this.oy + sn * x + c * ly };
  }

  /** 노즐에서 조준 방향으로 벽까지 거리 (불은 손 높이로 날아가니 바로 아래 바닥이 벽이면 막힘) */
  private measureReach(): number {
    const c = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    for (let d = 2; d < FW; d += 2) {
      if (this.s.terrain.isWallAt(this.ox + c * d, this.oy + sn * d + 9)) return d;
    }
    return FW;
  }

  private fire(): void {
    const p = this.s.player;
    this.angle = p.aimAngle;
    this.flip = Math.cos(this.angle) < 0;
    const n = this.nozzle();
    this.ox = n.x;
    this.oy = n.y;
    this.t = 0;
    this.cd = BREATH_CD;
    p.firePose();
    playSfx('breath');
  }

  update(dt: number): void {
    const s = this.s;
    const p = s.player;
    this.cd = Math.max(0, this.cd - dt);
    const down = s.input.activePointer.leftButtonDown();
    const pressed = down && !this.wasDown;
    this.wasDown = down;
    if (pressed && this.cd <= 0 && !p.dead && !p.inputLocked && !p.rolling && s.combatEnabled) this.fire();

    if (!this.active) return;
    this.t += dt;
    if (!this.active) {
      this.sprite?.setVisible(false);
      return;
    }
    // 분출 중엔 손을 따라감 (방향은 쏜 순간 그대로)
    if (this.t < ATTACHED && !p.dead) {
      const n = this.nozzle();
      this.ox = n.x;
      this.oy = n.y;
      if (!p.rolling) p.firePose();
    }
    this.reach = this.measureReach();

    const fi = this.frameAt(this.t);
    const fr = this.frames[fi];
    if (!fr) return;
    for (const h of fr.hot) {
      if (h.x > this.reach) continue;
      const w = this.toWorld(h.x, h.y);
      s.chem.igniteAt(w.x, w.y);
    }
    // 벽에 부딪힌 불길은 튀어 흩어짐
    if (fr.heat > 0 && fr.reach > this.reach && Math.random() < 0.6) {
      const w = this.toWorld(this.reach, (Math.random() - 0.5) * 8);
      s.vfx.spark(w.x, w.y + 9, Math.random() < 0.5 ? E32.orange : E32.amber, 1, 40, 30);
    }
  }

  draw(): void {
    const sp = this.sprite;
    if (!sp) return;
    if (!this.active) {
      sp.setVisible(false);
      return;
    }
    const fi = this.frameAt(this.t);
    sp.setVisible(true)
      .setFrame(fi)
      .setPosition(Math.round(this.ox), Math.round(this.oy))
      .setOrigin(0, (this.flip ? FH - NOZZLE_Y : NOZZLE_Y) / FH)
      .setFlipY(this.flip)
      .setRotation(this.angle)
      .setAlpha(Phaser.Math.Clamp((TOTAL - this.t) / FADE, 0, 1));
    if (this.reach < FW) sp.setCrop(0, 0, Math.ceil(this.reach) + 1, FH);
    else sp.setCrop();
  }

  emitLights(): void {
    if (!this.active) return;
    const fr = this.frames[this.frameAt(this.t)];
    if (!fr || fr.heat === 0) return;
    const L = this.s.lighting;
    const k = Math.min(1, fr.heat / 300);
    const c = this.toWorld(Math.min(fr.cx, this.reach), fr.cy);
    L.add(c.x, c.y, 50 + 50 * k, E32.amber, 0.5 + 0.4 * k);
    if (this.t < ATTACHED) L.add(this.ox, this.oy, 40, E32.orange, 0.8);
  }
}
