// 차량 수신·긴급 차단·Flag 평가 지표(80-80) — 커밋된 플랫폼 이벤트를 구독해 /api/health/metrics(Prometheus 텍스트)에 더한다.
// 도메인 서비스는 고치지 않고 이벤트만 읽는다. 라벨은 국가·차종·SW·Feature·Flag·결과뿐 — VIN·가명은 라벨·로그에 싣지 않는다.
// 같은 사건을 OTLP 로그(개인정보 없는 필드만)로도 낸다(OTEL_EXPORTER_OTLP_ENDPOINT가 있을 때, Grafana Loki).
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { flagAdoptionCounts } from '@ff/contracts';
import { VehicleRuntimeService } from '../domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { ANNOTATION_EVENTS, effectiveBasisPoints, endState, SIGNATURE_REJECT_REASONS, SILENT_WINDOWS, type KillRequest, type OtelSpan, type Policy } from '@ff/contracts';
import { Clock } from './clock';
import { DB, type Db } from './db';
import { EventService, type PlatformEvent } from './event.service';
import { Metrics, type MetricRegistry } from './observability';
import { OtlpExporter } from './otlp/otlp-exporter';
import { nanos, type OtlpAttrs } from './otlp/otlp-proto';

interface VehicleLabels {
  country: string;
  vehicle_model: string;
  sw_version: string;
}
const UNKNOWN: VehicleLabels = { country: 'unknown', vehicle_model: 'unknown', sw_version: 'unknown' };
const PROFILE_TTL_MS = 10 * 60_000;
const COLLECT_TTL_MS = 30_000;
const ANNOTATED = new Set<string>(ANNOTATION_EVENTS);
const SIGNATURE = new Set<string>(SIGNATURE_REJECT_REASONS);

