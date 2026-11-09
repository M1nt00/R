import Phaser from 'phaser';
import { FONT_S, FONT_M, FONT_L } from '../config';
import { E32, toCss } from '../art/palette';
import { playSfx, toggleMute, isMuted } from '../audio/sfx';
import { addStars, drawPlanet, surfaceColor } from '../art/planet';

/** 오른쪽에서 도는 행성 (화면 좌표, 반지름) */
const PLANET = { x: 330, y: 138, r: 78 };
const TILT = 0.42;
const SPIN = 0.00022; // rad/ms → 한 바퀴 약 29초
/** 시작하기를 누르면 나오는 이야기 (한 칸이 한 장, 한 줄은 20자 안쪽) */
const STORY = [
  '아르고스.\n보랏빛 하늘 아래,\n사람은 숨 쉴 수 없는 행성.',
  '이곳의 공기는 아르곤뿐이었다.\n불을 붙여도 타지 않는,\n조용하고 게으른 공기.',
  '그래서 사람들은\n한 사람을 보냈다.\n산소탑을 세울 사람을.',
  '탑이 하나 설 때마다\n이 땅은 조금씩\n숨 쉴 수 있는 곳이 된다.',
  '하지만 아무도 몰랐다.\n이 행성에도\n주인이 있다는 것을.',
  '그들에게 산소는 독이었다.\n밤이 오면,\n그들은 탑을 향해 몰려온다.',
  '손에 든 건 시약 몇 병.\n그리고 화학.\n\n첫 번째 밤이 다가온다.',
];
/** 기울어진 축으로 도는 행성. 구름은 땅보다 조금 빨리 흐른다 */
function drawSpinningPlanet(data: Uint8ClampedArray, size: number, r: number, t: number) {
  const ang = t * SPIN, ca = Math.cos(ang), sa = Math.sin(ang);
  const cc = Math.cos(ang * 0.6), cs = Math.sin(ang * 0.6);
  const ct = Math.cos(TILT), st = Math.sin(TILT);
  drawPlanet(data, size, r, (vx, vy, vz, lv) => {
    const y = vy * ct + vz * st, z1 = -vy * st + vz * ct;
    const x = vx * ca - z1 * sa, z = vx * sa + z1 * ca;
    return surfaceColor(x, y, z, x * cc - z * cs, x * cs + z * cc, lv);
  });
}

/** 메인 화면: 제목, 메뉴, 도는 행성 아르고스 */
export class TitleScene extends Phaser.Scene {
  private planet!: Phaser.Textures.CanvasTexture;
  private img!: ImageData;
  private lastDraw = -1e9;
  private sel = 0;
  private mode: 'menu' | 'story' | 'done' = 'menu';
  private page = 0;
  private typing: Phaser.Time.TimerEvent | null = null;
  private storyText!: Phaser.GameObjects.Text;

  constructor() {
    super('Title');
  }

