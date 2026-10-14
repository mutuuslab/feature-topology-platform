// 배포와 효력 분리·단계적 확대 (D01-08, 보고서 v1.1 FFG-LCY-009) — 수용 기준: F2 이상 확대 100%에 Canary 결과와 중단 기준 판정이 있다.
// FEAT-00022(F3) 배포 정책으로: Canary 없이 확대 거부 → Canary 시작 → 관측 기간 전 거부 → 진행 중 차단이면 거부 → 관측 뒤 확대(판정 기록).
Object.assign(process.env, { FF_SCHEDULER: 'manual' });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp, killV2, restoreV2 } from '../helpers';

const OPERATOR = actor('seo.ops', 'OPERATOR');

describe('단계적 확대 — F2 이상 Canary·관측·중단 기준 (FFG-LCY-009)', () => {
  let app: INestApplication;
  let http: () => any;
  let pid: string;
  const stage = (basisPoints: number) => http().post(`/api/policies/${pid}/rollout`).set(OPERATOR).send({ basisPoints, reason: '단계 조정' });
  const hours = (h: number) => {
    const c = app.get(Clock);
    c.set(new Date(c.now().getTime() + h * 3600_000));
  };

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    pid = (await http().get('/api/policies?featureId=FEAT-00022').expect(200)).body.items.find((p: any) => p.status === 'DEPLOYED' && p.flagKey === 'care_00022_param').policyId;
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.FF_SCHEDULER;
  });

  it('멈추기(0%)는 언제나, Canary 없이 0 → 50%는 거부(감사 FAILED)', async () => {
    await stage(0).expect(200);
    expect((await stage(5000).expect(422)).body.error.message).toMatch(/Canary/);
  });

  it('Canary(3%) 시작 → 관측 24 h 전 확대 거부', async () => {
    await stage(300).expect(200);
    hours(10);
    expect((await stage(5000).expect(422)).body.error.message).toMatch(/관측 기간 10시간 < 24시간/);
  });

  it('관측이 지나도 진행 중 차단이 있으면 중단 기준 — 거부, 복원 뒤 확대하면 판정 기록(관측 시간·중단 기준)', async () => {
    hours(15);
    const k = await killV2(http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '단계 확대 중 결함', confirm: 'FEAT-00022' });
    expect((await stage(5000).expect(422)).body.error.message).toMatch(new RegExp(`차단 ${k.killId}`));
    await restoreV2(http, k.killId, '결함 해소', actor('park.safety', 'SAFETY_OFFICER'));
    await stage(5000).expect(200);
    const ev = (await http().get('/api/events?type=rollout.staged').expect(200)).body.items.at(-1).payload;
    expect(ev).toMatchObject({ from: 300, to: 5000, kind: 'EXPAND', criteria: { requiredMs: 86_400_000, openAnomalies: [], activeKills: [] } });
    expect(ev.criteria.observedMs).toBeGreaterThanOrEqual(86_400_000);
  });
});
