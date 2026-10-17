// 지연 실행(manual) — advanceTo는 작업마다 시계를 그 기한으로 옮긴 뒤 실행한다(5년 재생의 기록 시각이 실제 일어날 시각이 되게).
import { describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';

describe('Scheduler.advanceTo (manual)', () => {
  it('기한 순으로, 작업 안에서 본 시각 = 그 작업의 기한, 끝나면 until', () => {
    process.env.FF_SCHEDULER = 'manual';
    const clock = new Clock();
    clock.set(new Date('2021-10-17T00:00:00.000Z'));
    const s = new Scheduler(clock);
    delete process.env.FF_SCHEDULER;
    const seen: string[] = [];
    s.after(5_000, () => seen.push(`b ${clock.iso()}`));
    s.after(1_000, () => {
      seen.push(`a ${clock.iso()}`);
      s.after(1_000, () => seen.push(`c ${clock.iso()}`)); // 실행 중 새로 생긴 작업도 기한 안이면 실행
    });
    s.after(60_000, () => seen.push('late'));
    expect(s.advanceTo(new Date('2021-10-17T00:00:10.000Z').getTime())).toBe(3);
    expect(seen).toEqual(['a 2021-10-17T00:00:01.000Z', 'c 2021-10-17T00:00:02.000Z', 'b 2021-10-17T00:00:05.000Z']);
    expect(clock.iso()).toBe('2021-10-17T00:00:10.000Z');
    expect(s.pending).toBe(1);
  });
});
