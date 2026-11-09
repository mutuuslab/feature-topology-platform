// 차량 상태 보고 2.1 수신 투영(W — ADS-BE01·BE07·FFP-F031, D-ADS-1) — 수신 검사(D04-03)를 통과한 2.1 보고를 ADS 상태 읽기 모델 표에 넣는다:
// 실제 실행·제어 책임(vehicle_feature_report, source VEHICLE)·행위별 판정(safety_verdict)·전달 단계(delivery_ack). 그리고 사건 —
// 종료 진행 중 제어 책임 공백(RESPONSIBILITY_GAP, 보고 간격 예산은 기능별 상태 프로필 또는 가정값), 재시동 뒤 복구 미검증(RESTORE_UNVERIFIED, 활성 집계 제외),
// MRC 미달성(정지 유지 수단·위험 저감 근거 없음). 서버 의도(Feature epoch·종료 차단)와 차량 보고의 대조(재연결 대조)도 여기서 본다.
import { Controller, Get, Inject, Injectable, Param } from '@nestjs/common';
import {
  bootRefOf,
  DATA_CATEGORY_ACCESS,
  defaultStateProfile,
  mrcAchieved,
  projectedRuntime,
  reconcileFeature,
  responsibilityGaps,
  restoreVerdict,
  RUNTIME_STATES,
  type DdtOwner,
  type FeatureStateProfile,
  type KillRequest,
  type OwnerObservation,
  type ReconcileMismatch,
  type RuntimeState,
  type StatusReportV2_1,
} from '@ff/contracts';
import { Roles } from '../../../kernel/actor';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { AdsStateService } from '../../d02-runtime/vehicle-runtime/ads-state.service';
import { FeatureEpochRepo } from '../../d03-safety/kill-switch/feature-epoch.repo';

export type AdsVehicleCaseKind = 'RESPONSIBILITY_GAP' | 'RESTORE_UNVERIFIED' | 'MRC_NOT_ACHIEVED';
export interface AdsVehicleCase {
  caseId: string;
  kind: AdsVehicleCaseKind;
  vin: string;
  featureId: string;
  reportSeq: number;
  openedAt: string;
  detail: Record<string, unknown>;
}

/** vehicle_feature_report.doc — 읽기 모델 ReportDoc + 2.1 원값(사건 판정이 다음 보고에서 다시 읽는다) */
interface V21ReportDoc {
  version: string;
  configMatch: boolean | null;
  configRef: string | null;
  reconnect: { at: string; gapMs: number } | null;
  restore: { integrity: 'OK' | 'FAILED'; inhibitReleased: boolean } | null;
  changes: [];
  schemaVersion: '2.1';
  reportSeq: number;
  rawRuntime: RuntimeState;
  restoreUnverified: boolean;
  mrcAchieved: boolean | null;
  featureEpoch: number;
  inhibits: string[];
}

/** 차량 봉투와 같은 참조: F2 이상 또는 이상 징후 차단은 명시 사건 ID, 이전 행은 이상 ID·명령 ID. */
export const inhibitRefOf = (k: Pick<KillRequest, 'incidentId' | 'anomalyId' | 'fClass' | 'command'>): string | null => {
  const incident = k.incidentId ?? k.anomalyId;
  return incident && (k.anomalyId || ['F2', 'F3', 'F4'].includes(k.fClass ?? '')) ? incident : k.command?.commandId ?? null;
};

