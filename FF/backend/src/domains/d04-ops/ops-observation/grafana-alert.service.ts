// Grafana 경보 → FF 운영 관찰(개선 후보) (D04-03, 80-80 Closed loop) — Grafana Alerting webhook 연락처가 부른다.
// 확인: FF_GRAFANA_WEBHOOK_TOKEN(Authorization: Bearer) · FF_GRAFANA_WEBHOOK_SECRET(HMAC-SHA256 hex, 시각 머리글이 있으면 "시각:본문")
// — 둘 다 없으면 창구가 꺼져 있다(404). 둘 다 있으면 둘 다 맞아야 한다. 같은 경보(지문·시작 시각·상태)는 한 번만 기록한다.
// 기록: 이벤트 ops.observation.recorded(감사 포함). 문제·운영·위험 축이 Feature를 가리키고 규칙 라벨 ff_anomaly_kind가 있으면
// 이상 징후(D06-12)가 이 이벤트를 신호로 받는다. 규칙 라벨 ff_indicator(FF 판정 지표)가 있으면 Feature 운영 점검(TL-B08)이 점검 결과의
// 감지 입력(출처 Grafana)으로 받는다(통합 D-INT-3) — 판정 정본은 FF 규칙이고, 경보가 점검 결과를 닫지는 않는다.
import { Controller, Get, HttpCode, Inject, Injectable, Post, Query, Req } from '@nestjs/common';
import { observationAxisOf, observationSeverityOf, type OpsObservation } from '@ff/contracts';
import type { Request } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookEndpoint, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { TelemetryMetrics } from '../../../kernel/telemetry-metrics';

