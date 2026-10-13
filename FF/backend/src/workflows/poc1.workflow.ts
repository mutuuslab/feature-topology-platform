// PoC 6단계 러너 (P9) — PPT v0.50 슬라이드 3~8의 흐름을 실제 서비스로 차례로 실행하고 단계·행위·증적을 저장한다.
// 대상: FEAT-00022 1.0.0 「전방 안전거리 3단계」 Parameter flag care_00022_param. 실행마다 새 정책 개정본을 만든다.
// 행위마다 실제 역할의 다른 사람(작성자·승인자·출시 담당·운영자·차량)이 수행하고, API 정의(ROUTES)의 역할 규칙을 그대로 확인한다.
// ④·⑥은 차량 회신을 기다리는 단계라 RUNNING으로 두고, 다음 advance에서 회신 집계가 닫혔는지 확인한다.
import { Inject, Injectable } from '@nestjs/common';
import { COMPONENTS, evaluateFlag, POC_STEPS, ROUTES, type Policy, type Role } from '@ff/contracts';
import type { Response } from 'express';
import type { Actor } from '../kernel/actor';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { DomainError } from '../kernel/errors';
import { EventService } from '../kernel/event.service';
import { KillRepo } from '../domains/d03-safety/kill-switch/kill.repo';
import { EntitlementService } from '../domains/d01-policy/entitlement/entitlement.service';
import { FleetRepo, PolicyRepo } from '../domains/d01-policy/policy-repos';
import { PolicyService } from '../domains/d01-policy/policy-store/policy.service';
import { UnleashSyncService } from '../domains/d01-policy/policy-store/unleash-sync.service';
import { BaselineRepo, FeatureRepo, GateRepo, ProductRepo, TopologyRepo } from '../domains/d01-policy/repos';
import { VehicleRequestService } from '../domains/d02-runtime/vehicle-requests/vehicle-request.service';
import { VehicleRuntimeService } from '../domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { KillService } from '../domains/d03-safety/kill-switch/kill.service';
import { RestoreService } from '../domains/d03-safety/restore/restore.service';
import { FeedbackService } from '../domains/d04-ops/quality-feedback/feedback.service';
import { OfrepService } from '../domains/d05-ext/api-gateway/ofrep.controller';
import { AnomalyService } from '../domains/d06-qsec/anomaly-response/anomaly.service';
import { VirtualValidationService } from '../domains/d06-qsec/scenario-validation/virtual-validation.service';
import { PublicationRepo } from '../domains/d06-qsec/secure-deploy/publication.repo';

const FEATURE = 'FEAT-00022';
const VERSION = '1.0.0';
const FLAG = 'care_00022_param';
const DEMO = 'ego-01';
const SECOND = 'lead-01';

export type StepStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
export interface PocAction {
  at: string;
  actor: string;
  role: string;
  route: string;
  summary: string;
  ok: boolean;
}
export interface PocStep {
  no: number;
  title: string;
  status: StepStatus;
  startedAt: string | null;
  endedAt: string | null;
  actions: PocAction[];
  evidence: Record<string, string | number | boolean | null>;
  components: string[];
  note: string | null;
}
export interface PocRun {
  runId: string;
  status: 'RUNNING' | 'DONE' | 'FAILED' | 'ABORTED';
  startedAt: string;
  startedBy: string;
  endedAt: string | null;
  subject: { featureId: string; version: string; flagKey: string; vin: string };
  refs: Record<string, string | null>;
  seq: Record<string, number>;
  steps: PocStep[];
}

/** 응답 헤더를 쓰는 차량 발신 API를 서버 안에서 부를 때의 자리표시 응답 */
const NO_RES = { setHeader() {}, status() { return this; } } as unknown as Response;

