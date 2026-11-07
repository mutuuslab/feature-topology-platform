// 수명주기 격리(TC23) — Shadow 정책 봉투의 출력·활성화·설치 권한 없음(ADS-LC01·FFP-F061), 지원 종료·서버 교체 연습(ADS-LC02·FFP-F063)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shadowEnvelopeIssues, vehicleApplyShadow, type SimVehicle } from '@ff/contracts';
import { actor, bootApp } from '../helpers';

const AT = '2026-11-06T01:00:00.000Z';
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const RM = actor('usr-release', 'RELEASE_MANAGER');
const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');

let app: Awaited<ReturnType<typeof bootApp>>;
beforeAll(async () => {
  app = await bootApp({ at: AT });
});
afterAll(async () => {
  await app.app.close();
});

describe('Shadow 경로 격리 (ADS-LC01)', () => {
  it('Shadow 실험의 정책 봉투는 출력·활성화·설치 권한이 없고, 차량 시뮬레이터는 판단 기록만 남긴다', async () => {
    const e = (await app.http().post('/api/experiments').set(AUTHOR).send({ policyId: 'POL-00002', type: 'SHADOW', hypothesis: '새 거리 추정이 기존 판단과 일치한다', metric: 'DECISION_AGREEMENT', treatmentBp: 1000, minSamples: 100 }).expect(201)).body;
    const env = (await app.http().get(`/api/experiments/${e.experimentId}/shadow-envelope`).expect(200)).body;
    expect(env).toMatchObject({ mode: 'SHADOW', capabilities: { output: false, activation: false, install: false }, decisionLogOnly: true });
    expect(shadowEnvelopeIssues(env)).toEqual([]);
    const veh: SimVehicle = { vin: 'ego-01', actuator: 'IDLE', acceptedPolicyHash: 'sha256:a', installedSw: '1.2.0', flagValue: false, shadowLog: [], trustedKeys: [], lastVerified: null };
    expect(vehicleApplyShadow(veh, env, [{ decision: 'ACTIVATE', value: true }])).toMatchObject({ actuator: 'IDLE', flagValue: false, acceptedPolicyHash: 'sha256:a', installedSw: '1.2.0' });
  });

  it('A/B 실험에는 Shadow 봉투가 없다(409)', async () => {
    const list = (await app.http().get('/api/experiments').expect(200)).body.items as { experimentId: string; type: string }[];
    const ab = list.find((x) => x.type === 'AB');
    if (ab) await app.http().get(`/api/experiments/${ab.experimentId}/shadow-envelope`).expect(409);
    await app.http().get('/api/experiments/EXP-99999/shadow-envelope').expect(404);
  });
});

describe('지원 종료·서버 교체 연습 (ADS-LC02)', () => {
  it('시드 연습 기록이 있고, 새 연습은 기준선·차단·키 갱신·미승인 ON 네 칸을 판정해 추가만 남긴다', async () => {
    const seeded = (await app.http().get('/api/features/FEAT-00022/versions/1.0.0/support-drills').expect(200)).body.items;
    expect(seeded.length).toBeGreaterThanOrEqual(1);
    await app.http().post('/api/features/FEAT-00022/versions/1.0.0/support-drills').set(AUTHOR).send({ horizonDays: 90, reason: '연습' }).expect(403);
    const r = (await app.http().post('/api/features/FEAT-00022/versions/1.0.0/support-drills').set(RM).send({ horizonDays: 90, reason: '서버 교체 연습' }).expect(201)).body;
    expect(r.checks.map((c: { id: string }) => c.id)).toEqual(['BASELINE_KEPT', 'BLOCK_KEPT', 'KEY_RENEWAL', 'NO_UNAPPROVED_ON']);
    expect(r.checks.find((c: { id: string }) => c.id === 'NO_UNAPPROVED_ON').result).toBe('PASS');
    expect(r.vehiclesAfter.every((v: { flagValue: boolean }) => v.flagValue === false || v.flagValue === true)).toBe(true);
    const after = (await app.http().get('/api/features/FEAT-00022/versions/1.0.0/support-drills').expect(200)).body.items;
    expect(after.length).toBe(seeded.length + 1);
  });

  it('승인·배포 기준선이 없는 Version은 기준선 유지 실패로 남는다(연습 실패 기록)', async () => {
    const r = (await app.http().post('/api/features/FEAT-00003/versions/3.3.0/support-drills').set(SAFETY).send({ horizonDays: 30, reason: '기준선 없는 Version 연습' }).expect(201)).body;
    expect(r.passed).toBe(false);
    expect(r.checks.find((c: { id: string }) => c.id === 'BASELINE_KEPT').result).toBe('FAIL');
  });
});
