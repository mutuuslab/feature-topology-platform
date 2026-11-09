// P10 local replay: native contracts, independent decisions, signed Gate records and tombstones.
import { canonicalJson, changeSetSummary, compareBaselines, periodBounds, POLICY_SPEC_STAGE_LABEL, POLICY_SPEC_STAGE_STATUSES, POLICY_SPEC_STAGES, policySpecStage, snapshotContent } from '@ff/contracts';
import { decisionPayload, DeleteDraftBody, draftDeletion, gateStageBlocker, GATE_META } from '@ff/contracts';
import { GateNaDecisionBody, GateNaRequestBody, gateNaBlocker } from '../../../../../contracts/src/rules/gate-outcome';
import { immediateRetireBlockers, RejectFeatureBody, RetireDecisionBody, RetireFeatureBody } from '../../../../../contracts/src/rules/feature-retire';
import { p10Registry as R } from './registry';
import { signLocalGate } from '../gate-signatures';
import { registerSimHandler, registerSimReader, SimError } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';

const rows = (value: any): any[] => Array.isArray(value) ? value : value?.items ?? [];
const base = async (ctx: SimReadContext, name: string, params: Record<string, string> = {}) => (await ctx.snapshot<any>(name, params, {})) ?? { items: [] };
const query = (ctx: SimReadContext, key: string) => ctx.req.query[key]?.trim() || undefined;
const hash = async (value: unknown) => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value))))].map((b) => b.toString(16).padStart(2, '0')).join('');

registerSimReader('gateNaRequests', async (ctx) => ({ items: (await merged(ctx, 'gateNaRequests', 'p10Na', ctx.req.params)).filter(r => r.featureId === ctx.req.params.id && r.version === ctx.req.params.ver) }));
registerSimReader('featureReviews', async (ctx) => {
  const original = await base(ctx, 'featureReviews', ctx.req.params);
  const version = query(ctx, 'version');
  return { ...original, items: mergeRows(rows(original), ctx.list('p10Reviews'), 'recordId').filter((r) => (!r.featureId || r.featureId === ctx.req.params.id) && (!version || r.version === version)) };
});
registerSimReader('featureRetireRequests', async (ctx) => {
  const original = await base(ctx, 'featureRetireRequests');
  return { ...original, items: mergeRows(rows(original), ctx.list('p10Retire'), 'requestId').filter((r) => (!query(ctx, 'featureId') || r.featureId === query(ctx, 'featureId')) && (!query(ctx, 'status') || r.status === query(ctx, 'status'))) };
});

const changedItems = (before: any, after: any) => {
  const b = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const a = after && typeof after === 'object' && !Array.isArray(after) ? after : {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).sort();
};
registerSimReader('featureHistory', async (ctx) => {
  const id = ctx.req.params.id;
  const original = await base(ctx, 'featureHistory', { id });
  const period = periodBounds(query(ctx, 'from'), query(ctx, 'to'));
  if (period.error) throw new SimError('VALIDATION', period.error, { field: 'from' });
  const from = period.from ? Date.parse(period.from) : null, to = period.to ? Date.parse(period.to) : null;
  const local = ctx.overlay.audit.filter((a) => a.result === 'ALLOWED' && (a.target === id || a.target.startsWith(`${id}@`) || a.target.startsWith(`${id}:`))).map((a) => ({ ...a, id: String(a.id), source: 'AUDIT', version: a.target.startsWith(`${id}@`) ? a.target.slice(id.length + 1).split('#')[0] : null, items: changedItems(a.before, a.after) }));
  const actorId = query(ctx, 'actorId'), version = query(ctx, 'version'), item = query(ctx, 'item');
  const items = [...local, ...rows(original)].filter((r) => (!actorId || r.actorId === actorId) && (!version || r.version === version) && (!item || r.items?.includes(item) || r.action?.includes(item)) && (from === null || Date.parse(r.at) >= from) && (to === null || Date.parse(r.at) < to)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || String(b.id).localeCompare(String(a.id)));
  return { ...original, featureId: id, filter: { actorId: actorId ?? null, version: version ?? null, item: item ?? null, from: period.from ?? null, to: period.to ?? null }, items };
});

