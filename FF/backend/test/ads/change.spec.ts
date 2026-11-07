// ADS 변경(ADS-BE08·BE16·BE12, ADS-UI09 API) — 변경 종류·승인 경로·릴리스 비교·분류 완결성·시장 기준선·확대 판정 읽기. 시드 data/fixtures/ads/change.json.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdsChangeImpactList, ClassificationView, ExpansionView, PolicyExpansionView, ReleaseDiffView, UnclassifiedView } from '@ff/contracts';
import { actor, bootApp } from '../helpers';

const AT = '2026-11-06T01:00:00.000Z';
let app: Awaited<ReturnType<typeof bootApp>>;

beforeAll(async () => {
  app = await bootApp({ at: AT });
});
afterAll(async () => {
  await app.app.close();
});

describe('변경 영향 — 변경 종류·승인 경로 (ADS-BE08)', () => {
  it('끝나지 않은 승인 경로를 경로별로 세고, 판단 불가 변경은 따로 센다(정책 변경으로 가볍게 분류하지 않음)', async () => {
    const r = await app.http().get('/api/change-impacts').expect(200);
    const b = r.body as AdsChangeImpactList;
    expect(b.counts).toMatchObject({ REHARA: 1, R156: 1, SUMS: 1, SAFETY_CASE: 0, total: 3, undecidable: 1 });
    const unknown = b.items.find((x) => x.impactId === 'CI-0003')!;
    expect(unknown.declaredKind).toBe('POLICY');
    expect(unknown.cls.primary).toBe('UNKNOWN');
    expect(unknown.cls.primary).not.toBe('POLICY');
  });

  it('Flag만 바꿔 ODD를 넓힌 개정은 POLICY로 신고돼도 ODD 경로로 승격된다', async () => {
    const b = (await app.http().get('/api/change-impacts?featureId=FEAT-00004').expect(200)).body as AdsChangeImpactList;
    expect(b.items).toHaveLength(1);
    expect(b.items[0].cls).toMatchObject({ primary: 'ODD', escalated: true });
    expect(b.items[0].paths.filter((p) => p.status !== 'NOT_REQUIRED').map((p) => p.path)).toEqual(['REHARA', 'R156', 'SUMS', 'SAFETY_CASE']);
    // 직전 Version과 바뀐 속성의 재판정 Gate(표 7) — 의존·기능·SW 변경
    expect(b.items[0].rejudgeGates.length).toBeGreaterThan(0);
  });

  it('출시 뒤 열린 재-HARA가 있으면 배포·서명 막힘 사유를 낸다(서버 거부는 ADS-BE06)', async () => {
    const b = (await app.http().get('/api/change-impacts?featureId=FEAT-00022').expect(200)).body as AdsChangeImpactList;
    const v = b.items[0];
    expect(v.lifecycle).toBe('RELEASED');
    expect(v.reharaOpenAfterRelease).toBe(true);
    expect(v.rejudgeGates).toContain('G2');
  });

  it('승인 경로 종결은 정해진 역할만 — 다른 역할은 403, 맞는 역할은 종결·감사 기록', async () => {
    await app.http().post('/api/change-impacts/CI-0002/paths/REHARA/close').set(actor('usr-author', 'FEATURE_AUTHOR')).send({ reason: '시험' }).expect(403);
    await app.http().post('/api/change-impacts/CI-0002/paths/REHARA/close').set(actor('usr-csm', 'SECURITY_OFFICER')).send({ reason: '사이버보안 담당자가 재-HARA 종결 시도' }).expect(403);
    // 경로 담당이 아닌 거부도 감사 이력에 남는다(실패한 승인도 기록)
    const denied = (await app.http().get('/api/audit?target=CI-0002/REHARA').set(actor('usr-auditor', 'AUDITOR')).expect(200)).body;
    expect(JSON.stringify(denied)).toContain('DENIED');
    const r = await app.http().post('/api/change-impacts/CI-0002/paths/SUMS/close').set(actor('usr-csm', 'SECURITY_OFFICER')).send({ reason: 'RXSWIN 갱신 기록', ref: 'SUMS-0022' }).expect(201);
    expect(r.body.paths.find((p: { path: string }) => p.path === 'SUMS').status).toBe('DONE');
    await app.http().post('/api/change-impacts/CI-0002/paths/SUMS/close').set(actor('usr-csm', 'SECURITY_OFFICER')).send({ reason: '다시' }).expect(409);
    const after = (await app.http().get('/api/change-impacts').expect(200)).body as AdsChangeImpactList;
    expect(after.counts).toMatchObject({ SUMS: 0, total: 2 });
    const audit = await app.http().get('/api/audit?target=CI-0002/SUMS').set(actor('usr-auditor', 'AUDITOR')).expect(200);
    expect(JSON.stringify(audit.body)).toContain('ADS_IMPACT_PATH_CLOSE');
  });

  it('판단 불가 변경의 경로는 종결할 수 없다 — 종류부터 정한다', async () => {
    await app.http().post('/api/change-impacts/CI-0003/paths/SUMS/close').set(actor('usr-csm', 'SECURITY_OFFICER')).send({ reason: '종결 시도' }).expect(412);
  });
});

