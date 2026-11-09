import Phaser from 'phaser';
import { DEPTH } from '../config';
import { E32 } from './palette';

/**
 * 보라 먼지 평원의 날씨. 장식만이고 게임 규칙(기체·캐릭터)엔 영향 없음.
 * - 늘: 바람에 날리는 먼지 알갱이, 바닥에서 반짝이는 먼지
 * - 가끔 먼지바람: 몇 초 동안 바람이 세져서 알갱이가 빨라지고 바람 줄기가 휙휙 지나감 (먼지 구름 하나도 같이 일어남)
 * - 가끔 먼지 구름: 커다란 옅은 구름이 화면을 천천히 가로질러 감
 * 모두 카메라에 보이는 곳 둘레에서만 만든다.
 */
const WIND = { x: 1, y: 0.18 }; // 왼쪽에서 오른쪽으로, 살짝 아래로
const SPECKS = 70;
// 바닥(보라)보다 밝아야 보여서 빛 받은 먼지 색으로
const DUST_COLS = [E32.pink, E32.pink, E32.magenta, E32.silver];
const CLOUD_COLS = [E32.magenta, E32.pink, E32.magenta];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

interface Speck { x: number; y: number; v: number; ph: number; col: number }
interface Streak { x: number; y: number; len: number; v: number; life: number; max: number; col: number }
interface Puff { ox: number; oy: number; r: number; ph: number; col: number }
interface Cloud { x: number; y: number; v: number; age: number; puffs: Puff[] }
interface Glint { x: number; y: number; t: number }

export class DustWeather {
  private readonly g: Phaser.GameObjects.Graphics;
  /** 먼지 구름은 캐릭터·적이 가려지지 않게 바닥 바로 위 (위험 표시보다도 아래) */
  private readonly low: Phaser.GameObjects.Graphics;
  private readonly specks: Speck[] = [];
  private streaks: Streak[] = [];
  private clouds: Cloud[] = [];
  private glints: Glint[] = [];
  /** 지금 바람 세기 0~1 (먼지바람 때 1로 부드럽게 올라갔다 내려옴) */
  private gust = 0;
  private gustLeft = 0;
  /** 큰 모래바람 세기 0~1 (5일차): 화면이 뿌옇고 바람 줄기가 아주 많음 */
  private haze = 0;
  private stormLeft = 0;
  private nextGust = rnd(10, 20);
  private nextCloud = rnd(4, 10);
  private nextGlint = 0;
  private time = 0;

  constructor(private readonly scene: Phaser.Scene) {
    // 날리는 알갱이·바람 줄기는 캐릭터 위, 던진 병·조명 아래 (낮 조명은 같이 받음)
    this.g = scene.add.graphics().setDepth(DEPTH.projectile - 10);
    this.low = scene.add.graphics().setDepth(DEPTH.decal + 0.5);
    const v = scene.cameras.main.worldView;
    for (let i = 0; i < SPECKS; i++) this.specks.push({ x: v.x + rnd(0, v.width), y: v.y + rnd(0, v.height), v: rnd(0.6, 1.4), ph: rnd(0, 7), col: pick(DUST_COLS) });
  }