registerSimReader('featureBaselines', async (ctx) => {
  const original = await base(ctx, 'featureBaselines', ctx.req.params);
  const all = rows(await ctx.read('baselines'));
  const items = await Promise.all(all.filter((b) => b.featureId === ctx.req.params.id).map(async (b) => ({ ...b, verified: !!b.snapshot && (await hash(snapshotContent(b.snapshot))) === b.contentHash })));
  return { ...original, featureId: ctx.req.params.id, items };
});
registerSimReader('compareBaselines', async (ctx) => {
  const leftId = query(ctx, 'left'), rightId = query(ctx, 'right');
  if (!leftId || !rightId) throw new SimError('VALIDATION', '비교할 두 Baseline을 고르세요.');
  const all = rows(await ctx.read('baselines'));
  const left = all.find((b) => b.baselineId === leftId), right = all.find((b) => b.baselineId === rightId);
  if (!left || !right) throw new SimError('NOT_FOUND', `${!left ? leftId : rightId}을(를) 찾을 수 없습니다.`);
  const items = compareBaselines(left.snapshot, right.snapshot);
  const ref = (b: any) => ({ baselineId: b.baselineId, featureId: b.featureId, version: b.version, contentHash: b.contentHash, approvedAt: b.approvedAt });
  return { left: ref(left), right: ref(right), sameFeature: left.featureId === right.featureId, items, summary: changeSetSummary(items) };
});
registerSimReader('baselineChangesets', async (ctx) => {
  const original = await base(ctx, 'baselineChangesets');
  return { ...original, items: rows(original).filter((r) => !query(ctx, 'featureId') || r.featureId === query(ctx, 'featureId')) };
});
registerSimReader('releaseCandidate', async (ctx) => {
  const original = await ctx.snapshot<any>('releaseCandidate', ctx.req.params, {});
  if (original) return original;
  await ctx.read('featureDetail', ctx.req.params);
  return { snapshot: null, verified: null };
});
registerSimReader('releaseCandidates', async (ctx) => {
  const original = await base(ctx, 'releaseCandidates');
  return { ...original, items: rows(original).filter((r) => !query(ctx, 'featureId') || (r.featureId ?? r.snapshot?.featureId) === query(ctx, 'featureId')) };
});
registerSimReader('deletedDrafts', async (ctx) => {
  const original = await base(ctx, 'deletedDrafts');
  return { ...original, items: mergeRows(rows(original), ctx.list('p10Tombstones'), 'recordId').filter((r) => !query(ctx, 'entity') || r.entity === query(ctx, 'entity')) };
});
registerSimReader('policyStages', async (ctx) => {
  const stage = query(ctx, 'stage'), featureId = query(ctx, 'featureId');
  if (stage && !(POLICY_SPEC_STAGES as readonly string[]).includes(stage)) throw new SimError('VALIDATION', `알 수 없는 정책 생애주기 값입니다: ${stage}`);
  const all = rows(await ctx.read('listPolicies')).filter((p) => !featureId || p.featureId === featureId).map((p) => ({ policyId: p.policyId, flagKey: p.flagKey, featureId: p.featureId, featureVersion: p.featureVersion, status: p.status, stage: policySpecStage(p) }));
  return { stages: POLICY_SPEC_STAGES.map((s) => ({ stage: s, label: POLICY_SPEC_STAGE_LABEL[s], statuses: POLICY_SPEC_STAGE_STATUSES[s], count: all.filter((p) => p.stage === s).length })), stage: stage ?? null, items: stage ? all.filter((p) => p.stage === stage) : all };
});


