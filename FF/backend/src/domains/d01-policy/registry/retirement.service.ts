// Flag Retirement 6단계 (D01-01 Registry, 보고서 v1.1 6.5 · FFG-LCY-011 플랫폼 몫) — Retirement 요청 → 승인(Feature Owner, F2 이상은 Safety Manager도, 요청자 제외)
// → 남은 차량 집계(상태 보고) → 최종 상태 고정 SW 배포 완료율 → 코드 참조 0건 → Registry 퇴역(flag_registry.retired_at, 배포 정책 RETIRED — ID 재사용 금지)
// → 기록 보존(시장). 진행 기록은 037(Retirement 건 doc)과 감사에 남는다. 코드 삭제 기한(승인 후 6개월·다음 정기 릴리스 중 이른 쪽)이 지나면 발견으로 보인다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { codeRemovalDue, RETIREMENT_STEPS, retirementApprovers, retirementBlocker, RetirementRequestBody, RetirementStepBody, type RetirementState } from '@ff/contracts';
import { z } from 'zod';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PolicyRepo } from '../policy-repos';
import { SafetyProfileService } from './safety-profile.service';

interface Retirement extends RetirementState {
  retirementId: string;
  flagKey: string;
  featureId: string;
  featureVersion: string;
  fClass: string;
  reason: string;
  nextReleaseAt: string | null;
  requestedBy: string;
  requestedAt: string;
  status: 'REQUESTED' | 'APPROVED' | 'RETIRED' | 'CLOSED';
}

const pad = (n: number) => String(n).padStart(5, '0');
const EmptyBody = z.object({}).strict();

