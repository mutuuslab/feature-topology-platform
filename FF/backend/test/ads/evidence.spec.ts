// ADS 증거 — ADS 사건 보고(ADS-BE13)·Safety Case 근거 지도(ADS-BE14)·요구 추적(ADS-UI10) API. 시드는 data/fixtures/ads/evidence.json(시드 시각 기준 상대값)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

const AT = '2026-10-20T00:00:00.000Z';
const DAY = 86_400_000;
const STEWARD = actor('usr-steward', 'REGULATORY_OWNER');
const OPS = actor('usr-ops', 'OPERATOR');

let b: Awaited<ReturnType<typeof bootApp>>;
beforeAll(async () => {
  b = await bootApp({ at: AT });
});
afterAll(() => b.app.close());

describe('ADS 사건 보고 (ADS-BE13)', () => {
  it('목록 — 확정된 사건만 7일 기한 경보에 세고, 후보·판단 불가는 따로 센다', async () => {
    const r = (await b.http().get('/api/incident-reports').expect(200)).body;
    expect(r.items).toHaveLength(6);
    expect(r.summary).toMatchObject({ total: 6, dueWithin7: 2, reportable: 3, candidates: 1, undecidable: 1, deadlineUnregistered: 1 });
    const due2 = r.items.find((i: any) => i.reportId === 'ADSI-2026-0002');
    expect(r.summary.nearestDue).toBe(due2.shortTermDue);
    // 후보(30초 창 해당, 확정 전)는 기한이 있어도 경보에 세지 않는다
    const cand = r.items.find((i: any) => i.reportId === 'ADSI-2026-0003');
    expect(cand).toMatchObject({ reportStatus: 'CANDIDATE', dueWithin7: false, determination: null });
  });

  it('기한 계산 — 발생 시각이 아니라 인지 시각 + 30일, 승인 전 시장은 기한을 계산하지 않는다', async () => {
    const items = (await b.http().get('/api/incident-reports').expect(200)).body.items as any[];
    const kr = items.find((i) => i.reportId === 'ADSI-2026-0001');
    expect(Date.parse(kr.shortTermDue) - Date.parse(kr.awareAt)).toBe(30 * DAY);
    expect(Date.parse(kr.occurredAt)).toBeLessThan(Date.parse(kr.awareAt));
    const us = items.find((i) => i.reportId === 'ADSI-2026-0005');
    expect(us).toMatchObject({ market: 'US', shortTermDue: null, deadlineRegistered: false, reportStatus: 'UNDECIDABLE' });
    expect(us.activeWindow.value).toBe('UNDECIDABLE'); // 판단 불가 — 해당 없음·비대상으로 세지 않는다
  });

  it('상세 — 차량 순서와 서버 수신 순서를 각각 보존하고, DSSAD는 상관 ID만 둔다', async () => {
    const d = (await b.http().get('/api/incident-reports/ADSI-2026-0002').expect(200)).body;
    expect(d.orderDiffers).toBe(true);
    const verdict = d.events.find((e: any) => e.kind === 'VERDICT');
    expect(verdict).toMatchObject({ vehicleSeq: 4, ingestSeq: 6 });
    expect(d.events.some((e: any) => e.gap)).toBe(true);
    expect(d.dssadCorrelationId).toMatch(/^DSSAD-/);
    await b.http().get('/api/incident-reports/ADSI-2099-0001').expect(404);
  });

  it('보고 대상 확정 — 안전·법규 담당만, 사유 필수, 추가만 하고 감사 기록', async () => {
    await b.http().post('/api/incident-reports/ADSI-2026-0003/determination').set(OPS).send({ decision: 'REPORTABLE', reason: '운영자 판단' }).expect(403);
    await b.http().post('/api/incident-reports/ADSI-2026-0003/determination').set(STEWARD).send({ decision: 'REPORTABLE' }).expect(400);
    const d = (await b.http().post('/api/incident-reports/ADSI-2026-0003/determination').set(STEWARD).send({ decision: 'REPORTABLE', reason: '사건 12초 전까지 ADS 활성 — 보고 대상' }).expect(201)).body;
    expect(d).toMatchObject({ reportStatus: 'REPORTABLE', determination: { version: 1, decidedBy: 'usr-steward' } });
    expect(d.audit.map((a: any) => a.action)).toContain('ADS_INCIDENT_DETERMINE');
    const d2 = (await b.http().post('/api/incident-reports/ADSI-2026-0003/determination').set(actor('usr-quality', 'SAFETY_OFFICER')).send({ decision: 'NOT_REPORTABLE', reason: '재검토 — 활성 창 근거 정정' }).expect(201)).body;
    expect(d2.determinations.map((x: any) => x.version)).toEqual([1, 2]);
    expect(d2.reportStatus).toBe('NOT_REPORTABLE');
    expect(() => b.get<Db>(DB).run("UPDATE ads_incident_determination SET doc = '{}'")).toThrow(/추가만/);
  });

  it('정기 보고 — 노출량당 비율은 확정된 사건만, 후보·판단 불가는 따로', async () => {
    const p = (await b.http().get('/api/periodic-reports/2026').expect(200)).body;
    expect(p.exposure.hours).toBeGreaterThan(0);
    expect(p.months.length).toBe(10); // 2026-01 … 2026-10(KST)
    expect(p.incidents.undecidable).toBe(1);
    expect(p.per1kHours).toBe(Math.round((p.incidents.reportable / p.exposure.hours) * 1000 * 1000) / 1000);
    await b.http().get('/api/periodic-reports/abcd').expect(400);
  });
});

