import { DEFAULT_GATE_POLICY, gateVerdict, profileFinding } from '@ff/contracts';
import { compareAsBuilt,eolCheckBlockers,eolStatus,EOL_VERDICT_LABEL,EOL_STATUS_LABEL } from '../../../../../contracts/src/rules/eol';
import { EolCheckBody } from '../../../../../contracts/src/schemas/ads-p5';
import { registerSimHandler,registerSimReader,SimError } from '../engine';
import type { SimReadContext } from '../types';
const CHECK='localEolCheck';
async function vehicle(ctx:SimReadContext,vin:string){
 const base=await ctx.snapshot<any>('eolVehicle',{vin});if(!base)throw new SimError('NOT_FOUND','내장 출고 구성 기록이 없습니다.');
 if(!Array.isArray(base.orderEcus)||!Array.isArray(base.builtEcus))throw new SimError('GUARD_FAILED','주문·실물 구성 원문이 없습니다.');
 const checks=[...(base.checks??[]),...ctx.list<any>(CHECK).filter(c=>c.vin===vin)],compare=compareAsBuilt(base.orderEcus,base.builtEcus),status=eolStatus(compare,checks);
 return {...base,...compare,verdictLabel:EOL_VERDICT_LABEL[compare.verdict],status,statusLabel:EOL_STATUS_LABEL[status],checks,lastCheck:checks.at(-1)??null};
}
registerSimReader('eolVehicle',ctx=>ctx.list<any>(CHECK).some(c=>c.vin===ctx.req.params.vin)?vehicle(ctx,ctx.req.params.vin):undefined);
registerSimReader('eolMismatches',async ctx=>{
 if(!ctx.list(CHECK).length)return undefined;const base=await ctx.snapshot<any>('eolMismatches');if(!base)throw new SimError('NOT_FOUND','내장 출고 대조 목록이 없습니다.');
 const items=await Promise.all(base.items.map(async(r:any)=>{if(!ctx.list<any>(CHECK).some(c=>c.vin===r.vin))return r;const {checks,acceptance,...row}=await vehicle(ctx,r.vin);void checks;void acceptance;return row;}));
 return {...base,items,summary:{total:items.length,hold:items.filter(r=>['QUALITY_HOLD','REWORK'].includes(r.status)).length,unconfirmed:items.filter(r=>r.verdict==='UNCONFIRMED').length,match:items.filter(r=>r.verdict==='MATCH').length,shippedWithMismatch:items.filter(r=>r.status==='SHIPPED'&&r.verdict!=='MATCH'&&r.lastCheck?.recheckResult!=='PASS').length}};
});
registerSimHandler('createEolCheck',async ctx=>{
 const b=ctx.req.body,v=await vehicle(ctx,b.vin),compare=compareAsBuilt(v.orderEcus,v.builtEcus),blockers=eolCheckBlockers({role:ctx.actor.role,decision:b.decision,recheckResult:b.recheckResult,shippedEvidence:b.shippedEvidence,compare});
 if(blockers.length)ctx.fail('GUARD_FAILED',blockers.map(b=>b.message).join(' · '),{blockers},{action:'EOL_CHECK',target:b.vin,reason:blockers.map(b=>b.code).join(','),componentId:'D05-02'});
 const list=await ctx.snapshot<any>('eolMismatches'),ids=[...(list?.items??[]).flatMap((r:any)=>r.lastCheck?[r.lastCheck.checkId]:[]),...v.checks.map((c:any)=>c.checkId),...ctx.list<any>(CHECK).map(c=>c.checkId)],checkId=ctx.nextId('EOL',ids),doc={...b,checkId,decidedBy:ctx.actor.id,decidedRole:ctx.actor.role,decidedAt:ctx.iso(),source:'LOCAL_SIMULATION',factoryRecordUpdated:false};
 ctx.put(CHECK,checkId,doc,{created:true});ctx.audit({action:'EOL_CHECK',target:b.vin,after:doc,reason:b.reason,componentId:'D05-02'});return doc;
},{body:EolCheckBody});
registerSimHandler('gatePreview',async ctx=>{
 const cmd=ctx.req.body,id=typeof cmd?.feature?.id==='string'?cmd.feature.id:'',ver=typeof cmd?.feature?.version==='string'?cmd.feature.version:'',snap=id&&ver?await ctx.snapshot<any>('gateSnapshot',{id,ver}):null,ledger=ctx.overlay.data.killLedger?.[id]??snap?.ledger;
 const registry={features:snap?.feature?{[id]:snap.feature}:{},policy:snap?.policy??DEFAULT_GATE_POLICY,ledger:ledger?{[id]:ledger}:{}},result=gateVerdict(cmd,registry,ctx.now());
 if(result.result==='SCHEMA_FAIL')return {...result,source:'LOCAL_SIMULATION',ledgerChanged:false};
 const p=profileFinding({market:cmd.target.market,request:cmd.request,fClass:snap?.feature?.f_class??null,adsFeature:!!snap?.feature?.ads_feature});
 // Captured key fingerprints are not public key material. Never attest native HSM approval signatures locally.
 const findings=[...result.findings.map(f=>f.rule==='FFG-PLT-005'?{...f,ok:false,message:f.message+' — 승인자 공개키 원문·장치 서명 검증은 현재 오프라인 범위에서 미확인입니다.'}:f),{rule:p.rule,ok:p.ok,message:p.detail}];
 if(!findings.some(f=>f.rule==='FFG-PLT-005'))findings.push({rule:'FFG-PLT-005',ok:false,message:'승인자 공개키 원문·장치 서명 검증은 현재 오프라인 범위에서 미확인입니다.'});
 return {...result,findings,result:'FAIL',profiles:p.profiles,approvalVerification:'UNVERIFIED_OFFLINE',source:'LOCAL_SIMULATION',ledgerChanged:false};
});
