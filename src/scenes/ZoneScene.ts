import Phaser from 'phaser';
import { FONT_S, FONT_M, FONT_L } from '../config';
import { E32, toCss } from '../art/palette';
import { playSfx } from '../audio/sfx';
import { addStars, drawPlanet, putColor, surfaceColor } from '../art/planet';
import DUST_URL from '../../art/zone/purple_dust_plain.png?url';

const PLANET = { x: 240, y: 146, r: 96 };
/** 처음에 열려 있는 정착지 (나머지는 잠김) */
const OPEN_NAME = '보라 먼지 평원';
/** 열린 구역을 누르면 행성은 왼쪽(x)으로 가고, 오른쪽에 설명 창이 들어온다 */
const PLANET_LEFT = 132;
const PANEL = { x: 252, y: 8, w: 218, h: 254 };
const OPEN_DESC = '바람이 잦고 메마른 평원, 고운 보라 먼지가 물결처럼 쌓여 있다. 낮에는 따뜻하고 밤에는 얼어붙을 만큼 춥고 건조하다.';
/** 아직 발견 전이라 ? 칸만: [제목, 칸 수] */
const UNKNOWN_ROWS: [string, number][] = [['획득 가능 물질', 3], ['출현 적', 3]];
/** 열린 구역에 붙이는 그림의 배율: 구역 가운데 접평면 거리 1 = 72px (오각형이 64px 그림 안에 들어감) */
const DECAL_SCALE = 72;
/** 그림 색을 한 단계 어둡게 (ENDESGA 32 안에서, 그림에 쓴 색만) */
const DARKER = new Map<number, number>([
  [E32.white, E32.silver], [E32.silver, E32.steel], [E32.steel, E32.slate], [E32.slate, E32.indigo], [E32.indigo, E32.night], [E32.night, E32.black],
  [E32.pink, E32.magenta], [E32.magenta, E32.plum], [E32.plum, E32.darkbrown], [E32.darkbrown, E32.black],
]);
/** 구역 경계선 굵기 (가까운 두 구역 가운데와의 내적 차이) — 반지름 96px에서 약 1~2px */
const EDGE = 0.0045;

/** 축구공 모양 32구역의 가운데 방향: 오각형 12개(정이십면체 꼭짓점) + 육각형 20개(정이십면체 면 가운데) */
const ZONES: number[][] = (() => {
  const p = (1 + Math.sqrt(5)) / 2;
  const unit = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return v.map((x) => x / l);
  };
  const ico: number[][] = [];
  for (const a of [-1, 1]) for (const b of [-p, p]) ico.push([0, a, b], [a, b, 0], [b, 0, a]);
  const out = ico.map(unit);
  // 이웃 꼭짓점끼리 거리는 2
  const near = (u: number[], v: number[]) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) < 2.1;
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++)
        if (near(ico[i], ico[j]) && near(ico[j], ico[k]) && near(ico[i], ico[k])) out.push(unit([0, 1, 2].map((c) => ico[i][c] + ico[j][c] + ico[k][c])));
  console.assert(out.length === 32, `구역이 32개가 아님: ${out.length}`);
  return out;
})();

/** 잠긴 구역 가운데에 찍는 자물쇠 */
const LOCK = ['.###.', '.#.#.', '#####', '##o##', '##o##', '#####'];
const STAMP_COLOR: Record<string, number> = { '#': E32.steel, o: E32.black };

/** 3×3 행렬 곱 (행 우선) */
const mul = (a: number[], b: number[]) =>
  [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));

/** 첫 정착지 고르기: 마우스로 돌리는 행성, 32구역 중 하나만 열림 */
export class ZoneScene extends Phaser.Scene {
  private planet!: Phaser.Textures.CanvasTexture;
  private img!: ImageData;
  /** 행성 좌표 → 화면 좌표 회전 (z는 나를 향함) */
  private m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private open = 0;
  private hover = -1;
  private dirty = true;
  private lastDraw = -1e9;
  private done = false;
  private label!: Phaser.GameObjects.Text;
  private planetImg!: Phaser.GameObjects.Image;
  /** 행성을 따라 좌우로 움직이는 글자들 (제목, 구역 이름, 도움말) */
  private follow: Phaser.GameObjects.Text[] = [];
  private panelBox!: Phaser.GameObjects.Container;
  private panelOpen = false;
  private tip!: Phaser.GameObjects.Text;
  /** 열린 구역 그림의 픽셀과, 그 구역 가운데의 동쪽·북쪽 방향 */
  private decal!: ImageData;
  private east = [1, 0, 0];
  private north = [0, 1, 0];

  constructor() {
    super('Zones');
  }

  preload(): void {
    this.load.image('zone_dust', DUST_URL);
  }