type Env = Record<string, string | undefined>;
const GRAFANA: Actor = { id: 'system:grafana', role: 'SYSTEM', correlationId: 'grafana-alerting' };
const MAX_ALERTS = 200;
/** 시각 머리글을 쓰면 이 범위 밖 요청은 재전송으로 본다 */
const SKEW_MS = 5 * 60_000;
const ANOMALY_KINDS = new Set(['FEATURE_FAULT', 'DELIVERY', 'SECURITY']);

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const str = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** 서명·토큰 확인 — 실패는 예외(401·404) */
export function verifyGrafanaWebhook(headers: Record<string, string | string[] | undefined>, raw: string, nowMs: number, env: Env = process.env) {
  const token = env.FF_GRAFANA_WEBHOOK_TOKEN ?? '';
  const secret = env.FF_GRAFANA_WEBHOOK_SECRET ?? '';
  if (!token && !secret) throw new DomainError('NOT_FOUND', 'Grafana 경보 수신이 꺼져 있습니다(FF_GRAFANA_WEBHOOK_TOKEN 또는 FF_GRAFANA_WEBHOOK_SECRET).');
  const h = (name: string) => {
    const v = headers[name.toLowerCase()];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  if (token && !same(h('authorization').replace(/^Bearer\s+/i, ''), token)) throw new DomainError('UNAUTHENTICATED', 'Grafana 경보 토큰이 맞지 않습니다.');
  if (secret) {
    const sig = h(env.FF_GRAFANA_WEBHOOK_SIGNATURE_HEADER || 'X-Grafana-Alerting-Signature').trim().toLowerCase();
    const ts = h(env.FF_GRAFANA_WEBHOOK_TIMESTAMP_HEADER || 'X-Grafana-Alerting-Timestamp').trim();
    if (ts) {
      const t = Number(ts) * (ts.length > 11 ? 1 : 1000);
      if (!Number.isFinite(t) || Math.abs(nowMs - t) > SKEW_MS) throw new DomainError('UNAUTHENTICATED', 'Grafana 경보 서명 시각이 허용 범위를 벗어났습니다.');
    }
    const want = createHmac('sha256', secret).update(ts ? `${ts}:${raw}` : raw).digest('hex');
    if (!sig || !same(sig, want)) throw new DomainError('UNAUTHENTICATED', 'Grafana 경보 서명이 맞지 않습니다.');
  }
}

@Injectable()
@PlatformComponent('D04-03')
export class GrafanaAlertService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly events: EventService,
    private readonly audit: AuditService,
    private readonly metrics: TelemetryMetrics,
  ) {}

  private featureExists(id: string) {
    return !!this.db.get('SELECT 1 FROM feature_version WHERE feature_id = ? LIMIT 1', id);
  }
  private duplicate(key: string) {
    return !!this.db.get("SELECT 1 FROM events WHERE type = 'ops.observation.recorded' AND payload LIKE ? LIMIT 1", `%"observationId":"${key}"%`);
  }

  ingest(headers: Record<string, string | string[] | undefined>, raw: string, body: unknown) {
    verifyGrafanaWebhook(headers, raw, this.clock.now().getTime());
    const alerts = (body as { alerts?: unknown })?.alerts;
    if (!Array.isArray(alerts)) throw new DomainError('VALIDATION', 'Grafana 경보 본문에 alerts 목록이 없습니다.');
    if (alerts.length > MAX_ALERTS) throw new DomainError('VALIDATION', `한 번에 경보 ${MAX_ALERTS}건까지 받습니다.`);
    const recorded: OpsObservation[] = [];
    let duplicates = 0;
    for (const a of alerts as Record<string, any>[]) {
      const labels = (a?.labels ?? {}) as Record<string, unknown>;
      const ann = (a?.annotations ?? {}) as Record<string, unknown>;
      const status = a?.status === 'resolved' ? 'resolved' : 'firing';
      const fingerprint = str(a?.fingerprint, 64) ?? createHash('sha256').update(JSON.stringify(labels)).digest('hex').slice(0, 16);
      const startsAt = str(a?.startsAt, 40) ?? this.clock.iso();
      const observationId = 'OBS-' + createHash('sha256').update(`${fingerprint}|${startsAt}|${status}`).digest('hex').slice(0, 20);
      if (this.duplicate(observationId)) {
        duplicates++;
        continue;
      }
      const featureId = str(labels.feature, 40);
      const known = !!featureId && this.featureExists(featureId);
      const kind = str(labels.ff_anomaly_kind, 20);
      const axis = observationAxisOf(labels.ff_axis);
      const values = a?.values && typeof a.values === 'object' ? JSON.stringify(a.values).slice(0, 500) : str(a?.valueString, 500);
      const obs: OpsObservation = {
        observationId,
        source: 'GRAFANA',
        rule: str(labels.alertname, 120) ?? 'unknown',
        status,
        axis,
        severity: observationSeverityOf(labels.severity),
        featureId,
        featureVersion: str(labels.feature_version, 20),
        flagKey: str(labels.flag, 80),
        country: str(labels.country, 8),
        vehicleModel: str(labels.vehicle_model, 40),
        summary: str(ann.summary, 300) ?? str(labels.alertname, 120) ?? '경보',
        description: str(ann.description, 2000),
        value: values,
        startsAt,
        endsAt: status === 'resolved' ? str(a?.endsAt, 40) : null,
        fingerprint,
        dashboardUrl: str(a?.dashboardURL, 500),
        panelUrl: str(a?.panelURL, 500),
        anomalyKind: status === 'firing' && known && kind && ANOMALY_KINDS.has(kind) && axis !== 'IMPROVEMENT' ? (kind as OpsObservation['anomalyKind']) : null,
        indicator: str(labels.ff_indicator, 40),
        receivedAt: this.clock.iso(),
      };
      this.db.tx(() => {
        this.events.publish('ops.observation.recorded', featureId ?? 'PLATFORM', obs, { componentId: 'D04-03', correlationId: GRAFANA.correlationId });
        this.audit.record(GRAFANA, 'OPS_OBSERVATION', observationId, { after: { rule: obs.rule, status, axis, featureId, severity: obs.severity, anomalyKind: obs.anomalyKind }, componentId: 'D04-03' });
      });
      this.metrics.observation(axis, status);
      recorded.push(obs);
    }
    return { accepted: recorded.length, duplicates, items: recorded.map((o) => ({ observationId: o.observationId, axis: o.axis, featureId: o.featureId, anomalyKind: o.anomalyKind })) };
  }

  list(q: { featureId?: string; axis?: string; status?: string; limit?: number }) {
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const rows = this.events.list({ type: 'ops.observation.recorded', ...(q.featureId ? { aggregate: q.featureId } : {}), limit: 1000, recent: true });
    const items = rows
      .map((e) => e.payload as OpsObservation)
      .filter((o) => (!q.axis || o.axis === q.axis) && (!q.status || o.status === q.status))
      .reverse()
      .slice(0, limit);
    return { items };
  }
}

@Controller()
export class GrafanaAlertController {
  constructor(private readonly s: GrafanaAlertService) {}

  /** Grafana Alerting webhook 연락처 — 행위자 머리글 대신 토큰·HMAC으로 확인 */
  @Post('api/webhooks/grafana/alerts')
  @HttpCode(202)
  @WebhookEndpoint()
  webhook(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    return this.s.ingest(req.headers, raw, req.body);
  }

  @Get('api/ops/observations')
  list(@Query('featureId') featureId?: string, @Query('axis') axis?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.s.list({ featureId, axis, status, limit: limit ? Number(limit) : undefined });
  }
}
