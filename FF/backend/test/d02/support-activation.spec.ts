// 활성화 전 차량 지원 조건 확인 (D02-02·D01-09, 보고서 v1.1 · FFG-VEH-006) — 합격: 불만족 조건에서 활성화 0건, 사유 보고 100%.
// 서버 활성화 판단·OFREP·차량 조회가 같은 판정을 쓴다 — 지원 조건(대상 ECU SW ≥ 기능 앱 요구 Version)이 맞지 않으면 체험권이 있어도 OFF, 사유 NOT_SUPPORTED.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp } from '../helpers';

describe('활성화 전 지원 조건 (FFG-VEH-006)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T01:00:00.000Z' });
  });
  afterAll(async () => b.app.close());

  it('FFG-VEH-006 지원 조건 미달 차량은 활성화하지 않고 사유를 보고 — 지원 조건 관리 화면과 같은 판정', async () => {
    const http = b.http;
    const support = (await http().get('/api/support/KMH-NX4-0004').expect(200)).body;
    const row = support.items.find((i: any) => i.featureId === 'FEAT-00022');
    expect(row).toMatchObject({ verdict: 'NOT_SUPPORTED' });
    const d = (await http().get('/api/activation/decide?vin=KMH-NX4-0004&flagKey=care_00022_param').expect(200)).body;
    expect(d.result).toMatchObject({ value: false, decision: 'DENY', reason: 'NOT_SUPPORTED' });
    expect(d.result.trace.find((t: any) => t.step === 'SUPPORT')).toMatchObject({ result: 'FALSE', detail: row.reason });
    // 조건을 만족하는 차량은 그대로(지원 조건 단계 TRUE)
    const ok = (await http().get('/api/activation/decide?vin=ego-01&flagKey=care_00022_param').expect(200)).body;
    expect(ok.result.trace.find((t: any) => t.step === 'SUPPORT')).toMatchObject({ result: 'TRUE' });
    // OFREP 표준 사유는 DISABLED
    const o = (await http().post('/ofrep/v1/evaluate/flags/care_00022_param').send({ context: { targetingKey: 'KMH-NX4-0004' } }).expect(200)).body;
    expect(o).toMatchObject({ value: false, reason: 'DISABLED' });
  });
});