  create(): void {
    addStars(this);

    const size = PLANET.r * 2 + 3;
    if (this.textures.exists('planet')) this.textures.remove('planet');
    this.planet = this.textures.createCanvas('planet', size, size)!;
    this.img = this.planet.getContext().createImageData(size, size);
    this.add.image(PLANET.x, PLANET.y, 'planet');

    this.add.text(36, 74, '아르고스', { fontFamily: FONT_L, fontSize: '24px', color: toCss(E32.white) }).setShadow(2, 2, toCss(E32.plum), 0, false, true);
    this.add.text(37, 108, 'ARGOS · 숨 쉴 수 없는 행성', { fontFamily: FONT_S, fontSize: '8px', color: toCss(E32.steel) });

    const items = [
      { label: () => '시작하기', run: (): void => this.beginStory(texts) },
      { label: () => `소리: ${isMuted() ? '끔' : '켬'}`, run: () => toggleMute() },
    ];
    const arrow = this.add.graphics();
    this.tweens.add({ targets: arrow, alpha: 0.3, yoyo: true, repeat: -1, duration: 500, ease: 'Stepped', easeParams: [2] });
    const texts = items.map((it, i) => {
      const t = this.add.text(48, 156 + i * 22, it.label(), { fontFamily: FONT_L, fontSize: '12px' }).setShadow(1, 1, toCss(E32.black), 0, false, true);
      t.setInteractive({ useHandCursor: true })
        .on('pointerover', () => select(i))
        .on('pointerup', () => choose());
      return t;
    });
    const refresh = () => {
      texts.forEach((t, i) => t.setText(items[i].label()).setColor(toCss(i === this.sel ? E32.amber : E32.silver)));
      const y = texts[this.sel].y + 3;
      arrow.clear().fillStyle(E32.amber, 1).fillTriangle(38, y, 38, y + 7, 42, y + 3.5);
    };
    const select = (i: number) => {
      if (i === this.sel) return;
      this.sel = i;
      playSfx('hover');
      refresh();
    };
    const choose = () => {
      playSfx('select');
      items[this.sel].run();
      if (this.mode === 'menu') refresh();
    };
    refresh();

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      const ok = k === 'enter' || k === ' ' || k === 'e';
      if (this.mode === 'story') {
        if (k === 'escape') this.toZoneSelect();
        else if (ok) this.nextPage();
      } else if (this.mode === 'menu') {
        if (k === 'arrowup' || k === 'w') select((this.sel + items.length - 1) % items.length);
        else if (k === 'arrowdown' || k === 's') select((this.sel + 1) % items.length);
        else if (ok) choose();
      }
    });
    // 시작하기를 누른 클릭의 pointerup이 첫 장을 넘기지 않게 pointerdown으로 받는다
    this.input.on('pointerdown', () => this.mode === 'story' && this.nextPage());
  }

  /** 화면을 검게 덮은 뒤 가운데에 이야기를 띄운다 */
  private beginStory(texts: Phaser.GameObjects.Text[]) {
    this.mode = 'story';
    texts.forEach((t) => t.disableInteractive());
    const { width, height } = this.scale;
    const black = this.add.rectangle(0, 0, width, height, E32.black).setOrigin(0).setAlpha(0);
    this.tweens.add({ targets: black, alpha: 1, duration: 800 });
    // 검게 덮인 뒤 첫 장 (그 전에 누른 클릭은 storyText가 없어서 무시됨)
    this.time.delayedCall(900, () => {
      this.add.text(width / 2, 250, '클릭·Enter 다음  ·  Esc 건너뛰기', { fontFamily: FONT_S, fontSize: '8px', color: toCss(E32.slate) }).setOrigin(0.5, 0);
      this.storyText = this.add.text(0, 0, '', { fontFamily: FONT_M, fontSize: '10px', color: toCss(E32.silver), lineSpacing: 6 });
      this.showPage(0);
    });
  }

  /** 한 장을 타자 치듯 한 글자씩 */
  private showPage(i: number) {
    this.page = i;
    const full = STORY[i];
    // 다 친 모양으로 재서 화면 가운데에 두고, 줄은 왼쪽 정렬 (치는 동안 글자가 흔들리지 않게)
    this.storyText.setText(full);
    this.storyText.setPosition(Math.round((this.scale.width - this.storyText.width) / 2), Math.round((this.scale.height - this.storyText.height) / 2));
    this.storyText.setText('');
    let n = 0;
    this.typing = this.time.addEvent({
      delay: 40,
      repeat: full.length - 1,
      callback: () => {
        this.storyText.setText(full.slice(0, ++n));
        if (n >= full.length) this.typing = null;
      },
    });
  }

  /** 치는 중이면 그 장을 다 보여 주고, 다 보였으면 다음 장 (마지막 장 다음은 게임) */
  private nextPage() {
    if (!this.storyText) return;
    if (this.typing) {
      this.typing.remove();
      this.typing = null;
      this.storyText.setText(STORY[this.page]);
      return;
    }
    playSfx('select');
    if (this.page + 1 < STORY.length) this.showPage(this.page + 1);
    else this.toZoneSelect();
  }

  private toZoneSelect() {
    if (this.mode === 'done') return;
    this.mode = 'done';
    this.scene.start('Zones');
  }

  update(time: number): void {
    // 행성은 천천히 돌아서 30fps로만 다시 그린다
    if (time - this.lastDraw < 33) return;
    this.lastDraw = time;
    drawSpinningPlanet(this.img.data, this.img.width, PLANET.r, time);
    this.planet.getContext().putImageData(this.img, 0, 0);
    this.planet.refresh();
  }
}
