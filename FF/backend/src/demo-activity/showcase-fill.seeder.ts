import { ensureShowcaseSupplierEvidence } from './showcase-supplier';
// 전시 빈 화면 채우기 — 공개 정적 데모·로컬 데모에서 '표본 없음'·빈 표로 보이던 화면을 담당자의 실제 서비스 경로로 채운다.
// 원장(감사·이벤트)에 직접 쓰지 않는다 — 서비스가 실제 경로로 남긴다. 새 Feature는 만들지 않는다 — 새 Version은 시연 주인공의 개선 Version 4.1.1 하나뿐(전시 184 + 1).
//  · DB마다 한 번(meta 'seed:showcase-fill'), 켜는 조건은 데모 활동과 같다(운영 모드·FF_SEED=none·FF_DEMO_ACTIVITY=0이면 끔). FF_SHOWCASE_FILL=0이면 이것만 끈다
//  · 데모 활동·전시 시나리오가 끝난 뒤 부팅 훅에서 돈다 — 메모리 DB(정적 스냅샷·시험)는 서버가 요청을 받기 전에 끝나 스냅샷이 결과를 담는다
//  · 차량 회신을 기다리는 단계(배포·차단·복원)는 수동 시계(시험, FF_SCHEDULER=manual)면 건너뛴다
//  · 단계마다 따로 잡는다 — 한 단계가 실패해도 경고만 남기고 다음 단계로, 부팅은 막지 않는다
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  AnswerConsultationBody,
  ChangeRecordBody,
  ContractBasisBody,
  CostTransitionBody,
  CreateIncidentBody,
  CreatePolicyBody,
  CreateRollbackPlanBody,
  CreateProductVersionBody,
  CreateVersionBody,
  cohortBucket,
  deployStartBasisPoints,
  effectiveBasisPoints,
  CreateRefChangeBody,
  CreateDependencyBody,
  DataAccessRequestBody,
  DecideRefChangeBody,
  KillApproveBody,
  KillCreateBody,
  MetricPlanBody,
  MockExtCreateBody,
  OfferTrialsBody,
  SafetyProfilePatch,
  PolicyDecisionBody,
  PolicyRollbackBody,
  PublishRefReleaseBody,
  RestoreRequestBody,
  ReviewRefChangeBody,
  RunVirtualBody,
  UpdateDraftBody,
  VehicleReportBody,
  virtualScenariosFor,
  examplePlan,
  HaraBody,
  HomologationBody,
  JudgeGateBody,
  RolloutStageBody,
  SotifBody,
  TaraBody,
  type FeatureVersionRow,
  type Role,
} from '@ff/contracts';
import type { Response } from 'express';
import type { Actor } from '../kernel/actor';
import { CarlaAdapter } from '../adapters/sim/carla.adapter';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { Scheduler } from '../kernel/scheduler';
import { FleetRepo, PolicyRepo } from '../domains/d01-policy/policy-repos';
import { FeatureRepo, GateRepo, ProductRepo } from '../domains/d01-policy/repos';
import { EntitlementService } from '../domains/d01-policy/entitlement/entitlement.service';
import { PolicyService } from '../domains/d01-policy/policy-store/policy.service';
import { CatalogService } from '../domains/d01-policy/catalog/catalog.service';
import { UnleashSyncService } from '../domains/d01-policy/policy-store/unleash-sync.service';
import { RefdbChangeService } from '../domains/d01-policy/refdb/refdb-change.service';
import { RefdbRepository } from '../domains/d01-policy/refdb/refdb.repository';
import { RegistryService } from '../domains/d01-policy/registry/registry.service';
import { LifecycleService } from '../domains/d01-policy/registry/lifecycle.service';
import { StagedRolloutService } from '../domains/d01-policy/staged-rollout/staged-rollout.service';
import { GateService } from '../domains/d01-policy/topology/gate.service';
import { AnomalyService } from '../domains/d06-qsec/anomaly-response/anomaly.service';
import { AnalysisEvidenceService } from '../domains/d01-policy/topology/analysis-evidence.service';
import { TopologyService } from '../domains/d01-policy/topology/topology.service';
import { SafetyProfileService } from '../domains/d01-policy/registry/safety-profile.service';
import { VehicleRuntimeService } from '../domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { VehicleRequestRepo } from '../domains/d02-runtime/vehicle-requests/vehicle-request.repo';
import { VehicleRequestService } from '../domains/d02-runtime/vehicle-requests/vehicle-request.service';
import { RetentionService } from '../domains/d04-ops/telemetry-ingest/retention.service';
import { OfrepService } from '../domains/d05-ext/api-gateway/ofrep.controller';
import { vehiclePseudonym } from '../kernel/crypto';
import { VirtualRunRepo } from '../domains/d06-qsec/scenario-validation/virtual-run.repo';
import { VirtualValidationService } from '../domains/d06-qsec/scenario-validation/virtual-validation.service';
import { KillService } from '../domains/d03-safety/kill-switch/kill.service';
import { RestoreService } from '../domains/d03-safety/restore/restore.service';
import { RollbackService } from '../domains/d03-safety/restore/rollback.service';
import { IncidentService } from '../domains/d04-ops/incident-voc/incident.service';
import { ChangeRecordService } from '../domains/d04-ops/pipeline-link/change-record.service';
import { SafetyKpiService } from '../domains/d04-ops/telemetry-ingest/safety-kpi.service';
import { DataActService } from '../domains/d05-ext/api-gateway/data-act.service';
import { ExtSyncRepo } from '../domains/d05-ext/api-gateway/ext-sync/ext-sync.repo';
import { ExtSyncService } from '../domains/d05-ext/api-gateway/ext-sync/ext-sync.service';
import { PublicationRepo } from '../domains/d06-qsec/secure-deploy/publication.repo';
import { CostService } from '../domains/d07-cost/estimation/cost.service';
import { ConsultService } from '../workflows/consult.service';
import { DemoActivitySeeder, demoActivityEnabled } from './demo-activity.seeder';
import { SHOWCASE_SCENARIOS_META, ShowcaseScenariosSeeder, showcaseScenariosEnabled } from './showcase-scenarios.seeder';
import { ShowcaseExpansion } from './showcase-expansion';
import { showcaseScale } from '../kernel/showcase-scale';

export const SHOWCASE_FILL_META = 'seed:showcase-fill';
/** 켜는가 — 데모 활동이 켜졌을 때, FF_SHOWCASE_FILL=0이면 끔(메모리 DB 부팅이 차량 회신을 기다리는 시간을 빼고 싶을 때) */
export const showcaseFillEnabled = (env: NodeJS.ProcessEnv = process.env) => demoActivityEnabled(env) && env.FF_SHOWCASE_FILL !== '0';
const who = (persona: string, role: Role, step: string): Actor => ({ id: `usr-${persona}`, role, correlationId: `showcase-fill-${step}` });
/** 시연·e2e가 직접 다루는 차량 — 차단 대상에서 뺀다(ops·p8b·persona-ops 시험이 쓴다) */
const E2E_VEHICLES = new Set(['lead-01', 'KMH-NX4-0001', 'KMH-NX4-0004']);
/** 새 배포 — 아직 정책 게시본이 닿지 않던 적용 범위(미국 NX4 Limited)와 차단 운영 표본용(급가속 억제). 국내 GN7은 시연 주인공(HERO)이 따로 */
const DEPLOYS = [
  { featureId: 'FEAT-00030', version: '1.0.0', flagKey: 'ivi_00030_detail', controlPoint: 'Flag' as const, description: '고속도로 IC·JC 상세 안내 — 미국 NX4 Limited 분기 1 mi 전 표시', cohort: null as number | null },
  { featureId: 'FEAT-00023', version: '1.0.0', flagKey: 'care_00023_limit', controlPoint: 'Flag' as const, description: '급가속 억제 — 페달 급조작 가속 완화 켜기', cohort: null as number | null },
];
/**
 * 시연 주인공(2026-11-06 사용자 결정) — FEAT-00004 고속도로 주행 보조 2, Flag adas_00004_assist(코호트 50% 승인).
 * 첫 판 → 개정판 배포(Canary 5%) → 관측 24 h마다 25%·50% 확대(배포한 출시 담당 ≠ 넓힌 운영 담당) → 적용군 DTC 보고·이상 징후
 * → 단계 축소·적용군 긴급 차단 → 개선 Version 4.1.1(등록 → Flag 코드 PR → 검증 → 승인, 같은 Flag 키) → 재검증 근거로 복원 요청.
 * 배포·확대는 지난 시각(첫 판 = 지금 − 80 h)으로 실제 서비스 경로를 돈다(Clock.at) — 관측 기간 판정이 실제로 통과한다
 */
export const HERO = { featureId: 'FEAT-00004', version: '4.1.0', next: '4.1.1', flagKey: 'adas_00004_assist', cohort: 5000 } as const;
/** 단계 이력(첫 판 작성 기준 시간) — 첫 판 배포 2 h, 개정판 배포 5 h, 25% 확대 30 h, 50% 확대 55 h. 지금은 80 h */
export const HERO_HOURS = { firstDeploy: 2, liveDeploy: 5, to25: 30, to50: 55, now: 80 } as const;
/** 적용군 DTC — Grafana 경보 'Canary 적용군 DTC 증가'(ff_feature_dtc_total 적용군/대조군 상대위험)와 같은 지표 */
export const HERO_SIGNAL = { dtc: 'C1611', relativeRisk: 2.1, metric: 'ff_feature_dtc_total', alert: 'Canary 적용군 DTC 증가' } as const;
const HOUR = 3600_000;
/** 기준 행 연결 — 상세에 '이 행을 쓰는 Feature'가 보이게 초안(PROPOSED) Feature에 포함 행으로 더한다 */
const REF_LINKS = ['CH-BRK-009', 'AD-ADS-001', 'AD-ADS-002', 'AD-ADS-003', 'AD-ADS-005'];

/** 차단 뒤 복원까지 보이는 Version — 분류 확정 전에 SBOM 참조를 적는다(FEAT-00024는 시연 Feature라 전시에서만, 차단 직전에) */
const SBOM_REFS: [string, string][] = [['FEAT-00023', '1.0.0'], ['FEAT-00027', '1.0.0'], ['FEAT-00030', '1.0.0'], ['FEAT-00004', '4.1.0']];

type StepResult = { ok: boolean; note: string };

