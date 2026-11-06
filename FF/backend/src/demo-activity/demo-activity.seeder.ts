// 데모 활동 시드 — 데이터셋 시드(seed.ts)는 기준정보만 넣으므로, 데모 화면마다 '아직 기록이 없습니다'가 뜨지 않게
// 담당자들이 한 일(실험·장애·VOC·주문·VEX·Retirement·정책 개정·되돌리기 요청·권한 거부·외부 연계·절차·대시보드·확정 요청…)을
// 도메인 서비스로 한 번 재현한다. 원장(감사·이벤트)에 직접 쓰지 않는다 — 서비스가 실제 경로로 남긴다.
//  · DB마다 한 번(meta 'seed-activity'), 운영 모드·FF_SEED=none은 하지 않는다. FF_DEMO_ACTIVITY=0 끔 / 1 강제(5년 재생 데이터셋에서도)
//  · 모든 도메인 모듈의 부팅 훅 뒤에 돈다(루트 AppModule 공급자) — 외부 연계 예시 항목 시드가 먼저 들어간다
//  · 단계마다 따로 잡는다 — 한 단계가 실패해도 경고만 남기고 다음 단계로, 부팅은 막지 않는다
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, type Type } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { ModuleRef } from '@nestjs/core';
import {
  BaselineRequestBody,
  ConcludeExperimentBody,
  CreateExperimentBody,
  CreatePolicyBody,
  CreateVersionBody,
  DashboardCreateBody,
  JudgeGateBody,
  MetricPlanBody,
  MockExtActionBody,
  PolicyDecisionBody,
  PolicyRollbackBody,
  ProcedureCompleteBody,
  RetirementRequestBody,
  RetirementStepBody,
  VexStatement,
  examplePlan,
  ROLE_LABEL,
  HaraBody,
  TaraBody,
  CreateProductBody,
  CreateRefChangeBody,
  KillCreateBody,
  KillApproveBody,
  RestoreRequestBody,
  UpdateDraftBody,
  RollbackDecisionBody,
  OfrepBody,
  NotificationRuleBody,
  NotificationSendBody,
  PipelineRunBody,
  type Role,
} from '@ff/contracts';
import type { Actor } from '../kernel/actor';
import { AuditService } from '../kernel/audit.service';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { EventService } from '../kernel/event.service';
import { isProduction, seedOf } from '../kernel/runtime-config';
import { DashboardService } from '../dashboards/dashboard.service';
import { ProcedureService } from '../workflows/procedure.service';
import { EntitlementService } from '../domains/d01-policy/entitlement/entitlement.service';
import { ExperimentService } from '../domains/d01-policy/experiment/experiment.service';
import { PolicyService } from '../domains/d01-policy/policy-store/policy.service';
import { BaselineService } from '../domains/d01-policy/registry/baseline.service';
import { LifecycleService } from '../domains/d01-policy/registry/lifecycle.service';
import { RegistryService } from '../domains/d01-policy/registry/registry.service';
import { RetirementService } from '../domains/d01-policy/registry/retirement.service';
import { SafetyProfileService } from '../domains/d01-policy/registry/safety-profile.service';
import { FeatureRepo } from '../domains/d01-policy/repos';
import { AnalysisEvidenceService } from '../domains/d01-policy/topology/analysis-evidence.service';
import { GateService } from '../domains/d01-policy/topology/gate.service';
import { RollbackService } from '../domains/d03-safety/restore/rollback.service';
import { IncidentService } from '../domains/d04-ops/incident-voc/incident.service';
import { FeedbackService } from '../domains/d04-ops/quality-feedback/feedback.service';
import { SafetyKpiService } from '../domains/d04-ops/telemetry-ingest/safety-kpi.service';
import { ExtSyncRepo } from '../domains/d05-ext/api-gateway/ext-sync/ext-sync.repo';
import { ExtSyncService } from '../domains/d05-ext/api-gateway/ext-sync/ext-sync.service';
import { BillingService } from '../domains/d05-ext/billing/billing.controller';
import { LegacyService } from '../domains/d05-ext/legacy/legacy.service';
import { AnomalyService } from '../domains/d06-qsec/anomaly-response/anomaly.service';
import { SecurityEventService } from '../domains/d06-qsec/anomaly-response/security-events.service';
import { PublicationRepo } from '../domains/d06-qsec/secure-deploy/publication.repo';
import { SbomService } from '../domains/d06-qsec/vuln-monitor/sbom.service';
import { CatalogService } from '../domains/d01-policy/catalog/catalog.service';
import { RefdbChangeService } from '../domains/d01-policy/refdb/refdb-change.service';
import { RefdbRepository } from '../domains/d01-policy/refdb/refdb.repository';
import { KillService } from '../domains/d03-safety/kill-switch/kill.service';
import { RestoreService } from '../domains/d03-safety/restore/restore.service';
import { GateRepo } from '../domains/d01-policy/repos';
import { VehicleRequestService } from '../domains/d02-runtime/vehicle-requests/vehicle-request.service';
import type { Response } from 'express';
import { NotificationService } from '../domains/d04-ops/event-history/notification.service';
import { IntegrationErrorService } from '../domains/d04-ops/event-history/integration-error.service';
import { PipelineRunService } from '../domains/d04-ops/pipeline-link/pipeline-run.service';
import { EvaluationStatsService, type EvaluationSample } from '../domains/d04-ops/telemetry-ingest/evaluation-stats.service';
import { PolicyRepo } from '../domains/d01-policy/policy-repos';

export const DEMO_ACTIVITY_META = 'seed-activity';
/** 시연·e2e가 직접 다루는 Feature — 분류·Version·정책을 건드리지 않는다(Kill·Unleash·학습·외부 연계·Feature DB 시연) */
const KEEP_FEATURES = ['FEAT-00001', 'FEAT-00013', 'FEAT-00022', 'FEAT-00024', 'FEAT-00145'];
/** 데모 정책 Feature — QM 출시 Version(EU 범위, 가상검증 서버 없이 검증 GO). flag 이름은 시드 flag(care_00022_*) 뒤로 정렬된다 */
const DEMO_FEATURE = { featureId: 'FEAT-00027', version: '1.0.0' };
const FLAG_GUIDE = 'ivi_00027_detail';
const FLAG_VOICE = 'ivi_00027_voice';
const FLAG_BANNER = 'ivi_00027_banner';

/** 켜는가 — 운영 모드·시드 없음은 언제나 끔, FF_DEMO_ACTIVITY=0 끔·1 강제, 기본은 켬(5년 재생 데이터셋은 재생이 실제 활동을 만들므로 끔) */
export function demoActivityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProduction(env) || seedOf(env) === 'none') return false;
  if (env.FF_DEMO_ACTIVITY === '0') return false;
  if (env.FF_DEMO_ACTIVITY === '1') return true;
  return env.FF_DATASET !== 'ops5y';
}

