import Phaser from 'phaser';
import type { RoomScene, UiRequest } from './RoomScene';
import { FONT, VIEW_W, VIEW_H, RENDER_SCALE } from '../config';
import { ELEMENTS, ELEMENT_NAME, type Element } from '../element/types';
import { C, ELEMENT_COLOR, toCss } from '../art/palette';
import { DATA, colorOf } from '../element/data';
import { ICON, type IconName } from '../art/propSprites';
import { SKILL_COOLDOWN, SKILL_NAME } from '../combat/attacks';
import { BOONS, RELICS, REGION, getRun, type BoonDef, type RelicDef } from '../run/runState';
import { MASTERY_DESC, REACTION_NAME, reactionLevel } from '../run/mods';
import { META_DEF, buySecondary, buyStat, meta, primaryFor, saveMeta, secondaryStatus, statCost, statLevel } from '../run/meta';
import { playSfx, toggleMute } from '../audio/sfx';

const W = VIEW_W * RENDER_SCALE;
const H = VIEW_H * RENDER_SCALE;
const SLOT = 56;
const GAP = 10;
const SLOT_X = 18;

let titleShown = false;

const reactionColor = (reaction: string): number => {
  const r = [...DATA.primary, ...DATA.stack].find((x) => x.id === reaction);
  if (r) return colorOf(r.color);
  return reaction === 'stack' ? 0xc2bad6 : 0xffe08a;
};