const mergeRows = (base: any[], local: any[], key: string): any[] => [...new Map([...base, ...local].map(r => [r[key], r])).values()];
async function merged(ctx: SimReadContext, route: string, collection: string, params: Record<string,string> = {}) {
  return mergeRows(rows(await base(ctx, route, params)), ctx.list(collection), 'requestId');
}
const key = (id: string, version: string) => `${id}@${version}`;
function deny(ctx: SimWriteContext, code: string, text: string, action: string, target: string, details?: unknown): never {
  return ctx.fail(code, text, details, { action, target, reason: text, componentId: ctx.req.route.component });
}
async function naBlocker(ctx: SimWriteContext, id: string, version: string, gate: any) {
  const e = await R.requireFeature(ctx, id, version);
  const latest = await R.gateLatest(ctx, id, version);
  return gateNaBlocker(gate, e.row.asil) || (latest[gate as keyof typeof latest]?.status === 'N/A' ? '이미 해당 없음(N/A)인 Gate입니다.' : null) || gateStageBlocker({ lifecycle: e.row.lifecycle, gate, role: ctx.actor.role === 'SAFETY_OFFICER' ? 'GATE_JUDGE' : ctx.actor.role, latest: Object.fromEntries(Object.entries(latest).map(([g,r]) => [g,r?.status ?? null])) })?.reason || null;
}
registerSimHandler('requestGateNa', async ctx => {
  const { id, ver } = ctx.req.params, body = ctx.req.body;
  const why = await naBlocker(ctx, id, ver, body.gate);
  if (why) deny(ctx, 'GUARD_FAILED', why, 'GATE_NA_REQUEST', key(id,ver));
  const all = await merged(ctx, 'gateNaRequests', 'p10Na', {id,ver});
  if (all.some(r => r.featureId === id && r.version === ver && r.gate === body.gate && r.status === 'PENDING')) deny(ctx,'CONFLICT','이미 대기 중인 해당 없음 요청이 있습니다.','GATE_NA_REQUEST',key(id,ver));
  const r = { requestId: ctx.nextId('GNA',all.map(r=>r.requestId)), featureId:id, version:ver, gate:body.gate, reason:body.reason, status:'PENDING',requestedBy:ctx.actor.id,requestedRole:ctx.actor.role,requestedAt:ctx.iso(),decidedBy:null,decidedRole:null,decidedAt:null,decisionReason:null,gateRecordId:null };
  ctx.put('p10Na',r.requestId,r,{created:true});ctx.audit({action:'GATE_NA_REQUEST',target:key(id,ver),after:r,reason:r.reason,componentId:'D01-02'});ctx.emit('gate.na.requested',key(id,ver),{requestId:r.requestId,gate:r.gate,by:ctx.actor.id});return r;
},{body:GateNaRequestBody});
registerSimHandler('decideGateNa', async ctx => {
  const rid=ctx.req.params.rid,body=ctx.req.body;
  let r=ctx.get<any>('p10Na',rid);
  if(!r){ for(const f of await R.allSummaries(ctx)){r=(await merged(ctx,'gateNaRequests','p10Na',{id:f.featureId,ver:f.version})).find(x=>x.requestId===rid);if(r)break;} }
  if(!r) deny(ctx,'NOT_FOUND','해당 없음 요청을 찾을 수 없습니다.','GATE_NA_DECISION',rid);
  const target=key(r.featureId,r.version),action=`GATE_NA_${body.decision}`;
  if(r.status!=='PENDING') deny(ctx,'CONFLICT','이미 처리된 요청입니다.',action,target);
  if(r.requestedBy===ctx.actor.id) deny(ctx,'SEPARATION_OF_DUTY','요청자는 같은 요청을 결정할 수 없습니다.',action,target);
  const e=await R.requireFeature(ctx,r.featureId,r.version);
  const next={...r,status:body.decision==='APPROVE'?'APPROVED':'REJECTED',decidedBy:ctx.actor.id,decidedRole:ctx.actor.role,decidedAt:ctx.iso(),decisionReason:body.reason};
  let record:any=null;
  if(body.decision==='APPROVE'){
    const why=await naBlocker(ctx,r.featureId,r.version,r.gate);if(why)deny(ctx,'GUARD_FAILED',why,action,target);
    record={gateRecordId:await R.nextGateRecordId(ctx,r.gate,r.featureId,r.version),featureId:r.featureId,featureVersion:r.version,country:e.row.country,gate:r.gate,gateName:GATE_META[r.gate as keyof typeof GATE_META].name,inputResult:'N/A',rationale:`해당 없음 — ${r.reason}`,evidenceRef:rid,judgeRole:GATE_META[r.gate as keyof typeof GATE_META].judgeRole,judgedAt:ctx.iso(),status:'N/A',gateStageLifecycle:GATE_META[r.gate as keyof typeof GATE_META].stage,currentLifecycle:e.row.lifecycle,transitionNote:`해당 없음 승인 — 요청 ${r.requestedBy}, 승인 ${ctx.actor.id}`,_missing:{}};
    const decision=await signLocalGate(ctx,decisionPayload(record,{id:ctx.actor.id,role:ctx.actor.role},'PLATFORM',e.row.baselineId??null));
    const log=ctx.state<Record<string,any[]>>('regGates',()=>({}));log[target]=[...(log[target]??[]),{record,decision}];next.gateRecordId=record.gateRecordId;
    ctx.audit({action:`GATE_JUDGE ${r.gate}`,target:target+'#'+r.gate,after:{gateRecordId:record.gateRecordId,status:'N/A',requestId:rid,requestedBy:r.requestedBy,decisionKid:decision.signature.kid,signatureSource:'LOCAL_SIMULATION'},reason:r.reason,componentId:'D01-02'});ctx.emit('gate.judged',target,{gateRecordId:record.gateRecordId,gate:r.gate,status:'N/A',by:ctx.actor.id});
  }
  ctx.put('p10Na',rid,next);ctx.audit({action,target,before:{status:r.status},after:next,reason:body.reason,componentId:'D01-02'});
  const feature=record?await R.autoAdvance(ctx,e):e;return {request:next,record,feature:feature.row};
},{body:GateNaDecisionBody});
registerSimHandler('rejectFeature',async ctx=>{
  const {id,ver}=ctx.req.params,e=await R.requireFeature(ctx,id,ver),b=ctx.req.body,target=key(id,ver);
  if(e.row.lifecycle!=='PROPOSED')deny(ctx,'GUARD_FAILED','정의 승인을 기다리는 버전만 반려할 수 있습니다.','FEATURE_REJECT',target);
  if(e.meta.createdBy===ctx.actor.id)deny(ctx,'SEPARATION_OF_DUTY','작성자는 자기 버전을 반려할 수 없습니다.','FEATURE_REJECT',target);
  const originals=rows(await base(ctx,'featureReviews',{id}));
  const r={recordId:ctx.nextId('FRV',[...originals,...ctx.list<any>('p10Reviews')].map(x=>x.recordId)),featureId:id,version:ver,kind:'REJECT',from:'PROPOSED',to:'PROPOSED',reason:b.reason,issues:b.issues,reworkReason:b.reworkReason,by:ctx.actor.id,role:ctx.actor.role,at:ctx.iso()};
  ctx.put('p10Reviews',r.recordId,r,{created:true});ctx.audit({action:'FEATURE_REJECT',target,after:r,reason:b.reason,componentId:'D01-01'});ctx.emit('feature.review.recorded',target,{...r});return r;
},{body:RejectFeatureBody});
registerSimHandler('requestFeatureRetire',async ctx=>{
 const {id,ver}=ctx.req.params,e=await R.requireFeature(ctx,id,ver),all=await merged(ctx,'featureRetireRequests','p10Retire'),target=key(id,ver);
 if(e.row.lifecycle==='RETIRED')deny(ctx,'GUARD_FAILED','이미 폐기한 버전입니다.','FEATURE_RETIRE_REQUEST',target);
 if(all.some(r=>r.featureId===id&&r.version===ver&&r.status==='PENDING'))deny(ctx,'CONFLICT','같은 버전의 폐기 요청이 이미 대기 중입니다.','FEATURE_RETIRE_REQUEST',target);
 const r={requestId:ctx.nextId('FRT',all.map(r=>r.requestId)),featureId:id,version:ver,from:e.row.lifecycle,reason:ctx.req.body.reason,status:'PENDING',requestedBy:ctx.actor.id,requestedRole:ctx.actor.role,requestedAt:ctx.iso(),decidedBy:null,decidedRole:null,decidedAt:null,decisionReason:null};
 ctx.put('p10Retire',r.requestId,r,{created:true});ctx.audit({action:'FEATURE_RETIRE_REQUEST',target,after:r,reason:r.reason,componentId:'D01-01'});ctx.emit('feature.retire.requested',target,{...r});return r;
},{body:RetireFeatureBody});
registerSimHandler('decideFeatureRetire',async ctx=>{
 const rid=ctx.req.params.rid??ctx.req.params.id,r=(await merged(ctx,'featureRetireRequests','p10Retire')).find(r=>r.requestId===rid),b=ctx.req.body;
 if(!r)deny(ctx,'NOT_FOUND','폐기 요청을 찾을 수 없습니다.','FEATURE_RETIRE_DECISION',rid);
 const e=await R.requireFeature(ctx,r.featureId,r.version),target=key(r.featureId,r.version),action=`FEATURE_RETIRE_${b.decision}`;
 const policies=rows(await ctx.read('listPolicies')).filter(p=>p.featureId===r.featureId&&p.featureVersion===r.version),flags=new Set(policies.map(p=>p.flagKey));
 const gate={deployedFlags:policies.filter(p=>p.status==='DEPLOYED').map(p=>p.flagKey),openRetirements:(await R.allRetirements(ctx)).filter(x=>flags.has(x.flagKey)&&x.featureVersion===r.version&&['REQUESTED','APPROVED'].includes(x.status))};
 const blockers=immediateRetireBlockers({lifecycle:e.row.lifecycle,request:r,actor:ctx.actor,createdBy:e.meta.createdBy,gate}).filter(x=>b.decision==='APPROVE'||x.code!=='RETIREMENT_INCOMPLETE');
 if(blockers.length)deny(ctx,blockers.some(x=>x.code==='SEPARATION_OF_DUTY')?'SEPARATION_OF_DUTY':blockers.some(x=>x.code==='ROLE')?'FORBIDDEN':'GUARD_FAILED',blockers.map(x=>x.message).join('; '),action,target,{blockers});
 const next={...r,status:b.decision==='APPROVE'?'APPROVED':'REJECTED',decidedBy:ctx.actor.id,decidedRole:ctx.actor.role,decidedAt:ctx.iso(),decisionReason:b.reason};ctx.put('p10Retire',rid,next);ctx.audit({action,target,before:{status:r.status,lifecycle:e.row.lifecycle},after:next,reason:b.reason,componentId:'D01-01'});
 const f=b.decision==='APPROVE'?await R.applyTransition(ctx,e,'RETIRED',`즉시 폐기 ${rid} — ${r.reason}`,false):e;return {request:next,feature:f.row};
},{body:RetireDecisionBody});
async function facts(ctx:SimWriteContext,id:string,ver:string){
 const e=await R.requireFeature(ctx,id,ver),target=key(id,ver),gates=Object.values(await R.gateLatest(ctx,id,ver));
 const nativeHistory=await ctx.snapshot<any>('gates',{id,ver}), history=rows(await ctx.read('featureHistory',{id},{version:ver}));
 const gateHistory=[...gates,...(nativeHistory?.gates??[]).flatMap((g:any)=>g.history??[]),...((ctx.overlay.data.regGates as Record<string,any[]>|undefined)?.[target]??[]).map(g=>g.record)];
 const approvals=gateHistory.filter(g=>['PASS','N/A'].includes(g.status)).length+history.filter(a=>a.action?.startsWith('FEATURE_TRANSITION PROPOSED→')).length;
 const refs:any[]=[...rows(await ctx.read('listPolicies')).filter(p=>p.featureId===id&&p.featureVersion===ver).map(p=>({kind:'정책',id:p.policyId})),...(e.row.catalogIds??[]).map(id=>({kind:'상품',id})),...(await R.allDependencies(ctx)).filter(d=>(d.sourceFeatureId===id&&d.sourceVersion===ver)||(d.targetFeatureId===id&&(!d.targetVersion||d.targetVersion===ver))).map(d=>({kind:'관계',id:d.dependencyId})),...gates.filter(g=>!['PASS','N/A'].includes(g.status)).map(g=>({kind:'Gate 판정',id:g.gateRecordId})),...rows(await ctx.read('featureReviews',{id},{version:ver})).map(r=>({kind:'반려 기록',id:r.recordId})),...(await merged(ctx,'featureRetireRequests','p10Retire')).filter(r=>r.featureId===id&&r.version===ver&&r.status==='PENDING').map(r=>({kind:'폐기 요청',id:r.requestId}))];
 const analysis=await R.analysisView(ctx,id,ver);for(const r of analysis?.history??[])refs.push({kind:'분석 근거',id:r.recordId});
 const trace=await ctx.read<any>('traceLinks',{},{featureId:id});for(const r of rows(trace).filter(r=>r.status==='ACTIVE'))refs.push({kind:'추적 연결',id:r.linkId});
 return {e,status:e.row.lifecycle,draftStatuses:['PROPOSED'],approvals,references:refs};
}
function tombstone(ctx:SimWriteContext,entity:string,recordId:string,snapshot:any){
 const r={entity,recordId,deletedBy:ctx.actor.id,deletedAt:ctx.iso(),reason:ctx.req.body.reason,snapshot};ctx.put('p10Tombstones',entity+':'+recordId,r,{created:true});ctx.audit({action:entity.toUpperCase().replaceAll('-','_')+'_DRAFT_DELETE',target:recordId,before:snapshot,after:{deleted:true},reason:r.reason,componentId:ctx.req.route.component});ctx.emit(entity+'.draft.deleted',recordId,{entity,recordId,by:ctx.actor.id});return r;
}
registerSimHandler('deleteFeatureDraft',async ctx=>{
 const {id,ver}=ctx.req.params,x=await facts(ctx,id,ver),target=key(id,ver);
 if(x.e.meta.createdBy&&x.e.meta.createdBy!==ctx.actor.id)deny(ctx,'FORBIDDEN','작성자만 이 초안을 삭제할 수 있습니다.','FEATURE_VERSION_DRAFT_DELETE',target);
 const check=draftDeletion(x);if(check.ok === false)deny(ctx,'GUARD_FAILED',check.message,'FEATURE_VERSION_DRAFT_DELETE',target,check);
 const r=tombstone(ctx,'feature-version',target,x.e.row);ctx.state<Record<string,unknown>>('regDeletedFeatures',()=>({}))[target]=r;return r;
},{body:DeleteDraftBody});
registerSimHandler('deleteRelationDraft',async ctx=>{
 const id=ctx.req.params.id,d=(await R.allDependencies(ctx)).find(d=>d.dependencyId===id);
 if(!d)deny(ctx,'NOT_FOUND','관계를 찾을 수 없습니다.','FEATURE_RELATION_DRAFT_DELETE',id);
 const x=await facts(ctx,d.sourceFeatureId,d.sourceVersion),all=await R.allSummaries(ctx);
 const references=all.filter(f=>!(f.featureId===d.sourceFeatureId&&f.version===d.sourceVersion)&&f.dependencyIds?.includes(id)).map(f=>({kind:'Feature Version',id:key(f.featureId,f.version)}));
 const check=draftDeletion({...x,references});if(check.ok === false)deny(ctx,'GUARD_FAILED',check.message,'FEATURE_RELATION_DRAFT_DELETE',id,check);
 const r=tombstone(ctx,'feature-relation',id,d);ctx.state<Record<string,unknown>>('regDeletedRelations',()=>({}))[id]=r;ctx.put('regFeature',key(d.sourceFeatureId,d.sourceVersion),{...x.e,row:{...x.e.row,dependencyIds:x.e.row.dependencyIds.filter(x=>x!==id)}});return r;
},{body:DeleteDraftBody});
