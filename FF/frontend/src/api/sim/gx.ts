// 시연(정적 공개 사이트) 예외 승인 쓰기 — 서버 exception-policy.service와 같은 계약 규칙(rules/exception-policy)으로 요청·2인 승인·반려·회수를 처리한다.
// 병합 때 index.ts HANDLERS 끝에 `() => import('./gx'),` 한 줄로 연결한다(이 묶음은 sim 본문을 고치지 않는다).
// 시연 배포 흐름(policy-ops)은 예외 층을 거치지 않으므로 적용 기록이 없고, 회수·만료 원복 메시지는 '되돌릴 정책 상태 없음'이 된다.
import {
  CreateExceptionBody,
  EXCEPTION_KIND_LABEL,
  EXCEPTION_REQUIRED_APPROVALS,
  EXCEPTION_RESTRICTION_LABEL,
  EXCEPTION_STATUS_LABEL,
  ExceptionDecisionBody,
  ExceptionRevokeBody,
  RESTRICTION_CAP_BP,
  approvalProblems,
  checkLabel,
  exceptionActive,
  finalExpiry,
  requestProblems,
  type ExceptionPolicy,
} from '@ff/contracts';
import { registerSimHandler, registerSimView } from './engine';
import type { SimReadContext, SimWriteContext } from './types';

const COLL = 'exceptionPolicy';
const scope = (e: ExceptionPolicy) => (e.kind === 'GATE_PENDING' ? `PENDING Gate ${e.gates.join('·')}` : e.checks.map((c) => (c === 'COMPLIANCE_RULE' ? `${checkLabel(c)}(${e.ruleIds.join(', ')})` : checkLabel(c))).join(' · '));
const project = (e: ExceptionPolicy, ctx: SimReadContext) => {
  const now = ctx.now().toISOString();
  return {
    ...e,
    kindLabel: EXCEPTION_KIND_LABEL[e.kind],
    statusLabel: EXCEPTION_STATUS_LABEL[e.status],
    restrictionLabel: EXCEPTION_RESTRICTION_LABEL[e.restriction],
    capBasisPoints: RESTRICTION_CAP_BP[e.restriction],
    active: exceptionActive(e, now),
    remainingMs: e.expiresAt && exceptionActive(e, now) ? Date.parse(e.expiresAt) - Date.parse(now) : null,
    scope: scope(e),
  };
};

registerSimView('exceptionPolicies', { collection: COLL, idKey: 'exceptionId', filter: (e, q) => (!q.status || e.status === q.status) && (!q.featureId || e.featureId === q.featureId) && (!q.featureVersion || e.featureVersion === q.featureVersion), project });
registerSimView('exceptionPolicy', { collection: COLL, idKey: 'exceptionId', detailParam: 'id', project: (e, ctx) => ({ history: [], ...project(e, ctx) }) });

async function current(ctx: SimWriteContext, id: string): Promise<ExceptionPolicy> {
  const e = ctx.get<ExceptionPolicy>(COLL, id) ?? (await ctx.snapshot<ExceptionPolicy>('exceptionPolicy', { id }));
  if (!e) ctx.fail('NOT_FOUND', `예외 ${id}을(를) 찾을 수 없습니다.`);
  return e!;
}

registerSimHandler(
  'createExceptionPolicy',
  async (ctx) => {
    const body = ctx.req.body as CreateExceptionBody;
    const problems = requestProblems(body);
    if (problems.length) ctx.fail('GUARD_FAILED', problems.map((p) => p.message).join(' · '), { problems }, { action: 'EXCEPTION_REQUEST', target: `${body.featureId}@${body.featureVersion}`, reason: problems[0].message, componentId: 'D03-02' });
    const listed = (await ctx.snapshot<{ items: ExceptionPolicy[] }>('exceptionPolicies'))?.items ?? [];
    const id = ctx.nextId('EXC', [...listed.map((x) => x.exceptionId), ...ctx.list<ExceptionPolicy>(COLL).map((x) => x.exceptionId)]);
    const e: ExceptionPolicy = { ...body, exceptionId: id, status: 'REQUESTED', requestedBy: ctx.actor.id, requestedAt: ctx.iso(), approvals: [], rejection: null, appliedAt: null, expiresAt: null, applications: [], closedAt: null, revert: null };
    ctx.put(COLL, id, e, { created: true });
    ctx.audit({ action: 'EXCEPTION_REQUEST', target: id, after: { status: e.status, kind: e.kind }, reason: e.reason, componentId: 'D03-02' });
    ctx.emit('exception.requested', `${e.featureId}@${e.featureVersion}`, { exceptionId: id, kind: e.kind, kindLabel: EXCEPTION_KIND_LABEL[e.kind], featureId: e.featureId, featureVersion: e.featureVersion, policyId: e.policyId, scope: scope(e), restriction: e.restriction, restrictionLabel: EXCEPTION_RESTRICTION_LABEL[e.restriction], reason: e.reason, requestedBy: e.requestedBy, approvals: 0, approvedBy: [] }, { componentId: 'D03-02' });
    return e;
  },
  { body: CreateExceptionBody },
);

