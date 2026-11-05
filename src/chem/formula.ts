import Phaser from 'phaser';
import { FONT_S, FONT_M, FONT_L } from '../config';

/**
 * 화학식 글자 조각. "2H2O" → [2] [H] [₂] [O]
 * 원소 기호(또는 닫는 괄호) 바로 뒤 숫자만 아래 첨자, 맨 앞 숫자(계수)는 보통 크기.
 */
export interface FormulaRun {
  text: string;
  sub: boolean;
}

export function parseFormula(f: string): FormulaRun[] {
  const runs: FormulaRun[] = [];
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    const prev = f[i - 1] ?? '';
    const last = runs[runs.length - 1];
    const isDigit = /\d/.test(ch);
    const sub = isDigit && (/[A-Za-z)]/.test(prev) || (/\d/.test(prev) && last?.sub === true));
    if (last && last.sub === sub) last.text += ch;
    else runs.push({ text: ch, sub });
  }
  return runs;
}

export type FormulaSize = 'big' | 'small' | 'slot';

/** 픽셀 폰트는 설계 크기의 정수배만: 큰 것 24/16px, 작은 것 10/8px */
const STYLE: Record<FormulaSize, { main: [string, number]; sub: [string, number]; subDy: number; gap: number; shadow: number }> = {
  big: { main: [FONT_L, 24], sub: [FONT_S, 16], subDy: 13, gap: 6, shadow: 2 },
  small: { main: [FONT_M, 10], sub: [FONT_S, 8], subDy: 6, gap: 3, shadow: 1 },
  /** HUD 시약 슬롯 */
  slot: { main: [FONT_L, 12], sub: [FONT_S, 8], subDy: 7, gap: 2, shadow: 1 },
};

export interface FormulaText {
  /** 비교용 키 (글자 + 첨자 여부) */
  key: string;
  t: Phaser.GameObjects.Text;
  color: string;
}

/** 화학식 하나를 글자 조각(Text)들로 만든다. 위치는 (0,0) 기준 상대 좌표 */
export function formulaTexts(scene: Phaser.Scene, f: string, color: string, size: FormulaSize): { texts: FormulaText[]; w: number } {
  const st = STYLE[size];
  const texts: FormulaText[] = [];
  let x = 0;
  for (const r of parseFormula(f)) {
    const [family, px] = r.sub ? st.sub : st.main;
    const t = scene.add
      .text(x, r.sub ? st.subDy : 0, r.text, { fontFamily: family, fontSize: `${px}px`, color })
      .setShadow(st.shadow, st.shadow, '#181425', 0, false, true);
    texts.push({ key: `${r.sub ? '_' : ''}${r.text}`, t, color });
    x += Math.round(t.width);
  }
  return { texts, w: x };
}

export interface FormulaPiece {
  f: string;
  color: number;
  /** '+' '→' 같은 연산자 */
  op?: boolean;
}

export const toCssColor = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** 여러 조각(항·연산자)을 한 줄로. 컨테이너 왼쪽 위 기준, 폭을 돌려준다 */
export function formulaLine(
  scene: Phaser.Scene,
  pieces: FormulaPiece[],
  size: FormulaSize,
): { c: Phaser.GameObjects.Container; w: number; pieces: { texts: FormulaText[]; x: number; w: number }[] } {
  const st = STYLE[size];
  const c = scene.add.container(0, 0);
  const out: { texts: FormulaText[]; x: number; w: number }[] = [];
  let x = 0;
  pieces.forEach((pc, i) => {
    if (i > 0) x += st.gap;
    const { texts, w } = formulaTexts(scene, pc.f, toCssColor(pc.color), size);
    for (const ft of texts) {
      ft.t.x += x;
      c.add(ft.t);
    }
    out.push({ texts, x, w });
    x += w;
  });
  return { c, w: x, pieces: out };
}

/** 항 사이에 '+'를 끼운다 */
export function joinTerms(terms: { f: string; color: number }[], opColor: number): FormulaPiece[] {
  const out: FormulaPiece[] = [];
  terms.forEach((t, i) => {
    if (i > 0) out.push({ f: '+', color: opColor, op: true });
    out.push({ f: t.f, color: t.color });
  });
  return out;
}