/** HUD·오버레이 (960×540 화면 좌표, 줌 1 — 한글 픽셀 폰트를 12px 배수로 선명하게) */
export class UIScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private gs!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private slotLayer!: Phaser.GameObjects.Container;
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private banner!: Phaser.GameObjects.Text;
  private overlay: Phaser.GameObjects.Container | null = null;
  private overlayKeys: ((k: string) => void) | null = null;
  private pausedRoom = false;
  private texts: Record<string, Phaser.GameObjects.Text> = {};
  private slotIcons: Phaser.GameObjects.Image[] = [];
  private relicIcons: Phaser.GameObjects.Image[] = [];

  constructor() {
    super('UI');
  }

  private room(): RoomScene | null {
    const r = this.scene.get('Room') as RoomScene | null;
    return r && r.player ? r : null;
  }

  private txt(x: number, y: number, s: string, size = 12, color = '#ffffff') {
    return this.add.text(x, y, s, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      color,
      stroke: '#0e0b14',
      strokeThickness: size >= 24 ? 6 : 3,
      lineSpacing: 6,
    });
  }

  private panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, border = 0x5c5274, fill = 0x15121c, a = 0.94) {
    g.fillStyle(0x0e0b14, a);
    g.fillRect(x - 3, y - 3, w + 6, h + 6);
    g.fillStyle(fill, a);
    g.fillRect(x, y, w, h);
    g.lineStyle(2, border, 1);
    g.strokeRect(x, y, w, h);
    g.fillStyle(0xffffff, 0.06);
    g.fillRect(x + 2, y + 2, w - 4, 2);
  }

  private icon(x: number, y: number, name: IconName, scale = 2) {
    return this.add.image(x, y, 'icons', String(ICON[name])).setScale(scale);
  }

  create(): void {
    this.g = this.add.graphics();
    this.hud = this.add.container(0, 0);
    this.gs = this.add.graphics();
    this.slotLayer = this.add.container(0, 0);
    this.slotLayer.add(this.gs);
    const t = (k: string, x: number, y: number, size = 12, color = '#ffffff') => {
      this.texts[k] = this.txt(x, y, '', size, color);
      this.hud.add(this.texts[k]);
      return this.texts[k];
    };
    t('hp', 46, 17);
    t('potion', 40, 54);
    t('gold', 112, 54, 12, toCss(C.gold0));
    t('essence', 196, 54, 12, '#d9b8ff');
    t('room', W - 12, 8).setOrigin(1, 0);
    t('objective', W - 12, 46, 12, '#c2bad6').setOrigin(1, 0).setAlign('right').setWordWrapWidth(200);
    t('hint', W - 12, H - 22, 12, '#7d7698').setOrigin(1, 0);
    t('skill', SLOT_X, H - 22, 12, '#c2bad6');
    t('emp', 0, 0, 12).setOrigin(0.5, 1);
    t('absorb', 0, 0, 12).setOrigin(0, 0.5);
    t('build', 14, H - 150, 12, '#e8e4f8');
    t('bossName', W / 2, 28, 12, toCss(C.fire0)).setOrigin(0.5, 0);
    t('bossShield', W / 2, 66, 12, '#ffffff').setOrigin(0.5, 0);
    this.hud.add(this.icon(26, 25, 'heart'));
    this.hud.add(this.icon(26, 61, 'potion'));
    this.hud.add(this.icon(98, 61, 'gold'));
    this.hud.add(this.icon(182, 61, 'essence'));
    const startX = SLOT_X;
    ELEMENTS.forEach((el, i) => {
      const img = this.icon(startX + i * (SLOT + GAP) + SLOT / 2, 0, el as IconName, 3);
      this.slotIcons.push(img);
      this.slotLayer.add(img);
      this.slotLayer.add(t(`key${i}`, 0, 0, 12, '#cfc8e8'));
      this.slotLayer.add(t(`cd${i}`, 0, 0, 12).setOrigin(0.5));
    });
    for (const k of ['skill', 'emp', 'absorb']) this.slotLayer.add(this.texts[k]);
    this.banner = this.txt(W / 2, 150, '', 24).setOrigin(0.5).setAlpha(0);

    this.game.events.on('banner', (text: string, color: number) => {
      this.banner.setText(text).setColor(toCss(color)).setAlpha(1).setScale(1);
      this.tweens.killTweensOf(this.banner);
      this.banner.setY(160);
      this.tweens.add({ targets: this.banner, y: 150, duration: 250, ease: 'Back.Out' });
      this.tweens.add({ targets: this.banner, alpha: 0, delay: 1300, duration: 500 });
    });
    this.game.events.on('ui:open', (req: UiRequest) => this.handleRequest(req));
    this.game.events.on('roomEnter', () => this.refreshRelicIcons());

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
      this.game.events.emit('banner', m ? '소리 끔' : '소리 켬', 0xcfc8e8);
    });

    if (!titleShown) this.openTitle();
  }

  // ───────────────────────── 오버레이 공통 ─────────────────────────

  private openOverlay(build: (c: Phaser.GameObjects.Container, g: Phaser.GameObjects.Graphics) => void, keys?: (k: string) => void, dim = 0.6) {
    this.closeOverlay(false);
    const c = this.add.container(0, 0);
    const g = this.add.graphics();
    g.fillStyle(0x07050b, dim);
    g.fillRect(0, 0, W, H);
    c.add(g);
    build(c, g);
    this.overlay = c;
    this.overlayKeys = keys ?? null;
    const r = this.room();
    if (r && this.scene.isActive('Room')) {
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

  private button(c: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, label: string, onClick: () => void, enabled = true, color = 0xffe08a) {
    const g = this.add.graphics();
    const draw = (hover: boolean) => {
      g.clear();
      g.fillStyle(enabled ? (hover ? 0x3a3150 : 0x261f36) : 0x1b1626, 1);
      g.fillRect(x, y, w, h);
      g.lineStyle(2, enabled ? color : 0x3e3552, 1);
      g.strokeRect(x, y, w, h);
    };
    draw(false);
    const t = this.txt(x + w / 2, y + h / 2, label, 12, enabled ? toCss(color) : '#5c5274').setOrigin(0.5);
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
    return { g, t, zone };
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
    this.openOverlay(
      (c, g) => {
        g.fillStyle(0x07050b, 0.35);
        g.fillRect(0, 0, W, H);
        const title = this.txt(W / 2, 150, '원소 저글러', 48, '#ffffff').setOrigin(0.5);
        c.add(title);
        ELEMENTS.forEach((el, i) => {
          const ic = this.icon(W / 2 - 108 + i * 72, 222, el as IconName, 4);
          c.add(ic);
          this.tweens.add({ targets: ic, y: 214, yoyo: true, repeat: -1, duration: 700, delay: i * 140, ease: 'Sine.InOut' });
        });
        c.add(this.txt(W / 2, 270, '원소 넷을 바꿔 끼우며 반응을 꽂는 액션 로그라이트', 12, '#c2bad6').setOrigin(0.5));
        const lines = [
          'WASD 이동 · 마우스 조준 · 좌클릭 공격 · 우클릭 스킬',
          '1 불 · 2 물 · 3 바람 · 4 번개 · 스페이스 구르기 · Q 포션 · E 상호작용',
        ];
        c.add(this.txt(W / 2, 320, lines.join('\n'), 12, '#e8e4f8').setOrigin(0.5).setAlign('center'));
        const go = this.txt(W / 2, 410, '클릭해서 시작', 24, '#ffe08a').setOrigin(0.5);
        this.tweens.add({ targets: go, alpha: 0.4, yoyo: true, repeat: -1, duration: 700 });
        c.add(go);
        c.add(this.txt(W / 2, H - 30, `원소 정수 ${meta.essence} · 도전 ${meta.runs}회 · 최고 기록 ${meta.bestDepth}층 · 승리 ${meta.wins}회`, 12, '#7d7698').setOrigin(0.5));
        const zone = this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();
        zone.on('pointerdown', () => {
          playSfx('select');
          this.closeOverlay();
        });
        c.add(zone);
      },
      () => {
        playSfx('select');
        this.closeOverlay();
      },
      0.2,
    );
  }

  // ───────────────────────── 반응 강화 3지선다 ─────────────────────────

  private openBoons(options: BoonDef[], source: 'reward' | 'shop') {
    const run = getRun();
    const pick = (b: BoonDef) => {
      this.closeOverlay();
      this.room()?.applyBoon(b.id, source);
    };
    this.openOverlay(
      (c) => {
        c.add(this.txt(W / 2, 64, '반응 강화 — 하나를 고르세요', 24, '#ffe08a').setOrigin(0.5));
        const cw = 236;
        const ch = 300;
        options.forEach((b, i) => {
          const x = W / 2 - (cw * options.length + 24 * (options.length - 1)) / 2 + i * (cw + 24);
          const y = 110;
          const col = reactionColor(b.reaction);
          const lv = run?.boons[b.id] ?? 0;
          const g = this.add.graphics();
          const draw = (hover: boolean) => {
            g.clear();
            this.panel(g, x, y + (hover ? -6 : 0), cw, ch, hover ? 0xffffff : col);
            g.fillStyle(col, 0.22);
            g.fillRect(x, y + (hover ? -6 : 0), cw, 64);
          };
          draw(false);
          c.add(g);
          const icons = this.reactionIcons(b.reaction);
          icons.forEach((n, k) => c.add(this.icon(x + cw / 2 + (k - (icons.length - 1) / 2) * 34, y + 32, n, 2)));
          c.add(this.txt(x + cw / 2, y + 84, b.name, 24, toCss(col)).setOrigin(0.5, 0));
          c.add(this.txt(x + cw / 2, y + 120, REACTION_NAME[b.reaction] ?? '', 12, '#a9a1c4').setOrigin(0.5, 0));
          c.add(this.txt(x + 18, y + 150, b.desc, 12, '#ffffff').setWordWrapWidth(cw - 36));
          c.add(this.txt(x + 18, y + ch - 76, `Lv ${lv} → ${lv + 1}  (최대 ${b.max})`, 12, '#c2bad6'));
          const before = reactionLevel(run, b.reaction);
          if (MASTERY_DESC[b.reaction] && before < 3 && before + 1 >= 3) {
            c.add(this.txt(x + 18, y + ch - 52, '★ ' + MASTERY_DESC[b.reaction], 12, '#ffe08a').setWordWrapWidth(cw - 36));
          }
          c.add(this.txt(x + cw - 14, y + 8, `${i + 1}`, 12, '#7d7698').setOrigin(1, 0));
          const zone = this.add.zone(x, y, cw, ch).setOrigin(0).setInteractive({ useHandCursor: true });
          zone.on('pointerover', () => {
            draw(true);
            playSfx('hover');
          });
          zone.on('pointerout', () => draw(false));
          zone.on('pointerdown', () => pick(b));
          c.add(zone);
        });
        this.button(c, W / 2 - 70, 440, 140, 34, '건너뛰기', () => {
          this.closeOverlay();
          this.room()?.skipReward(source);
        }, true, 0x8a84a8);
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
        c.add(this.txt(W / 2, 64, '유물 — 하나를 고르세요', 24, toCss(C.water0)).setOrigin(0.5));
        const cw = 236;
        const ch = 260;
        options.forEach((r, i) => {
          const x = W / 2 - (cw * options.length + 24 * (options.length - 1)) / 2 + i * (cw + 24);
          const y = 120;
          const g = this.add.graphics();
          const draw = (hover: boolean) => {
            g.clear();
            this.panel(g, x, y + (hover ? -6 : 0), cw, ch, hover ? 0xffffff : C.water1);
          };
          draw(false);
          c.add(g);
          c.add(this.icon(x + cw / 2, y + 56, r.icon, 4));
          c.add(this.txt(x + cw / 2, y + 108, r.name, 24, toCss(C.water0)).setOrigin(0.5, 0));
          c.add(this.txt(x + 18, y + 150, r.desc, 12, '#ffffff').setWordWrapWidth(cw - 36));
          c.add(this.txt(x + cw - 14, y + 8, `${i + 1}`, 12, '#7d7698').setOrigin(1, 0));
          const zone = this.add.zone(x, y, cw, ch).setOrigin(0).setInteractive({ useHandCursor: true });
          zone.on('pointerover', () => {
            draw(true);
            playSfx('hover');
          });
          zone.on('pointerout', () => draw(false));
          zone.on('pointerdown', () => pick(r));
          c.add(zone);
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
      this.panel(g, 40, 30, W - 80, H - 60, 0x9a6fd6);
      c.add(this.txt(W / 2, 44, '원소의 제단', 24, '#d9b8ff').setOrigin(0.5, 0));
      c.add(this.icon(W / 2 - 60, 98, 'essence', 2));
      c.add(this.txt(W / 2 - 44, 90, `원소 정수 ${meta.essence}`, 12, '#d9b8ff'));
      c.add(this.txt(70, 120, '캐릭터 스탯', 12, '#ffe08a'));
      META_DEF.stats.forEach((st, i) => {
        const y = 146 + i * 50;
        const lv = statLevel(st.id);
        const max = st.costs.length;
        const cost = statCost(st);
        const v = st.id === 'roll' ? 2 + lv : st.id === 'potion' ? 1 + lv : Math.round(st.per * lv * (st.fmt.includes('%') ? 100 : 10)) / (st.fmt.includes('%') ? 1 : 10);
        c.add(this.txt(70, y, st.name, 12));
        c.add(this.txt(70, y + 18, st.fmt.replace('{v}', String(v)).replace('{n}', String(v)), 12, '#a9a1c4'));
        const pg = this.add.graphics();
        for (let k = 0; k < max; k++) {
          pg.fillStyle(k < lv ? 0xd9b8ff : 0x3e3552);
          pg.fillRect(200 + k * 16, y + 4, 12, 12);
        }
        c.add(pg);
        this.button(
          c,
          300,
          y,
          120,
          30,
          cost === null ? '최대' : `강화 ${cost}`,
          () => {
            if (buyStat(st)) {
              playSfx('buy');
              this.openAltar();
            } else playSfx('deny');
          },
          cost !== null && meta.essence >= cost,
          0xd9b8ff,
        );
      });
      c.add(this.txt(480, 120, `2차 반응 해금 — 1차 반응 숙련 ${META_DEF.masteryRequired}회 + 정수 ${META_DEF.secondaryCost}`, 12, '#ffe08a'));
      DATA.secondary.forEach((sec, i) => {
        const y = 146 + i * 28;
        const stt = secondaryStatus(sec.id);
        const prim = primaryFor(sec.id);
        c.add(this.txt(480, y, sec.name, 12, stt.unlocked ? toCss(colorOf(sec.color)) : '#e8e4f8'));
        c.add(this.txt(580, y, `${DATA.residues[sec.residue!]}+${ELEMENT_NAME[sec.element as Element]}`, 12, '#8a84a8'));
        const pg = this.add.graphics();
        const frac = Math.min(1, stt.mastery / stt.need);
        pg.fillStyle(0x3e3552);
        pg.fillRect(690, y + 4, 90, 8);
        pg.fillStyle(prim ? colorOf(DATA.primary.find((p) => p.id === prim)!.color) : 0xffffff);
        pg.fillRect(690, y + 4, Math.round(90 * frac), 8);
        c.add(pg);
        c.add(this.txt(786, y, `${Math.min(stt.mastery, stt.need)}/${stt.need}`, 12, '#8a84a8'));
        if (stt.unlocked) c.add(this.txt(850, y, '해금됨', 12, '#9fe8a8'));
        else
          this.button(c, 846, y - 4, 64, 24, '해금', () => {
            if (buySecondary(sec.id)) {
              playSfx('select');
              const r = this.room();
              if (r) r.engine.secondaryUnlocked = new Set(meta.secondary);
              this.openAltar();
            } else playSfx('deny');
          }, stt.canBuy, 0xffe08a);
      });
      c.add(this.txt(480, 428, '숙련도는 런에서 해당 1차 반응을 일으킬 때마다 쌓여요.\n성소에서 T 키로 2차 반응을 미리 체험할 수 있어요.', 12, '#7d7698'));
      this.button(c, W / 2 - 60, H - 66, 120, 32, '닫기 (E)', () => this.closeOverlay(), true, 0xc2bad6);
      if (new URLSearchParams(location.search).has('dev')) {
        this.button(c, 60, H - 66, 150, 32, '개발: 메타 초기화', () => {
          Object.assign(meta, { essence: 0, stats: {}, secondary: [], mastery: {} });
          saveMeta();
          this.openAltar();
        }, true, 0xff5566);
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
    this.openOverlay(
      (c, g) => {
        this.panel(g, W / 2 - 260, 70, 520, 400, victory ? C.gold1 : C.fire2);
        c.add(this.txt(W / 2, 92, victory ? '잿빛 회랑 돌파!' : '쓰러졌어요', 36, victory ? toCss(C.gold0) : '#ff8a8a').setOrigin(0.5, 0));
        if (run) {
          const top = Object.entries(run.stats.byReaction)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([id, n]) => `${REACTION_NAME[id] ?? id} ${n}`)
            .join(' · ');
          const m = Math.floor(run.time / 60);
          const s = Math.floor(run.time % 60);
          const lines = [
            `도달: ${run.depth} / ${REGION.length}`,
            `시간: ${m}분 ${String(s).padStart(2, '0')}초`,
            `처치: ${run.stats.kills}    반응: ${run.stats.reactions}    완벽 회피: ${run.stats.perfect}`,
            `많이 쓴 반응: ${top || '없음'}`,
            `반응 강화 ${Object.values(run.boons).reduce((a, b) => a + b, 0)}개 · 유물 ${run.relics.length}개`,
          ];
          c.add(this.txt(W / 2, 160, lines.join('\n'), 12, '#e8e4f8').setOrigin(0.5, 0).setAlign('center'));
          c.add(this.icon(W / 2 - 80, 318, 'essence', 3));
          c.add(this.txt(W / 2 - 56, 306, `원소 정수 +${run.essence}`, 24, '#d9b8ff'));
          c.add(this.txt(W / 2, 352, '정수와 반응 숙련도는 성소에 남아요', 12, '#8a84a8').setOrigin(0.5, 0));
        }
        this.button(c, W / 2 - 100, 400, 200, 40, '성소로 돌아가기', () => {
          this.closeOverlay();
          r.finishRun(victory);
        });
      },
      (k) => {
        if (k === 'Enter' || k === ' ' || k === 'e' || k === 'E') {
          this.closeOverlay();
          r.finishRun(victory);
        }
      },
      0.7,
    );
  }

  // ───────────────────────── 도움말·일시정지 ─────────────────────────

  private openHelp() {
    const run = getRun();
    this.openOverlay(
      (c, g) => {
        this.panel(g, 40, 30, W - 80, H - 60);
        c.add(this.txt(W / 2, 44, '일시정지', 24).setOrigin(0.5, 0));
        const left = [
          '[ 조작 ]',
          'WASD 이동 · 마우스 조준',
          '좌클릭 기본 공격 · 우클릭 원소 스킬',
          '1 불 · 2 물 · 3 바람 · 4 번개',
          '스페이스 구르기 · Q 포션 · E 상호작용',
          'H/ESC 일시정지 · M 소리',
          '',
          '[ 핵심 규칙 ]',
          '· 일반 공격은 약해요. 딜은 반응에서',
          '· 전환 직후 첫 공격: 피해+50%, 부착 2배',
          '· 같은 원소 3번 → 중첩 반응',
          '· 공격 직전 0.15초 안에 구르면 완벽 회피',
          '  → 그 원소를 다음 공격에 실어요',
          '· 적 원소에 맞으면 나도 반응당해요',
          '· 지형은 나에게도 똑같이 적용돼요',
        ];
        c.add(this.txt(70, 90, left.join('\n'), 12, '#e8e4f8'));
        const right = [
          '[ 1차 반응 ]',
          '불+물 증발 · 물+번개 감전 · 물+바람 빙결',
          '불+바람 화염폭풍 · 번개+불 과부하',
          '바람+번개 뇌풍',
          '',
          '[ 지형 ]',
          '웅덩이+번개 전기장 · 웅덩이+바람 얼음',
          '마른 풀+불 들불 · 통로+불/번개',
          '',
          '[ 이번 런 ]',
        ];
        if (run) {
          const boons = BOONS.filter((b) => run.boons[b.id]).map((b) => `${b.name} Lv${run.boons[b.id]}`);
          right.push(boons.length ? boons.join(', ') : '반응 강화 없음');
          const rel = RELICS.filter((r) => run.relics.includes(r.id)).map((r) => r.name);
          right.push(rel.length ? '유물: ' + rel.join(', ') : '유물 없음');
        } else right.push('성소에 있어요');
        c.add(this.txt(500, 90, right.join('\n'), 12, '#e8e4f8').setWordWrapWidth(400));
        this.button(c, W / 2 - 70, H - 80, 140, 34, '계속하기', () => this.closeOverlay(), true, 0xc2bad6);
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
      const img = this.icon(28 + i * 30, 116, r.icon, 2);
      this.relicIcons.push(img);
      this.hud.add(img);
    });
  }

  // ───────────────────────── HUD ─────────────────────────

  update(): void {
    const r = this.room();
    const g = this.g;
    g.clear();
    for (const o of this.dyn) o.destroy();
    this.dyn = [];
    this.hud.setVisible(!!r);
    this.slotLayer.setVisible(!!r);
    if (!r) return;
    const p = r.player;
    const run = r.run;
    const T = this.texts;

    // HP
    const hpW = 200;
    g.fillStyle(0x0e0b14, 0.9);
    g.fillRect(40, 14, hpW + 6, 22);
    g.fillStyle(0x4a1a24);
    g.fillRect(43, 17, hpW, 16);
    g.fillStyle(C.blood);
    g.fillRect(43, 17, Math.round(hpW * Math.max(0, p.hp / p.maxHp)), 16);
    g.fillStyle(0xffffff, 0.25);
    g.fillRect(43, 17, Math.round(hpW * Math.max(0, p.hp / p.maxHp)), 3);
    T.hp.setText(`${Math.ceil(p.hp)} / ${p.maxHp}`).setPosition(52, 18);
    T.potion.setText(`${p.potions}`).setPosition(40, 54);
    T.gold.setText(run ? `${run.gold}` : '-');
    T.essence.setText(run ? `${run.essence}` : `${meta.essence}`);

    // 구르기
    for (let i = 0; i < p.rollMax; i++) {
      const x = 20 + i * 18;
      g.lineStyle(2, 0xcfc8e8, 0.9);
      g.strokeRect(x, 80, 12, 12);
      if (i < p.rollCharges) {
        g.fillStyle(0xcfc8e8);
        g.fillRect(x + 2, 82, 8, 8);
      } else if (i === p.rollCharges) {
        g.fillStyle(0xcfc8e8, 0.5);
        const f = p.rollRecharge / 1.1;
        g.fillRect(x + 2, 90 - 8 * f, 8, 8 * f);
      }
    }

    // 원소 슬롯
    const startX = SLOT_X;
    const gs = this.gs;
    gs.clear();
    const baseY = H - SLOT - 32;
    ELEMENTS.forEach((el, i) => {
      const sel = p.element === el;
      const x = startX + i * (SLOT + GAP);
      const y = baseY - (sel ? 8 : 0);
      const col = ELEMENT_COLOR[el];
      gs.fillStyle(0x0e0b14, 0.9);
      gs.fillRect(x - 2, y - 2, SLOT + 4, SLOT + 4);
      gs.fillStyle(sel ? 0x2a2140 : 0x15121c, 0.95);
      gs.fillRect(x, y, SLOT, SLOT);
      if (sel) {
        gs.fillStyle(col, 0.2);
        gs.fillRect(x, y, SLOT, SLOT);
      }
      gs.lineStyle(sel ? 3 : 2, col, sel ? 1 : 0.5);
      gs.strokeRect(x, y, SLOT, SLOT);
      this.slotIcons[i].setPosition(x + SLOT / 2, y + SLOT / 2).setAlpha(sel ? 1 : 0.6);
      const cd = p.skillCd[el];
      if (cd > 0) {
        gs.fillStyle(0x000000, 0.6);
        gs.fillRect(x, y, SLOT, Math.round(SLOT * Math.min(1, cd / SKILL_COOLDOWN[el])));
      }
      T[`key${i}`].setPosition(x + 4, y + 2).setText(String(i + 1));
      T[`cd${i}`].setPosition(x + SLOT / 2, y + SLOT - 12).setText(cd > 0 ? cd.toFixed(1) : '');
      if (sel) T.emp.setPosition(x + SLOT / 2, y - 6).setText('전환 강화').setColor(toCss(col)).setVisible(p.empowered > 0);
    });
    const barW = SLOT * 4 + GAP * 3;
    if (p.switchCd > 0) {
      gs.fillStyle(0xcfc8e8, 0.7);
      gs.fillRect(startX, baseY + SLOT + 6, Math.round(barW * (p.switchCd / 0.5)), 3);
    }
    T.skill.setText(`우클릭: ${SKILL_NAME[p.element]}`).setPosition(startX, baseY + SLOT + 12);
    if (p.absorbed) {
      const ax = startX + barW + 24;
      const ay = baseY + SLOT / 2;
      gs.fillStyle(ELEMENT_COLOR[p.absorbed]);
      gs.fillCircle(ax, ay, 8);
      T.absorb.setPosition(ax + 14, ay).setText(`흡수: ${ELEMENT_NAME[p.absorbed]}`).setColor(toCss(ELEMENT_COLOR[p.absorbed])).setVisible(true);
    } else T.absorb.setVisible(false);

    // 캐릭터가 UI 뒤에 있으면 반투명
    const psx = p.x * RENDER_SCALE;
    const psy = p.y * RENDER_SCALE;
    const behind = psx > startX - 30 && psx < startX + barW + 140 && psy > baseY - 70;
    this.slotLayer.setAlpha(Phaser.Math.Linear(this.slotLayer.alpha, behind ? 0.3 : 1, 0.2));

    // 방 이름·진행도·목표
    T.room.setText(r.roomName);
    const bossUp = !!(r.boss && !r.boss.dead);
    if (run && !bossUp) {
      const n = REGION.length;
      for (let i = 1; i <= n; i++) {
        const x = W - 12 - (n - i + 1) * 14 + 4;
        g.fillStyle(i < run.depth ? 0x9a8fb8 : i === run.depth ? 0xffe08a : 0x3e3552);
        if (i === n) g.fillStyle(i <= run.depth ? C.fire1 : 0x5a2a2a);
        g.fillRect(x, 30, 8, 4);
      }
    }
    T.objective.setText(bossUp ? '' : this.objective(r)).setY(run ? 40 : 28);

    // 빌드 (반응 강화)
    if (run) {
      const lines = BOONS.filter((b) => run.boons[b.id]).map((b) => `${b.name} ${'●'.repeat(run.boons[b.id])}`);
      T.build.setText(lines.slice(0, 8).join('\n')).setY(H - 116 - lines.slice(0, 8).length * 18);
    } else T.build.setText('');

    // 보스 체력바
    const boss = r.boss;
    if (boss && !boss.dead) {
      const bw = 420;
      const bx = W / 2 - bw / 2;
      g.fillStyle(0x0e0b14, 0.9);
      g.fillRect(bx - 3, 45, bw + 6, 18);
      g.fillStyle(0x3a1414);
      g.fillRect(bx, 48, bw, 12);
      g.fillStyle(boss.shieldReaction ? 0x9a7f7f : C.fire1);
      g.fillRect(bx, 48, Math.round(bw * (boss.hp / boss.maxHp)), 12);
      g.fillStyle(0xffffff, 0.2);
      g.fillRect(bx, 48, Math.round(bw * (boss.hp / boss.maxHp)), 3);
      for (const f of [0.6, 0.25]) {
        g.fillStyle(0x0e0b14);
        g.fillRect(bx + Math.round(bw * f), 48, 2, 12);
      }
      T.bossName.setText(`${boss.displayName} · ${boss.phase}페이즈`).setVisible(true);
      const sd = boss.shieldDef;
      T.bossShield
        .setText(sd ? `원소 실드 — [${sd.name}]으로 파괴` : boss.staggered ? '실드 파괴! 지금 공격!' : '')
        .setColor(sd ? toCss(colorOf(sd.color)) : '#ffe08a')
        .setVisible(true);
    } else {
      T.bossName.setVisible(false);
      T.bossShield.setVisible(false);
    }

    T.hint.setText(r.mode === 'hub' ? 'T 2차 반응 체험 · H 일시정지 · M 소리' : 'H 일시정지 · M 소리');
  }

  private objective(r: RoomScene): string {
    if (r.mode === 'hub') return r.trial ? '2차 반응 체험 중 — 허수아비에 연계해 보세요' : '포탈로 출발 · 제단에서 성장\n허수아비로 연습';
    if (r.state === 'dead') return '';
    if (r.mode === 'boss') return r.state === 'victory' ? '승리!' : '잿불 골렘을 쓰러뜨리세요';
    if (r.state === 'play') return `웨이브 ${r.waveIdx}/${r.waveCount} · 남은 적 ${r.enemies.filter((e) => !e.dead).length}`;
    if (r.pickups.some((p) => p.kind === 'reward')) return '보상을 받으세요 (E)';
    if (r.doors.some((d) => d.open)) return '문을 골라 다음 방으로\n문 위 아이콘 = 다음 보상';
    return '';
  }
}
