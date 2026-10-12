// PoC 6단계 러너 + 42 컴포넌트 활동 (P9) — 도메인 모듈을 가로질러 실제 서비스를 부르는 워크플로라 별도 모듈.
import { Controller, Get, HttpCode, Inject, Module, Param, Post, Query } from '@nestjs/common';
import { COMPONENTS } from '@ff/contracts';
import { CurrentActor, Roles, type Actor } from '../kernel/actor';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { D01PolicyModule } from '../domains/d01-policy/d01-policy.module';
import { PolicyModule } from '../domains/d01-policy/policy-store/policy.module';
import { DeliveryModule } from '../domains/delivery.module';
import { D05ExtModule } from '../domains/d05-ext/d05-ext.module';
import { D06QsecModule } from '../domains/d06-qsec/d06-qsec.module';
import { OpsLoopModule } from '../domains/ops-loop.module';
import { PocWorkflow } from './poc1.workflow';

const RUNNERS = ['OPERATOR', 'RELEASE_MANAGER', 'FEATURE_APPROVER', 'SAFETY_OFFICER'] as const;

@Controller('api')
export class PocController {
  constructor(
    private readonly poc: PocWorkflow,
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  @Get('poc/runs')
  list() {
    return { items: this.poc.list() };
  }

  @Get('poc/runs/:id')
  run(@Param('id') id: string) {
    return this.poc.get(id);
  }

  @Post('poc/runs')
  @Roles(...RUNNERS)
  start(@CurrentActor() actor: Actor) {
    return this.poc.start(actor);
  }

  @Post('poc/runs/:id/advance')
  @HttpCode(200)
  @Roles(...RUNNERS)
  advance(@Param('id') id: string) {
    return this.poc.advance(id);
  }

  /** 42 컴포넌트별 최근 활동 — 이벤트·감사의 componentId로 센다 (아키텍처 화면의 살아 있는 표시) */
  @Get('components/activity')
  activity(@Query('minutes') minutes?: string) {
    const since = new Date(this.clock.now().getTime() - Math.min(1440, Number(minutes) || 60) * 60_000).toISOString();
    const ev = this.db.all<{ c: string; n: number; last: string; type: string }>(
      'SELECT component_id AS c, count(*) AS n, max(at) AS last, (SELECT type FROM events e2 WHERE e2.component_id = e.component_id ORDER BY seq DESC LIMIT 1) AS type FROM events e WHERE component_id IS NOT NULL AND at >= ? GROUP BY component_id',
      since,
    );
    const au = this.db.all<{ c: string; n: number; denied: number }>("SELECT component_id AS c, count(*) AS n, sum(CASE WHEN result != 'ALLOWED' THEN 1 ELSE 0 END) AS denied FROM audit WHERE component_id IS NOT NULL AND at >= ? GROUP BY component_id", since);
    const items = COMPONENTS.map((c) => {
      const e = ev.find((x) => x.c === c.id);
      const a = au.find((x) => x.c === c.id);
      return { id: c.id, events: e?.n ?? 0, lastAt: e?.last ?? null, lastType: e?.type ?? null, audits: a?.n ?? 0, refused: a?.denied ?? 0 };
    });
    return { since, items };
  }
}

@Module({
  imports: [D01PolicyModule, PolicyModule, DeliveryModule, D05ExtModule, D06QsecModule, OpsLoopModule],
  controllers: [PocController],
  providers: [PocWorkflow],
})
export class PocModule {}