@Injectable()
export class PocWorkflow {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly events: EventService,
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly baselines: BaselineRepo,
    private readonly products: ProductRepo,
    private readonly topology: TopologyRepo,
    private readonly policyRepo: PolicyRepo,
    private readonly fleet: FleetRepo,
    private readonly entitlements: EntitlementService,
    private readonly kills: KillRepo,
    private readonly policies: PolicyService,
    private readonly virtual: VirtualValidationService,
    private readonly unleash: UnleashSyncService,
    private readonly publications: PublicationRepo,
    private readonly runtime: VehicleRuntimeService,
    private readonly vehicleRequests: VehicleRequestService,
    private readonly ofrep: OfrepService,
    private readonly killService: KillService,
    private readonly restore: RestoreService,
    private readonly anomalies: AnomalyService,
    private readonly feedback: FeedbackService,
  ) {}

  // ---------- 저장 ----------
  private save(r: PocRun, insert = false) {
    if (insert) this.db.run('INSERT INTO poc_run (run_id, status, started_at, doc) VALUES (?, ?, ?, ?)', r.runId, r.status, r.startedAt, JSON.stringify(r));
    else this.db.run('UPDATE poc_run SET status = ?, doc = ? WHERE run_id = ?', r.status, JSON.stringify(r), r.runId);
  }
  get(id: string): PocRun {
    const row = this.db.get<{ doc: string }>('SELECT doc FROM poc_run WHERE run_id = ?', id);
    if (!row) throw new DomainError('NOT_FOUND', `PoC 실행 ${id}을(를) 찾을 수 없습니다.`);
    return JSON.parse(row.doc);
  }
  list(): PocRun[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM poc_run ORDER BY run_id DESC LIMIT 20').map((r) => JSON.parse(r.doc));
  }

  // ---------- 행위자 ----------
  private actor(runId: string, id: string, role: Role): Actor {
    return { id, role, correlationId: runId };
  }
  private people(runId: string) {
    return {
      author: this.actor(runId, 'poc.author', 'FEATURE_AUTHOR'),
      approver: this.actor(runId, 'poc.approver', 'FEATURE_APPROVER'),
      release: this.actor(runId, 'poc.release', 'RELEASE_MANAGER'),
      ops: this.actor(runId, 'poc.ops', 'OPERATOR'),
      // 긴급 차단 2인 승인(보고서 v1.1 FFG-PLT-005) — F3 안전 사유라 첫 칸은 Safety Manager(FSM)
      safety: this.actor(runId, 'poc.safety', 'SAFETY_OFFICER'),
      opsLead: this.actor(runId, 'poc.opslead', 'OPS_LEAD'),
      // 복원은 차단 승인자와 다른 2인
      restoreSafety: this.actor(runId, 'poc.safety2', 'SAFETY_OFFICER'),
      restoreCsm: this.actor(runId, 'poc.csm', 'SECURITY_OFFICER'),
      vehicle: (vin: string) => this.actor(runId, `vehicle:${vin}`, 'VEHICLE'),
    };
  }

  /** 커널 RolesGuard와 같은 규칙 — 이 역할이 이 라우트를 부를 수 있는가 */
  private allow(route: string, a: Actor) {
    const r = ROUTES.find((x) => x.name === route);
    if (!r) throw new Error(`알 수 없는 라우트 ${route}`);
    if (r.roles?.length && !r.roles.includes(a.role)) throw new DomainError('FORBIDDEN', `${a.role}은(는) ${route}를 할 수 없습니다.`);
  }
  private async act<T>(step: PocStep, route: string, a: Actor, summary: (r: T) => string, fn: () => T | Promise<T>): Promise<T> {
    this.allow(route, a);
    try {
      const r = await fn();
      step.actions.push({ at: this.clock.iso(), actor: a.id, role: a.role, route, summary: summary(r), ok: true });
      return r;
    } catch (e) {
      step.actions.push({ at: this.clock.iso(), actor: a.id, role: a.role, route, summary: (e as Error).message, ok: false });
      throw e;
    }
  }

  // ---------- 시작 ----------
  async start(actor: Actor): Promise<PocRun> {
    // 끝나지 않은 이전 실행은 중단, 이전 PoC가 남긴 긴급 차단은 복구해 깨끗한 상태에서 시작
    for (const r of this.list().filter((x) => x.status === 'RUNNING')) this.save({ ...r, status: 'ABORTED', endedAt: this.clock.iso() });
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM poc_run')!.n + 1;
    const runId = `POC-${String(n).padStart(5, '0')}`;
    const people = this.people(runId);
    const ops = people.ops;
    const restored: string[] = [];
    // 승인 대기로 남은 차단 요청은 거절
    for (const k of this.killService.list('REQUESTED').filter((x) => x.featureId === FEATURE)) this.killService.reject(people.restoreSafety, k.killId, { reason: `PoC ${runId} 시작 전 정리` });
    for (const k of this.kills.active().filter((x) => x.featureId === FEATURE)) {
      if (k.version === 2) {
        // v2 차단 — 복원 요청 후 차단 승인자와 다른 2인(FSM·CSM)이 승인(FFG-DEAC-008)
        if (k.restoreRequest?.status !== 'REQUESTED') this.restore.request(ops, k.killId, `PoC ${runId} 시작 전 복구`);
        this.restore.approve(people.restoreSafety, k.killId, {});
        const done = this.restore.approve(people.restoreCsm, k.killId, {});
        if (done.status !== 'RELEASED') throw new Error(`이전 PoC 차단 ${k.killId}을 복구하지 못했습니다: ${done.restoreRequest?.rejectReason ?? done.status}`);
      } else this.restore.release(ops, k.killId, `PoC ${runId} 시작 전 복구`);
      restored.push(k.killId);
    }
    const run: PocRun = {
      runId,
      status: 'RUNNING',
      startedAt: this.clock.iso(),
      startedBy: actor.id,
      endedAt: null,
      subject: { featureId: FEATURE, version: VERSION, flagKey: FLAG, vin: DEMO },
      refs: { restoredKills: restored.join(',') || null },
      seq: {},
      steps: POC_STEPS.map((s) => ({ no: s.no, title: s.ko, status: 'PENDING', startedAt: null, endedAt: null, actions: [], evidence: {}, components: COMPONENTS.filter((c) => c.pocSteps.includes(s.no)).map((c) => c.id), note: null })),
    };
    this.save(run, true);
    this.db.tx(() => this.events.publish('poc.started', runId, { runId, by: actor.id, restoredKills: restored }, { correlationId: runId }));
    return run;
  }

  /** 다음 단계 실행 — 진행 중(RUNNING) 단계면 완료됐는지 확인만 한다 */
  async advance(id: string): Promise<PocRun> {
    const run = this.get(id);
    if (run.status !== 'RUNNING') return run;
    const step = run.steps.find((s) => s.status !== 'DONE')!;
    try {
      if (step.status === 'PENDING') {
        step.status = 'RUNNING';
        step.startedAt = this.clock.iso();
        await this.execute(run, step);
      } else if (step.status === 'RUNNING') await this.check(run, step);
    } catch (e) {
      step.status = 'FAILED';
      step.note = (e as Error).message;
    }
    if (step.status === 'DONE' || step.status === 'FAILED') step.endedAt = this.clock.iso();
    if (step.status === 'FAILED') run.status = 'FAILED';
    else if (run.steps.every((s) => s.status === 'DONE')) run.status = 'DONE';
    if (run.status !== 'RUNNING') run.endedAt = this.clock.iso();
    this.save(run);
    this.db.tx(() =>
      this.events.publish(`poc.step.${step.status.toLowerCase()}`, run.runId, { runId: run.runId, step: step.no, title: step.title, status: step.status, components: step.components, note: step.note }, { correlationId: run.runId }),
    );
    return run;
  }

  private async execute(run: PocRun, step: PocStep) {
    const p = this.people(run.runId);
    switch (step.no) {
      case 1: {
        // ① Feature 등록·상품 구성 — Registry·Topology·BOM·Catalog가 출시 준비된 상태인가
        const f = await this.act(step, 'featureDetail', p.author, (x) => `${x?.featureId} ${x?.version} ${x?.lifecycle}`, () => this.features.get(FEATURE, VERSION));
        if (!f) throw new Error(`${FEATURE} ${VERSION} 없음`);
        const latest = this.gates.latest(FEATURE, VERSION);
        const pass = Object.values(latest).filter((g) => g?.status === 'PASS').length;
        const bl = f.baselineId ? this.baselines.get(f.baselineId) : undefined;
        const prods = await this.act(step, 'listProducts', p.author, (x) => x.map((y) => `${y.catalogId} ${y.lifecycle}`).join(', '), () => this.products.all().filter((x) => !!f.baselineId && x.baselineIds.includes(f.baselineId)));
        const requires = this.topology.outgoing(FEATURE, VERSION).filter((d) => d.type === 'REQUIRES');
        Object.assign(step.evidence, { feature: `${FEATURE} ${VERSION}`, lifecycle: f.lifecycle, gatesPass: `${pass}/9`, baseline: f.baselineId, baselineHash: bl?.contentHash ? bl.contentHash.slice(0, 19) : null, products: prods.map((x) => x.catalogId).join(','), requires: requires.map((d) => `${d.targetFeatureId} ${d.verdict}`).join(',') || null });
        if (f.lifecycle !== 'RELEASED' || !prods.length) throw new Error('출시(RELEASED) Feature·상품 구성이 준비되지 않았습니다.');
        step.status = 'DONE';
        return;
      }
      case 2: {
        // ② 정책 준비·검증·승인 — 작성 → vECU 가상검증 → 분야별 검증 8종(GO) → 승인(작성자≠승인자)
        const pol = await this.act(step, 'createPolicy', p.author, (x) => `${x.policyId} r${x.revision} DRAFT`, () =>
          this.policies.create(p.author, { featureId: FEATURE, featureVersion: VERSION, controlPoint: 'Parameter', flagKey: FLAG, description: `PoC ${run.runId} — 위험 단계 감속 요청 파라미터`, safeDefault: false, enabled: true, entitlementCatalogId: 'CAT-00019', strategies: [], rollout: { mode: 'ALL', basisPoints: 10000, salt: 'FF-COHORT-SALT-1' } } as any),
        );
        run.refs.policyId = pol.policyId;
        const vv = await this.act(step, 'runVirtual', p.author, (x) => x.map((r) => `${r.scenarioId.replace('SCN-FEAT00022-', '')} ${r.source}/${r.gateResult}`).join(' · '), () => this.virtual.run(p.author, { policyId: pol.policyId, vin: DEMO }));
        run.refs.virtualRuns = vv.map((r) => r.runId).join(',');
        const v = await this.act(step, 'validatePolicy', p.author, (x: any) => `${x.run.decision} (${x.run.results.filter((r: any) => r.result === 'PASS').length}/8 PASS)`, () => this.policies.validate(p.author, pol.policyId));
        Object.assign(step.evidence, { policyId: pol.policyId, virtual: vv.map((r) => `${r.runId} ${r.gateResult}`).join(', '), safety: (v as any).run.decision });
        if ((v as any).run.decision !== 'GO') throw new Error(`배포 안전성 ${(v as any).run.decision}: ${(v as any).run.reasons.join(' / ')}`);
        await this.act(step, 'decidePolicy', p.approver, () => 'APPROVE', () => this.policies.decide(p.approver, pol.policyId, { decision: 'APPROVE', reason: `PoC ${run.runId}: 8종 GO·vECU PASS 확인` }));
        step.evidence.status = 'APPROVED';
        step.status = 'DONE';
        return;
      }
      case 3: {
        // ③ 사용 권한·서버 활성화 판단 — 승인 정책 기준 Fleet 미리보기(배포 전), 시연 차량 체험권
        const pol = this.policyRepo.get(run.refs.policyId!)!;
        const f = this.features.get(FEATURE, VERSION)!;
        const grants = await this.act(step, 'entitlements', p.ops, (x) => x.grants.map((g) => `${g.grantId} ${g.kind} ${g.status}`).join(', ') || '권한 없음', () => this.entitlements.activeFor(DEMO, FEATURE));
        const counts: Record<string, number> = { ALLOW: 0, DENY: 0, HOLD: 0 };
        let demo = '';
        await this.act(step, 'activationDecide', p.ops, () => `Fleet ${this.fleet.vehicles().length}대 판단`, async () => {
          for (const veh of this.fleet.vehicles()) {
            const r = await evaluateFlag({ policy: { ...pol, status: 'DEPLOYED' } as Policy, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim }, killed: this.kills.killed(FEATURE, veh.vin), vehicle: veh, entitlementActive: this.entitlements.activeFor(veh.vin, FEATURE).active });
            counts[r.decision === 'ALLOW' ? 'ALLOW' : r.decision === 'DENY' ? 'DENY' : 'HOLD']++;
            if (veh.vin === DEMO) demo = `${r.value ? 'ON' : 'OFF'} ${r.reason}`;
          }
        });
        Object.assign(step.evidence, { trial: grants.active, demoDecision: demo, allow: counts.ALLOW, deny: counts.DENY, hold: counts.HOLD });
        if (!demo.startsWith('ON')) step.note = `시연 차량 ${DEMO}이(가) ${demo} — 체험 기간이 끝났으면 ON이 되지 않습니다`;
        step.status = 'DONE';
        return;
      }
      case 4: {
        // ④ 정책 배포·차량 수신 — 서버 배포 → 서명 게시본(PKI) → OTA(IF-05) → 차량 회신 집계, Policy Tool(IF-04) 동기화
        const dep = await this.act(step, 'deployPolicy', p.release, (x: any) => `${x.status} → ${x.publicationId}`, () => this.policies.deploy(p.release, run.refs.policyId!, `PoC ${run.runId} 서버 배포`));
        run.refs.publicationId = (dep as any).publicationId;
        const u = await this.act(step, 'syncUnleash', p.release, (x) => `Unleash ${x.outcome}`, () => this.unleash.sync(p.release, run.refs.policyId!));
        Object.assign(step.evidence, { publicationId: run.refs.publicationId, unleash: u.outcome });
        await this.check(run, step);
        return;
      }
      case 5: {
        // ⑤ 차량 평가·체험 제안·기능 적용 — 차량이 부팅 대사(HELLO) 후 받은 서명 정책으로 스스로 평가, 앱은 OpenFeature(OFREP)로 조회
        await this.hello(run, step, DEMO);
        const view = await this.act(step, 'vehicleRuntime', p.ops, (x) => {
          const e = x.evaluations.find((y) => y.flagKey === FLAG);
          return `차량 측 ${e?.local.value ? 'ON' : 'OFF'} ${e?.local.reason ?? ''}`;
        }, () => this.runtime.view(DEMO));
        const bundle = view.runtime.bundles[FLAG];
        const local = view.evaluations.find((y) => y.flagKey === FLAG);
        const of = await this.act(step, 'ofrepEvaluate', p.vehicle(DEMO), (x: any) => `OpenFeature ${x.value ? 'ON' : 'OFF'} ${x.reason}`, () => this.ofrep.one(FLAG, { context: { targetingKey: DEMO } } as any));
        Object.assign(step.evidence, { bundle: bundle?.publicationId ?? null, sameAsDeployed: bundle?.publicationId === run.refs.publicationId, vehicleValue: local?.local.value ?? null, openFeature: (of as any).value, openFeatureReason: (of as any).reason });
        if (bundle?.publicationId !== run.refs.publicationId) throw new Error(`${DEMO}이(가) 이번 게시본(${run.refs.publicationId})을 적용하지 않았습니다`);
        // 체험 제안 — 두 번째 차량에 제안 중인 체험권이 있으면 IVI에서 수락(TRIAL_ACCEPT) → 수락일부터 30일 ON
        const offered = this.entitlements.grants(SECOND).find((g) => g.catalogId === 'CAT-00019' && g.kind === '체험' && g.state === 'OFFERED');
        if (offered) {
          await this.hello(run, step, SECOND);
          const acc = await this.act(step, 'vehicleReport', p.vehicle(SECOND), (x: any) => `TRIAL_ACCEPT ${x.grant.grantId} → ${x.grant.validTo}까지 ON`, () =>
            this.vehicleRequests.report(p.vehicle(SECOND), SECOND, { type: 'TRIAL_ACCEPT', catalogId: 'CAT-00019', bootId: this.boot(run, SECOND), sequence: this.next(run, SECOND), observedAt: this.clock.iso() } as any, NO_RES),
          );
          Object.assign(step.evidence, { trialAccepted: `${SECOND} ${(acc as any).grant.grantId} ~${(acc as any).grant.validTo}` });
        } else Object.assign(step.evidence, { trialAccepted: `${SECOND} 제안 중인 체험 없음` });
        step.status = 'DONE';
        return;
      }
      case 6: {
        // ⑥ 이상 확인·긴급 차단·차단 적용 — 차량 2대 고장 보고 → 이상 건(긴급 차단 권고) → 운영자 차단 → 회신 → Safe Default → 품질 피드백
        for (const vin of [DEMO, SECOND]) {
          await this.hello(run, step, vin);
          await this.act(step, 'vehicleReport', p.vehicle(vin), () => `FAULT GAP_EST_DRIFT`, () => this.vehicleRequests.report(p.vehicle(vin), vin, { type: 'FAULT', bootId: this.boot(run, vin), sequence: this.next(run, vin), observedAt: this.clock.iso(), featureId: FEATURE, code: 'GAP_EST_DRIFT', severity: 'WARNING', detail: `PoC ${run.runId} 거리 추정 편향` } as any, NO_RES));
        }
        const anm = this.anomalies.list({ kind: 'FEATURE_FAULT', featureId: FEATURE }).find((a) => a.status === 'OPEN' || a.status === 'ACKNOWLEDGED');
        if (!anm) throw new Error('이상 건이 열리지 않았습니다');
        step.actions.push({ at: this.clock.iso(), actor: 'system', role: 'SYSTEM', route: 'anomalies', summary: `${anm.anomalyId} ${anm.severity} → ${anm.advice}`, ok: true });
        run.refs.anomalyId = anm.anomalyId;
        // 요청(운영자) → 승인 FSM → 승인 운영 리더 → 게이트·서명·차량별 봉투·긴급 채널
        const req = await this.act(step, 'issueKill', p.ops, (x) => `${x.killId} 승인 대기`, () =>
          this.killService.issue(p.ops, {
            featureId: FEATURE,
            featureVersion: VERSION,
            vins: [DEMO, SECOND],
            reasonCategory: 'SAFETY',
            reasonCode: 'GAP_EST_DRIFT',
            reason: `PoC ${run.runId}: ${anm.reasons.join(' / ')}`,
            containmentJustification: `이상 건 ${anm.anomalyId} — 원인 분석 전 봉쇄`,
            confirm: FEATURE,
            anomalyId: anm.anomalyId,
          }),
        );
        await this.act(step, 'approveKill', p.safety, (x) => `${x.killId} 승인 1/2 (FSM)`, () => this.killService.approve(p.safety, req.killId, {}));
        const k = await this.act(step, 'approveKill', p.opsLead, (x) => `${x.killId} 승인 2/2 → ${x.status} ${x.publicationId ?? ''}`, () => this.killService.approve(p.opsLead, req.killId, {}));
        if (k.status !== 'ACTIVE') throw new Error(`긴급 차단이 발행되지 않았습니다(${k.status}: ${k.rejectReason ?? ''})`);
        run.refs.killId = k.killId;
        Object.assign(step.evidence, { anomalyId: anm.anomalyId, advice: anm.advice, killId: k.killId });
        await this.check(run, step);
        return;
      }
    }
  }

  /** ④·⑥ 완료 확인 — 회신 집계가 닫혔는가 */
  private async check(run: PocRun, step: PocStep) {
    if (step.no === 4) {
      const pub = this.publications.get(run.refs.publicationId!);
      if (!pub?.closedAt) return;
      Object.assign(step.evidence, { delivery: pub.status, confirmed: `${pub.confirmed}/${pub.denominator}` });
      if (pub.status === 'TIMEOUT' || pub.status === 'DIVERGED') throw new Error(`배포 회신 ${pub.status}`);
      if (pub.status === 'PARTIAL') step.note = `회신 ${pub.confirmed}/${pub.denominator} — 통신 단절 차량은 재연결 대사(HELLO) 때 다시 받습니다`;
      step.status = 'DONE';
    }
    if (step.no === 6) {
      const k = this.killService.detail(run.refs.killId!);
      if (!k.delivery?.closedAt) return;
      const server = await this.ofrep.one(FLAG, { context: { targetingKey: DEMO } } as any);
      const anm = this.anomalies.require(run.refs.anomalyId!);
      const fb = this.feedback.list({ featureId: FEATURE }).find((x) => x.anomalyId === anm.anomalyId);
      run.refs.feedbackId = fb?.feedbackId ?? null;
      Object.assign(step.evidence, { killDelivery: `${k.delivery.status} ${k.delivery.confirmed}/${k.delivery.denominator}`, serverValue: (server as any).value, serverReason: (server as any).metadata?.platformReason ?? null, anomalyStatus: anm.status, feedbackId: fb?.feedbackId ?? null });
      if (k.delivery.status !== 'CONFIRMED') throw new Error(`차단 회신 ${k.delivery.status}`);
      step.status = 'DONE';
    }
  }

  // ---------- 차량 발신 보고 봉투 ----------
  private boot(run: PocRun, vin: string) {
    return `BOOT-${vin}-${run.runId}`;
  }
  private next(run: PocRun, vin: string) {
    return (run.seq[vin] = (run.seq[vin] ?? 0) + 1);
  }
  private async hello(run: PocRun, step: PocStep, vin: string) {
    if (run.seq[vin]) return;
    const v = this.people(run.runId).vehicle(vin);
    await this.act(step, 'vehicleReport', v, (x: any) => `HELLO ${x?.outcome ?? ''}${x?.redeliver?.length ? ` · 재전달 ${x.redeliver.length}` : ''}`, () =>
      this.vehicleRequests.report(v, vin, { type: 'HELLO', bootId: this.boot(run, vin), sequence: this.next(run, vin), observedAt: this.clock.iso(), highest: {} } as any, NO_RES),
    );
  }
}
