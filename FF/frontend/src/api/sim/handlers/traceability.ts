// Browser-local traceability: captured source checks, append-only evidence, native coverage rules.
import { compareVersion, type Role } from '@ff/contracts';
import { CreateTraceLinkBody, UnlinkTraceLinkBody, CreateTestEvidenceBody, TRACE_KINDS, type TraceLinkRow, type TestEvidenceRow } from '../../../../../contracts/src/schemas/trace-link';
import { featureTraceCoverage, groupTraceLinks, testCaseStatus, TRACE_KIND_RULES, TEST_EVIDENCE_ROLES } from '../../../../../contracts/src/rules/trace-link';
import { registerSimHandler, registerSimReader, SimError } from '../engine';
import type { SimReadContext,SimWriteContext } from '../types';
import { p10Registry as R } from './registry';
const L='localTraceLinks',E='localTestEvidence';
const rows=(x:any):any[]=>Array.isArray(x)?x:x?.items??[];
const merge=(a:any[],b:any[],key:string)=>[...new Map([...a,...b].map(x=>[x[key],x])).values()];
const capturedRows=(x:any):any[]|undefined=>Array.isArray(x)?x:Array.isArray(x?.items)?x.items:undefined;
async function allLinks(ctx:SimReadContext){
 const captured=capturedRows(await ctx.snapshot('traceLinks',{}, {status:'ALL'}));
 // Creating IDs and preserving unlink history require the full history, including a valid empty list.
 if(!captured)throw new SimError('NOT_FOUND','Complete trace-link source is unavailable.',{source:'traceLinks',status:'ALL'});
 return merge(captured,ctx.list(L),'linkId');
}
async function summary(ctx:SimReadContext,id:string){
 const original=await ctx.snapshot<any>('featureTrace',{id});
 const versions=(await R.allSummaries(ctx)).filter(f=>f.featureId===id).sort((a,b)=>compareVersion(a.version,b.version)),latest=versions.at(-1);
 if(!latest)throw new (await import('../engine')).SimError('NOT_FOUND',id+' Feature를 찾을 수 없습니다.');
 const feature=(await R.featureOf(ctx,id,latest.version))?.row??latest;
 const links=(await allLinks(ctx)).filter(l=>l.featureId===id),evidence=merge(original?.evidence??[],ctx.list<TestEvidenceRow>(E).filter(e=>e.featureId===id),'recordId');
 const requirements=original?.requirements??(feature.requirementIds??[]).map((reqId:string)=>({reqId}));
 const linked=new Set(links.filter(l=>l.status==='ACTIVE'&&l.kind==='REQUIREMENT').map(l=>l.elementId));
 return {feature:{featureId:id,version:feature.version,name:feature.name,lifecycle:feature.lifecycle,ownerId:feature.ownerId},links:links.map(l=>l.kind==='TEST_CASE'?{...l,test:testCaseStatus(l,evidence)}:l),groups:groupTraceLinks(links.filter(l=>l.status==='ACTIVE')),requirements:requirements.map((r:any)=>({...r,linked:linked.has(r.reqId)})),evidence,coverage:featureTraceCoverage(links,evidence,requirements.map((r:any)=>r.reqId))};
}
function allowed(ctx:SimWriteContext,roles:readonly Role[],action:string,target:string){if(!roles.includes(ctx.actor.role))ctx.fail('FORBIDDEN','이 연결을 변경할 역할이 아닙니다.',{allowed:roles},{action,target,reason:'연결 종류별 권한 불일치',componentId:'D01-02',result:'DENIED'});}
registerSimReader('traceLinks',async ctx=>{
 const q=ctx.req.query,local=ctx.list(L);if(q.kind&&!TRACE_KINDS.includes(q.kind as any))throw new SimError('VALIDATION','알 수 없는 연결 종류입니다.');
 if(q.status&&!['ACTIVE','UNLINKED','ALL'].includes(q.status))throw new SimError('VALIDATION','status must be ACTIVE, UNLINKED or ALL.');
 if(!local.length&&capturedRows(await ctx.snapshot('traceLinks',ctx.req.params,q)))return undefined;
 let captured=capturedRows(await ctx.snapshot('traceLinks',{}, {status:'ALL'}));
 // The unfiltered native default is complete for ACTIVE only. It cannot prove no historical links.
 if(!captured&&(!q.status||q.status==='ACTIVE'))captured=capturedRows(await ctx.snapshot('traceLinks'));
 if(!captured){if(!local.length)return undefined;throw new SimError('NOT_FOUND','Complete trace-link source is unavailable.',{source:'traceLinks',status:q.status||'ACTIVE'});}
 const items=merge(captured,local,'linkId').filter(l=>(!q.featureId||l.featureId===q.featureId)&&(!q.kind||l.kind===q.kind)&&(!q.elementType||l.elementType===q.elementType)&&(!q.sourceSystem||l.sourceSystem===q.sourceSystem)&&((q.status==='ALL')||l.status===(q.status||'ACTIVE')));
 return {items,groups:groupTraceLinks(items.filter(l=>l.status==='ACTIVE'))};
});
registerSimReader('featureTrace',ctx=>ctx.list<TraceLinkRow>(L).some(l=>l.featureId===ctx.req.params.id)||ctx.list<TestEvidenceRow>(E).some(l=>l.featureId===ctx.req.params.id)?summary(ctx,ctx.req.params.id):undefined);
registerSimReader('traceCoverage',async ctx=>{
 if(!ctx.list(L).length&&!ctx.list(E).length)return undefined;
 const q=ctx.req.query.filter;if(q&&q!=='noRequirement'&&q!=='missingEvidence')throw new (await import('../engine')).SimError('VALIDATION','알 수 없는 커버리지 조건입니다.');
 const captured=await ctx.snapshot<any>('traceCoverage'),byId=new Map<string,any>((captured?.items??[]).map((r:any)=>[r.featureId,r]));
 const ids=new Set([...ctx.list<TraceLinkRow>(L).map(l=>l.featureId),...ctx.list<TestEvidenceRow>(E).map(l=>l.featureId)]);
 for(const id of ids){const s=await summary(ctx,id);byId.set(id,{...s.feature,...s.coverage});}
 const all=[...byId.values()],sum=(f:(x:any)=>number)=>all.reduce((a,b)=>a+f(b),0),ratio=(a:number,b:number)=>b?Math.round(a/b*10000)/10000:null;
 return {summary:{features:all.length,noRequirement:all.filter(x=>!x.hasRequirementLink).length,missingEvidence:all.filter(x=>x.missingRequiredEvidence).length,requirementRatio:ratio(sum(x=>x.requirement.covered),sum(x=>x.requirement.total)),testRatio:ratio(sum(x=>x.test.withEvidence),sum(x=>x.test.required))},filter:q??null,items:all.filter(x=>q==='noRequirement'?!x.hasRequirementLink:q==='missingEvidence'?x.missingRequiredEvidence:true)};
});
registerSimHandler('createTraceLink',async ctx=>{
 const b=ctx.req.body as CreateTraceLinkBody;allowed(ctx,TRACE_KIND_RULES[b.kind].roles,'TRACE_LINK_CREATE',b.featureId);
 const versions=(await R.allSummaries(ctx)).filter(f=>f.featureId===b.featureId).sort((a,b)=>compareVersion(a.version,b.version));
 if(!versions.length)ctx.fail('NOT_FOUND','Feature가 없습니다.');if(versions.at(-1).lifecycle==='RETIRED')ctx.fail('IMMUTABLE','폐기한 Feature에는 연결을 추가할 수 없습니다.');
 const all=await allLinks(ctx),dup=all.find(l=>l.featureId===b.featureId&&l.kind===b.kind&&l.elementId===b.elementId&&l.status==='ACTIVE');if(dup)ctx.fail('CONFLICT','이미 같은 요소가 연결돼 있습니다.',{linkId:dup.linkId});
 let source:any=null;
 if(b.kind!=='REQUIREMENT'){
  source=await ctx.read<any>('traceSourceLookup',{}, {kind:b.kind,elementId:b.elementId,...(b.elementVersion?{elementVersion:b.elementVersion}:{})});
  if(!source?.found||!source.element)ctx.fail('GUARD_FAILED','내장 출처에서 이 요소의 존재를 확인할 수 없습니다. 실제 외부 조회는 수행하지 않습니다.',{kind:b.kind,elementId:b.elementId});
  if(source.element.elementType!==b.elementType)ctx.fail('GUARD_FAILED','출처 요소 유형과 일치하지 않습니다.',{sourceType:source.element.elementType});
 }
 const r:TraceLinkRow={linkId:ctx.nextId('TRL',all.map(l=>l.linkId)),featureId:b.featureId,kind:b.kind,elementId:b.elementId,elementType:b.elementType,elementName:b.elementName??source?.element?.name??null,elementVersion:b.elementVersion??source?.element?.version??null,sourceSystem:b.sourceSystem,required:b.kind==='TEST_CASE'?b.required:null,existence:b.kind==='REQUIREMENT'?'NOT_CHECKED':'VERIFIED',sourceRef:source?'CAPTURED_SOURCE:'+b.sourceSystem+':'+b.elementId:null,status:'ACTIVE',linkedBy:ctx.actor.id,linkedAt:ctx.iso(),unlinkedBy:null,unlinkedAt:null,unlinkReason:null};
 ctx.put(L,r.linkId,r,{created:true});ctx.audit({action:'TRACE_LINK_CREATE',target:b.featureId+':'+r.linkId,after:r,componentId:'D01-02'});ctx.emit('trace-link.created',b.featureId,{linkId:r.linkId,kind:r.kind,elementId:r.elementId,existence:r.existence});return r;
},{body:CreateTraceLinkBody});
registerSimHandler('unlinkTraceLink',async ctx=>{
 const r=(await allLinks(ctx)).find(l=>l.linkId===ctx.req.params.id);if(!r)ctx.fail('NOT_FOUND','연결을 찾을 수 없습니다.');allowed(ctx,TRACE_KIND_RULES[r.kind as keyof typeof TRACE_KIND_RULES].roles,'TRACE_LINK_UNLINK',r.linkId);if(r.status!=='ACTIVE')ctx.fail('CONFLICT','이미 해제된 연결입니다.');
 const next={...r,status:'UNLINKED',unlinkedBy:ctx.actor.id,unlinkedAt:ctx.iso(),unlinkReason:ctx.req.body.reason};ctx.put(L,r.linkId,next);ctx.audit({action:'TRACE_LINK_UNLINK',target:r.featureId+':'+r.linkId,before:r,after:next,reason:next.unlinkReason,componentId:'D01-02'});ctx.emit('trace-link.unlinked',r.featureId,{linkId:r.linkId,kind:r.kind,reason:next.unlinkReason});return next;
},{body:UnlinkTraceLinkBody});
registerSimHandler('createTestEvidence',async ctx=>{
 const r=(await allLinks(ctx)).find(l=>l.linkId===ctx.req.params.id),b=ctx.req.body as CreateTestEvidenceBody;if(!r)ctx.fail('NOT_FOUND','연결을 찾을 수 없습니다.');allowed(ctx,TEST_EVIDENCE_ROLES,'TEST_EVIDENCE_CREATE',r.linkId);
 if(r.kind!=='TEST_CASE')ctx.fail('GUARD_FAILED','Test Case 연결에만 시험 근거를 등록합니다.');if(r.status!=='ACTIVE')ctx.fail('CONFLICT','해제된 연결입니다.');if(Date.parse(b.executedAt)>ctx.now().getTime()+300000)ctx.fail('VALIDATION','실행 일시가 지금보다 늦습니다.');
 const current=await summary(ctx,r.featureId),all=current.evidence;if(all.some((e:any)=>e.linkId===r.linkId&&e.evidenceId===b.evidenceId))ctx.fail('CONFLICT','같은 시험 근거가 이미 등록돼 있습니다.');
 const record:TestEvidenceRow={recordId:ctx.nextId('TEV',[...all,...ctx.list<any>(E)].map((e:any)=>e.recordId)),linkId:r.linkId,featureId:r.featureId,testCaseId:r.elementId,evidenceId:b.evidenceId,executedAt:new Date(b.executedAt).toISOString(),result:b.result,environment:b.environment,registeredBy:ctx.actor.id,registeredAt:ctx.iso()};
 ctx.put(E,record.recordId,record,{created:true});ctx.audit({action:'TEST_EVIDENCE_CREATE',target:r.featureId+':'+r.linkId,after:record,componentId:'D01-02'});ctx.emit('test-evidence.recorded',r.featureId,{linkId:r.linkId,testCaseId:r.elementId,evidenceId:record.evidenceId,result:record.result});return record;
},{body:CreateTestEvidenceBody});
