import { CreateExceptionBody, EXCEPTION_KIND_LABEL, EXCEPTION_REQUIRED_APPROVALS, ExceptionDecisionBody, ExceptionRevokeBody, approvalProblems, exceptionDue, finalExpiry, gatePendingProblems, requestProblems, type ExceptionPolicy } from '@ff/contracts';
import { registerSimExpiryPreflight, registerSimHandler, registerSimReader, registerSimTask } from './engine';
import type { SimWriteContext } from './types';
import { GX, GX_HISTORY, closeGx, gxExceptions, gxFeature, gxGateFacts, gxLog, gxPolicy, gxRelease, gxScope, gxView, sweepGx } from './gx-state';

const COMPONENT = 'D03-02';
const reads = ['exceptionPolicies', 'exceptionPolicy', 'policyReleaseGate', 'listPolicies', 'policyDetail', 'activationDecide', 'softwareDownload'];
const writes = ['createExceptionPolicy', 'decideExceptionPolicy', 'revokeExceptionPolicy', 'deployPolicy', 'stageRollout', 'checkSoftwareDownload'];
const systemContext = (ctx: SimWriteContext): SimWriteContext => ({ ...ctx, actor: { ...ctx.actor, id: 'system:exception', role: 'SYSTEM' }, audit: (entry) => ctx.audit({ ...entry, actorId: 'system:exception', actorRole: 'SYSTEM' }) });
registerSimExpiryPreflight([...reads, ...writes], async (ctx) => sweepGx(systemContext(ctx)));
registerSimTask('gx.expire', async (ctx) => sweepGx(systemContext(ctx)));

registerSimReader('exceptionPolicies', async (ctx) => {
  const q = ctx.req.query;
  const items = (await gxExceptions(ctx)).filter((e) => (!q.status || e.status === q.status) && (!q.featureId || e.featureId === q.featureId) && (!q.featureVersion || e.featureVersion === q.featureVersion) && (!q.policyId || e.policyId === q.policyId || e.applications.some((a) => a.policyId === q.policyId))).map((e) => gxView(e, ctx)).filter((e) => q.active !== 'true' || e.active).reverse();
  return { items, active: items.filter((e) => e.active).length };
});
registerSimReader('exceptionPolicy', async (ctx) => {
  const e = (await gxExceptions(ctx)).find((x) => x.exceptionId === ctx.req.params.id);
  return e ? { ...gxView(e, ctx), history: ctx.get<{ events: any[] }>(GX_HISTORY, e.exceptionId)?.events ?? [] } : undefined;
});
registerSimReader('policyReleaseGate', async (ctx) => gxRelease(ctx, await gxPolicy(ctx, ctx.req.params.id)));

async function requireException(ctx: SimWriteContext) {
  const e = (await gxExceptions(ctx)).find((x) => x.exceptionId === ctx.req.params.id);
  return e ?? ctx.fail('NOT_FOUND', '예외를 찾을 수 없습니다.');
}

registerSimHandler('createExceptionPolicy', async (ctx) => {
  const body = ctx.req.body as CreateExceptionBody;
  const problems = requestProblems(body);
  if (problems.length) ctx.fail('GUARD_FAILED', problems.map((p) => p.message).join(' · '), { problems }, { action: 'EXCEPTION_REQUEST', target: `${body.featureId}@${body.featureVersion}`, reason: problems[0].message, componentId: COMPONENT });
  await gxFeature(ctx, body.featureId, body.featureVersion);
  if (body.kind === 'BYPASS') {
    const p = await gxPolicy(ctx, body.policyId!);
    if (p.featureId !== body.featureId || p.featureVersion !== body.featureVersion) ctx.fail('GUARD_FAILED', '예외 요청과 정책의 Feature Version이 다릅니다.');
    if (p.status !== 'APPROVED') ctx.fail('GUARD_FAILED', '승인된(APPROVED) 정책의 배포에만 임시 우회를 둘 수 있습니다.');
  } else {
    const gp = gatePendingProblems(body.gates, (await gxGateFacts(ctx, body.featureId, body.featureVersion)).latest);
    if (gp.length) ctx.fail('GUARD_FAILED', gp.map((p) => p.message).join(' · '), { problems: gp });
  }
  const all = await gxExceptions(ctx);
  const duplicate = all.find((e) => ['REQUESTED', 'APPROVING', 'ACTIVE'].includes(e.status) && !exceptionDue(e, ctx.iso()) && e.kind === body.kind && e.featureId === body.featureId && e.featureVersion === body.featureVersion && e.policyId === body.policyId && (e.kind === 'BYPASS' ? e.checks.some((c) => body.checks.includes(c)) : e.gates.some((g) => body.gates.includes(g))));
  if (duplicate) ctx.fail('CONFLICT', `같은 대상의 예외 ${duplicate.exceptionId}가 이미 있습니다.`);
  const id = ctx.nextId('EXC', all.map((e) => e.exceptionId), 5);
  const e: ExceptionPolicy = { ...body, exceptionId: id, status: 'REQUESTED', requestedBy: ctx.actor.id, requestedAt: ctx.iso(), approvals: [], rejection: null, appliedAt: null, expiresAt: null, applications: [], closedAt: null, revert: null };
  ctx.put(GX, id, { ...e, provenance: 'LOCAL_SIMULATION' }, { created: true }); gxLog(ctx, id, 'REQUESTED', { reason: e.reason, periodHours: e.periodHours });
  ctx.audit({ action: 'EXCEPTION_REQUEST', target: id, after: { status: e.status, kind: e.kind }, reason: e.reason, componentId: COMPONENT });
  ctx.emit('exception.requested', `${e.featureId}@${e.featureVersion}`, { exceptionId: id, kind: e.kind, kindLabel: EXCEPTION_KIND_LABEL[e.kind], featureId: e.featureId, featureVersion: e.featureVersion, policyId: e.policyId, scope: gxScope(e), restriction: e.restriction, reason: e.reason, requestedBy: e.requestedBy, approvals: 0, approvedBy: [] }, { componentId: COMPONENT });
  return gxView(e, ctx);
}, { body: CreateExceptionBody });