@Injectable()
@PlatformComponent('D04-03')
export class StatusV21Service {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly events: EventService,
    private readonly ads: AdsStateService,
    private readonly epochs: FeatureEpochRepo,
  ) {}

  /** 기능별 상태 프로필 — 표에 있으면 그 값, 없으면 기준 시간 등급의 기본값(가정값) */
  profile(featureId: string): FeatureStateProfile {
    const featureClass = this.ads.basisOf(featureId).featureClass;
    const row = this.db.get<{ allowed_states: string; report_budget_ms: number; budget_status: 'ASSUMED' | 'APPROVED' }>('SELECT allowed_states, report_budget_ms, budget_status FROM feature_state_profile WHERE feature_id = ?', featureId);
    if (!row) return defaultStateProfile(featureClass);
    const allowed = (JSON.parse(row.allowed_states) as string[]).filter((s): s is RuntimeState => (RUNTIME_STATES as readonly string[]).includes(s));
    return { featureClass, allowedStates: allowed, reportBudgetMs: row.report_budget_ms, budgetStatus: row.budget_status, source: 'PROFILE' };
  }

  /** 서버가 이 차량·Feature에 건 종료 차단 — 진행 중(ACTIVE) 차단 중 의존 Feature까지 이 Feature를 덮고 이 차량을 대상으로 한 것 */
  serverInhibits(vin: string, featureId: string): string[] {
    const ks = this.db.all<{ doc: string }>("SELECT doc FROM kill_request WHERE status = 'ACTIVE'").map((r) => JSON.parse(r.doc) as KillRequest);
    return [...new Set(ks.filter((k) => (k.featureIds ?? [k.featureId]).includes(featureId) && k.vins.includes(vin) && !(k.restoredVins ?? []).includes(vin)).map(inhibitRefOf).filter((x): x is string => !!x))].sort();
  }

  /** 이 차량·Feature의 최근 2.1 보고(수신 투영한 것만 — 데모 시드 행은 2.1 원값이 없다), 오래된 것부터 */
  private recent(vin: string, featureId: string) {
    return this.db
      .all<{ id: number; observed_at: string; ddt_owner: DdtOwner | null; runtime_state: RuntimeState; doc: string }>('SELECT id, observed_at, ddt_owner, runtime_state, doc FROM vehicle_feature_report WHERE vin = ? AND feature_id = ? ORDER BY id DESC LIMIT 100', vin, featureId)
      .map((x) => ({ ...x, parsed: JSON.parse(x.doc) as Partial<V21ReportDoc> }))
      .filter((x) => x.parsed.schemaVersion === '2.1')
      .reverse();
  }

  private openCase(kind: AdsVehicleCaseKind, vin: string, featureId: string, reportSeq: number, detail: Record<string, unknown>): AdsVehicleCase {
    const n = (this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ads_vehicle_case')?.n ?? 0) + 1;
    const c: AdsVehicleCase = { caseId: `AVC-${String(n).padStart(5, '0')}`, kind, vin, featureId, reportSeq, openedAt: this.clock.iso(), detail };
    this.db.run('INSERT INTO ads_vehicle_case (case_id, kind, vin, feature_id, report_seq, opened_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', c.caseId, kind, vin, featureId, reportSeq, c.openedAt, JSON.stringify(c));
    this.events.publish('vehicle.ads.case', vin, { caseId: c.caseId, kind, vin, featureId, reportSeq, ...detail }, { componentId: 'D04-03' });
    return c;
  }

  /**
   * 받아들인 2.1 보고 → 읽기 모델 표·사건. 수신 검사 트랜잭션 안에서 부른다.
   * @rule FFG-TEL-003, FFG-ADS-004 — 검사를 통과한 차량 보고만 6축에 넣고, 복구가 검증되지 않은 차량은 실제 실행 집계에서 뺀다
   */
  project(vin: string, r: StatusReportV2_1, via: 'IF-06' | 'SIM' | 'GLEO' = 'IF-06'): AdsVehicleCase[] {
    const featureId = r.feature.id;
    const now = this.clock.iso();
    const recent = this.recent(vin, featureId);
    const last = recent.at(-1);
    const prev = last ? { observedAt: last.observed_at, doc: last.parsed } : null;
    const serverInhibits = this.serverInhibits(vin, featureId);
    const newBoot = !!prev && ((typeof prev.doc.reportSeq === 'number' && bootRefOf(r.report_seq) > bootRefOf(prev.doc.reportSeq)) || (!!r.restore && Date.parse(r.restore.booted_at) > Date.parse(prev.observedAt)));
    const restore = restoreVerdict({ newBoot, restore: r.restore, serverInhibits });
    const offline = r.offline_since && Date.parse(r.offline_since) < Date.parse(r.observed_at) ? r.offline_since : null;
    const doc: V21ReportDoc = {
      version: r.feature.version,
      configMatch: null,
      configRef: r.decision?.config_ref ?? null,
      reconnect: offline ? { at: r.observed_at, gapMs: Date.parse(r.observed_at) - Date.parse(offline) } : null,
      restore: r.restore ? { integrity: restore.verified && r.restore.integrity === 'OK' ? 'OK' : 'FAILED', inhibitReleased: serverInhibits.length === 0 } : null,
      changes: [],
      schemaVersion: '2.1',
      reportSeq: r.report_seq,
      rawRuntime: r.runtime_state,
      restoreUnverified: !restore.verified,
      mrcAchieved: r.mrc ? mrcAchieved(r) : null,
      featureEpoch: r.feature_epoch,
      inhibits: [...r.inhibits],
    };
    const cases: AdsVehicleCase[] = [];
    // 제어 책임 공백 — 이 보고가 드러낸 공백만(앞 보고에서 연 공백은 다시 열지 않는다)
    const profile = this.profile(featureId);
    const history: OwnerObservation[] = recent.map((x) => ({ at: x.observed_at, ddtOwner: x.ddt_owner, runtimeState: x.parsed.rawRuntime ?? x.runtime_state }));
    const seq = [...history, { at: r.observed_at, ddtOwner: r.ddt_owner ?? null, runtimeState: r.runtime_state }];
    const gaps = responsibilityGaps(seq, profile.reportBudgetMs).filter((g) => g.index === seq.length - 1);
    this.db.run(
      'INSERT INTO vehicle_feature_report (vin, feature_id, observed_at, received_at, runtime_state, ddt_owner, ota_stage, offline_since, source, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      vin,
      featureId,
      r.observed_at,
      now,
      projectedRuntime(r),
      r.ddt_owner ?? null,
      null,
      offline,
      // 내부 차량 시뮬레이터 보고는 가상 데이터로 표시한다
      via === 'SIM' ? 'SIMULATED' : 'VEHICLE',
      JSON.stringify(doc),
    );
    if (r.decision) {
      const d = r.decision;
      this.db.run(
        'INSERT INTO safety_verdict (vin, feature_id, action, verdict, reason_codes, session_id, sample_ref, config_ref, policy_ref, odd_ref, input_quality, observed_at, received_at, source, decision_id, valid_until, odd_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        vin,
        featureId,
        d.action,
        d.verdict,
        JSON.stringify(d.reason_codes),
        d.session_id ?? null,
        d.sample_ref ?? null,
        d.config_ref ?? null,
        r.policy_hash ?? null,
        d.odd_ref ?? null,
        d.input_quality,
        r.observed_at,
        now,
        via === 'SIM' ? 'SIMULATED' : 'VEHICLE',
        d.decision_id,
        d.valid_until,
        d.odd_state,
      );
    }
    if (r.delivery)
      this.db.run(
        'INSERT INTO delivery_ack (subject_kind, subject_id, vin, stage, reason_code, observed_at, received_at, source, decision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        r.delivery.subject_kind,
        r.delivery.subject_id,
        vin,
        r.delivery.stage,
        r.delivery.reason_code ?? null,
        r.observed_at,
        now,
        via === 'SIM' ? 'SIMULATED' : 'VEHICLE',
        r.delivery.decision_id ?? null,
      );
    // 사건에 쓴 예산 값·출처·상태를 함께 남긴다(가정값이면 ASSUMED)
    for (const g of gaps)
      cases.push(this.openCase('RESPONSIBILITY_GAP', vin, featureId, r.report_seq, { gap: g.kind, episodeStart: g.episodeStart, intervalMs: g.intervalMs, ddtOwner: r.ddt_owner ?? null, budgetMs: profile.reportBudgetMs, budgetSource: profile.source, budgetStatus: profile.budgetStatus }));
    if (!restore.verified) cases.push(this.openCase('RESTORE_UNVERIFIED', vin, featureId, r.report_seq, { code: restore.code, missing: restore.missing, serverInhibits }));
    if (r.mrc && !mrcAchieved(r)) cases.push(this.openCase('MRC_NOT_ACHIEVED', vin, featureId, r.report_seq, { holdMeans: r.mrc.hold_means, riskMitigationRef: r.mrc.risk_mitigation_ref }));
    return cases;
  }

  cases(vin: string): AdsVehicleCase[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM ads_vehicle_case WHERE vin = ? ORDER BY id DESC LIMIT 50', vin).map((x) => JSON.parse(x.doc) as AdsVehicleCase);
  }

  /** 재연결 대조 — Feature마다 서버 의도(epoch·종료 차단)와 차량의 마지막 2.1 보고, 불일치 목록·미확인 기간 */
  reconcile(vin: string) {
    if (!this.db.get('SELECT 1 FROM vehicle WHERE vin = ?', vin)) throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
    const reported = new Map(
      this.db
        .all<{ feature_id: string; doc: string; schema_version: string }>('SELECT feature_id, doc, schema_version FROM vehicle_feature_status WHERE vin = ?', vin)
        .filter((x) => x.schema_version === '2.1')
        .map((x) => [x.feature_id, JSON.parse(x.doc) as StatusReportV2_1] as const),
    );
    const ids = new Set(reported.keys());
    for (const k of this.db.all<{ doc: string }>("SELECT doc FROM kill_request WHERE status = 'ACTIVE'").map((r) => JSON.parse(r.doc) as KillRequest)) if (k.vins.includes(vin)) for (const f of k.featureIds ?? [k.featureId]) ids.add(f);
    const features = [...ids].sort().map((featureId) => {
      const intent = { epoch: this.epochs.current(featureId), inhibits: this.serverInhibits(vin, featureId) };
      const r = reported.get(featureId) ?? null;
      const rep = r ? { featureEpoch: r.feature_epoch, inhibits: r.inhibits, observedAt: r.observed_at, offlineSince: r.offline_since ?? null } : null;
      const { mismatches, unconfirmed } = reconcileFeature(intent, rep);
      return { featureId, intent, reported: rep, mismatches: mismatches as ReconcileMismatch[], unconfirmed };
    });
    return { vin, now: this.clock.iso(), features, mismatches: features.reduce((a, f) => a + f.mismatches.length, 0), cases: this.cases(vin) };
  }
}

@Controller('api/vehicles')
export class VehicleReconcileController {
  constructor(private readonly v21: StatusV21Service) {}

  /** 재연결 대조(ADS-BE07) — 서버 의도(Feature epoch·종료 차단) vs 차량 보고 2.1 불일치·미확인 기간, 차량 ADS 사건 */
  @Get(':vin/reconcile')
  @Roles(...DATA_CATEGORY_ACCESS.SAFETY_OPERATION)
  reconcile(@Param('vin') vin: string) {
    return this.v21.reconcile(vin);
  }
}
