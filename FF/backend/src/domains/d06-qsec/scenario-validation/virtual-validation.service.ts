// 차량 시나리오 검증 (D06-03) — vECU 가상검증(ffval 2.0). 정책을 실차에 보내기 전에 가상 차량에 적용해 기능 동작·오류·차량 내 감지·
// 원격 비활성화 단계(Registry DC)를 재현하고, 시나리오별 판정을 정책 검증기(D06-03 정상 추종 · D06-06 차량 내 감지)와
// G5 Verification Gate Evidence(IF-09 TMS, D04-02)으로 연결한다. 원격 DC2만 쓴 기준선 실행은 비교용으로 기록만 한다.
// 시간 한계(인계·램프·고장 램프·FTTI)는 이 Version의 Registry 안전 분류를 패키지에 실어 vECU가 그대로 쓴다.
// 가상 차량은 권한 보유·배포 가정으로 평가한다(기능 동작을 보는 시험이므로) — 실제 권한·배포 판단은 활성화 판단(D01-09)이 맡는다.
import { Body, Controller, Get, Injectable, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { judgeVirtual, RunVirtualBody, virtualScenariosFor, type VirtualRun } from '@ff/contracts';
import type { Response } from 'express';
import { resolve, sep } from 'node:path';
import { IfCallRepo } from '../../../adapters/if-call/if-call.repo';
import { VecuAdapter } from '../../../adapters/vecu/vecu.adapter';
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
import { FeatureRepo } from '../../d01-policy/repos';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { VirtualRunRepo } from './virtual-run.repo';

@Injectable()
@PlatformComponent('D06-03')
export class VirtualValidationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly vecu: VecuAdapter,
    private readonly runs: VirtualRunRepo,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly fleet: FleetRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly profiles: SafetyProfileService,
  ) {}

  scenarios(featureId?: string) {
    return featureId ? virtualScenariosFor(featureId) : virtualScenariosFor('FEAT-00022');
  }

  run(actor: Actor, body: RunVirtualBody): VirtualRun[] {
    const policy = this.policies.get(body.policyId);
    if (!policy) throw new DomainError('NOT_FOUND', `정책 ${body.policyId}을(를) 찾을 수 없습니다.`);
    const feature = this.features.get(policy.featureId, policy.featureVersion);
    if (!feature) throw new DomainError('NOT_FOUND', `정책 대상 ${policy.featureId} ${policy.featureVersion}이(가) 없습니다.`);
    const all = virtualScenariosFor(policy.featureId);
    if (!all.length) throw new DomainError('GUARD_FAILED', `${policy.featureId}은(는) vECU에 차량 측 런타임이 없어 가상검증 대상이 아닙니다.`);
    const scenarios = body.scenarioIds?.length ? all.filter((s) => body.scenarioIds!.includes(s.scenarioId)) : all;
    const unknown = (body.scenarioIds ?? []).filter((id) => !all.some((s) => s.scenarioId === id));
    if (unknown.length) throw new DomainError('VALIDATION', `알 수 없는 시나리오: ${unknown.join(', ')}`);
    const vehicle = this.fleet.vehicle(body.vin);
    if (!vehicle) throw new DomainError('NOT_FOUND', `차량 ${body.vin}을(를) 찾을 수 없습니다.`);

    const contentHash = policyHash(policy);
    const p = this.profiles.view(policy.featureId, policy.featureVersion).profile;
    const safety = { deactClass: p.deactClass, takeoverMs: p.takeoverMs, rampMs: p.rampMs, faultRampMs: p.faultRampMs, faultTolerantTimeMs: p.faultTolerantTimeMs, maxPendingMs: p.maxPendingMs };
    const pkg = {
      kind: 'ff-virtual-validation',
      policy: { ...policy, contentHash },
      scope: { country: feature.country, vehicleModel: feature.vehicleModel, trim: feature.trim },
      // 구현 추적(ECU·SW)은 판정 요약(verdict.vehicle)에 그대로 실린다
      fleet: this.fleet.vehicles().map((v) => (v.vin === body.vin ? { ...v, ecuPartNo: feature.ecuPnos[0] ?? null, swId: feature.swIds[0] ?? null } : v)),
      vehicle: body.vin,
      entitlementActive: true,
      // Registry 안전 분류 — 차량 Guard 단계와 기준 한계(감지 지연 ≤ FTTI − 고장 램프, FTTI 여유 ≥ 0)
      safety,
      scenarios: scenarios.map((s) => ({ scenarioId: s.scenarioId, ...s.params })),
    };
    const result = this.vecu.run(pkg);
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
          source: 'vecu',
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
    if (r.source !== 'vecu') {
      this.audit.failed(actor, 'TMS_SUBMIT', id, 'vECU 미연결 결과 제출 시도', 'D04-02');
      throw new DomainError('GUARD_FAILED', 'vECU가 실제로 실행한 결과만 TMS에 제출할 수 있습니다.');
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
    private readonly vecu: VecuAdapter,
  ) {}

  @Get('vecu/status')
  status() {
    return this.vecu.status();
  }

  @Get('virtual-validations/scenarios')
  scenarios(@Query('featureId') featureId?: string) {
    return { items: this.vv.scenarios(featureId) };
  }

  @Get('virtual-validations')
  list(@Query('policyId') policyId?: string, @Query('featureId') featureId?: string, @Query('featureVersion') featureVersion?: string) {
    return { items: this.vv.list({ policyId, featureId, featureVersion }) };
  }

  @Post('virtual-validations')
  @Roles('FEATURE_AUTHOR', 'IMPLEMENTER', 'GATE_JUDGE')
  @AuditAction('VIRTUAL_VALIDATION')
  run(@CurrentActor() actor: Actor, @Body(new ZodPipe(RunVirtualBody)) body: RunVirtualBody) {
    return { items: this.vv.run(actor, body) };
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
