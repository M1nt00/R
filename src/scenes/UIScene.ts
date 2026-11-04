import Phaser from 'phaser';
import type { RoomScene } from './RoomScene';
import { FONT, VIEW_W, VIEW_H, RENDER_SCALE } from '../config';
import { ELEMENTS, ELEMENT_NAME } from '../element/types';
import { ELEMENT_COLOR, toCss } from '../art/palette';
import { DATA } from '../element/data';
import { SKILL_COOLDOWN } from '../combat/attacks';
import { toggleMute } from '../audio/sfx';

const W = VIEW_W * RENDER_SCALE;
const H = VIEW_H * RENDER_SCALE;
const SLOT = 58;
const GAP = 10;
const SKILL_NAME = { fire: '화염 돌진', water: '물웅덩이', wind: '회오리', lightning: '순간이동' } as const;

/** HUD (960×540 화면 좌표, 줌 1 — 한글이 선명하게) */
export class UIScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private secText!: Phaser.GameObjects.Text;
  private empText!: Phaser.GameObjects.Text;
  private absorbText!: Phaser.GameObjects.Text;
  private slotKeys: Phaser.GameObjects.Text[] = [];
  private slotNames: Phaser.GameObjects.Text[] = [];
  private slotCd: Phaser.GameObjects.Text[] = [];
  private banner!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Container;
  private death!: Phaser.GameObjects.Container;
  private deathStats!: Phaser.GameObjects.Text;

  constructor() {
    super('UI');
  }

  private room(): RoomScene | null {
    const r = this.scene.get('Room') as RoomScene | null;
    return r && r.player ? r : null;
  }

  private txt(x: number, y: number, s: string, size: number, color = '#ffffff', bold = true) {
    return this.add.text(x, y, s, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      fontStyle: bold ? 'bold' : 'normal',
      color,
      stroke: '#0d0b12',
      strokeThickness: 4,
    });
  }

  create(): void {
    this.g = this.add.graphics();
    this.hpText = this.txt(24, 18, '', 14);
    this.info = this.txt(W - 20, 16, '', 15).setOrigin(1, 0).setAlign('right');
    this.hint = this.txt(16, H - 26, 'H 도움말 · T 2차 반응(테스트) · M 소리', 12, '#8a85a0', false);
    this.secText = this.txt(W / 2, 14, '', 13, '#ffe0a0').setOrigin(0.5, 0);
    this.empText = this.txt(0, 0, '전환 강화', 13).setOrigin(0.5, 1);
    this.absorbText = this.txt(0, 0, '', 13).setOrigin(0, 0.5);

    const startX = W / 2 - (SLOT * 4 + GAP * 3) / 2;
    ELEMENTS.forEach((el, i) => {
      const x = startX + i * (SLOT + GAP);
      this.slotKeys.push(this.txt(x + 5, 0, String(i + 1), 12, '#cfc8e8'));
      this.slotNames.push(this.txt(x + SLOT / 2, 0, ELEMENT_NAME[el], 13, toCss(ELEMENT_COLOR[el])).setOrigin(0.5, 0));
      this.slotCd.push(this.txt(x + SLOT / 2, 0, '', 15).setOrigin(0.5));
    });

    this.banner = this.txt(W / 2, 110, '', 30).setOrigin(0.5).setAlpha(0);
    this.buildHelp();
    this.buildDeath();

    this.game.events.on('banner', (text: string, color: number) => {
      this.banner.setText(text).setColor(toCss(color)).setAlpha(1).setScale(1.3);
      this.tweens.killTweensOf(this.banner);
      this.tweens.add({ targets: this.banner, scale: 1, duration: 200, ease: 'Back.Out' });
      this.tweens.add({ targets: this.banner, alpha: 0, delay: 1100, duration: 500 });
    });
    this.game.events.on('playerDead', () => {
      const r = this.room();
      if (!r) return;
      const top = Object.entries(r.stats.byReaction)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, n]) => `${this.reactionName(id)} ${n}회`)
        .join(' · ');
      this.deathStats.setText(
        `WAVE ${r.waves.wave} · 처치 ${r.stats.kills} · 반응 ${r.stats.reactions} · 완벽 회피 ${r.stats.perfectDodges}\n` +
          (top ? `많이 쓴 반응: ${top}` : '반응을 한 번도 못 터뜨렸어요'),
      );
      this.time.delayedCall(600, () => this.death.setVisible(true));
    });

    const kb = this.input.keyboard!;
    kb.on('keydown-H', () => this.toggleHelp());
    kb.on('keydown-ENTER', () => {
      if (this.help.visible) this.toggleHelp();
    });
    kb.on('keydown-R', () => {
      const r = this.room();
      if (r && r.state === 'dead') {
        this.death.setVisible(false);
        r.scene.restart();
      }
    });
    kb.on('keydown-T', () => {
      const r = this.room();
      if (!r) return;
      r.setSecondaryUnlocked(!r.engine.secondaryUnlocked);
      this.game.events.emit('banner', r.engine.secondaryUnlocked ? '2차 반응 해금 (테스트)' : '2차 반응 잠금', 0xffe0a0);
    });
    kb.on('keydown-M', () => {
      const m = toggleMute();
      this.game.events.emit('banner', m ? '소리 끔' : '소리 켬', 0xcfc8e8);
    });
    this.input.on('pointerdown', () => {
      if (this.help.visible) this.toggleHelp();
    });
  }

  private reactionName(id: string): string {
    return [...DATA.primary, ...DATA.stack, ...DATA.secondary].find((r) => r.id === id)?.name ?? id;
  }

  private toggleHelp(): void {
    const r = this.room();
    const show = !this.help.visible;
    this.help.setVisible(show);
    if (!r) return;
    if (!show && r.state === 'intro') {
      r.startRun();
      return;
    }
    if (r.state === 'playing') {
      if (show) this.scene.pause('Room');
      else this.scene.resume('Room');
    }
  }

  private buildHelp(): void {
    const c = this.add.container(0, 0);
    const bg = this.add.rectangle(W / 2, H / 2, W - 80, H - 60, 0x0d0b12, 0.94).setStrokeStyle(2, 0x5a5478);
    c.add(bg);
    const title = this.txt(W / 2, 48, '원소 저글러 — 반응 엔진 프로토타입', 22).setOrigin(0.5, 0);
    const left = [
      '[ 조작 ]',
      'WASD 이동 · 마우스 조준',
      '좌클릭 기본 공격 · 우클릭 원소 스킬',
      '1 불 · 2 물 · 3 바람 · 4 번개',
      '스페이스 구르기 (무적 0.3초, 2회 충전)',
      '',
      '[ 핵심 규칙 ]',
      '· 일반 공격은 약해요. 딜은 반응에서 나와요',
      '· 맞은 대상에 원소가 3초 부착',
      '· 전환 직후 첫 공격: 피해 +50%, 부착 6초',
      '· 같은 원소 3번 → 중첩 반응',
      '· 공격 직전 0.15초 안에 구르면 완벽 회피',
      '  → 그 원소를 빼앗아 다음 공격에 실어요',
      '· 적 원소에 맞으면 나도 반응당해요',
      '· 지형은 나에게도 똑같이 적용돼요',
    ];
    const right = [
      '[ 1차 반응 ]',
      '불+물 증발 — 단일 큰 피해',
      '물+번개 감전 — 주변 연쇄',
      '물+바람 빙결 — 2초 정지',
      '불+바람 화염폭풍 — 불길 장판',
      '번개+불 과부하 — 폭발 넉백',
      '바람+번개 뇌풍 — 한 점으로 몰기',
      '',
      '[ 중첩 ×3 ]  작열 · 침수 · 돌풍 · 과전류',
      '',
      '[ 지형 ]',
      '웅덩이+번개 전기장 · 웅덩이+바람 얼음',
      '마른 풀+불 들불 · 통로+불/번개',
      '',
      'T: 2차 반응 10종 테스트 해금',
    ];
    c.add(title);
    c.add(this.txt(80, 92, left.join('\n'), 14, '#e8e4f8', false).setLineSpacing(4));
    c.add(this.txt(W / 2 + 30, 92, right.join('\n'), 14, '#e8e4f8', false).setLineSpacing(4));
    c.add(this.txt(W / 2, H - 52, '클릭 또는 H 키로 시작', 18, '#ffe0a0').setOrigin(0.5));
    this.help = c;
  }

  private buildDeath(): void {
    const c = this.add.container(0, 0);
    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6));
    c.add(this.txt(W / 2, H / 2 - 60, '쓰러졌어요', 34, '#ff8a8a').setOrigin(0.5));
    this.deathStats = this.txt(W / 2, H / 2, '', 16, '#e8e4f8', false).setOrigin(0.5).setAlign('center').setLineSpacing(6);
    c.add(this.deathStats);
    c.add(this.txt(W / 2, H / 2 + 70, 'R 키로 다시 시작', 18, '#ffe0a0').setOrigin(0.5));
    c.setVisible(false);
    this.death = c;
  }

  update(): void {
    const r = this.room();
    const g = this.g;
    g.clear();
    if (!r) return;
    const p = r.player;

    // HP
    const hpW = 220;
    g.fillStyle(0x0d0b12, 0.85);
    g.fillRect(14, 14, hpW + 4, 22);
    g.fillStyle(0x4a1a24);
    g.fillRect(16, 16, hpW, 18);
    g.fillStyle(0xff5566);
    g.fillRect(16, 16, hpW * Math.max(0, p.hp / p.maxHp), 18);
    this.hpText.setText(`HP ${Math.ceil(p.hp)} / ${p.maxHp}`).setPosition(24, 17);

    // 구르기 충전
    for (let i = 0; i < p.rollMax; i++) {
      const x = 26 + i * 22;
      const y = 50;
      g.lineStyle(2, 0xcfc8e8, 0.9);
      g.strokeRect(x - 7, y - 7, 14, 14);
      if (i < p.rollCharges) {
        g.fillStyle(0xcfc8e8);
        g.fillRect(x - 5, y - 5, 10, 10);
      } else if (i === p.rollCharges) {
        g.fillStyle(0xcfc8e8, 0.4);
        g.fillRect(x - 5, y + 5 - 10 * (p.rollRecharge / 1.1), 10, 10 * (p.rollRecharge / 1.1));
      }
    }

    // 원소 슬롯
    const startX = W / 2 - (SLOT * 4 + GAP * 3) / 2;
    const baseY = H - SLOT - 30;
    ELEMENTS.forEach((el, i) => {
      const sel = p.element === el;
      const x = startX + i * (SLOT + GAP);
      const y = baseY - (sel ? 8 : 0);
      const c = ELEMENT_COLOR[el];
      g.fillStyle(0x15121c, 0.9);
      g.fillRect(x, y, SLOT, SLOT);
      if (sel) {
        g.fillStyle(c, 0.18);
        g.fillRect(x, y, SLOT, SLOT);
      }
      g.lineStyle(sel ? 3 : 1.5, c, sel ? 1 : 0.6);
      g.strokeRect(x, y, SLOT, SLOT);
      const cx = x + SLOT / 2;
      const cy = y + SLOT / 2 - 6;
      g.fillStyle(c);
      g.fillPoints([{ x: cx, y: cy - 10 }, { x: cx + 10, y: cy }, { x: cx, y: cy + 10 }, { x: cx - 10, y: cy }], true);
      const cd = p.skillCd[el];
      if (cd > 0) {
        g.fillStyle(0x000000, 0.6);
        g.fillRect(x, y, SLOT, SLOT * (cd / SKILL_COOLDOWN[el]));
      }
      this.slotKeys[i].setPosition(x + 5, y + 3);
      this.slotNames[i].setPosition(cx, y + SLOT - 20);
      this.slotCd[i].setPosition(cx, cy).setText(cd > 0 ? cd.toFixed(1) : '');
      if (sel) {
        this.empText.setPosition(cx, y - 4).setColor(toCss(c)).setVisible(p.empowered);
      }
    });
    // 전환 쿨다운
    const barW = SLOT * 4 + GAP * 3;
    if (p.switchCd > 0) {
      g.fillStyle(0xcfc8e8, 0.7);
      g.fillRect(startX, baseY + SLOT + 6, barW * (p.switchCd / 0.5), 3);
    }
    // 흡수 원소
    if (p.absorbed) {
      const ax = startX + barW + 22;
      const ay = baseY + SLOT / 2;
      const c = ELEMENT_COLOR[p.absorbed];
      g.fillStyle(c);
      g.fillCircle(ax, ay, 8);
      this.absorbText.setPosition(ax + 14, ay).setText(`흡수: ${ELEMENT_NAME[p.absorbed]}`).setColor(toCss(c)).setVisible(true);
    } else this.absorbText.setVisible(false);

    // 스킬 이름 (현재 원소)
    this.info.setText(
      `WAVE ${r.waves.wave}\n처치 ${r.stats.kills} · 반응 ${r.stats.reactions}\n우클릭: ${SKILL_NAME[p.element]}`,
    );
    this.secText.setText(r.engine.secondaryUnlocked ? '2차 반응 해금됨 (테스트)' : '');
  }
}