describe('릴리스 비교 (ADS-UI09)', () => {
  it('릴리스 ID는 FEAT-xxxxx-버전, 직전 Version과 비교 — 운행 조건 확대 행이 맨 앞, MRC 계약 변경', async () => {
    const list = (await app.http().get('/api/releases').expect(200)).body as { items: { releaseId: string; baseVersion: string }[] };
    expect(list.items).toContainEqual(expect.objectContaining({ releaseId: 'FEAT-00004-4.1.0', baseVersion: '4.0.1' }));
    const d = (await app.http().get('/api/releases/FEAT-00004-4.1.0/diff').expect(200)).body as ReleaseDiffView;
    expect(d.rows[0]).toMatchObject({ group: 'ODD', field: 'odd.speedKmh', direction: 'WIDEN' });
    expect(d.rows.filter((r) => r.direction === 'WIDEN')).toHaveLength(1);
    expect(d.summary.termination.mrc).toBe(1);
    expect(d.rows.find((r) => r.field === 'dependencies')!.direction).toBe('CHANGED');
    expect(d.cls.primary).toBe('ODD');
    await app.http().get('/api/releases/FEAT-4/diff').expect(400);
  });
});

describe('Feature 분류·시장 기준선 (ADS-BE16)', () => {
  it('확정된 분류는 분류됨, 시장 기준선은 시장별 행(판단 불가 포함)', async () => {
    const v = (await app.http().get('/api/features/FEAT-00004/versions/4.1.0/classification').expect(200)).body as ClassificationView;
    expect(v.completeness.classified).toBe(true);
    expect(v.ruleEnabled).toBe(false);
    expect(v.baselines.map((b) => b.market)).toEqual(['EU', 'KR']);
    expect(v.baselines.find((b) => b.market === 'EU')!.approvalStatus).toBe('UNKNOWN');
    expect(v.baselines.every((b) => b.oddProfileRef === 'ODD-FEAT-00004-v1')).toBe(true);
  });

  it('미분류 목록 — 추정(INFERRED) 초안은 확정 전이라 미분류로 세고, 행이 없는 Feature는 모든 축이 빈칸', async () => {
    const u = (await app.http().get('/api/classification/unclassified').expect(200)).body as UnclassifiedView;
    expect(u.items.length).toBeGreaterThan(0);
    expect(u.ruleEnabled).toBe(false);
    const ids = u.items.map((x) => x.featureId);
    expect(ids).not.toContain('FEAT-00001'); // 확정
    const inferred = u.items.find((x) => x.featureId === 'FEAT-00010')!;
    expect(inferred).toMatchObject({ inferred: true, gaps: ['CONFIRM'] });
    expect(u.items.find((x) => x.featureId === 'FEAT-00019')!.gaps).toEqual(expect.arrayContaining(['DDT', 'LIFECYCLE_OWNER', 'CONFIRM']));
    expect(u.items.find((x) => x.featureId === 'FEAT-00013')!.gaps).toHaveLength(6);
    // 출시한 Feature는 점검 범위 밖
    expect(ids).not.toContain('FEAT-00004');
  });

  it('출시 전이 거부 규칙은 켜지 않았다 — 미분류 Feature도 서버가 전이를 지금 막지는 않는다(목록·사유만)', async () => {
    const v = (await app.http().get('/api/features/FEAT-00013/versions/0.3.0/classification').expect(200)).body as ClassificationView;
    expect(v.completeness.classified).toBe(false);
    expect(v.classification).toBeNull();
    expect(v.ruleEnabled).toBe(false);
  });
});

describe('확대 판정 읽기 (ADS-BE12)', () => {
  it('감시 지표가 기준 시간을 넘기면 확대 보류(지표 지연) — 미확인 차량은 노출량에서 빼고 따로', async () => {
    const pol = (await app.http().get('/api/policies').expect(200)).body.items.find((p: { featureId: string }) => p.featureId === 'FEAT-00022');
    // 축별 근거는 통합 확대 판정(D-INT-4)의 evidence — Canary 관측과 한 응답
    const view = (await app.http().get(`/api/policies/${pol.policyId}/expansion`).expect(200)).body as PolicyExpansionView;
    const v = view.evidence as ExpansionView;
    expect(v.result).toMatchObject({ verdict: 'HOLD', reason: 'METRIC_DELAY' });
    // 가정값 근거는 판정에 보이되 확대를 막지 않는다
    expect(view.decision.findings.find((f) => f.code === 'METRIC_DELAY')).toMatchObject({ source: 'EVIDENCE', blocking: false, waived: 'ASSUMED', items: ['takeoverRate'] });
    expect(view.decision.findings.find((f) => f.code === 'INSUFFICIENT')).toBeUndefined();
    expect(v.vehicleActive).toBe(1820);
    expect(v.unconfirmed).toBe(140);
    expect(v.result.combos.find((c) => c.verdict === 'INSUFFICIENT')).toBeTruthy();
  });
});
