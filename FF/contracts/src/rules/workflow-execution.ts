import type { WorkflowActivityReviewBody, WorkflowActivitySubmitBody, WorkflowArtifact, WorkflowArtifactBody, WorkflowCase, WorkflowExecutionActivity, WorkflowExecutionModel, WorkflowHandoff, WorkflowHandoffBody, WorkflowHandoffReceiveBody } from '../schemas/workflow-execution';

export class WorkflowExecutionError extends Error {
  constructor(readonly code: 'FORBIDDEN'|'GUARD_FAILED'|'NOT_FOUND'|'CONFLICT'|'PRECONDITION_FAILED'|'VALIDATION', message: string, readonly details?: unknown) { super(message); }
}
export interface WorkflowCommandActor { id: string; roleIds: readonly string[]; at: string }
const fail = (code: WorkflowExecutionError['code'], text: string, details?: unknown): never => { throw new WorkflowExecutionError(code,text,details); };
export const executionActivity = (model: WorkflowExecutionModel, id: string) => model.processes.flatMap((p) => p.activities).find((a) => a.id === id) ?? fail('NOT_FOUND','업무 모델에 없는 활동입니다.');
export const executionProduct = (model: WorkflowExecutionModel, key: string) => model.processes.flatMap((p) => p.products).find((w) => w.key === key) ?? fail('NOT_FOUND','업무 모델에 없는 산출물입니다.');
export const handlesActivity = (actor: Pick<WorkflowCommandActor,'roleIds'>, a: WorkflowExecutionActivity, review = false) => (review ? [a.raci.A,...a.raci.C,...a.raci.R] : [...a.raci.R,a.raci.A]).some((r) => actor.roleIds.includes(r));
function writable(item: WorkflowCase, version: number, actor: WorkflowCommandActor, a: WorkflowExecutionActivity, review = false, incoming = false): WorkflowCase {
  if (item.version !== version) fail('PRECONDITION_FAILED','다른 담당자가 업무 건을 변경했습니다. 최신 기록을 불러온 뒤 다시 확인하세요.',{version:item.version});
  if (!handlesActivity(actor,a,review)) fail('FORBIDDEN','이 활동을 처리하도록 배정된 역할이 아닙니다.');
  if (a.processId !== item.processId && !item.handoffs.some((h) => h.toActivityId === a.id && (h.status === 'ACCEPTED' || incoming && h.status === 'OFFERED'))) fail('GUARD_FAILED','다른 절차의 활동은 해당 인계를 수락한 뒤 시작하세요.');
  return { ...structuredClone(item),version:item.version+1,updatedAt:actor.at };
}
export function latestWorkflowArtifacts(item: WorkflowCase, activityId: string): WorkflowArtifact[] {
  const latest = new Map<string,WorkflowArtifact>();
  for (const v of item.artifacts) if (v.activityId === activityId) latest.set(v.productKey,v);
  return [...latest.values()];
}
/** Written output is versioned; external references remain declared evidence, not verified approvals. */
export function addWorkflowArtifact(model: WorkflowExecutionModel,item: WorkflowCase,body: WorkflowArtifactBody,actor: WorkflowCommandActor,artifact: Pick<WorkflowArtifact,'artifactId'|'files'>): WorkflowCase {
  const a = executionActivity(model,body.activityId);
  const next = writable(item,body.version,actor,a);
  if (![...a.inputs,...a.outputs].includes(body.productKey)) fail('VALIDATION','이 활동의 입력·산출물에 정의된 항목을 선택하세요.');
  const wp = executionProduct(model,body.productKey);
  const keys = wp.content.map((_,i) => String(i));
  if (Object.keys(body.fields).some((k) => !keys.includes(k))) fail('VALIDATION','산출물 정의에 없는 내용 항목입니다.');
  if (!Object.values(body.fields).some((s) => s.trim()) && !body.references.length && !artifact.files.length) fail('GUARD_FAILED','작성 내용·근거 참조·첨부 중 하나 이상을 남기세요.');
  if (item.activities[a.id]?.status === 'SUBMITTED') fail('CONFLICT','검토 중인 산출물은 수정할 수 없습니다. 보완 요청 뒤 새 버전을 작성하세요.');
  if (item.activities[a.id]?.status === 'ACCEPTED') fail('CONFLICT','수락된 산출물은 보존됩니다. 변경은 새 업무 건에서 검토하세요.');
  const revision = item.artifacts.filter((x) => x.activityId === a.id && x.productKey === wp.key).length + 1;
  next.artifacts.push({artifactId:artifact.artifactId,activityId:a.id,productKey:wp.key,revision,by:actor.id,at:actor.at,fields:body.fields,references:body.references,files:artifact.files,reason:body.reason});
  if (next.activities[a.id]) delete next.activities[a.id];
  return next;
}
export function submitWorkflowActivity(model: WorkflowExecutionModel,item: WorkflowCase,activityId: string,body: WorkflowActivitySubmitBody,actor: WorkflowCommandActor): WorkflowCase {
  const a = executionActivity(model,activityId), next = writable(item,body.version,actor,a);
  if (item.activities[a.id]?.status === 'SUBMITTED') fail('CONFLICT','이미 검토를 요청한 활동입니다.');
  if (item.activities[a.id]?.status === 'ACCEPTED') fail('CONFLICT','수락된 활동은 새 산출물 버전을 작성한 뒤 다시 검토를 요청하세요.');
  const process = model.processes.find((p) => p.id === a.processId)!;
  const predecessors = process.activities.filter((p) => p.next.includes(a.id));
  const unfinished = predecessors.filter((p) => item.activities[p.id]?.status !== 'ACCEPTED');
  if (unfinished.length) fail('GUARD_FAILED','앞 활동의 검토가 끝나지 않았습니다.',{activities:unfinished.map((p) => p.id)});
  const lastHandoffs = new Map<string,WorkflowHandoff>();
  for (const h of item.handoffs) if (h.toActivityId === a.id) lastHandoffs.set(h.fromActivityId,h);
  const unreceived = [...lastHandoffs.values()].filter((h) => h.status !== 'ACCEPTED');
  if (unreceived.length) fail('GUARD_FAILED','받은 인계를 수락한 뒤 검토를 요청하세요.');
  const versions = latestWorkflowArtifacts(item,a.id);
  const missing: string[] = [];
  for (const key of a.outputs) {
    const wp = executionProduct(model,key), v = versions.find((x) => x.productKey === key);
    if (!v) { missing.push(wp.name); continue; }
    if (wp.content.some((_,i) => !v.fields[String(i)]?.trim())) missing.push(`${wp.name}: 필수 내용`);
    if (!v.references.length && !v.files.length) missing.push(`${wp.name}: 근거 참조 또는 첨부`);
  }
  if (missing.length) fail('GUARD_FAILED','필수 산출물의 내용과 근거를 보완하세요.',{missing});
  if (!a.outputs.length && !versions.some((v) => v.references.length || v.files.length)) fail('GUARD_FAILED','입력 근거 또는 처리 결과를 산출물 원장에 남기세요.');
  next.activities[a.id] = {status:'SUBMITTED',submittedBy:actor.id,submittedAt:actor.at,artifactIds:versions.map((v) => v.artifactId),note:body.note};
  return next;
}
export function reviewWorkflowActivity(model: WorkflowExecutionModel,item: WorkflowCase,activityId: string,body: WorkflowActivityReviewBody,actor: WorkflowCommandActor): WorkflowCase {
  const a = executionActivity(model,activityId), next = writable(item,body.version,actor,a,true);
  const record = next.activities[a.id];
  if (!record || record.status !== 'SUBMITTED') fail('CONFLICT','검토 요청된 활동만 판정할 수 있습니다.');
  if (record.submittedBy === actor.id || item.artifacts.some((v) => record.artifactIds.includes(v.artifactId) && v.by === actor.id)) fail('FORBIDDEN','제출자와 산출물 작성자는 자기 결과를 독립 검토할 수 없습니다.');
  next.activities[a.id] = {...record,status:body.decision === 'ACCEPT' ? 'ACCEPTED':'RETURNED',reviewedBy:actor.id,reviewedAt:actor.at,reason:body.reason};
  return next;
}
export function offerWorkflowHandoff(model: WorkflowExecutionModel,item: WorkflowCase,body: WorkflowHandoffBody,actor: WorkflowCommandActor,identity: Pick<WorkflowHandoff,'handoffId'|'payloadHash'>): WorkflowCase {
  const a = executionActivity(model,body.fromActivityId);
  if (!handlesActivity(actor,a)) fail('FORBIDDEN','이 활동을 처리하도록 배정된 역할이 아닙니다.');
  const duplicate = item.handoffs.find((h) => h.requestKey === body.requestKey);
  if (duplicate) {
    if (duplicate.fromAccount !== actor.id || duplicate.payloadHash !== identity.payloadHash) fail('CONFLICT','같은 인계 요청 번호에 다른 담당자나 내용이 있습니다.');
    return item;
  }
  const next = writable(item,body.version,actor,a);
  executionActivity(model,body.toActivityId);
  if (!a.next.includes(body.toActivityId)) fail('GUARD_FAILED','업무 모델의 다음 활동으로만 인계할 수 있습니다.');
  if (item.activities[a.id]?.status !== 'ACCEPTED') fail('GUARD_FAILED','독립 검토가 수락된 결과만 인계할 수 있습니다.');
  if (item.handoffs.some((h) => h.fromActivityId === a.id && h.toActivityId === body.toActivityId && h.status !== 'RETURNED')) fail('CONFLICT','같은 다음 활동으로 이미 인계를 보냈습니다.');
  next.handoffs.push({...identity,requestKey:body.requestKey,fromActivityId:a.id,toActivityId:body.toActivityId,fromAccount:actor.id,offeredAt:actor.at,note:body.note,status:'OFFERED'});
  return next;
}
export function receiveWorkflowHandoff(model: WorkflowExecutionModel,item: WorkflowCase,handoffId: string,body: WorkflowHandoffReceiveBody,actor: WorkflowCommandActor): WorkflowCase {
  const h = item.handoffs.find((x) => x.handoffId === handoffId) ?? fail('NOT_FOUND','인계 요청이 없습니다.');
  const a = executionActivity(model,h.toActivityId), next = writable(item,body.version,actor,a,false,true);
  if (h.status !== 'OFFERED') fail('CONFLICT','처리된 인계 요청입니다.');
  if (h.fromAccount === actor.id) fail('FORBIDDEN','보낸 사람은 자기 인계를 수락할 수 없습니다.');
  next.handoffs = next.handoffs.map((v) => v.handoffId === handoffId ? {...v,status:body.decision === 'ACCEPT'?'ACCEPTED':'RETURNED',receivedBy:actor.id,receivedAt:actor.at,reason:body.reason} : v);
  return next;
}
