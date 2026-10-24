// 부하 시험용 측정 탐침 — 서버 프로세스에 --import로만 붙는다(운영 코드 변경 없음). node:sqlite는 동기 API라
// 무거운 질의는 이벤트 루프를 그대로 막는다 — 그 막힘을 monitorEventLoopDelay로 재고, 부모(tools/load/run.ts)가 IPC로 읽는다.
import { Server } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';

// 서버가 포트를 연 순간을 부모에게 알린다 — Windows는 닫힌 localhost 포트 연결이 약 2초 걸려 폴링으로는 부팅 시간이 부풀려진다
const listen = Server.prototype.listen;
Server.prototype.listen = function (this: Server, ...args: unknown[]) {
  this.once('listening', () => {
    const a = this.address();
    // 앱 포트(PORT)만 — 내부 브로커 등 다른 서버가 먼저 열 수 있다
    if (a && typeof a === 'object' && a.port === Number(process.env.PORT)) process.send?.({ kind: 'listening', uptimeMs: Math.round(process.uptime() * 1000) });
  });
  return (listen as (...a: unknown[]) => Server).apply(this, args);
} as typeof Server.prototype.listen;

const h = monitorEventLoopDelay({ resolution: 5 });
h.enable();
const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;

process.on('message', (m: unknown) => {
  if (m === 'loop:reset') {
    h.reset();
    process.send?.({ kind: 'loop:reset' });
  } else if (m === 'loop:read') {
    // 표본이 없으면(아주 짧은 구간) 0
    const n = h.count;
    process.send?.({ kind: 'loop:read', count: n, p50: n ? ms(h.percentile(50)) : 0, p99: n ? ms(h.percentile(99)) : 0, max: n ? ms(h.max) : 0 });
  }
});
