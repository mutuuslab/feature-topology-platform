// 차량 텔레메트리 수신 지표(80-80 Grafana 연동) — 카탈로그 이름만, 라벨은 국가·차종·SW·Feature·Flag·결과(VIN 없음),
// 카디널리티 상한, 긴급 차단 반영 지연, 상태 보고 서명(state_auth) 검증 결과, Flag 평가 수가 /api/health/metrics에 나온다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterEach, describe, expect, it } from 'vitest';
import { exposedSeriesNames, TELEMETRY_METRICS } from '@ff/contracts';
import { Clock } from '../../src/kernel/clock';
import { MetricRegistry } from '../../src/kernel/observability';
import { Scheduler } from '../../src/kernel/scheduler';
import { otlpSpanOf } from '../../src/kernel/telemetry-metrics';
import { bootApp, killV2, SDK_KEY } from '../helpers';

describe('지표 등록부 — 단위', () => {
  it('카탈로그에 없는 이름·종류가 다른 쓰기는 거부한다', () => {
    const r = new MetricRegistry();
    expect(() => r.inc('ff_no_such_total')).toThrow(/카탈로그에 없는 지표/);
    expect(() => r.set('ff_vehicle_status_reports_total', {}, 1)).toThrow(/gauge가 아니다/);
  });

  it('라벨 값을 이스케이프하고 64자로 자른다', () => {
    const r = new MetricRegistry();
    r.inc('ff_events_total', { type: 'a"b\\c\nd' + 'x'.repeat(100) });
    const line = r.text().split('\n').find((l) => l.startsWith('ff_events_total{'))!;
    expect(line).toContain('type="a\\"b\\\\c d');
    expect(line.length).toBeLessThan(120);
  });

  it('시계열 상한을 넘는 새 조합은 _other로 합치고 버린 수를 센다', () => {
    const r = new MetricRegistry(3);
    for (let i = 0; i < 6; i++) r.inc('ff_kill_reissues_total', { feature: `FEAT-${i}` });
    const t = r.text();
    expect(t.match(/^ff_kill_reissues_total\{/gm)).toHaveLength(4);
    expect(t).toContain('ff_kill_reissues_total{feature="_other"} 3');
    expect(t).toContain('ff_metrics_series_dropped_total{metric="ff_kill_reissues_total"} 3');
  });

  it('histogram은 칸을 누적해 내고 +Inf·합·개수를 낸다', () => {
    const r = new MetricRegistry();
    for (const v of [0.5, 3, 3, 7200, 99999]) r.observe('ff_vehicle_readback_latency_seconds', { kind: 'POLICY', country: 'KR' }, v);
    const t = r.text();
    expect(t).toContain('ff_vehicle_readback_latency_seconds_bucket{kind="POLICY",country="KR",le="1"} 1');
    expect(t).toContain('ff_vehicle_readback_latency_seconds_bucket{kind="POLICY",country="KR",le="5"} 3');
    expect(t).toContain('ff_vehicle_readback_latency_seconds_bucket{kind="POLICY",country="KR",le="21600"} 4');
    expect(t).toContain('ff_vehicle_readback_latency_seconds_bucket{kind="POLICY",country="KR",le="+Inf"} 5');
    expect(t).toContain('ff_vehicle_readback_latency_seconds_count{kind="POLICY",country="KR"} 5');
  });

  it('카탈로그 라벨에 VIN·가명·사람 ID가 없다', () => {
    const banned = /vin|pseudonym|subject|user|actor|email|targeting/i;
    for (const m of TELEMETRY_METRICS) for (const l of m.labels) expect(banned.test(l), `${m.name}.${l}`).toBe(false);
    expect(exposedSeriesNames().filter((n) => n.startsWith('ff_kill_apply_latency_seconds'))).toEqual(['ff_kill_apply_latency_seconds_bucket', 'ff_kill_apply_latency_seconds_sum', 'ff_kill_apply_latency_seconds_count']);
  });

  it('Tempo로 보내는 span에서 가명(feature_flag.context.id)을 뺀다', () => {
    const s = otlpSpanOf({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'feature_flag.evaluation', startTime: '2026-11-06T00:00:00.000Z', attributes: { 'feature_flag.key': 'care_00022_signal', 'feature_flag.context.id': 'abcd', 'error.type': 'flag_not_found' } })!;
    expect(s.attributes).toEqual({ 'feature_flag.key': 'care_00022_signal', 'error.type': 'flag_not_found' });
    expect(s.status).toEqual({ code: 2, message: 'flag_not_found' });
  });
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

describe('차량 수신 지표 — 앱 흐름', () => {
  it('긴급 차단 → 차량 상태 보고·회신 → 수신·반영 지연·서명 검증·미수신 차량·Flag 평가가 지표로 나온다(VIN 없음)', async () => {
    const b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
    close = () => b.app.close();
    const clock = b.get(Clock);
    const scheduler = b.get(Scheduler);
    const advance = (ms: number) => {
      const until = clock.now().getTime() + ms;
      scheduler.flush(ms);
      clock.set(new Date(until));
    };
    await killV2(b.http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: '지표 시험', confirm: 'FEAT-00022' });
    advance(8_000);
    // 위조 상태 보고(서명 불일치) — 거부·서명 invalid
    const st = (await b.http().get('/api/vehicles/ego-01/status').expect(200)).body.features[0].report;
    await b.http().post('/vehicle/v1/ego-01/status').set({ 'X-Vehicle-Id': 'ego-01' }).send({ ...st, state: 'ACTIVE', report_seq: st.report_seq + 1 }).expect(200);
    await b.http().post('/ofrep/v1/evaluate/flags/ivi_00024_guide').set(SDK_KEY).send({ context: { targetingKey: 'KMH-NX4-0001' } }).expect(200);
    await b.http().post('/ofrep/v1/evaluate/flags/no_such_flag').set(SDK_KEY).send({ context: { targetingKey: 'KMH-NX4-0001' } }).expect(404);

    const text = (await b.http().get('/api/health/metrics').expect(200)).text;
    expect(text).toMatch(/ff_vehicle_status_reports_total\{country="KR",vehicle_model="NX4 PE",sw_version="[^"]+",feature="FEAT-00022",via="SIM",result="accepted",code=""\} [1-9]/);
    expect(text).toMatch(/ff_vehicle_status_reports_total\{[^}]*feature="FEAT-00022",via="IF-06",result="rejected",code="AUTH_FAILED"\} 1/);
    expect(text).toMatch(/ff_vehicle_status_auth_total\{country="KR",vehicle_model="NX4 PE",result="invalid"\} 1/);
    expect(text).toMatch(/ff_kill_commands_total\{feature="FEAT-00022",deact_class="DC\d"\} 1/);
    expect(text).toMatch(/ff_kill_apply_latency_seconds_count\{feature="FEAT-00022",deact_class="DC\d",request="deactivate"\} 2/);
    expect(text).toMatch(/ff_vehicle_readbacks_total\{[^}]*feature="FEAT-00022",kind="KILL",[^}]*result="applied",reason=""\} [1-9]/);
    expect(text).toMatch(/ff_vehicle_signature_checks_total\{[^}]*kind="KILL",result="valid"\} [1-9]/);
    expect(text).toMatch(/ff_vehicle_readback_latency_seconds_count\{kind="KILL",country="KR"\} [1-9]/);
    expect(text).toMatch(/ff_kill_target_vehicles\{feature="FEAT-00022",deact_class="DC\d"\} 2/);
    expect(text).toMatch(/ff_kill_pending_vehicles\{feature="FEAT-00022",deact_class="DC\d"\} 0/);
    expect(text).toMatch(/ff_vehicles_registered\{country="KR",vehicle_model="NX4 PE",sw_version="[^"]+"\} [1-9]/);
    expect(text).toMatch(/ff_vehicles_silent\{country="KR",vehicle_model="NX4 PE",window="24h"\} \d+/);
    expect(text).toMatch(/ff_flag_evaluations_total\{flag="ivi_00024_guide",feature="FEAT-00024",reason="[A-Z_]+",variant="[^"]*",provider="ffp-ofrep"\} 1/);
    expect(text).toMatch(/ff_flag_evaluation_errors_total\{flag="no_such_flag",error="flag_not_found"\} 1/);
    expect(text).toMatch(/ff_flag_info\{flag="care_00022_signal",policy="POL-00001",feature="FEAT-00022",feature_version="1.0.0",f_class="[^"]+"\} 1/);
    expect(text).toMatch(/ff_events_total\{type="kill.issued"\} 1/);
    // VIN·가명은 지표에 없다
    for (const vin of ['ego-01', 'lead-01', 'KMH-NX4-0001']) expect(text).not.toContain(vin);
    // 노출한 이름은 모두 카탈로그에 있다(대시보드·경보가 같은 이름을 쓴다)
    const known = new Set(exposedSeriesNames());
    const names = new Set(text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/[{ ]/)[0]));
    expect([...names].filter((n) => !known.has(n))).toEqual([]);
  });
});
