import type { Element } from './types';

/**
 * 플레이어·적·(지형) 모두가 가지는 원소 상태.
 * 부착 원소 / 남은 시간 / 중첩 횟수 / 잔여 상태를 기록한다.
 */
export class ElementState {
  attached: Element | null = null;
  attachT = 0;
  attachMax = 0;

  stackEl: Element | null = null;
  stackCount = 0;
  stackT = 0;

  residue: string | null = null;
  residueT = 0;

  update(dt: number): void {
    if (this.attached) {
      this.attachT -= dt;
      if (this.attachT <= 0) {
        this.attached = null;
        this.attachT = 0;
      }
    }
    if (this.stackCount > 0) {
      this.stackT -= dt;
      if (this.stackT <= 0) this.resetStack();
    }
    if (this.residue) {
      this.residueT -= dt;
      if (this.residueT <= 0) {
        this.residue = null;
        this.residueT = 0;
      }
    }
  }

  attach(el: Element, duration: number): void {
    if (this.attached === el) {
      this.attachT = Math.max(this.attachT, duration);
    } else {
      this.attached = el;
      this.attachT = duration;
    }
    this.attachMax = Math.max(this.attachT, 0.01);
  }

  clearAttached(): void {
    this.attached = null;
    this.attachT = 0;
  }

  resetStack(): void {
    this.stackCount = 0;
    this.stackEl = null;
    this.stackT = 0;
  }

  clear(): void {
    this.clearAttached();
    this.resetStack();
    this.residue = null;
    this.residueT = 0;
  }
}
