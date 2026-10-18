// 5년 운영 재생 — 짧은 재생(약 4개월, 표본 3,000·수신 400 중 이 기간 등록분)으로 같은 엔진·같은 실제 경로를 시험한다.
// 일정을 앞당겨 출시·단계 확대·체험 캠페인·고장→이상 징후·긴급 차단 2인 승인→복구·수동 롤백·보존 sweep이 모두 한 번씩 일어나게 한다.
// 불변식: 결함(5xx) 0, 감사 해시 체인 유효, 직무 분리 위반 0, 배포 전 GO 검증, 차단·복원 승인자 분리, 깔때기 단조, 보존 기간 지난 행 0.
Object.assign(process.env, {
  FF_SCHEDULER: 'manual',
  GLEO_MODE: 'internal',
  UNLEASH_MODE: 'mock',
  FF_DATASET: 'ops5y',
  FF_SYNTHETIC: '0',
  FF_BOOT_PUBLISH: '0',
  FF_SEED_ANCHOR: '2026-10-17',
  CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'),
  FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-ops5y-')),
});
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { AuditService } from '../../src/kernel/audit.service';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { RetentionService } from '../../src/domains/d04-ops/telemetry-ingest/retention.service';
import { TrialExpiryService } from '../../src/domains/d01-policy/entitlement/trial-expiry.service';
import { replay, type Launches, type ReplayReport } from '../../src/ops5y/engine';
import { checkInvariants, type InvariantResult } from '../../src/ops5y/invariants';
import { bootApp } from '../helpers';

const END = '2026-10-17';
/** 앞당긴 일정 — 개시 후 0~3개월 안에 모든 흐름 */
const LAUNCHES: Launches = {
  features: [
    { month: 0, featureId: 'FEAT-00001', version: '2.1.0', catalogId: 'CAT-00001' },
    { month: 0, featureId: 'FEAT-00022', version: '1.0.0', catalogId: 'CAT-00019', flags: { Signal: 'care_00022_signal', Parameter: 'care_00022_param' } },
    { month: 1, featureId: 'FEAT-00025', version: '1.0.0', catalogId: 'CAT-00014' },
    { month: 2, featureId: 'FEAT-00001', version: '2.2.0', catalogId: 'CAT-00017' },
  ],
  trialCampaigns: [{ fromMonth: 0, catalogId: 'CAT-00019', monthlyShare: 0.5 }],
  incidents: [{ month: 1, day: 20, featureId: 'FEAT-00022', code: 'RADAR_BIAS', kill: true }],
  rollbacks: [{ month: 3, day: 5, featureId: 'FEAT-00001', reason: '2.2.0 배포 후 현장 보고 — 2.1.0으로 복구' }],
};

describe('5년 운영 재생 — 짧은 재생', () => {
  let app: INestApplication;
  let report: ReplayReport;
  let inv: InvariantResult[];
  beforeAll(async () => {
    const boot = await bootApp({ at: '2021-10-17T00:00:00.000Z' });
    app = boot.app;
    const http = boot.http;
    report = await replay(
      async (method, path, headers, body) => {
        const req = method === 'GET' ? http().get(path) : http().post(path).send((body ?? {}) as object);
        const res = await req.set(headers);
        return { status: res.status, body: res.body };
      },
      {
        clock: app.get(Clock),
        scheduler: app.get(Scheduler),
        db: app.get(DB),
        trialSweep: (today) => app.get(TrialExpiryService).sweep(today),
        retentionSweep: () => app.get(RetentionService).sweep({ id: 'system', role: 'SYSTEM', correlationId: 'ops5y-retention' } as any),
      },
      { end: END, days: 125, sample: 3000, receivers: 400, launches: LAUNCHES },
    );
    inv = checkInvariants(app.get<Db>(DB), app.get(AuditService), report, { populationTolerance: 0.3 }); // 넉 달·작은 표본은 층 표본 잡음이 크다(전체 재생은 ±3%)
    if (process.env.OPS5Y_DEBUG) require('node:fs').writeFileSync(process.env.OPS5Y_DEBUG, JSON.stringify({ report, inv }, null, 1));
  }, 600_000);
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'UNLEASH_MODE', 'FF_DATASET', 'FF_SYNTHETIC', 'FF_BOOT_PUBLISH', 'FF_SEED_ANCHOR', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  it('개시일부터 125일 — 결함(5xx) 0건', () => {
    expect(report.start).toBe('2021-10-17');
    expect(report.days).toBe(125);
    expect(report.errors).toEqual([]);
  });

  it('모든 흐름이 실제로 일어났다 — 등록·배포·확대·체험·고장·차단·복구·롤백', () => {
    const ops = Object.values(report.years).reduce<Record<string, number>>((acc, y) => {
      for (const [k, v] of Object.entries(y)) acc[k] = (acc[k] ?? 0) + v.ok;
      return acc;
    }, {});
    for (const op of ['신차 등록', '정책 배포', '단계 확대', '체험 제안', '체험 수락', '차량 보고', '이상 징후 확인', '긴급 차단 승인', '복원 승인', '롤백 실행', 'JIRA 변경요청', 'GitLab 병합', 'GitLab 파이프라인', 'codeBeamer 요구 개정', '연계 보내기']) expect(ops[op] ?? 0, op).toBeGreaterThan(0);
    expect(report.kills[0]).toMatchObject({ featureId: 'FEAT-00022' });
    expect(report.kills[0].restoredAt).not.toBeNull();
    expect(report.receivers).toBeGreaterThan(0);
  });

  it('불변식 전부 통과', () => {
    const failed = inv.filter((x) => !x.ok);
    expect(failed, JSON.stringify(failed, null, 1)).toEqual([]);
    expect(inv.map((x) => x.id)).toEqual(expect.arrayContaining(['INV-13', 'INV-14', 'INV-15']));
  });
});
