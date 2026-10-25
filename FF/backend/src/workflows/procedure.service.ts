// 업무 절차 실행 (docs/65-workflows C3·실행 UI) — 활동 완료를 서버에 저장하고 감사·이벤트로 남긴다.
// 완료는 조직 역할(R·A) 기준으로 인증하고, Evidence·개인 서명(HSM)을 함께 보관한다. 준비되지 않은 활동은 막는다.
// 검토함·요약은 준비된 활동(앞 활동 완료)을 내 조직 역할(R=할 일, A=검토)로 나눠 돌려준다. SLA는 앞 활동 완료 시각부터 센다.
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, OnApplicationShutdown, OnModuleInit, Param, Post } from '@nestjs/common';
import {
  HUMAN_ROLES,
  jcs,
  ProcedureCompleteBody,
  readyActivityIds,
  predecessorsOf,
  type ProcedureCompletion,
  type ProcedureEvidence,
  type ProcedureInboxItem,
  type ProcedureInboxView,
  type ProcedureSignature,
  type ProcedureStateView,
  type ProcedureSummary,
  type WorkflowIndexActivity,
  type WorkflowIndexDoc,
} from '@ff/contracts';
import { WORKFLOW_INDEX } from '../generated/workflow-index';
import { AuditAction, CurrentActor, Roles, type Actor } from '../kernel/actor';
import { AuditService } from '../kernel/audit.service';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { DomainError } from '../kernel/errors';
import { EventService } from '../kernel/event.service';
import { sha256hex } from '../kernel/crypto';
import { ZodPipe } from '../kernel/zod.pipe';
import { HsmService } from '../domains/d06-qsec/pki-kms/hsm.service';

const ACTION_COMPLETE = 'PROCEDURE_ACTIVITY_COMPLETE';
const ACTION_UNDO = 'PROCEDURE_ACTIVITY_UNDO';
const COMPONENT = 'D04-04';
const INDEX: WorkflowIndexDoc = WORKFLOW_INDEX;
const BY_ID = new Map(INDEX.activities.map((a) => [a.id, a]));
const ROLE_NAME = new Map(INDEX.roles.map((r) => [r.id, r.name]));
const PERSONA = new Map(Object.entries(INDEX.personas));
const PREDS = predecessorsOf(INDEX);

interface Row {
  id: number;
  activity_id: string;
  process_id: string;
  role_id: string;
  completed_by: string;
  completed_role: string;
  completed_at: string;
  note: string | null;
  evidence_doc: string;
  signature_doc: string | null;
  undone_at: string | null;
  undone_by: string | null;
}

/** 서명 대상 — 저장 열과 같은 값으로 다시 만들어 검증한다 */
function signable(c: Omit<ProcedureCompletion, 'signature' | 'signatureValid'>) {
  return jcs({
    activityId: c.activityId,
    processId: c.processId,
    roleId: c.roleId,
    completedBy: c.completedBy,
    completedRole: c.completedRole,
    completedAt: c.completedAt,
    note: c.note,
    evidence: c.evidence,
  });
}

