// 차량 시나리오 검증 (D06-03) — CARLA 가상검증(sim/carla, 검증 전용 서버). 정책을 실차에 보내기 전에 가상 차량에 적용해 기능 동작·오류·차량 내 감지·
// 원격 비활성화 단계(Registry DC)를 재현하고, 시나리오별 판정을 정책 검증기(D06-03 정상 추종 · D06-06 차량 내 감지)와
// G5 Verification Gate Evidence(IF-09 TMS, D04-02)으로 연결한다. 원격 DC2만 쓴 기준선 실행은 비교용으로 기록만 한다.
// 시간 한계(인계·램프·고장 램프·FTTI)는 이 Version의 Registry 안전 분류를 패키지에 실어 실행기의 차량 Guard가 그대로 쓴다.
// 정책 판단(evaluation)은 FF 단일 평가기(evaluateFlag)로 여기서 계산해 넘긴다 — 실행기에 평가기를 복제하지 않는다.
// 가상 차량은 권한 보유·배포 가정으로 평가한다(기능 동작을 보는 시험이므로) — 실제 권한·배포 판단은 활성화 판단(D01-09)이 맡는다.
import { Body, Controller, Get, Injectable, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { combinationPlan, combinationViolations, evaluateFlag, judgeVirtual, RunVirtualBody, virtualScenariosFor, type Policy, type VirtualRun } from '@ff/contracts';
import type { Response } from 'express';
import { resolve, sep } from 'node:path';
import { IfCallRepo } from '../../../adapters/if-call/if-call.repo';
import { CarlaAdapter } from '../../../adapters/sim/carla.adapter';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { Inject } from '@nestjs/common';
import { FleetRepo, policyHash, PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo, TopologyRepo } from '../../d01-policy/repos';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { VirtualRunRepo } from './virtual-run.repo';

@Injectable()
@PlatformComponent('D06-03')
export class VirtualValidationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly sim: CarlaAdapter,
    private readonly runs: VirtualRunRepo,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly fleet: FleetRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly profiles: SafetyProfileService,
    private readonly topology: TopologyRepo,
  ) {}

  scenarios(featureId?: string) {
    return featureId ? virtualScenariosFor(featureId) : virtualScenariosFor('FEAT-00022');
  }

  /**
   * 조합 시험 계획 — 이 Feature 범위(국가·차종·트림)의 Topology로 허용 조합을 정하고, 금지 조합은 같은 규칙으로 실제로 거부되는지 확인해 함께 낸다.
   * 안전 관련 여부는 각 Feature 최신 Version의 Registry F 등급(분류 없음은 안전 관련으로 본다).
   */
  combinations(featureId: string) {
    const f = this.features.versions(featureId).at(-1); // 범위는 Version마다 같다 — 최신 Version 기준
    if (!f) throw new DomainError('NOT_FOUND', `Feature ${featureId}을(를) 찾을 수 없습니다.`);
    const deps = this.topology.all().filter((d) => d.country === f.country && d.vehicleModel === f.vehicleModel && d.trim === f.trim);
    const fClassOf = (id: string) => this.profiles.list(id).at(-1)?.fClass ?? null;
    const plan = combinationPlan(featureId, deps, fClassOf);
    const negatives = plan.negatives.map((n) => {
      const got = combinationViolations(n.on, deps).map((v) => v.code);
      return { ...n, rejected: got.includes(n.expect), got };
    });
    return { ...plan, negatives, scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim } };
  }

  async run(actor: Actor, body: RunVirtualBody): Promise<VirtualRun[]> {
    const policy = this.policies.get(body.policyId);
    if (!policy) throw new DomainError('NOT_FOUND', `정책 ${body.policyId}을(를) 찾을 수 없습니다.`);
    const feature = this.features.get(policy.featureId, policy.featureVersion);
    if (!feature) throw new DomainError('NOT_FOUND', `정책 대상 ${policy.featureId} ${policy.featureVersion}이(가) 없습니다.`);
    const all = virtualScenariosFor(policy.featureId);
    if (!all.length) throw new DomainError('GUARD_FAILED', `${policy.featureId}은(는) 가상검증 실행기에 차량 측 런타임이 없어 대상이 아닙니다.`);
    const scenarios = body.scenarioIds?.length ? all.filter((s) => body.scenarioIds!.includes(s.scenarioId)) : all;
    const unknown = (body.scenarioIds ?? []).filter((id) => !all.some((s) => s.scenarioId === id));
    if (unknown.length) throw new DomainError('VALIDATION', `알 수 없는 시나리오: ${unknown.join(', ')}`);
    const vehicle = this.fleet.vehicle(body.vin);
    if (!vehicle) throw new DomainError('NOT_FOUND', `차량 ${body.vin}을(를) 찾을 수 없습니다.`);

    const contentHash = policyHash(policy);
    // 가상 차량 평가 — 배포·권한 보유 가정(기능 동작 시험), 차단 없음
    const scope = { country: feature.country, vehicleModel: feature.vehicleModel, trim: feature.trim };
    const flag = await evaluateFlag({ policy: { ...policy, status: 'DEPLOYED' } as Policy, scope, killed: false, vehicle, entitlementActive: true });
    const evaluation = { value: !!flag.value, decision: flag.decision, reason: flag.reason };
    const p = this.profiles.view(policy.featureId, policy.featureVersion).profile;
    const safety = { deactClass: p.deactClass, takeoverMs: p.takeoverMs, rampMs: p.rampMs, faultRampMs: p.faultRampMs, faultTolerantTimeMs: p.faultTolerantTimeMs, maxPendingMs: p.maxPendingMs };
    const pkg = {
      kind: 'ff-virtual-validation',
      policy: { ...policy, contentHash },
      scope,
      // 구현 추적(ECU·SW)은 판정 요약(verdict.vehicle)에 그대로 실린다
      fleet: this.fleet.vehicles().map((v) => (v.vin === body.vin ? { ...v, ecuPartNo: feature.ecuPnos[0] ?? null, swId: feature.swIds[0] ?? null } : v)),
      vehicle: body.vin,
      entitlementActive: true,
      evaluation,
      // Registry 안전 분류 — 차량 Guard 단계와 기준 한계(감지 지연 ≤ FTTI − 고장 램프, FTTI 여유 ≥ 0)
      safety,
      scenarios: scenarios.map((s) => ({ scenarioId: s.scenarioId, ...s.params })),
    };
    const result = await this.sim.run(pkg);
    const at = this.clock.iso();
    const base = { policyId: policy.policyId, policyRevision: policy.revision, contentHash, featureId: policy.featureId, featureVersion: policy.featureVersion, vin: body.vin, at, by: actor.id, tms: null, safety };

    return this.db.tx(() => {
      // 번호는 넣을 때마다 매긴다 (같은 실행 안에서 시나리오별 VV 번호가 겹치지 않게)
      const make = (s: (typeof scenarios)[number]): VirtualRun => {
        const r = result.ok ? result.runs.find((x) => x.scenarioId === s.scenarioId) : undefined;
        if (!result.ok || !r) {
          return { ...base, runId: this.runs.nextId(), scenarioId: s.scenarioId, role: s.role, source: 'unavailable', simulator: null, testId: null, overall: 'UNAVAILABLE', gateResult: 'UNAVAILABLE', criteria: [], evaluation: null, evidence: null, error: 'error' in result ? result.error : '시나리오 결과 없음' };
        }
        const j = judgeVirtual(r.criteria, r.repro);
        return {
          ...base,
          runId: this.runs.nextId(),
          scenarioId: s.scenarioId,
          role: s.role,
          source: 'carla',
          simulator: result.simulator,
          testId: r.testId,
          overall: r.overall === 'PASS' ? 'PASS' : 'FAIL',
          gateResult: j.gateResult,
          gateReasons: j.reasons,
          criteria: j.criteria,
          repro: (r.repro as VirtualRun['repro']) ?? null,
          evaluation: r.evaluation && { value: r.evaluation.value, decision: r.evaluation.decision, reason: r.evaluation.reason },
          evidence: { dir: r.dir, files: r.files },
          error: null,
        };
      };
      const out: VirtualRun[] = [];
      for (const s of scenarios) {
        const r = make(s);
        this.runs.insert(r);
        out.push(r);
        this.audit.record(actor, 'VIRTUAL_VALIDATION', r.runId, { after: { policyId: r.policyId, scenarioId: r.scenarioId, source: r.source, testId: r.testId, gateResult: r.gateResult }, componentId: 'D06-03' });
        this.events.publish('virtual.validation.completed', r.runId, { runId: r.runId, policyId: r.policyId, scenarioId: r.scenarioId, source: r.source, overall: r.overall, gateResult: r.gateResult, testId: r.testId }, { componentId: 'D06-03', correlationId: actor.correlationId });
      }
      return out;
    });
  }

  list(q: { policyId?: string; featureId?: string; featureVersion?: string }) {
    return this.runs.list(q);
  }

  detail(id: string): VirtualRun {
    const r = this.runs.get(id);
    if (!r) throw new DomainError('NOT_FOUND', `가상검증 ${id}을(를) 찾을 수 없습니다.`);
    return r;
  }

  /** 기록된 Evidence 파일만 내준다 (경로 조작 차단) */
  file(id: string, name: string): string {
    const r = this.detail(id);
    const f = r.evidence?.files.find((x) => x.name === name);
    if (!r.evidence || !f) throw new DomainError('NOT_FOUND', `${id}에 ${name} Evidence가 없습니다.`);
    const dir = resolve(r.evidence.dir);
    const path = resolve(dir, f.name);
    if (!path.startsWith(dir + sep)) throw new DomainError('VALIDATION', '잘못된 Evidence 경로입니다.');
    return path;
  }
}