@Injectable()
@PlatformComponent('D01-01')
export class RetirementService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
    private readonly profiles: SafetyProfileService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  private load(id: string): Retirement {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM flag_retirement WHERE retirement_id = ?', id);
    if (!r) throw new DomainError('NOT_FOUND', `${id} Retirement 건을 찾을 수 없습니다.`);
    return JSON.parse(r.doc) as Retirement;
  }

  private save(r: Retirement) {
    this.db.run('UPDATE flag_retirement SET status = ?, doc = ? WHERE retirement_id = ?', r.status, JSON.stringify(r), r.retirementId);
  }

  private view(r: Retirement) {
    const due = codeRemovalDue(r.approvedAt, r.nextReleaseAt);
    const overdue = !!due && !r.steps.CODE_REMOVED && this.clock.iso() > due;
    return { ...r, requiredApprovals: retirementApprovers(r.fClass), codeRemovalDue: due, overdue, next: RETIREMENT_STEPS.find((s) => s.step > 1 && !r.steps[s.key])?.key ?? null };
  }

  list() {
    return this.db.all<{ doc: string }>('SELECT doc FROM flag_retirement ORDER BY retirement_id DESC').map((r) => this.view(JSON.parse(r.doc) as Retirement));
  }

  request(actor: Actor, body: RetirementRequestBody) {
    const p = this.policies.all().find((x) => x.flagKey === body.flagKey && (x.status === 'DEPLOYED' || x.status === 'APPROVED')) ?? this.policies.all().filter((x) => x.flagKey === body.flagKey).at(-1);
    if (!p) throw new DomainError('NOT_FOUND', `${body.flagKey} 정책이 없습니다.`);
    if (this.db.get("SELECT 1 FROM flag_retirement WHERE flag_key = ? AND status != 'CLOSED'", body.flagKey)) throw new DomainError('CONFLICT', `${body.flagKey}은(는) 이미 Retirement 진행 중입니다.`);
    const n = (this.db.get<{ n: number }>('SELECT count(*) AS n FROM flag_retirement')?.n ?? 0) + 1;
    const r: Retirement = {
      retirementId: `RET-${pad(n)}`,
      flagKey: body.flagKey,
      featureId: p.featureId,
      featureVersion: p.featureVersion,
      fClass: this.profiles.ensure(p.featureId, p.featureVersion).fClass,
      reason: body.reason,
      nextReleaseAt: body.nextReleaseAt,
      requestedBy: actor.id,
      requestedAt: this.clock.iso(),
      status: 'REQUESTED',
      approvals: [],
      approvedAt: null,
      steps: {},
    };
    this.db.tx(() => {
      this.db.run('INSERT INTO flag_retirement (retirement_id, flag_key, status, doc) VALUES (?, ?, ?, ?)', r.retirementId, r.flagKey, r.status, JSON.stringify(r));
      this.audit.record(actor, 'FLAG_RETIREMENT_REQUEST', r.retirementId, { after: { flagKey: r.flagKey, featureId: r.featureId, fClass: r.fClass, reason: r.reason }, componentId: 'D01-01' });
    });
    return this.view(r);
  }

  /** 1단계 — 필요한 역할이 모두 승인하면 Decision Record(감사)와 함께 APPROVED. 요청자는 승인할 수 없다 */
  approve(actor: Actor, id: string) {
    const r = this.load(id);
    const need = retirementApprovers(r.fClass);
    if (r.status !== 'REQUESTED') throw new DomainError('GUARD_FAILED', `${r.status} Retirement 건은 승인할 수 없습니다.`);
    if (actor.id === r.requestedBy || r.approvals.some((a) => a.by === actor.id)) {
      this.audit.failed(actor, 'FLAG_RETIREMENT_APPROVE', id, '요청자·같은 승인자 중복', 'D01-01');
      throw new DomainError('SEPARATION_OF_DUTY', '요청자나 이미 승인한 사람은 승인할 수 없습니다.');
    }
    if (!need.includes(actor.role) || r.approvals.some((a) => a.role === actor.role)) throw new DomainError('FORBIDDEN', `필요한 승인 역할: ${need.join(', ')}`);
    const at = this.clock.iso();
    r.approvals.push({ by: actor.id, role: actor.role, at });
    if (need.every((role) => r.approvals.some((a) => a.role === role))) {
      r.approvedAt = at;
      r.status = 'APPROVED';
    }
    this.db.tx(() => {
      this.save(r);
      this.audit.record(actor, 'FLAG_RETIREMENT_APPROVE', id, { after: { approvals: r.approvals, status: r.status, codeRemovalDue: codeRemovalDue(r.approvedAt, r.nextReleaseAt) }, componentId: 'D01-01' });
    });
    return this.view(r);
  }

  /** 2단계 집계 — 상태 보고(v2)의 최신 Feature Version으로 구 Version 사용 차량, 이 Flag 정책을 받았지만 보고가 없는 차량은 확인 불가 */
  private remaining(r: Retirement) {
    const latest = new Map(this.db.all<{ vin: string; doc: string }>('SELECT vin, doc FROM vehicle_feature_status WHERE feature_id = ?', r.featureId).map((x) => [x.vin, (JSON.parse(x.doc) as { feature?: { version?: string } }).feature?.version ?? null]));
    const targets = new Set(this.db.all<{ doc: string }>("SELECT doc FROM publication WHERE kind = 'POLICY'").flatMap((x) => {
      const p = JSON.parse(x.doc) as { payload: { flagKey: string | null; targets: string[] } };
      return p.payload.flagKey === r.flagKey ? p.payload.targets : [];
    }));
    const onOld = [...latest].filter(([, v]) => v === r.featureVersion).map(([vin]) => vin).sort();
    const unknown = [...targets].filter((vin) => !latest.has(vin)).sort();
    return { onOldVersion: onOld, unreported: unknown, at: this.clock.iso() };
  }

  /** 2~6단계 — 순서·완료 조건(retirementBlocker). 5단계에서 Registry 퇴역(ID 재사용 금지)과 배포 정책 RETIRED */
  step(actor: Actor, id: string, body: RetirementStepBody) {
    const r = this.load(id);
    const blocker = retirementBlocker(r, body, retirementApprovers(r.fClass));
    if (blocker) {
      this.audit.failed(actor, `FLAG_RETIREMENT_${body.step}`, id, blocker, 'D01-01');
      throw new DomainError('GUARD_FAILED', blocker, { rule: 'FFG-LCY-011' });
    }
    const at = this.clock.iso();
    const data: Record<string, unknown> = body.step === 'REMAINING_VEHICLES' ? this.remaining(r) : { ...body };
    r.steps[body.step] = { at, by: actor.id, data };
    this.db.tx(() => {
      if (body.step === 'REGISTRY_RETIRED') {
        this.db.run('UPDATE flag_registry SET retired_at = ? WHERE flag_key = ?', at, r.flagKey);
        for (const p of this.policies.all().filter((x) => x.flagKey === r.flagKey && x.status === 'DEPLOYED')) this.policies.update({ ...p, status: 'RETIRED' });
        r.status = 'RETIRED';
      }
      if (body.step === 'RECORDS_RETAINED') r.status = 'CLOSED';
      this.save(r);
      this.audit.record(actor, `FLAG_RETIREMENT_${body.step}`, id, { after: { flagKey: r.flagKey, ...data }, componentId: 'D01-01' });
      this.events.publish('flag.retirement.step', id, { retirementId: id, flagKey: r.flagKey, step: body.step, status: r.status }, { componentId: 'D01-01', correlationId: actor.correlationId });
    });
    return this.view(r);
  }
}

@Controller('api/flag-retirements')
export class RetirementController {
  constructor(private readonly svc: RetirementService) {}

  @Get()
  list() {
    return { items: this.svc.list(), steps: RETIREMENT_STEPS };
  }

  @Post()
  @HttpCode(201)
  @Roles('FEATURE_AUTHOR', 'RELEASE_MANAGER')
  @AuditAction('FLAG_RETIREMENT_REQUEST')
  request(@CurrentActor() actor: Actor, @Body(new ZodPipe(RetirementRequestBody)) body: RetirementRequestBody) {
    return this.svc.request(actor, body);
  }

  @Post(':id/approvals')
  @HttpCode(201)
  @Roles('FEATURE_APPROVER', 'SAFETY_OFFICER')
  @AuditAction('FLAG_RETIREMENT_APPROVE')
  approve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(EmptyBody)) _body: Record<string, never>) {
    return this.svc.approve(actor, id);
  }

  @Post(':id/steps')
  @HttpCode(201)
  @Roles('FEATURE_AUTHOR', 'RELEASE_MANAGER', 'IMPLEMENTER', 'REGULATORY_OWNER')
  @AuditAction('FLAG_RETIREMENT_STEP')
  step(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(RetirementStepBody)) body: RetirementStepBody) {
    return this.svc.step(actor, id, body);
  }
}
