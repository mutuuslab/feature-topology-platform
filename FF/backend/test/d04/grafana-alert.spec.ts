// Grafana 경보 → FF 운영 관찰(80-80 Closed loop) — 토큰·HMAC 확인, 중복 버림, 감사·이벤트 기록,
// 문제 축 Feature 경보는 이상 징후(D06-12) 신호, 개선 축은 운영 관찰로만 남는다.
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyGrafanaWebhook } from '../../src/domains/d04-ops/ops-observation/grafana-alert.service';
import { bootApp } from '../helpers';

const SECRET = 's'.repeat(40);
const NOW = Date.parse('2026-11-06T01:00:00.000Z');
const sign = (raw: string, ts?: string) => createHmac('sha256', SECRET).update(ts ? `${ts}:${raw}` : raw).digest('hex');

describe('Grafana webhook 확인 — 단위', () => {
  it('설정이 없으면 꺼짐(404), 토큰·서명이 틀리면 401, 오래된 시각은 재전송으로 거부', () => {
    expect(() => verifyGrafanaWebhook({}, '{}', NOW, {})).toThrow(/꺼져 있습니다/);
    expect(() => verifyGrafanaWebhook({ authorization: 'Bearer nope' }, '{}', NOW, { FF_GRAFANA_WEBHOOK_TOKEN: 't'.repeat(32) })).toThrow(/토큰이 맞지 않습니다/);
    expect(() => verifyGrafanaWebhook({ authorization: `Bearer ${'t'.repeat(32)}` }, '{}', NOW, { FF_GRAFANA_WEBHOOK_TOKEN: 't'.repeat(32) })).not.toThrow();
    const env = { FF_GRAFANA_WEBHOOK_SECRET: SECRET };
    expect(() => verifyGrafanaWebhook({ 'x-grafana-alerting-signature': sign('{"a":1}') }, '{"a":1}', NOW, env)).not.toThrow();
    expect(() => verifyGrafanaWebhook({ 'x-grafana-alerting-signature': sign('{"a":2}') }, '{"a":1}', NOW, env)).toThrow(/서명이 맞지 않습니다/);
    const ts = String(NOW / 1000);
    expect(() => verifyGrafanaWebhook({ 'x-grafana-alerting-signature': sign('{}', ts), 'x-grafana-alerting-timestamp': ts }, '{}', NOW, env)).not.toThrow();
    const old = String(NOW / 1000 - 3600);
    expect(() => verifyGrafanaWebhook({ 'x-grafana-alerting-signature': sign('{}', old), 'x-grafana-alerting-timestamp': old }, '{}', NOW, env)).toThrow(/허용 범위/);
  });
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
  delete process.env.FF_GRAFANA_WEBHOOK_SECRET;
});

const alert = (o: { name: string; axis: string; feature?: string; kind?: string; status?: string; severity?: string }) => ({
  status: o.status ?? 'firing',
  labels: { alertname: o.name, ff_axis: o.axis, ff_source: 'feature-platform', severity: o.severity ?? 'critical', ...(o.feature && { feature: o.feature, feature_version: '1.0.0', vehicle_model: 'NX4 PE' }), ...(o.kind && { ff_anomaly_kind: o.kind }) },
  annotations: { summary: `${o.name} 요약`, description: '근거와 조치' },
  startsAt: '2026-11-06T00:55:00Z',
  endsAt: '0001-01-01T00:00:00Z',
  fingerprint: `fp-${o.name}`,
  dashboardURL: 'https://example.grafana.net/d/ff-feature-health',
  panelURL: 'https://example.grafana.net/d/ff-feature-health?viewPanel=3',
  values: { A: 0.31 },
});

describe('Grafana 경보 수신 — 앱 흐름', () => {
  it('문제 축 Feature 경보 → 운영 관찰 + 이상 징후, 개선 축 → 운영 관찰만, 같은 경보는 한 번만', async () => {
    process.env.FF_GRAFANA_WEBHOOK_SECRET = SECRET;
    const b = await bootApp({ at: '2026-11-06T01:00:00.000Z' });
    close = () => b.app.close();
    const body = { receiver: 'ff', status: 'firing', alerts: [alert({ name: '출시 후 오류 증가', axis: 'PROBLEM', feature: 'FEAT-00022', kind: 'FEATURE_FAULT' }), alert({ name: '사용률 저조', axis: 'IMPROVEMENT', feature: 'FEAT-00024', kind: 'FEATURE_FAULT', severity: 'warning' })] };
    const raw = JSON.stringify(body);
    // 서명이 없으면 401 — 아무것도 기록하지 않는다
    await b.http().post('/api/webhooks/grafana/alerts').set('Content-Type', 'application/json').send(raw).expect(401);
    const r = await b.http().post('/api/webhooks/grafana/alerts').set('Content-Type', 'application/json').set('X-Grafana-Alerting-Signature', sign(raw)).send(raw).expect(202);
    expect(r.body).toMatchObject({ accepted: 2, duplicates: 0 });
    expect(r.body.items.map((i: { anomalyKind: string | null }) => i.anomalyKind)).toEqual(['FEATURE_FAULT', null]);
    // 다시 보내면 중복
    const again = await b.http().post('/api/webhooks/grafana/alerts').set('Content-Type', 'application/json').set('X-Grafana-Alerting-Signature', sign(raw)).send(raw).expect(202);
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 2 });

    const obs = (await b.http().get('/api/ops/observations?featureId=FEAT-00022').expect(200)).body.items;
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ source: 'GRAFANA', rule: '출시 후 오류 증가', axis: 'PROBLEM', severity: 'CRITICAL', featureId: 'FEAT-00022', anomalyKind: 'FEATURE_FAULT', dashboardUrl: 'https://example.grafana.net/d/ff-feature-health' });
    expect((await b.http().get('/api/ops/observations?axis=IMPROVEMENT').expect(200)).body.items[0]).toMatchObject({ featureId: 'FEAT-00024', anomalyKind: null, severity: 'WARNING' });

    const fault = (await b.http().get('/api/anomalies?kind=FEATURE_FAULT&featureId=FEAT-00022').expect(200)).body.items;
    expect(fault).toHaveLength(1);
    expect(fault[0].signals[0]).toMatchObject({ code: 'GRAFANA:출시 후 오류 증가', vin: null });
    expect((await b.http().get('/api/anomalies?kind=FEATURE_FAULT&featureId=FEAT-00024').expect(200)).body.items).toHaveLength(0);

    const audit = (await b.http().get('/api/audit?action=OPS_OBSERVATION').set({ 'X-Actor-Id': 'usr-auditor', 'X-Actor-Role': 'AUDITOR' }).expect(200)).body;
    expect((audit.items ?? audit).length).toBe(2);
    const text = (await b.http().get('/api/health/metrics').expect(200)).text;
    expect(text).toContain('ff_ops_observations_total{axis="PROBLEM",status="firing"} 1');
    expect(text).toContain('ff_events_total{type="ops.observation.recorded"} 2');

    // 해결(resolved)은 새 관찰이지만 이상 징후 신호는 아니다
    const resolved = JSON.stringify({ alerts: [alert({ name: '출시 후 오류 증가', axis: 'PROBLEM', feature: 'FEAT-00022', kind: 'FEATURE_FAULT', status: 'resolved' })] });
    expect((await b.http().post('/api/webhooks/grafana/alerts').set('Content-Type', 'application/json').set('X-Grafana-Alerting-Signature', sign(resolved)).send(resolved).expect(202)).body.items[0].anomalyKind).toBeNull();
  });
});
