// Local compliance lifecycle: versioned content, independent designated decisions, expiry and policy checks.
import type { ComplianceRule, ComplianceRuleDetail } from '@ff/contracts';
import { CALS } from '../../../../../contracts/src/rules/gate-evidence';
import { ComplianceScope,CreateComplianceRuleBody,UpdateComplianceRuleBody,ComplianceApprovalRequestBody,ComplianceDecisionBody } from '../../../../../contracts/src/schemas/compliance-rule';
import { applicableRules,bumpRuleVersion,canMoveRule,complianceMarketOf,ruleDiff,ruleExpired,ruleFeatureCandidates } from '../../../../../contracts/src/rules/compliance-rule';
import { registerSimHandler,registerSimReader,registerSimTask,SimError } from '../engine';
import type { SimReadContext,SimWriteContext } from '../types';
import { p10Registry as R } from './registry';
const STORE='f0ComplianceRule';
const list=(x:any):any[]=>Array.isArray(x)?x:x?.items??[];
const content=(r:any)=>Object.fromEntries(['name','type','scope','criteria','approverIds','evidence','validFrom','validTo'].map(k=>[k,r[k]])) as any;
async function allRules(ctx:SimReadContext):Promise<ComplianceRule[]>{return [...new Map([...list(await ctx.snapshot('complianceRules')), ...ctx.list<any>(STORE).map(d=>d.rule)].map(r=>[r.ruleId,r])).values()];}
async function detail(ctx:SimReadContext,id:string):Promise<ComplianceRuleDetail>{const base=await ctx.snapshot<ComplianceRuleDetail>('complianceRule',{id}),local=ctx.get<any>(STORE,id),d=base?{...base,...local}:local;if(!d?.rule)throw new SimError('NOT_FOUND',id+' 룰을 찾을 수 없습니다.');return structuredClone(d);}
function fail(ctx:SimWriteContext,code:string,message:string,action:string,id:string):never{return ctx.fail(code,message,undefined,{action,target:id,reason:message,componentId:'D03-01'});}
async function validate(ctx:SimWriteContext,r:any,authors:string[]){
 const known=new Set((await R.allSummaries(ctx)).map(f=>f.featureId));if(r.scope.featureIds.some((id:string)=>!known.has(id)))ctx.fail('VALIDATION','적용 대상에 등록되지 않은 Feature가 있습니다.');
 if(r.approverIds.some((id:string)=>authors.includes(id)))ctx.fail('VALIDATION','작성자는 승인 대상자가 될 수 없습니다.');
 if(r.validTo&&r.validTo<r.validFrom)ctx.fail('VALIDATION','종료일은 시작일보다 빠를 수 없습니다.');
}
function change(ctx:SimWriteContext,d:any,action:string,field:string,before:unknown,after:unknown,reason:string|null){
 d.changes??=[];d.changes.push({id:(d.changes.at(-1)?.id??0)+1,ruleId:d.rule.ruleId,version:d.rule.version,action,field,before,after,by:ctx.actor.id,at:ctx.iso(),reason});
}
function save(ctx:SimWriteContext,d:ComplianceRuleDetail){ctx.put(STORE,d.rule.ruleId,{...d,ruleId:d.rule.ruleId});if(d.rule.validTo&&d.rule.status!=='RETIRED'){const at=Date.parse(d.rule.validTo+'T00:00:00Z')+86400000;ctx.later(Math.max(0,at-ctx.now().getTime()),'local.compliance.expire',{ruleId:d.rule.ruleId,version:d.rule.version});}}
registerSimTask('local.compliance.expire',async(ctx,args)=>{
 const d=await detail(ctx,String(args.ruleId)),r=d.rule;if(r.version!==args.version||r.status==='RETIRED'||!ruleExpired(r,ctx.iso()))return;
 const before=r.status;d.rule={...r,status:'RETIRED',retiredAt:ctx.iso()};for(const q of d.requests??[])if(q.status==='OPEN'){q.status='WITHDRAWN';q.decidedAt=ctx.iso();q.reason='유효 종료일 경과';}
 for(const v of d.versions??[])if(v.version===r.version)v.status='RETIRED';change(ctx,d,'RETIRE','status',before,'RETIRED','유효 종료일 경과');ctx.put(STORE,r.ruleId,{...d,ruleId:r.ruleId});ctx.audit({action:'COMPLIANCE_RULE_RETIRE',target:r.ruleId,before:{status:before},after:{status:'RETIRED',version:r.version},reason:'유효 종료일 경과',componentId:'D03-01'});ctx.emit('compliance.rule.expired',r.ruleId,{ruleId:r.ruleId,name:r.name,type:r.type,markets:r.scope.markets,validTo:r.validTo,expiredAt:ctx.iso(),version:r.version,authorId:r.ownerId,approverIds:r.approverIds,ownerTeams:[]});
});
registerSimReader('complianceRules',async ctx=>{
 if(!ctx.list(STORE).length)return undefined;const q=ctx.req.query,features=q.featureId?(await R.allSummaries(ctx)).filter(f=>f.featureId===q.featureId):[],markets=new Set(features.map(f=>complianceMarketOf(f.country)));
 return {items:(await allRules(ctx)).filter(r=>(!q.ruleId||r.ruleId.includes(q.ruleId.toUpperCase()))&&(!q.type||r.type===q.type)&&(!q.market||r.scope.markets.includes(q.market as any))&&(!q.status||r.status===q.status)&&(!q.featureId||(r.scope.featureIds.length?r.scope.featureIds.includes(q.featureId):r.scope.markets.some(m=>markets.has(m)))))};
});
registerSimReader('complianceRuleCandidates',async ctx=>{const csv=(k:string)=>(ctx.req.query[k]??'').split(',').filter(Boolean),items=ruleFeatureCandidates(await R.allSummaries(ctx),ComplianceScope.parse({markets:csv('markets'),asil:csv('asil'),featureIds:csv('featureIds')}));return {items,total:items.length};});
export async function complianceRegistryFor(ctx:SimReadContext,feature:any,at=ctx.now().toISOString()){
 const a=await R.analysisView(ctx,feature.featureId,feature.version),cals=(a?.current?.TARA?.content?.threats??[]).map((t:any)=>t.cal).filter((cal:any)=>(CALS as readonly string[]).includes(cal));
 return {rules:await allRules(ctx),market:complianceMarketOf(feature.country),cal:cals.sort().at(-1)??null,at};
}
registerSimReader('complianceRulesApplicable',async ctx=>{
 const pid=ctx.req.query.policyId,policies=list(await ctx.read('listPolicies')),p=policies.find(p=>p.policyId===pid);if(!p)throw new SimError('NOT_FOUND','정책을 찾을 수 없습니다.');const e=await R.featureOf(ctx,p.featureId,p.featureVersion);if(!e)throw new SimError('NOT_FOUND','정책 대상 Feature가 없습니다.');const at=ctx.req.query.at||ctx.now().toISOString();if(!Number.isFinite(Date.parse(at)))throw new SimError('VALIDATION','at은 ISO 시각이어야 합니다.');
 const reg=await complianceRegistryFor(ctx,e.row,at),c={featureId:p.featureId,market:reg.market,rolloutMode:p.rollout.mode,asil:e.row.asil,cal:reg.cal};return {policyId:pid,featureId:p.featureId,featureVersion:p.featureVersion,...c,at,rules:applicableRules(reg.rules,c,at)};
});
registerSimHandler('createComplianceRule',async ctx=>{
 const b=ctx.req.body as CreateComplianceRuleBody;if((await allRules(ctx)).some(r=>r.ruleId===b.ruleId))fail(ctx,'CONFLICT','같은 룰 ID가 있습니다.','COMPLIANCE_RULE_CREATE',b.ruleId);await validate(ctx,b,[ctx.actor.id]);const at=ctx.iso(),r={ruleId:b.ruleId,...content(b),version:'1.0',status:'PROPOSED',ownerId:ctx.actor.id,createdBy:ctx.actor.id,createdAt:at,updatedBy:ctx.actor.id,updatedAt:at,decidedBy:null,decidedAt:null,retiredAt:null};
 const accounts=list(await ctx.read('accounts')),d:any={rule:r,versions:[{ruleId:r.ruleId,version:r.version,status:r.status,content:content(r),createdBy:ctx.actor.id,createdAt:at,decidedBy:null,decidedAt:null,decisionReason:null}],changes:[],requests:[],ownerState:accounts.find(a=>a.id===ctx.actor.id)?.state??'ABSENT',ownerTransfers:[]};change(ctx,d,'CREATE','status',null,r.status,b.reason??null);save(ctx,d);ctx.audit({action:'COMPLIANCE_RULE_CREATE',target:r.ruleId,after:r,reason:b.reason,componentId:'D03-01'});ctx.emit('compliance.rule.created',r.ruleId,{ruleId:r.ruleId,version:r.version,type:r.type,markets:r.scope.markets});return r;
},{body:CreateComplianceRuleBody});
registerSimHandler('updateComplianceRule',async ctx=>{
 const id=ctx.req.params.id,d=await detail(ctx,id),r=d.rule,b=ctx.req.body as UpdateComplianceRuleBody;if(r.ownerId!==ctx.actor.id)fail(ctx,'FORBIDDEN','소유자만 이 룰을 수정할 수 있습니다.','COMPLIANCE_RULE_UPDATE',id);if(!canMoveRule(r.status,'PROPOSED')||ruleExpired(r,ctx.iso()))fail(ctx,'CONFLICT','만료된 룰은 수정할 수 없습니다.','COMPLIANCE_RULE_UPDATE',id);
 const {reason,...patch}=b,c={...content(r),...patch};await validate(ctx,c,[r.ownerId,ctx.actor.id]);const diff=ruleDiff(content(r),c);if(!diff.length)ctx.fail('CONFLICT','바뀐 항목이 없습니다.');const version=bumpRuleVersion(r.version,diff),at=ctx.iso();d.rule={...r,...c,version,status:'PROPOSED',updatedBy:ctx.actor.id,updatedAt:at,decidedBy:null,decidedAt:null};d.versions.push({ruleId:id,version,status:'PROPOSED',content:c,createdBy:ctx.actor.id,createdAt:at,decidedBy:null,decidedAt:null,decisionReason:null});
 for(const q of d.requests)if(q.status==='OPEN'){q.status='WITHDRAWN';q.decidedAt=at;q.reason='버전 '+version+'으로 수정되어 철회';}for(const x of diff)change(ctx,d,'UPDATE',x.field,x.before,x.after,reason);save(ctx,d);ctx.audit({action:'COMPLIANCE_RULE_UPDATE',target:id,before:{version:r.version,status:r.status},after:{version,status:'PROPOSED',changes:diff},reason,componentId:'D03-01'});ctx.emit('compliance.rule.updated',id,{ruleId:id,from:r.version,version,fields:diff.map(d=>d.field)});return d.rule;
},{body:UpdateComplianceRuleBody});
registerSimHandler('requestComplianceApproval',async ctx=>{
 const id=ctx.req.params.id,d=await detail(ctx,id),r=d.rule;if(r.status!=='PROPOSED'||ruleExpired(r,ctx.iso()))ctx.fail('CONFLICT','승인 대기 중인 유효한 룰만 요청할 수 있습니다.');if(d.requests.some(q=>q.status==='OPEN'))ctx.fail('CONFLICT','이미 열린 승인 요청이 있습니다.');const ids=[...d.requests,...ctx.list<any>(STORE).flatMap(d=>d.requests??[])].map(q=>q.requestId),q:any={requestId:ctx.nextId('CRQ',ids),ruleId:id,version:r.version,requestedBy:ctx.actor.id,approverIds:[...r.approverIds],requestedAt:ctx.iso(),note:ctx.req.body.note??null,status:'OPEN',decidedBy:null,decidedAt:null,reason:null};d.requests.push(q);change(ctx,d,'REQUEST','approvalRequest',null,q,q.note);save(ctx,d);ctx.audit({action:'COMPLIANCE_RULE_REQUEST',target:id,after:q,reason:q.note,componentId:'D03-01'});ctx.emit('compliance.rule.approval-requested',id,{ruleId:id,name:r.name,version:r.version,requestId:q.requestId,requestedBy:ctx.actor.id,approverIds:q.approverIds});return q;
},{body:ComplianceApprovalRequestBody});
registerSimHandler('decideComplianceRule',async ctx=>{
 const id=ctx.req.params.id,d=await detail(ctx,id),r=d.rule,b=ctx.req.body as ComplianceDecisionBody,q=d.requests.find(q=>q.status==='OPEN'),action='COMPLIANCE_RULE_'+(b.decision==='APPROVE'?'APPROVE':'REJECT');if(r.status!=='PROPOSED'||!q||q.version!==r.version)ctx.fail('CONFLICT','현재 버전에 대한 열린 승인 요청이 없습니다.');
 if([r.ownerId,r.updatedBy,q!.requestedBy].includes(ctx.actor.id))fail(ctx,'SEPARATION_OF_DUTY','작성자·요청자는 승인할 수 없습니다.',action,id);if(!q!.approverIds.includes(ctx.actor.id))fail(ctx,'FORBIDDEN','지정된 승인 대상자만 결정할 수 있습니다.',action,id);if(b.decision==='APPROVE'&&ruleExpired(r,ctx.iso()))fail(ctx,'GUARD_FAILED','유효기간이 지난 룰은 승인할 수 없습니다.',action,id);
 const status=b.decision==='APPROVE'?'APPROVED':'REJECTED',at=ctx.iso();d.rule={...r,status,decidedBy:ctx.actor.id,decidedAt:at};Object.assign(q!,{status,decidedBy:ctx.actor.id,decidedAt:at,reason:b.reason});const v=d.versions.find(v=>v.version===r.version);if(v)Object.assign(v,{status,decidedBy:ctx.actor.id,decidedAt:at,decisionReason:b.reason});change(ctx,d,b.decision==='APPROVE'?'APPROVE':'REJECT','status',r.status,status,b.reason);save(ctx,d);ctx.audit({action,target:id,before:{status:r.status},after:{status,version:r.version,requestId:q!.requestId},reason:b.reason,componentId:'D03-01'});ctx.emit('compliance.rule.'+(status==='APPROVED'?'approved':'rejected'),id,{ruleId:id,version:r.version,by:ctx.actor.id});return d.rule;
},{body:ComplianceDecisionBody});
