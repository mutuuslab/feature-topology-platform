// Local operational work: reviewed findings, pre-registered abort criteria and deterministic BoF checks.
import { effectiveBasisPoints,ValidateCompositionBody } from '@ff/contracts';
import { AbortCriteriaBody,FindingTransitionBody } from '../../../../../contracts/src/schemas/lake';
import { FINDING_DUE_DAYS,INDICATOR_RULES,findingOpen,findingTransitionProblem,judgeCanary } from '../../../../../contracts/src/rules/lake';
import { CANARY_MAX_BP,CANARY_OBSERVE_MS,judgeExpansion,stageCriteriaApply } from '../../../../../contracts/src/rules/rollout-stage';
import { billOfFeatures } from '../../../../../contracts/src/rules/ple/bill-of-features';
import { registerSimHandler,registerSimReader,SimError } from '../engine';
import type { SimReadContext } from '../types';
import { p10Registry as R } from './registry';
const FIND='localHealthFinding',ABORT='localAbortCriteria';
const rows=(v:any):any[]=>Array.isArray(v)?v:v?.items??[];
const decorate=(r:any,now:number)=>({...r,overdue:findingOpen(r.status)&&Date.parse(r.dueAt)<now});
registerSimReader('featureHealthFinding',async ctx=>{const f=ctx.get<any>(FIND,ctx.req.params.id);return f?decorate(f,ctx.now().getTime()):undefined;});
registerSimReader('featureHealth',async ctx=>{
 if(!ctx.list(FIND).length)return undefined;const base=await ctx.snapshot<any>('featureHealth');if(!base)throw new SimError('NOT_FOUND','운영 점검 원천이 없습니다.');
 const findings=[...new Map([...(base.findings??[]),...ctx.list<any>(FIND)].map(f=>[f.findingId,f])).values()].map(f=>decorate(f,ctx.now().getTime()));
 return {...base,findings,rows:(base.rows??[]).map((r:any)=>{const mine=findings.filter(f=>f.featureId===r.featureId&&f.version===r.version&&findingOpen(f.status));return {...r,openFindings:mine.length,overdue:mine.filter(f=>f.overdue).length};})};
});
registerSimHandler('moveFinding',async ctx=>{
 const id=ctx.req.params.id,f=ctx.get<any>(FIND,id)??await ctx.snapshot<any>('featureHealthFinding',{id}),b=ctx.req.body;if(!f)ctx.fail('NOT_FOUND','점검 결과를 찾을 수 없습니다.');const why=findingTransitionProblem(f,b.to,!!b.action);if(why)ctx.fail('GUARD_FAILED',why,undefined,{action:'FINDING_TRANSITION',target:id,reason:why,componentId:'D04-03'});
 const at=ctx.iso(),actions=b.action?[...(f.actions??[]),{...b.action,at,by:ctx.actor.id}]:f.actions;
 // Captured observations predate this local action. Never present them as a newly measured effect.
 let effect=f.effect;if(b.to==='VERIFYING'){const rule=INDICATOR_RULES[f.cause as keyof typeof INDICATOR_RULES];if(!rule)ctx.fail('GUARD_FAILED','효과 판정 지표 정의가 없습니다.');effect={indicator:f.cause,target:rule.watch,before:f.evidence?.indicators?.find((i:any)=>i.name===f.cause)?.current??null,after:null,samples:null,ci:null,met:null};}
 const next={...f,status:b.to,actions,effect,dueAt:b.to==='REOPENED'?new Date(ctx.now().getTime()+FINDING_DUE_DAYS[f.severity as keyof typeof FINDING_DUE_DAYS]*86400000).toISOString():f.dueAt,updatedAt:at,repeats:(f.repeats??0)+(b.to==='REOPENED'?1:0),history:[...(f.history??[]),{at,from:f.status,to:b.to,by:ctx.actor.id,note:b.note}]};
 ctx.put(FIND,id,next);ctx.audit({action:'FINDING_TRANSITION',target:id,before:{status:f.status,actions:f.actions.length},after:{status:next.status,actions:actions.length,effect},reason:b.note,componentId:'D04-03'});ctx.emit('finding.moved',id,{featureId:f.featureId,version:f.version,axis:f.axis,cause:f.cause,from:f.status,to:next.status,action:b.action?.kind??null,effectMet:effect?.met??null});return decorate(next,ctx.now().getTime());
},{body:FindingTransitionBody});
async function observed(ctx:SimReadContext,id:string,base:any){
 const c=ctx.get<any>(ABORT,id);if(!c)return base?.canary??null;const canary=base?.canary;
 if(!canary)return null;
 const comparable=c.observeHours===canary.criteria.observeHours&&c.confidence===canary.criteria.confidence;
 const j=judgeCanary({lagMinutes:comparable&&canary.freshness.lagSeconds!=null?Math.round(canary.freshness.lagSeconds/60):null,vehicles:canary.vehicles.treatment,stats:canary.stats,criteria:c});
 return {...canary,...j,criteria:{...c,registered:true},localObservationPending:!comparable,freshness:comparable?canary.freshness:{...canary.freshness,stale:true,lagSeconds:null}};
}
export async function expansionSourcesFor(ctx:SimReadContext,p:any){
 const base=await ctx.snapshot<any>('policyExpansion',{id:p.policyId}),canary=await observed(ctx,p.policyId,base),e=base?.evidence;
 return {canary:canary?{verdict:canary.verdict,lagMinutes:canary.freshness.lagSeconds==null?null:Math.round(canary.freshness.lagSeconds/60),breached:canary.breached,registered:canary.criteria.registered}:ctx.get(ABORT,p.policyId)?{verdict:'HOLD_STALE' as const,lagMinutes:null,breached:[],registered:true}:null,evidence:e?{result:e.result,metrics:e.metrics,frozen:e.frozen,assumed:e.assumed}:null};
}
registerSimReader('policyExpansion',async ctx=>{
 const id=ctx.req.params.id,c=ctx.get<any>(ABORT,id),local=ctx.get<any>('policy',id);
 // Unchanged native observations, signatures and decisions remain the captured response.
 if(!c&&!local){
  const base=await ctx.snapshot<any>('policyExpansion',{id});if(base)return base;
  if(!(await ctx.snapshot<any>('policyDetail',{id}))?.policy)throw new SimError('NOT_FOUND','정책을 찾을 수 없습니다.');
  return undefined;
 }
 const p=local??(await ctx.read<any>('policyDetail',{id})).policy;if(!p)throw new SimError('NOT_FOUND','정책을 찾을 수 없습니다.');
 // A local policy revision has no newly measured Lake observations. Delivery ACK/READBACK
 // establishes delivery only; it is not treatment/control health or Active exposure.
 const base=local?null:await ctx.snapshot<any>('policyExpansion',{id}),canary=await observed(ctx,id,base);
 const sources=local?{canary:c?{verdict:'HOLD_STALE' as const,lagMinutes:null,breached:[],registered:true}:null,evidence:null}:await expansionSourcesFor(ctx,p);
 const facts=await (await import('./policy-ops')).expansionStageFacts(ctx,p);
 const current=effectiveBasisPoints(p),ceiling=effectiveBasisPoints({...p,stageBasisPoints:null});
 const stage={...facts,current,beyondCanary:ceiling>CANARY_MAX_BP&&current<ceiling,observedMs:Math.max(0,ctx.now().getTime()-Date.parse(facts.since))};
 // The existing rule treats insufficient samples as an explicit advisory HOLD. Do not
 // fabricate an observed Canary DTO or alter stageRollout's authorization/guard inputs.
 const displaySources=!sources.canary&&!sources.evidence?{...sources,canary:{verdict:'INSUFFICIENT' as const,lagMinutes:null,breached:[],registered:false}}:sources;
 return {...base,policyId:id,featureId:p.featureId,featureVersion:p.featureVersion,decision:judgeExpansion({...displaySources,stage}),canary,evidence:base?.evidence??null,registeredCriteria:c??null,stage:{fClass:stage.fClass,current,ceiling,applies:stageCriteriaApply(stage),observedMs:stage.observedMs,requiredMs:CANARY_OBSERVE_MS,openAnomalies:stage.openAnomalies,activeKills:stage.activeKills}};
});
registerSimHandler('registerAbortCriteria',async ctx=>{
 const id=ctx.req.params.id,d=await ctx.read<any>('policyDetail',{id}),p=d.policy,b=ctx.req.body;if(!p)ctx.fail('NOT_FOUND','정책을 찾을 수 없습니다.');if(!['APPROVED','DEPLOYED'].includes(p.status))ctx.fail('GUARD_FAILED','승인·배포된 정책만 중단 기준을 등록합니다.');
 const before=ctx.get<any>(ABORT,id)??(await ctx.snapshot<any>('policyExpansion',{id}))?.canary?.criteria??null,c={policyId:id,metrics:b.metrics,confidence:b.confidence,observeHours:b.observeHours,maxLagMinutes:b.maxLagMinutes,registeredBy:ctx.actor.id,registeredAt:ctx.iso()};ctx.put(ABORT,id,c,{created:!before});ctx.audit({action:'ABORT_CRITERIA',target:id,before,after:c,reason:b.reason,componentId:'D01-08'});ctx.emit('rollout.abort_criteria',id,{flagKey:p.flagKey,metrics:c.metrics,maxLagMinutes:c.maxLagMinutes});return c;
},{body:AbortCriteriaBody});
registerSimHandler('checkBillOfFeatures',async ctx=>{
 const b=ctx.req.body,baselines=rows(await ctx.read('baselines')),map=new Map<string,any>(),features=new Map<string,any>(),variabilities=new Map<string,any>(),summaries=new Map((await R.allSummaries(ctx)).map(f=>[f.featureId+'@'+f.version,f]));
 for(const bl of baselines){const f=b.baselineIds.includes(bl.baselineId)?await R.featureOf(ctx,bl.featureId,bl.version):{row:summaries.get(bl.featureId+'@'+bl.version)};if(!f?.row)continue;map.set(bl.baselineId,{baselineId:bl.baselineId,featureId:bl.featureId,version:bl.version,name:f.row.name,lifecycle:f.row.lifecycle,country:f.row.country,vehicleModel:f.row.vehicleModel,trim:f.row.trim});if(b.baselineIds.includes(bl.baselineId)){const key=bl.featureId+'@'+bl.version;features.set(key,f.row);const v=await ctx.snapshot<any>('featureVariability',{id:bl.featureId,ver:bl.version});if(v?.variability)variabilities.set(key,v.variability);}}
 const refs=new Map((await R.allRefs(ctx)).map(r=>[r.refId,r]));return billOfFeatures({product:b,baselines:map,dependencies:await R.allDependencies(ctx),carriedOver:b.carriedOver,features,refsById:refs,variabilities});
},{body:ValidateCompositionBody});

registerSimReader('canaryOverview',async ctx=>{
 if(!ctx.list(ABORT).length)return undefined;const base=await ctx.snapshot<any>('canaryOverview');if(!base)return undefined;return {...base,items:await Promise.all((base.items??[]).map((item:any)=>observed(ctx,item.policyId,{canary:item})))};
});
registerSimReader('featureOpsMetrics',async ctx=>{
 const id=ctx.req.params.id,local=ctx.list<any>(FIND).filter(f=>f.featureId===id);if(!local.length)return undefined;const base=await ctx.snapshot<any>('featureOpsMetrics',{id});if(!base)throw new SimError('NOT_FOUND','운영 지표 원천이 없습니다.');return {...base,findings:[...new Map([...(base.findings??[]),...local].map(f=>[f.findingId,f])).values()].map(f=>decorate(f,ctx.now().getTime()))};
});
