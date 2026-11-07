// Feature별 평가 운영 데이터 (기능명세서 B5, D04-03) — 평가 span이 일 단위·flag·경로·앱·환경·결과·분기값으로 집계되고,
// Feature 기준으로 평가·활성·비활성·분기값 횟수를 돌려준다. 수집기(IF-11)가 꺼져도 집계는 계속된다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluationSpan } from '@ff/contracts';
import { OtelExporter } from '../../src/adapters/if-mocks/otel.exporter';
import { bootApp, SDK_KEY } from '../helpers';

describe('Feature별 평가 운영 데이터 (D04-03)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  const http = () => b.http();
  const stats = async (id: string, q = '') => (await http().get(`/api/features/${id}/evaluations${q}`).expect(200)).body;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-11-06T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'IF_MODE_11']) delete process.env[k];
  });

  it('평가가 없으면 0 — Feature의 flag 목록과 기간(일 단위, 기본 14일)', async () => {
    const s = await stats('FEAT-00024');
    expect(s).toMatchObject({ featureId: 'FEAT-00024', flagKeys: ['ivi_00024_guide'], period: { from: '2026-10-24', to: '2026-11-06', days: 14, unit: 'DAY' }, totals: { evaluations: 0, on: 0, off: 0 } });
  });

  it('FR-OPD-001-005~008·FR-OPD-002-001·FR-OPD-003-001 앱 평가(OFREP) — appName·environment를 보내면 앱별로, 활성·분기값 횟수', async () => {
    for (let i = 0; i < 3; i++) await http().post('/ofrep/v1/evaluate/flags/ivi_00024_guide').set(SDK_KEY).send({ context: { targetingKey: 'ego-01', appName: 'ivi-nav', environment: 'production' } }).expect(200);
    await http().post('/ofrep/v1/evaluate/flags').set(SDK_KEY).send({ context: { targetingKey: 'ego-01' } }).expect(200); // 앱 식별 없이 → 기본 이름
    const s = await stats('FEAT-00024');
    expect(s.totals.evaluations).toBe(4);
    expect(s.totals.on + s.totals.off + s.totals.safeDefault + s.totals.errors).toBe(4);
    expect(s.byApp).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ appName: 'ivi-nav', environment: 'production', source: 'OFREP', count: 3, lastDay: '2026-11-06' }),
        expect.objectContaining({ appName: 'ofrep-client', environment: 'default', source: 'OFREP', count: 1 }),
      ]),
    );
    expect(s.byVariant.reduce((n: number, v: any) => n + v.count, 0)).toBe(4);
    expect(s.daily).toEqual([expect.objectContaining({ day: '2026-11-06', count: 4 })]);
    expect(s.byFlag).toEqual([expect.objectContaining({ flagKey: 'ivi_00024_guide', count: 4 })]);
  });

  it('수집기(IF-11)가 꺼져도 평가 횟수는 센다 · 오류 평가는 오류로', async () => {
    process.env.IF_MODE_11 = 'off';
    try {
      await http().post('/ofrep/v1/evaluate/flags/ivi_00024_guide').set(SDK_KEY).send({ context: { targetingKey: 'ego-01', appName: 'ivi-nav', environment: 'production' } }).expect(200);
      await http().post('/ofrep/v1/evaluate/flags/ivi_00024_guide').set(SDK_KEY).send({ context: { targetingKey: 'ego-01', latitude: 37.5 } }).expect(400);
    } finally {
      delete process.env.IF_MODE_11;
    }
    const s = await stats('FEAT-00024');
    expect(s.totals.evaluations).toBe(6);
    expect(s.totals.errors).toBe(1);
  });

  it('차량 SDK 평가 경로(차량 묶음 provider의 감사 Hook) — F2 이상은 Safe Default로 세어진다', async () => {
    const otel = b.get(OtelExporter);
    otel.export([evaluationSpan({ flagKey: 'care_00022_param', provider: 'ffp-vehicle-bundle', subject: 'abcdef0123456789', fClass: 'F3', variant: 'safe_default', reason: 'DISABLED', errorType: null, snapshotVersion: null, at: '2026-11-06T01:00:00.000Z', traceSeed: 't' })]);
    const s = await stats('FEAT-00022');
    expect(s.totals).toMatchObject({ evaluations: 1, safeDefault: 1 });
    expect(s.bySource).toEqual([expect.objectContaining({ source: 'VEHICLE_SDK', count: 1 })]);
    expect(s.byApp[0]).toMatchObject({ appName: 'vehicle-sdk', environment: 'fleet' });
  });

  it('한 저장소·한 수집기 — 차량 SDK span이 Flag 평가 모니터링(1시간 창)에도 같은 수로, 폴백 사유·차량 수(묶음 안 가명 고유 수)까지', async () => {
    const otel = b.get(OtelExporter);
    const at = '2026-11-06T00:40:00.000Z';
    const span = (subject: string, variant: string, reason: string) => evaluationSpan({ flagKey: 'ivi_00024_guide', provider: 'ffp-vehicle-bundle', subject, fClass: 'F1', variant, reason, errorType: null, snapshotVersion: null, at, traceSeed: `${subject}${variant}` });
    otel.export([span('a000000000000001', 'on', 'TARGETING_MATCH'), span('a000000000000002', 'off', 'DEFAULT'), span('a000000000000003', 'safe_default', 'STALE'), span('a000000000000001', 'on', 'TARGETING_MATCH')]);
    const e = (await http().get('/api/flag-code/evaluations?window=1h&flagKey=ivi_00024_guide').expect(200)).body;
    const v = e.items.find((x: { source: string }) => x.source === 'VEHICLE_SDK');
    expect(v).toMatchObject({ evaluations: 4, enabled: 2, disabled: 2, errors: 0, vehicles: 3, fallbacks: [{ reason: 'TTL_EXPIRED', count: 1 }], lastEvaluatedAt: '2026-11-06T00:00:00.000Z' });
    const s = (await http().get('/api/flag-code/evaluations/ivi_00024_guide?window=24h').expect(200)).body;
    expect(s.buckets).toEqual(expect.arrayContaining([{ bucketStart: '2026-11-06T00:00:00.000Z', source: 'VEHICLE_SDK', evaluations: 4, enabled: 2, fallbacks: 1, errors: 0 }]));
    // Feature 상세 '평가 운영'도 같은 칸을 읽는다(앞 시험의 앱 평가 6회 + 4회)
    const f = await stats('FEAT-00024');
    expect(f.totals).toMatchObject({ evaluations: 10, safeDefault: 1 });
    expect(f.bySource).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'VEHICLE_SDK', count: 4, on: 2, off: 1, safeDefault: 1 })]));
  });

  it('기간은 1~90일, 없는 Feature는 404', async () => {
    await http().get('/api/features/FEAT-00024/evaluations?days=0').expect(400);
    await http().get('/api/features/FEAT-00024/evaluations?days=91').expect(400);
    expect((await stats('FEAT-00024', '?days=1')).period).toMatchObject({ from: '2026-11-06', to: '2026-11-06', days: 1 });
    await http().get('/api/features/FEAT-99999/evaluations').expect(404);
  });
});
