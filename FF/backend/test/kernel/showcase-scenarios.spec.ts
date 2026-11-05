import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { FeatureRepo, GateRepo } from '../../src/domains/d01-policy/repos';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { BaselineService } from '../../src/domains/d01-policy/registry/baseline.service';
import { ConsultService } from '../../src/workflows/consult.service';
import { RegistryService } from '../../src/domains/d01-policy/registry/registry.service';
import { TopologyService } from '../../src/domains/d01-policy/topology/topology.service';
import { ChangeRecordService } from '../../src/domains/d04-ops/pipeline-link/change-record.service';
import { PrivacyService } from '../../src/kernel/privacy.service';
import { SyncService } from '../../src/domains/d05-ext/data-sync/sync.service';
import { RollbackService } from '../../src/domains/d03-safety/restore/rollback.service';
import { DemoActivitySeeder } from '../../src/demo-activity/demo-activity.seeder';
import { Scheduler } from '../../src/kernel/scheduler';
import { Clock } from '../../src/kernel/clock';
import { ModuleRef } from '@nestjs/core';
import { ShowcaseOperations } from '../../src/demo-activity/showcase-operations';
import { SHOWCASE_SCENARIOS_META, ShowcaseScenariosSeeder, showcaseScenariosEnabled } from '../../src/demo-activity/showcase-scenarios.seeder';
import { bootApp } from '../helpers';