describe('Safety Case 근거 지도 (ADS-BE14)', () => {
  it('주장 6개 — 형상 불일치·한계·미검토·가정값은 지지로 세지 않고, 열린 중대 발견이 있으면 승격 불가', async () => {
    const v = (await b.http().get('/api/safety-case/FEAT-00004').expect(200)).body;
    expect(v.claims.map((c: any) => c.claim.nodeId)).toEqual(['C01', 'C02', 'C03', 'C04', 'C05', 'C06']);
    expect(v.counts).toMatchObject({ claims: 6, unsupportedClaims: 3, mismatch: 1, limit: 1, unreviewed: 1, assumed: 1 });
    expect(v.promotion).toEqual({ promotable: false, openMajor: 1 });
    expect(v.findings.map((f: any) => [f.findingId, f.status, f.reviewerIndependent])).toEqual([
      ['RF-0001', 'OPEN', true],
      ['RF-0002', 'CLOSED', true],
    ]);
    await b.http().get('/api/safety-case/FEAT-00022').expect(404);
  });

  it('회귀: 다른 형상의 PASS 재사용 거부 — manifest는 기존 Evidence 원장 참조로 연결된다', async () => {
    const m = (await b.http().get('/api/evidence-manifests/EVM-0002').expect(200)).body;
    expect(m).toMatchObject({ origin: 'REUSED', result: 'PASS', evidenceRef: 'SAMPLE-EV-000055-TEST-RESULT' });
    expect(m.config.sw).not.toBe(m.target.sw);
    const v = (await b.http().get('/api/safety-case/FEAT-00004').expect(200)).body;
    const ev = v.claims[0].arguments[1].evidence[0];
    expect(ev).toMatchObject({ manifestId: 'EVM-0002', support: 'MISMATCH' });
    expect(ev.mismatch).toEqual(expect.arrayContaining(['sw', 'model']));
  });

  it('독립 검토 — Evidence 작성자는 발견사항을 등록할 수 없고(사유), 다른 Safety Manager는 등록한다', async () => {
    const body = { manifestId: 'EVM-0001', severity: 'MAJOR', summary: '거부 사유 근거 부족' };
    await b.http().post('/api/review-findings').set(OPS).send(body).expect(403);
    const denied = await b.http().post('/api/review-findings').set(actor('usr-integrator', 'SAFETY_OFFICER')).send(body).expect(403);
    expect(denied.body.error.message).toBe('이 Evidence를 만든 사람은 독립 검토자로 발견사항을 등록할 수 없습니다.');
    const f = (await b.http().post('/api/review-findings').set(actor('usr-safety2', 'SAFETY_OFFICER')).send(body).expect(201)).body;
    expect(f).toMatchObject({ findingId: 'RF-0003', status: 'OPEN', reviewerIndependent: true });
    const v = (await b.http().get('/api/safety-case/FEAT-00004').expect(200)).body;
    expect(v.promotion.openMajor).toBe(2);
  });
});

describe('ADS·UNECE 요구 추적 (ADS-UI10)', () => {
  it('생성 파일 — 요구 64·인수시험 24·시나리오 10, 원본 판과 검토 시점', async () => {
    const t = (await b.http().get('/api/ads/trace').expect(200)).body;
    expect([t.requirements.length, t.tests.length, t.scenarios.length]).toEqual([64, 24, 10]);
    expect(t.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(t.summary.total).toBe(64);
    expect(t.summary.notImplemented).toBe(t.summary.counts.PARTIAL + t.summary.counts.NOT_IMPLEMENTED + t.summary.counts.NO_EVIDENCE);
  });
});
