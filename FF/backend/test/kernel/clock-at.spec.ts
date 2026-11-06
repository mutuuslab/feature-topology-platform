// Clock.at — 데모 시드가 지난 시각 기록을 실제 경로로 남길 때 동기 구간만 그 시각으로 돌고, 앞 상태(고정 시각 포함)로 되돌린다(2026-11-06)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Clock } from '../../src/kernel/clock';

describe('Clock.at', () => {
  afterEach(() => void vi.useRealTimers());
  it('동기 작업 동안만 정한 시각, 끝나면(예외여도) 실제 시각 또는 앞의 고정 시각으로', () => {
    // 실제 시각 — 가짜 시계로 고정해 그대로 돌아왔는지 본다(경과 시간 비교 없이)
    vi.useFakeTimers({ now: new Date('2026-03-03T03:03:03.000Z'), toFake: ['Date'] });
    const c = new Clock();
    expect(c.at('2026-01-01T00:00:00.000Z', () => c.iso())).toBe('2026-01-01T00:00:00.000Z');
    expect(c.iso()).toBe('2026-03-03T03:03:03.000Z');
    c.set('2026-05-05T00:00:00.000Z');
    expect(() => c.at('2026-01-01T00:00:00.000Z', () => { throw new Error('x'); })).toThrow('x');
    expect(c.iso()).toBe('2026-05-05T00:00:00.000Z');
  });
  it('비동기 작업은 받지 않는다(대기 중 다른 요청이 그 시각을 쓰지 않게)', () => {
    const c = new Clock();
    expect(() => c.at('2026-01-01T00:00:00.000Z', () => Promise.resolve(1))).toThrow(/동기/);
  });
});