/** 품질 기준 검증 (D04-02) — IF-09 TMS Evidence 제출. 가상검증 결과·Evidence 해시를 TMS에 등록해 G5 Verification Gate 근거로 쓴다. */
@Injectable()
@PlatformComponent('D04-02')
export class TmsSubmissionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly runs: VirtualRunRepo,
    private readonly ifCalls: IfCallRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  submit(actor: Actor, id: string): VirtualRun {
    const r = this.runs.get(id);
    if (!r) throw new DomainError('NOT_FOUND', `가상검증 ${id}을(를) 찾을 수 없습니다.`);
    if (r.source !== 'carla') {
      this.audit.failed(actor, 'TMS_SUBMIT', id, r.source === 'vecu' ? '이전 실행기 기록 제출 시도' : '실행기 미연결 결과 제출 시도', 'D04-02');
      throw new DomainError('GUARD_FAILED', 'CARLA 실행기가 실제로 실행한 결과만 TMS에 제출할 수 있습니다.');
    }
    // 비교 기준선(원격 DC2만)은 기록·표시만 — 화면이 버튼을 숨겨도 API로 들어오면 TMS(G5 Evidence 경로)에 싣지 않는다
    if (r.role === 'BASELINE_REMOTE') {
      this.audit.failed(actor, 'TMS_SUBMIT', id, '비교 기준선 제출 시도', 'D04-02');
      throw new DomainError('GUARD_FAILED', '비교 기준선 실행은 TMS 제출 대상이 아닙니다 — 기록·비교 표시만 합니다.');
    }
    if (r.tms) return r;
    const n = this.ifCalls.next('IF-09');
    const res = this.ifCalls.call(
      'IF-09',
      id,
      { testId: r.testId, featureId: r.featureId, featureVersion: r.featureVersion, policyId: r.policyId, contentHash: r.contentHash, scenarioId: r.scenarioId, overall: r.overall, gateResult: r.gateResult, criteria: r.criteria.map((c) => ({ id: c.id, status: c.status, value: c.value })), evidence: r.evidence?.files.map((f) => ({ name: f.name, sha256: f.sha256 })) },
      () => ({ tmsId: `TMS-${String(n).padStart(5, '0')}`, accepted: true }),
    );
    return this.db.tx(() => {
      const next: VirtualRun = { ...r, tms: { tmsId: res.tmsId, submittedAt: this.clock.iso(), by: actor.id } };
      this.runs.update(next);
      this.audit.record(actor, 'TMS_SUBMIT', id, { after: { tmsId: res.tmsId, testId: r.testId, gateResult: r.gateResult }, componentId: 'D04-02' });
      this.events.publish('tms.evidence.submitted', id, { runId: id, tmsId: res.tmsId, testId: r.testId, featureId: r.featureId, featureVersion: r.featureVersion, gateResult: r.gateResult }, { componentId: 'D04-02', correlationId: actor.correlationId });
      return next;
    });
  }
}

