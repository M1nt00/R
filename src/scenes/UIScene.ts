import Phaser from 'phaser';
import type { RoomScene, UiRequest } from './RoomScene';
import { FONT_S, FONT_M, FONT_L, VIEW_W, VIEW_H } from '../config';
import { ELEMENT_NAME, type Element } from '../element/types';
import { C, E32, toCss } from '../art/palette';
import { DATA, colorOf } from '../element/data';
import { ICON, type IconName } from '../art/propSprites';
import { BOONS, RELICS, REGION, getRun, type BoonDef, type RelicDef } from '../run/runState';
import { MASTERY_DESC, REACTION_NAME, reactionLevel } from '../run/mods';
import { META_DEF, buySecondary, buyStat, meta, primaryFor, saveMeta, secondaryStatus, statCost, statLevel } from '../run/meta';
import { playSfx, toggleMute } from '../audio/sfx';
import { BELTS, CHEM_COLOR, GAS_REAGENTS, LIQUID_REAGENTS, REAGENTS, formulaText, REAGENT_COLOR, THROW_CD, makeChemTextures, type ChemEvent, type ChemTerm, type Reagent } from '../chem/chemistry';
import { formulaLine, joinTerms, type FormulaPiece, type FormulaText } from '../chem/formula';
import { DAY_HOURS, NIGHT_AT, NIGHT_WARN_AT, OXY_GOAL, TOWER_MAX, TOWER_UPGRADES, upgradeCost, upgradeValue } from './dustZone';
import { TOWER_FLASH_SEC, TOWER_LOW, towerBlink, towerHpRamp } from '../entities/tower';
import { paintDustMinimap } from '../art/tileset';

/** 미니맵: 바닥 이만큼(px)이 미니맵 1px */
const MINIMAP_CELL = 20;

