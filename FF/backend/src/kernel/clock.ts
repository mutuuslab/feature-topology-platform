import { Injectable } from '@nestjs/common';

/** 시간 원천 — 테스트에서 고정 시각으로 교체한다. */
@Injectable()
export class Clock {
  /** FF_CLOCK_AT — 시험 전용: 부팅 전부터 시각을 고정한다(부팅 때 잡히는 회신 기한도 같은 시계를 쓰게) */
  private fixed: Date | null = process.env.FF_CLOCK_AT ? new Date(process.env.FF_CLOCK_AT) : null;
  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }
  iso(): string {
    return this.now().toISOString();
  }
  /** KST(+09:00) ISO — Gate 판정시각 등 데이터셋 표기와 맞춘다 */
  kst(): string {
    const t = new Date(this.now().getTime() + 9 * 3600_000).toISOString();
    return `${t.slice(0, 19)}+09:00`;
  }
  /**
   * 동기 작업 하나를 정한 시각으로 — 데모 시드가 지난 시각의 기록(보존 기간이 지난 행)을 실제 서비스 경로로 남길 때.
   * 동기 함수만 받는다(중간에 다른 요청·타이머가 끼어들어 그 시각을 쓰지 않게). 끝나면 앞 상태(고정 시각이면 그 시각)로 되돌린다
   */
  at<T>(when: Date | string, fn: () => T): T {
    const prev = this.fixed;
    this.fixed = new Date(when);
    try {
      const out = fn();
      if (out instanceof Promise) throw new Error('Clock.at은 동기 작업만 받습니다');
      return out;
    } finally {
      this.fixed = prev;
    }
  }
  /** 테스트 전용 */
  set(at: Date | string | null) {
    this.fixed = at === null ? null : new Date(at);
  }
}
