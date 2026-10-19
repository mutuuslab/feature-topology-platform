// 플랫폼 공통 조회 API — 상태 점검, 42 컴포넌트 현황. (감사 이력은 D01-10, 이벤트 이력은 D04-04 모듈)
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Clock } from './clock';
import { ComponentRegistry } from './components';
import { DB, type Db } from './db';

@Controller('api')
export class KernelController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ComponentRegistry,
    private readonly clock: Clock,
  ) {}

  @Get('health')
  health() {
    const count = (t: string) => (this.db.get<{ n: number }>(`SELECT count(*) AS n FROM ${t}`)?.n ?? 0);
    return {
      status: 'ok',
      seed: this.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'seed'")?.value ?? null,
      counts: {
        features: count('feature_version'),
        baselines: count('baseline'),
        products: count('product'),
        dependencies: count('dependency'),
        gateRecords: count('gate_record'),
        events: count('events'),
        audit: count('audit'),
      },
    };
  }

  @Get('components')
  components() {
    const items = this.registry.view();
    return {
      total: items.length,
      implemented: items.filter((c) => c.status === 'implemented').length,
      registered: items.filter((c) => c.registered).length,
      unknownIds: this.registry.unknownIds(),
      items,
    };
  }

  /** 42 컴포넌트별 최근 활동 — 이벤트·감사의 componentId로 센다(아키텍처 화면의 살아 있는 표시) */
  @Get('components/activity')
  activity(@Query('minutes') minutes?: string) {
    const since = new Date(this.clock.now().getTime() - Math.min(1440, Number(minutes) || 60) * 60_000).toISOString();
    const ev = this.db.all<{ c: string; n: number; last: string; type: string }>(
      'SELECT component_id AS c, count(*) AS n, max(at) AS last, (SELECT type FROM events e2 WHERE e2.component_id = e.component_id ORDER BY seq DESC LIMIT 1) AS type FROM events e WHERE component_id IS NOT NULL AND at >= ? GROUP BY component_id',
      since,
    );
    const au = this.db.all<{ c: string; n: number; denied: number }>("SELECT component_id AS c, count(*) AS n, sum(CASE WHEN result != 'ALLOWED' THEN 1 ELSE 0 END) AS denied FROM audit WHERE component_id IS NOT NULL AND at >= ? GROUP BY component_id", since);
    return {
      since,
      items: this.registry.view().map((c) => {
        const e = ev.find((x) => x.c === c.id);
        const a = au.find((x) => x.c === c.id);
        return { id: c.id, events: e?.n ?? 0, lastAt: e?.last ?? null, lastType: e?.type ?? null, audits: a?.n ?? 0, refused: a?.denied ?? 0 };
      }),
    };
  }
}