registerSimHandler(
  'decideExceptionPolicy',
  async (ctx) => {
    const id = ctx.req.params.id;
    const e = await current(ctx, id);
    const body = ctx.req.body as ExceptionDecisionBody;
    const now = ctx.iso();
    const problems = approvalProblems(e, ctx.actor.id, body, now);
    if (problems.length)
      ctx.fail(problems.some((p) => p.code === 'SELF_APPROVAL' || p.code === 'SAME_APPROVER') ? 'SEPARATION_OF_DUTY' : problems[0].code === 'NOT_PENDING' ? 'CONFLICT' : 'GUARD_FAILED', problems.map((p) => p.message).join(' · '), { problems }, { action: `EXCEPTION_${body.decision}`, target: id, reason: problems[0].message, componentId: 'D03-02' });
    let next: ExceptionPolicy;
    if (body.decision === 'REJECT') next = { ...e, status: 'REJECTED', rejection: { by: ctx.actor.id, at: now, reason: body.reason }, closedAt: now };
    else {
      const approvals = [...e.approvals, { by: ctx.actor.id, role: ctx.actor.role, at: now, reason: body.reason, expiresAt: new Date(body.expiresAt!).toISOString() }];
      next = approvals.length >= EXCEPTION_REQUIRED_APPROVALS ? { ...e, approvals, status: 'ACTIVE', appliedAt: now, expiresAt: finalExpiry(now, e.periodHours, approvals.map((a) => a.expiresAt)) } : { ...e, approvals, status: 'APPROVING' };
    }
    ctx.put(COLL, id, next);
    ctx.audit({ action: `EXCEPTION_${body.decision}`, target: id, before: { status: e.status }, after: { status: next.status, expiresAt: next.expiresAt }, reason: body.reason, componentId: 'D03-02' });
    return project(next, ctx);
  },
  { body: ExceptionDecisionBody },
);

registerSimHandler(
  'revokeExceptionPolicy',
  async (ctx) => {
    const id = ctx.req.params.id;
    const e = await current(ctx, id);
    if (!['REQUESTED', 'APPROVING', 'ACTIVE'].includes(e.status)) ctx.fail('CONFLICT', `${EXCEPTION_STATUS_LABEL[e.status]} 상태의 예외는 회수할 수 없습니다.`);
    const now = ctx.iso();
    const message = e.status === 'ACTIVE' ? '이 예외로 연 배포가 없어 되돌릴 정책 상태가 없습니다.' : '승인 전에 회수했습니다 — 적용된 적이 없습니다.';
    const next: ExceptionPolicy = { ...e, status: 'REVOKED', closedAt: now, revert: { at: now, message, actions: [] } };
    ctx.put(COLL, id, next);
    ctx.audit({ action: 'EXCEPTION_REVOKE', target: id, before: { status: e.status }, after: { status: 'REVOKED', revert: message }, reason: (ctx.req.body as ExceptionRevokeBody).reason, componentId: 'D03-02' });
    ctx.emit('exception.reverted', `${e.featureId}@${e.featureVersion}`, { exceptionId: id, cause: 'REVOKED', featureId: e.featureId, featureVersion: e.featureVersion, message, expiresAt: e.expiresAt, requestedBy: e.requestedBy, approvedBy: e.approvals.map((a) => a.by) }, { componentId: 'D03-02' });
    return project(next, ctx);
  },
  { body: ExceptionRevokeBody },
);