  create(): void {
    // Phaser는 장면 객체를 다시 쓰므로, 다시 들어올 때 지난 회전·선택이 남지 않게
    this.m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.hover = -1;
    this.done = false;
    this.panelOpen = false;
    addStars(this);
    const size = PLANET.r * 2 + 3;
    if (this.textures.exists('zones')) this.textures.remove('zones');
    this.planet = this.textures.createCanvas('zones', size, size)!;
    this.img = this.planet.getContext().createImageData(size, size);
    this.planetImg = this.add.image(PLANET.x, PLANET.y, 'zones');

    // 처음엔 살짝 기울여 보여 주고, 그때 가장 앞에 있는 구역을 연다
    this.rotate(0.3, 0.4);
    let best = -2;
    ZONES.forEach((c, i) => {
      const z = this.m[6] * c[0] + this.m[7] * c[1] + this.m[8] * c[2];
      if (z > best) [best, this.open] = [z, i];
    });
    // 그림은 행성의 북쪽이 위로 오게 붙인다
    const [cx, cy, cz] = ZONES[this.open];
    const el = Math.hypot(cz, cx);
    this.east = [cz / el, 0, -cx / el];
    this.north = [cy * this.east[2] - cz * this.east[1], cz * this.east[0] - cx * this.east[2], cx * this.east[1] - cy * this.east[0]];
    const src = this.textures.get('zone_dust').getSourceImage() as HTMLImageElement;
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    this.decal = ctx.getImageData(0, 0, cv.width, cv.height);

    const w = this.scale.width;
    this.label = this.add.text(w / 2, 30, '', { fontFamily: FONT_M, fontSize: '10px' }).setOrigin(0.5, 0);
    this.follow = [
      this.add.text(w / 2, 10, '첫 정착지를 고르세요', { fontFamily: FONT_L, fontSize: '12px', color: toCss(E32.white) }).setOrigin(0.5, 0).setShadow(1, 1, toCss(E32.black), 0, false, true),
      this.label,
      this.add.text(w / 2, 256, '드래그로 돌리기  ·  청록 테두리 구역을 클릭해서 정착', { fontFamily: FONT_S, fontSize: '8px', color: toCss(E32.slate) }).setOrigin(0.5, 0),
    ];
    this.makePanel();

    // 누르고 3px 넘게 움직이면 돌리기, 아니면 클릭
    let down: { x: number; y: number } | null = null;
    let dragged = false;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      down = { x: p.x, y: p.y };
      dragged = false;
      this.setHover(this.zoneAt(p.x, p.y)); // 터치처럼 움직임 없이 누를 때도
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (down && p.isDown) {
        if (!dragged && Math.hypot(p.x - down.x, p.y - down.y) > 3) dragged = true;
        if (dragged) {
          this.rotate((p.x - down.x) / PLANET.r, (p.y - down.y) / PLANET.r);
          down = { x: p.x, y: p.y };
        }
      }
      this.setHover(this.zoneAt(p.x, p.y));
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (down && !dragged) this.pick(this.zoneAt(p.x, p.y));
      down = null;
    });
    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      const s = 0.15;
      if (k === 'arrowleft' || k === 'a') this.rotate(-s, 0);
      else if (k === 'arrowright' || k === 'd') this.rotate(s, 0);
      else if (k === 'arrowup' || k === 'w') this.rotate(0, -s);
      else if (k === 'arrowdown' || k === 's') this.rotate(0, s);
      else if (k === 'enter' || k === ' ' || k === 'e') {
        if (this.panelOpen) this.settle();
        else this.pick(this.open);
      }
      else if (k === 'escape') this.showPanel(false);
    });
  }

  /** 오른쪽 설명 창: 이름, 구역 그림, 설명, ? 칸들, 취소·정착 (처음엔 화면 오른쪽 밖) */
  private makePanel() {
    const { x, y, w, h } = PANEL;
    const c = (this.panelBox = this.add.container(this.scale.width - x, 0));
    const left = x + 10, inner = w - 20;
    const g = this.add.graphics();
    g.fillStyle(E32.black, 0.92).fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(E32.night, 0.96).fillRect(x, y, w, h);
    g.lineStyle(1, E32.slate).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    c.add(g);
    c.add(this.add.text(left, y + 9, OPEN_NAME, { fontFamily: FONT_L, fontSize: '12px', color: toCss(E32.white) }).setShadow(1, 1, toCss(E32.black), 0, false, true));
    // 구역 그림(64×64)의 가운데 띠 64×20을 3배로 → 직사각형
    const tex = this.textures.get('zone_dust');
    if (!tex.has('strip')) tex.add('strip', 0, 0, 22, 64, 20);
    const px = left + (inner - 192) / 2, py = y + 30;
    g.fillStyle(E32.slate).fillRect(px - 1, py - 1, 194, 62);
    c.add(this.add.image(px, py, 'zone_dust', 'strip').setOrigin(0).setScale(3));
    const desc = this.add.text(left, py + 68, OPEN_DESC, { fontFamily: FONT_M, fontSize: '10px', color: toCss(E32.silver), lineSpacing: 3, wordWrap: { width: inner } });
    c.add(desc);
    let ry = desc.y + desc.height + 10;
    for (const [name, n] of UNKNOWN_ROWS) {
      c.add(this.add.text(left, ry + 4, name, { fontFamily: FONT_S, fontSize: '8px', color: toCss(E32.steel) }));
      for (let i = 0; i < n; i++) this.unknownBox(c, left + 70 + i * 22, ry);
      ry += 24;
    }
    const by = y + h - 28;
    this.button(c, left, by, 90, '취소', E32.steel, () => this.showPanel(false));
    this.button(c, left + inner - 90, by, 90, '정착', E32.cyan, () => this.settle());
    this.tip = this.add.text(0, 0, '발견되지 않음', { fontFamily: FONT_S, fontSize: '8px', color: toCss(E32.silver), backgroundColor: toCss(E32.black), padding: { x: 3, y: 2 } }).setOrigin(0.5, 1).setDepth(10).setVisible(false);
  }

  /** 아직 모르는 칸: ?, 마우스를 올리면 "발견되지 않음" */
  private unknownBox(c: Phaser.GameObjects.Container, bx: number, by: number) {
    const g = this.add.graphics();
    const draw = (hover: boolean) => g.clear().fillStyle(E32.black).fillRect(bx, by, 16, 16).lineStyle(1, hover ? E32.silver : E32.slate).strokeRect(bx + 0.5, by + 0.5, 15, 15);
    draw(false);
    const z = this.add.zone(bx, by, 16, 16).setOrigin(0).setInteractive();
    z.on('pointerover', () => {
      draw(true);
      this.tip.setPosition(c.x + bx + 8, by - 2).setVisible(true);
    });
    z.on('pointerout', () => {
      draw(false);
      this.tip.setVisible(false);
    });
    c.add([g, this.add.text(bx + 8, by + 8, '?', { fontFamily: FONT_M, fontSize: '10px', color: toCss(E32.steel) }).setOrigin(0.5), z]);
  }

  private button(c: Phaser.GameObjects.Container, bx: number, by: number, bw: number, label: string, color: number, onClick: () => void) {
    const g = this.add.graphics();
    const draw = (hover: boolean) => g.clear().fillStyle(E32.black).fillRect(bx - 1, by - 1, bw + 2, 20).fillStyle(hover ? E32.indigo : E32.night).fillRect(bx, by, bw, 18).lineStyle(1, color).strokeRect(bx + 0.5, by + 0.5, bw - 1, 17);
    draw(false);
    const z = this.add.zone(bx, by, bw, 18).setOrigin(0).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => {
      draw(true);
      playSfx('hover');
    });
    z.on('pointerout', () => draw(false));
    z.on('pointerup', onClick);
    c.add([g, this.add.text(bx + bw / 2, by + 9, label, { fontFamily: FONT_S, fontSize: '8px', color: toCss(color) }).setOrigin(0.5), z]);
  }

  /** 창 열기: 행성과 글자는 왼쪽으로, 창은 오른쪽에서 들어옴. 닫기는 반대로 */
  private showPanel(open: boolean) {
    if (this.panelOpen === open || this.done) return;
    this.panelOpen = open;
    playSfx('select');
    this.tip.setVisible(false);
    const movers = [this.planetImg, ...this.follow];
    this.tweens.killTweensOf([...movers, this.panelBox]);
    this.tweens.add({ targets: movers, x: open ? PLANET_LEFT : PLANET.x, duration: 350, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: this.panelBox, x: open ? 0 : this.scale.width - PANEL.x, duration: 350, ease: 'Cubic.easeOut' });
  }

  private settle() {
    if (this.done) return;
    this.done = true;
    playSfx('select');
    this.scene.start('Room', { zone: 'dust' });
    this.scene.launch('UI');
  }

  /** 화면 기준으로 돌린다: a는 좌우(세로축), b는 위아래(가로축), 라디안 */
  private rotate(a: number, b: number) {
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const ry = [ca, 0, sa, 0, 1, 0, -sa, 0, ca];
    const rx = [1, 0, 0, 0, cb, -sb, 0, sb, cb];
    this.m = mul(ry, mul(rx, this.m));
    this.dirty = true;
  }

  /** 화면 쪽 단위 벡터 → 행성 표면 좌표 (m의 전치) */
  private toSurface(vx: number, vy: number, vz: number) {
    const m = this.m;
    return [m[0] * vx + m[3] * vy + m[6] * vz, m[1] * vx + m[4] * vy + m[7] * vz, m[2] * vx + m[5] * vy + m[8] * vz];
  }

  /** 화면 좌표의 구역 번호 (행성 밖이면 -1) */
  private zoneAt(x: number, y: number) {
    const vx = (x - this.planetImg.x) / PLANET.r, vy = -(y - PLANET.y) / PLANET.r;
    const d2 = vx * vx + vy * vy;
    if (d2 > 1) return -1;
    const [px, py, pz] = this.toSurface(vx, vy, Math.sqrt(1 - d2));
    let best = -2, idx = -1;
    ZONES.forEach((c, i) => {
      const q = c[0] * px + c[1] * py + c[2] * pz;
      if (q > best) [best, idx] = [q, i];
    });
    return idx;
  }

  private setHover(i: number) {
    if (i === this.hover) return;
    this.hover = i;
    this.dirty = true;
    if (i === this.open) {
      playSfx('hover');
      this.label.setText(`${OPEN_NAME}  ·  클릭해서 정착`).setColor(toCss(E32.cyan));
    } else this.label.setText(i < 0 ? '' : '잠긴 구역').setColor(toCss(E32.steel));
  }

  private pick(i: number) {
    if (this.done || i < 0) return;
    if (i !== this.open) {
      this.label.setText('아직 갈 수 없는 구역이에요').setColor(toCss(E32.steel));
      return;
    }
    this.showPanel(true);
  }

  update(time: number): void {
    // 한 장 그리는 데 10ms 넘게 걸려서, 돌리는 중에도 30fps로만 다시 그린다
    if (!this.dirty || time - this.lastDraw < 33) return;
    this.lastDraw = time;
    this.dirty = false;
    const { open, hover, east, north } = this;
    const data = this.img.data, size = this.img.width, r = PLANET.r;
    const { data: dd, width: dw, height: dh } = this.decal;
    drawPlanet(data, size, r, (vx, vy, vz, lv) => {
      const [x, y, z] = this.toSurface(vx, vy, vz);
      let b1 = -2, b2 = -2, i1 = 0, i2 = 0;
      for (let i = 0; i < ZONES.length; i++) {
        const c = ZONES[i], q = c[0] * x + c[1] * y + c[2] * z;
        if (q > b1) [b2, i2, b1, i1] = [b1, i1, q, i];
        else if (q > b2) [b2, i2] = [q, i];
      }
      if (b1 - b2 < EDGE) return i1 === open || i2 === open ? E32.cyan : i1 === hover || i2 === hover ? E32.silver : E32.black;
      if (i1 === open) {
        // 열린 구역: 구역 가운데의 접평면에 그림을 비춰서 곡면을 따라 붙인다 (구름 없이 땅이 보임)
        const ix = Math.floor(dw / 2 + ((x * east[0] + y * east[1] + z * east[2]) / b1) * DECAL_SCALE);
        const iy = Math.floor(dh / 2 - ((x * north[0] + y * north[1] + z * north[2]) / b1) * DECAL_SCALE);
        const k = (Math.min(dh - 1, Math.max(0, iy)) * dw + Math.min(dw - 1, Math.max(0, ix))) * 4;
        let col = (dd[k] << 16) | (dd[k + 1] << 8) | dd[k + 2];
        // 밝기 2 이상은 그대로, 밤 쪽으로 갈수록 한 단계씩 어둡게
        for (let s = lv; s < 2; s++) col = DARKER.get(col) ?? col;
        return col;
      }
      // 잠긴 구역은 한 단계 어둡게 (마우스를 올리면 원래 밝기)
      return surfaceColor(x, y, z, x, z, i1 === open || i1 === hover ? lv : Math.max(0, lv - 1));
    });
    // 앞쪽을 보는 잠긴 구역 가운데에 자물쇠
    const c = size >> 1;
    const m = this.m;
    ZONES.forEach((p, i) => {
      const vz = m[6] * p[0] + m[7] * p[1] + m[8] * p[2];
      if (vz < 0.3 || i === open) return;
      const rows = LOCK;
      const x0 = c + Math.round((m[0] * p[0] + m[1] * p[1] + m[2] * p[2]) * r) - (rows[0].length >> 1);
      const y0 = c - Math.round((m[3] * p[0] + m[4] * p[1] + m[5] * p[2]) * r) - (rows.length >> 1);
      rows.forEach((row, j) =>
        [...row].forEach((ch, k) => {
          if (STAMP_COLOR[ch] !== undefined) putColor(data, ((y0 + j) * size + x0 + k) * 4, STAMP_COLOR[ch]);
        }),
      );
    });
    this.planet.getContext().putImageData(this.img, 0, 0);
    this.planet.refresh();
  }
}