describe('선택 전시: 두 배 규모와 담당자별 실제 검토 상황', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('전시 명시 없이, 운영·빈 DB·5년 재생 데이터셋에는 실행하지 않는다', async () => {
    for (const env of [{}, { FF_ENV: 'production', FF_SHOWCASE: '1' }, { FF_SEED: 'none', FF_SHOWCASE: '1' }, { FF_DATASET: 'ops5y', FF_SHOWCASE: '1' }]) expect(showcaseScenariosEnabled(env)).toBe(false);
    expect(showcaseScenariosEnabled({ FF_SHOWCASE: '1' })).toBe(true);
    vi.stubEnv('FF_SHOWCASE', '0');
    const b = await bootApp();
    try {
      expect(b.get<Db>(DB).get('SELECT 1 FROM meta WHERE key = ?', SHOWCASE_SCENARIOS_META)).toBeUndefined();
      expect(b.get(FeatureRepo).all().some((f) => f.tags.includes('가상 전시'))).toBe(false);
    } finally { await b.app.close(); }
  });

  it('184 Feature versions까지 등록·Gate 보완/승인대기·정책 반려·기준선 요청·협의 의견을 서비스로 만들고 다시 실행하지 않는다', async () => {
    vi.stubEnv('FF_SHOWCASE', '1');
    vi.stubEnv('FF_SCHEDULER', 'manual');
    const b = await bootApp({ at: '2026-11-05T00:00:00.000Z', costDemo: true });
    try {
      const db = b.get<Db>(DB);
      const features = b.get(FeatureRepo).all();
      const extra = features.filter((f) => f.tags.includes('가상 전시'));
      expect(features).toHaveLength(184);
      expect(extra.length).toBeGreaterThan(90);
      expect(new Set(features.map((f) => `${f.featureId}@${f.version}`)).size).toBe(184);
      expect(extra.every((f) => f.featureRefs?.length === 1 && f.baselineId === null && !['RELEASED', 'VERIFIED'].includes(f.lifecycle))).toBe(true);
      const gates = b.get(GateRepo);
      expect(extra.some((f) => gates.latest(f.featureId, f.version).G1?.status === 'FAIL')).toBe(true);
      expect(extra.some((f) => f.lifecycle === 'PROPOSED' && ['G1', 'G2', 'G3'].every((g) => gates.latest(f.featureId, f.version)[g as 'G1']?.status === 'PASS'))).toBe(true);
      const ids = new Set(extra.map((f) => f.featureId));
      const policies = b.get(PolicyRepo).all().filter((p) => ids.has(p.featureId));
      expect(new Set(policies.map((p) => p.status))).toEqual(new Set(['DRAFT', 'REJECTED']));
      expect(policies.every((p) => !p.enabled && p.rollout.mode === 'NONE' && p.approvedBy === null)).toBe(true);
      const requests = b.get(BaselineService).requests().filter((q) => ids.has(q.featureId));
      expect(new Set(requests.map((q) => q.status))).toEqual(new Set(['PENDING', 'REJECTED']));
      expect(requests.filter((q) => q.status === 'REJECTED').every((q) => q.requestedBy !== q.decidedBy)).toBe(true);
      const consultations = b.get(ConsultService).list({}).items.filter((c) => c.summary.startsWith('전시 —'));
      expect(new Set(consultations.map((c) => c.status))).toEqual(new Set(['OPEN', 'ANSWERED']));
      expect(new Set(consultations.flatMap((c) => c.opinions.map((o) => o.opinion)))).toEqual(new Set(['AGREE', 'REVISE', 'OPPOSE']));
      expect(consultations.every((c) => c.opinions.every((o) => o.by !== c.requestedBy))).toBe(true);
      const changes = b.get(ChangeRecordService).list({});
      expect(changes.items).toHaveLength(2);
      expect(changes.summary).toMatchObject({ aiGenerated: 2, aiComplete: 0, withFindings: 2 });
      expect(changes.items.every((c) => c.findings.length === 4 && c.evidence.coverage === null && c.summary.includes('가상 시연'))).toBe(true);
      expect(changes.items.find((c) => c.changeId === 'CHG-SHOWCASE-SOURCE-1')!.rev).toBe(2);
      const imported = db.get<{ commit_id: string }>("SELECT commit_id FROM flag_source_manifest WHERE provenance = 'DEMO' ORDER BY id DESC LIMIT 1")!;
      expect(changes.items.every((c) => c.commit === imported.commit_id)).toBe(true);
      const privacy = b.get(PrivacyService).list().items;
      expect(new Set(privacy.map((p) => p.status))).toEqual(new Set(['REQUESTED', 'REJECTED']));
      expect(privacy.every((p) => p.result === null)).toBe(true);
      const runs = b.get(SyncService).runs();
      expect(runs).toHaveLength(7);
      expect(new Set(runs.map((r) => r.status))).toEqual(new Set(['SUCCEEDED', 'HELD']));
      expect(runs.some((r) => r.diffs.length > 0)).toBe(true);
      const auditBefore = db.get<{ n: number }>('SELECT count(*) AS n FROM audit')!.n;
      await b.get(ShowcaseScenariosSeeder).onApplicationBootstrap();
      expect(b.get(FeatureRepo).all()).toHaveLength(184);
      expect(db.get<{ n: number }>('SELECT count(*) AS n FROM audit')!.n).toBe(auditBefore);
    } finally { await b.app.close(); }
  });

  it('기본 데모 활동과 함께 부팅해도 Version 생성이 경합하지 않아 정확히184개다', async () => {
    vi.stubEnv('FF_SHOWCASE', '1');
    vi.stubEnv('FF_SCHEDULER', 'manual');
    const b = await bootApp({ at: '2026-11-05T00:00:00.000Z', costDemo: true, demoActivity: true });
    try {
      const db = b.get<Db>(DB);
      const marker = JSON.parse(db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', SHOWCASE_SCENARIOS_META)!.value);
      expect(marker.before).toBe(92);
      expect(marker.created).toHaveLength(92);
      expect(marker.after).toBe(184);
      expect(b.get(FeatureRepo).all()).toHaveLength(184);
      const allDependencies = b.get(TopologyService).list();
      expect(allDependencies).toHaveLength(59);
      const added = allDependencies.filter((d) => marker.dependencies.includes(d.dependencyId));
      expect(added).toHaveLength(30);
      expect(new Set(added.map((d) => d.type))).toEqual(new Set(['REQUIRES', 'EXCLUDES']));
      expect(new Set(added.map((d) => d.verdict))).toEqual(new Set(['PASS', 'FAIL', 'CONDITIONAL', '미판정']));
      expect(added.filter((d) => d.verdict === 'FAIL').every((d) => d.rationale.includes('필수 선행 단계 미달'))).toBe(true);
      expect(db.all<{ action: string; result: string }>("SELECT action, result FROM audit WHERE correlation_id = 'seed:showcase-scenarios'")).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'DEPENDENCY_CREATE', result: 'FAILED' }), expect.objectContaining({ action: 'FEATURE_UPDATE', result: 'ALLOWED' })]));
      const demo = b.get(DemoActivitySeeder), clock = b.get(Clock);
      for (let i = 0; i < 8 && !(await Promise.race([demo.continuation!.then(() => true), new Promise((r) => setTimeout(() => r(false), 30))])); i++) {
        b.get(Scheduler).flush(12000);
        clock.set(new Date(clock.now().getTime() + 12000));
      }
      expect(await demo.continuation).toContain('REQUESTED');
      expect(await b.get(ShowcaseScenariosSeeder).continuation).toMatchObject({ plans: expect.any(Array) });
      const plans = b.get(RollbackService).plans({}).items;
      expect(plans).toHaveLength(2);
      expect(new Set(plans.map((p) => p.status))).toEqual(new Set(['REQUESTED', 'REJECTED']));
      expect(plans.every((p) => p.executionId === null && p.note?.includes('가상 시연'))).toBe(true);
      expect(plans.find((p) => p.status === 'REJECTED')!.decision!.by).not.toBe(plans[0].requestedBy);
    } finally { await b.app.close(); }
  });

  it('중간 등록 실패는 Feature·근거·감사·완료 marker를 함께 되돌려 재시도할 수 있다', async () => {
    vi.stubEnv('FF_SHOWCASE', '0');
    const b = await bootApp();
    try {
      const db = b.get<Db>(DB);
      const count = () => ['feature_version', 'audit', 'events', 'gate_record'].map((table) => db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)!.n);
      const before = count();
      const registry = b.get(RegistryService);
      const create = registry.create.bind(registry);
      let attempts = 0;
      const spy = vi.spyOn(registry, 'create').mockImplementation((actor, body) => {
        if (++attempts === 3) throw new Error('simulated registration failure');
        return create(actor, body);
      });
      vi.stubEnv('FF_SHOWCASE', '1');
      await expect(b.get(ShowcaseScenariosSeeder).onApplicationBootstrap()).rejects.toThrow('simulated registration failure');
      spy.mockRestore();
      expect(count()).toEqual(before);
      expect(db.get('SELECT 1 FROM meta WHERE key = ?', SHOWCASE_SCENARIOS_META)).toBeUndefined();
      await b.get(ShowcaseScenariosSeeder).onApplicationBootstrap();
      expect(b.get(FeatureRepo).all()).toHaveLength(184);
    } finally { vi.restoreAllMocks(); await b.app.close(); }
  });

  it('실제 차량 확인 뒤 계획 보강이 중단돼도 재기동 시 완료 기록에서 이어서 만들고 중복하지 않는다', async () => {
    vi.stubEnv('FF_SHOWCASE', '1');
    vi.stubEnv('FF_SCHEDULER', 'manual');
    const interrupted = vi.spyOn(ShowcaseOperations.prototype, 'rollbackPlans').mockImplementationOnce(() => { throw new Error('simulated late-plan interruption'); });
    const b = await bootApp({ at: '2026-11-05T00:00:00.000Z', costDemo: true, demoActivity: true });
    try {
      const demo = b.get(DemoActivitySeeder), clock = b.get(Clock);
      for (let i = 0; i < 8 && !(await Promise.race([demo.continuation!.then(() => true), new Promise((r) => setTimeout(() => r(false), 30))])); i++) {
        b.get(Scheduler).flush(12000);
        clock.set(new Date(clock.now().getTime() + 12000));
      }
      expect(await demo.continuation).toContain('REQUESTED');
      expect(await b.get(ShowcaseScenariosSeeder).continuation).toEqual({ error: 'simulated late-plan interruption' });
      interrupted.mockRestore();
      demo.continuation = null; // 재기동한 프로세스에는 원래 Promise가 없다.
      const restarted = new ShowcaseScenariosSeeder(b.get<Db>(DB), b.app.get<ModuleRef>(ModuleRef), clock);
      await restarted.onApplicationBootstrap();
      expect(await restarted.continuation).toMatchObject({ plans: expect.any(Array) });
      expect(b.get(RollbackService).plans({}).items).toHaveLength(2);
      await restarted.onApplicationBootstrap();
      expect(b.get(RollbackService).plans({}).items).toHaveLength(2);
    } finally { interrupted.mockRestore(); await b.app.close(); }
  });
});
