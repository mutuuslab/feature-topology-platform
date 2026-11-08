// ADS 상태 읽기 모델(ADS-BE01 읽기·ADS-UI01·ADS-UI06·ORC-UI03) — 6축(상품 권리·구성과 설치·정책 의도·전달·활성 적격·실제 실행·관측 신선도),
// 게시본 수렴 7구간, 행위별 판정, 고객에게 보이는 상태. 판정 규칙은 contracts rules/ads-state.ts 하나(화면과 같은 함수).
// 차량 보고 수신 경로(상태 보고 2.1 POST)는 이 범위 밖 — 표(vehicle_feature_report·safety_verdict·delivery_ack)를 읽기만 하고, 데모 시드는 가상 데이터(source SIMULATED)로 넣는다.
import { Controller, Get, Inject, Injectable, OnModuleInit, Param, Query } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AdsStateFixture,
  classifyDelivery,
  CUSTOMER_AXES,
  CUSTOMER_TEXT,
  convergenceCounts,
  cumulativeDelivery,
  customerProjection,
  eligibilityOf,
  entitlementAxisOf,
  freshnessOf,
  installAxisOf,
  kstShort,
  reasonLabel,
  REPORT_INTERVAL_DEFAULT_MS,
  reportedValue,
  stateComboText,
  VERDICT_ACTIONS,
  type AxisDistribution,
  type ConvergenceView,
  type CustomerAxis,
  type CustomerFeatureState,
  type CustomerStateView,
  type DdtOwner,
  type DeliveryEvent,
  type DeliveryStage,
  type FeatureClass,
  type FleetAxisView,
  type FreshnessView,
  type OtaStage,
  type RuntimeState,
  type VehicleFeatureAxes,
  type VehicleFeatureStateView,
  type VehicleVerdictsView,
  type VerdictAction,
  type VerdictRow,
  type VerdictValue,
} from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { isProduction, seedOf } from '../../../kernel/runtime-config';

const FIXTURE = join(__dirname, '..', '..', '..', '..', '..', 'data', 'fixtures', 'ads', 'state.json');
const MIN = 60_000;

interface FeatureDoc {
  featureId: string;
  version: string;
  name: string;
  country: string;
  vehicleModel: string;
  trim: string;
  asil?: string;
  tags?: string[];
  baselineId?: string;
}
interface VehicleDoc {
  vin: string;
  country: string;
  vehicleModel: string;
  trim: string;
  fleet?: string;
}
interface PubDoc {
  publicationId: string;
  kind: 'POLICY' | 'KILL' | 'RESTORE';
  status: string;
  createdAt: string;
  nodes: { nodeId: string; state: string; reason: string }[];
  payload: { featureId: string; featureVersion: string; flagKey: string | null; targets: string[] };
}
interface ReadbackDoc {
  vin: string;
  metricType: 'READBACK' | 'ACK';
  observed: string;
  rejectReason?: string;
  at: string;
}
interface ReportRow {
  vin: string;
  feature_id: string;
  observed_at: string;
  received_at: string;
  runtime_state: RuntimeState | null;
  ddt_owner: DdtOwner | null;
  ota_stage: OtaStage | null;
  offline_since: string | null;
  source: 'VEHICLE' | 'SIMULATED';
  doc: string;
}
interface ReportDoc {
  version: string;
  configMatch: boolean | null;
  configRef: string | null;
  reconnect: { at: string; gapMs: number } | null;
  restore: { integrity: 'OK' | 'FAILED'; inhibitReleased: boolean } | null;
  changes: { axis: CustomerAxis; before: string; after: string; reason: string }[];
  /** 상태 보고 2.1(W) — 재시동 뒤 복구가 검증되지 않은 보고. 실제 실행·활성 적격을 현재 값으로 세지 않는다 */
  restoreUnverified?: boolean;
}
interface VerdictDbRow {
  feature_id: string;
  action: VerdictAction;
  verdict: VerdictValue;
  reason_codes: string;
  session_id: string | null;
  observed_at: string;
  received_at: string;
  source: 'VEHICLE' | 'SIMULATED';
  /** 상태 보고 2.1 판정 유효 기한(W) — 지나면 그 판정을 현재 값으로 다시 쓰지 않는다 */
  valid_until?: string | null;
}
export interface OrderDoc {
  orderId: string;
  vin: string;
  catalogId: string;
  featureId: string;
  entitlementId: string | null;
  status: 'PAID' | 'CANCELLED' | 'REFUNDED';
  paidAt: string;
  entitlement: 'CONFIRMED' | 'FAILED' | 'UNCONFIRMED';
  entitlementAt: string | null;
  config: 'CONFIRMED' | 'FAILED' | 'UNCONFIRMED';
  policy: { stage: DeliveryStage; at: string } | null;
  readyReport: { at: string; ok: boolean } | null;
  usageAt: string | null;
  refund: { requestedAt: string; completedAt: string | null } | null;
  source: 'SIMULATED' | 'BILLING';
}

