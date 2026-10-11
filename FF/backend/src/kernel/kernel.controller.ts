// 플랫폼 공통 조회 API — 상태 점검, 42 컴포넌트 현황. (감사 이력은 D01-10, 이벤트 이력은 D04-04 모듈)
import { Controller, Get, Inject } from '@nestjs/common';
import { ComponentRegistry } from './components';
import { DB, type Db } from './db';

@Controller('api')
export class KernelController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ComponentRegistry,
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
}