@Injectable()
export class ShowcaseFillSeeder implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('ShowcaseFill');
  lastRun: Record<string, StepResult> | null = null;
  /** 부팅 훅이 기다리는 전체 실행 — 시험이 기다린다 */
  completion: Promise<Record<string, StepResult> | null> | null = null;
  private stopped = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly moduleRef: ModuleRef,
    private readonly clock: Clock,
  ) {}

  private svc<T>(t: Type<T>): T {
    return this.moduleRef.get(t, { strict: false });
  }

  onApplicationShutdown() {
    this.stopped = true;
  }

  /**
   * 메모리 DB(정적 스냅샷·시험·e2e)는 요청을 받기 전에 끝나야 찍히므로 부팅이 기다린다. 영속 DB(설치본·로컬 데모)는 부팅(readiness)을
   * 막지 않고 이어서 돈다 — 끝나면 meta 'seed:showcase-fill'의 state가 RUNNING에서 바뀐다.
   */
  async onApplicationBootstrap() {
    if (!showcaseFillEnabled()) return;
    this.completion ??= this.run().catch((err: Error) => {
      this.log.warn(`전시 빈 화면 채우기를 건너뜁니다: ${err.message}`);
      return null;
    });
    if (!process.env.FF_DB_URL && (process.env.FF_DB ?? ':memory:').trim() === ':memory:') await this.completion;
  }

  private get waitable() {
    return !this.svc(Scheduler).manual;
  }

  /** 조건이 맞을 때까지 실제 시간으로 기다린다 — 수동 시계면 바로 false */
  private async until(cond: () => boolean, ms: number): Promise<boolean> {
    if (!this.waitable) return cond();
    const end = Date.now() + ms;
    while (!this.stopped && Date.now() < end) {
      if (cond()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return cond();
  }

  /**
   * 데모 활동이 출시 Version의 안전 분류를 확정하기 전에(데모 활동 첫 단계에서 부른다) — 차단·복원 표본에 쓸 Version의
   * SBOM 참조를 분류 초안에 적는다. 복원(넓히는 조치)은 BOM Baseline·SBOM 참조가 있어야 게이트를 통과한다(FFG-PLT-010).
   */
  beforeSafety() {
    const profiles = this.svc(SafetyProfileService);
    const done: string[] = [];
    for (const [featureId, version] of SBOM_REFS) if (this.sbomRef(profiles, featureId, version, 'profiles')) done.push(`${featureId}@${version}`);
    return done.join(', ') || '대상 없음';
  }

  /** 분류 초안에 공급 SW SBOM 참조(가상 시연 URN)를 적는다 — 확정된 분류는 고치지 않는다 */
  private sbomRef(profiles: SafetyProfileService, featureId: string, version: string, step: string) {
    if (!this.svc(FeatureRepo).get(featureId, version)) return false;
    const p = profiles.ensure(featureId, version);
    if (p.status === 'CONFIRMED' || p.sbomRef) return false;
    const h = createHash('sha256').update(`${featureId}@${version}`).digest('hex');
    const urn = `urn:cdx:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}/1`;
    profiles.update(who('quality', 'SAFETY_OFFICER', step), featureId, version, SafetyProfilePatch.parse({ sbomRef: urn }));
    return true;
  }

  async run(): Promise<Record<string, StepResult> | null> {
    await this.svc(DemoActivitySeeder).bootstrapCompletion;
    // 전시 시나리오(Version 184·의존관계·협의)가 먼저 끝나야 그 Feature에 연결한다
    if (showcaseScenariosEnabled()) await this.until(() => !!this.meta(SHOWCASE_SCENARIOS_META)?.enrichmentComplete, 120_000);
    if (this.db.get('SELECT 1 FROM meta WHERE key = ?', SHOWCASE_FILL_META)) return null;
    const claimed = this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', SHOWCASE_FILL_META, JSON.stringify({ at: this.clock.iso(), state: 'RUNNING' }));
    if (!claimed.changes) return null;
    const started = Date.now();
    const out: Record<string, StepResult> = {};
    this.lastRun = out;
    const steps: [string, () => Promise<string> | string][] = [
      ['refdb', () => this.refdb()],
      ['refLinks', () => this.refLinks()],
      ['dependencies', () => this.dependencies()],
      ['analysis', () => this.analysis()],
      ['cost', () => this.cost()],
      ['consults', () => this.consults()],
      ['dataAct', () => this.dataAct()],
      ['changeRecords', () => this.changeRecords()],
      ['field', () => this.field()],
      ['settle', () => this.settle()],
      ['flags', () => this.flags()],
      ['operations', () => this.operations()],
      ['startupReports', () => this.startupReports()],
      ['trialOffers', () => this.trialOffers()],
      // 사후 검증·같은 값의 새 판은 Unleash 반영·근거 변경요청 연결보다 먼저 — 새 판도 반영·연결된다
      ['validations', () => this.validations()],
      ['revisions', () => this.revisions()],
      ['products', () => this.productVersions()],
      ['unleash', () => this.unleashAndCr()],
      ['retention', () => this.retention()],
      // 마지막 — 차량 앱의 Flag 평가 기록(OFREP, IF-11 span). 홈 'Feature 적용 현황'의 실제 사용 단계가 표본을 가진다
      ['evaluations', () => this.evaluations()],
      ['expansion', async () => { const result = new ShowcaseExpansion(this.db, this.moduleRef, this.clock).run(); if (showcaseScale() === 2) await this.svc(ExtSyncService).repairShowcaseRequirements(); return result; }],
    ];
    for (const [name, fn] of steps) {
      if (this.stopped) break;
      try {
        out[name] = { ok: true, note: await fn() };
      } catch (err) {
        out[name] = { ok: false, note: (err as Error).message.slice(0, 300) };
        this.log.warn(`전시 채우기 '${name}' 단계 실패 — 건너뜀: ${(err as Error).message}`);
      }
    }
    if (this.stopped) return out;
    const ms = Date.now() - started;
    this.db.run('UPDATE meta SET value = ? WHERE key = ?', JSON.stringify({ at: this.clock.iso(), ms, steps: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.ok ? v.note : `실패: ${v.note}`])) }), SHOWCASE_FILL_META);
    this.log.log(`전시 빈 화면 채우기 ${Object.values(out).filter((x) => x.ok).length}/${steps.length}단계 (${ms} ms)`);
    if (process.env.FF_SHOWCASE_FILL_LOG === '1') for (const [k, v] of Object.entries(out)) this.log.log(`  ${k}: ${v.note}`);
    return out;
  }

  private meta(key: string): Record<string, any> | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
    return row ? JSON.parse(row.value) : null;
  }

  // ───────────────────────── 1. Feature DB 변경 요청 — 발행됨·발행 대기·반려, 검토 의견 ─────────────────────────
  private refdb() {
    const changes = this.svc(RefdbChangeService);
    const refs = this.svc(RefdbRepository);
    const author = who('author', 'FEATURE_AUTHOR', 'refdb');
    const reviewer = who('approver', 'DOMAIN_REVIEWER', 'refdb');
    const admin = who('steward', 'REFDB_ADMIN', 'refdb');
    // 데모 활동이 만든 검토 요청 하나(AD-ADS-013)에 동의 의견 — 다른 하나(AD-LON-002)는 정적 스냅샷이 보완 의견을 남긴다
    const open = refs.changes({ status: 'REVIEW', refId: 'AD-ADS-013' }).find((c) => !c.reviews.length);
    if (open) changes.review(reviewer, open.changeId, ReviewRefChangeBody.parse({ opinion: 'AGREE', comment: '사내 용어 검색 별칭 — 검출 기능 명칭과 겹치지 않음 확인, 동의' }));
    const request = (refId: string, alias: string, reason: string) => {
      const r = refs.getRef(refId);
      if (!r) throw new Error(`${refId} 기준 행이 없습니다`);
      return changes.create(author, CreateRefChangeBody.parse({ kind: 'MODIFY', refId, after: { aliases: [...r.aliases, alias] }, reason }));
    };
    // 발행됨 — 검토 동의 → 승인 → 발행
    const a = request('AD-ADS-001', '전방 레이더 인지', '사내 사양서 용어(전방 레이더 인지) 검색 보강');
    changes.review(reviewer, a.changeId, ReviewRefChangeBody.parse({ opinion: 'AGREE', comment: '사양서 용어 확인 — 동의' }));
    changes.decide(admin, a.changeId, DecideRefChangeBody.parse({ decision: 'APPROVE', reason: '도메인 검토 동의 — 별칭 추가 승인' }));
    const rel = changes.publish(admin, PublishRefReleaseBody.parse({ changeIds: [a.changeId], note: '전방 인지 별칭 보강 발행' }));
    // 발행 대기 — 승인까지
    const b = request('AD-ADS-002', '전방 카메라 인지', '사내 사양서 용어(전방 카메라 인지) 검색 보강');
    changes.review(reviewer, b.changeId, ReviewRefChangeBody.parse({ opinion: 'AGREE', comment: '카메라 인지 용어 확인 — 동의' }));
    changes.decide(admin, b.changeId, DecideRefChangeBody.parse({ decision: 'APPROVE', reason: '도메인 검토 동의 — 다음 발행에 묶음' }));
    // 반려 — 보완 의견 뒤 반려
    const c = request('AD-ADS-003', '차선 인식', '사내 사양서 용어(차선 인식) 검색 보강');
    changes.review(reviewer, c.changeId, ReviewRefChangeBody.parse({ opinion: 'REVISE', comment: '차선 인식은 차로 유지 보조 행과 겹침 — 별칭 범위 보완 필요' }));
    changes.decide(admin, c.changeId, DecideRefChangeBody.parse({ decision: 'REJECT', reason: '다른 기준 행 별칭과 겹침 — 범위를 좁혀 다시 요청' }));
    return `${open?.changeId ?? '검토 대상 없음'} 의견, ${a.changeId} 발행(${rel.release.release}), ${b.changeId} 발행 대기, ${c.changeId} 반려`;
  }

  /** 초안 Feature에 포함 행 연결 — 전시 초안(가상 전시)을 먼저, 없으면 시드 초안. 시연·e2e Feature는 쓰지 않는다 */
  private refLinks() {
    const features = this.svc(FeatureRepo);
    const registry = this.svc(RegistryService);
    const refs = this.svc(RefdbRepository);
    const author = who('author', 'FEATURE_AUTHOR', 'reflinks');
    const skip = new Set(['FEAT-00013', 'FEAT-00180']);
    const drafts = features
      .all()
      .filter((f) => f.lifecycle === 'PROPOSED' && !skip.has(f.featureId) && f.featureRefs.length)
      .sort((x, y) => Number(y.tags.includes('가상 전시')) - Number(x.tags.includes('가상 전시')) || x.featureId.localeCompare(y.featureId));
    // 목록 첫 화면(기준 행 ID 순 앞 10개)·도메인 목록 첫 행(섀시)·메뉴·감사에서 바로 여는 행 중 아직 쓰는 Feature가 없는 것
    const linkable = refs.listRefs({}).filter((r) => r.status !== 'RETIRED' && r.status !== 'PENDING').sort((x, y) => x.refId.localeCompare(y.refId));
    const firstOf = (prefix: string) => linkable.find((r) => r.refId.startsWith(prefix))?.refId;
    const wanted = [...new Set([...REF_LINKS, ...linkable.slice(0, 10).map((r) => r.refId), firstOf('CH-')].filter((x): x is string => !!x))];
    const targets = wanted.filter((refId) => linkable.some((r) => r.refId === refId) && !refs.linkedFeatures(refId).length);
    if (!drafts.length) return '연결할 초안 없음';
    const plan = new Map<FeatureVersionRow, string[]>();
    targets.forEach((refId, i) => {
      const f = drafts[i % drafts.length];
      plan.set(f, [...(plan.get(f) ?? []), refId]);
    });
    const done: string[] = [];
    for (const [f, add] of plan) {
      registry.updateDraft(author, f.featureId, f.version, UpdateDraftBody.parse({ featureRefs: [...f.featureRefs.map((l) => ({ refId: l.refId, role: l.role })), ...add.map((refId) => ({ refId, role: 'INCLUDED' as const }))] }));
      done.push(`${add.join('·')}→${f.featureId}@${f.version}`);
    }
    return done.join(', ') || '연결할 행 없음';
  }

  /** 시연 Feature(FEAT-00022)를 대상으로 하는 관계 — 같은 적용 범위 초안(BCM 조명 제어)이 차간 거리 단계를 앰비언트 경고에 쓴다 */
  private dependencies() {
    const features = this.svc(FeatureRepo);
    const target = features.get('FEAT-00022', '1.0.0');
    const source = features.get('FEAT-00188', '0.1.0');
    if (!target || !source || source.lifecycle !== 'PROPOSED') return '대상 초안 없음';
    const topology = this.svc(TopologyService);
    if (topology.list({ featureId: target.featureId }).some((d) => d.targetFeatureId === target.featureId)) return '이미 있음';
    const d = topology.create(who('author', 'FEATURE_AUTHOR', 'deps'), CreateDependencyBody.parse({ type: 'REQUIRES', sourceFeatureId: source.featureId, sourceVersion: source.version, targetFeatureId: target.featureId, targetVersion: target.version }));
    return `${d.dependencyId} ${source.featureId}→${target.featureId}`;
  }

  /** 화면에서 바로 가는 대표 Feature — 목록 첫 화면(최신 Version, ID 순 앞 12개)과 시연·메뉴·새 배포 Feature */
  private representative() {
    const latest = new Map<string, FeatureVersionRow>();
    for (const f of this.svc(FeatureRepo).all()) latest.set(f.featureId, f);
    const top = [...latest.values()].sort((a, b) => a.featureId.localeCompare(b.featureId)).slice(0, 12);
    const fixed: [string, string][] = [['FEAT-00022', '1.0.0'], ['FEAT-00023', '1.0.0'], ['FEAT-00024', '1.0.0'], ['FEAT-00027', '1.0.0'], ['FEAT-00030', '1.0.0'], ['FEAT-00145', '5.4.2'], ['FEAT-00145', '5.5.0'], ['FEAT-00001', '2.1.0'], ['FEAT-00288', '0.1.0']];
    const out = new Map(top.map((f) => [`${f.featureId}@${f.version}`, f]));
    for (const [id, ver] of fixed) {
      const f = this.svc(FeatureRepo).get(id, ver);
      if (f) out.set(`${id}@${ver}`, f);
    }
    return [...out.values()];
  }

  // ───────────────────────── 1-2. 분석 근거 — 대표 Feature의 HARA·TARA·SOTIF·인증 영향(이관 기록) ─────────────────────────
  private analysis() {
    const analysis = this.svc(AnalysisEvidenceService);
    const by = { HARA: who('quality', 'SAFETY_OFFICER', 'analysis'), TARA: who('integrator', 'SECURITY_OFFICER', 'analysis'), SOTIF: who('integrator', 'IMPLEMENTER', 'analysis'), HOMOLOGATION: who('steward', 'REGULATORY_OWNER', 'analysis') } as const;
    let n = 0;
    const touched: string[] = [];
    for (const f of this.representative()) {
      const tag = f.featureId.slice(5);
      const asil = (['QM', 'A', 'B', 'C', 'D'].includes(f.asil) ? f.asil : 'QM') as 'QM' | 'A' | 'B' | 'C' | 'D';
      const reason = '기존 안전·보안 문서 이관 — 이 Version 출시 근거';
      const bodies = {
        HARA: HaraBody.parse({ docId: `HARA-${tag}-${f.version}`, asil, safetyGoals: [{ id: `SG-${tag}-01`, text: `${f.name} — 의도하지 않은 작동과 작동 누락을 막는다`, asil }], reason }),
        TARA: TaraBody.parse({ docId: `TARA-${tag}-${f.version}`, threats: [{ id: `TS-${tag}-01`, text: `${f.name} 설정·제어 신호 위·변조`, cal: asil === 'C' || asil === 'D' ? 'CAL3' : 'CAL2' }], reason }),
        SOTIF: SotifBody.parse({ docId: `SOTIF-${tag}-${f.version}`, triggeringConditions: ['센서 시야 제한(악천후·역광·오염)', '도로·표지 인프라가 지도와 다름', '운전자가 기능 한계를 오해해 기대와 다르게 사용'], reason }),
        HOMOLOGATION: HomologationBody.parse(asil === 'QM' ? { regulations: [], decision: 'NO_IMPACT', rxswin: [], reason } : { regulations: ['R155', 'R156'], decision: 'NOTIFY', rxswin: [`RX-${tag}-${f.version.replace(/\./g, '')}`], reason }),
      };
      let any = false;
      for (const kind of ['HARA', 'TARA', 'SOTIF', 'HOMOLOGATION'] as const)
        if (analysis.importRecord(by[kind], kind, f.featureId, f.version, bodies[kind])) (n++, (any = true));
      if (any) touched.push(`${f.featureId}@${f.version}`);
    }
    return `${n}건(${touched.length}개 Version)`;
  }

  // ───────────────────────── 2. SW 개발비 — 승인 이력(승인 뒤 개정해 원래 단계로) ─────────────────────────
  private cost() {
    const cost = this.svc(CostService);
    const viewer = who('viewer', 'COST_ESTIMATOR', 'cost');
    const approver = who('approver', 'COST_APPROVER', 'cost');
    const rows = this.db.all<{ est_id: string; status: string }>("SELECT est_id, status FROM cost_project WHERE status IN ('DRAFT', 'SUBMITTED') ORDER BY est_id");
    const done: string[] = [];
    for (const r of rows) {
      const t = (actor: Actor, action: 'SUBMIT' | 'APPROVE' | 'REVISE', reason: string) => cost.transition(actor, r.est_id, CostTransitionBody.parse({ action, reason }));
      try {
        if (r.status === 'DRAFT') t(viewer, 'SUBMIT', '1차 산정 제출 — 담당 Feature·계수 확인');
        t(approver, 'APPROVE', '1차 산정 승인 — 기준 단가·계수 확인');
        t(viewer, 'REVISE', '사양 변경 반영 — 개정 산정 시작');
        if (r.status === 'SUBMITTED') t(viewer, 'SUBMIT', '개정 산정 재제출');
        done.push(r.est_id);
      } catch (err) {
        this.log.warn(`개발비 ${r.est_id} 승인 이력 건너뜀: ${(err as Error).message}`);
      }
    }
    return `${done.length}/${rows.length}건 승인 이력`;
  }

  // ───────────────────────── 3. 부서 협의 — 열린 협의 일부에 회신 ─────────────────────────
  private consults() {
    const consult = this.svc(ConsultService);
    const items = consult.list({ status: 'OPEN' }).items as { consultId: string; toDept: string; summary: string }[];
    // 전시 시나리오의 협의(열림·회신 섞임)는 그대로 — 기본 협의에 회신하되, 열린 전시 협의가 없는 부서는 첫 건을 받은 건으로 남긴다
    const open = items.filter((c) => !c.summary.startsWith('전시 —')).sort((x, y) => y.consultId.localeCompare(x.consultId));
    const showcaseOpen = new Set(items.filter((c) => c.summary.startsWith('전시 —')).map((c) => c.toDept));
    const lastOf = new Map(open.filter((c) => !showcaseOpen.has(c.toDept)).map((c) => [c.toDept, c.consultId]));
    const answered: string[] = [];
    for (const c of open) {
      if (lastOf.get(c.toDept) === c.consultId) continue;
      const opinion = (['AGREE', 'REVISE'] as const)[answered.length % 2];
      consult.answer(who(`showcase-reviewer-${c.toDept}`, 'AUDITOR', 'consult'), c.consultId, AnswerConsultationBody.parse({ department: c.toDept, opinion, memo: opinion === 'AGREE' ? '담당 범위(구매·법무·개인정보) 검토 — 요청 내용대로 진행해도 됩니다' : '적용 국가별 고지 문구와 계약 조항 근거를 보완해 주세요' }));
      answered.push(c.consultId);
    }
    return `${answered.length}건 회신(${answered.join(', ')}), 받은 건으로 남김 ${lastOf.size}건`;
  }

  // ───────────────────────── 4. EU Data Act — 접근 요청 처리 기록·계약 근거 ─────────────────────────
  private dataAct() {
    const act = this.svc(DataActService);
    const reg = who('steward', 'REGULATORY_OWNER', 'dataact');
    const eu = this.svc(FleetRepo).vehicles().filter((v) => v.country === 'EU').map((v) => v.vin);
    const notEu = this.svc(FleetRepo).vehicles().find((v) => v.country !== 'EU')?.vin;
    if (eu.length < 2) throw new Error('EU 차량이 없습니다');
    const out: string[] = [];
    out.push(act.request(reg, DataAccessRequestBody.parse({ vin: eu[0], requester: 'USER', scope: ['FEATURE_STATE', 'FEATURE_HISTORY'] })).status);
    out.push(act.request(reg, DataAccessRequestBody.parse({ vin: eu[1], requester: 'THIRD_PARTY', thirdParty: { id: 'TP-REPAIR-DE-01', name: '독립 정비 네트워크(독일)' }, userAuthorizationRef: 'AUTH-2026-0412', scope: ['FEATURE_STATE'] })).status);
    // EU 밖 차량 요청은 거부 기록만 남는다(서비스가 거부를 기록하고 GUARD_FAILED)
    if (notEu)
      try {
        act.request(reg, DataAccessRequestBody.parse({ vin: notEu, requester: 'USER' }));
      } catch {
        out.push('REJECTED');
      }
    act.recordContractBasis(reg, ContractBasisBody.parse({ ref: 'DSA-2026-OEM-07', note: '차량 운행 비개인 데이터의 품질 개선 이용 — 사용자 계약 제7조(데이터 이용)' }));
    return `접근 요청 ${out.join('·')}, 계약 근거 1건`;
  }

  // ───────────────────────── 5. 변경 기록 — 검토·정적 분석·시험·커버리지 근거를 갖춘 개정 ─────────────────────────
  private changeRecords() {
    const records = this.svc(ChangeRecordService);
    const integrator = who('integrator', 'IMPLEMENTER', 'change');
    const evidence = (i: number) => ({ review: `MR-41${i} 코드 검토 승인(2인, 가상 시연)`, staticAnalysis: `MISRA-RUN-120${i} 위반 0건(가상 시연)`, tests: `HIL-RUN-87${i} 통과 42/42(가상 시연)`, coverage: { achieved: 85 + i, required: 80 } });
    // 전시 시나리오의 소스 추적 변경(근거 미등록)에 검토·정적 분석·시험·커버리지 근거를 등록한 개정 — 근거 없던 앞 개정은 이력에 남는다
    const showcase = records.list({}).items.filter((c) => c.changeId.startsWith('CHG-SHOWCASE-SOURCE-') && c.findings.length);
    if (showcase.length) {
      for (const [i, c] of showcase.entries())
        records.register(integrator, ChangeRecordBody.parse({ changeId: c.changeId, swId: c.swId, swVersion: c.swVersion, commit: c.commit, summary: `${c.summary} — 검토·정적 분석·시험·커버리지 근거 등록`, aiGenerated: c.aiGenerated, evidence: evidence(i + 1) }));
      return showcase.map((c) => c.changeId).join(', ') + ' 근거 등록 개정';
    }
    // 전시 시나리오가 없으면 근거를 갖춘 변경 기록 하나
    const features = this.svc(FeatureRepo);
    const source = this.db.get<{ commit_id: string }>("SELECT commit_id FROM flag_source_manifest WHERE provenance = 'DEMO' ORDER BY id DESC LIMIT 1");
    const f = features.versions('FEAT-00027').find((x) => x.version === '1.0.0');
    if (!f?.swIds.length || !f.swVersions[0]) throw new Error('변경 기록을 남길 SW가 없습니다');
    const r = records.register(
      integrator,
      ChangeRecordBody.parse({
        changeId: 'CHG-SHOWCASE-EVIDENCE-1',
        swId: f.swIds[0],
        swVersion: f.swVersions[0],
        commit: source?.commit_id ?? '3f9c2a1',
        summary: '가상 시연 — 분기 안내 거리 계산 함수 정리, 검토·정적 분석·시험·커버리지 근거를 함께 등록한 변경',
        aiGenerated: { tool: 'Codex', toolVersion: '가상 시연', scope: 'FF/examples/feature-flag-consumer (가상 소비 예제)' },
        evidence: evidence(0),
      }),
    );
    return `${r.changeId} rev ${r.rev}`;
  }

  // ───────────────────────── 6. 현장 — 기본 차량(ego-01)의 현장 신고가 열린 이상 건(ANM-00001)에 이어진다 ─────────────────────────
  private field() {
    const vehicle = this.svc(FleetRepo).vehicles().find((v) => v.vin === 'ego-01');
    if (!vehicle) return '기본 차량 없음';
    const i = this.svc(IncidentService).create(
      who('operator', 'OPERATOR', 'field'),
      CreateIncidentBody.parse({ source: 'FIELD', vin: 'ego-01', featureId: 'FEAT-00022', category: 'PERFORMANCE', severity: 'WARNING', summary: '앞차 간격 안내 단계가 늦게 바뀜 — 시연 차량 현장 점검 보고(거리 추정 오차 의심)', occurredAt: this.clock.iso() }),
    );
    return `${i.incidentId} ${i.status}${i.anomalyId ? ` → ${i.anomalyId}` : ''}`;
  }

  /** 데모 활동의 개정·되돌리기 요청과 전시 복구 계획이 끝날 때까지 — 그 뒤에 만들어야 정책·게시본·요청 번호가 섞이지 않는다 */
  private async settle() {
    if (!this.waitable) return '수동 시계 — 기다리지 않음';
    const t = Date.now();
    const demo = this.svc(DemoActivitySeeder).continuation;
    if (demo) await Promise.race([demo, new Promise((r) => setTimeout(r, 90_000))]);
    if (showcaseScenariosEnabled()) {
      await this.until(() => !!this.svc(ShowcaseScenariosSeeder).continuation, 5_000);
      const plans = this.svc(ShowcaseScenariosSeeder).continuation;
      if (plans) await Promise.race([plans, new Promise((r) => setTimeout(r, 30_000))]);
    }
    return `${Date.now() - t} ms`;
  }

  // ───────────────────────── 7. Feature Flag — 목록 상위 Feature에 검증한 정책(배포 전) ─────────────────────────
  private async flags() {
    const policies = this.svc(PolicyService);
    const features = this.svc(FeatureRepo);
    const author = who('integrator', 'IMPLEMENTER', 'flags');
    const targets: [string, string, string, string][] = [
      ['FEAT-00001', '2.2.0', 'adas_00001_rspa', '원격 스마트 주차 보조 — 스마트키 원격 출차 켜기(출시 전 검증)'],
      ['FEAT-00145', '5.4.2', 'adas_00145_scc', '스마트 크루즈 컨트롤 — 곡선로 감속 보조 단계 배포 준비'],
      ['FEAT-00002', '1.6.0', 'adas_00002_pca', '주차 충돌방지 보조 — 후방 감지 거리 조정 준비'],
      ['FEAT-00005', '5.5.0', 'adas_00005_scc', '스마트 크루즈 컨트롤 — 정체 구간 재출발 보조 준비'],
      ['FEAT-00144', '3.3.0', 'body_00144_svm', '서라운드 뷰 모니터 — 저속 자동 표시 켜기(출시 전 검증)'],
    ];
    const out: string[] = [];
    for (const [featureId, version, flagKey, description] of targets) {
      const f = features.get(featureId, version);
      if (!f || this.svc(PolicyRepo).byFlag(flagKey).length) continue;
      const asilHigh = f.asil === 'C' || f.asil === 'D';
      const p = policies.create(author, CreatePolicyBody.parse({ featureId, featureVersion: version, controlPoint: 'Flag', flagKey, description, safeDefault: false, ...(asilHigh ? { rollout: { mode: 'COHORT', basisPoints: 1000 } } : {}) }));
      const v = await policies.validate(author, p.policyId);
      out.push(`${p.policyId}(${featureId}@${version}) ${v.policy.status}`);
    }
    return out.join(', ') || '대상 없음';
  }

  // ───────────────────────── 8. 배포 — 비어 있던 적용 범위의 차량에 정책 게시본, 개정판·되돌리기 요청 ─────────────────────────
  private deployed: Record<string, { policyId: string; publicationId: string }> = {};

  private async deployPolicy(d: (typeof DEPLOYS)[number], description: string, step: string) {
    const policies = this.svc(PolicyService);
    const author = who('author', 'FEATURE_AUTHOR', step);
    const p = policies.create(author, CreatePolicyBody.parse({ featureId: d.featureId, featureVersion: d.version, controlPoint: d.controlPoint, flagKey: d.flagKey, description, safeDefault: false, ...(d.cohort ? { rollout: { mode: 'COHORT', basisPoints: d.cohort } } : {}) }));
    const v = await policies.validate(author, p.policyId);
    if (v.run.decision !== 'GO') throw new Error(`${p.policyId} 검증 ${v.run.decision}: ${v.run.reasons.join(' / ')}`);
    policies.decide(who('approver', 'FEATURE_APPROVER', step), p.policyId, PolicyDecisionBody.parse({ decision: 'APPROVE', reason: '8종 검증 GO 확인' }));
    const r = policies.deploy(who('coordinator', 'RELEASE_MANAGER', step), p.policyId, `${description} 배포`);
    return { policyId: p.policyId, publicationId: r.publicationId as string };
  }

  private closed(publicationId: string) {
    const s = this.svc(PublicationRepo).get(publicationId)?.status;
    return s === 'CONFIRMED' || s === 'PARTIAL' || s === 'DIVERGED' || s === 'TIMEOUT';
  }

  private async deploy() {
    if (!this.waitable) return '수동 시계 — 차량 회신을 기다리는 배포는 건너뜀';
    const out: string[] = [];
    for (const d of DEPLOYS) {
      if (!this.svc(FeatureRepo).get(d.featureId, d.version)) continue;
      this.deployed[d.flagKey] = await this.deployPolicy(d, d.description, `deploy-${d.flagKey}`);
      out.push(`${this.deployed[d.flagKey].policyId}(${d.flagKey})`);
    }
    await this.until(() => Object.values(this.deployed).every((x) => this.closed(x.publicationId)), 30_000);
    // Safety Case 경보 기준 — 새로 배포한 Version
    const kpi = this.svc(SafetyKpiService);
    for (const d of DEPLOYS) if (this.deployed[d.flagKey]) kpi.recordPlan(who('quality', 'SAFETY_OFFICER', 'kpi'), d.featureId, d.version, MetricPlanBody.parse({ thresholds: examplePlan(d.featureId, d.version).thresholds }));
    // 개정판 — 차량이 확인한 첫 판이 있으면 고쳐 다시 배포한다. 첫 판이 복구 후보(되돌릴 수 있는 버전)가 된다
    const ok = (id?: string) => !!id && ['CONFIRMED', 'PARTIAL'].includes(this.svc(PublicationRepo).get(id)?.status ?? '');
    const revise: [number, string][] = [
      [0, '고속도로 IC·JC 상세 안내 — 미국 분기 0.8 mi 전 표시, 차로 안내 추가'],
      [1, '급가속 억제 — 저속 구간 가속 완화 기준 조정'],
    ];
    const seconds = await Promise.all(
      revise.filter(([i]) => ok(this.deployed[DEPLOYS[i].flagKey]?.publicationId)).map(async ([i, description]) => [i, await this.deployPolicy(DEPLOYS[i], description, `deploy-r2-${i}`)] as const),
    );
    await this.until(() => seconds.every(([, x]) => this.closed(x.publicationId)), 20_000);
    const rollback = this.svc(RollbackService);
    for (const [i, second] of seconds) {
      const first = this.deployed[DEPLOYS[i].flagKey];
      out.push(`개정 ${second.policyId}`);
      if (i === 0) {
        // 운영자가 첫 판으로 되돌리기를 요청 — 운영 리더 승인 대기
        const r = rollback.requestPolicyRollback(who('operator', 'OPERATOR', 'rollback'), second.policyId, PolicyRollbackBody.parse({ recovery: { policyId: first.policyId }, expectedDeploymentId: second.publicationId, reason: '차로 안내가 출구 직전 혼잡 구간과 겹친다는 현장 의견 — 1 mi 판으로 되돌림 검토', approvers: ['usr-opslead'] }));
        out.push(`되돌리기 ${r.requestId} ${r.status}`);
      }
    }
    return out.join(', ');
  }

  // ───────────────────────── 9. 차단·복원 — 운행 중 감시 지표의 표본, 기본 차량은 차단 유지 ─────────────────────────
  /**
   * 차단 → 차량 비활성화 완료 보고 → 원인 조치 뒤 복원. keep에 든 차량은 복원하지 않고 차단을 유지한다.
   * 차량 회신(상태 보고 v2)이 Safety KPI(적용 지연·미완료 비활성화·on-board 고장 비율)의 표본이 된다.
   */
  private async killAndRestore(featureId: string, version: string, vins: string[], reason: string, keep: string[] = []) {
    const kills = this.svc(KillService);
    const operator = who('operator', 'OPERATOR', `kill-${featureId}`);
    let k = kills.issue(operator, KillCreateBody.parse({ featureId, featureVersion: version, vins, reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', reason, containmentJustification: '현장 조사 중 영향 차량만 봉쇄', confirm: featureId }), { userNoticeRef: `DEMO-${featureId}-NOTICE` });
    k = kills.approve(who('quality', 'SAFETY_OFFICER', `kill-${featureId}`), k.killId, KillApproveBody.parse({ comment: '기능안전 봉쇄 검토 — 비활성화 등급·인계 시간 확인' }));
    k = kills.approve(who('integrator', 'SECURITY_OFFICER', `kill-${featureId}`), k.killId, KillApproveBody.parse({ comment: '사이버보안 봉쇄 검토' }));
    if (k.status !== 'ACTIVE') throw new Error(`${featureId} 차단이 실행되지 않았습니다: ${k.status}`);
    // 차량이 비활성화 단계를 마치고 보고할 때까지(DC2는 경고·인계 → 램프 → 끝)
    const done = () => kills.timeline(k.killId).items.filter((i) => i.deactivate?.completed).length;
    await this.until(() => done() >= vins.length, 30_000);
    const evidence = this.svc(GateRepo).allEvidence().find((e) => e.featureId === featureId && e.inputResult === 'PASS');
    const stage = vins.filter((v) => !keep.includes(v));
    if (!evidence || !stage.length) return `${k.killId} ACTIVE(완료 ${done()}/${vins.length}대, 복원 근거 없음)`;
    const restore = this.svc(RestoreService);
    restore.request(operator, k.killId, RestoreRequestBody.parse({ reason: '원인 조치·재검증 근거 확인 — 복원 요청', evidenceRef: evidence.evidenceRef, cohort: stage }));
    restore.approve(who('safety2', 'SAFETY_OFFICER', `restore-${featureId}`), k.killId, KillApproveBody.parse({ comment: '재검증 근거 확인 — 복원 승인(차단 승인자와 다른 FSM)' }));
    const after = restore.approve(who('opslead', 'OPS_LEAD', `restore-${featureId}`), k.killId, KillApproveBody.parse({ comment: '운영 영향 확인 — 복원 승인' }));
    const pub = after.restoreStages?.at(-1)?.publicationId;
    if (pub) await this.until(() => this.closed(pub), 30_000);
    return `${k.killId} ${after.status}(완료 ${done()}/${vins.length}대, 복원 ${stage.length}대)`;
  }

  /** 적용 범위의 연결된 차량 — 시연·e2e 차량은 뺀다 */
  private onlineIn(featureId: string, version: string, showcaseOnly: boolean) {
    const f = this.svc(FeatureRepo).get(featureId, version);
    if (!f) return [];
    return this.svc(FleetRepo)
      .vehicles()
      .filter((v) => v.country === f.country && v.vehicleModel === f.vehicleModel && v.trim === f.trim && v.link === 'ONLINE' && !E2E_VEHICLES.has(v.vin) && (!showcaseOnly || v.vin.startsWith('SHOWCASE-')))
      .map((v) => v.vin);
  }

  private async safetyCase(deployed: Promise<unknown>) {
    if (!this.waitable) return '수동 시계 — 차량 회신을 기다리는 차단은 건너뜀';
    const jobs: Promise<string>[] = [];
    // 새로 배포하는 Version(FEAT-00023·00030)은 배포·되돌리기 요청이 끝난 뒤에 차단한다(차단 중이면 그 요청이 막힌다). FEAT-00004는 시연 주인공(hero)이 차단한다
    const after = (job: () => Promise<string>) => deployed.then(job);
    // 급가속 억제 — 기본 차량(ego-01)은 차단 유지(현장 화면의 걸린 차단·상태 보고 v2), 나머지는 1단계 복원
    const aas = this.onlineIn('FEAT-00023', '1.0.0', false);
    const cohort = [...aas.filter((v) => v === 'ego-01'), ...aas.filter((v) => v !== 'ego-01' && v !== 'lead-01').slice(0, 5)];
    if (cohort.length >= 2) jobs.push(after(() => this.killAndRestore('FEAT-00023', '1.0.0', cohort, '급가속 억제 오작동 의심(가속 지연 VOC) — 영향 차량 봉쇄 후 원인 조사', ['ego-01'])));
    // 배포 중 Version의 차단 표본 — 전시 차량(가상)만, 모두 복원한다. 시연 Feature의 시연 차량·e2e 차량은 건드리지 않는다
    if (showcaseScenariosEnabled()) {
      const sample: [string, string, string][] = [
        ['FEAT-00022', '1.0.0', '전방 거리 단계 오판정 의심 — 전시 차량 2대 봉쇄 후 재검증'],
        ['FEAT-00024', '1.0.0', '경로 사전안내 표시 오류 의심 — 전시 차량 2대 봉쇄 후 재검증'],
        ['FEAT-00030', '1.0.0', '분기 안내 거리 오류 의심 — 전시 차량 2대 봉쇄 후 재검증'],
      ];
      for (const [id, ver, why] of sample) {
        const vins = this.onlineIn(id, ver, true).slice(-2);
        if (!vins.length) continue;
        if (id === 'FEAT-00024') this.sbomRef(this.svc(SafetyProfileService), id, ver, 'kill');
        jobs.push(id === 'FEAT-00030' ? after(() => this.killAndRestore(id, ver, vins, why)) : this.killAndRestore(id, ver, vins, why));
      }
      const demo = this.onlineIn('FEAT-00027', '1.0.0', true).slice(-2);
      if (demo.length) jobs.push(this.killAndRestore('FEAT-00027', '1.0.0', demo, '상세 안내 표시 지연 의심 — 전시 차량 2대 봉쇄 후 재검증'));
    }
    const settled = await Promise.allSettled(jobs);
    return settled.map((r) => (r.status === 'fulfilled' ? r.value : `실패: ${(r.reason as Error).message}`)).join(', ');
  }

  /** 배포(개정·되돌리기 요청)·차단·복원·시연 주인공은 차량 회신을 기다리므로 함께 돌린다 */
  private async operations() {
    const deploy0 = this.deploy();
    const [deploy, kills, hero] = await Promise.allSettled([deploy0, this.safetyCase(deploy0.catch(() => undefined)), this.hero()]);
    const note = (r: PromiseSettledResult<string>) => (r.status === 'fulfilled' ? r.value : `실패: ${(r.reason as Error).message}`);
    if (deploy.status === 'rejected' && kills.status === 'rejected') throw deploy.reason;
    if (hero.status === 'rejected') throw new Error(`주인공 실패: ${(hero.reason as Error).message} / 배포: ${note(deploy)} / 차단: ${note(kills)}`);
    return `배포: ${note(deploy)} / 차단: ${note(kills)} / 주인공: ${note(hero)}`;
  }

  // ───────────────────────── 8-2. 시연 주인공 — adas_00004_assist 단계 배포·문제 감지·긴급 차단·개선 Version ─────────────────────────
  /** 지난 시각 h(첫 판 작성 기준 시간)에 동기 작업 하나 */
  private heroAt<T>(t0: number, h: number, fn: () => T): T {
    return this.clock.at(new Date(t0 + h * HOUR), fn);
  }

  /** 작성 → 8종 검증(GO여야) → 승인(작성자와 다른 사람) → 배포(출시 담당). t0가 있으면 그 시각부터(h, h+0.25, h+1, h+2), 없으면 지금. deploy=false면 승인까지 */
  private async heroPolicy(version: string, description: string, opts: { t0?: number; h?: number; deploy: boolean }) {
    const policies = this.svc(PolicyService);
    const step = `hero-${version}-${opts.h ?? 'now'}`;
    const author = who('author', 'FEATURE_AUTHOR', step);
    const at = <T>(dh: number, fn: () => T): T => (opts.t0 === undefined ? fn() : this.heroAt(opts.t0, (opts.h ?? 0) + dh, fn));
    const p = at(0, () => policies.create(author, CreatePolicyBody.parse({ featureId: HERO.featureId, featureVersion: version, controlPoint: 'Flag', flagKey: HERO.flagKey, description, safeDefault: false, rollout: { mode: 'COHORT', basisPoints: HERO.cohort } })));
    // 검증은 시작 시각에 기록된다(검증기는 입출력 없이 끝난다) — 지난 시각에서 시작한다
    let pending!: ReturnType<PolicyService['validate']>;
    at(0.25, () => void (pending = policies.validate(author, p.policyId)));
    const v = await pending;
    if (v.run.decision !== 'GO') throw new Error(`${p.policyId} 검증 ${v.run.decision}: ${v.run.reasons.join(' / ')}`);
    at(1, () => policies.decide(who('approver', 'FEATURE_APPROVER', step), p.policyId, PolicyDecisionBody.parse({ decision: 'APPROVE', reason: '8종 검증 GO·Safe Default OFF·코호트 50% 승인 범위 확인' })));
    if (!opts.deploy) return { policyId: p.policyId, publicationId: null as string | null };
    const r = at(2, () => policies.deploy(who('coordinator', 'RELEASE_MANAGER', step), p.policyId, `${description} 배포`));
    return { policyId: p.policyId, publicationId: r.publicationId as string | null };
  }

  /**
   * 시연 주인공(HERO) — 기본 시드·전시(FF_SHOWCASE=1) 모두 같은 순서·같은 사람으로 돈다. 수동 시계(시험)에서도 돈다 — 차량 회신을 기다리는
   * 단계는 바로 넘어가고(게시본은 회신 대기로 남는다), 첫 판 확인이 필요한 자동 되돌리기 계획만 건너뛴다.
   * 결과: 개정판(DEPLOYED, 단계 50% → 5% 축소, 승인 50%)·단계 이력 3건·이상 징후(조치됨, 차단 연결)·적용군 긴급 차단(ACTIVE, 복원 승인 대기)
   * ·개선 Version 4.1.1(APPROVED)과 같은 Flag의 정책(APPROVED, 재배포 대기)·구현 MR
   */
  private async hero() {
    const features = this.svc(FeatureRepo);
    const f = features.get(HERO.featureId, HERO.version);
    if (!f) return '대상 Feature 없음';
    if (this.svc(PolicyRepo).byFlag(HERO.flagKey).length) return '이미 있음';
    const t0 = this.clock.now().getTime() - HERO_HOURS.now * HOUR;
    const out: string[] = [];
    // ① 첫 판 → 개정판 — 개정판 배포가 Canary 5%에서 시작한다(F2 이상, FFG-LCY-009). 첫 판은 복구 후보로 남는다
    const first = await this.heroPolicy(HERO.version, '고속도로 주행 보조 2 — GN7 Calligraphy 코호트 50% 단계 배포', { t0, h: HERO_HOURS.firstDeploy - 2, deploy: true });
    await this.until(() => this.closed(first.publicationId!), 30_000);
    const live = await this.heroPolicy(HERO.version, '고속도로 주행 보조 2 — 차로 변경 보조 경고 표시 정리(코호트 50% 승인 유지)', { t0, h: HERO_HOURS.liveDeploy - 2, deploy: true });
    await this.until(() => this.closed(live.publicationId!), 30_000);
    this.deployed[HERO.flagKey] = { policyId: live.policyId, publicationId: live.publicationId! };
    out.push(`${first.policyId}→${live.policyId}(${live.publicationId}) Canary ${(this.svc(PolicyRepo).get(live.policyId)?.stageBasisPoints ?? 0) / 100}%`);
    // 배포 직후 — 자동 되돌리기 계획(배포 실패율 20%, 운영 리더 승인 대기)·Safety Case 경보 기준
    this.heroAt(t0, HERO_HOURS.liveDeploy + 1, () => this.svc(SafetyKpiService).recordPlan(who('quality', 'SAFETY_OFFICER', 'hero-kpi'), HERO.featureId, HERO.version, MetricPlanBody.parse({ thresholds: examplePlan(HERO.featureId, HERO.version).thresholds })));
    if (this.waitable) {
      const plan = this.heroAt(t0, HERO_HOURS.liveDeploy + 1, () => this.svc(RollbackService).createPlan(who('operator', 'OPERATOR', 'hero-plan'), CreateRollbackPlanBody.parse({ deploymentId: live.publicationId!, targetTypes: ['POLICY_VERSION'], recovery: { policyId: first.policyId }, conditions: { failureRate: { thresholdPercent: 20 } }, scope: { featureIds: [HERO.featureId] }, approvers: ['usr-opslead'], note: '코호트 차량의 배포 실패율이 20%를 넘으면 첫 판으로 되돌림 — 승인 대기' })));
      out.push(`계획 ${plan.planId} ${plan.status}`);
    }
    // ② 단계 확대 — 관측 24 h·중단 기준(열린 이상 징후·진행 중 차단) 판정을 실제로 거친다. 넓히는 사람(운영) ≠ 배포한 사람(출시)
    const rollout = this.svc(StagedRolloutService);
    const ops = who('operator', 'OPERATOR', 'hero-stage');
    this.heroAt(t0, HERO_HOURS.to25, () => rollout.stage(ops, live.policyId, RolloutStageBody.parse({ basisPoints: 2500, reason: 'Canary 5% 관측 24시간 — 적용군 DTC·오류·폴백 상대위험이 중단 기준 아래, 25%로 확대' })));
    this.heroAt(t0, HERO_HOURS.to50, () => rollout.stage(ops, live.policyId, RolloutStageBody.parse({ basisPoints: HERO.cohort, reason: '25% 관측 24시간 — 중단 기준 아래, 승인 범위 50%까지 확대' })));
    out.push('단계 5%→25%→50%');
    // ③ 문제 감지 — 50% 적용군 차량이 차로 변경 시작 지연 DTC를 보고(차량 요청 관문) → 이상 징후. Grafana 경보와 같은 지표
    const policy = this.svc(PolicyRepo).get(live.policyId)!;
    const fleet = this.svc(FleetRepo);
    const scope = fleet.vehicles().filter((v) => v.country === f.country && v.vehicleModel === f.vehicleModel && v.trim === f.trim && !E2E_VEHICLES.has(v.vin));
    const cohort: typeof scope = [];
    for (const v of scope) if ((await cohortBucket('1', HERO.flagKey, policy.rollout.salt ?? 'FF-COHORT-SALT-1', v.vin)) < HERO.cohort) cohort.push(v);
    const online = cohort.filter((v) => v.link === 'ONLINE');
    if (!online.length) throw new Error('적용군(50%) 연결 차량이 없습니다');
    const requestRepo = this.svc(VehicleRequestRepo);
    const reporters = online.filter((v) => !requestRepo.cursor(v.vin)).slice(0, 3);
    const requests = this.svc(VehicleRequestService);
    const res = { setHeader() { return this; } } as unknown as Response;
    const detail = `차로 변경 시작 지연 DTC ${HERO_SIGNAL.dtc} — Grafana 경보 '${HERO_SIGNAL.alert}'(${HERO_SIGNAL.metric} 적용군/대조군 상대위험 ${HERO_SIGNAL.relativeRisk})`;
    for (const [i, v] of reporters.entries())
      await requests.report({ id: `vehicle:${v.vin}`, role: 'VEHICLE', correlationId: 'showcase-fill-hero-fault' }, v.vin, VehicleReportBody.parse({ type: 'FAULT', bootId: `BOOT-${v.vin}-ADAS`, sequence: 1, observedAt: this.clock.iso(), featureId: HERO.featureId, code: HERO_SIGNAL.dtc, severity: i === 0 ? 'CRITICAL' : 'WARNING', detail }), res);
    const anomalies = this.svc(AnomalyService);
    const openAnomaly = () => anomalies.list({ featureId: HERO.featureId, kind: 'FEATURE_FAULT', status: 'OPEN' })[0];
    await this.until(() => !!openAnomaly(), 5_000);
    const anomaly = openAnomaly();
    if (!anomaly) throw new Error('적용군 DTC 보고가 이상 징후로 이어지지 않았습니다');
    out.push(`${anomaly.anomalyId} ${anomaly.severity}/${anomaly.advice}(${reporters.length}대 보고)`);
    // ④ 조치 — 단계 축소(50% → 5%, 줄이기는 판정 없이) → 적용군 긴급 차단(이상 건 연결, 2인 승인). 오프라인 적용군 차량은 반영 대기로 남는다
    rollout.stage(ops, live.policyId, RolloutStageBody.parse({ basisPoints: 500, reason: `${anomaly.anomalyId} 적용군 DTC 상대위험 ${HERO_SIGNAL.relativeRisk} — 중단 기준 충족, Canary 5%로 축소` }));
    const kills = this.svc(KillService);
    const operator = who('operator', 'OPERATOR', 'hero-kill');
    const targets = [...online.slice(0, 22), ...cohort.filter((v) => v.link !== 'ONLINE').slice(0, 2)].map((v) => v.vin);
    let k = kills.issue(operator, KillCreateBody.parse({ featureId: HERO.featureId, featureVersion: HERO.version, vins: targets, reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', reason: `적용군 차로 변경 시작 지연 DTC 증가(상대위험 ${HERO_SIGNAL.relativeRisk}) — 50% 적용군 차량 봉쇄 후 원인 조치`, containmentJustification: 'Canary 적용군에서만 DTC 증가 — 적용군 차량만 봉쇄', confirm: HERO.featureId, anomalyId: anomaly.anomalyId }), { userNoticeRef: `DEMO-${HERO.featureId}-NOTICE` });
    k = kills.approve(who('quality', 'SAFETY_OFFICER', 'hero-kill'), k.killId, KillApproveBody.parse({ comment: '기능안전 봉쇄 검토 — DTC 보고 차량·적용군 범위 확인' }));
    k = kills.approve(who('integrator', 'SECURITY_OFFICER', 'hero-kill'), k.killId, KillApproveBody.parse({ comment: '사이버보안 봉쇄 검토' }));
    if (k.status !== 'ACTIVE') throw new Error(`주인공 차단이 실행되지 않았습니다: ${k.status}`);
    const reached = targets.filter((v) => online.some((o) => o.vin === v)).length;
    const done = () => kills.timeline(k.killId).items.filter((i) => i.deactivate?.completed).length;
    await this.until(() => done() >= reached, 30_000);
    out.push(`${k.killId} ACTIVE(반영 ${done()}/${targets.length}대)`);
    // ⑤ 개선 Version 4.1.1 — 등록 → 분류·분석 → Gate G1~G3 → 정의 승인, 같은 Flag 키(같은 Feature의 다음 Version — 키 재사용 아님)
    const author = who('author', 'FEATURE_AUTHOR', 'hero-v411');
    const fsm = who('quality', 'SAFETY_OFFICER', 'hero-v411');
    const created = this.svc(RegistryService).createVersion(author, HERO.featureId, CreateVersionBody.parse({ baseVersion: HERO.version, bump: 'patch', reason: `${anomaly.anomalyId}·${k.killId} 원인 조치 — 차로 변경 시작 지연 단축 보정`, changes: { description: `${f.description ?? f.name} — 차로 변경 시작 지연 단축 보정(${HERO_SIGNAL.dtc} 원인 조치)` } }));
    const ver = created.feature.version;
    const profiles = this.svc(SafetyProfileService);
    this.sbomRef(profiles, HERO.featureId, ver, 'hero-v411');
    profiles.confirm(fsm, HERO.featureId, ver, '이전 Version 분류 이어받음 — 차로 변경 시작 지연 보정, 안전 목표 변경 없음 확인');
    const analysis = this.svc(AnalysisEvidenceService);
    const asil = (['QM', 'A', 'B', 'C', 'D'].includes(f.asil) ? f.asil : 'C') as 'QM' | 'A' | 'B' | 'C' | 'D';
    const tag = `${HERO.featureId.slice(5)}-${ver.replace(/\./g, '')}`;
    analysis.record(fsm, 'HARA', HERO.featureId, ver, HaraBody.parse({ docId: `HARA-${tag}`, asil, safetyGoals: [{ id: `SG-${tag}-01`, text: '차로 변경 보조의 의도하지 않은 지연·작동 누락을 막는다', asil }], reason: '보정 Version 영향 HARA 재검토' }));
    if (analysis.view(HERO.featureId, ver).security.relevant)
      analysis.record(who('integrator', 'SECURITY_OFFICER', 'hero-v411'), 'TARA', HERO.featureId, ver, TaraBody.parse({ docId: `TARA-${tag}`, threats: [{ id: `TS-${tag}-01`, text: '차로 변경 보조 설정 값 위·변조', cal: 'CAL3' }], reason: '보정 Version 영향 TARA 재검토' }));
    const judge = who('quality', 'GATE_JUDGE', 'hero-v411');
    const evidence = (g: string) => `EV-ADAS-${tag}-${g}`;
    const rationale: Record<'G1' | 'G2' | 'G3', string> = { G1: '보정 요구사항·적용 범위 확인 — 같은 Flag 키 계승', G2: 'HARA·TARA 재검토 — 안전 목표 변경 없음', G3: `HIL·가상검증 재실행 — ${HERO_SIGNAL.dtc} 재현 시나리오 PASS` };
    for (const g of ['G1', 'G2', 'G3'] as const) this.svc(GateService).judge(judge, HERO.featureId, ver, JudgeGateBody.parse({ gate: g, inputResult: 'PASS', rationale: rationale[g], evidenceRef: evidence(g), asilReasonReviewed: true }));
    this.svc(LifecycleService).transition(who('approver', 'FEATURE_APPROVER', 'hero-v411'), HERO.featureId, ver, 'APPROVED', '원인 조치 Version 정의 승인 — Gate G1~G3 PASS 확인');
    // 정의 승인 뒤 개발 착수(Control Point가 있으면 자동) — Control Gate(G4): Safe Default OFF·되돌리기·긴급 차단 경로 근거. 정책 '안전 동작 검증'이 본다
    if (features.get(HERO.featureId, ver)?.lifecycle === 'APPROVED') this.svc(LifecycleService).transition(who('coordinator', 'RELEASE_MANAGER', 'hero-v411'), HERO.featureId, ver, 'DEVELOPING', '보정 구현 착수');
    // 검증 — Control(G4)·Verification(G5, 시험 Evidence)·Supplier(G6)·Safety/Security(G7, ASIL C). 정책 8종 검증이 이 판정을 본다
    const verify: Record<'G4' | 'G5' | 'G6' | 'G7', string> = {
      G4: 'Safe Default OFF·첫 판 되돌리기·긴급 차단 경로 HIL 시험 PASS',
      G5: `차로 변경 시작 지연 회귀 시험 PASS(${HERO_SIGNAL.dtc} 재현 시나리오 포함)`,
      G6: '협력사 보정 SW 납품·형상 확인',
      G7: '기능안전·사이버보안 영향 검토 — 안전 목표·위협 변경 없음',
    };
    for (const g of ['G4', 'G5', 'G6', 'G7'] as const) {
      if (g === 'G6') ensureShowcaseSupplierEvidence(this.db, this.moduleRef, features.get(HERO.featureId, ver)!, who('integrator', 'IMPLEMENTER', 'hero-supplier'), judge);
      // G7은 Safety Manager·CSM 두 사람의 서명(지금의 HARA·TARA에 묶인다)이 먼저다
      if (g === 'G7') {
        analysis.signG7(fsm, 'SAFETY_OFFICER', HERO.featureId, ver, '보정 Version 기능안전 영향 검토 — 안전 목표 변경 없음');
        analysis.signG7(who('integrator', 'SECURITY_OFFICER', 'hero-v411'), 'SECURITY_OFFICER', HERO.featureId, ver, '보정 Version 사이버보안 영향 검토 — 위협 변경 없음');
      }
      this.svc(GateService).judge(judge, HERO.featureId, ver, JudgeGateBody.parse({ gate: g, inputResult: 'PASS', rationale: verify[g], evidenceRef: evidence(g), asilReasonReviewed: true }));
    }
    out.push(`${HERO.featureId}@${ver} ${features.get(HERO.featureId, ver)?.lifecycle}`);
    // Flag 코드 PR — 같은 Flag 호출 뒤의 보정 코드(모의 GitLab MR, 제목의 Feature@Version으로 연결)
    try {
      await this.svc(ExtSyncService).mockCreate('GITLAB', MockExtCreateBody.parse({ kind: 'MERGE_REQUEST', title: `feat(${HERO.featureId}@${ver}): ${HERO.flagKey} 차로 변경 시작 지연 보정`, body: `Flag ${HERO.flagKey} 호출 유지(Safe Default OFF) — 차로 변경 시작 지연 단축 보정. 같은 Flag 뒤에서 Canary 5%부터 다시 배포`, externalUser: 'lee.dev' }));
      out.push('구현 MR');
    } catch (err) {
      this.log.warn(`주인공 구현 MR 건너뜀: ${(err as Error).message}`);
    }
    // 같은 Flag의 4.1.1 정책 — 검증 → 승인(재배포 대기). 배포는 시연자가 한다(Canary 5%부터)
    const next = await this.heroPolicy(ver, '고속도로 주행 보조 2 — 차로 변경 시작 지연 단축 보정(코호트 50% 승인, Canary부터 재배포)', { deploy: false });
    out.push(`${next.policyId} ${this.svc(PolicyRepo).get(next.policyId)?.status}`);
    // ⑥ 복원 요청 — 4.1.1 재검증 근거(G3 PASS)로 적용군 Canary 1대부터(Safety Manager·운영 리더 승인 대기)
    const r = this.svc(RestoreService).request(operator, k.killId, RestoreRequestBody.parse({ reason: `${ver} 재검증 PASS — 적용군 Canary 1대부터 복원`, evidenceRef: evidence('G5'), cohort: targets.slice(0, 1) }));
    out.push(`복원 요청 ${(r as { restoreRequest?: { status?: string } | null }).restoreRequest?.status ?? '-'}`);
    return out.join(', ');
  }

  /** 시동 상태 보고 — 정책 게시본을 받은 차량마다(차단·복원 뒤 상태 그대로) 상태 보고 v2가 쌓인다 */
  private startupReports() {
    const runtime = this.svc(VehicleRuntimeService);
    let vehicles = 0;
    let reports = 0;
    for (const v of this.svc(FleetRepo).vehicles()) {
      const n = runtime.startupReport(v.vin);
      if (n) (vehicles++, (reports += n));
    }
    return `${vehicles}대 ${reports}건`;
  }

  /**
   * 체험 제안 — 사용 권한이 하나도 없는 전시 차량(가상)에 지원되는 출시 상품의 체험을 제안한다(제안 상태, 수락 전).
   * 시연 차량·등록 차량(체험 미가입 차량 시연 포함)은 그대로 둔다.
   */
  private trialOffers() {
    if (!showcaseScenariosEnabled()) return '전시 차량 없음';
    const ent = this.svc(EntitlementService);
    const fleet = this.svc(FleetRepo);
    let left = fleet.vehicles().filter((v) => v.vin.startsWith('SHOWCASE-') && !fleet.grants(v.vin).length).map((v) => v.vin);
    const total = left.length;
    const catalogs = [...new Set(this.svc(ProductRepo).all().filter((p) => p.lifecycle === 'RELEASED').map((p) => p.catalogId))];
    const ops = who('operator', 'OPERATOR', 'trial-offer');
    for (const catalogId of catalogs) {
      if (!left.length) break;
      const batch = [...left];
      const done = new Set<string>();
      for (let i = 0; i < batch.length; i += 200)
        for (const g of ent.offer(ops, OfferTrialsBody.parse({ catalogId, vins: batch.slice(i, i + 200), note: '전시 — 지원 상품 체험 제안' })).offered) done.add(g.vin);
      left = left.filter((v) => !done.has(v));
    }
    return `${total - left.length}/${total}대 체험 제안`;
  }

  // ───────────────────────── 10. Unleash 반영·근거 변경요청 — 배포 중 정책 ─────────────────────────
  private async unleashAndCr() {
    if (!this.waitable) return '수동 시계 — 건너뜀';
    const repo = this.svc(PolicyRepo);
    const unleash = this.svc(UnleashSyncService);
    const ext = this.svc(ExtSyncService);
    const links = this.svc(ExtSyncRepo);
    const deployed = repo.all().filter((p) => p.status === 'DEPLOYED');
    const release = who('coordinator', 'RELEASE_MANAGER', 'unleash');
    let synced = 0;
    for (const p of deployed)
      try {
        await unleash.sync(release, p.policyId);
        synced++;
      } catch (err) {
        this.log.warn(`Unleash 반영 ${p.policyId} 건너뜀: ${(err as Error).message}`);
      }
    // 근거 변경요청 — 연결이 없는 정책마다 JIRA 변경요청을 만들어 잇는다(모의 연결일 때만). Feature 연계 탭의 정책 행도 근거가 보인다
    let linked = 0;
    for (const p of repo.all()) {
      if (links.linksOf('POLICY', p.policyId).some((l) => l.kind === 'CHANGE_REQUEST')) continue;
      try {
        const cr = await ext.mockCreate('JIRA', MockExtCreateBody.parse({ kind: 'CHANGE_REQUEST', title: `[${p.featureId}@${p.featureVersion}] ${p.flagKey} 정책 변경요청`, body: `${p.description} — 정책 근거 변경요청`, externalUser: 'park.release' }));
        await ext.linkChangeRequest(release, p.policyId, cr.item.key);
        linked++;
      } catch (err) {
        this.log.warn(`근거 변경요청 ${p.policyId} 건너뜀: ${(err as Error).message}`);
        break;
      }
    }
    // 코드(GitLab) — 대표 Feature Version 중 MR이 없는 것에 구현 MR(열림)을 올린다. 제목의 Feature@Version으로 연결된다
    let mrs = 0;
    for (const f of this.representative()) {
      const key = `${f.featureId}@${f.version}`;
      if (links.linksOf('FEATURE', key, 'GITLAB').some((l) => l.kind === 'MERGE_REQUEST')) continue;
      try {
        await ext.mockCreate('GITLAB', MockExtCreateBody.parse({ kind: 'MERGE_REQUEST', title: `feat(${key}): ${f.name} 구현`, body: `${f.name} — 정책 연동·설정 값 반영`, externalUser: 'lee.dev' }));
        mrs++;
      } catch (err) {
        this.log.warn(`구현 MR ${key} 건너뜀: ${(err as Error).message}`);
        break;
      }
    }
    return `Unleash ${synced}/${deployed.length}, 변경요청 연결 ${linked}, 구현 MR ${mrs}`;
  }

  // ───────────────────────── 13. 사후 검증 — 검증 기록 없이 배포 상태로 들어온 시드 정책 ─────────────────────────
  /**
   * 정책 상세 '분야별 검증 8종'이 비던 시드 정책(커널 시드가 배포 상태로 넣음)에 같은 8종 검증기로 검증 기록을 남긴다.
   * 가상검증 대상 Feature는 실행기가 있으면(정적 스냅샷·e2e의 시험 대역 포함) 현재 정책 내용으로 먼저 돌린다 — 없으면 검증이 보류로 남는다.
   * 정책 값·차량 게시본은 바꾸지 않는다
   */
  private async validations() {
    const policies = this.svc(PolicyService);
    const runs = this.svc(VirtualRunRepo);
    const author = who('author', 'FEATURE_AUTHOR', 'validations');
    const carla = this.svc(CarlaAdapter).installed === null;
    const out: string[] = [];
    for (const p of this.svc(PolicyRepo).all().filter((x) => x.status === 'DEPLOYED' && !policies.detail(x.policyId).lastRun)) {
      if (carla && virtualScenariosFor(p.featureId).length && !runs.list({ policyId: p.policyId }).length) await this.svc(VirtualValidationService).run(author, RunVirtualBody.parse({ policyId: p.policyId }));
      const run = await policies.recordMissingValidation(author, p.policyId);
      out.push(`${p.policyId} ${run.decision}`);
    }
    return out.join(', ') || '대상 없음';
  }

  // ───────────────────────── 13-2. Flag 평가 기록 — 차량 앱이 배포 Flag를 OFREP로 평가(IF-11 span, 가명 subject) ─────────────────────────
  /**
   * 홈 'Feature 적용 현황'의 실제 사용 단계는 차량 소프트웨어의 Flag 평가 기록(feature_flag.evaluation span)으로 센다 — 기록이 없으면 비어 보인다.
   * 배포 Flag마다 적용 범위의 연결 차량(그 Flag 꾸러미를 받은 차량 먼저) 12대가 OFREP 평가 API를 부른다. F2 이상은 서버가 DISABLED로 답해도 평가 1건이다
   */
  private async evaluations() {
    const ofrep = this.svc(OfrepService);
    const features = this.svc(FeatureRepo);
    const runtime = (await this.svc(VehicleRuntimeService).fleetStatus()).items as { vin: string; flags: { flagKey: string; publicationId: string | null }[] }[];
    const holds = new Map(runtime.map((r) => [r.vin, new Set(r.flags.filter((f) => f.publicationId).map((f) => f.flagKey))]));
    const vehicles = this.svc(FleetRepo).vehicles().filter((v) => v.link === 'ONLINE' && !E2E_VEHICLES.has(v.vin));
    let n = 0;
    const flags: string[] = [];
    for (const p of this.svc(PolicyRepo).all().filter((x) => x.status === 'DEPLOYED').sort((a, b) => a.flagKey.localeCompare(b.flagKey))) {
      const f = features.get(p.featureId, p.featureVersion);
      if (!f) continue;
      const scope = vehicles.filter((v) => v.country === f.country && v.vehicleModel === f.vehicleModel && v.trim === f.trim);
      const pick = [...scope.filter((v) => holds.get(v.vin)?.has(p.flagKey)), ...scope.filter((v) => !holds.get(v.vin)?.has(p.flagKey))].slice(0, 12 * showcaseScale());
      for (const v of pick) {
        await ofrep.one(p.flagKey, { context: { targetingKey: vehiclePseudonym(v.vin) } });
        n++;
      }
      if (pick.length) flags.push(p.flagKey);
    }
    return `${flags.length}개 Flag 평가 ${n}건`;
  }

  // ───────────────────────── 14. 보존·삭제 — 보존 기간(30일)이 지난 차량 발신 기록을 실제 보존 작업이 지운다 ─────────────────────────
  /**
   * 데이터·규제 기록 '삭제 기록'이 비던 것 — 새 설치에는 기간이 지난 행이 없다. 열린 Incident·이상 건에 묶이지 않은 차량이 40일 전에 보낸
   * 순서 어긋난 보고(같은 부팅의 더 낮은 순번 — 차량 요청 관문이 거부 기록을 남긴다)를 그 시각으로 받고, 보존 작업(sweep)이 지운 기록을 남긴다
   */
  private async retention() {
    const requests = this.svc(VehicleRequestService);
    const retention = this.svc(RetentionService);
    const holds = retention.holds();
    const vin = this.svc(FleetRepo)
      .vehicles()
      .map((v) => v.vin)
      .find((v) => !E2E_VEHICLES.has(v) && !holds.vehicles.has(v) && !this.svc(VehicleRequestRepo).cursor(v));
    if (!vin) return '대상 차량 없음';
    const vehicle: Actor = { id: `vehicle:${vin}`, role: 'VEHICLE', correlationId: 'showcase-fill-retention' };
    const res = { setHeader() { return this; } } as unknown as Response;
    const bootId = `BOOT-${vin}-RETENTION`;
    await requests.report(vehicle, vin, VehicleReportBody.parse({ type: 'HELLO', bootId, sequence: 2, observedAt: this.clock.iso() }), res);
    // 거부는 첫 대기 전에 동기로 기록된다 — 그 동기 구간만 40일 전 시각으로 돈다
    const past = new Date(this.clock.now().getTime() - 40 * 24 * 3600_000);
    let stale: Promise<unknown> = Promise.resolve();
    this.clock.at(past, () => void (stale = requests.report(vehicle, vin, VehicleReportBody.parse({ type: 'HELLO', bootId, sequence: 1, observedAt: past.toISOString() }), res)));
    await stale.then(
      () => {
        throw new Error('순서 어긋난 보고가 거부되지 않았습니다');
      },
      () => undefined,
    );
    const r = retention.sweep(who('steward', 'REGULATORY_OWNER', 'retention'));
    const swept = r.stores.find((x) => x.store === 'vehicle_request');
    if (!swept?.deleted) throw new Error(`보존 기간이 지난 차량 발신 기록을 지우지 못했습니다: ${JSON.stringify(r.stores)}`);
    return `${vin} 기간 지난 보고 ${swept.deleted}건 삭제(남김 ${swept.held})`;
  }

  // ───────────────────────── 15. 같은 값의 새 판 — 되돌릴 버전이 없던 배포 Flag ─────────────────────────
  /**
   * 정책 상세 '진행 중인 되돌리기'·롤백 '복구 가능한 버전'이 비던 배포 Flag(커널 시드·데모 활동의 첫 배포) — 차량 값이 같은 새 판(설명만 다름)을
   * 실제 경로(작성 → 8종 검증 → 승인 → 배포, 차량 회신)로 배포해 앞 판을 복구 후보로 만들고, 운영자가 앞 판으로 되돌리기를 요청해 운영 리더 승인 대기로 둔다.
   * 정책 값은 그대로이고 게시본은 새 판의 것이 된다. 가상검증 대상 Feature는 실행기가 있으면 새 판으로 먼저 돌린다.
   * 안전 관련(F2 이상) Flag는 새 판도 Canary 단계(≤ 5%)에서 시작한다(FFG-LCY-009, 2026-11-06 사용자 결정 — 단계 그대로 시연):
   * 단계 밖 차량은 관측 기간(24 h)·중단 기준을 거쳐 다른 사람이 넓힐 때까지 OFF(대상 밖)다
   */
  private async revisions() {
    if (!this.waitable) return '수동 시계 — 차량 회신을 기다리는 배포는 건너뜀';
    const policies = this.svc(PolicyService);
    const rollback = this.svc(RollbackService);
    const carla = this.svc(CarlaAdapter).installed === null;
    const mine = new Set(Object.values(this.deployed).map((d) => d.policyId));
    const profiles = this.svc(SafetyProfileService);
    const canaryStart = (p: { featureId: string; featureVersion: string } & Parameters<typeof effectiveBasisPoints>[0]) => deployStartBasisPoints(profiles.list(p.featureId).find((x) => x.version === p.featureVersion)?.fClass ?? null, effectiveBasisPoints({ ...p, stageBasisPoints: null })) !== null;
    const open = this.svc(PolicyRepo)
      .all()
      .filter((p) => p.status === 'DEPLOYED' && !mine.has(p.policyId) && !rollback.candidates(p).some((c) => c.eligible));
    const out: string[] = [];
    const targets = open;
    const made: { prev: string; policyId: string; publicationId: string }[] = [];
    for (const p of targets) {
      const step = `revise-${p.flagKey}`;
      const author = who('author', 'FEATURE_AUTHOR', step);
      try {
        const n = policies.create(author, CreatePolicyBody.parse({ featureId: p.featureId, featureVersion: p.featureVersion, controlPoint: p.controlPoint, flagKey: p.flagKey, description: `${p.description} (운영 문구 정리 — 값 같음)`, enabled: p.enabled, safeDefault: p.safeDefault, entitlementCatalogId: p.entitlementCatalogId, strategies: p.strategies, rollout: p.rollout, ...(p.oddRestriction ? { oddRestriction: p.oddRestriction } : {}) }));
        if (carla && virtualScenariosFor(p.featureId).length) await this.svc(VirtualValidationService).run(author, RunVirtualBody.parse({ policyId: n.policyId }));
        const v = await policies.validate(author, n.policyId);
        if (v.run.decision !== 'GO') throw new Error(`검증 ${v.run.decision}: ${v.run.reasons.join(' / ')}`);
        policies.decide(who('approver', 'FEATURE_APPROVER', step), n.policyId, PolicyDecisionBody.parse({ decision: 'APPROVE', reason: '8종 검증 GO — 값 같음, 설명만 정리' }));
        const r = policies.deploy(who('coordinator', 'RELEASE_MANAGER', step), n.policyId, `${p.flagKey} 운영 문구 정리 배포(값 같음)`);
        made.push({ prev: p.policyId, policyId: n.policyId, publicationId: r.publicationId as string });
        if (canaryStart(p)) out.push(`${n.policyId} Canary ${(r.stageBasisPoints ?? 0) / 100}% 시작`);
      } catch (err) {
        out.push(`${p.flagKey} 건너뜀: ${(err as Error).message.slice(0, 160)}`);
      }
    }
    await this.until(() => made.every((x) => this.closed(x.publicationId)), 30_000);
    const ok = (id: string) => ['CONFIRMED', 'PARTIAL'].includes(this.svc(PublicationRepo).get(id)?.status ?? '');
    for (const m of made) {
      if (!ok(m.publicationId)) {
        out.push(`${m.policyId} 회신 미완(${this.svc(PublicationRepo).get(m.publicationId)?.status}) — 되돌리기 요청 건너뜀`);
        continue;
      }
      const r = rollback.requestPolicyRollback(who('operator', 'OPERATOR', 'rollback'), m.policyId, PolicyRollbackBody.parse({ recovery: { policyId: m.prev }, expectedDeploymentId: m.publicationId, reason: '문구 정리 판의 현장 확인 전 — 앞 판으로 되돌림 검토(운영 리더 승인 대기)', approvers: ['usr-opslead'] }));
      out.push(`${m.prev}→${m.policyId}(${m.publicationId}) 되돌리기 ${r.requestId} ${r.status}`);
    }
    if (!made.length && targets.length) throw new Error(out.join(' / '));
    return out.join(', ') || '대상 없음';
  }

  // ───────────────────────── 16. 상품 새 버전 — 구성 승인·고객 출시 승인 흐름 ─────────────────────────
  /**
   * 상품 승인 흐름 표본 — 대표 상품 몇 개에 새 Catalog Version을 실제 절차로 만든다: 상품 작성(상품 권리) → 구성 승인(구성 승인자) →
   * Feature가 모두 출시됐으면 상품 검증 → 고객 출시 승인(상품 Owner, 구성 승인자와 다른 사람). 출시되지 않은 Feature가 있으면 개발 대기에서 멈춘다.
   * 기존 버전은 그대로다(승인 이력은 데이터셋 이력으로 채워져 있다)
   */
  private productVersions() {
    const catalog = this.svc(CatalogService);
    const products = this.svc(ProductRepo);
    const commerce = who('commerce', 'PRODUCT_AUTHOR', 'products');
    const config = who('approver', 'PRODUCT_APPROVER', 'products');
    const owner = who('productowner', 'PRODUCT_APPROVER', 'products');
    const PLAN: [string, string][] = [
      ['CAT-00001', '주차 보조 패키지 — 저속 충돌방지 안내 문구 개정'],
      ['CAT-00004', '패키지 구성 설명 개정 — 판매 채널 안내 추가'],
      ['CAT-00015', '판매 설명 개정 — 사용 조건 안내 보강'],
      ['CAT-00016', '판매 설명 개정 — 사용 조건 안내 보강'],
    ];
    const out: string[] = [];
    for (const [catalogId, reason] of PLAN) {
      const base = products.versions(catalogId).at(-1);
      if (!base) continue;
      try {
        const v = catalog.createVersion(commerce, catalogId, CreateProductVersionBody.parse({ baseVersion: base.version, bump: 'minor', reason, changes: { description: `${base.description} — ${reason.split(' — ')[1] ?? reason}` } }));
        const ver = v.product.version;
        let cur = catalog.transition(config, catalogId, ver, 'APPROVED', '구성 검증 PASS 확인 — 구성 승인').product;
        if (cur.lifecycle === 'APPROVED') {
          cur = catalog.transition(config, catalogId, ver, 'VERIFIED', '구성 Feature 모두 출시 — 상품 검증 완료').product;
          cur = catalog.transition(owner, catalogId, ver, 'RELEASED', '판매 조건·기간 확인 — 고객 출시 승인').product;
        }
        out.push(`${catalogId}@${ver} ${cur.lifecycle}`);
      } catch (err) {
        out.push(`${catalogId} 건너뜀: ${(err as Error).message.slice(0, 160)}`);
      }
    }
    if (!out.some((x) => !x.includes('건너뜀'))) throw new Error(out.join(' / '));
    return out.join(', ');
  }
}
