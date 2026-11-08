import { canonicalJson } from './canonical';
import { executionActivity, handlesActivity, WorkflowExecutionError } from './workflow-execution';
import type { WorkflowCase, WorkflowCommandActor, WorkflowCrossCaseOfferBody, WorkflowCrossCaseReceiveBody, WorkflowExecutionModel, WorkflowHandoff } from '../core';

const fail = (code: WorkflowExecutionError['code'], message: string): never => { throw new WorkflowExecutionError(code, message); };
/** Exact output/input keys from the raw normative model; translated captions never define a relationship. */
export function workflowTransferProducts(model: WorkflowExecutionModel, from: string, to: string): string[] {
  const a = executionActivity(model, from), b = executionActivity(model, to);
  return [...new Set(a.outputs.filter(key => b.inputs.includes(key)))];
}
function version(item: WorkflowCase, expected: number) {
  if (item.version !== expected) fail('PRECONDITION_FAILED', '발신 또는 수신 업무 건이 변경됐습니다. 양쪽 최신 기록을 다시 확인하세요.');
}
export function offerCrossCaseWorkflow(model: WorkflowExecutionModel, source: WorkflowCase, target: WorkflowCase, body: WorkflowCrossCaseOfferBody, who: WorkflowCommandActor, identity: { handoffId: string; payloadHash: string; artifactsHash: string }): [WorkflowCase, WorkflowCase] {
  const a = executionActivity(model, body.fromActivityId), b = executionActivity(model, body.toActivityId);
  if (a.processId !== source.processId || b.processId !== target.processId || source.caseId === target.caseId) fail('GUARD_FAILED', '서로 다른 업무 건의 해당 절차 활동을 선택하세요.');
  if (!handlesActivity(who, a)) fail('FORBIDDEN', '발신 활동의 수행·책임 역할이 아닙니다.');
  if (source.targetRef !== target.targetRef) fail('GUARD_FAILED', '대상·변경 참조가 같은 업무 건으로만 인계할 수 있습니다.');
  const keys = workflowTransferProducts(model, a.id, b.id);
  if (!keys.length) fail('GUARD_FAILED', '업무 모델에 공통 산출물→입력 관계가 없습니다.');
  const duplicate = source.handoffs.find(h => h.requestKey === body.requestKey);
  if (duplicate) {
    if (duplicate.fromAccount !== who.id || duplicate.payloadHash !== identity.payloadHash || duplicate.toCaseId !== target.caseId || !target.handoffs.some(h => h.handoffId === duplicate.handoffId && canonicalJson(h) === canonicalJson(duplicate))) fail('CONFLICT', '같은 인계 요청 번호의 담당자·내용·수신 기록이 다릅니다.');
    return [source, target];
  }
  version(source, body.version); version(target, body.targetVersion);
  if (target.activities[b.id]?.status === 'SUBMITTED' || target.activities[b.id]?.status === 'ACCEPTED') fail('CONFLICT', '수신 활동이 검토 중 또는 수락된 상태입니다. 작성 가능한 수신 업무 건을 선택하세요.');
  const accepted = source.activities[a.id];
  if (accepted?.status !== 'ACCEPTED' || !accepted.reviewedBy || accepted.reviewedBy === accepted.submittedBy) fail('GUARD_FAILED', '독립 검토가 수락된 발신 산출물만 인계할 수 있습니다.');
  if (source.handoffs.some(h => h.fromActivityId === a.id && h.toCaseId === target.caseId && h.toActivityId === b.id && h.status !== 'RETURNED')) fail('CONFLICT', '같은 수신 활동으로 보낸 인계가 있습니다.');
  const artifacts = source.artifacts.filter(v => accepted.artifactIds.includes(v.artifactId) && keys.includes(v.productKey));
  if (keys.some(key => !artifacts.some(v => v.productKey === key))) fail('GUARD_FAILED', '수락된 버전에 인계할 산출물이 빠져 있습니다.');
  const h: WorkflowHandoff = { ...identity, requestKey: body.requestKey, fromActivityId: a.id, toActivityId: b.id, fromCaseId: source.caseId, toCaseId: target.caseId, sourceVersion: source.version, sourceReview: structuredClone(accepted), artifacts: structuredClone(artifacts), fromAccount: who.id, offeredAt: who.at, note: body.note, status: 'OFFERED' };
  return [source, target].map(item => ({ ...structuredClone(item), version: item.version + 1, updatedAt: who.at, handoffs: [...structuredClone(item.handoffs), structuredClone(h)] })) as [WorkflowCase, WorkflowCase];
}
export function receiveCrossCaseWorkflow(model: WorkflowExecutionModel, source: WorkflowCase, target: WorkflowCase, handoffId: string, body: WorkflowCrossCaseReceiveBody, who: WorkflowCommandActor): [WorkflowCase, WorkflowCase] {
  const h = target.handoffs.find(h => h.handoffId === handoffId) ?? fail('NOT_FOUND', '수신 인계가 없습니다.');
  if (h.fromCaseId !== source.caseId || h.toCaseId !== target.caseId || source.caseId === target.caseId) fail('GUARD_FAILED', '인계의 발신·수신 업무 건이 다릅니다.');
  const a = executionActivity(model, h.toActivityId);
  if (a.processId !== target.processId || !handlesActivity(who, a) || who.id === h.fromAccount) fail('FORBIDDEN', '발신자와 다른 수신 활동의 수행·책임 담당자가 인수해야 합니다.');
  if (!source.handoffs.some(v => v.handoffId === handoffId && canonicalJson(v) === canonicalJson(h))) fail('CONFLICT', '양쪽 인계 기록이 일치하지 않습니다.');
  if (h.status !== 'OFFERED') {
    if (h.receivedBy === who.id && h.status === (body.decision === 'ACCEPT' ? 'ACCEPTED' : 'RETURNED') && h.reason === body.reason) return [source, target];
    fail('CONFLICT', '이미 처리된 인계입니다.');
  }
  version(source, body.sourceVersion); version(target, body.version);
  return [source, target].map(item => ({ ...structuredClone(item), version: item.version + 1, updatedAt: who.at, handoffs: item.handoffs.map(v => v.handoffId === handoffId ? { ...structuredClone(v), status: body.decision === 'ACCEPT' ? 'ACCEPTED' as const : 'RETURNED' as const, receivedBy: who.id, receivedAt: who.at, reason: body.reason } : structuredClone(v)) })) as [WorkflowCase, WorkflowCase];
}
