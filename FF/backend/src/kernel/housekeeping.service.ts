// 운영 보조 저장소의 보존 기한 — 출시 준비 RD-OPS-09 (설치 안내서 §9.4).
// 업무 기록이 아니라 운영을 돕는 표만 지운다. 업무·안전 기록의 보존은 contracts/rules/retention.ts(D04-03 RetentionService),
// 감사 이력(audit)은 추가 전용(트리거)이라 지우지 않는다.
//   · idempotency(재전송 응답 보관) — FF_RETENTION_IDEMPOTENCY_DAYS(기본 7일). 이보다 늦게 같은 키로 다시 보내면 새 요청으로 처리된다
//   · otel_span(추적 스팬, IF-11) — FF_RETENTION_SPAN_DAYS(기본 30일)
//   · events(이벤트 이력·outbox) — FF_RETENTION_EVENT_DAYS(기본 0 = 지우지 않는다). 이벤트 이력 화면·알림이 읽으므로 고객 정책으로만 켠다(결정 D-RD-9)
// 개인정보 보존 기한(출시 준비 RD-P2-05, contracts/rules/privacy.ts PERSONAL_RETENTION)도 같은 주기로 돈다 — PrivacyService.retentionSweep:
//   끝난 로그인 세션(FF_RETENTION_SESSION_DAYS 30)·알림(FF_RETENTION_NOTIFICATION_DAYS 0)·감사 행위자 식별 가명 처리(FF_RETENTION_AUDIT_IDENTITY_DAYS 0)
// 부팅 때 한 번 + 24시간마다. FF_SCHEDULER=manual(시험)·FF_RETENTION_SWEEP=off면 sweep()을 직접 부른다.
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Clock } from './clock';
import { DB, type Db } from './db';
import { PrivacyService } from './privacy.service';
import { Scheduler } from './scheduler';

type Env = Record<string, string | undefined>;
const DAY_MS = 24 * 3600_000;

export interface HousekeepingPolicy {
  table: 'idempotency' | 'otel_span' | 'events';
  column: string;
  env: string;
  defaultDays: number;
}

export const HOUSEKEEPING: HousekeepingPolicy[] = [
  { table: 'idempotency', column: 'at', env: 'FF_RETENTION_IDEMPOTENCY_DAYS', defaultDays: 7 },
  { table: 'otel_span', column: 'at', env: 'FF_RETENTION_SPAN_DAYS', defaultDays: 30 },
  { table: 'events', column: 'at', env: 'FF_RETENTION_EVENT_DAYS', defaultDays: 0 },
];

/** 보존 일수 — 숫자가 아니거나 음수면 기본값, 0이면 지우지 않는다 */
export const retentionDays = (p: HousekeepingPolicy, env: Env = process.env): number => {
  const raw = env[p.env];
  if (raw === undefined || raw.trim() === '') return p.defaultDays;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : p.defaultDays;
};

@Injectable()
export class HousekeepingService implements OnApplicationBootstrap {
  private readonly log = new Logger('Housekeeping');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly privacy: PrivacyService,
  ) {}

  onApplicationBootstrap() {
    if (this.scheduler.manual || process.env.FF_RETENTION_SWEEP === 'off') return;
    const tick = () => {
      try {
        const n = { ...this.sweep(), ...this.privacy.retentionSweep() };
        if (Object.values(n).some((v) => v > 0)) this.log.log(`보존 기한 정리 ${JSON.stringify(n)}`);
      } catch (e) {
        this.log.error(`보존 기한 정리 실패: ${(e as Error).message}`);
      }
      this.scheduler.after(DAY_MS, tick);
    };
    tick();
  }

  /** 기한이 지난 행을 지우고 표마다 지운 수를 돌려준다 */
  sweep(env: Env = process.env): Record<HousekeepingPolicy['table'], number> {
    const now = this.clock.now().getTime();
    const out = { idempotency: 0, otel_span: 0, events: 0 };
    this.db.tx(() => {
      for (const p of HOUSEKEEPING) {
        const days = retentionDays(p, env);
        if (!days) continue;
        out[p.table] = this.db.run(`DELETE FROM ${p.table} WHERE ${p.column} < ?`, new Date(now - days * DAY_MS).toISOString()).changes;
      }
    });
    return out;
  }
}