@Controller('api')
export class VirtualValidationController {
  constructor(
    private readonly vv: VirtualValidationService,
    private readonly tms: TmsSubmissionService,
    private readonly sim: CarlaAdapter,
  ) {}

  @Get('sim/status')
  status() {
    return this.sim.status();
  }

  @Get('virtual-validations/scenarios')
  scenarios(@Query('featureId') featureId?: string) {
    return { items: this.vv.scenarios(featureId) };
  }

  @Get('virtual-validations/combinations')
  combinations(@Query('featureId') featureId?: string) {
    return this.vv.combinations(featureId ?? 'FEAT-00022');
  }

  @Get('virtual-validations')
  list(@Query('policyId') policyId?: string, @Query('featureId') featureId?: string, @Query('featureVersion') featureVersion?: string) {
    return { items: this.vv.list({ policyId, featureId, featureVersion }) };
  }

  @Post('virtual-validations')
  @Roles('FEATURE_AUTHOR', 'IMPLEMENTER', 'GATE_JUDGE')
  @AuditAction('VIRTUAL_VALIDATION')
  async run(@CurrentActor() actor: Actor, @Body(new ZodPipe(RunVirtualBody)) body: RunVirtualBody) {
    return { items: await this.vv.run(actor, body) };
  }

  @Get('virtual-validations/:id')
  detail(@Param('id') id: string) {
    return this.vv.detail(id);
  }

  @Get('virtual-validations/:id/files/:name')
  file(@Param('id') id: string, @Param('name') name: string, @Res() res: Response) {
    let path: string;
    try {
      path = this.vv.file(id, name);
    } catch (e) {
      throw e instanceof DomainError ? e : new NotFoundException();
    }
    // Evidence 보고서는 같은 출처에서 열리므로 스크립트를 막는다
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path);
  }

  @Post('virtual-validations/:id/tms')
  @Roles('GATE_JUDGE', 'IMPLEMENTER')
  @AuditAction('TMS_SUBMIT')
  submit(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.tms.submit(actor, id);
  }
}