@Injectable()
export class ProcedureService implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly hsm: HsmService,
  ) {}

  onModuleInit() {
    // 60초마다 기한 초과를 훑는다(테스트는 수동 — sweep()을 직접 부른다). 타이머는 프로세스를 붙잡지 않는다.
    if (process.env.FF_SCHEDULER === 'manual') return;
    this.timer = setInterval(() => {
      try {
        this.sweep();
      } catch {
        // 한 주기의 실패가 서버를 죽이지 않게 — 다음 주기에 다시 본다
      }
    }, 60_000);
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  // ── 인증·역할 ─────────────────────────────────────────────
  /** 이 행위자의 조직 역할 — 데모 계정(usr-<persona>)이면 페르소나 표, 아니면 보낸 IAM 역할로 조직 역할을 찾는다 */
  orgRoles(actor: Actor): string[] {
    const persona = actor.id.startsWith('usr-') ? actor.id.slice(4) : null;
    const byPersona = persona ? PERSONA.get(persona) : undefined;
    const ids = byPersona?.length ? byPersona : INDEX.roles.filter((r) => r.platformRoles.includes(actor.role)).map((r) => r.id);
    return [...new Set(ids)];
  }

  /** 이 활동에서 내 칸 — R이면 할 일(TODO), A만이면 검토(REVIEW) */
  private kindOf(a: WorkflowIndexActivity, orgs: string[]): { kind: 'TODO' | 'REVIEW'; roleId: string } | null {
    const r = a.raci.R.find((id) => orgs.includes(id));
    if (r) return { kind: 'TODO', roleId: r };
    if (orgs.includes(a.raci.A)) return { kind: 'REVIEW', roleId: a.raci.A };
    return null;
  }

  private platformRoles(roleId: string): string[] {
    return INDEX.roles.find((r) => r.id === roleId)?.platformRoles ?? [];
  }

  private displayRoles(roleIds: string[]): string {
    return [...new Set(roleIds)].map((id) => `${ROLE_NAME.get(id) ?? id}(${id})`).join(', ');
  }

  // ── 완료 상태 ─────────────────────────────────────────────
  private rows(): Row[] {
    return this.db.all<Row>('SELECT * FROM procedure_completion WHERE undone_at IS NULL ORDER BY id');
  }

  private parse(r: Row): ProcedureCompletion {
    const base = {
      activityId: r.activity_id,
      processId: r.process_id,
      roleId: r.role_id,
      completedBy: r.completed_by,
      completedRole: r.completed_role,
      completedAt: r.completed_at,
      note: r.note,
      evidence: JSON.parse(r.evidence_doc) as ProcedureEvidence[],
    };
    const signature = JSON.parse(r.signature_doc ?? 'null') as ProcedureSignature | null;
    const canonical = signable(base);
    // 검증할 키는 서명 안의 자기 신고 값이 아니라 서버가 기록한 완료 담당자로 정한다.
    // 서명 선택 여부와 무관하게 검증한다. 없는 서명은 검증을 통과하지 않으며, API에는 기존대로 null을 돌려준다.
    const verified = this.hsm.verifyApproval(base.completedBy, canonical, signature?.value ?? '');
    const signatureValid = signature === null
      ? null
      : verified && signature.signedBy === base.completedBy && signature.signedAt === base.completedAt && signature.digest === sha256hex(canonical);
    return { ...base, signature, signatureValid };
  }

  /** 현재 유효한 완료(활동마다 최신 1건) — 지연 로딩한 화면이 한 번에 받는다 */
  state(): ProcedureStateView {
    const byActivity = new Map<string, ProcedureCompletion>();
    for (const r of this.rows()) byActivity.set(r.activity_id, this.parse(r));
    const items = INDEX.activities.filter((a) => byActivity.has(a.id)).map((a) => byActivity.get(a.id)!);
    return { items, done: items.map((i) => i.activityId), updatedAt: items.at(-1)?.completedAt ?? null };
  }

  private doneSet(): Set<string> {
    return new Set(this.rows().map((r) => r.activity_id));
  }

  private readyAt(a: WorkflowIndexActivity, done: Set<string>): string | null {
    const preds = PREDS.get(a.id) ?? [];
    if (!preds.length) return null;
    const times = preds.map((id) => this.completionOf(id, done)?.completedAt).filter((x): x is string => !!x);
    return times.length === preds.length ? times.sort().at(-1)! : null;
  }

  private completionOf(activityId: string, done: Set<string>): ProcedureCompletion | null {
    if (!done.has(activityId)) return null;
    const r = this.db.get<Row>('SELECT * FROM procedure_completion WHERE activity_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1', activityId);
    return r ? this.parse(r) : null;
  }

  private dueAt(a: WorkflowIndexActivity, readyAt: string | null): string | null {
    return readyAt && a.slaHours ? new Date(new Date(readyAt).getTime() + a.slaHours * 3_600_000).toISOString() : null;
  }

  /** 내 검토함 — 준비된 활동을 할 일/검토로 나눈다. 기한이 지난 것은 앞에 */
  inbox(actor: Actor): ProcedureInboxView {
    const orgs = this.orgRoles(actor);
    const done = this.doneSet();
    const ready = readyActivityIds(INDEX, done, PREDS);
    const now = this.clock.now().getTime();
    const items: ProcedureInboxItem[] = [];
    for (const a of INDEX.activities) {
      if (!ready.has(a.id)) continue;
      const mine = this.kindOf(a, orgs);
      if (!mine) continue;
      const readyAt = this.readyAt(a, done);
      const dueAt = this.dueAt(a, readyAt);
      items.push({
        activityId: a.id,
        processId: a.processId,
        processName: a.processName,
        activityName: a.name,
        kind: mine.kind,
        roleId: mine.roleId,
        roleName: ROLE_NAME.get(mine.roleId) ?? mine.roleId,
        readyAt,
        dueAt,
        overdue: !!dueAt && new Date(dueAt).getTime() < now,
        gateDecision: a.gateDecision,
        anchor: a.anchor,
      });
    }
    // 기한 초과 → 기한 임박 → 생애주기 순서
    const order = new Map(INDEX.activities.map((a, i) => [a.id, i]));
    items.sort((x, y) => Number(y.overdue) - Number(x.overdue) || (x.dueAt ?? '9').localeCompare(y.dueAt ?? '9') || order.get(x.activityId)! - order.get(y.activityId)!);
    return { items, summary: this.summarize(orgs, done, items), roleIds: orgs };
  }

  private summarize(orgs: string[], done: Set<string>, items: ProcedureInboxItem[]): ProcedureSummary {
    const mine = INDEX.activities.filter((a) => this.kindOf(a, orgs));
    const doneMine = mine.filter((a) => done.has(a.id)).length;
    // 메인 화면 절차 지도 — 프로세스별 완료·내 할 일·검토·기한 초과(이름·Gate는 화면의 WORKFLOW_MAP)
    const counts = new Map(INDEX.processes.map((p) => [p.id, { id: p.id, total: 0, done: 0, todo: 0, review: 0, overdue: 0 }]));
    for (const a of INDEX.activities) {
      const c = counts.get(a.processId);
      if (!c) continue;
      c.total += 1;
      if (done.has(a.id)) c.done += 1;
    }
    for (const i of items) {
      const c = counts.get(i.processId);
      if (!c) continue;
      if (i.kind === 'TODO') c.todo += 1;
      else c.review += 1;
      if (i.overdue) c.overdue += 1;
    }
    return {
      todo: items.filter((i) => i.kind === 'TODO').length,
      review: items.filter((i) => i.kind === 'REVIEW').length,
      overdue: items.filter((i) => i.overdue).length,
      done: doneMine,
      total: mine.length,
      processes: [...counts.values()],
    };
  }

  summary(actor: Actor): ProcedureSummary {
    return this.inbox(actor).summary;
  }

  // ── 완료·취소 ─────────────────────────────────────────────
  complete(actor: Actor, activityId: string, body: ProcedureCompleteBody): ProcedureCompletion {
    const a = BY_ID.get(activityId);
    if (!a) throw new DomainError('NOT_FOUND', `${activityId} 활동이 업무 절차 모델에 없습니다.`);
    const orgs = this.orgRoles(actor);
    const mine = this.kindOf(a, orgs);
    if (!mine) {
      this.audit.denied(actor, ACTION_COMPLETE, activityId, `내 조직 역할(${orgs.join(', ') || '없음'})의 수행(R)·책임(A) 활동이 아니다`, COMPONENT);
      throw new DomainError('FORBIDDEN', `${activityId}은(는) 내 역할의 활동이 아닙니다.`);
    }
    const done = this.doneSet();
    if (done.has(activityId)) throw new DomainError('CONFLICT', `${activityId}은(는) 이미 완료되었습니다.`);
    const blockers = (PREDS.get(activityId) ?? []).filter((id) => !done.has(id)).map((id) => `${id} ${BY_ID.get(id)?.name ?? ''}`.trim());
    if (blockers.length) {
      this.audit.failed(actor, ACTION_COMPLETE, activityId, `앞 활동 미완료: ${blockers.join(', ')}`, COMPONENT);
      throw new DomainError('GUARD_FAILED', `${activityId}은(는) 앞 활동이 끝나야 시작할 수 있습니다.`, { blockers });
    }
    const at = this.clock.iso();
    const base = {
      activityId,
      processId: a.processId,
      roleId: mine.roleId,
      completedBy: actor.id,
      completedRole: actor.role,
      completedAt: at,
      note: body.note?.trim() ? body.note.trim() : null,
      evidence: body.evidence as ProcedureEvidence[],
    };
    const canonical = signable(base);
    const signature: ProcedureSignature | null = body.sign
      ? { kid: '', signedBy: actor.id, signedAt: at, digest: sha256hex(canonical), value: '' }
      : null;
    if (signature) {
      const approval = this.hsm.approve(actor.id, canonical);
      signature.kid = approval.kid;
      signature.value = approval.value;
    }
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO procedure_completion (activity_id, process_id, role_id, completed_by, completed_role, completed_at, note, evidence_doc, signature_doc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        base.activityId,
        base.processId,
        base.roleId,
        base.completedBy,
        base.completedRole,
        base.completedAt,
        base.note,
        JSON.stringify(base.evidence),
        signature ? JSON.stringify(signature) : null,
      );
      this.db.run('DELETE FROM procedure_overdue WHERE activity_id = ?', activityId);
      this.audit.record(actor, ACTION_COMPLETE, activityId, {
        after: { roleId: base.roleId, note: base.note, evidence: base.evidence.length, signed: !!signature },
        reason: base.note ?? undefined,
        componentId: COMPONENT,
      });
      this.events.publish(
        'procedure.activity.completed',
        activityId,
        {
          activityId,
          activityName: a.name,
          processId: a.processId,
          processName: a.processName,
          roleId: base.roleId,
          roleName: ROLE_NAME.get(base.roleId) ?? base.roleId,
          by: actor.id,
          next: this.nextInfo(a),
          nextRoleNames: this.nextRoleNames(a),
        },
        { componentId: COMPONENT, correlationId: actor.correlationId },
      );
    });
    return this.parse({
      id: 0,
      activity_id: base.activityId,
      process_id: base.processId,
      role_id: base.roleId,
      completed_by: base.completedBy,
      completed_role: base.completedRole,
      completed_at: base.completedAt,
      note: base.note,
      evidence_doc: JSON.stringify(base.evidence),
      signature_doc: signature ? JSON.stringify(signature) : null,
      undone_at: null,
      undone_by: null,
    });
  }

  /** 다음 활동 — 알림이 수신자를 계산할 수 있게 조직 역할과 플랫폼 역할을 함께 싣는다 */
  private nextInfo(a: WorkflowIndexActivity) {
    return a.next.map((id) => {
      const n = BY_ID.get(id)!;
      return {
        id,
        name: n.name,
        platformRoles: [...new Set([...this.platformRoles(n.raci.R[0] ?? ''), ...this.platformRoles(n.raci.A)])],
      };
    });
  }

  private nextRoleNames(a: WorkflowIndexActivity): string {
    const ids = a.next.flatMap((id) => {
      const n = BY_ID.get(id)!;
      return [n.raci.R[0], n.raci.A].filter(Boolean);
    });
    return this.displayRoles(ids);
  }

  undo(actor: Actor, activityId: string): ProcedureStateView {
    const a = BY_ID.get(activityId);
    if (!a) throw new DomainError('NOT_FOUND', `${activityId} 활동이 업무 절차 모델에 없습니다.`);
    const orgs = this.orgRoles(actor);
    const mine = this.kindOf(a, orgs);
    if (!mine) {
      this.audit.denied(actor, ACTION_UNDO, activityId, '내 역할의 활동이 아니다', COMPONENT);
      throw new DomainError('FORBIDDEN', `${activityId}은(는) 내 역할의 활동이 아닙니다.`);
    }
    const row = this.db.get<Row>('SELECT * FROM procedure_completion WHERE activity_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1', activityId);
    if (!row) throw new DomainError('NOT_FOUND', `${activityId}은(는) 완료되지 않았습니다.`);
    const at = this.clock.iso();
    this.db.tx(() => {
      this.db.run('UPDATE procedure_completion SET undone_at = ?, undone_by = ? WHERE id = ?', at, actor.id, row.id);
      this.db.run('DELETE FROM procedure_overdue WHERE activity_id = ?', activityId);
      this.audit.record(actor, ACTION_UNDO, activityId, { before: { completedBy: row.completed_by, completedAt: row.completed_at }, reason: '활동 완료 취소', componentId: COMPONENT });
      this.events.publish('procedure.activity.reopened', activityId, { activityId, processId: a.processId, by: actor.id }, { componentId: COMPONENT, correlationId: actor.correlationId });
    });
    return this.state();
  }

  // ── SLA ──────────────────────────────────────────────────
  /** 기한 초과 훑기 — 준비된 활동의 기한이 지났고 아직 알리지 않았으면 이벤트를 낸다(활동당 1회). */
  sweep(): number {
    const done = this.doneSet();
    const ready = readyActivityIds(INDEX, done, PREDS);
    const now = this.clock.now().getTime();
    let n = 0;
    for (const a of INDEX.activities) {
      if (!ready.has(a.id) || !a.slaHours) continue;
      const readyAt = this.readyAt(a, done);
      const dueAt = this.dueAt(a, readyAt);
      if (!dueAt || new Date(dueAt).getTime() > now) continue;
      if (this.db.get('SELECT 1 FROM procedure_overdue WHERE activity_id = ?', a.id)) continue;
      const roles = [...new Set([...a.raci.R, a.raci.A])];
      this.db.tx(() => {
        this.db.run('INSERT INTO procedure_overdue (activity_id, notified_at, due_at) VALUES (?, ?, ?)', a.id, this.clock.iso(), dueAt);
        this.events.publish(
          'procedure.activity.overdue',
          a.id,
          {
            activityId: a.id,
            activityName: a.name,
            processId: a.processId,
            processName: a.processName,
            dueAt,
            roleNames: this.displayRoles(roles),
            platformRoles: [...new Set(roles.flatMap((r) => this.platformRoles(r)))],
          },
          { componentId: COMPONENT },
        );
      });
      this.audit.denied({ id: 'system:sla', role: 'SYSTEM', correlationId: '' }, 'PROCEDURE_ACTIVITY_OVERDUE', a.id, `기한 초과 ${dueAt} (${a.slaHours}h)`, COMPONENT);
      n++;
    }
    return n;
  }
}

@Controller('api/procedures')
export class ProcedureController {
  constructor(private readonly procedures: ProcedureService) {}

  @Get('state')
  state(): ProcedureStateView {
    return this.procedures.state();
  }

  @Get('inbox')
  inbox(@CurrentActor() actor: Actor): ProcedureInboxView {
    return this.procedures.inbox(actor);
  }

  @Get('summary')
  summary(@CurrentActor() actor: Actor) {
    return this.procedures.summary(actor);
  }

  @Post('activities/:id/complete')
  @Roles(...HUMAN_ROLES)
  @AuditAction(ACTION_COMPLETE)
  complete(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ProcedureCompleteBody)) body: ProcedureCompleteBody) {
    return { completion: this.procedures.complete(actor, id, body) };
  }

  @Delete('activities/:id/complete')
  @HttpCode(200)
  @Roles(...HUMAN_ROLES)
  @AuditAction(ACTION_UNDO)
  undo(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.procedures.undo(actor, id);
  }
}
