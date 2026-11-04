// 개발용: 주인공 템플릿 PNG 만들기 (npm run dev → /dev/export.html)
import Phaser from 'phaser';
import { SPRITE_PIXELS, NONE, type Px } from '../src/art/pixel';
import { buildHeroSprites, DIRS, ORDER, DURS, HERO_SHEET_COLS, heroCell } from '../src/art/heroSprites';

const DIR_NAME: Record<string, string> = { down: '아래(정면)', up: '위(뒷모습)', side: '옆(오른쪽)' };
const ANIM_NAME: Record<string, string> = {
  idle: '대기', run: '달리기', roll: '구르기', attack: '내려베기', attack2: '올려베기', cast: '시전', hurt: '피격', death: '사망',
};

function sheetCanvas(frames: Px[], alpha = 1): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = HERO_SHEET_COLS * 32;
  cv.height = DIRS.length * ORDER.length * 32;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(cv.width, cv.height);
  let i = 0;
  DIRS.forEach((_, di) =>
    ORDER.forEach((anim, ai) => {
      for (let f = 0; f < DURS[anim].length; f++, i++) {
        const { col, row } = heroCell(di, ai, f);
        const p = frames[i];
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 32; x++) {
            const c = p.d[y * 32 + x];
            if (c === NONE) continue;
            const o = ((row * 32 + y) * cv.width + col * 32 + x) * 4;
            img.data[o] = (c >> 16) & 255;
            img.data[o + 1] = (c >> 8) & 255;
            img.data[o + 2] = c & 255;
            img.data[o + 3] = Math.round(255 * alpha);
          }
      }
    }),
  );
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** 4배 확대 가이드: 칸·발밑선·중심선·20×26 영역·이름표 + 현재 그림을 흐리게 */
function guideCanvas(body: Px[], elem: Px[]): HTMLCanvasElement {
  const S = 4;
  const LABEL = 150;
  const rows = DIRS.length * ORDER.length;
  const cv = document.createElement('canvas');
  cv.width = LABEL + HERO_SHEET_COLS * 32 * S;
  cv.height = rows * 32 * S + 40;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#262b44';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px sans-serif';
  ctx.fillText('주인공 템플릿 — 칸 32×32 · 빨간선 = 발밑(y=26) · 노란선 = 중심(x=16) · 초록 상자 = 캐릭터 영역 약 20×26', 8, 24);
  const top = 40;
  const ghostB = sheetCanvas(body, 0.35);
  const ghostE = sheetCanvas(elem, 0.35);
  ctx.drawImage(ghostB, LABEL, top, ghostB.width * S, ghostB.height * S);
  ctx.drawImage(ghostE, LABEL, top, ghostE.width * S, ghostE.height * S);
  DIRS.forEach((dir, di) =>
    ORDER.forEach((anim, ai) => {
      const row = di * ORDER.length + ai;
      const y0 = top + row * 32 * S;
      ctx.fillStyle = '#c0cbdc';
      ctx.fillText(`${DIR_NAME[dir]} · ${ANIM_NAME[anim]}`, 8, y0 + 60);
      ctx.fillStyle = '#8b9bb4';
      ctx.fillText(DURS[anim].map((d) => `${Math.round(d * 1000)}`).join('/') + 'ms', 8, y0 + 80);
      for (let f = 0; f < HERO_SHEET_COLS; f++) {
        const x0 = LABEL + f * 32 * S;
        const used = f < DURS[anim].length;
        ctx.strokeStyle = used ? '#5a6988' : '#3a4466';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, 32 * S - 1, 32 * S - 1);
        if (!used) {
          ctx.fillStyle = 'rgba(24,20,37,0.7)';
          ctx.fillRect(x0 + 1, y0 + 1, 32 * S - 2, 32 * S - 2);
          continue;
        }
        ctx.strokeStyle = 'rgba(99,199,77,0.6)';
        ctx.strokeRect(x0 + 6 * S + 0.5, y0 + 1 * S + 0.5, 20 * S, 26 * S);
        ctx.fillStyle = 'rgba(228,59,68,0.8)';
        ctx.fillRect(x0, y0 + 27 * S, 32 * S, 1);
        ctx.fillStyle = 'rgba(254,231,97,0.5)';
        ctx.fillRect(x0 + 16 * S, y0, 1, 32 * S);
        ctx.fillStyle = '#8b9bb4';
        ctx.fillText(String(f), x0 + 4, y0 + 16);
      }
    }),
  );
  return cv;
}

class Exporter extends Phaser.Scene {
  create() {
    buildHeroSprites(this);
    const body = SPRITE_PIXELS.get('hero_body')!;
    const elem = SPRITE_PIXELS.get('hero_elem_raw')!;
    const out: Record<string, string> = {
      'hero_body.png': sheetCanvas(body).toDataURL('image/png'),
      'hero_elem.png': sheetCanvas(elem).toDataURL('image/png'),
      'template_guide.png': guideCanvas(body, elem).toDataURL('image/png'),
    };
    const box = document.getElementById('out')!;
    for (const [name, url] of Object.entries(out)) {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.textContent = `⬇ ${name}`;
      box.appendChild(a);
    }
    const img = document.createElement('img');
    img.src = out['template_guide.png'];
    img.width = 600;
    box.appendChild(img);
    (window as unknown as { exportData: Record<string, string> }).exportData = out;
  }
}

new Phaser.Game({ type: Phaser.CANVAS, width: 1, height: 1, parent: document.body, scene: [Exporter] });
