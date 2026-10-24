// 플랫폼 공통 조회 API — 상태 점검, 42 컴포넌트 현황. (감사 이력은 D01-10, 이벤트 이력은 D04-04 모듈)
import { Controller, Get, HttpCode, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PublicEndpoint } from './actor';
import { Clock } from './clock';
import { ComponentRegistry } from './components';
import { DB, type Db } from './db';
import { MIGRATIONS } from './migrations';
import { isProduction } from './runtime-config';

/** 배포 판 — package.json 판 + 빌드 커밋(FF_BUILD_SHA, 이미지 빌드가 넣는다) */
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
})();
const build = () => ({ version: VERSION, commit: process.env.FF_BUILD_SHA ?? null, instance: process.env.FF_INSTANCE_ID ?? null, mode: isProduction() ? 'production' : 'demo' });

@Controller('api')
export class KernelController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly registry: ComponentRegistry,
    private readonly clock: Clock,
  ) {}

  /** 생존(프로세스가 응답하는가) — 오케스트레이터 liveness. DB를 건드리지 않는다(출시 준비 RD-OPS-08) */
  @Get('health/live')
  @PublicEndpoint()
  live() {
    return { status: 'ok', ...build() };
  }

  /** 준비(트래픽을 받아도 되는가) — 마이그레이션이 모두 적용됐고 DB에 쓸 수 있다. 아니면 503 */
  @Get('health/ready')
  @PublicEndpoint()
  @HttpCode(200)
  ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    try {
      const applied = new Set(this.db.all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name));
      const missing = MIGRATIONS.filter((m) => !applied.has(m.name)).map((m) => m.name);
      checks.migrations = missing.length ? { ok: false, detail: `미적용 ${missing.join(', ')}` } : { ok: true, detail: `${applied.size}개 적용` };
    } catch (e) {
      checks.migrations = { ok: false, detail: (e as Error).message };
    }
    try {
      // 쓰기 잠금을 잡았다 놓는다 — 읽기 전용 파일·잠긴 DB를 걸러 낸다(값은 바꾸지 않는다)
      this.db.tx(() => this.db.run("UPDATE meta SET value = value WHERE key = 'seed'"));
      checks.dbWritable = { ok: true };
    } catch (e) {
      checks.dbWritable = { ok: false, detail: (e as Error).message };
    }
    const ok = Object.values(checks).every((c) => c.ok);
    if (!ok) res.status(503);
    return { status: ok ? 'ready' : 'not_ready', ...build(), checks };
  }

  @Get('health')
  @PublicEndpoint()
  health() {
    const count = (t: string) => (this.db.get<{ n: number }>(`SELECT count(*) AS n FROM ${t}`)?.n ?? 0);
    return {
      status: 'ok',
      ...build(),
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