@Injectable()
export class TelemetryMetrics implements OnModuleInit {
  private readonly log = new Logger('TelemetryMetrics');
  private readonly reg: MetricRegistry;
  private readonly profiles = new Map<string, { at: number; v: VehicleLabels }>();
  private readonly pubs = new Map<string, { featureId: string; createdAt: number; kind: string }>();
  private flagFeature: { at: number; map: Map<string, string> } | null = null;
  /** VIN → 마지막 수신 시각(ms) — 처음 긁을 때 DB에서 한 번 채우고 이후 이벤트로 갱신 */
  private lastSeen: Map<string, number> | null = null;
  private fleetCache: { at: number; rows: (VehicleLabels & { vin: string })[] } | null = null;
  private adoptionAt = -Infinity;
  private adoptionPending: Promise<void> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly events: EventService,
    private readonly clock: Clock,
    metrics: Metrics,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly otlp?: OtlpExporter,
  ) {
    this.reg = metrics.registry;
    this.reg.onCollect(() => this.collect());
    this.reg.onCollectAsync(() => this.collectAdoption());
  }

  onModuleInit() {
    this.events.stream().subscribe((e) => {
      try {
        this.on(e);
      } catch (err) {
        // 지표가 기능을 막지 않는다
        this.log.warn(`${e.type} 지표 처리 실패: ${(err as Error).message}`);
      }
    });
  }

  // ── 조회(캐시) ──────────────────────────────────────────
  vehicle(vin: string): VehicleLabels {
    const now = this.clock.now().getTime();
    const hit = this.profiles.get(vin);
    if (hit && now - hit.at < PROFILE_TTL_MS) return hit.v;
    const r = this.db.get<{ doc: string }>('SELECT doc FROM vehicle WHERE vin = ?', vin) ?? this.db.get<{ doc: string }>('SELECT doc FROM vehicle_profile WHERE vin = ?', vin);
    const d = r ? (JSON.parse(r.doc) as { country?: string; vehicleModel?: string; swVersion?: string }) : null;
    const v = d ? { country: d.country || 'unknown', vehicle_model: d.vehicleModel || 'unknown', sw_version: d.swVersion || 'unknown' } : UNKNOWN;
    if (this.profiles.size > 50_000) this.profiles.clear();
    this.profiles.set(vin, { at: now, v });
    return v;
  }
  private publication(id: string) {
    const hit = this.pubs.get(id);
    if (hit) return hit;
    const r = this.db.get<{ kind: string; created_at: string; doc: string }>('SELECT kind, created_at, doc FROM publication WHERE publication_id = ?', id);
    if (!r) return null;
    const p = { featureId: (JSON.parse(r.doc) as { payload?: { featureId?: string } }).payload?.featureId ?? 'unknown', createdAt: Date.parse(r.created_at), kind: r.kind };
    if (this.pubs.size > 5000) this.pubs.clear();
    this.pubs.set(id, p);
    return p;
  }
  private featureOfFlag(flag: string): string {
    const now = this.clock.now().getTime();
    if (!this.flagFeature || now - this.flagFeature.at > 60_000) {
      const map = new Map<string, string>();
      for (const r of this.db.all<{ flag_key: string; feature_id: string }>("SELECT flag_key, feature_id FROM policy WHERE status = 'DEPLOYED'")) map.set(r.flag_key, r.feature_id);
      this.flagFeature = { at: now, map };
    }
    return this.flagFeature.map.get(flag) ?? 'unknown';
  }
  private kill(killId: string): KillRequest | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM kill_request WHERE kill_id = ?', killId);
    return r ? (JSON.parse(r.doc) as KillRequest) : null;
  }
  private seen(vin: string, at: string) {
    this.lastSeen?.set(vin, Date.parse(at));
  }

  // ── 이벤트 → 지표 ───────────────────────────────────────
  on(e: PlatformEvent) {
    this.adoptionAt = -Infinity;
    const p = (e.payload ?? {}) as Record<string, any>;
    if (ANNOTATED.has(e.type)) this.reg.inc('ff_events_total', { type: e.type });
    switch (e.type) {
      case 'vehicle.status.accepted':
      case 'vehicle.status.rejected':
        return this.statusReport(e, p);
      case 'vehicle.readback':
        return this.readback(e, p);
      case 'publication.dispatched': {
        const targets = (this.db.get<{ doc: string }>('SELECT doc FROM publication WHERE publication_id = ?', p.publicationId)?.doc ?? '{}') as string;
        const n = (JSON.parse(targets) as { payload?: { targets?: string[] } }).payload?.targets?.length ?? 0;
        const unreachable = Array.isArray(p.unreachable) ? p.unreachable.length : 0;
        this.reg.inc('ff_publication_deliveries_total', { kind: p.kind, channel: p.channel ?? 'default' }, Math.max(0, n - unreachable));
        if (unreachable) this.reg.inc('ff_publication_deliveries_total', { kind: p.kind, channel: 'unreachable' }, unreachable);
        return;
      }
      case 'kill.issued':
        this.reg.inc('ff_kill_commands_total', { feature: p.featureId, deact_class: p.deactClass ?? 'DC0' });
        return this.event('kill.issued', 13, { feature: p.featureId, deact_class: p.deactClass ?? 'DC0', kill_id: p.killId, target_vehicles: p.vins ?? 0 });
      case 'kill.released':
        this.reg.inc('ff_kill_releases_total', { feature: p.featureId });
        return this.event('kill.released', 9, { feature: p.featureId, kill_id: p.killId });
      case 'kill.overdue': {
        const k = this.kill(p.killId);
        const n = Array.isArray(p.vins) ? p.vins.length : 0;
        this.reg.inc('ff_kill_overdue_vehicles_total', { feature: p.featureId, deact_class: k?.deactClass ?? 'DC0' }, n);
        return this.event('kill.overdue', 17, { feature: p.featureId, kill_id: p.killId, overdue_vehicles: n });
      }
      case 'vehicle.status.reissue':
        return this.reg.inc('ff_kill_reissues_total', { feature: p.featureId ?? 'unknown' });
      case 'policy.deployed':
      case 'rollout.staged':
        return this.event(e.type, 9, { policy: p.policyId ?? e.aggregate, flag: p.flagKey ?? '' });
    }
  }

  private statusReport(e: PlatformEvent, p: Record<string, any>) {
    const vin = String(p.vin ?? e.aggregate);
    const v = this.vehicle(vin);
    const accepted = e.type === 'vehicle.status.accepted';
    const feature = p.featureId ?? 'unknown';
    const code = accepted ? '' : String(p.code ?? '');
    this.reg.inc('ff_vehicle_status_reports_total', { ...v, feature, via: p.via ?? 'IF-06', result: accepted ? 'accepted' : 'rejected', code });
    // 6단계 검사: 스키마 → state_auth → …. 스키마에서 멈추면 서명은 보지 않았다
    if (accepted || p.step !== 'SCHEMA') this.reg.inc('ff_vehicle_status_auth_total', { country: v.country, vehicle_model: v.vehicle_model, result: !accepted && p.step === 'AUTH' ? 'invalid' : 'valid' });
    if (accepted && Array.isArray(p.dtc) && p.dtc.length) this.reg.inc('ff_vehicle_dtc_reports_total', { country: v.country, vehicle_model: v.vehicle_model, feature });
    this.seen(vin, e.at);
    if (accepted) this.killLatency(vin, feature, String(p.state ?? ''), e.at);
    else this.event('vehicle.status.rejected', 13, { country: v.country, vehicle_model: v.vehicle_model, feature, step: p.step ?? '', code });
  }

  /** 차단·복원 명령 발급 → 차량이 끝 상태를 처음 보고하기까지(같은 상태 보고가 다시 와도 한 번만) */
  private killLatency(vin: string, featureId: string, state: string, at: string) {
    const env = this.db.get<{ kill_id: string; request: string; created_at: string }>(
      'SELECT kill_id, request, created_at FROM vehicle_envelope WHERE vin = ? AND feature_id = ? ORDER BY created_at DESC, vehicle_seq DESC LIMIT 1',
      vin,
      featureId,
    );
    if (!env || (env.request !== 'deactivate' && env.request !== 'restore')) return;
    const k = this.kill(env.kill_id);
    const end = env.request === 'restore' ? 'ACTIVE' : endState(k?.reasonCategory ?? 'SAFETY');
    if (state !== end) return;
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM status_report WHERE vin = ? AND feature_id = ? AND accepted = 1 AND state = ? AND received_at >= ?', vin, featureId, end, env.created_at)?.n ?? 0;
    if (n !== 1) return;
    const seconds = (Date.parse(at) - Date.parse(env.created_at)) / 1000;
    this.reg.observe('ff_kill_apply_latency_seconds', { feature: featureId, deact_class: k?.deactClass ?? 'DC0', request: env.request }, Math.max(0, seconds));
    const v = this.vehicle(vin);
    this.event('kill.applied', 9, { country: v.country, vehicle_model: v.vehicle_model, feature: featureId, kill_id: env.kill_id, request: env.request, latency_ms: Math.round(seconds * 1000) });
  }

  private readback(e: PlatformEvent, p: Record<string, any>) {
    const vin = e.aggregate;
    const v = this.vehicle(vin);
    const pub = p.publicationId ? this.publication(p.publicationId) : null;
    const kind = String(p.kind ?? pub?.kind ?? 'unknown');
    const reason = p.rejectReason ? String(p.rejectReason) : '';
    const feature = pub?.featureId ?? 'unknown';
    this.reg.inc('ff_vehicle_readbacks_total', { ...v, feature, kind, via: p.via ?? 'IF-06', result: reason ? 'rejected' : 'applied', reason });
    this.reg.inc('ff_vehicle_signature_checks_total', { country: v.country, vehicle_model: v.vehicle_model, kind, result: SIGNATURE.has(reason) ? 'invalid' : 'valid' });
    const latency = pub ? (Date.parse(e.at) - pub.createdAt) / 1000 : NaN;
    if (Number.isFinite(latency)) this.reg.observe('ff_vehicle_readback_latency_seconds', { kind, country: v.country }, Math.max(0, latency));
    this.seen(vin, e.at);
    this.event('vehicle.readback', reason ? 13 : 9, {
      country: v.country,
      vehicle_model: v.vehicle_model,
      sw_version: v.sw_version,
      feature,
      publication_id: p.publicationId ?? '',
      kind,
      result: reason ? 'rejected' : 'applied',
      reason,
      ...(Number.isFinite(latency) && { latency_ms: Math.round(latency * 1000) }),
    });
  }

  /** OpenFeature 평가 span(feature_flag.evaluation) → 평가 수·오류 — OtelExporter가 부른다 */
  evaluations(spans: OtelSpan[]) {
    for (const s of spans) {
      if (s.name !== 'feature_flag.evaluation') continue;
      const a = s.attributes as Record<string, string | number | boolean | undefined>;
      const flag = String(a['feature_flag.key'] ?? 'unknown');
      const reason = String(a['feature_flag.result.reason'] ?? 'unknown').toUpperCase();
      this.reg.inc('ff_flag_evaluations_total', { flag, feature: this.featureOfFlag(flag), reason, variant: a['feature_flag.result.variant'] ?? '', provider: a['feature_flag.provider.name'] ?? '' });
      if (a['error.type']) this.reg.inc('ff_flag_evaluation_errors_total', { flag, error: a['error.type'] });
    }
  }

  /** Unleash Edge 호출 한 번 */
  edge(op: string, ok: boolean, seconds: number) {
    this.reg.observe('ff_unleash_edge_request_duration_seconds', { op, result: ok ? 'ok' : 'error' }, seconds);
  }

  /** Unleash 대조 결과 — 서버 정의가 원천과 다르면 1 */
  drift(flag: string, drifted: boolean) {
    this.reg.set('ff_unleash_drift', { flag }, drifted ? 1 : 0);
  }

  /** 운영 관찰(Grafana 경보) 기록 수 */
  observation(axis: string, status: string) {
    this.reg.inc('ff_ops_observations_total', { axis, status });
  }

  private event(name: string, severityNumber: number, attributes: OtlpAttrs) {
    if (!this.otlp?.enabled) return;
    this.otlp.log({ timeNs: nanos(this.clock.now().getTime()), severityNumber, severityText: severityNumber >= 17 ? 'ERROR' : severityNumber >= 13 ? 'WARN' : 'INFO', body: name, eventName: name, attributes: { event: name, ...attributes } });
  }

  // ── 긁을 때 채우는 gauge ─────────────────────────────────
  private async collectAdoption(): Promise<void> {
    const now = this.clock.now().getTime();
    if (now - this.adoptionAt < COLLECT_TTL_MS) return;
    if (this.adoptionPending) return this.adoptionPending;
    this.adoptionPending = (async () => {
      const runtime = await this.moduleRef.get(VehicleRuntimeService, { strict: false }).fleetStatus();
      const policies = this.db.all<{ doc: string }>("SELECT doc FROM policy WHERE status = 'DEPLOYED'").map((r) => JSON.parse(r.doc) as Policy);
      const flags = [...new Map(policies.map((p) => [p.flagKey, { flagKey: p.flagKey, stageRatio: effectiveBasisPoints(p) / 10000 }])).values()];
      const rows = flagAdoptionCounts(runtime.items, this.fleet(), flags);
      this.reg.clear('ff_flag_adoption_vehicles');
      for (const { vehicles, ...labels } of rows) this.reg.set('ff_flag_adoption_vehicles', labels, vehicles);
      this.adoptionAt = now;
    })();
    try { await this.adoptionPending; } finally { this.adoptionPending = null; }
  }

  private fleet() {
    const now = this.clock.now().getTime();
    if (this.fleetCache && now - this.fleetCache.at < COLLECT_TTL_MS) return this.fleetCache.rows;
    const rows = this.db.all<{ vin: string; doc: string }>('SELECT vin, doc FROM vehicle').map((r) => {
      const d = JSON.parse(r.doc) as { country?: string; vehicleModel?: string; swVersion?: string };
      return { vin: r.vin, country: d.country || 'unknown', vehicle_model: d.vehicleModel || 'unknown', sw_version: d.swVersion || 'unknown' };
    });
    this.fleetCache = { at: now, rows };
    return rows;
  }

  private loadLastSeen() {
    const m = new Map<string, number>();
    const put = (vin: string, at: string | null) => {
      const t = at ? Date.parse(at) : NaN;
      if (Number.isFinite(t) && t > (m.get(vin) ?? 0)) m.set(vin, t);
    };
    for (const r of this.db.all<{ vin: string; at: string | null }>('SELECT vin, max(received_at) AS at FROM status_report GROUP BY vin')) put(r.vin, r.at);
    for (const r of this.db.all<{ vin: string; at: string | null }>('SELECT vin, max(at) AS at FROM readback GROUP BY vin')) put(r.vin, r.at);
    return m;
  }

  collect() {
    const now = this.clock.now().getTime();
    const fleet = this.fleet();
    this.lastSeen ??= this.loadLastSeen();
    const reg = new Map<string, number>();
    const silent = new Map<string, number>();
    for (const v of fleet) {
      const rk = JSON.stringify([v.country, v.vehicle_model, v.sw_version]);
      reg.set(rk, (reg.get(rk) ?? 0) + 1);
      const last = this.lastSeen.get(v.vin) ?? 0;
      for (const [w, ms] of Object.entries(SILENT_WINDOWS)) {
        const sk = JSON.stringify([v.country, v.vehicle_model, w]);
        silent.set(sk, (silent.get(sk) ?? 0) + (now - last > ms ? 1 : 0));
      }
    }
    this.reg.clear('ff_vehicles_registered');
    for (const [k, n] of reg) {
      const [country, vehicle_model, sw_version] = JSON.parse(k) as string[];
      this.reg.set('ff_vehicles_registered', { country, vehicle_model, sw_version }, n);
    }
    this.reg.clear('ff_vehicles_silent');
    for (const [k, n] of silent) {
      const [country, vehicle_model, window] = JSON.parse(k) as string[];
      this.reg.set('ff_vehicles_silent', { country, vehicle_model, window }, n);
    }
    // 걸려 있는 차단 — 대상·아직 끝 상태가 아닌 차량
    this.reg.clear('ff_kill_target_vehicles');
    this.reg.clear('ff_kill_pending_vehicles');
    for (const r of this.db.all<{ doc: string }>("SELECT doc FROM kill_request WHERE status = 'ACTIVE'")) {
      const k = JSON.parse(r.doc) as KillRequest;
      const end = endState(k.reasonCategory ?? 'SAFETY');
      const labels = { feature: k.featureId, deact_class: k.deactClass ?? 'DC0' };
      const pending = k.vins.filter((vin) => this.db.get<{ state: string }>('SELECT state FROM vehicle_feature_status WHERE vin = ? AND feature_id = ?', vin, k.featureId)?.state !== end).length;
      this.reg.set('ff_kill_target_vehicles', labels, this.reg.value('ff_kill_target_vehicles', labels) + k.vins.length);
      this.reg.set('ff_kill_pending_vehicles', labels, this.reg.value('ff_kill_pending_vehicles', labels) + pending);
    }
    // 배포된 Flag — 정책·Feature 결합, 단계 배포 비율
    this.reg.clear('ff_flag_info');
    this.reg.clear('ff_rollout_stage_ratio');
    for (const r of this.db.all<{ doc: string }>("SELECT doc FROM policy WHERE status = 'DEPLOYED'")) {
      const p = JSON.parse(r.doc) as Policy;
      const sp = this.db.get<{ doc: string }>('SELECT doc FROM safety_profile WHERE feature_id = ? AND version = ?', p.featureId, p.featureVersion);
      const fClass = sp ? ((JSON.parse(sp.doc) as { fClass?: string }).fClass ?? 'unknown') : 'unknown';
      this.reg.set('ff_flag_info', { flag: p.flagKey, policy: p.policyId, feature: p.featureId, feature_version: p.featureVersion, f_class: fClass }, 1);
      this.reg.set('ff_rollout_stage_ratio', { flag: p.flagKey, policy: p.policyId, feature: p.featureId }, effectiveBasisPoints(p) / 10000);
    }
    this.reg.clear('ff_ext_outbox_pending');
    for (const r of this.db.all<{ system: string; n: number }>("SELECT system, count(*) AS n FROM sync_outbox WHERE status = 'PENDING' GROUP BY system")) this.reg.set('ff_ext_outbox_pending', { system: r.system }, r.n);
  }
}

/** 수집 span → OTLP span(Tempo) — 가명(feature_flag.context.id)은 빼고 보낸다 */
export function otlpSpanOf(s: OtelSpan): { traceId: string; spanId: string; name: string; kind: number; startNs: bigint; endNs: bigint; attributes: OtlpAttrs; status?: { code: number; message?: string } } | null {
  const start = Date.parse(s.startTime);
  if (!Number.isFinite(start) || !/^[0-9a-f]{32}$/.test(s.traceId) || !/^[0-9a-f]{16}$/.test(s.spanId)) return null;
  const end = (s as { endTime?: string }).endTime ? Date.parse((s as { endTime?: string }).endTime!) : start + 1;
  const attributes: OtlpAttrs = {};
  for (const [k, v] of Object.entries(s.attributes ?? {})) if (k !== 'feature_flag.context.id' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) attributes[k] = v;
  const error = typeof attributes['error.type'] === 'string';
  return { traceId: s.traceId, spanId: s.spanId, name: s.name, kind: 1, startNs: nanos(start), endNs: nanos(Number.isFinite(end) ? end : start + 1), attributes, ...(error && { status: { code: 2, message: String(attributes['error.type']) } }) };
}
