import { Injectable } from '@nestjs/common';

/** 시간 원천 — 테스트에서 고정 시각으로 교체한다. */
@Injectable()
export class Clock {
  private fixed: Date | null = null;
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
