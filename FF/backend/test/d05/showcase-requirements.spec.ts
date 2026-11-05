import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { ExtSyncService } from '../../src/domains/d05-ext/api-gateway/ext-sync/ext-sync.service';
import { bootApp } from '../helpers';
import { Clock } from '../../src/kernel/clock';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { GateRepo } from '../../src/domains/d01-policy/repos';
import { DB, type Db } from '../../src/kernel/db';

describe('전시 Feature의 codeBeamer 요구 정의', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('가상 요구도 실제 mock 문서·서명 webhook·링크가 있고 새 설치에 누락 요구 실패를 쌓지 않는다', async () => {
    vi.stubEnv('FF_SHOWCASE', '1'); vi.stubEnv('FF_SCHEDULER', 'manual');
    const b = await bootApp({ costDemo: true });
    try {
      const sync = b.get(ExtSyncService);
      await sync.drain();
      const features = b.get(FeatureRepo).all().filter((f) => f.tags.includes('가상 전시'));
      expect(features.length).toBeGreaterThan(90);
      const remote = sync.mockItems('CODEBEAMER', 'REQUIREMENT');
      for (const f of features) {
        const trace = sync.featureTrace(f.featureId, f.version);
        expect(trace.missingRequirements, f.featureId).toEqual([]);
        const linked = trace.requirements.find((r) => r.extra.reqId === f.requirementIds[0]);
        expect(linked, f.featureId).toBeTruthy();
        const doc = remote.find((r) => r.key === linked!.key)!;
        expect(doc.status).toBe('Draft');
        expect(doc.fields.reqId).toBe(f.requirementIds[0]);
        expect(doc.body).toContain(f.name);
        expect(trace.stale).toEqual([]);
      }
      expect(sync.inbox({ system: 'CODEBEAMER' }).filter((r) => r.externalUser === 'jung.req').length).toBeGreaterThan(90);
      expect(sync.jobs({ system: 'CODEBEAMER', status: 'FAILED' }).filter((j) => j.job.op === 'REQ_LINK')).toEqual([]);
    } finally { await b.app.close(); }
  });

  it('기존DB의 누락 요구 실패만 정상 재시도로 복구하고 의도된503·정책·Gate 판정·기존본문을 보존한다', async () => {
    vi.stubEnv('FF_SHOWCASE', '1'); vi.stubEnv('FF_SCHEDULER', 'manual');
    const oldBoot = vi.spyOn(ExtSyncService.prototype, 'repairShowcaseRequirements').mockResolvedValueOnce({ created: 0, requeued: 0, disabled: true });
    const b = await bootApp({ at: '2026-11-05T00:00:00.000Z', costDemo: true, demoActivity: true });
    oldBoot.mockRestore();
    try {
      const sync = b.get(ExtSyncService), clock = b.get(Clock);
      for (let i = 0; i < 6; i++) { clock.set(new Date(clock.now().getTime() + 300000)); await sync.drain(); }
      const failed = sync.jobs({ system: 'CODEBEAMER', status: 'FAILED' });
      expect(failed.filter((j) => j.job.op === 'REQ_LINK')).toHaveLength(92);
      const intentional = failed.find((j) => j.job.op === 'VERIFICATION' && j.error?.includes('503'))!;
      expect(intentional).toBeTruthy();
      const policies = b.get(PolicyRepo).all(), gates = b.get(GateRepo).all();
      const oldDoc = sync.mockItems('CODEBEAMER', 'REQUIREMENT')[0];
      const fixed = await sync.repairShowcaseRequirements();
      expect(fixed).toMatchObject({ created: 92, requeued: 92, disabled: false });
      expect(sync.jobs({ system: 'CODEBEAMER', status: 'FAILED' })).toEqual([intentional]);
      expect(b.get(PolicyRepo).all()).toEqual(policies);
      expect(b.get(GateRepo).all()).toEqual(gates);
      expect(sync.mockItems('CODEBEAMER', 'REQUIREMENT').find((r) => r.key === oldDoc.key)).toEqual(oldDoc);
      const ids = new Set(failed.filter((j) => j.job.op === 'REQ_LINK').map((j) => j.jobId));
      expect(sync.jobs({ system: 'CODEBEAMER', status: 'DONE' }).filter((j) => ids.has(j.jobId)).every((j) => j.attempts > 5)).toBe(true);
      expect(b.get<Db>(DB).get("SELECT 1 FROM audit WHERE action = 'EXT_REQUIREMENT_DEMO_REPAIR'")).toBeTruthy();
      expect(await sync.repairShowcaseRequirements()).toMatchObject({ created: 0, requeued: 0 });
    } finally { oldBoot.mockRestore(); await b.app.close(); }
  });

  it('운영·빈 설치·명시하지 않은 전시·혼합 live연계에는 모의 등록이나 drain을 하지 않는다', async () => {
    vi.stubEnv('FF_SHOWCASE', '0');
    const b = await bootApp();
    try {
      const sync = b.get(ExtSyncService);
      const drain = vi.spyOn(sync, 'drain').mockRejectedValue(new Error('must not drain'));
      for (const env of [{ FF_SHOWCASE: '0' }, { FF_SHOWCASE: '1', FF_ENV: 'production' }, { FF_SHOWCASE: '1', FF_SEED: 'none' }, { FF_SHOWCASE: '1', IF_MODE_01: 'live' }]) {
        for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
        expect(await sync.repairShowcaseRequirements()).toMatchObject({ disabled: true, created: 0, requeued: 0 });
        vi.unstubAllEnvs();
      }
      expect(drain).not.toHaveBeenCalled(); drain.mockRestore();
    } finally { vi.restoreAllMocks(); await b.app.close(); }
  });
});
