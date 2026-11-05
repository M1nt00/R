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
import { CHEM_COLOR, REAGENTS, REAGENT_KEY, THROW_CD, type ChemEvent, type ChemTerm } from '../chem/chemistry';
import { formulaLine, formulaTexts, joinTerms, toCssColor, type FormulaPiece, type FormulaText } from '../chem/formula';

const W = VIEW_W;
const H = VIEW_H;
const SLOT = 24;
const GAP = 3;
const SLOT_X = 4;
const DARK = '#181425';
/** 위 가운데 화학식 줄의 y */
const CHEM_Y = 36;

let titleShown = false;

const reactionColor = (reaction: string): number => {
  const r = [...DATA.primary, ...DATA.stack].find((x) => x.id === reaction);
  if (r) return colorOf(r.color);
  return reaction === 'stack' ? E32.silver : E32.yellow;
};

/** HUD·오버레이 — 480×270 원본 해상도, 픽셀 폰트 설계 크기(8·10·12·24px)만 사용 */
export class UIScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private gs!: Phaser.GameObjects.Graphics;
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
  /** 시약 슬롯 글자 (CO₂처럼 아래 첨자가 있어서 화학식으로 그림) */
  private reagentSyms: { c: Phaser.GameObjects.Container; w: number }[] = [];
  private chemGen = 0;

  constructor() {
    super('UI');
  }

  private room(): RoomScene | null {
    const r = this.scene.get('Room') as RoomScene | null;
    return r && r.player ? r : null;
  }

  /** size: 8 · 10 · 12 · 24 */
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
    t('potion', 16, 18);
    t('gold', 47, 18, 8, toCss(C.gold0));
    t('essence', 83, 18, 8, toCss(E32.pink));
    t('room', W - 4, 3, 10).setOrigin(1, 0);
    t('objective', W - 4, 22, 8, toCss(E32.silver)).setOrigin(1, 0).setAlign('right').setWordWrapWidth(170);
    t('hint', W - 4, H - 11, 8, toCss(E32.slate)).setOrigin(1, 0);
    t('build', 4, 0, 8, toCss(E32.silver));
    t('bossName', W / 2, 3, 10, toCss(C.fire0)).setOrigin(0.5, 0);
    t('bossShield', W / 2, 21, 8).setOrigin(0.5, 0);
    this.hud.add(this.icon(10, 8, 'heart'));
    this.hud.add(this.icon(9, 23, 'potion'));
    this.hud.add(this.icon(40, 23, 'gold'));
    this.hud.add(this.icon(76, 23, 'essence'));
    REAGENTS.forEach((rg, i) => {
      this.slotLayer.add(t(`rkey${i}`, 0, 0, 8, toCss(E32.steel)));
      const sym = formulaTexts(this, rg, toCssColor(CHEM_COLOR[rg]), 'slot');
      const sc = this.add.container(0, 0, sym.texts.map((ft) => ft.t));
      this.slotLayer.add(sc);
      this.reagentSyms.push({ c: sc, w: sym.w });
    });
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

    if (!titleShown) this.openTitle();
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
      zone.on('pointerdown', onClick);
    }
    c.add([g, t, zone]);
  }

  private handleRequest(req: UiRequest) {
    if (req.type === 'boons') this.openBoons(req.options, req.source);
    else if (req.type === 'relics') this.openRelics(req.options);
    else if (req.type === 'altar') this.openAltar();
    else this.openResult(req.victory);
  }

  // ───────────────────────── 타이틀 ─────────────────────────

  private openTitle() {
    titleShown = true;
    const close = () => {
      playSfx('select');
      this.closeOverlay();
    };
    this.openOverlay(
      (c) => {
        c.add(this.txt(W / 2, 70, '원소 저글러', 24).setOrigin(0.5));
        REAGENTS.forEach((rg, i) => {
          const { texts, w } = formulaTexts(this, rg, toCssColor(CHEM_COLOR[rg]), 'big');
          const sym = this.add.container(Math.round(W / 2 + (i - (REAGENTS.length - 1) / 2) * 68 - w / 2), 92);
          for (const ft of texts) sym.add(ft.t);
          c.add(sym);
          this.tweens.add({ targets: sym, y: 88, yoyo: true, repeat: -1, duration: 700, delay: i * 140, ease: 'Stepped', easeParams: [4] });
        });
        c.add(this.txt(W / 2, 132, '시약을 던져서 실제 화학 반응을 일으켜요', 10, toCss(E32.silver)).setOrigin(0.5));
        const lines = [
          'WASD 이동 · 마우스 조준 · 좌클릭(꾹) 화염 방사 · 스페이스 구르기',
          '1 수소(H) · 2 산소(O) · 3 나트륨(Na) · 4 탄소(C) 던지기',
          'Q 포션 · E 상호작용',
        ];
        c.add(this.txt(W / 2, 160, lines.join('\n'), 8, toCss(E32.white)).setOrigin(0.5).setAlign('center'));
        const go = this.txt(W / 2, 204, '클릭해서 시작', 12, toCss(E32.yellow)).setOrigin(0.5);
        this.tweens.add({ targets: go, alpha: 0.3, yoyo: true, repeat: -1, duration: 600, ease: 'Stepped', easeParams: [2] });
        c.add(go);
        c.add(this.txt(W / 2, H - 14, `원소 정수 ${meta.essence} · 도전 ${meta.runs}회 · 최고 ${meta.bestDepth}층 · 승리 ${meta.wins}회`, 8, toCss(E32.slate)).setOrigin(0.5));
        const zone = this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();
        zone.on('pointerdown', close);
        c.add(zone);
      },
      close,
      0.35,
    );
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
    zone.on('pointerdown', onPick);
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
        const v = st.id === 'roll' ? 2 + lv : st.id === 'potion' ? 1 + lv : pct ? Math.round(st.per * lv * 100) : Math.round(st.per * lv * 10) / 10;
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

  private openResult(victory: boolean) {
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
        c.add(this.txt(W / 2, 40, victory ? '잿빛 회랑 돌파!' : '쓰러졌어요', 24, victory ? toCss(C.gold0) : toCss(E32.pink)).setOrigin(0.5, 0));
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
          'WASD 이동 · 마우스 조준 · 스페이스 구르기',
          '좌클릭(꾹) 화염 방사 (불씨, 직접 피해 없음)',
          '1 수소 · 2 산소 · 3 나트륨 · 4 탄소 던지기',
          'Q 포션 · E 상호작용 · H/ESC 일시정지 · M 소리',
          '',
          '[ 규칙 ]',
          '· 시약은 마우스 쪽으로 날아가요 (최대 150px)',
          '· 기체는 구름으로 남고, 같은 구름에 던져야 섞여요',
          '· 수소와 산소는 섞기만 하면 그대로예요',
          '· 수소에 불이 붙으면 터지고 물이 남아요',
          '  산소가 섞여 있으면 큰 폭발, 없으면 약한 폭발',
          '· 폭발은 옆 수소 구름에 옮겨붙어요',
          '· 나트륨은 물에 닿으면 폭발해요',
          '· 탄소 + 산소 둘 → 이산화탄소',
          '· 이산화탄소 구름이 물 위에 있으면 광합성',
          '  포도당 열매를 먹으면 HP 회복',
        ];
        c.add(this.txt(22, 34, left.join('\n'), 8));
        // 반응식은 아래 첨자가 있는 화학식으로
        c.add(this.txt(250, 34, '[ 반응 ]', 8));
        const P = (f: string, color: number): FormulaPiece => ({ f, color });
        const plus = { f: '+', color: CHEM_COLOR.op, op: true };
        const arrow = { f: '→', color: E32.silver, op: true };
        const eqs: [FormulaPiece[], string][] = [
          [[P('H', CHEM_COLOR.H), plus, P('H', CHEM_COLOR.H), arrow, P('H2', CHEM_COLOR.H)], '저절로 (산소 원자 둘도 같은 식)'],
          [[P('C', CHEM_COLOR.C), plus, P('O', CHEM_COLOR.O), arrow, P('CO', CHEM_COLOR.CO)], '저절로, 산소 하나 더 → 이산화탄소'],
          [[P('2H2', CHEM_COLOR.H), plus, P('O2', CHEM_COLOR.O), arrow, P('2H2O', CHEM_COLOR.water)], '불 → 산소 없으면 약한, 섞으면 큰 폭발'],
          [[P('2H2O', CHEM_COLOR.water), plus, P('2Na', CHEM_COLOR.Na), arrow, P('2NaOH', CHEM_COLOR.naoh), plus, P('H2', CHEM_COLOR.H)], '폭발, 물은 1 줄어듦'],
          [[P('6CO2', CHEM_COLOR.CO2), plus, P('6H2O', CHEM_COLOR.water), arrow, P('C6H12O6', CHEM_COLOR.glucose), plus, P('6O2', CHEM_COLOR.O)], '물 위 이산화탄소 → 열매 + 산소'],
          [[P('C6H12O6', CHEM_COLOR.glucose), plus, P('6O2', CHEM_COLOR.O), arrow, P('6CO2', CHEM_COLOR.CO2), plus, P('6H2O', CHEM_COLOR.water)], '열매 먹기 (세포 호흡) → HP +25'],
        ];
        eqs.forEach(([pieces, note], i) => {
          const y = 46 + i * 25;
          const fl = formulaLine(this, pieces, 'small');
          fl.c.setPosition(250, y);
          c.add(fl.c);
          c.add(this.txt(250, y + 15, note, 8, toCss(E32.steel)));
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
    T.potion.setText(`${p.potions}`);
    T.gold.setText(run ? `${run.gold}` : '-');
    T.essence.setText(run ? `${run.essence}` : `${meta.essence}`);

    // 구르기 충전
    for (let i = 0; i < p.rollMax; i++) {
      const x = 106 + i * 9;
      g.fillStyle(E32.black, 1);
      g.fillRect(x, 18, 7, 7);
      g.fillStyle(i < p.rollCharges ? E32.silver : E32.indigo, 1);
      g.fillRect(x + 1, 19, 5, 5);
      if (i === p.rollCharges) {
        const f = Math.round(5 * (p.rollRecharge / 1.1));
        g.fillStyle(E32.steel, 1);
        g.fillRect(x + 1, 24 - f, 5, f);
      }
    }

    // 시약 슬롯 (왼쪽 아래): 1 수소 · 2 산소 · 3 나트륨
    const gs = this.gs;
    gs.clear();
    const baseY = H - SLOT - 14;
    const rx0 = SLOT_X;
    const throwCd = r.chem?.throwCd ?? 0;
    REAGENTS.forEach((rg, i) => {
      const x = rx0 + i * (SLOT + GAP);
      const y = baseY;
      const col = CHEM_COLOR[rg];
      gs.fillStyle(E32.black, 1);
      gs.fillRect(x - 1, y - 1, SLOT + 2, SLOT + 2);
      gs.fillStyle(E32.night, 1);
      gs.fillRect(x, y, SLOT, SLOT);
      gs.fillStyle(col, 0.7);
      gs.fillRect(x, y, SLOT, 1);
      gs.fillRect(x, y + SLOT - 1, SLOT, 1);
      gs.fillRect(x, y, 1, SLOT);
      gs.fillRect(x + SLOT - 1, y, 1, SLOT);
      if (throwCd > 0) {
        gs.fillStyle(E32.black, 0.65);
        gs.fillRect(x + 1, y + 1, SLOT - 2, Math.round((SLOT - 2) * Math.min(1, throwCd / THROW_CD)));
      }
      T[`rkey${i}`].setPosition(x + 2, y + 1).setText(REAGENT_KEY[rg]);
      const sym = this.reagentSyms.at(i);
      sym?.c.setPosition(Math.round(x + SLOT / 2 - sym.w / 2), y + 7);
    });
    const reagentW = REAGENTS.length * (SLOT + GAP) - GAP;
    // 캐릭터가 UI 뒤에 있으면 반투명 (화면 좌표 기준)
    const cam = r.cameras.main;
    const psx = p.x - cam.worldView.x;
    const psy = p.y - cam.worldView.y;
    const behind = psx < rx0 + reagentW + 30 && psy > baseY - 30;
    this.slotLayer.setAlpha(Phaser.Math.Linear(this.slotLayer.alpha, behind ? 0.3 : 1, 0.2));

    // 방 이름·진행도·목표 (오른쪽 위)
    const bossUp = !!(r.boss && !r.boss.dead);
    T.room.setText(r.roomName.replace(' · ', '\n')).setVisible(!bossUp).setAlign('right');
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
    if (r.mode === 'hub') return r.trial ? '2차 반응 체험 중\n허수아비에 연계해 보세요' : '허수아비로 연습';
    if (r.state === 'dead') return '';
    if (r.mode === 'boss') return r.state === 'victory' ? '승리!' : '';
    if (r.state === 'play') return `웨이브 ${r.waveIdx}/${r.waveCount} · 남은 적 ${r.enemies.filter((e) => !e.dead).length}`;
    if (r.pickups.some((p) => p.kind === 'reward')) return '보상을 받으세요 (E)';
    if (r.doors.some((d) => d.open)) return '문을 골라 다음 방으로\n문 위 아이콘 = 다음 보상';
    return '';
  }
}
