/** 히트스탑: 맞는 순간 게임 시간을 잠깐 멈춘다 (일반 0.05초, 반응 0.1초). 겹치면 더 긴 쪽. */
export class Hitstop {
  private remain = 0;

  request(sec: number): void {
    this.remain = Math.max(this.remain, sec);
  }

  /** 실제 경과 시간으로 갱신. 멈춘 상태면 true */
  update(realDt: number): boolean {
    if (this.remain > 0) {
      this.remain -= realDt;
      return true;
    }
    return false;
  }

  reset(): void {
    this.remain = 0;
  }
}

/** 게임 시간 기준 예약 실행 (히트스탑 중엔 같이 멈춤) */
export class Scheduler {
  private items: { t: number; fn: () => void }[] = [];

  after(sec: number, fn: () => void): void {
    this.items.push({ t: sec, fn });
  }

  update(dt: number): void {
    const due: (() => void)[] = [];
    this.items = this.items.filter((it) => {
      it.t -= dt;
      if (it.t <= 0) {
        due.push(it.fn);
        return false;
      }
      return true;
    });
    for (const fn of due) fn();
  }

  clear(): void {
    this.items = [];
  }
}
