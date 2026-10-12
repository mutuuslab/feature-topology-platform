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
  /** 테스트 전용 */
  set(at: Date | string | null) {
    this.fixed = at === null ? null : new Date(at);
  }
}
