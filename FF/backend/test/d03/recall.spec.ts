// 안전 Kill과 리콜·봉쇄 절차 연계 (D03-03, 보고서 v1.1 · FFG-DEAC-010) — 근거 없는 F2 이상 안전 Kill은 요청 단계에서 거부·감사, 근거가 있으면
// 결함 판정 시각과 대상 시장별 결함 보고 기한(미국 5영업일, 그 밖은 법규 담당 확인)을 차단 요청 기록에 남긴다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, KILL_REQUESTER } from '../helpers';

const BODY = { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: '전방 거리 오추정', confirm: 'FEAT-00022', reasonCategory: 'SAFETY', reasonCode: 'DIST_EST_BIAS' };

describe('안전 Kill과 리콜·봉쇄 (FFG-DEAC-010)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-16T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });

  it('FFG-DEAC-010 리콜 번호·봉쇄 근거 없는 F2 이상 안전 Kill 요청은 거부되고 감사에 FAILED로 남는다', async () => {
    const r = await b.http().post('/api/kill-requests').set(KILL_REQUESTER).send(BODY).expect(400);
    expect(r.body.error.details).toMatchObject({ rule: 'FFG-DEAC-010' });
    const audit = (await b.http().get('/api/audit?target=FEAT-00022&result=FAILED').expect(200)).body.items;
    expect(audit.some((a: any) => a.action === 'KILL_REQUEST' && /FFG-DEAC-010/.test(a.reason ?? ''))).toBe(true);
  });

  it('FFG-DEAC-010 근거가 있으면 결함 판정 시각과 시장별 보고 기한을 기록 — 보고서에 기한이 없는 시장은 법규 담당 확인', async () => {
    const r = await b.http().post('/api/kill-requests').set(KILL_REQUESTER).send({ ...BODY, recallCampaignId: 'RC-2026-001', defectDeterminedAt: '2026-10-16T00:00:00.000Z' }).expect(201);
    const k = (await b.http().get(`/api/kill-requests/${r.body.killId}`).expect(200)).body;
    expect(k).toMatchObject({ recallCampaignId: 'RC-2026-001', defectDeterminedAt: '2026-10-16T00:00:00.000Z' });
    expect(k.recallReports).toEqual([{ market: 'KR', defectDeterminedAt: '2026-10-16T00:00:00.000Z', due: null, basis: '보고서에 기한 없음', note: '시장 보고 기한은 법규 담당 확인' }]);
  });
});
