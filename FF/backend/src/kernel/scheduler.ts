// 지연 실행 — 차량 회신 지연·회신 기한(TIMEOUT)을 흉내 낸다.
// FF_SCHEDULER=manual 이면 타이머 없이 쌓아 두고 flush()가 기한 순서대로 실행한다(테스트에서 결정적).
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Clock } from './clock';

interface Task {
  due: number;
  seq: number;
  fn: () => void;
}

@Injectable()
export class Scheduler implements OnApplicationShutdown {
  readonly manual = process.env.FF_SCHEDULER === 'manual';
  private queue: Task[] = [];
  private timers = new Set<NodeJS.Timeout>();
  private seq = 0;

  constructor(private readonly clock: Clock) {}

  after(ms: number, fn: () => void) {
    if (this.manual) {
      this.queue.push({ due: this.clock.now().getTime() + ms, seq: this.seq++, fn });
      return;
    }
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    t.unref?.();
    this.timers.add(t);
  }

  /** manual 전용 — 기한이 지금+ms 이내인 작업을 기한 순으로 실행한다(실행 중 새로 생긴 작업 포함). 실행한 수를 돌려준다. */
  flush(ms = Number.POSITIVE_INFINITY): number {
    const limit = this.clock.now().getTime() + ms;
    let n = 0;
    for (;;) {
      this.queue.sort((a, b) => a.due - b.due || a.seq - b.seq);
      const next = this.queue[0];
      if (!next || next.due > limit) return n;
      this.queue.shift();
      next.fn();
      n++;
    }
  }

  /**
   * manual 전용 — 시계를 until까지 옮기며 작업을 기한 순으로 실행한다. 작업마다 시계를 그 기한으로 맞춘 뒤 실행해서
   * 기록 시각(회신·이벤트·감사)이 실제 일어날 시각이 된다(flush는 지금 시각 그대로 실행한다). 5년 재생(tools/ops5y)이 쓴다.
   */
  advanceTo(until: number): number {
    let n = 0;
    for (;;) {
      this.queue.sort((a, b) => a.due - b.due || a.seq - b.seq);
      const next = this.queue[0];
      if (!next || next.due > until) break;
      this.queue.shift();
      if (next.due > this.clock.now().getTime()) this.clock.set(new Date(next.due));
      next.fn();
      n++;
    }
    if (until > this.clock.now().getTime()) this.clock.set(new Date(until));
    return n;
  }

  get pending() {
    return this.queue.length;
  }

  onApplicationShutdown() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