const W = VIEW_W;
const H = VIEW_H;
const SLOT = 24;
const GAP = 3;
const SLOT_X = 4;
const DARK = '#181425';
/** 3×5 픽셀 숫자 (핫바 개수·아래첨자): 가장 작은 글꼴(8px)보다 작게 */
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
/** 핫바 화학식 글자 4×7 (8px 글꼴 모양 그대로). 캔버스 글꼴은 반 칸씩 번져서 테두리가 뭉개지므로 직접 찍는다 */
const LETTERS: Record<string, string[]> = {
  H: ['#..#', '#..#', '#..#', '####', '#..#', '#..#', '#..#'],
  O: ['.##.', '#..#', '#..#', '#..#', '#..#', '#..#', '.##.'],
  N: ['#..#', '##.#', '##.#', '#.##', '#.##', '#..#', '#..#'],
  C: ['.###', '#...', '#...', '#...', '#...', '#...', '.###'],
  a: ['....', '....', '###.', '...#', '.###', '#..#', '.###'],
  l: ['#.', '#.', '#.', '#.', '#.', '#.', '.#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
};
/** 숫자 문자열의 켜진 픽셀 좌표 (글자 사이 1칸) */
const digitPixels = (str: string, x: number, y: number): [number, number][] =>
  [...str].flatMap((ch, k) => [...DIGITS[+ch]].flatMap((b, i) => (b === '1' ? [[x + k * 4 + (i % 3), y + Math.floor(i / 3)] as [number, number]] : [])));
/** 위 가운데 화학식 줄의 y */
const CHEM_Y = 36;
/** 산소화 막대 (시계 바로 아래): 안쪽 폭·높이·윗변 y */
const OXY_W = 64;
const OXY_H = 5;
const OXY_Y = 28;
/** HUD 산소탑 아이콘 (7×9): 돔 뚜껑, 청록 유리관, 받침 */
const TOWER_ICON = ['..sSs..', '.sSSSs.', '.scccs.', '.scwcs.', '.scccs.', '.scccs.', 'sSSSSSs', 'sSdddSs', 'sSSSSSs'];
const TOWER_ICON_COLOR: Record<string, number> = { s: E32.steel, S: E32.silver, c: E32.cyan, w: E32.white, d: E32.night };
/** 산소탑 창의 탭 */
const TOWER_TABS = ['산소', '업그레이드', '상점'] as const;
const DEV = new URLSearchParams(location.search).has('dev');

const reactionColor = (reaction: string): number => {
  const r = [...DATA.primary, ...DATA.stack].find((x) => x.id === reaction);
  if (r) return colorOf(r.color);
  return reaction === 'stack' ? E32.silver : E32.yellow;
};

/** HUD·오버레이 — 480×270 원본 해상도, 픽셀 폰트 설계 크기(8·10·12·24px)만 사용 */
export class UIScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  /** 미니맵 바탕 그림과 그 위 점들 (테두리는 g) */
  private mmImg!: Phaser.GameObjects.Image;
  private mmG!: Phaser.GameObjects.Graphics;
  private gs!: Phaser.GameObjects.Graphics;
  /** 핫바 그림 위에 그리는 작은 숫자 (개수·아래첨자) */
  private gt!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private slotLayer!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private overlay: Phaser.GameObjects.Container | null = null;
  private overlayKeys: ((k: string) => void) | null = null;
  private pausedRoom = false;
  private texts: Record<string, Phaser.GameObjects.Text> = {};
  private relicIcons: Phaser.GameObjects.Image[] = [];
  private chemLine: Phaser.GameObjects.Container | null = null;
  private chemRuns: FormulaText[] = [];
  /** 지금 떠 있는 반응식의 마지막 항 (다음 반응식이 그 자리에서 이어지게) */
  private chemTail: { key: string; abs: number }[] = [];
  /** 시약 슬롯 글자 (H₂처럼 아래 첨자가 있어서 화학식으로 그림) */
  /** 핫바 칸: 시험관(기체)·병(고체) 그림 + 그 앞의 원소 기호 */
  /** 시약 아이콘 (병 그림 + 화학식, 화학식은 칸 가운데). ox·oy = 칸 안 병 위치 */
  private reagentIcons = new Map<Reagent, { img: Phaser.GameObjects.Image; sym: Phaser.GameObjects.Image; ox: number; oy: number }>();
  /** 화면에 그리는 시약 줄, F로 바꿀 때 앞뒤 줄이 엇갈리는 진행도 (0 → 1) */
  private shownBelt = 0;
  private beltAnim = { k: 1 };
  private chemGen = 0;
  /** 골드·정수 아이콘 (산소탑이 있는 맵에서는 그 자리에 탑 HP) */
  private runIcons: Phaser.GameObjects.Image[] = [];
  private towerIcon!: Phaser.GameObjects.Image;
  /** 산소화 막대: 지난 프레임의 %, 1%가 오를 때 숫자가 번쩍이는 남은 시간(ms 시각) */
  private oxyShown = 0;
  private oxyFlashUntil = 0;

  constructor() {
    super('UI');
  }

  private room(): RoomScene | null {
    const r = this.scene.get('Room') as RoomScene | null;
    return r && r.player ? r : null;
  }

  /** size: 8 · 10 · 12 · 24 */
  /** 3×5 숫자를 (x, y) 왼쪽 위부터, 어두운 테두리 1px를 둘러서 */
  private tinyDigits(str: string, x: number, y: number, color: number, alpha: number): void {
    const g = this.gt;
    const px = digitPixels(str, x, y);
    g.fillStyle(E32.black, alpha);
    for (const [u, v] of px) g.fillRect(u - 1, v - 1, 3, 3);
    g.fillStyle(color, alpha);
    for (const [u, v] of px) g.fillRect(u, v, 1, 1);
  }

  /** 핫바 화학식 그림 (H₂, Na, H₂O …): 픽셀 글자 + 작은 숫자 아래첨자 (숫자는 바로 앞 글자 뒤에), 개수 숫자와 같은 1px 테두리 */
  private formulaTexture(rg: Reagent): string {
    const key = `slotf_${rg}`;
    if (this.textures.exists(key)) return key;
    const on: [number, number][] = [];
    let x = 1;
    for (const ch of formulaText(rg)) {
      if (/\d/.test(ch)) {
        // 아래첨자: 글자 오른쪽 1칸 띄우고, 바닥은 글자 바닥(7줄째)보다 1줄 아래
        on.push(...digitPixels(ch, x, 4));
        x += 4;
        continue;
      }
      LETTERS[ch].forEach((row, v) => [...row].forEach((b, u) => b === '#' && on.push([x + u, 1 + v])));
      x += LETTERS[ch][0].length + 1;
    }
    const w = Math.max(...on.map((q) => q[0])) + 2;
    const h = Math.max(...on.map((q) => q[1])) + 2;
    const tex = this.textures.createCanvas(key, w, h)!;
    const ctx = tex.getContext();
    ctx.fillStyle = DARK;
    for (const [u, v] of on) ctx.fillRect(u - 1, v - 1, 3, 3);
    ctx.fillStyle = toCss(REAGENT_COLOR[rg]);
    for (const [u, v] of on) ctx.fillRect(u, v, 1, 1);
    tex.refresh();
    return key;
  }

  private txt(x: number, y: number, s: string, size = 8, color = '#ffffff') {
    const family = size >= 12 ? FONT_L : size >= 10 ? FONT_M : FONT_S;
    return this.add
      .text(Math.round(x), Math.round(y), s, { fontFamily: family, fontSize: `${size}px`, color, lineSpacing: size >= 12 ? 4 : 3 })
      .setShadow(1, 1, DARK, 0, false, true);
  }

  private panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, border: number = E32.slate) {
    g.fillStyle(E32.black, 0.92);
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(E32.night, 0.96);
    g.fillRect(x, y, w, h);
    g.fillStyle(border, 1);
    g.fillRect(x, y, w, 1);
    g.fillRect(x, y + h - 1, w, 1);
    g.fillRect(x, y, 1, h);
    g.fillRect(x + w - 1, y, 1, h);
    g.fillStyle(E32.indigo, 1);
    g.fillRect(x + 1, y + 1, w - 2, 1);
  }

  /** 먼지 평원 미니맵 (오른쪽 위, 목표 글 아래): 움직일 수 있는 곳 16px = 1px. 산소탑·적·나만 보이고 광물은 안 보임 */
  /** 먼지 평원 미니맵 (오른쪽 위, 구역 이름 바로 아래): 바닥을 줄인 그림 위에 산소탑·적·나. 광물은 안 보임 */
  private drawMinimap(g: Phaser.GameObjects.Graphics, r: RoomScene): void {
    const b = r.physics.world.bounds;
    const mw = Math.round(b.width / MINIMAP_CELL);
    const mh = Math.round(b.height / MINIMAP_CELL);
    const mx = W - 5 - mw;
    const my = 19;
    const key = `minimap_dust_${mw}x${mh}`;
    if (!this.textures.exists(key)) paintDustMinimap(this, key, 'room_static', b.x, b.y, mw, mh, MINIMAP_CELL);
    this.mmImg.setTexture(key).setPosition(mx, my);
    // 테두리: 검은 바깥 1px + 회청 1px
    g.fillStyle(E32.black, 1).fillRect(mx - 2, my - 2, mw + 4, mh + 4);
    g.fillStyle(E32.slate, 1).fillRect(mx - 1, my - 1, mw + 2, mh + 2);
    // 점이 테두리에 걸리지 않게 가장자리 2px 안으로
    const at = (x: number, y: number) => [
      Phaser.Math.Clamp(Math.round(mx + ((x - b.x) / b.width) * (mw - 1)), mx + 2, mx + mw - 3),
      Phaser.Math.Clamp(Math.round(my + ((y - b.y) / b.height) * (mh - 1)), my + 2, my + mh - 3),
    ];
    g = this.mmG.clear();
    if (r.tank) {
      const [tx, ty] = at(r.tank.x, r.tank.y - 8);
      // 방금 맞았으면 1초 동안 빨갛게 깜빡
      const hurt = r.tank.sinceHit < 1 && Math.floor(this.time.now / 120) % 2 === 0;
      g.fillStyle(hurt ? E32.white : E32.black, 1).fillRect(tx - 2, ty - 2, 5, 5);
      g.fillStyle(hurt ? E32.red : E32.cyan, 1).fillRect(tx - 1, ty - 1, 3, 3);
    }
    for (const e of r.enemies) {
      if (e.dead) continue;
      const [ex, ey] = at(e.x, e.y);
      g.fillStyle(E32.black, 1).fillRect(ex - 2, ey - 2, 4, 4);
      g.fillStyle(E32.red, 1).fillRect(ex - 1, ey - 1, 2, 2);
    }
    const [px, py] = at(r.player.x, r.player.y);
    g.fillStyle(E32.black, 1).fillRect(px - 2, py - 2, 4, 4);
    g.fillStyle(E32.white, 1).fillRect(px - 1, py - 1, 2, 2);
  }

  private icon(x: number, y: number, name: IconName, scale = 1) {
    return this.add.image(Math.round(x), Math.round(y), 'icons', String(ICON[name])).setScale(scale);
  }

  create(): void {
    this.g = this.add.graphics();
    this.hud = this.add.container(0, 0);
    this.gs = this.add.graphics();
    this.slotLayer = this.add.container(0, 0);
    this.slotLayer.add(this.gs);
    const t = (k: string, x: number, y: number, size = 8, color = '#ffffff') => {
      this.texts[k] = this.txt(x, y, '', size, color);
      this.hud.add(this.texts[k]);
      return this.texts[k];
    };
    t('hp', 22, 4);
    t('gold', 16, 18, 8, toCss(C.gold0));
    t('essence', 52, 18, 8, toCss(E32.pink));
    t('room', W - 4, 3, 10).setOrigin(1, 0).setAlign('right');
    t('objective', W - 4, 22, 8, toCss(E32.silver)).setOrigin(1, 0).setAlign('right').setWordWrapWidth(170);
    t('hint', W - 4, H - 11, 8, toCss(E32.slate)).setOrigin(1, 0);
    t('build', 4, 0, 8, toCss(E32.silver));
    t('bossName', W / 2, 3, 10, toCss(C.fire0)).setOrigin(0.5, 0);
    t('bossShield', W / 2, 21, 8).setOrigin(0.5, 0);
    this.hud.add(this.icon(10, 8, 'heart'));
    this.runIcons = [this.icon(9, 23, 'gold'), this.icon(45, 23, 'essence')];
    this.hud.add(this.runIcons);
    t('towerHp', 22, 17);
    this.towerIcon = this.add.image(6, 17, this.towerIconTexture()).setOrigin(0);
    this.hud.add(this.towerIcon);
    makeChemTextures(this);
    for (const rg of REAGENTS) {
      // 기체 = 시험관, 액체 = 삼각 플라스크, 고체 = 병
      const gas = (GAS_REAGENTS as readonly Reagent[]).includes(rg);
      const liquid = LIQUID_REAGENTS.includes(rg);
      const img = this.add.image(0, 0, gas ? 'tube' : liquid ? 'erlen' : 'jar').setOrigin(0);
      const sym = this.add.image(0, 0, this.formulaTexture(rg)).setOrigin(0);
      this.slotLayer.add([img, sym]);
      this.reagentIcons.set(rg, { img, sym, ox: gas || liquid ? 4 : 5, oy: gas || liquid ? 3 : 4 });
    }
    // 칸 번호·개수는 그림 뒤에 추가해서 항상 앞에 보이게
    this.gt = this.add.graphics();
    this.slotLayer.add(this.gt);
    for (let i = 0; i < BELTS[0].length; i++) this.slotLayer.add(t(`rkey${i}`, 0, 0, 8, toCss(E32.steel)).setText(`${i + 1}`));
    // 먼지 평원 시계 (위 가운데)
    t('clockDay', W / 2 - 15, 8).setOrigin(1, 0);
    t('clockHour', W / 2 + 15, 8);
    t('oxyLabel', W / 2 - OXY_W / 2 - 5, OXY_Y - 2, 8, toCss(E32.silver)).setOrigin(1, 0).setText('산소화');
    t('oxyPct', W / 2 + OXY_W / 2 + 5, OXY_Y - 2);
    t('clockHint', W / 2, 38, 8, toCss(E32.steel)).setOrigin(0.5, 0);
    this.slotLayer.add(t('fkey', 0, 0, 8, toCss(E32.steel)).setText('F'));
    this.mmImg = this.add.image(0, 0, '__DEFAULT').setOrigin(0);
    this.mmG = this.add.graphics();
    this.hud.add([this.mmImg, this.mmG]);
    this.banner = this.txt(W / 2, 70, '', 12).setOrigin(0.5).setAlpha(0);

    this.game.events.on('banner', (text: string, color: number) => {
      this.banner.setText(text).setColor(toCss(color)).setAlpha(1);
      this.tweens.killTweensOf(this.banner);
      this.banner.setY(76);
      this.tweens.add({ targets: this.banner, y: 70, duration: 220, ease: 'Back.Out', onUpdate: () => this.banner.setY(Math.round(this.banner.y)) });
      this.tweens.add({ targets: this.banner, alpha: 0, delay: 1300, duration: 500 });
    });
    this.game.events.on('ui:open', (req: UiRequest) => this.handleRequest(req));
    this.game.events.on('roomEnter', () => this.refreshRelicIcons());
    this.game.events.on('chem', (ev: ChemEvent) => this.onChem(ev));

    const kb = this.input.keyboard!;
    kb.on('keydown', (ev: KeyboardEvent) => {
      if (this.overlayKeys) {
        this.overlayKeys(ev.key);
        return;
      }
      if (ev.key === 'h' || ev.key === 'H' || ev.key === 'Escape') this.openHelp();
    });
    kb.on('keydown-M', () => {
      const m = toggleMute();
      this.game.events.emit('banner', m ? '소리 끔' : '소리 켬', E32.silver);
    });
  }

  // ───────────────────────── 오버레이 공통 ─────────────────────────

  private openOverlay(build: (c: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics) => void, keys?: (k: string) => void, dim = 0.6) {
    this.closeOverlay(false);
    const c = this.add.container(0, 0);
    const g = this.add.graphics();
    g.fillStyle(E32.black, dim);
    g.fillRect(0, 0, W, H);
    c.add(g);
    build(c, g);
    this.overlay = c;
    this.overlayKeys = keys ?? null;
    if (this.room() && this.scene.isActive('Room')) {
      this.scene.pause('Room');
      this.pausedRoom = true;
    }
  }

  private closeOverlay(resume = true) {
    this.overlay?.destroy(true);
    this.overlay = null;
    this.overlayKeys = null;
    if (resume && this.pausedRoom) {
      this.scene.resume('Room');
      this.pausedRoom = false;
    }
  }

  private button(c: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, label: string, onClick: () => void, enabled = true, color: number = E32.yellow) {
    const g = this.add.graphics();
    const draw = (hover: boolean) => {
      g.clear();
      g.fillStyle(E32.black, 1);
      g.fillRect(x - 1, y - 1, w + 2, h + 2);
      g.fillStyle(enabled ? (hover ? E32.indigo : E32.night) : E32.black, 1);
      g.fillRect(x, y, w, h);
      g.fillStyle(enabled ? color : E32.indigo, 1);
      g.fillRect(x, y, w, 1);
      g.fillRect(x, y + h - 1, w, 1);
      g.fillRect(x, y, 1, h);
      g.fillRect(x + w - 1, y, 1, h);
    };
    draw(false);
    const t = this.txt(x + w / 2, y + h / 2, label, 8, enabled ? toCss(color) : toCss(E32.slate)).setOrigin(0.5);
    const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: enabled });
    if (enabled) {
      zone.on('pointerover', () => {
        draw(true);
        playSfx('hover');
      });
      zone.on('pointerout', () => draw(false));
      // 누를 때 닫으면 다시 돌아간 방이 아직 눌린 버튼을 불 뿜기로 받아서, 뗄 때 닫는다 (아래 두 곳도 같음)
      zone.on('pointerup', onClick);
    }
    c.add([g, t, zone]);
  }

  private handleRequest(req: UiRequest) {
    if (req.type === 'boons') this.openBoons(req.options, req.source);
    else if (req.type === 'relics') this.openRelics(req.options);
    else if (req.type === 'altar') this.openAltar();
    else if (req.type === 'tower') this.openTower(0, true);
    else this.openResult(req.victory, req.title);
  }

  // ───────────────────────── 반응 강화 3지선다 ─────────────────────────

  private card(c: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, col: number, onPick: () => void) {
    const g = this.add.graphics();
    const draw = (hover: boolean) => {
      g.clear();
      const yy = y - (hover ? 3 : 0);
      this.panel(g, x, yy, w, h, hover ? E32.white : col);
      g.fillStyle(col, 0.25);
      g.fillRect(x + 1, yy + 2, w - 2, 30);
    };
    draw(false);
    c.add(g);
    const zone = this.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      draw(true);
      playSfx('hover');
    });
    zone.on('pointerout', () => draw(false));
    zone.on('pointerup', onPick);
    return zone;
  }

  private openBoons(options: BoonDef[], source: 'reward' | 'shop') {
    const run = getRun();
    const pick = (b: BoonDef) => {
      this.closeOverlay();
      this.room()?.applyBoon(b.id, source);
    };
    this.openOverlay(
      (c) => {
        c.add(this.txt(W / 2, 22, '반응 강화 — 하나를 고르세요', 12, toCss(E32.yellow)).setOrigin(0.5));
        const cw = 130;
        const ch = 164;
        options.forEach((b, i) => {
          const x = Math.round(W / 2 - (cw * options.length + 10 * (options.length - 1)) / 2 + i * (cw + 10));
          const y = 40;
          const col = reactionColor(b.reaction);
          const lv = run?.boons[b.id] ?? 0;
          const zone = this.card(c, x, y, cw, ch, col, () => pick(b));
          const icons = this.reactionIcons(b.reaction);
          icons.forEach((n, k) => c.add(this.icon(x + cw / 2 + (k - (icons.length - 1) / 2) * 18, y + 17, n, 1)));
          c.add(this.txt(x + cw / 2, y + 38, b.name, 12, toCss(col)).setOrigin(0.5, 0));
          c.add(this.txt(x + cw / 2, y + 54, REACTION_NAME[b.reaction] ?? '', 8, toCss(E32.steel)).setOrigin(0.5, 0));
          c.add(this.txt(x + 8, y + 70, b.desc, 8, toCss(E32.white)).setWordWrapWidth(cw - 16));
          const before = reactionLevel(run, b.reaction);
          if (MASTERY_DESC[b.reaction] && before < 3 && before + 1 >= 3) {
            c.add(this.txt(x + 8, y + 104, '★ ' + MASTERY_DESC[b.reaction], 8, toCss(E32.yellow)).setWordWrapWidth(cw - 16));
          }
          c.add(this.txt(x + 8, y + ch - 14, `Lv ${lv} → ${lv + 1} (최대 ${b.max})`, 8, toCss(E32.silver)));
          c.add(this.txt(x + cw - 6, y + 4, `${i + 1}`, 8, toCss(E32.slate)).setOrigin(1, 0));
          c.bringToTop(zone);
        });
        this.button(c, W / 2 - 36, 220, 72, 16, '건너뛰기', () => {
          this.closeOverlay();
          this.room()?.skipReward(source);
        }, true, E32.steel);
      },
      (k) => {
        const n = Number(k);
        if (n >= 1 && n <= options.length) pick(options[n - 1]);
      },
    );
  }

  private reactionIcons(reaction: string): IconName[] {
    const p = DATA.primary.find((r) => r.id === reaction);
    if (p?.inputs) return p.inputs as IconName[];
    if (reaction === 'stack') return ['stack'];
    return ['common'];
  }

  // ───────────────────────── 유물 선택 ─────────────────────────

  private openRelics(options: RelicDef[]) {
    const pick = (r: RelicDef) => {
      this.closeOverlay();
      this.room()?.applyRelic(r.id);
    };
    this.openOverlay(
      (c) => {
        c.add(this.txt(W / 2, 22, '유물 — 하나를 고르세요', 12, toCss(C.water0)).setOrigin(0.5));
        const cw = 130;
        const ch = 140;
        options.forEach((r, i) => {
          const x = Math.round(W / 2 - (cw * options.length + 10 * (options.length - 1)) / 2 + i * (cw + 10));
          const y = 46;
          const zone = this.card(c, x, y, cw, ch, C.water1, () => pick(r));
          c.add(this.icon(x + cw / 2, y + 17, r.icon, 2));
          c.add(this.txt(x + cw / 2, y + 40, r.name, 12, toCss(C.water0)).setOrigin(0.5, 0));
          c.add(this.txt(x + 8, y + 60, r.desc, 8, toCss(E32.white)).setWordWrapWidth(cw - 16));
          c.add(this.txt(x + cw - 6, y + 4, `${i + 1}`, 8, toCss(E32.slate)).setOrigin(1, 0));
          c.bringToTop(zone);
        });
      },
      (k) => {
        const n = Number(k);
        if (n >= 1 && n <= options.length) pick(options[n - 1]);
      },
    );
  }

  // ───────────────────────── 성소 제단 (메타 성장) ─────────────────────────

  // ───────────────────────── 산소탑 ─────────────────────────

  /** HUD 산소탑 아이콘 그림 (어두운 테두리 1px) */
  private towerIconTexture(): string {
    const key = 'hud_tower';
    if (this.textures.exists(key)) return key;
    const tex = this.textures.createCanvas(key, TOWER_ICON[0].length + 2, TOWER_ICON.length + 2)!;
    const ctx = tex.getContext();
    const each = (fn: (ch: string, u: number, v: number) => void) => TOWER_ICON.forEach((row, v) => [...row].forEach((ch, u) => ch !== '.' && fn(ch, u, v)));
    ctx.fillStyle = DARK;
    each((_ch, u, v) => ctx.fillRect(u, v, 3, 3));
    each((ch, u, v) => {
      ctx.fillStyle = toCss(TOWER_ICON_COLOR[ch]);
      ctx.fillRect(u + 1, v + 1, 1, 1);
    });
    tex.refresh();
    return key;
  }

  /** 시계 아래 산소화 막대: "산소화 [████░░] 37%". 1%가 오를 때마다 숫자와 막대 끝이 잠깐 하얗게 */
  private drawOxygenation(g: Phaser.GameObjects.Graphics, oxy: number): void {
    const T = this.texts;
    const pct = Math.floor(oxy + 1e-6);
    const full = oxy >= OXY_GOAL;
    if (pct > this.oxyShown) this.oxyFlashUntil = this.time.now + 220;
    this.oxyShown = pct;
    const flash = this.time.now < this.oxyFlashUntil;
    const x = W / 2 - OXY_W / 2;
    const fw = Math.round((OXY_W * Math.min(oxy, OXY_GOAL)) / OXY_GOAL);
    g.fillStyle(E32.black, 1).fillRect(x - 2, OXY_Y - 2, OXY_W + 4, OXY_H + 4);
    g.fillStyle(full ? E32.lime : E32.slate, 1).fillRect(x - 1, OXY_Y - 1, OXY_W + 2, OXY_H + 2);
    g.fillStyle(E32.teal, 1).fillRect(x, OXY_Y, OXY_W, OXY_H);
    if (fw > 0) {
      g.fillStyle(full ? E32.lime : E32.cyan, 1).fillRect(x, OXY_Y, fw, OXY_H);
      g.fillStyle(E32.white, 1).fillRect(x, OXY_Y, fw, 1);
      g.fillStyle(full ? E32.green : E32.blue, 1).fillRect(x, OXY_Y + OXY_H - 1, fw, 1);
      // 막대 끝: 차오르는 자리가 밝게
      if (!full) g.fillStyle(E32.white, flash ? 1 : 0.6).fillRect(x + fw - 1, OXY_Y, 1, OXY_H);
    }
    // 1/4마다 눈금
    g.fillStyle(E32.black, 0.5);
    for (let k = 1; k < 4; k++) g.fillRect(x + (OXY_W * k) / 4, OXY_Y + 2, 1, OXY_H - 2);
    T.oxyLabel.setColor(toCss(full ? E32.lime : E32.silver));
    T.oxyPct.setText(`${pct}%`).setColor(toCss(flash ? E32.white : full ? E32.lime : E32.cyan));
  }

  /**
   * 산소탑 창. 위에 이름과 탑 HP, 그 아래 탭 셋 (1·2·3, ←→, 클릭):
   * 산소 = 모인 산소 받기 (E), 업그레이드 = 항목·단계 (비용 미정이라 틀만), 상점 = 빈 탭.
   * 수리는 업그레이드 목록이 아니라 머리의 탑 HP 옆 버튼.
   * fromWorld: 탑에서 E로 막 연 것 (그 E가 바로 받기로 이어지지 않게 잠깐 기다림)
   */
  private openTower(tab = 0, fromWorld = false) {
    const z = this.room()?.zone;
    const tk = this.room()?.tank;
    if (!z || !tk) return;
    const opened = fromWorld ? this.time.now : -1e9;
    const stored = z.towerO2;
    const max = TOWER_MAX;
    const take = () => {
      if (!stored) return playSfx('deny');
      this.closeOverlay();
      z.takeTowerO2();
    };
    const go = (n: number) => {
      if (n === tab) return;
      playSfx('select');
      this.openTower(n);
    };
    const pw = 284;
    const ph = 146;
    const px = Math.round((W - pw) / 2);
    const py = Math.round((H - ph) / 2) - 4;
    const tabW = 62;
    const tabY = py + 24;
    const bodyY = tabY + 15;
    this.openOverlay(
      (c, g) => {
        this.panel(g, px, py, pw, ph, E32.cyan);
        // 머리: 이름 + 탑 HP + 수리 (어느 탭에서나 보임)
        c.add(this.add.image(px + 8, py + 6, this.towerIconTexture()).setOrigin(0));
        c.add(this.txt(px + 21, py + 5, '산소탑', 12, toCss(E32.cyan)));
        // 수리 비용을 아직 안 정해서 꺼져 있고, ?dev 에서만 그냥 눌러 볼 수 있음
        const rw = 58;
        const rx = px + pw - 10 - rw;
        const hurt = tk.hp < tk.maxHp;
        this.button(c, rx, py + 6, rw, 13, !hurt ? '멀쩡해요' : DEV ? '개발: 수리' : '수리 미정', () => {
          const ok = z.repair();
          playSfx(ok ? 'buy' : 'deny');
          if (ok) this.openTower(tab);
        }, DEV && hurt, E32.cyan);
        const hw = 50;
        const hx = rx - 7 - hw;
        const [main, hi, lo] = towerHpRamp(tk.frac);
        const hf = tk.hp > 0 ? Math.max(1, Math.round(hw * tk.frac)) : 0;
        g.fillStyle(E32.black, 1).fillRect(hx - 2, py + 8, hw + 4, 9);
        g.fillStyle(E32.slate, 1).fillRect(hx - 1, py + 9, hw + 2, 7);
        g.fillStyle(E32.night, 1).fillRect(hx, py + 10, hw, 5);
        g.fillStyle(main, 1).fillRect(hx, py + 10, hf, 5);
        g.fillStyle(hi, 1).fillRect(hx, py + 10, hf, 1);
        g.fillStyle(lo, 1).fillRect(hx, py + 14, hf, 1);
        c.add(this.txt(hx - 5, py + 8, `HP ${Math.ceil(tk.hp)}/${tk.maxHp}`, 8, toCss(E32.silver)).setOrigin(1, 0));
        // 탭: 고른 탭은 청록 윗줄에 아래가 본문과 이어지고, 나머지는 어둡게
        g.fillStyle(E32.slate, 1).fillRect(px + 1, bodyY - 1, pw - 2, 1);
        TOWER_TABS.forEach((name, i) => {
          const x = px + 8 + i * (tabW + 2);
          const on = i === tab;
          const tg = this.add.graphics();
          const draw = (hover: boolean) => {
            tg.clear();
            tg.fillStyle(E32.slate, 1).fillRect(x, tabY, tabW, 14);
            tg.fillStyle(on ? E32.night : hover ? E32.indigo : E32.black, 1).fillRect(x + 1, tabY + 1, tabW - 2, on ? 14 : 13);
            if (on) tg.fillStyle(E32.cyan, 1).fillRect(x, tabY, tabW, 2);
          };
          draw(false);
          const label = this.txt(x + tabW / 2, tabY + 8, `${i + 1} ${name}`, 8, toCss(on ? E32.cyan : E32.steel)).setOrigin(0.5);
          const zone = this.add.zone(x, tabY, tabW, 14).setOrigin(0).setInteractive({ useHandCursor: !on });
          zone.on('pointerover', () => !on && (draw(true), playSfx('hover')));
          zone.on('pointerout', () => draw(false));
          zone.on('pointerup', () => go(i));
          c.add([tg, label, zone]);
        });
        if (tab === 0) this.towerOxygenTab(c, g, bodyY, stored, max, z.towerNext, z.value('make'));
        else if (tab === 1) this.towerUpgradeTab(c, px, pw, bodyY);
        else {
          c.add(this.txt(W / 2, bodyY + 30, '아직 들어온 물건이 없어요', 10, toCss(E32.steel)).setOrigin(0.5, 0));
          c.add(this.txt(W / 2, bodyY + 46, '상점은 준비 중이에요', 8, toCss(E32.slate)).setOrigin(0.5, 0));
        }
        // 바닥: 조작 안내 + 버튼
        const by = py + ph - 20;
        c.add(this.txt(px + 10, by + 3, '1·2·3 탭 바꾸기', 8, toCss(E32.slate)));
        if (tab === 0) this.button(c, px + pw - 138, by, 62, 14, '받기 E', take, stored > 0, E32.cyan);
        this.button(c, px + pw - 72, by, 62, 14, '닫기 Esc', () => this.closeOverlay(), true, E32.steel);
      },
      (k) => {
        const n = TOWER_TABS.length;
        if (k === 'Escape') this.closeOverlay();
        else if (k >= '1' && k <= String(n)) go(Number(k) - 1);
        else if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'ㅇ' || k === 'Tab') go((tab + 1) % n);
        else if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ㅁ') go((tab + n - 1) % n);
        // 탑을 연 그 E가 바로 받기로 이어지지 않게 잠깐 기다림
        else if (tab === 0 && (k === 'e' || k === 'E' || k === 'ㄷ') && this.time.now - opened > 150) take();
      },
      0.4,
    );
  }

  /** 산소 탭: 왼쪽에 모인 산소 칸(찬 칸은 O₂ 시험관), 오른쪽에 생산 속도와 다음 산소까지 막대 */
  private towerOxygenTab(c: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics, y0: number, stored: number, max: number, next: number, rate: number) {
    const SL = 24;
    const GAPX = 4;
    const slotsW = max * SL + (max - 1) * GAPX;
    const barW = 84;
    const x0 = Math.round(W / 2 - (slotsW + 12 + barW) / 2);
    const y = y0 + 26;
    c.add(this.txt(x0, y - 13, `모인 산소 ${stored}/${max}`, 8, toCss(E32.silver)));
    for (let k = 0; k < max; k++) {
      const x = x0 + k * (SL + GAPX);
      g.fillStyle(E32.black, 1);
      g.fillRect(x, y, SL, SL);
      g.fillStyle(k < stored ? E32.slate : E32.indigo, 1);
      g.fillRect(x, y, SL, 1);
      g.fillRect(x, y + SL - 1, SL, 1);
      g.fillRect(x, y, 1, SL);
      g.fillRect(x + SL - 1, y, 1, SL);
      c.add(this.add.image(x + 4, y + 3, 'tube').setOrigin(0).setAlpha(k < stored ? 1 : 0.2));
      if (k < stored) {
        const sym = this.add.image(0, 0, this.formulaTexture('O2')).setOrigin(0);
        c.add(sym.setPosition(x + 12 - (sym.width >> 1), y + 12 - (sym.height >> 1)));
      }
    }
    const bx = x0 + slotsW + 12;
    c.add(this.txt(bx, y - 13, '생산', 8, toCss(E32.steel)));
    c.add(this.txt(bx + barW, y - 13, `${rate}개/시간`, 8, toCss(E32.cyan)).setOrigin(1, 0));
    c.add(this.txt(bx, y + 1, '다음 산소', 8, toCss(E32.steel)));
    if (stored >= max) c.add(this.txt(bx, y + 13, '가득 찼어요', 8, toCss(E32.lime)));
    else {
      g.fillStyle(E32.black, 1).fillRect(bx - 1, y + 14, barW + 2, 6);
      g.fillStyle(E32.indigo, 1).fillRect(bx, y + 15, barW, 4);
      g.fillStyle(E32.cyan, 1).fillRect(bx, y + 15, Math.round(barW * Phaser.Math.Clamp(next, 0, 1)), 4);
    }
  }

  /**
   * 업그레이드 탭: 줄마다 이름 · 지금 값(→ 다음 값) · 단계 칸 · 버튼.
   * 비용을 아직 안 정해서 버튼은 "비용 미정"으로 꺼져 있고, ?dev 에서만 그냥 눌러 볼 수 있음.
   */
  private towerUpgradeTab(c: Phaser.GameObjects.Container, px: number, pw: number, y0: number) {
    const z = this.room()?.zone;
    if (!z) return;
    const pg = this.add.graphics();
    c.add(pg);
    const ROW = 20;
    const bw = 58;
    const bx = px + pw - 12 - bw;
    const row = (i: number, name: string, value: string, next: string | null, pips: [number, number], label: string, enabled: boolean, onClick: () => void) => {
      const y = y0 + 8 + i * ROW;
      if (i > 0) pg.fillStyle(E32.indigo, 1).fillRect(px + 10, y - 4, pw - 20, 1);
      c.add(this.txt(px + 12, y + 2, name, 8));
      const v = this.txt(px + 74, y + 2, value, 8, toCss(E32.silver));
      c.add(v);
      if (next) c.add(this.txt(v.x + v.width + 4, y + 2, `→ ${next}`, 8, toCss(E32.cyan)));
      // 단계 칸: 5단계까지는 네모 칸, 그보다 많으면 가는 눈금 (오른쪽 끝을 버튼 앞에 맞춤)
      const [lv, top] = pips;
      const cw = top <= 5 ? 6 : 2;
      const x0 = bx - 6 - top * (cw + 1) - 1;
      pg.fillStyle(E32.black, 1).fillRect(x0, y + 3, top * (cw + 1) + 1, 8);
      for (let k = 0; k < top; k++) pg.fillStyle(k < lv ? E32.cyan : E32.indigo, 1).fillRect(x0 + 1 + k * (cw + 1), y + 4, cw, 6);
      this.button(c, bx, y, bw, 13, label, onClick, enabled, E32.cyan);
    };
    const again = (ok: boolean) => {
      playSfx(ok ? 'buy' : 'deny');
      if (ok) this.openTower(1);
    };
    TOWER_UPGRADES.forEach((u, i) => {
      const lv = z.levels[u.id];
      const maxed = lv >= u.max;
      const cost = upgradeCost(u, lv);
      // 다음 값은 앞 글자 없이 ("최대 HP 100 → 150")
      const cur = `${u.pre}${upgradeValue(u, lv)}${u.unit}`;
      const nxt = maxed ? null : `${upgradeValue(u, lv + 1)}${u.unit}`;
      // 버튼 글 = 비용 ("산소 5개"). 모자라면 꺼짐. 비용을 안 정한 항목은 ?dev 에서만 그냥 올림
      const label = maxed ? '최대' : cost !== null ? `${u.cost!.name} ${cost}개` : DEV ? '개발: 올리기' : '비용 미정';
      row(i, u.name, cur, nxt, [lv, u.max], label, z.canUpgrade(u.id, DEV), () => again(z.upgrade(u.id, DEV)));
    });
    // 가진 재료 (비용으로 쓰는 것만)
    const owned = [...new Map(TOWER_UPGRADES.filter((u) => u.cost).map((u) => [u.cost!.reagent, u.cost!.name])).entries()];
    const oy = y0 + 8 + TOWER_UPGRADES.length * ROW;
    pg.fillStyle(E32.indigo, 1).fillRect(px + 10, oy - 4, pw - 20, 1);
    c.add(this.txt(px + 12, oy + 1, `가진 재료   ${owned.map(([r, name]) => `${name} ${z.have(r)}개`).join('  ·  ')}`, 8, toCss(E32.steel)));
  }

  private openAltar() {
    const build = (c: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics) => {
      this.panel(g, 10, 8, W - 20, H - 16, E32.magenta);
      c.add(this.txt(W / 2, 14, '원소의 제단', 12, toCss(E32.pink)).setOrigin(0.5, 0));
      c.add(this.icon(W / 2 - 34, 36, 'essence'));
      c.add(this.txt(W / 2 - 26, 31, `원소 정수 ${meta.essence}`, 8, toCss(E32.pink)));
      c.add(this.txt(20, 46, '캐릭터 스탯', 8, toCss(E32.yellow)));
      META_DEF.stats.forEach((st, i) => {
        const y = 60 + i * 26;
        const lv = statLevel(st.id);
        const max = st.costs.length;
        const cost = statCost(st);
        const pct = st.fmt.includes('%');
        const v = pct ? Math.round(st.per * lv * 100) : Math.round(st.per * lv * 10) / 10;
        c.add(this.txt(20, y, st.name, 8));
        c.add(this.txt(20, y + 10, st.fmt.replace('{v}', String(v)).replace('{n}', String(v)), 8, toCss(E32.steel)));
        const pg = this.add.graphics();
        for (let k = 0; k < max; k++) {
          pg.fillStyle(k < lv ? E32.pink : E32.indigo);
          pg.fillRect(92 + k * 8, y + 2, 6, 6);
        }
        c.add(pg);
        this.button(c, 140, y, 58, 14, cost === null ? '최대' : `강화 ${cost}`, () => {
          if (buyStat(st)) {
            playSfx('buy');
            this.openAltar();
          } else playSfx('deny');
        }, cost !== null && meta.essence >= cost, E32.pink);
      });
      c.add(this.txt(214, 46, `2차 반응 — 숙련 ${META_DEF.masteryRequired}회 + 정수 ${META_DEF.secondaryCost}`, 8, toCss(E32.yellow)));
      DATA.secondary.forEach((sec, i) => {
        const y = 60 + i * 16;
        const stt = secondaryStatus(sec.id);
        const prim = primaryFor(sec.id);
        c.add(this.txt(214, y, sec.name, 8, stt.unlocked ? toCss(colorOf(sec.color)) : '#ffffff'));
        c.add(this.txt(266, y, `${DATA.residues[sec.residue!]}+${ELEMENT_NAME[sec.element as Element]}`, 8, toCss(E32.slate)));
        const pg = this.add.graphics();
        const frac = Math.min(1, stt.mastery / stt.need);
        pg.fillStyle(E32.indigo);
        pg.fillRect(320, y + 3, 44, 4);
        pg.fillStyle(prim ? colorOf(DATA.primary.find((p) => p.id === prim)!.color) : E32.white);
        pg.fillRect(320, y + 3, Math.round(44 * frac), 4);
        c.add(pg);
        c.add(this.txt(368, y, `${Math.min(stt.mastery, stt.need)}/${stt.need}`, 8, toCss(E32.slate)));
        if (stt.unlocked) c.add(this.txt(420, y, '해금됨', 8, toCss(E32.lime)));
        else
          this.button(c, 414, y - 1, 38, 12, '해금', () => {
            if (buySecondary(sec.id)) {
              playSfx('select');
              const r = this.room();
              if (r) r.engine.secondaryUnlocked = new Set(meta.secondary);
              this.openAltar();
            } else playSfx('deny');
          }, stt.canBuy, E32.yellow);
      });
      c.add(this.txt(214, 220, '숙련은 런에서 1차 반응을 일으킬 때마다 쌓여요.\n성소에서 T 키로 2차 반응을 미리 체험할 수 있어요.', 8, toCss(E32.slate)));
      this.button(c, W / 2 - 30, H - 24, 60, 13, '닫기 (E)', () => this.closeOverlay(), true, E32.silver);
      if (new URLSearchParams(location.search).has('dev')) {
        this.button(c, 20, H - 26, 80, 14, '개발: 초기화', () => {
          Object.assign(meta, { essence: 0, stats: {}, secondary: [], mastery: {} });
          saveMeta();
          this.openAltar();
        }, true, E32.red);
      }
    };
    this.openOverlay(build, (k) => {
      if (k === 'e' || k === 'E' || k === 'Escape') this.closeOverlay();
    });
  }

  // ───────────────────────── 결과 화면 ─────────────────────────

  private openResult(victory: boolean, title?: string) {
    const r = this.room();
    const run = getRun();
    if (!r) return;
    const done = () => {
      this.closeOverlay();
      r.finishRun(victory);
    };
    this.openOverlay(
      (c, g) => {
        this.panel(g, W / 2 - 130, 30, 260, 210, victory ? C.gold1 : C.fire2);
        c.add(this.txt(W / 2, 40, victory ? '잿빛 회랑 돌파!' : (title ?? '쓰러졌어요'), 24, victory ? toCss(C.gold0) : toCss(E32.pink)).setOrigin(0.5, 0));
        if (run) {
          const top = Object.entries(run.stats.byReaction)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([id, n]) => `${REACTION_NAME[id] ?? id} ${n}`)
            .join(' · ');
          const m = Math.floor(run.time / 60);
          const sec = Math.floor(run.time % 60);
          const lines = [
            `도달 ${run.depth}/${REGION.length} · 시간 ${m}분 ${String(sec).padStart(2, '0')}초`,
            `처치 ${run.stats.kills} · 반응 ${run.stats.reactions} · 완벽 회피 ${run.stats.perfect}`,
            `많이 쓴 반응: ${top || '없음'}`,
            `반응 강화 ${Object.values(run.boons).reduce((a, b) => a + b, 0)}개 · 유물 ${run.relics.length}개`,
          ];
          c.add(this.txt(W / 2, 80, lines.join('\n'), 8, toCss(E32.white)).setOrigin(0.5, 0).setAlign('center'));
          c.add(this.icon(W / 2 - 44, 150, 'essence', 2));
          c.add(this.txt(W / 2 - 30, 144, `원소 정수 +${run.essence}`, 12, toCss(E32.pink)));
          c.add(this.txt(W / 2, 170, '정수와 반응 숙련은 성소에 남아요', 8, toCss(E32.steel)).setOrigin(0.5, 0));
        }
        this.button(c, W / 2 - 50, 206, 100, 18, '성소로 돌아가기', done);
      },
      (k) => {
        if (k === 'Enter' || k === ' ' || k === 'e' || k === 'E') done();
      },
      0.7,
    );
  }

  // ───────────────────────── 도움말·일시정지 ─────────────────────────

  private openHelp() {
    const run = getRun();
    this.openOverlay(
      (c, g) => {
        this.panel(g, 10, 8, W - 20, H - 16);
        c.add(this.txt(W / 2, 14, '일시정지', 12).setOrigin(0.5, 0));
        const left = [
          '[ 조작 ]',
          'WASD 이동 · 마우스 조준',
          '좌클릭 불 뿜기 (불씨, 직접 피해 없음, 쿨타임 1.5초)',
          '1~4 지금 줄의 시약 던지기 · F 시약 줄 바꾸기',
          'E 상호작용 (던진 시약 다시 담기) · M 소리',
          'H/ESC 일시정지 · N 밤까지 기다리기 (먼지 평원)',
          '',
          '[ 규칙 ]',
          '· 시약은 마우스 쪽으로 날아가요 (최대 150px)',
          '· 기체는 구름이 되고, 같은 구름에 던져야 섞여요',
          '· 나트륨·탄소는 바닥에 남고 같은 자리면 쌓여요',
          '· 공기에는 산소가 없어요: 불은 던진 것끼리만',
          '  반응시키고, 반응식 계수만큼 모여야 해요',
          '· 질소 구름이 닿은 수소 구름엔 불이 안 붙어요',
          '· 폭발은 옆 수소 구름에 옮겨붙어요',
          '· 염소·이산화질소는 독가스, 흰 연기는 느려짐',
          '· 광합성 열매를 먹으면 HP +60',
        ];
        c.add(this.txt(22, 34, left.join('\n'), 8));
        // 반응식은 아래 첨자가 있는 화학식으로
        c.add(this.txt(250, 34, '[ 반응 ]', 8));
        const P = (f: string, color: number): FormulaPiece => ({ f, color });
        const plus = { f: '+', color: CHEM_COLOR.op, op: true };
        const arrow = { f: '→', color: E32.silver, op: true };
        const eqs: FormulaPiece[][] = [
          [P('2H2', CHEM_COLOR.H), plus, P('O2', CHEM_COLOR.O), arrow, P('2H2O', CHEM_COLOR.water)],
          [P('H2', CHEM_COLOR.H), plus, P('Cl2', CHEM_COLOR.Cl), arrow, P('2HCl', CHEM_COLOR.HCl)],
          [P('N2', CHEM_COLOR.N), plus, P('3H2', CHEM_COLOR.H), arrow, P('2NH3', CHEM_COLOR.NH3)],
          [P('NH3', CHEM_COLOR.NH3), plus, P('HCl', CHEM_COLOR.HCl), arrow, P('NH4Cl', CHEM_COLOR.NH4Cl)],
          [P('N2', CHEM_COLOR.N), plus, P('2O2', CHEM_COLOR.O), arrow, P('2NO2', CHEM_COLOR.NO2)],
          [P('C', CHEM_COLOR.C), plus, P('O2', CHEM_COLOR.O), arrow, P('CO2', CHEM_COLOR.CO2)],
          [P('2C', CHEM_COLOR.C), plus, P('O2', CHEM_COLOR.O), arrow, P('2CO', CHEM_COLOR.CO)],
          [P('2H2O', CHEM_COLOR.water), plus, P('2Na', CHEM_COLOR.Na), arrow, P('2NaOH', CHEM_COLOR.naoh), plus, P('H2', CHEM_COLOR.H)],
          [P('2Na', CHEM_COLOR.Na), plus, P('Cl2', CHEM_COLOR.Cl), arrow, P('2NaCl', CHEM_COLOR.NaCl)],
          [P('HCl', CHEM_COLOR.HCl), plus, P('H2O', CHEM_COLOR.water), arrow, P('H3O+', CHEM_COLOR.acid), plus, P('Cl-', CHEM_COLOR.Cl)],
          [P('6CO2', CHEM_COLOR.CO2), plus, P('6H2O', CHEM_COLOR.water), arrow, P('C6H12O6', CHEM_COLOR.glucose), plus, P('6O2', CHEM_COLOR.O)],
        ];
        eqs.forEach((pieces, i) => {
          const fl = formulaLine(this, pieces, 'small');
          fl.c.setPosition(250, 46 + i * 14);
          c.add(fl.c);
        });
        const right = ['[ 이번 런 ]'];
        if (run) {
          const boons = BOONS.filter((b) => run.boons[b.id]).map((b) => `${b.name} Lv${run.boons[b.id]}`);
          right.push(boons.length ? boons.join(', ') : '반응 강화 없음');
          const rel = RELICS.filter((r) => run.relics.includes(r.id)).map((r) => r.name);
          right.push(rel.length ? '유물: ' + rel.join(', ') : '유물 없음');
        } else right.push('허수아비 연습 중');
        c.add(this.txt(250, 202, right.join('\n'), 8).setWordWrapWidth(210));
        this.button(c, W / 2 - 34, H - 28, 68, 16, '계속하기', () => this.closeOverlay(), true, E32.silver);
      },
      (k) => {
        if (k === 'h' || k === 'H' || k === 'Escape') this.closeOverlay();
      },
    );
  }

  private refreshRelicIcons() {
    for (const i of this.relicIcons) i.destroy();
    this.relicIcons = [];
    const run = getRun();
    if (!run) return;
    run.relics.forEach((id, i) => {
      const r = RELICS.find((x) => x.id === id);
      if (!r) return;
      const img = this.icon(10 + i * 14, 42, r.icon);
      this.relicIcons.push(img);
      this.hud.add(img);
    });
  }

  // ───────────────────────── HUD ─────────────────────────

  update(): void {
    const r = this.room();
    const g = this.g;
    g.clear();
    this.hud.setVisible(!!r);
    this.slotLayer.setVisible(!!r);
    if (!r) return;
    const p = r.player;
    const run = r.run;
    const T = this.texts;

    // HP
    const hpW = 100;
    const frac = Math.max(0, p.hp / p.maxHp);
    g.fillStyle(E32.black, 1);
    g.fillRect(18, 3, hpW + 2, 11);
    g.fillStyle(E32.darkbrown);
    g.fillRect(19, 4, hpW, 9);
    g.fillStyle(E32.red);
    g.fillRect(19, 4, Math.round(hpW * frac), 9);
    g.fillStyle(E32.pink);
    g.fillRect(19, 4, Math.round(hpW * frac), 2);
    g.fillStyle(E32.crimson);
    g.fillRect(19, 12, Math.round(hpW * frac), 1);
    T.hp.setText(`${Math.ceil(p.hp)}/${p.maxHp}`);
    T.gold.setText(run ? `${run.gold}` : '-');
    T.essence.setText(run ? `${run.essence}` : `${meta.essence}`);
    // 산소탑이 있는 맵: 골드·정수 자리에 탑 HP (플레이어 HP와 같은 크기, 색은 HP 비율을 따라)
    const tk = r.tank;
    for (const o of [T.gold, T.essence, ...this.runIcons]) o.setVisible(!tk);
    T.towerHp.setVisible(!!tk);
    this.towerIcon.setVisible(!!tk);
    if (tk) {
      const tf = tk.frac;
      const [main, hi, lo] = towerHpRamp(tf);
      const flash = tk.sinceHit < TOWER_FLASH_SEC;
      const low = tf <= TOWER_LOW && tk.hp > 0;
      g.fillStyle(flash ? E32.white : low && towerBlink(this.time.now) ? E32.red : E32.black, 1);
      g.fillRect(18, 16, hpW + 2, 11);
      g.fillStyle(E32.night);
      g.fillRect(19, 17, hpW, 9);
      const fw = tk.hp > 0 ? Math.max(1, Math.round(hpW * tf)) : 0;
      const gw = Math.round((hpW * tk.ghost) / tk.maxHp);
      if (gw > fw) g.fillStyle(E32.white).fillRect(19 + fw, 17, gw - fw, 9);
      g.fillStyle(main).fillRect(19, 17, fw, 9);
      g.fillStyle(hi).fillRect(19, 17, fw, 2);
      g.fillStyle(lo).fillRect(19, 25, fw, 1);
      g.fillStyle(E32.black, 0.45);
      for (let k = 1; k < 4; k++) g.fillRect(19 + (hpW * k) / 4, 22, 1, 4);
      T.towerHp.setText(`${Math.ceil(tk.hp)}/${tk.maxHp}`);
    }

    // 시약 줄 (왼쪽 아래): 지금 줄 1~4칸이 앞, F로 바꿀 다른 줄은 그 뒤에 그림자처럼 어둡게 겹쳐 있음.
    // F를 누르면 앞 줄은 살짝 내려가며 뒤로, 뒤 줄은 떠오르며 앞으로 (가운데서 앞뒤 그리는 순서가 바뀜)
    const gs = this.gs;
    gs.clear();
    this.gt.clear();
    const baseY = H - SLOT - 14;
    const rx0 = SLOT_X;
    const throwCd = r.chem?.throwCd ?? 0;
    const belt = r.chem?.belt ?? 0;
    const stock = r.chem?.stock ?? null;
    if (belt !== this.shownBelt) {
      this.shownBelt = belt;
      this.beltAnim.k = 0;
      this.tweens.killTweensOf(this.beltAnim);
      this.tweens.add({ targets: this.beltAnim, k: 1, duration: 200, ease: 'Sine.InOut' });
    }
    const belts = r.chem?.belts ?? BELTS;
    for (const ic of this.reagentIcons.values()) ic.img.setVisible(false), ic.sym.setVisible(false);
    const frame = (x: number, y: number, w: number, h: number, col: number | null, a: number) => {
      gs.fillStyle(E32.black, 1);
      gs.fillRect(x - 1, y - 1, w + 2, h + 2);
      gs.fillStyle(E32.night, 1);
      gs.fillRect(x, y, w, h);
      gs.fillStyle(col ?? E32.indigo, col === null ? 1 : a);
      gs.fillRect(x, y, w, 1);
      gs.fillRect(x, y + h - 1, w, 1);
      gs.fillRect(x, y, 1, h);
      gs.fillRect(x + w - 1, y, 1, h);
    };
    // 뒤 줄은 앞 줄에서 오른쪽 위로 비켜난 자리
    const BX = 3;
    const BY = -5;
    const k = this.beltAnim.k;
    const lift = Math.sin(Math.PI * k);
    const rows = [
      { b: (belt + 1) % belts.length, x: BX * k, y: BY * k + 4 * lift, dark: k, front: false },
      { b: belt, x: BX * (1 - k), y: BY * (1 - k) - 6 * lift, dark: 1 - k, front: true },
    ];
    if (k < 0.5) rows.reverse();
    for (const row of rows) {
      belts[row.b].forEach((rg, i) => {
        const x = Math.round(rx0 + i * (SLOT + GAP) + row.x);
        const y = Math.round(baseY + row.y);
        frame(x, y, SLOT, SLOT, rg && REAGENT_COLOR[rg], 0.7);
        if (row.front && rg && throwCd > 0) {
          gs.fillStyle(E32.black, 0.65);
          gs.fillRect(x + 1, y + 1, SLOT - 2, Math.round((SLOT - 2) * Math.min(1, throwCd / THROW_CD)));
        }
        if (row.dark > 0) {
          gs.fillStyle(E32.black, 0.6 * row.dark);
          gs.fillRect(x - 1, y - 1, SLOT + 2, SLOT + 2);
        }
        const icon = rg && this.reagentIcons.get(rg);
        // 개수가 있는 맵: 오른쪽 아래에 남은 개수, 다 쓴 칸은 흐리게
        const n = rg && stock ? stock[rg] : null;
        if (icon) {
          const a = (1 - row.dark) * (n === 0 ? 0.35 : 1);
          // 병과 화학식은 칸 가운데 (칸 번호·개수와 겹치면 숫자가 앞)
          const shown = row.dark < 0.95;
          icon.img.setVisible(shown).setAlpha(a).setPosition(x + icon.ox, y + icon.oy);
          icon.sym.setVisible(shown).setAlpha(a).setPosition(x + 12 - (icon.sym.width >> 1), y + 12 - (icon.sym.height >> 1));
        }
        if (row.front) {
          T[`rkey${i}`].setPosition(x + 2, y + 1).setAlpha(1 - row.dark);
          if (n !== null) this.tinyDigits(String(n), x + SLOT - 2 - (String(n).length * 4 - 1), y + SLOT - 7, n === 0 ? E32.red : E32.silver, 1 - row.dark);
        }
      });
    }
    T.fkey.setPosition(rx0 + BELTS[0].length * (SLOT + GAP) + BX + 1, baseY + BY - 2);
    const reagentW = BELTS[0].length * (SLOT + GAP) + BX + 8;
    // 캐릭터가 UI 뒤에 있으면 반투명 (화면 좌표 기준)
    const cam = r.cameras.main;
    const psx = p.x - cam.worldView.x;
    const psy = p.y - cam.worldView.y;
    const behind = psx < rx0 + reagentW + 30 && psy > baseY + BY - 30;
    this.slotLayer.setAlpha(Phaser.Math.Linear(this.slotLayer.alpha, behind ? 0.3 : 1, 0.2));

    // 방 이름·진행도·목표 (오른쪽 위)
    const bossUp = !!(r.boss && !r.boss.dead);
    T.room.setText(r.roomName.replace(' · ', '\n')).setVisible(!bossUp);
    if (run && !bossUp) {
      const n = REGION.length;
      for (let i = 1; i <= n; i++) {
        const x = W - 4 - (n - i + 1) * 7;
        g.fillStyle(i < run.depth ? E32.steel : i === run.depth ? E32.yellow : E32.indigo);
        if (i === n) g.fillStyle(i <= run.depth ? E32.orange : E32.crimson);
        g.fillRect(x, 28, 5, 2);
      }
    }
    T.objective.setText(bossUp ? '' : this.objective(r)).setY(run ? 33 : 16);

    // 먼지 평원 시계: 18시간 원판 (위쪽이 0시, 시계 방향). 바깥 띠는 낮 10시간 노랑 + 밤 8시간 남색, 바늘이 지금 시각
    const z = r.zone;
    for (const k of ['clockDay', 'clockHour', 'clockHint', 'oxyLabel', 'oxyPct']) T[k].setVisible(!!z);
    this.mmImg.setVisible(!!z);
    this.mmG.setVisible(!!z);
    if (z) {
      const cx = W / 2;
      const cy = 13;
      const R = 10;
      const ang = (h: number) => -Math.PI / 2 + (h / DAY_HOURS) * Math.PI * 2;
      g.fillStyle(E32.black, 1).fillCircle(cx, cy, R + 1);
      g.fillStyle(E32.amber, 1).slice(cx, cy, R, ang(0), ang(NIGHT_AT)).fillPath();
      g.fillStyle(E32.indigo, 1).slice(cx, cy, R, ang(NIGHT_AT), ang(DAY_HOURS)).fillPath();
      g.fillStyle(E32.night, 1).fillCircle(cx, cy, R - 3);
      const a = ang(z.hour);
      g.lineStyle(1, E32.white, 1).lineBetween(cx, cy, cx + Math.cos(a) * (R - 1), cy + Math.sin(a) * (R - 1));
      g.fillStyle(E32.white, 1).fillRect(cx - 1, cy - 1, 2, 2);
      T.clockDay.setText(`${z.day}일차`);
      T.clockHour.setText(`${z.hour < NIGHT_AT ? '낮' : '밤'} ${Math.floor(z.hour)}시`).setColor(toCss(z.hour < NIGHT_AT ? E32.amber : E32.steel));
      const blink = Math.floor(this.time.now / 250) % 2 === 0;
      // 안내는 산소화 막대 아래. 화학식이 떠 있는 동안은 그 자리라 숨김
      T.clockHint.setText(z.done || this.chemLine ? '' : z.ff ? `빨리 감는 중${blink ? ' ▶▶' : ''}` : z.hour < NIGHT_WARN_AT ? 'N 밤까지 기다리기' : '');
      this.drawOxygenation(g, z.oxy);
      this.drawMinimap(g, r);
    }

    if (run) {
      const lines = BOONS.filter((b) => run.boons[b.id]).map((b) => `${b.name} ${'●'.repeat(run.boons[b.id])}`).slice(0, 8);
      T.build.setText(lines.join('\n')).setY(baseY - 8 - lines.length * 11);
    } else T.build.setText('');

    // 보스 체력바
    const boss = r.boss;
    if (boss && !boss.dead) {
      const bw = 200;
      const bx = Math.round(W / 2 - bw / 2);
      g.fillStyle(E32.black, 1);
      g.fillRect(bx - 1, 14, bw + 2, 6);
      g.fillStyle(E32.darkbrown);
      g.fillRect(bx, 15, bw, 4);
      g.fillStyle(boss.shieldReaction ? E32.steel : E32.orange);
      g.fillRect(bx, 15, Math.round(bw * (boss.hp / boss.maxHp)), 4);
      g.fillStyle(boss.shieldReaction ? E32.silver : E32.yellow);
      g.fillRect(bx, 15, Math.round(bw * (boss.hp / boss.maxHp)), 1);
      for (const f of [0.6, 0.25]) {
        g.fillStyle(E32.black);
        g.fillRect(bx + Math.round(bw * f), 15, 1, 4);
      }
      T.bossName.setText(`${boss.displayName} · ${boss.phase}페이즈`).setVisible(true);
      const sd = boss.shieldDef;
      T.bossShield
        .setText(sd ? `원소 실드 — [${sd.name}]으로 파괴` : boss.staggered ? '실드 파괴! 지금 공격!' : '')
        .setColor(sd ? toCss(colorOf(sd.color)) : toCss(E32.yellow))
        .setVisible(true);
    } else {
      T.bossName.setVisible(false);
      T.bossShield.setVisible(false);
    }
    T.hint.setText('H 일시정지 · M 소리');
  }

  // ───────────────────────── 화학식 (위 가운데) ─────────────────────────
  // 무언가와 합쳐질 때만 뜨고, 잠시 뒤 사라진다 (땅 위 라벨은 그대로)

  private onChem(ev: ChemEvent): void {
    this.chemGen++;
    if (ev.type === 'clear') this.chemClear(true);
    else if (ev.type === 'mix') this.chemMix(ev.terms);
    else this.chemEquation(ev);
  }

  /** 지금 화학식 이벤트가 그대로일 때만 실행 (새 이벤트가 오면 예약된 연출은 버림) */
  private chemLater(ms: number, fn: () => void): void {
    const gen = this.chemGen;
    this.time.delayedCall(ms, () => {
      if (gen === this.chemGen) fn();
    });
  }

  private chemClear(fade: boolean): void {
    const line = this.chemLine;
    this.chemLine = null;
    this.chemRuns = [];
    this.chemTail = [];
    if (!line) return;
    this.tweens.killTweensOf(line);
    for (const ch of line.list) this.tweens.killTweensOf(ch);
    if (fade) this.tweens.add({ targets: line, alpha: 0, duration: 400, onComplete: () => line.destroy() });
    else line.destroy();
  }

  private chemBuild(pieces: FormulaPiece[]) {
    const b = formulaLine(this, pieces, 'big');
    b.c.setDepth(-1).setPosition(Math.round(W / 2 - b.w / 2), CHEM_Y);
    this.chemLine = b.c;
    this.chemRuns = b.pieces.flatMap((p) => p.texts);
    return b;
  }

  /** 글자 조각이 위에서 톡 떨어짐 — 흰색으로 번쩍였다가 제 색으로. slam = 반응 결과가 쾅 */
  private chemDrop(ft: FormulaText, delayMs: number, slam = false): void {
    const t = ft.t;
    const y0 = t.y;
    t.setAlpha(0).setY(y0 - (slam ? 14 : 8));
    this.tweens.add({
      targets: t,
      alpha: 1,
      y: y0,
      delay: delayMs,
      duration: slam ? 120 : 220,
      ease: slam ? 'Quad.In' : 'Back.Out',
      onStart: () => t.setColor('#ffffff'),
      onUpdate: () => t.setY(Math.round(t.y)),
      onComplete: () =>
        this.time.delayedCall(slam ? 140 : 80, () => {
          if (t.scene) t.setColor(ft.color);
        }),
    });
  }

  /** 합쳐졌지만 반응은 안 일어남 (H + O 등): 하나씩 떨어진 뒤 잠깐 있다가 서서히 사라짐 */
  private chemMix(terms: ChemTerm[]): void {
    this.chemClear(false);
    const b = this.chemBuild(joinTerms(terms, CHEM_COLOR.op));
    b.pieces.forEach((pc, i) => {
      pc.texts.forEach((r, j) => this.chemDrop(r, i * 110 + j * 30));
      this.chemLater(i * 110, () => playSfx('tick'));
    });
    this.chemLater(b.pieces.length * 110 + 1300, () => this.chemClear(true));
  }

  /** 반응식: 왼쪽 항이 하나씩 → 화살표 → 결과가 쾅 → 잠깐 뒤 서서히 사라짐 */
  private chemEquation(ev: Extract<ChemEvent, { type: 'equation' }>): void {
    const old = this.chemTail;
    this.chemClear(false);
    const lhs = joinTerms(ev.lhs, CHEM_COLOR.op);
    const arrowIdx = lhs.length;
    const b = this.chemBuild([...lhs, { f: '→', color: E32.silver, op: true }, ...joinTerms(ev.rhs, CHEM_COLOR.op)]);
    const line = b.c;
    const finalX = line.x;
    const last = b.pieces[b.pieces.length - 1];
    this.chemTail = last.texts.map((r) => ({ key: r.key, abs: finalX + r.t.x }));

    // 첫 항: 바로 앞 반응의 결과(H₂ 등)와 같으면 그 자리에서 미끄러져 와서 이어짐, 앞에 붙는 계수만 새로 떨어짐
    const p0 = b.pieces[0].texts;
    const m = old.length;
    const tail = m > 0 && m <= p0.length && old.every((r, i) => r.key === p0[p0.length - m + i].key);
    if (tail) {
      line.x = Math.round(old[0].abs - p0[p0.length - m].t.x);
      this.tweens.add({ targets: line, x: finalX, duration: 220, ease: 'Cubic.Out', onUpdate: () => line.setX(Math.round(line.x)) });
      p0.slice(0, p0.length - m).forEach((r, i) => this.chemDrop(r, 80 + i * 40));
    } else {
      p0.forEach((r, i) => this.chemDrop(r, i * 40));
      playSfx('tick');
    }

    // 나머지 왼쪽 항
    let at = 140;
    for (let i = 1; i < arrowIdx; i++) {
      b.pieces[i].texts.forEach((r, j) => this.chemDrop(r, at + j * 30));
      this.chemLater(at, () => playSfx('tick'));
      at += 110;
    }
    const reveal = ev.revealAt * 1000;

    // 지글거리는 반응(나트륨): 결과가 나올 때까지 왼쪽 항이 떨림
    if (ev.fizz) {
      const lhsTexts = b.pieces.slice(0, arrowIdx).flatMap((p) => p.texts);
      const base = lhsTexts.map((r) => r.t.x);
      const shake = this.time.addEvent({
        delay: 45,
        loop: true,
        callback: () => {
          if (!line.scene) return shake.remove();
          lhsTexts.forEach((r, i) => r.t.setX(base[i] + Phaser.Math.Between(-1, 1)));
        },
      });
      this.time.delayedCall(reveal, () => {
        shake.remove();
        lhsTexts.forEach((r, i) => {
          if (r.t.scene) r.t.setX(base[i]);
        });
      });
    }

    // 화살표 → 오른쪽 항
    const arrowAt = Math.max(at, reveal - 110);
    b.pieces[arrowIdx].texts.forEach((r) => this.chemDrop(r, arrowAt));
    this.chemLater(arrowAt, () => playSfx('tick'));
    for (let i = arrowIdx + 1; i < b.pieces.length; i++) {
      b.pieces[i].texts.forEach((r) => this.chemDrop(r, reveal + (i - arrowIdx - 1) * 60, true));
    }
    this.chemLater(reveal + 120, () => {
      playSfx('formula');
      this.tweens.add({ targets: line, y: CHEM_Y + 2, duration: 50, yoyo: true, onComplete: () => line.setY(CHEM_Y) });
    });

    // 잠깐 보여준 뒤 서서히 사라짐
    this.chemLater(reveal + 1700, () => this.chemClear(true));
  }

  private objective(r: RoomScene): string {
    if (r.zone) return ''; // 먼지 평원은 이 자리에 미니맵 (산소화를 다 채우면 가운데 알림으로)
    if (r.mode === 'hub') return r.trial ? '2차 반응 체험 중\n허수아비에 연계해 보세요' : '허수아비로 연습';
    if (r.state === 'dead') return '';
    if (r.mode === 'boss') return r.state === 'victory' ? '승리!' : '';
    if (r.state === 'play') return `웨이브 ${r.waveIdx}/${r.waveCount} · 남은 적 ${r.enemies.filter((e) => !e.dead).length}`;
    if (r.pickups.some((p) => p.kind === 'reward')) return '보상을 받으세요 (E)';
    if (r.doors.some((d) => d.open)) return '문을 골라 다음 방으로\n문 위 아이콘 = 다음 보상';
    return '';
  }
}
