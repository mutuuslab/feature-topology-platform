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
  /** 테스트 전용 */
  set(at: Date | string | null) {
    this.fixed = at === null ? null : new Date(at);
  }
}