/** 데모 계정(contracts DEMO_PERSONAS)으로 맡은 역할 — 화면 역할 전환기와 같은 행위자 ID */
const who = (persona: string, role: Role, step: string): Actor => ({ id: `usr-${persona}`, role, correlationId: `demo-activity-${step}` });

type StepResult = { ok: boolean; note: string };

@Injectable()
export class DemoActivitySeeder implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('DemoActivity');
  /** 마지막 실행 결과 — 시험이 단계별 성공을 본다 */
  lastRun: Record<string, StepResult> | null = null;
  /** 차량 확인을 기다려 잇는 단계(둘째 판·되돌리기 요청) — 시험이 기다린다 */
  continuation: Promise<string> | null = null;
  /** 함께 기동하는 전시 확장은 기본 활동의 Version 생성을 기다린다. 차량 회신 continuation과 별개다. */
  bootstrapCompletion: Promise<Record<string, StepResult> | null> | null = null;
  private waiting: Subscription | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly moduleRef: ModuleRef,
    private readonly clock: Clock,
  ) {}

  private svc<T>(t: Type<T>): T {
    return this.moduleRef.get(t, { strict: false });
  }

  onApplicationShutdown() {
    this.waiting?.unsubscribe();
    this.waiting = null;
  }

  /** 이어진 단계 결과를 meta 요약에 더한다 */
  private recordStep(name: string, note: string) {
    try {
      const row = this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', DEMO_ACTIVITY_META);
      const v = row ? (JSON.parse(row.value) as { steps?: Record<string, string> }) : {};
      this.db.run('UPDATE meta SET value = ? WHERE key = ?', JSON.stringify({ ...v, steps: { ...(v.steps ?? {}), [name]: note } }), DEMO_ACTIVITY_META);
      if (this.lastRun) this.lastRun[name] = { ok: !note.startsWith('실패'), note };
    } catch (err) {
      this.log.warn(`데모 활동 요약 갱신 실패: ${(err as Error).message}`);
    }
  }

  async onApplicationBootstrap() {
    if (!demoActivityEnabled()) return;
    try {
      this.bootstrapCompletion ??= this.run();
      await this.bootstrapCompletion;
    } catch (err) {
      this.log.warn(`데모 활동 시드를 건너뜁니다: ${(err as Error).message}`);
    }
  }

  /** 한 번만 — 먼저 meta 행을 잡아 같은 DB의 두 번째 부팅(다른 인스턴스 포함)은 하지 않는다 */
  async run(): Promise<Record<string, StepResult> | null> {
    if (this.db.get('SELECT value FROM meta WHERE key = ?', DEMO_ACTIVITY_META)) return null;
    const claimed = this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', DEMO_ACTIVITY_META, JSON.stringify({ at: this.clock.iso(), state: 'RUNNING' }));
    if (!claimed.changes) return null;
    const started = Date.now();
    const out: Record<string, StepResult> = {};
    this.lastRun = out;
    const steps: [string, () => Promise<string> | string][] = [
      ['safety', () => this.confirmReleasedSafety()],
      ['procedures', () => this.procedures()],
      ['dashboards', () => this.dashboards()],
      ['incidents', () => this.incidents()],
      ['feedback', () => this.feedback()],
      ['legacy', () => this.legacyOrders()],
      ['vex', () => this.vex()],
      ['security', () => this.securityEvents()],
      ['policies', () => this.policyRevisions()],
      ['validated', () => this.validatedPolicy()],
      ['experiments', () => this.experiments()],
      ['retirement', () => this.retirement()],
      ['baselines', () => this.baselineRequests()],
      ['kpi', () => this.kpiPlans()],
      ['trials', () => this.trialConversions()],
      ['denials', () => this.denials()],
      ['extsync', () => this.extSync()],
      ['queues', () => this.workQueues()],
      ['refdb', () => this.refdbReviews()],
      ['kill', () => this.safetyCase()],
      ['vehicleQueries', () => this.vehicleQueries()],
      ['opsSignals', () => this.opsSignals()],
    ];
    for (const [name, fn] of steps) {
      try {
        out[name] = { ok: true, note: await fn() };
      } catch (err) {
        out[name] = { ok: false, note: (err as Error).message.slice(0, 300) };
        this.log.warn(`데모 활동 '${name}' 단계 실패 — 건너뜀: ${(err as Error).message}`);
      }
    }
    const ms = Date.now() - started;
    this.db.run('UPDATE meta SET value = ? WHERE key = ?', JSON.stringify({ at: this.clock.iso(), ms, steps: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.ok ? v.note : `실패: ${v.note}`])) }), DEMO_ACTIVITY_META);
    this.log.log(`데모 활동 시드 ${Object.values(out).filter((x) => x.ok).length}/${steps.length}단계 (${ms} ms)`);
    return out;
  }

  // ───────────────────────── 1. 안전 분류 확정 — RELEASED인데 초안으로 남은 분류(시드 불일치) ─────────────────────────
  private confirmReleasedSafety() {
    const profiles = this.svc(SafetyProfileService);
    const features = this.svc(FeatureRepo);
    const fsm = who('quality', 'SAFETY_OFFICER', 'safety');
    let done = 0;
    const failed: string[] = [];
    for (const f of features.all().filter((x) => x.lifecycle === 'RELEASED' && !KEEP_FEATURES.includes(x.featureId))) {
      if (profiles.ensure(f.featureId, f.version).status === 'CONFIRMED') continue;
      try {
        profiles.confirm(fsm, f.featureId, f.version, '출시 Version 안전 분류 확정(HARA·Safety Case 검토)');
        done++;
      } catch (err) {
        failed.push(`${f.featureId}@${f.version}: ${(err as Error).message}`);
      }
    }
    if (failed.length) this.log.warn(`안전 분류 확정 실패 ${failed.length}건 — ${failed.slice(0, 3).join(' / ')}`);
    return `확정 ${done}건${failed.length ? `, 실패 ${failed.length}건` : ''}`;
  }

  // ───────────────────────── 2. 업무 절차 — 몇 활동 완료(다음 담당 알림까지) ─────────────────────────
  private procedures() {
    const p = this.svc(ProcedureService);
    // FPW.1·Feature Owner 활동은 시연(작성자 '내 차례')을 위해 비워 둔다
    const plan: [string, Actor, string][] = [
      ['FPW.4-A01', who('integrator', 'IMPLEMENTER', 'proc'), '차량 내 감시·안전기제 설계 — 감속 요청 상한·해제 조건'],
      ['FPW.4-A02', who('quality', 'SAFETY_OFFICER', 'proc'), '플랫폼 도구 신뢰도 분류(TCL2) 확인'],
      ['FPW.7-A01', who('operator', 'OPERATOR', 'proc'), 'Canary 5%·Shadow 일치율 99% 판정 기준'],
    ];
    const done: string[] = [];
    for (const [id, actor, note] of plan) {
      p.complete(actor, id, ProcedureCompleteBody.parse({ note, sign: false }));
      done.push(id);
    }
    return done.join(', ');
  }

  // ───────────────────────── 3. 대시보드 — 작성자 개인 판 + 모두에게 공유한 운영 판 ─────────────────────────
  private dashboards() {
    const d = this.svc(DashboardService);
    const board = (cols: string[][], gadgets: Record<string, { type: string; config?: Record<string, unknown> }>) => ({
      v: 2 as const,
      layout: (cols.length === 1 ? '1' : cols.length === 3 ? '3' : '2') as '1' | '2' | '3',
      columns: cols,
      gadgets: Object.fromEntries(Object.entries(gadgets).map(([id, g]) => [id, { id, type: g.type, config: g.config ?? {} }])),
    });
    const mine = d.create(
      who('author', 'FEATURE_AUTHOR', 'dash'),
      DashboardCreateBody.parse({
        name: '내 Feature 진행 현황',
        board: board([['assigned-1', 'lifecycle-1'], ['pie-1', 'activity-1']], {
          'assigned-1': { type: 'assigned', config: { rows: 10, title: '' } },
          'lifecycle-1': { type: 'lifecycle', config: { title: '' } },
          'pie-1': { type: 'pie', config: { source: 'features', groupBy: 'lifecycle', title: 'Lifecycle 분포' } },
          'activity-1': { type: 'activity', config: { rows: 10, title: '' } },
        }),
      }),
    );
    const shared = d.create(
      who('coordinator', 'RELEASE_MANAGER', 'dash'),
      DashboardCreateBody.parse({
        name: '운영 공유 판 — 차단·이상·절차',
        board: board([['summary-1', 'kills-1'], ['procedures-1', 'created-1']], {
          'summary-1': { type: 'summary', config: { title: '' } },
          'kills-1': { type: 'kills', config: { title: '' } },
          'procedures-1': { type: 'procedures', config: { title: '' } },
          'created-1': { type: 'createdResolved', config: { source: 'anomalies', days: 30, title: '이상 건 생성·해결' } },
        }),
        sharedRoles: ['FEATURE_AUTHOR', 'FEATURE_APPROVER', 'PRODUCT_APPROVER', 'DOMAIN_REVIEWER', 'GATE_JUDGE', 'SAFETY_OFFICER', 'OPERATOR', 'OPS_LEAD', 'BOM_APPROVER', 'VARIANT_OWNER', 'REGULATORY_OWNER', 'REFDB_ADMIN', 'PRODUCT_AUTHOR', 'IMPLEMENTER', 'SECURITY_OFFICER', 'AUDITOR'],
      }),
    );
    return `${mine.id}(작성자), ${shared.id}(공유)`;
  }

  // ───────────────────────── 4. 장애·VOC — 고객센터 VOC 가져오기(SOTIF 트리거는 이상 건으로) ─────────────────────────
  private incidents() {
    const r = this.svc(IncidentService).importVoc(who('operator', 'OPERATOR', 'voc'));
    return `VOC ${r.created.length}건(${r.created.map((i) => i.incidentId).join(', ')})`;
  }

  /** 이상 건 하나를 완화로 닫아 품질 피드백(D04-06)을 만든다 — 차단 권고(KILL)인 FEAT-00022 건은 열린 채로 둔다 */
  private feedback() {
    const anomalies = this.svc(AnomalyService);
    const open = anomalies.list({ status: 'OPEN' });
    const target = open.find((a) => a.featureId !== 'FEAT-00022' && a.kind !== 'DELIVERY');
    if (!target) return `완화할 이상 건 없음(열린 ${open.length}건 그대로)`;
    anomalies.close(who('operator', 'OPERATOR', 'anomaly'), target.anomalyId, 'MITIGATED', '현장 점검 — 설정 재적용으로 해소, 품질 조직에 재발 방지 요청');
    const fb = this.svc(FeedbackService).list({ featureId: target.featureId });
    return `${target.anomalyId} 완화 → 품질 피드백 ${fb.map((x) => x.feedbackId).join(', ') || '없음'}, 열린 이상 ${open.length - 1}건`;
  }

  // ───────────────────────── 5. 해외공장 주문(IF-12) ─────────────────────────
  private legacyOrders() {
    const legacy = this.svc(LegacyService);
    const ops = who('operator', 'OPERATOR', 'legacy');
    return ['TMA', 'HMA', 'HMGC'].map((plant) => `${plant} ${legacy.importOrders(ops, plant).orders.length}건`).join(', ');
  }

  // ───────────────────────── 6. VEX 판정(CSM) ─────────────────────────
  private vex() {
    const sbom = this.svc(SbomService);
    const list = sbom.list();
    const bomRefs = list.length ? sbom.get(list[0].serial).components.map((c) => c['bom-ref']) : [];
    const sw = bomRefs.find((r) => r.startsWith('SW-'));
    const platform = bomRefs.find((r) => !r.startsWith('SW-')) ?? 'pkg:npm/ff-platform';
    const csm = who('integrator', 'SECURITY_OFFICER', 'vex');
    const stmts = [
      VexStatement.parse({ vulnId: 'CVE-2026-31337', affects: [platform], state: 'not_affected', justification: 'code_not_reachable', detail: 'OTA 수신 경로에서 해당 파서를 쓰지 않음 — 공급사 확인서 첨부' }),
      VexStatement.parse({ vulnId: 'CVE-2026-28104', affects: [sw ?? platform], state: 'under_investigation', detail: '협력사 SW 영향 조사 중 — 회신 기한 7일' }),
      VexStatement.parse({ vulnId: 'CVE-2026-19022', affects: [platform], state: 'fixed', detail: '플랫폼 1.4.2에서 의존성 갱신' }),
    ];
    for (const s of stmts) sbom.recordVex(csm, s);
    return `${stmts.length}건(SBOM ${list.length}개 기준)`;
  }

  // ───────────────────────── 7. 보안 이벤트(IdsM) — 경보 임계·채널 제한에 닿지 않게 차량마다 한두 건 ─────────────────────────
  private securityEvents() {
    const sec = this.svc(SecurityEventService);
    const obs: [string, string | null, Record<string, unknown>][] = [
      ['REQUEST_MAC_INVALID', 'KMH-NX4-0002', { source: 'vehicle.request', method: 'POST', path: '/vehicle/v1/<vin>/status' }],
      ['REQUEST_TIME_SKEW', 'KMH-NX4-0003', { source: 'vehicle.request', method: 'GET', path: '/vehicle/v1/<vin>/inbox' }],
      ['E2E_CRC', 'TMA-NX4-0001', { source: 'vehicle.status.accepted', featureId: 'FEAT-00022' }],
      ['SAME_APPROVER', null, { source: 'kill.rejected', featureId: 'FEAT-00022' }],
    ];
    let n = 0;
    for (const [code, vin, forensic] of obs) {
      sec.observe(code, vin, forensic);
      n++;
    }
    return `${n}건`;
  }

  // ───────────────────────── 8. 정책 개정 두 판 배포 + 되돌리기 요청 — 데모 Feature의 안내 flag(QM, 가상검증 서버 없이 GO) ─────────────────────────
  private policyIds: { p1?: string; pub1?: string; voice?: string } = {};
  /** 작성 → 8종 검증(GO여야) → 승인(작성자와 다른 사람) → 배포(출시 담당) */
  private async deployPolicy(flagKey: string, controlPoint: 'Flag' | 'Signal', description: string, step: string) {
    const policies = this.svc(PolicyService);
    const author = who('author', 'FEATURE_AUTHOR', step);
    const p = policies.create(author, CreatePolicyBody.parse({ featureId: DEMO_FEATURE.featureId, featureVersion: DEMO_FEATURE.version, controlPoint, flagKey, description, safeDefault: false }));
    const v = await policies.validate(author, p.policyId);
    if (v.run.decision !== 'GO') throw new Error(`${p.policyId} 검증 ${v.run.decision}: ${v.run.reasons.join(' / ')}`);
    policies.decide(who('approver', 'FEATURE_APPROVER', step), p.policyId, PolicyDecisionBody.parse({ decision: 'APPROVE', reason: '8종 검증 GO 확인' }));
    const d = policies.deploy(who('coordinator', 'RELEASE_MANAGER', step), p.policyId, `${description} 배포`);
    return { policyId: p.policyId, publicationId: d.publicationId };
  }

  /**
   * 첫 판 배포. 되돌리기는 복구 기준 판의 게시본이 차량 확인(CONFIRMED·PARTIAL)까지 가야 요청할 수 있다 —
   * 차량 회신은 부팅 뒤 차량 채널(시뮬레이터·실차)이 보내므로, 첫 판이 확인되면 그때 둘째 판 배포·되돌리기 요청을 잇는다.
   */
  private async policyRevisions() {
    const a = await this.deployPolicy(FLAG_GUIDE, 'Flag', '고속도로 IC·JC 상세 안내 — 분기 1.5 km 전 표시', 'policy-r1');
    this.policyIds.p1 = a.policyId;
    this.policyIds.pub1 = a.publicationId;
    const status = this.svc(PublicationRepo).get(a.publicationId)?.status;
    if (status === 'CONFIRMED' || status === 'PARTIAL') {
      this.continuation = this.secondRevision();
      return `${a.policyId}(${a.publicationId}) 배포 · ${await this.continuation}`;
    }
    this.continuation = new Promise<string>((resolve) => {
      this.waiting = this.svc(EventService)
        .stream(['publication.closed'])
        .subscribe((e) => {
          const p = e.payload as { publicationId?: string; status?: string };
          if (p.publicationId !== a.publicationId) return;
          this.waiting?.unsubscribe();
          this.waiting = null;
          // 발행 중(트랜잭션 안)이 아니라 다음 차례에 — 둘째 판 배포는 자기 트랜잭션을 연다
          setImmediate(() => {
            const go = p.status === 'CONFIRMED' || p.status === 'PARTIAL' ? this.secondRevision() : Promise.resolve(`첫 판 게시본 ${p.status} — 되돌리기 요청 생략`);
            void go.then(resolve, (err: Error) => resolve(`실패: ${err.message}`));
          });
        });
    }).then((note) => {
      this.recordStep('rollback', note);
      return note;
    });
    return `${a.policyId}(${a.publicationId}) 배포 — 차량 확인 뒤 둘째 판·되돌리기 요청`;
  }

  /** 둘째 판 배포 → 운영자가 첫 판으로 되돌리기 요청(운영 리더 승인 대기, REQUESTED) */
  private async secondRevision() {
    try {
      const b = await this.deployPolicy(FLAG_GUIDE, 'Flag', '고속도로 IC·JC 상세 안내 — 분기 2 km 전 표시, 안내음 낮춤', 'policy-r2');
      const rollback = this.svc(RollbackService);
      const operator = who('operator', 'OPERATOR', 'rollback');
      const r = rollback.requestPolicyRollback(operator, b.policyId, PolicyRollbackBody.parse({ recovery: { policyId: this.policyIds.p1 }, expectedDeploymentId: b.publicationId, reason: '2 km 전 안내가 너무 이르다는 현장 의견 — 1.5 km 판으로 되돌림', approvers: ['usr-opslead'] }));
      rollback.decideRequest(who('opslead', 'OPS_LEAD', 'rollback'), r.requestId, RollbackDecisionBody.parse({ decision: 'APPROVE', comment: '데모 — 첫 판 근거와 대상 차량 확인' }));
      const executed = rollback.executeRequest(operator, r.requestId);
      if (executed.status === 'FAILED') throw new Error(`데모 롤백 재검증 실패: ${executed.failureReason}`);
      if (executed.artifactId) await this.confirmedPublication(executed.artifactId);
      const revised = await this.deployPolicy(FLAG_GUIDE, 'Flag', '고속도로 IC·JC 상세 안내 — 안내음 조정 후 재배포', 'policy-r3');
      const pending = rollback.requestPolicyRollback(operator, revised.policyId, PolicyRollbackBody.parse({ recovery: { policyId: this.policyIds.p1 }, expectedDeploymentId: revised.publicationId, reason: '데모 — 재배포 품질 검토를 위해 운영 리더 복구 승인을 요청', approvers: ['usr-opslead'] }));
      return `${executed.executionId} ${executed.status}, ${pending.requestId} ${pending.status}`;
    } catch (err) {
      this.log.warn(`데모 활동 'rollback' 단계 실패 — 건너뜀: ${(err as Error).message}`);
      throw err;
    }
  }

  /** 재배포 뒤 되돌리기 표본도 차량이 확인한 복구 판을 가리킨다 — 회신을 꾸며 내지 않는다. */
  private confirmedPublication(publicationId: string): Promise<void> {
    const status = this.svc(PublicationRepo).get(publicationId)?.status;
    if (status === 'CONFIRMED' || status === 'PARTIAL') return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.waiting = this.svc(EventService).stream(['publication.closed']).subscribe((e) => {
        const p = e.payload as { publicationId?: string; status?: string };
        if (p.publicationId !== publicationId) return;
        this.waiting?.unsubscribe();
        this.waiting = null;
        if (p.status === 'CONFIRMED' || p.status === 'PARTIAL') resolve();
        else reject(new Error(`복구 게시본의 차량 확인 실패: ${p.status}`));
      });
    });
  }

  // ───────────────────────── 9. 승인 대기 정책(VALIDATED) ─────────────────────────
  private async validatedPolicy() {
    const policies = this.svc(PolicyService);
    const author = who('author', 'FEATURE_AUTHOR', 'policy-validated');
    const p = policies.create(author, CreatePolicyBody.parse({ featureId: DEMO_FEATURE.featureId, featureVersion: DEMO_FEATURE.version, controlPoint: 'Flag', flagKey: FLAG_VOICE, description: '고속도로 IC·JC 상세 안내 음성 안내 켜기(시범)', safeDefault: false }));
    const v = await policies.validate(author, p.policyId);
    this.policyIds.voice = p.policyId;
    return `${p.policyId} ${v.policy.status}(${v.run.decision})`;
  }

  // ───────────────────────── 10. 실험 — 종료 1(첫 판), 실행 중 1(승인 대기 음성 안내 판 Shadow 대조) ─────────────────────────
  private async experiments() {
    const { p1, voice } = this.policyIds;
    if (!p1 || !voice) throw new Error('정책 단계가 끝나지 않았습니다');
    const exp = this.svc(ExperimentService);
    const author = who('author', 'FEATURE_AUTHOR', 'exp');
    const release = who('coordinator', 'RELEASE_MANAGER', 'exp');
    const done = exp.create(author, CreateExperimentBody.parse({ policyId: p1, type: 'AB', hypothesis: '분기 1.5 km 전 안내가 분기점 놓침(사용률)을 줄인다', metric: 'ENGAGEMENT', treatmentBp: 1000, minSamples: 2000 }));
    exp.start(release, done.experimentId);
    await exp.conclude(release, done.experimentId, ConcludeExperimentBody.parse({ decision: 'EXTEND', reason: '표본 부족 — 2 km 판으로 기간을 늘려 재실험' }));
    const running = exp.create(author, CreateExperimentBody.parse({ policyId: voice, type: 'SHADOW', hypothesis: '음성 안내 판도 화면 안내와 판단이 같다', metric: 'DECISION_AGREEMENT', treatmentBp: 5000, minSamples: 500 }));
    exp.start(release, running.experimentId);
    return `${done.experimentId} CONCLUDED, ${running.experimentId} RUNNING`;
  }

  // ───────────────────────── 11. Flag Retirement — 배포된 배너 flag, 승인 뒤 2단계(남은 차량 집계)까지 ─────────────────────────
  private async retirement() {
    const banner = await this.deployPolicy(FLAG_BANNER, 'Signal', '고속도로 IC·JC 상세 안내 배너(구형 표시) 신호', 'retire');
    const ret = this.svc(RetirementService);
    const r = ret.request(who('author', 'FEATURE_AUTHOR', 'retire'), RetirementRequestBody.parse({ flagKey: FLAG_BANNER, reason: '배너 표시를 상세 안내 flag로 통합 — 별도 신호 flag 불필요', nextReleaseAt: null }));
    let cur = r;
    for (const role of r.requiredApprovals as Role[]) {
      const actor = role === 'SAFETY_OFFICER' ? who('quality', 'SAFETY_OFFICER', 'retire') : role === 'FEATURE_APPROVER' ? who('approver', 'FEATURE_APPROVER', 'retire') : who('productowner', role, 'retire');
      cur = ret.approve(actor, r.retirementId);
    }
    cur = ret.step(who('integrator', 'IMPLEMENTER', 'retire'), r.retirementId, RetirementStepBody.parse({ step: 'REMAINING_VEHICLES' }));
    return `${r.retirementId}(${banner.policyId}) ${cur.status} → 다음 ${cur.next}`;
  }

  // ───────────────────────── 12. BOM 기준선 확정 요청 2건(PENDING) — 새 Version을 승인(→개발 착수)까지 올린 뒤 요청 ─────────────────────────
  private baselineRequests() {
    const features = this.svc(FeatureRepo);
    const registry = this.svc(RegistryService);
    const profiles = this.svc(SafetyProfileService);
    const gates = this.svc(GateService);
    const lifecycle = this.svc(LifecycleService);
    const baselines = this.svc(BaselineService);
    const analysis = this.svc(AnalysisEvidenceService);
    const author = who('author', 'FEATURE_AUTHOR', 'baseline');
    const judge = who('quality', 'GATE_JUDGE', 'baseline');
    const fsm = who('quality', 'SAFETY_OFFICER', 'baseline');
    const approver = who('approver', 'FEATURE_APPROVER', 'baseline');
    // 최신 Version이 RELEASED인 QM Feature 중 앞에서 둘(결정적) — 시연·e2e Feature와 데모 정책 Feature는 뺀다
    const latest = new Map<string, (typeof all)[number]>();
    const all = features.all();
    for (const f of all) latest.set(f.featureId, f);
    const picks = [...latest.values()].filter((f) => f.lifecycle === 'RELEASED' && f.asil === 'QM' && !KEEP_FEATURES.includes(f.featureId) && f.featureId !== DEMO_FEATURE.featureId).slice(0, 2);
    const made: string[] = [];
    for (const f of picks) {
      const v = registry.createVersion(author, f.featureId, CreateVersionBody.parse({ baseVersion: f.version, bump: 'patch', reason: '안내 문구 다듬기 — 고객 VOC 반영', changes: { description: `${f.description ?? f.name} (안내 문구 개선)` } }));
      const ver = v.feature.version;
      profiles.confirm(fsm, f.featureId, ver, '이전 Version 분류 이어받음 — 변경 없음 확인');
      // G2 근거 — 이 Version의 HARA(보안 관련이면 TARA도)
      analysis.record(fsm, 'HARA', f.featureId, ver, HaraBody.parse({ docId: `HARA-${f.featureId}-${ver}`, asil: 'QM', safetyGoals: [{ id: 'SG-01', text: '안내 문구 변경 — 운전자 주의 분산 위험 없음', asil: 'QM' }], reason: '문구 변경 영향 HARA 재검토' }));
      if (analysis.view(f.featureId, ver).security.relevant)
        analysis.record(who('integrator', 'SECURITY_OFFICER', 'baseline'), 'TARA', f.featureId, ver, TaraBody.parse({ docId: `TARA-${f.featureId}-${ver}`, threats: [{ id: 'TS-01', text: '안내 문구 위변조 표시', cal: 'CAL1' }], reason: '문구 변경 영향 TARA 재검토' }));
      for (const g of ['G1', 'G2', 'G3'] as const) gates.judge(judge, f.featureId, ver, JudgeGateBody.parse({ gate: g, inputResult: 'PASS', rationale: '문구 변경 — 영향 없음 확인', evidenceRef: `EV-DEMO-${g}` }));
      lifecycle.transition(approver, f.featureId, ver, 'APPROVED', '문구 변경 승인');
      const q = baselines.request(author, BaselineRequestBody.parse({ featureId: f.featureId, version: ver, reason: '문구 변경 Version 기준선 확정 요청' }));
      made.push(`${q.requestId} ${f.featureId}@${ver}`);
    }
    return made.join(', ') || '대상 Feature 없음';
  }

  // ───────────────────────── 13. Safety Case 경보 기준 — 배포 중 Version ─────────────────────────
  private kpiPlans() {
    const kpi = this.svc(SafetyKpiService);
    const fsm = who('quality', 'SAFETY_OFFICER', 'kpi');
    const out: string[] = [];
    for (const r of kpi.released()) {
      kpi.recordPlan(fsm, r.featureId, r.version, MetricPlanBody.parse({ thresholds: examplePlan(r.featureId, r.version).thresholds }));
      out.push(`${r.featureId}@${r.version}`);
    }
    return out.join(', ') || '배포 Version 없음';
  }

  // ───────────────────────── 14. 체험 → 구독·구매 전환 — 합성 모집단의 최근 수락 체험 몇 건(등록 차량 권한은 건드리지 않는다) ─────────────────────────
  private trialConversions() {
    const ent = this.svc(EntitlementService);
    const billing = this.svc(BillingService);
    const ops = who('operator', 'OPERATOR', 'trial');
    const page = ent.trials({ source: 'ALL', page: 1, pageSize: 50 } as Parameters<EntitlementService['trials']>[0]).items;
    const picks = page.filter((t) => t.source === 'SYNTHETIC' && t.acceptedAt && (t.state === 'ACTIVE' || t.state === 'EXPIRED')).slice(0, 8);
    const done: string[] = [];
    picks.forEach((t, i) => {
      billing.purchase(ops, t.grantId, i % 3 === 2 ? '구매' : '구독');
      done.push(t.grantId);
    });
    return `${done.length}건 전환`;
  }

  // ───────────────────────── 15. 권한 밖 시도(DENIED) — 가드와 같은 감사 경로 ─────────────────────────
  private denials() {
    const audit = this.svc(AuditService);
    // 가드(RolesGuard)가 남기는 것과 같은 모양 — 행위 이름은 그 경로의 @AuditAction, 사유는 역할 이름
    const rows: [Actor, string, string, Role[]][] = [
      [who('author', 'FEATURE_AUTHOR', 'deny'), 'POLICY_DECISION', '/api/policies/POL-00005/decision', ['FEATURE_APPROVER']],
      [who('operator', 'OPERATOR', 'deny'), 'BASELINE_DECISION', '/api/baselines/requests/BR-00001/decision', ['BOM_APPROVER']],
      [who('viewer', 'AUDITOR', 'deny'), 'KILL_REQUEST', '/api/kill-requests', ['OPERATOR', 'SAFETY_OFFICER']],
      [who('commerce', 'PRODUCT_AUTHOR', 'deny'), 'EXPERIMENT_START', '/api/experiments/EXP-00002/start', ['RELEASE_MANAGER']],
    ];
    for (const [actor, action, path, allowed] of rows) audit.denied(actor, action, path, `역할 ${ROLE_LABEL[actor.role]}은(는) 허용되지 않음 (허용: ${allowed.map((x) => ROLE_LABEL[x]).join(', ')})`);
    return `${rows.length}건`;
  }

  // ───────────────────────── 16. 외부 연계 — 받은 변경(매핑 없는 계정·권한 거부), 실패한 보내기, 열린 충돌 ─────────────────────────
  private async extSync() {
    const ext = this.svc(ExtSyncService);
    const repo = this.svc(ExtSyncRepo);
    const features = this.svc(FeatureRepo);
    const epicOf = (featureId: string, version: string) => repo.linksOf('FEATURE', `${featureId}@${version}`, 'JIRA').find((l) => l.kind === 'EPIC')?.key ?? null;
    const notes: string[] = [];
    // 받은 함 ① 매핑 없는 JIRA 계정이 Epic 상태를 바꿈 → UNMAPPED(반영 안 함)
    const released = features.all().filter((f) => f.lifecycle === 'RELEASED' && !KEEP_FEATURES.includes(f.featureId));
    const e1 = released[0] ? epicOf(released[0].featureId, released[0].version) : null;
    if (e1) notes.push(`받음 ${(await ext.mockAct('JIRA', MockExtActionBody.parse({ key: e1, action: 'TRANSITION', status: 'Deprecated', externalUser: 'contractor.kim' }))).result?.outcome}`);
    // 받은 함 ② 작성자가 JIRA에서 승인 시도 → REJECTED(권한 없음, Epic 되돌림)
    const proposed = features.all().find((f) => f.lifecycle === 'PROPOSED' && !KEEP_FEATURES.includes(f.featureId));
    const e2 = proposed ? epicOf(proposed.featureId, proposed.version) : null;
    if (e2) notes.push(`받음 ${(await ext.mockAct('JIRA', MockExtActionBody.parse({ key: e2, action: 'TRANSITION', status: 'Approved', externalUser: 'kim.author' }))).result?.outcome}`);
    // 충돌 — 바깥에서 webhook 없이 바뀐 Epic에 플랫폼 거울 쓰기가 닿음
    const f3 = released[1];
    const e3 = f3 ? epicOf(f3.featureId, f3.version) : null;
    if (f3 && e3) {
      await ext.mockAct('JIRA', MockExtActionBody.parse({ key: e3, action: 'TRANSITION', status: 'Closed', externalUser: 'park.release', deliver: false }));
      repo.enqueue('JIRA', { op: 'EPIC_MIRROR', featureId: f3.featureId, version: f3.version, comment: '플랫폼 Lifecycle 재확인(정기 대사)' }, `demo-activity:epic:${f3.featureId}@${f3.version}`);
      await ext.drain();
      notes.push(`충돌 ${repo.countConflicts('JIRA')}건`);
    }
    // 실패한 보내기 — codeBeamer 검증 결과 쓰기가 재시도 끝에 실패(협력사 서버 점검)
    const req = repo.linksOf('FEATURE', `${released[0]?.featureId}@${released[0]?.version}`, 'CODEBEAMER').find((l) => l.kind === 'REQUIREMENT');
    if (req && released[0]) {
      const idem = `demo-activity:ver:${req.key}`;
      repo.enqueue('CODEBEAMER', { op: 'VERIFICATION', key: req.key, featureId: released[0].featureId, version: released[0].version, gate: 'G5', status: 'PASS', evidenceRef: null }, idem);
      const job = repo.jobs({ system: 'CODEBEAMER', status: 'PENDING', limit: 1000 }).find((j) => 'key' in j.job && j.job.key === req.key);
      if (job) {
        repo.finish(job, 'FAILED', 'codeBeamer 503 Service Unavailable — 정기 점검(5회 재시도 후 중단)');
        repo.setState('CODEBEAMER', req.key, 'FAILED');
        notes.push(`실패 보내기 ${job.jobId}`);
      }
    }
    return notes.join(', ');
  }

  /** 실제 서비스로 만든 정의 승인·출시 책임 확인·상품 구성 승인 대기 — 담당자 홈에 다음 일이 있다. */
  private workQueues() {
    const features = this.svc(FeatureRepo);
    const profiles = this.svc(SafetyProfileService);
    const analysis = this.svc(AnalysisEvidenceService);
    const gates = this.svc(GateService);
    const judge = who('quality', 'GATE_JUDGE', 'queues');
    const fsm = who('quality', 'SAFETY_OFFICER', 'queues');
    const f = features.get('FEAT-00180', '0.2.0');
    if (!f) throw new Error('정의 승인 대기 표본이 없습니다');
    this.svc(RegistryService).updateDraft(who('author', 'FEATURE_AUTHOR', 'queues'), f.featureId, f.version, UpdateDraftBody.parse({
      functions: [{ label: '배터리 급속충전 예열 기능' }], swIds: ['SW-BPRE-APP'], swVersions: ['0.2.0'], ecuPnos: ['37501-EV800'],
    }));
    profiles.confirm(fsm, f.featureId, f.version, '데모 — 배터리 예열 분류 검토');
    analysis.record(fsm, 'HARA', f.featureId, f.version, HaraBody.parse({ docId: 'HARA-DEMO-BPRE', asil: f.asil, safetyGoals: [{ id: 'SG-DEMO-BPRE', text: '예열 범위를 벗어난 작동을 막는다', asil: f.asil }], reason: '데모 — 정의 승인 전 위험 분석 기록' }));
    if (analysis.view(f.featureId, f.version).security.relevant)
      analysis.record(who('integrator', 'SECURITY_OFFICER', 'queues'), 'TARA', f.featureId, f.version, TaraBody.parse({ docId: 'TARA-DEMO-BPRE', threats: [{ id: 'TS-DEMO-BPRE', text: '예열 요청 위변조를 막는다', cal: 'CAL1' }], reason: '데모 — 위협 분석 기록' }));
    for (const gate of ['G1', 'G2', 'G3'] as const)
      gates.judge(judge, f.featureId, f.version, JudgeGateBody.parse({ gate, inputResult: 'PASS', rationale: '데모 — 정의 승인 전 근거 검토', evidenceRef: `EV-DEMO-BPRE-${gate}`, asilReasonReviewed: true }));

    const sign = features.get('FEAT-00144', '3.3.0');
    if (!sign) throw new Error('출시 책임 확인 대기 표본이 없습니다');
    profiles.confirm(fsm, sign.featureId, sign.version, '데모 — 검증 완료 Version의 안전 분류 확인');
    for (const gate of ['G8', 'G9'] as const)
      gates.judge(judge, sign.featureId, sign.version, JudgeGateBody.parse({ gate, inputResult: 'PASS', rationale: '데모 — 출시 준비 근거 검토', evidenceRef: `EV-DEMO-SVM-${gate}` }));

    const productFeature = features.get(DEMO_FEATURE.featureId, DEMO_FEATURE.version)!;
    const product = this.svc(CatalogService).create(who('commerce', 'PRODUCT_AUTHOR', 'queues'), CreateProductBody.parse({
      name: '고속도로 상세 안내 체험 상품', description: '데모 — 상품 구성 승인 대기', country: productFeature.country, vehicleModel: productFeature.vehicleModel, trim: productFeature.trim,
      saleType: '체험', type: 'SINGLE', baselineIds: [productFeature.baselineId], ownerId: productFeature.ownerId,
    }));
    return `${f.featureId} 정의 승인, ${sign.featureId} Release Sign-off, ${product.product.catalogId} 구성 승인`;
  }

  /** 발행본은 고치지 않고 도메인 검토 요청만 만든다 — 관리자·검토자에게 실제 대기 건이 보인다. */
  private refdbReviews() {
    const changes = this.svc(RefdbChangeService);
    const refs = this.svc(RefdbRepository);
    return ['AD-LON-002', 'AD-ADS-013'].map((refId) => {
      const r = refs.getRef(refId);
      if (!r) throw new Error(`${refId} 기준 행이 없습니다`);
      const c = changes.create(who('author', 'FEATURE_AUTHOR', 'refdb'), CreateRefChangeBody.parse({ kind: 'MODIFY', refId, after: { aliases: [...r.aliases, '데모 검토 별칭'] }, reason: '데모 — 사내 용어 검색 보강을 위한 도메인 검토 요청' }));
      return c.changeId;
    }).join(', ');
  }

  /**
   * 수신자 규칙·직접 보낸 알림·오류 이력·평가 운영 데이터(기능명세서 B1·B5·B6) — 화면이 빈 표로 열리지 않게 담당자가 한 일을 서비스 경로로 재현한다.
   * 평가 운영 데이터는 지난 14일의 일 단위 평가 횟수(앱 OFREP·차량 SDK·Unleash Edge)를 집계 서비스로 넣는다(원본 식별자 없음).
   */
  private opsSignals() {
    const ntf = this.svc(NotificationService);
    const opslead = who('opslead', 'OPS_LEAD', 'ntf');
    ntf.setRule(opslead, 'billing.call.failed', NotificationRuleBody.parse({ recipients: [{ kind: 'role', role: 'OPS_LEAD' }], reason: '과금 연계 오류는 운영 리더도 함께 본다(정산 마감 대응)' }));
    ntf.setRule(opslead, 'pipeline.run.failed', NotificationRuleBody.parse({ recipients: [{ kind: 'user', id: 'usr-coordinator' }, { kind: 'role', role: 'GATE_JUDGE' }], reason: '파이프라인 실패는 출시 조율·품질 판정 담당이 바로 받는다' }));
    ntf.send(opslead, NotificationSendBody.parse({ title: '오늘 22시 Unleash Edge 점검', message: '점검 동안 차량 서명본 발급이 약 5분 멈춥니다. 긴급 차단은 평소대로 처리됩니다.', severity: 'WARNING', link: '/ops/kill', recipients: [{ kind: 'role', role: 'OPERATOR' }, { kind: 'role', role: 'RELEASE_MANAGER' }, { kind: 'user', id: 'usr-integrator' }] }));
    // CI/CD 실행 결과 — 시작·실패(실패는 오류 이력 + 알림)
    const runs = this.svc(PipelineRunService);
    const ci = who('integrator', 'IMPLEMENTER', 'ci');
    const day = (d: number, h = 9) => new Date(this.clock.now().getTime() - d * 86_400_000 + (h - 9) * 3600_000).toISOString();
    runs.record(ci, PipelineRunBody.parse({ runId: 'GL-20431', pipeline: 'adas-distance/main', environment: 'staging', status: 'SUCCEEDED', featureId: 'FEAT-00022', startedAt: day(3, 8), finishedAt: day(3, 9) }));
    runs.record(ci, PipelineRunBody.parse({ runId: 'GL-20517', pipeline: 'adas-distance/main', environment: 'staging', status: 'FAILED', featureId: 'FEAT-00022', stage: 'hil-test', reason: 'HIL 시험 42건 중 3건 실패 — 감속 요청 상한 경계값', startedAt: day(1, 10), finishedAt: day(1, 11) }));
    // 연계·과금 오류 — 해외공장 ERP 응답 시간 초과, 과금 시스템 거부(오류 이력 서비스 경로)
    const errors = this.svc(IntegrationErrorService);
    errors.record(who('operator', 'OPERATOR', 'legacy'), { system: 'LEGACY', errorType: 'REJECTED', target: 'IF-12 해외공장 HMGC', message: 'ERP 주문 조회 응답 시간 초과(30초) — 다음 주기에 다시 가져옵니다', at: day(2, 14) });
    errors.record(who('operator', 'OPERATOR', 'billing'), { system: 'BILLING', errorType: 'REJECTED', target: 'CAT-00019:구독', message: '과금 시스템이 결제 수단 확인을 거부했습니다(카드 승인 한도)', at: day(1, 16) });
    // 평가 운영 데이터 — 배포 정책 flag마다 지난 14일
    const stats = this.svc(EvaluationStatsService);
    const flags = this.svc(PolicyRepo).all().filter((p) => p.status === 'DEPLOYED');
    let n = 0;
    for (let d = 13; d >= 0; d--) {
      const at = day(d, 12);
      const wave = 1 + ((13 - d) % 7) / 10; // 주간 흐름 — 주말 낮은 날 없이 완만하게
      for (const p of flags) {
        const fClass = this.svc(SafetyProfileService).ensure(p.featureId, p.featureVersion).fClass;
        const qm = fClass === 'F0' || fClass === 'F1';
        const seed = [...p.flagKey].reduce((a, c) => a + c.charCodeAt(0), 0) % 40;
        const samples: EvaluationSample[] = qm
          ? [
              { at, flagKey: p.flagKey, source: 'OFREP', appName: 'ivi-nav', environment: 'production', result: 'ON', variant: 'on', count: Math.round((1180 + seed * 9) * wave) },
              { at, flagKey: p.flagKey, source: 'OFREP', appName: 'ivi-nav', environment: 'production', result: 'OFF', variant: 'off', count: Math.round((210 + seed) * wave) },
              { at, flagKey: p.flagKey, source: 'OFREP', appName: 'ivi-nav', environment: 'staging', result: 'ON', variant: 'on', count: 60 + seed },
              { at, flagKey: p.flagKey, source: 'VEHICLE_SDK', appName: 'vehicle-sdk', environment: 'fleet', result: 'ON', variant: 'on', count: Math.round((340 + seed * 3) * wave) },
              ...(d % 5 === 0 ? [{ at, flagKey: p.flagKey, source: 'OFREP' as const, appName: 'ivi-nav', environment: 'production', result: 'ERROR' as const, variant: '', count: 2 }] : []),
            ]
          : [
              { at, flagKey: p.flagKey, source: 'VEHICLE_SDK', appName: 'vehicle-sdk', environment: 'fleet', result: 'SAFE_DEFAULT', variant: 'safe_default', count: Math.round((420 + seed * 4) * wave) },
              { at, flagKey: p.flagKey, source: 'UNLEASH_EDGE', appName: 'vehicle-unleash', environment: 'development', result: 'ON', variant: 'on', count: Math.round((150 + seed * 2) * wave) },
              { at, flagKey: p.flagKey, source: 'UNLEASH_EDGE', appName: 'vehicle-unleash', environment: 'development', result: 'OFF', variant: 'off', count: Math.round((40 + seed) * wave) },
            ];
        n += samples.reduce((s, x) => s + (x.count ?? 1), 0);
        this.db.tx(() => stats.record(samples));
      }
    }
    return `추가 수신자 2건 · 직접 알림 1건 · 파이프라인 2건 · 오류 이력 3건 · 평가 ${n.toLocaleString('ko-KR')}회(${flags.length} flag × 14일)`;
  }

  /** PoC 기능·영상 차량은 그대로 두고, 등록 차량의 별도 기능에서 차단→복원 승인 대기를 재현한다. */
  private safetyCase() {
    const kills = this.svc(KillService);
    const operator = who('operator', 'OPERATOR', 'kill');
    let k = kills.issue(operator, KillCreateBody.parse({ featureId: 'FEAT-00029', featureVersion: '1.0.0', vins: ['HMA-NX4-0001'], reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', reason: '데모 — 급가속 억제 현장 이상 봉쇄와 복원 검토', containmentJustification: '데모 현장 조사 중 영향 차량 1대 봉쇄', confirm: 'FEAT-00029' }), { userNoticeRef: 'DEMO-US-AAS-NOTICE' });
    k = kills.approve(who('quality', 'SAFETY_OFFICER', 'kill'), k.killId, KillApproveBody.parse({ comment: '데모 — 기능안전 봉쇄 검토' }));
    k = kills.approve(who('integrator', 'SECURITY_OFFICER', 'kill'), k.killId, KillApproveBody.parse({ comment: '데모 — 사이버보안 봉쇄 검토' }));
    if (k.status !== 'ACTIVE') throw new Error(`데모 차단이 실행되지 않았습니다: ${k.status}`);
    const evidence = this.svc(GateRepo).allEvidence().find((e) => e.featureId === k.featureId && e.inputResult === 'PASS');
    if (!evidence) throw new Error('데모 복원 검토의 PASS 근거가 없습니다');
    this.svc(RestoreService).request(operator, k.killId, RestoreRequestBody.parse({ reason: '데모 — 원인 조치 근거 검토 뒤 1대 Canary 복원 요청', evidenceRef: evidence.evidenceRef, cohort: k.vins }));
    return `${k.killId} ACTIVE, safety2·opslead 복원 승인 대기`;
  }

  /** 모의 차량이 실제 조회 관문을 호출한다 — 화면의 요청 이력을 임의 행으로 만들지 않는다. */
  private async vehicleQueries() {
    const requests = this.svc(VehicleRequestService);
    const vins = ['ego-01', 'lead-01', 'HMA-NX4-0001'];
    const response = { setHeader() { return this; } } as unknown as Response;
    for (const vin of vins)
      await requests.query({ id: `vehicle:${vin}`, role: 'VEHICLE', correlationId: `demo-vehicle-query-${vin}` }, vin, OfrepBody.parse({ context: { targetingKey: vin } }), response);
    return `${vins.length}대 차량 QUERY 요청`;
  }
}
