// Gate 해당 없음(N/A) 요청·승인(P10, D01-02 · FR-REG-005-008·013) — 판정자가 사유와 함께 요청하고, 다른 사람(Safety Manager)이 승인하면
// N/A Gate Record가 남는다(사유·요청자·승인자, 승인자 서명). G1·G4·G9와 ASIL QM 아닌 G2·G7은 N/A로 둘 수 없다(contracts gateNaBlocker).
// N/A는 필수 Gate에서 빠져 Go/No-Go·전이에서 통과로 본다. 강제 통과가 아니라 '해당 없음'을 두 사람이 확인한 기록이다(FFG-LCY-002).
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { GATE_META, gateNaBlocker, GateNaDecisionBody, GateNaRequestBody, gateStageBlocker, type GateNaRequest, type GateRecordRow } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { LifecycleService } from '../registry/lifecycle.service';
import { GateRepo } from '../repos';
import { GateDecisionService } from './gate-decision.service';

@Injectable()
@PlatformComponent('D01-02')
export class GateNaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly gates: GateRepo,
    private readonly lifecycle: LifecycleService,
    private readonly decisions: GateDecisionService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  private load(id: string): GateNaRequest {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM gate_na_request WHERE request_id = ?', id);
    if (!r) throw new DomainError('NOT_FOUND', `${id} 해당 없음 요청을 찾을 수 없습니다.`);
    return JSON.parse(r.doc);
  }

  list(featureId: string, version: string): GateNaRequest[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM gate_na_request WHERE feature_id = ? AND version = ? ORDER BY request_id', featureId, version).map((r) => JSON.parse(r.doc));
  }

  /** 지금 둘 수 없으면 사유 — N/A 대상 Gate·단계 순서·읽기 전용(요청·승인 둘 다 다시 본다) */
  private blocker(featureId: string, version: string, gate: GateNaRequest['gate'], role: string): string | null {
    const f = this.lifecycle.require(featureId, version);
    const na = gateNaBlocker(gate, f.asil);
    if (na) return na;
    const latest = this.gates.latest(featureId, version);
    if (latest[gate]?.status === 'N/A') return `${gate}은(는) 이미 해당 없음(N/A)입니다.`;
    // 단계 순서는 판정과 같다. 기능안전 담당자는 승인자로서 G7 밖의 Gate도 확인한다(역할 제한은 판정 몫)
    const stage = gateStageBlocker({ lifecycle: f.lifecycle, gate, role: role === 'SAFETY_OFFICER' ? 'GATE_JUDGE' : role, latest: Object.fromEntries(Object.entries(latest).map(([g, r]) => [g, r?.status ?? null])) });
    return stage?.reason ?? null;
  }

  request(actor: Actor, featureId: string, version: string, body: GateNaRequestBody): GateNaRequest {
    const target = `${featureId}@${version}#${body.gate}`;
    const why = this.blocker(featureId, version, body.gate, actor.role);
    if (why) {
      this.audit.failed(actor, 'GATE_NA_REQUEST', target, why, 'D01-02');
      throw new DomainError('GUARD_FAILED', why);
    }
    if (this.db.get("SELECT 1 FROM gate_na_request WHERE feature_id = ? AND version = ? AND gate = ? AND status = 'PENDING'", featureId, version, body.gate))
      throw new DomainError('CONFLICT', `${body.gate} 해당 없음 요청이 이미 승인을 기다립니다.`);
    const n = (this.db.get<{ n: number }>('SELECT count(*) AS n FROM gate_na_request')?.n ?? 0) + 1;
    const r: GateNaRequest = {
      requestId: `GNA-${String(n).padStart(5, '0')}`,
      featureId,
      version,
      gate: body.gate,
      reason: body.reason,
      status: 'PENDING',
      requestedBy: actor.id,
      requestedRole: actor.role,
      requestedAt: this.clock.iso(),
      decidedBy: null,
      decidedRole: null,
      decidedAt: null,
      decisionReason: null,
      gateRecordId: null,
    };
    return this.db.tx(() => {
      this.db.run('INSERT INTO gate_na_request (request_id, feature_id, version, gate, status, doc) VALUES (?, ?, ?, ?, ?, ?)', r.requestId, featureId, version, r.gate, r.status, JSON.stringify(r));
      this.audit.record(actor, 'GATE_NA_REQUEST', target, { after: { requestId: r.requestId, gate: r.gate }, reason: r.reason, componentId: 'D01-02' });
      this.events.publish('gate.na.requested', `${featureId}@${version}`, { requestId: r.requestId, gate: r.gate, by: actor.id }, { componentId: 'D01-02', correlationId: actor.correlationId });
      return r;
    });
  }

  /** 승인·반려 — 요청자는 결정할 수 없다. 승인하면 N/A Gate Record + 승인자 서명, 자동 전이 조건이 갖춰지면 같은 트랜잭션에서 전이 */
  decide(actor: Actor, requestId: string, body: GateNaDecisionBody) {
    const r = this.load(requestId);
    const target = `${r.featureId}@${r.version}#${r.gate}`;
    const action = `GATE_NA_${body.decision}`;
    if (r.status !== 'PENDING') throw new DomainError('CONFLICT', `이미 ${r.status} 처리된 요청입니다.`);
    if (actor.id === r.requestedBy) {
      this.audit.failed(actor, action, target, '요청자 본인 결정 시도(직무 분리)', 'D01-02');
      throw new DomainError('SEPARATION_OF_DUTY', '해당 없음을 요청한 사람은 같은 요청을 승인·반려할 수 없습니다.');
    }
    const why = body.decision === 'APPROVE' ? this.blocker(r.featureId, r.version, r.gate, actor.role) : null;
    if (why) {
      this.audit.failed(actor, action, target, why, 'D01-02');
      throw new DomainError('GUARD_FAILED', why);
    }
    return this.db.tx(() => {
      const at = this.clock.iso();
      const next: GateNaRequest = { ...r, status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor.id, decidedRole: actor.role, decidedAt: at, decisionReason: body.reason };
      let record: GateRecordRow | null = null;
      let feature = this.lifecycle.require(r.featureId, r.version);
      if (body.decision === 'APPROVE') {
        const prev = this.gates.latest(r.featureId, r.version)[r.gate];
        record = {
          gateRecordId: this.gates.nextId(r.gate),
          featureId: r.featureId,
          featureVersion: r.version,
          country: feature.country,
          gate: r.gate,
          gateName: GATE_META[r.gate].name,
          inputResult: 'N/A',
          rationale: `해당 없음 — ${r.reason}`,
          evidenceRef: r.requestId,
          judgeRole: GATE_META[r.gate].judgeRole,
          judgedAt: this.clock.kst(),
          status: 'N/A',
          gateStageLifecycle: GATE_META[r.gate].stage,
          currentLifecycle: feature.lifecycle,
          transitionNote: `해당 없음 승인 — 요청 ${r.requestedBy}, 승인 ${actor.id}${prev ? ` · 이전 ${prev.gateRecordId}(${prev.status}) 대체` : ''}`,
          _missing: {},
        };
        this.gates.insert(record);
        const decision = this.decisions.sign(record, { id: actor.id, role: actor.role }, 'PLATFORM');
        next.gateRecordId = record.gateRecordId;
        this.audit.record(actor, `GATE_JUDGE ${r.gate}`, target, { before: prev ? { gateRecordId: prev.gateRecordId, status: prev.status } : null, after: { gateRecordId: record.gateRecordId, status: 'N/A', requestId: r.requestId, requestedBy: r.requestedBy, decisionKid: decision.signature.kid }, reason: r.reason, componentId: 'D01-02' });
        this.events.publish('gate.judged', `${r.featureId}@${r.version}`, { gateRecordId: record.gateRecordId, gate: r.gate, status: 'N/A', by: actor.id }, { componentId: 'D01-02', correlationId: actor.correlationId });
      }
      this.db.run('UPDATE gate_na_request SET status = ?, doc = ? WHERE request_id = ?', next.status, JSON.stringify(next), next.requestId);
      this.audit.record(actor, action, target, { before: { status: 'PENDING' }, after: { status: next.status, gateRecordId: next.gateRecordId }, reason: body.reason, componentId: 'D01-02' });
      if (record) feature = this.lifecycle.autoAdvance(feature, actor.correlationId);
      return { request: next, record, feature };
    });
  }
}

@Controller('api/features')
export class GateNaController {
  constructor(private readonly svc: GateNaService) {}

  @Get(':id/versions/:ver/gate-na-requests')
  list(@Param('id') id: string, @Param('ver') ver: string) {
    return { items: this.svc.list(id, ver) };
  }

  @Post(':id/versions/:ver/gate-na-requests')
  @Roles('GATE_JUDGE', 'SAFETY_OFFICER')
  @AuditAction('GATE_NA_REQUEST')
  request(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(GateNaRequestBody)) body: GateNaRequestBody) {
    return this.svc.request(actor, id, ver, body);
  }
}

@Controller('api/gate-na-requests')
export class GateNaDecisionController {
  constructor(private readonly svc: GateNaService) {}

  @Post(':rid/decision')
  @HttpCode(200)
  @Roles('SAFETY_OFFICER')
  @AuditAction('GATE_NA_DECISION')
  decide(@CurrentActor() actor: Actor, @Param('rid') rid: string, @Body(new ZodPipe(GateNaDecisionBody)) body: GateNaDecisionBody) {
    return this.svc.decide(actor, rid, body);
  }
}