@Injectable()
@PlatformComponent('D02-03')
export class AdsStateService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private now() {
    return this.clock.now().getTime();
  }
  private ago(min: number) {
    return new Date(this.now() - min * MIN).toISOString();
  }

  // ─────────── 데모 시드 — 표가 비었고 FF_SEED!=='none'일 때만, 기존 Feature·VIN이 있을 때만, 한 트랜잭션 ───────────
  onModuleInit() {
    if (isProduction() || seedOf() === 'none' || !existsSync(FIXTURE)) return;
    // 한 번만 — 시드 표 중 하나라도 행이 있으면(재시작·일부만 맞는 데이터셋) 다시 넣지 않는다
    if (this.db.get('SELECT 1 FROM feature_report_basis UNION ALL SELECT 1 FROM vehicle_feature_report UNION ALL SELECT 1 FROM safety_verdict UNION ALL SELECT 1 FROM order_link LIMIT 1')) return;
    const fx = AdsStateFixture.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    const hasVin = (vin: string) => !!this.db.get('SELECT 1 FROM vehicle WHERE vin = ?', vin);
    const hasFeature = (id: string, ver?: string) => !!(ver ? this.db.get('SELECT 1 FROM feature_version WHERE feature_id = ? AND version = ?', id, ver) : this.db.get('SELECT 1 FROM feature_version WHERE feature_id = ?', id));
    const hasCatalog = (id: string) => !!this.db.get('SELECT 1 FROM product WHERE catalog_id = ?', id);
    const hasGrant = (id: string) => !!this.db.get('SELECT 1 FROM entitlement WHERE grant_id = ?', id);
    this.db.tx(() => {
      for (const b of fx.basis) if (hasFeature(b.featureId, b.version)) this.db.run('INSERT INTO feature_report_basis (feature_id, version, feature_class, interval_ms, status, doc) VALUES (?, ?, ?, ?, ?, ?)', b.featureId, b.version, b.featureClass, b.intervalMs, b.status, JSON.stringify(b));
      for (const r of fx.reports) {
        if (!hasVin(r.vin) || !hasFeature(r.featureId, r.version)) continue;
        const observed = this.ago(r.observedAgoMin);
        const doc: ReportDoc = { version: r.version, configMatch: r.configMatch, configRef: r.configRef, reconnect: r.reconnect ? { at: this.ago(r.reconnect.agoMin), gapMs: r.reconnect.gapMin * MIN } : null, restore: r.restore, changes: r.changes };
        this.db.run(
          'INSERT INTO vehicle_feature_report (vin, feature_id, observed_at, received_at, runtime_state, ddt_owner, ota_stage, offline_since, source, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          r.vin, r.featureId, observed, new Date(Date.parse(observed) + 2000).toISOString(), r.runtimeState, r.ddtOwner, r.otaStage, r.offlineSinceAgoMin == null ? null : this.ago(r.offlineSinceAgoMin), 'SIMULATED', JSON.stringify(doc),
        );
      }
      for (const v of fx.verdicts) {
        if (!hasVin(v.vin) || !hasFeature(v.featureId)) continue;
        const observed = this.ago(v.observedAgoMin);
        this.db.run(
          'INSERT INTO safety_verdict (vin, feature_id, action, verdict, reason_codes, session_id, observed_at, received_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          v.vin, v.featureId, v.action, v.verdict, JSON.stringify(v.reasonCodes), v.sessionId, observed, new Date(Date.parse(observed) + 2000).toISOString(), 'SIMULATED',
        );
      }
      for (const o of fx.orders) {
        if (!hasVin(o.vin) || !hasCatalog(o.catalogId) || !hasFeature(o.featureId)) continue;
        const grant = o.entitlementId && hasGrant(o.entitlementId) ? o.entitlementId : null;
        const doc: OrderDoc = {
          orderId: o.orderId, vin: o.vin, catalogId: o.catalogId, featureId: o.featureId, entitlementId: grant, status: o.status, paidAt: this.ago(o.paidAgoMin),
          entitlement: o.entitlement, entitlementAt: o.entitlementAgoMin == null ? null : this.ago(o.entitlementAgoMin), config: o.config,
          policy: o.policy ? { stage: o.policy.stage, at: this.ago(o.policy.agoMin) } : null, readyReport: o.readyReport ? { at: this.ago(o.readyReport.agoMin), ok: o.readyReport.ok } : null,
          usageAt: o.usageAgoMin == null ? null : this.ago(o.usageAgoMin), refund: o.refund ? { requestedAt: this.ago(o.refund.requestedAgoMin), completedAt: o.refund.completedAgoMin == null ? null : this.ago(o.refund.completedAgoMin) } : null, source: 'SIMULATED',
        };
        this.db.run(
          'INSERT INTO order_link (order_id, idempotency_key, vin, catalog_id, entitlement_id, publication_id, activation_state, deadline_at, refund_state, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          o.orderId, o.idempotencyKey, o.vin, o.catalogId, grant, null, o.readyReport?.ok ? 'READY_REPORTED' : 'UNCONFIRMED', new Date(Date.parse(doc.paidAt) + 24 * 3600_000).toISOString(), o.refund ? (o.refund.completedAgoMin == null ? 'REQUESTED' : 'COMPLETED') : null, JSON.stringify(doc),
        );
      }
    });
  }

  /**
   * 데모 활동 마지막 단계 — 실제 게시본(같은 종류·Feature의 가장 최근 것)에 전달 단계 회신(가상 데이터)을 붙인다. 게시 시각 + afterSec(지금을 넘지 않음).
   * 이미 결과 회신(적용·거부)이 있는 차량은 건너뛴다 — 결과 보고를 덮지 않는다. 한 번만(가상 회신이 있으면 다시 하지 않는다).
   */
  seedDeliveryAcks(): string {
    if (!existsSync(FIXTURE)) return '픽스처 없음';
    if (this.db.get("SELECT 1 FROM delivery_ack WHERE source = 'SIMULATED' LIMIT 1")) return '이미 있음';
    const fx = AdsStateFixture.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    const pubs = this.publications();
    const out: string[] = [];
    this.db.tx(() => {
      for (const a of fx.deliveryAcks) {
        const pub = pubs.filter((p) => p.kind === a.match.kind && p.payload.featureId === a.match.featureId && p.payload.targets.includes(a.vin)).sort((x, y) => y.publicationId.localeCompare(x.publicationId))[0];
        if (!pub) continue;
        const done = this.deliveryEvents(pub, a.vin).some((e) => e.stage === 'APPLIED' || e.stage === 'REJECTED');
        if (done) continue;
        const at = new Date(Math.min(this.now(), Date.parse(pub.createdAt) + a.afterSec * 1000)).toISOString();
        this.db.run('INSERT INTO delivery_ack (subject_kind, subject_id, vin, stage, reason_code, observed_at, received_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', pub.kind, pub.publicationId, a.vin, a.stage, a.reasonCode, at, at, 'SIMULATED');
        out.push(`${pub.publicationId}:${a.vin}:${a.stage}`);
      }
    });
    return out.length ? `전달 단계 회신 ${out.length}건 (${out.join(', ')})` : '대상 게시본 없음';
  }

  // ─────────── 기준 데이터 ───────────

  private features(featureId: string): FeatureDoc[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM feature_version WHERE feature_id = ?', featureId).map((r) => JSON.parse(r.doc) as FeatureDoc);
  }
  private feature(featureId: string, version?: string | null): FeatureDoc | null {
    const xs = this.features(featureId);
    return xs.find((f) => f.version === version) ?? xs.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0] ?? null;
  }
  private vehicle(vin: string): VehicleDoc | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM vehicle WHERE vin = ?', vin);
    return r ? (JSON.parse(r.doc) as VehicleDoc) : null;
  }
  private basisRows() {
    return this.db.all<{ feature_id: string; version: string; feature_class: FeatureClass; interval_ms: number | null; status: string }>('SELECT feature_id, version, feature_class, interval_ms, status FROM feature_report_basis ORDER BY feature_id');
  }
  /** 기준 시간 — 기준 시간 표(승인 값 또는 가정값), 표에 없으면 ASIL·분류로 등급을 정해 가정값 */
  basisOf(featureId: string): { featureClass: FeatureClass; staleAfterMs: number; assumed: boolean; version: string | null } {
    const b = this.db.get<{ version: string; feature_class: FeatureClass; interval_ms: number | null; status: string }>('SELECT version, feature_class, interval_ms, status FROM feature_report_basis WHERE feature_id = ?', featureId);
    if (b) return { featureClass: b.feature_class, staleAfterMs: b.interval_ms ?? REPORT_INTERVAL_DEFAULT_MS[b.feature_class], assumed: b.status !== 'APPROVED' || b.interval_ms == null, version: b.version };
    const f = this.feature(featureId);
    const cls: FeatureClass = f && (f.tags?.includes('adas') || ['B', 'C', 'D'].includes(f.asil ?? '')) ? 'ADAS' : 'QM';
    return { featureClass: cls, staleAfterMs: REPORT_INTERVAL_DEFAULT_MS[cls], assumed: true, version: null };
  }
  private publications(): PubDoc[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM publication ORDER BY publication_id').map((r) => JSON.parse(r.doc) as PubDoc);
  }
  private publication(id: string): PubDoc | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM publication WHERE publication_id = ?', id);
    return r ? (JSON.parse(r.doc) as PubDoc) : null;
  }
  /** 상품(최신 Version) → 포함 Feature — Baseline으로 잇는다 */
  catalog(catalogId: string): { name: string; saleType: string; featureIds: string[] } | null {
    const rows = this.db.all<{ version: string; doc: string }>('SELECT version, doc FROM product WHERE catalog_id = ?', catalogId).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    if (!rows.length) return null;
    const p = JSON.parse(rows[0].doc) as { name: string; saleType?: string; baselineIds?: string[] };
    const ids = p.baselineIds ?? [];
    const featureIds = ids.length ? this.db.all<{ feature_id: string }>(`SELECT DISTINCT feature_id FROM feature_version WHERE baseline_id IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => r.feature_id) : [];
    return { name: p.name, saleType: p.saleType ?? '구매', featureIds };
  }

  // ─────────── 보고 ───────────

  private latestReport(vin: string, featureId: string): (ReportRow & { parsed: ReportDoc }) | null {
    const r = this.db.get<ReportRow>('SELECT * FROM vehicle_feature_report WHERE vin = ? AND feature_id = ? ORDER BY id DESC LIMIT 1', vin, featureId);
    return r ? { ...r, parsed: JSON.parse(r.doc) as ReportDoc } : null;
  }
  /** 관측 신선도 — 서버가 계산(contracts freshnessOf). 재연결 표시는 재연결이 기준 시간 안일 때만 */
  freshness(vin: string, featureId: string): FreshnessView {
    const b = this.basisOf(featureId);
    const r = this.latestReport(vin, featureId);
    const state = freshnessOf({ observedAt: r?.observed_at, offlineSince: r?.offline_since, staleAfterMs: b.staleAfterMs, now: this.now() });
    const rc = r?.parsed.reconnect ?? null;
    return { state, observedAt: r?.observed_at ?? null, receivedAt: r?.received_at ?? null, offlineSince: r?.offline_since ?? null, staleAfterMs: b.staleAfterMs, assumed: b.assumed, reconnect: rc && this.now() - Date.parse(rc.at) <= b.staleAfterMs ? rc : null };
  }

  /**
   * 한 차량의 전달 단계 — 회신(IF-06): 거부 사유 → 로컬 거부, 게시본 노드 CONFIRMED의 회신 → 적용, ACK·불일치 회신 → 수신(적용으로 세지 않음),
   * 그리고 전달 단계 회신 원장(delivery_ack)
   */
  deliveryEvents(pub: PubDoc, vin: string): DeliveryEvent[] {
    const node = pub.nodes.find((n) => n.nodeId === vin);
    const out: DeliveryEvent[] = [];
    for (const r of this.db.all<{ doc: string }>('SELECT doc FROM readback WHERE publication_id = ? AND vin = ? ORDER BY id', pub.publicationId, vin).map((x) => JSON.parse(x.doc) as ReadbackDoc)) {
      if (r.rejectReason) out.push({ stage: 'REJECTED', at: r.at, reasonCode: r.rejectReason });
      else if (r.metricType === 'READBACK' && node?.state === 'CONFIRMED') out.push({ stage: 'APPLIED', at: r.at });
      else out.push({ stage: 'RECEIVED', at: r.at });
    }
    for (const a of this.db.all<{ stage: DeliveryStage; observed_at: string; reason_code: string | null }>('SELECT stage, observed_at, reason_code FROM delivery_ack WHERE subject_id = ? AND vin = ? ORDER BY id', pub.publicationId, vin))
      out.push({ stage: a.stage, at: a.observed_at, reasonCode: a.reason_code });
    return out;
  }

  /** 게시본 수렴 — 배타 7구간(합 = 대상 차량), 핵심 값 = 대상 − 적용 확인, 누적(수신·수락)은 보조 */
  convergence(id: string): ConvergenceView {
    const pub = this.publication(id);
    if (!pub) throw new DomainError('NOT_FOUND', `게시본 ${id}을(를) 찾을 수 없습니다.`);
    const b = this.basisOf(pub.payload.featureId);
    const per = pub.payload.targets.map((vin) => ({ vin, events: this.deliveryEvents(pub, vin) }));
    const vehicles = per.map(({ vin, events }) => {
      const c = classifyDelivery(events, b.staleAfterMs, this.now());
      return { vin, bin: c.bin, lastStage: c.last?.stage ?? null, at: c.last?.at ?? null, reasonCode: c.last?.reasonCode ?? null };
    });
    const bins = convergenceCounts(vehicles.map((v) => v.bin));
    return {
      publicationId: pub.publicationId,
      kind: pub.kind,
      featureId: pub.payload.featureId,
      featureName: this.feature(pub.payload.featureId, pub.payload.featureVersion)?.name ?? null,
      flagKey: pub.payload.flagKey,
      status: pub.status,
      total: vehicles.length,
      staleAfterMs: b.staleAfterMs,
      assumed: b.assumed,
      bins,
      notApplied: vehicles.length - bins.APPLIED,
      cumulative: cumulativeDelivery(per.map((x) => x.events)),
      vehicles,
    };
  }

  // ─────────── 6축 ───────────

  /** 이 차량에 보일 Feature — 기준 시간 표 Feature 중 차량 범위에 맞는 것 ∪ 보고·판정·게시본·주문이 있는 Feature */
  private vehicleFeatures(vin: string): { featureId: string; version: string | null }[] {
    const v = this.vehicle(vin);
    const ids = new Map<string, string | null>();
    for (const b of this.basisRows()) {
      const f = this.feature(b.feature_id, b.version);
      if (v && f && f.country === v.country && f.vehicleModel === v.vehicleModel && f.trim === v.trim) ids.set(b.feature_id, b.version);
    }
    for (const r of this.db.all<{ feature_id: string }>('SELECT DISTINCT feature_id FROM vehicle_feature_report WHERE vin = ? UNION SELECT DISTINCT feature_id FROM safety_verdict WHERE vin = ?', vin, vin)) if (!ids.has(r.feature_id)) ids.set(r.feature_id, null);
    for (const p of this.publications()) if (p.payload.targets.includes(vin) && !ids.has(p.payload.featureId)) ids.set(p.payload.featureId, p.payload.featureVersion);
    for (const o of this.orderDocs({ vin })) if (!ids.has(o.featureId)) ids.set(o.featureId, null);
    const cls = (id: string) => ({ ADS: 0, ADAS: 1, QM: 2 })[this.basisOf(id).featureClass];
    return [...ids.entries()].map(([featureId, version]) => ({ featureId, version })).sort((a, b) => cls(a.featureId) - cls(b.featureId) || a.featureId.localeCompare(b.featureId));
  }

  orderDocs(q: { vin?: string } = {}): OrderDoc[] {
    const rows = q.vin ? this.db.all<{ doc: string }>('SELECT doc FROM order_link WHERE vin = ? ORDER BY order_id', q.vin) : this.db.all<{ doc: string }>('SELECT doc FROM order_link ORDER BY order_id');
    return rows.map((r) => JSON.parse(r.doc) as OrderDoc);
  }

  /** 상품 권리 — 이 Feature를 담은 상품의 권리(체험·구독·구매) + 결제된 주문의 권리. 결제 상태는 쓰지 않는다. 대표 출처: 구매 권리 > 구매 주문 > 체험 권리 > 체험 주문 > 끝난 권리 */
  private entitlementAxis(vin: string, featureId: string) {
    const grants = this.db.all<{ doc: string }>('SELECT doc FROM entitlement WHERE vin = ?', vin).map((r) => JSON.parse(r.doc) as { grantId: string; catalogId: string; kind: string; status: string; validTo: string });
    const mine = grants.filter((g) => this.catalog(g.catalogId)?.featureIds.includes(featureId));
    const orders = this.orderDocs({ vin }).filter((o) => o.featureId === featureId && o.status === 'PAID' && o.entitlement === 'CONFIRMED');
    type Src = { kind: string; status: string; grantId: string | null; catalogId: string; orderId: string | null; until: string | null };
    const srcs: Src[] = [
      ...mine.map((g) => ({ kind: g.kind, status: g.status, grantId: g.grantId, catalogId: g.catalogId, orderId: null, until: g.validTo ?? null })),
      ...orders.map((o) => ({ kind: this.catalog(o.catalogId)?.saleType ?? '구매', status: 'ACTIVE', grantId: o.entitlementId, catalogId: o.catalogId, orderId: o.orderId, until: null })),
    ];
    const value = entitlementAxisOf(srcs);
    const rank = (x: Src) => (x.status !== 'ACTIVE' ? 4 : x.kind !== '체험' ? (x.orderId ? 1 : 0) : x.orderId ? 3 : 2);
    const top = [...srcs].sort((x, y) => rank(x) - rank(y))[0] ?? null;
    const order = orders.find((o) => o.orderId === top?.orderId) ?? orders.at(-1) ?? null;
    return { value, grantId: top?.grantId ?? null, catalogId: top?.catalogId ?? null, orderId: order?.orderId ?? null, until: top?.until ?? null };
  }

  private latestVerdicts(vin: string, featureId?: string): VerdictDbRow[] {
    const rows = featureId
      ? this.db.all<VerdictDbRow & { id: number }>('SELECT * FROM safety_verdict WHERE vin = ? AND feature_id = ? ORDER BY id', vin, featureId)
      : this.db.all<VerdictDbRow & { id: number }>('SELECT * FROM safety_verdict WHERE vin = ? ORDER BY id', vin);
    const last = new Map<string, VerdictDbRow>();
    for (const r of rows) last.set(`${r.feature_id}|${r.action}`, r);
    return [...last.values()];
  }
  private activation(vin: string, featureId: string) {
    const vs = this.latestVerdicts(vin, featureId);
    const v = vs.find((x) => x.action === 'ACTIVATE') ?? vs.at(-1) ?? null;
    if (!v) return null;
    // 2.1 판정은 유효 기한(valid_until)이 지나도 오래된 판정 — 과거 허용을 다시 쓰지 않는다(TC06)
    const stale = this.now() - Date.parse(v.observed_at) > this.basisOf(featureId).staleAfterMs || (!!v.valid_until && Date.parse(v.valid_until) < this.now());
    return { verdict: v.verdict, reasonCodes: JSON.parse(v.reason_codes) as string[], at: v.observed_at, stale };
  }

  axesOf(vin: string, featureId: string, version: string | null): VehicleFeatureAxes {
    const b = this.basisOf(featureId);
    const f = this.feature(featureId, version ?? b.version);
    const fresh = this.freshness(vin, featureId);
    const rep = this.latestReport(vin, featureId);
    const ent = this.entitlementAxis(vin, featureId);
    const pub = this.publications()
      .filter((p) => p.payload.featureId === featureId && p.payload.targets.includes(vin))
      .sort((x, y) => y.publicationId.localeCompare(x.publicationId))[0];
    const dc = pub ? classifyDelivery(this.deliveryEvents(pub, vin), b.staleAfterMs, this.now()) : null;
    const act = this.activation(vin, featureId);
    const elig = act ? eligibilityOf(act.verdict, act.reasonCodes) : null;
    // 재시동 뒤 복구 미검증(RESTORE_UNVERIFIED) — 그 차량을 활성 집계에 넣지 않는다(값은 과거 값으로만)
    const unverified = rep?.parsed.restoreUnverified === true;
    const eligNow = act && !act.stale && !unverified ? reportedValue(elig, fresh.state) : { current: null, past: elig };
    const run = unverified ? { current: null, past: rep?.runtime_state ?? null } : reportedValue(rep?.runtime_state ?? null, fresh.state);
    return {
      featureId,
      version: f?.version ?? version ?? '',
      name: f?.name ?? featureId,
      featureClass: b.featureClass,
      simulated: rep?.source === 'SIMULATED' || (!rep && !!act),
      freshness: fresh,
      entitlement: { value: ent.value, grantId: ent.grantId, catalogId: ent.catalogId, orderId: ent.orderId },
      install: { value: installAxisOf(rep?.ota_stage ?? null, rep?.parsed.configMatch ?? null), otaStage: rep?.ota_stage ?? null, configMatch: rep?.parsed.configMatch ?? null, configRef: rep?.parsed.configRef ?? null },
      delivery: { stage: pub ? (dc?.last?.stage ?? 'PUBLISHED') : null, bin: dc?.bin ?? null, publicationId: pub?.publicationId ?? null, at: dc?.last?.at ?? pub?.createdAt ?? null, reasonCode: dc?.last?.reasonCode ?? null },
      eligibility: { current: eligNow.current, past: eligNow.past, reasonCode: act?.reasonCodes[0] ?? null, at: act?.at ?? null },
      runtime: { current: run.current, past: run.past, ddtOwner: rep?.ddt_owner ?? null },
    };
  }

  featureState(vin: string): VehicleFeatureStateView {
    if (!this.vehicle(vin)) throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
    const features = this.vehicleFeatures(vin).map((x) => this.axesOf(vin, x.featureId, x.version));
    return { vin, now: this.clock.iso(), features, unconfirmed: features.filter((f) => f.freshness.state !== 'FRESH').length };
  }

  // ─────────── 행위별 판정 ───────────

  verdicts(vin: string): VehicleVerdictsView {
    if (!this.vehicle(vin)) throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
    const order = (a: VerdictAction) => VERDICT_ACTIONS.indexOf(a);
    const items: VerdictRow[] = this.latestVerdicts(vin)
      .map((v) => {
        const staleAfterMs = this.basisOf(v.feature_id).staleAfterMs;
        return {
          featureId: v.feature_id,
          featureName: this.feature(v.feature_id)?.name ?? v.feature_id,
          action: v.action,
          verdict: v.verdict,
          reasonCodes: JSON.parse(v.reason_codes) as string[],
          observedAt: v.observed_at,
          receivedAt: v.received_at,
          stale: this.now() - Date.parse(v.observed_at) > staleAfterMs,
          staleAfterMs,
          simulated: v.source === 'SIMULATED',
          sessionId: v.session_id,
        };
      })
      .sort((a, b) => ({ ADS: 0, ADAS: 1, QM: 2 })[this.basisOf(a.featureId).featureClass] - ({ ADS: 0, ADAS: 1, QM: 2 })[this.basisOf(b.featureId).featureClass] || a.featureId.localeCompare(b.featureId) || order(a.action) - order(b.action));
    const combos = [...new Set(items.map((i) => i.featureId))].map((featureId) => ({
      featureId,
      text: stateComboText({ entitlement: this.entitlementAxis(vin, featureId).value, restore: this.latestReport(vin, featureId)?.parsed.restore ?? null, activation: this.activation(vin, featureId) }),
    }));
    const reported = new Set(items.map((i) => i.featureId));
    const unreported = this.vehicleFeatures(vin)
      .filter((x) => !reported.has(x.featureId))
      .map((x) => ({ featureId: x.featureId, featureName: this.feature(x.featureId)?.name ?? x.featureId, staleAfterMs: this.basisOf(x.featureId).staleAfterMs }));
    return { vin, now: this.clock.iso(), items, combos, unreported };
  }

  // ─────────── Fleet 축별 분포 ───────────

  /** Feature 모집단 — 범위(국가·차종·트림)가 맞는 등록 차량 ∪ 그 Feature를 보고한 차량 */
  private population(featureId: string, version: string | null): string[] {
    const f = this.feature(featureId, version);
    const vins = new Set<string>();
    if (f) for (const r of this.db.all<{ vin: string; doc: string }>('SELECT vin, doc FROM vehicle')) {
      const v = JSON.parse(r.doc) as VehicleDoc;
      if (v.fleet !== 'SAMPLE' && v.country === f.country && v.vehicleModel === f.vehicleModel && v.trim === f.trim) vins.add(v.vin);
    }
    for (const r of this.db.all<{ vin: string }>('SELECT DISTINCT vin FROM vehicle_feature_report WHERE feature_id = ?', featureId)) vins.add(r.vin);
    return [...vins].sort();
  }

  private distribution(featureId: string, version: string | null): AxisDistribution {
    const b = this.basisOf(featureId);
    const f = this.feature(featureId, version ?? b.version);
    const vins = this.population(featureId, version ?? b.version);
    const axes = Object.fromEntries(CUSTOMER_AXES.map((a) => [a, {} as Record<string, number>])) as Record<CustomerAxis, Record<string, number>>;
    const inc = (a: CustomerAxis, k: string) => (axes[a][k] = (axes[a][k] ?? 0) + 1);
    const reasons = new Map<string, { key: string; code: string | null; verdict: VerdictValue | 'NONE'; count: number }>();
    const reason = (key: string, code: string | null, verdict: VerdictValue | 'NONE') => {
      const r = reasons.get(key) ?? { key, code, verdict, count: 0 };
      r.count++;
      reasons.set(key, r);
    };
    let unconfirmedRuntime = 0;
    for (const vin of vins) {
      const x = this.axesOf(vin, featureId, version ?? b.version);
      inc('ENTITLEMENT', x.entitlement.value);
      inc('INSTALL', x.install.value);
      inc('DELIVERY', x.delivery.bin ?? 'NONE');
      inc('ELIGIBILITY', x.eligibility.current ?? 'UNCONFIRMED');
      inc('RUNTIME', x.runtime.current ?? 'UNCONFIRMED');
      inc('FRESHNESS', x.freshness.state);
      if (!x.runtime.current) unconfirmedRuntime++;
      // 활성화 판정 사유 — 차량마다 한 구간(배타): 판정 보고가 기준 시간 안이고 관측이 최신일 때만 그 판정, 그 밖은 미확인
      const act = this.activation(vin, featureId);
      if (!act || act.stale || x.freshness.state !== 'FRESH') reason('UNCONFIRMED', null, 'NONE');
      else if (act.verdict === 'ALLOW') reason('ALLOW', null, 'ALLOW');
      else reason(`${act.verdict}:${act.reasonCodes[0] ?? ''}`, act.reasonCodes[0] ?? null, act.verdict);
    }
    return { featureId, version: f?.version ?? version ?? '', name: f?.name ?? featureId, featureClass: b.featureClass, total: vins.length, staleAfterMs: b.staleAfterMs, assumed: b.assumed, axes, unconfirmedRuntime, reasons: [...reasons.values()] };
  }

  /** Fleet — Feature 목록(기준 시간 표), 기본 선택 = ADS Feature 중 실제 실행 미확인 최다(없으면 전체에서) */
  axisDistribution(featureId?: string): FleetAxisView {
    const list = this.basisRows().map((r) => {
      const d = this.distribution(r.feature_id, r.version);
      return { featureId: r.feature_id, version: d.version, name: d.name, featureClass: r.feature_class, total: d.total, unconfirmedRuntime: d.unconfirmedRuntime };
    });
    const pick = (xs: typeof list) => [...xs].sort((a, b) => b.unconfirmedRuntime - a.unconfirmedRuntime || a.featureId.localeCompare(b.featureId))[0];
    const def = pick(list.filter((x) => x.featureClass === 'ADS')) ?? pick(list) ?? null;
    const chosen = featureId ?? def?.featureId ?? null;
    if (featureId && !this.features(featureId).length) throw new DomainError('NOT_FOUND', `Feature ${featureId}을(를) 찾을 수 없습니다.`);
    return { now: this.clock.iso(), features: list, defaultFeatureId: def?.featureId ?? null, selected: chosen ? this.distribution(chosen, list.find((x) => x.featureId === chosen)?.version ?? null) : null };
  }

  // ─────────── 고객에게 보이는 상태 ───────────

  customerState(vin: string): CustomerStateView {
    const fs = this.featureState(vin).features;
    // 차단 대상 — KillRepo.killed와 같은 판정: 의존 포함 Feature 목록(featureIds) × 차량 범위
    const kills = this.db.all<{ doc: string }>("SELECT doc FROM kill_request WHERE status = 'ACTIVE'").map((r) => JSON.parse(r.doc) as { killId: string; featureId: string; featureIds?: string[]; vins?: string[] });
    const features: CustomerFeatureState[] = fs.map((x) => {
      const kill = kills.find((k) => (k.featureIds ?? [k.featureId]).includes(x.featureId) && (k.vins ?? []).includes(vin)) ?? null;
      const ent = this.entitlementAxis(vin, x.featureId);
      const cat = ent.catalogId ? this.catalog(ent.catalogId) : null;
      const kind = x.entitlement.value === 'TRIAL' ? '체험' : cat?.saleType ?? '구매';
      const act = this.activation(vin, x.featureId);
      const answers = customerProjection({
        freshness: x.freshness.state,
        observedAt: x.freshness.observedAt,
        entitlement: x.entitlement.value,
        install: x.install.value,
        eligibility: x.eligibility.current,
        eligibilityReason: act && !act.stale ? reasonLabel(act.reasonCodes[0]) || null : null,
        runtime: x.runtime.current,
        restricted: !!kill,
        product: cat ? { name: cat.name, kind, until: ent.until } : null,
      });
      const { unconfirmedLine, ...rest } = answers;
      const ready = this.orderDocs({ vin }).find((o) => o.featureId === x.featureId && o.status === 'PAID' && o.readyReport?.ok && Date.parse(o.readyReport.at) >= Date.parse(o.paidAt));
      return {
        featureId: x.featureId,
        name: x.name,
        lastConfirmedAt: x.freshness.observedAt,
        freshness: x.freshness.state,
        unconfirmedLine,
        answers: rest,
        notifyBasis: ready && x.freshness.state === 'FRESH' ? CUSTOMER_TEXT.notify(kstShort(ready.readyReport!.at)) : null,
        changes: this.latestReport(vin, x.featureId)?.parsed.changes ?? [],
        entitlement: null,
        marketChange: null,
        ownershipTransfer: null,
        restricted: !!kill,
        killId: kill?.killId ?? null,
      };
    });
    return { vin, now: this.clock.iso(), features };
  }
}

@Controller('api/vehicles')
export class AdsVehicleStateController {
  constructor(private readonly state: AdsStateService) {}

  @Get(':vin/feature-state')
  featureState(@Param('vin') vin: string) {
    return this.state.featureState(vin);
  }

  @Get(':vin/verdicts')
  verdicts(@Param('vin') vin: string) {
    return this.state.verdicts(vin);
  }

  @Get(':vin/customer-state')
  customerState(@Param('vin') vin: string) {
    return this.state.customerState(vin);
  }
}

@Controller('api/publications')
export class AdsConvergenceController {
  constructor(private readonly state: AdsStateService) {}

  @Get(':id/convergence')
  convergence(@Param('id') id: string) {
    return this.state.convergence(id);
  }
}

@Controller('api/fleet')
export class AdsFleetAxisController {
  constructor(private readonly state: AdsStateService) {}

  @Get('axis-distribution')
  axisDistribution(@Query('featureId') featureId?: string) {
    return this.state.axisDistribution(featureId || undefined);
  }
}