  update(dt: number): void {
    this.time += dt;
    const v = this.scene.cameras.main.worldView;

    this.nextGust -= dt;
    if (this.nextGust <= 0) {
      this.gustLeft = rnd(3.5, 5.5);
      this.nextGust = rnd(14, 26);
      this.spawnCloud(v);
    }
    this.gustLeft -= dt;
    this.stormLeft -= dt;
    this.gust += ((this.gustLeft > 0 ? 1 : 0) - this.gust) * Math.min(1, dt * 1.5);
    this.haze += ((this.stormLeft > 0 ? 1 : 0) - this.haze) * Math.min(1, dt * 1.2);
    const speed = 18 + this.gust * 150 + this.haze * 220;

    // 알갱이: 바람 따라 흐르다 보이는 곳 밖으로 나가면 반대쪽에서 다시
    for (const s of this.specks) {
      s.x += WIND.x * speed * s.v * dt;
      s.y += (WIND.y * speed * s.v + Math.sin(this.time * 2 + s.ph) * 6) * dt;
      if (s.x > v.right + 8 || s.x < v.x - 8 || s.y > v.bottom + 8 || s.y < v.y - 8) {
        s.x = v.x - rnd(0, 6);
        s.y = v.y + rnd(0, v.height);
        if (Math.random() < 0.3) [s.x, s.y] = [v.x + rnd(0, v.width), v.y - 4]; // 위쪽에서도 들어오게 (바람이 살짝 아래로 불어서)
      }
    }

    // 먼지바람 줄기
    for (let n = 1 + Math.round(this.haze * 4); n > 0; n--) {
      if (Math.random() >= this.gust * 50 * dt) continue;
      const max = rnd(0.35, 0.7);
      this.streaks.push({ x: v.x + rnd(-40, v.width), y: v.y + rnd(0, v.height), len: Math.round(rnd(10, 28)), v: rnd(260, 380), life: max, max, col: pick(DUST_COLS) });
    }
    for (const st of this.streaks) {
      st.x += WIND.x * st.v * dt;
      st.y += WIND.y * st.v * dt;
      st.life -= dt;
    }
    this.streaks = this.streaks.filter((st) => st.life > 0);

    // 먼지 구름
    this.nextCloud -= dt;
    if (this.nextCloud <= 0) {
      this.nextCloud = rnd(18, 35);
      this.spawnCloud(v);
    }
    for (const c of this.clouds) {
      c.age += dt;
      c.x += WIND.x * (c.v + this.gust * 90) * dt;
      c.y += WIND.y * (c.v + this.gust * 90) * dt;
    }
    // 보이는 곳에서 멀리 지나갔거나 너무 오래되면 지움
    this.clouds = this.clouds.filter((c) => c.age < 90 && c.x - 140 < v.right + 200 && Math.abs(c.y - v.centerY) < v.height + 300);

    // 바닥 반짝임
    this.nextGlint -= dt;
    if (this.nextGlint <= 0) {
      this.nextGlint = rnd(0.12, 0.4);
      this.glints.push({ x: Math.round(v.x + rnd(0, v.width)), y: Math.round(v.y + rnd(0, v.height)), t: 0 });
    }
    for (const gl of this.glints) gl.t += dt;
    this.glints = this.glints.filter((gl) => gl.t < 0.45);

    this.draw();
  }

  /** 큰 모래바람 (5일차 낮 시작): sec초 동안 아주 센 바람, 화면이 뿌옇게 */
  storm(sec: number): void {
    this.gustLeft = Math.max(this.gustLeft, sec);
    this.stormLeft = sec;
    const v = this.scene.cameras.main.worldView;
    for (let i = 0; i < 3; i++) this.spawnCloud(v);
  }

  /** 보이는 곳 왼쪽 밖에서 커다란 옅은 구름 (작은 구름 덩이 7~11개) */
  private spawnCloud(v: Phaser.Geom.Rectangle) {
    const puffs: Puff[] = [];
    const n = Math.floor(rnd(7, 12));
    for (let i = 0; i < n; i++) puffs.push({ ox: rnd(-70, 70), oy: rnd(-28, 28), r: rnd(14, 30), ph: rnd(0, 7), col: pick(CLOUD_COLS) });
    this.clouds.push({ x: v.x - 110, y: v.y + rnd(0.15, 0.85) * v.height, v: rnd(22, 36), age: 0, puffs });
  }

  private draw() {
    const g = this.g.clear();
    const low = this.low.clear();
    const t = this.time;
    for (const c of this.clouds) {
      const fade = Math.min(1, c.age / 2);
      for (const p of c.puffs) {
        const px = Math.round(c.x + p.ox + Math.sin(t * 0.7 + p.ph) * 4);
        const py = Math.round(c.y + p.oy + Math.cos(t * 0.6 + p.ph) * 3);
        const r = Math.round(p.r + Math.sin(t * 0.9 + p.ph) * 2);
        low.fillStyle(p.col, 0.14 * fade).fillCircle(px, py, r);
        low.fillStyle(p.col, 0.12 * fade).fillCircle(px - 2, py - 2, Math.max(2, r - 6));
      }
    }
    if (this.haze > 0.01) {
      const v = this.scene.cameras.main.worldView;
      g.fillStyle(E32.pink, 0.3 * this.haze).fillRect(v.x - 2, v.y - 2, v.width + 4, v.height + 4);
    }
    // 알갱이는 바람이 세면 옆으로 늘어남
    const len = 1 + Math.round(this.gust * 3);
    for (const s of this.specks) g.fillStyle(s.col, 0.9).fillRect(Math.round(s.x), Math.round(s.y), len, 1);
    for (const st of this.streaks) {
      const a = Math.sin((1 - st.life / st.max) * Math.PI) * 0.8; // 나타났다 사라짐
      g.fillStyle(st.col, a).fillRect(Math.round(st.x), Math.round(st.y), st.len, 1);
    }
    // 반짝임: 가운데 점 → 십자 → 점
    for (const gl of this.glints) {
      const k = gl.t / 0.45;
      g.fillStyle(k > 0.3 && k < 0.7 ? E32.white : E32.pink, 1).fillRect(gl.x, gl.y, 1, 1);
      if (k > 0.25 && k < 0.75) g.fillStyle(E32.pink, 0.8).fillRect(gl.x - 1, gl.y, 3, 1).fillRect(gl.x, gl.y - 1, 1, 3);
    }
  }
}