registerSimHandler('decideExceptionPolicy', async (ctx) => {
  const e = await requireException(ctx), id = e.exceptionId, body = ctx.req.body as ExceptionDecisionBody;
  const problems = approvalProblems(e, ctx.actor.id, body, ctx.iso());
  if (problems.length) ctx.fail(problems.some((p) => ['SELF_APPROVAL', 'SAME_APPROVER'].includes(p.code)) ? 'SEPARATION_OF_DUTY' : problems[0].code === 'NOT_PENDING' ? 'CONFLICT' : 'GUARD_FAILED', problems.map((p) => p.message).join(' · '), { problems }, { action: `EXCEPTION_${body.decision}`, target: id, reason: problems[0].message, componentId: COMPONENT });
  if (body.decision === 'APPROVE' && e.kind === 'GATE_PENDING') {
    const gp = gatePendingProblems(e.gates, (await gxGateFacts(ctx, e.featureId, e.featureVersion)).latest).filter((p) => p.code === 'GATE_FAILED');
    if (gp.length) ctx.fail('GUARD_FAILED', gp.map((p) => p.message).join(' · '), { problems: gp });
  }
  let next: ExceptionPolicy;
  if (body.decision === 'REJECT') next = { ...e, status: 'REJECTED', rejection: { by: ctx.actor.id, at: ctx.iso(), reason: body.reason }, closedAt: ctx.iso() };
  else {
    const approvals = [...e.approvals, { by: ctx.actor.id, role: ctx.actor.role, at: ctx.iso(), reason: body.reason, expiresAt: new Date(body.expiresAt!).toISOString() }];
    next = approvals.length >= EXCEPTION_REQUIRED_APPROVALS ? { ...e, approvals, status: 'ACTIVE', appliedAt: ctx.iso(), expiresAt: finalExpiry(ctx.iso(), e.periodHours, approvals.map((a) => a.expiresAt)) } : { ...e, approvals, status: 'APPROVING' };
  }
  ctx.put(GX, id, { ...next, provenance: 'LOCAL_SIMULATION' }); gxLog(ctx, id, next.status === 'APPROVING' ? 'APPROVED_1' : next.status, { reason: body.reason, expiresAt: body.expiresAt ?? null, finalExpiresAt: next.expiresAt });
  if (next.status === 'ACTIVE') ctx.later(Math.max(0, Date.parse(next.expiresAt!) - ctx.now().getTime()), 'gx.expire', { exceptionId: id });
  ctx.audit({ action: `EXCEPTION_${body.decision}`, target: id, before: { status: e.status }, after: { status: next.status, approvals: next.approvals.length, expiresAt: next.expiresAt }, reason: body.reason, componentId: COMPONENT });
  const event = next.status === 'ACTIVE' ? 'exception.activated' : next.status === 'REJECTED' ? 'exception.rejected' : 'exception.requested';
  ctx.emit(event, `${next.featureId}@${next.featureVersion}`, { exceptionId: id, featureId: next.featureId, featureVersion: next.featureVersion, requestedBy: next.requestedBy, approvals: next.approvals.length, approvedBy: next.approvals.map((a) => a.by), expiresAt: next.expiresAt, reason: body.reason, ...(next.status === 'REJECTED' ? { rejectedBy: ctx.actor.id } : {}) }, { componentId: COMPONENT });
  return gxView({ ...next, provenance: 'LOCAL_SIMULATION' } as ExceptionPolicy, ctx);
}, { body: ExceptionDecisionBody });

registerSimHandler('revokeExceptionPolicy', async (ctx) => {
  const e = await requireException(ctx);
  if (!['REQUESTED', 'APPROVING', 'ACTIVE'].includes(e.status)) ctx.fail('CONFLICT', `${e.status} 예외는 회수할 수 없습니다.`);
  return gxView(await closeGx(ctx, e, 'REVOKED', (ctx.req.body as ExceptionRevokeBody).reason), ctx);
}, { body: ExceptionRevokeBody });
