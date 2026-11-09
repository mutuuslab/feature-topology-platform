// Local management records only. No remote credentials, connections or vehicle application.
import { IssueApiKeyBody, RevokeApiKeyBody, apiKeyExpiry, apiKeyPrefix, apiKeyState } from '../../../../../contracts/src/rules/api-gateway';
import { CreateLegacyLinkBody, UpdateLegacyLinkBody, DeleteLegacyLinkBody, CreateLegacyRuleBody, UpdateLegacyRuleBody, RunLegacyBridgeBody, LegacyMessageBody, legacyToSdv, legacyBridge, legacyLinkProblems } from '../../../../../contracts/src/rules/legacy-link';
import { SendSettlementBody, SettlementPeriod, periodClosed, previousPeriod, settlementUsage, settlementTotals, settlementRange, SETTLEMENT_ITEMS, SETTLEMENT_CYCLE } from '../../../../../contracts/src/rules/settlement';
import { LakeModelDecisionBody } from '../../../../../contracts/src/schemas/lake';
import { MODEL_USE_REQUIRED, modelUsable } from '../../../../../contracts/src/rules/lake';
import { KillIntakeDismissBody } from '../../../../../contracts/src/rules/kill-intake';
import { CloseRejudgeBody } from '../../../../../contracts/src/rules/alm/api';
import { registerSimHandler, registerSimReader } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';
import {readLocalWp,allRejudges} from './alm-local';
import { p10Registry as R } from './registry';
const KEY='localApiKey', LINK='localLegacyLink', DELETED='localDeletedLegacyLink', RULE='localLegacyRule', MODEL='localLakeModel', INTAKE='localKillIntake', REJUDGE='localAlmRejudge';
const MSG='localLegacyMessage', SETTLE='localSettlementTransmission';
const rows=(v:any):any[]=>Array.isArray(v)?v:v?.items??[];
const merge=(a:any[],b:any[],key:string)=>[...new Map([...a,...b].map(r=>[r[key],r])).values()];
const keyView=(k:any,ctx:SimReadContext)=>{const {hash,...view}=k;void hash;return {...view,state:apiKeyState(k,ctx.now().toISOString())};};
async function keys(ctx:SimReadContext){return merge(rows(await ctx.snapshot('apiKeys')),ctx.list(KEY),'keyId');}
registerSimReader('apiKeys',async ctx=>ctx.list(KEY).length?{items:(await keys(ctx)).map(k=>keyView(k,ctx))}:undefined);
registerSimHandler('issueApiKey',async ctx=>{
 const b=ctx.req.body,now=ctx.iso(),expiry=apiKeyExpiry(b.expiresOn,now),expiresOn=expiry.ok===true?expiry.expiresOn:ctx.fail('VALIDATION',expiry.reason);
 const keyId=ctx.nextId('AK',(await keys(ctx)).map(k=>k.keyId),4),bytes=crypto.getRandomValues(new Uint8Array(32));
 const secret='ffk_'+keyId+'_'+btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const k={keyId,name:b.name,system:b.system,role:b.role,prefix:apiKeyPrefix(secret),createdBy:ctx.actor.id,createdAt:now,expiresOn,lastUsedAt:null,revokedAt:null,revokedBy:null,revokeReason:null,hash,localOnly:true};
 ctx.put(KEY,keyId,k,{created:true});const view=keyView(k,ctx);ctx.audit({action:'API_KEY_ISSUE',target:keyId,after:view,reason:b.reason,componentId:'D05-01'});ctx.emit('apikey.issued',keyId,{...view,by:ctx.actor.id});return {...view,secret};
},{body:IssueApiKeyBody});
registerSimHandler('revokeApiKey',async ctx=>{
 const id=ctx.req.params.id,b=ctx.req.body,k=(await keys(ctx)).find(k=>k.keyId===id);if(!k)ctx.fail('NOT_FOUND','API 키를 찾을 수 없습니다.');if(k.revokedAt||k.state==='REVOKED')ctx.fail('CONFLICT','이미 폐기한 키입니다.');
 const next={...k,hash:null,revokedAt:ctx.iso(),revokedBy:ctx.actor.id,revokeReason:b.reason};ctx.put(KEY,id,next);const view=keyView(next,ctx);ctx.audit({action:'API_KEY_REVOKE',target:id,before:{state:apiKeyState(k,ctx.iso())},after:{state:'REVOKED'},reason:b.reason,componentId:'D05-01'});ctx.emit('apikey.revoked',id,{keyId:id,system:k.system,role:k.role,localOnly:true});return view;
},{body:RevokeApiKeyBody});
async function links(ctx:SimReadContext){const deleted=new Set(ctx.list<any>(DELETED).map(x=>x.linkId));return merge(rows(await ctx.snapshot('legacyLinks')),ctx.list(LINK),'linkId').filter(x=>!deleted.has(x.linkId));}
registerSimReader('legacyLinks',async ctx=>ctx.list(LINK).length||ctx.list(DELETED).length?{items:await links(ctx)}:undefined);
function checkLink(ctx:SimWriteContext,c:any){const problems=legacyLinkProblems(c);if(problems.length)ctx.fail('VALIDATION',problems.join(' · '),{problems});}
registerSimHandler('createLegacyLink',async ctx=>{
 const b=ctx.req.body,all=await links(ctx);checkLink(ctx,b);if(all.some(x=>x.system===b.system))ctx.fail('CONFLICT','같은 시스템의 설정이 있습니다. 기존 설정을 수정하세요.');
 const id=ctx.nextId('LNK',[...all,...ctx.list<any>(DELETED)].map(x=>x.linkId),4),at=ctx.iso(),l={...b,linkId:id,version:1,bridge:legacyBridge(b),createdBy:ctx.actor.id,createdAt:at,updatedBy:ctx.actor.id,updatedAt:at,lastRun:null,localOnly:true};ctx.put(LINK,id,l,{created:true});ctx.audit({action:'LEGACY_LINK_CREATE',target:id,after:l,componentId:'D05-03'});ctx.emit('legacy.link.created',id,{linkId:id,system:l.system,localOnly:true});return l;
},{body:CreateLegacyLinkBody});
registerSimHandler('updateLegacyLink',async ctx=>{
 const id=ctx.req.params.id,l=(await links(ctx)).find(x=>x.linkId===id);if(!l)ctx.fail('NOT_FOUND','연계 설정을 찾을 수 없습니다.');const {reason,...patch}=ctx.req.body,next={...l,...patch};checkLink(ctx,next);
 const changed=Object.keys(patch).filter(k=>patch[k]!==l[k]);if(!changed.length)ctx.fail('VALIDATION','바뀐 항목이 없습니다.');const n={...next,version:l.version+1,bridge:legacyBridge(next),updatedBy:ctx.actor.id,updatedAt:ctx.iso(),localOnly:true};ctx.put(LINK,id,n);ctx.audit({action:'LEGACY_LINK_UPDATE',target:id,before:l,after:n,reason,componentId:'D05-03'});ctx.emit('legacy.link.updated',id,{linkId:id,changed,version:n.version,localOnly:true});return n;
},{body:UpdateLegacyLinkBody});
registerSimHandler('deleteLegacyLink',async ctx=>{
 const id=ctx.req.params.id,l=(await links(ctx)).find(x=>x.linkId===id);if(!l)ctx.fail('NOT_FOUND','연계 설정을 찾을 수 없습니다.');if(l.status==='ACTIVE')ctx.fail('GUARD_FAILED','활성 연계는 먼저 비활성으로 바꾼 후 삭제하세요.');ctx.put(DELETED,id,{linkId:id,by:ctx.actor.id,at:ctx.iso()});ctx.audit({action:'LEGACY_LINK_DELETE',target:id,before:l,reason:ctx.req.body.reason,componentId:'D05-03'});ctx.emit('legacy.link.deleted',id,{linkId:id,system:l.system,localOnly:true});return {linkId:id,deleted:true};
},{body:DeleteLegacyLinkBody});
async function rules(ctx:SimReadContext){return merge(rows(await ctx.snapshot('legacyMappings')),ctx.list(RULE),'legacyCode');}
registerSimReader('legacyMappings',async ctx=>{if(!ctx.list(RULE).length)return undefined;const fs=await R.allSummaries(ctx);return {items:(await rules(ctx)).map(r=>({...r,featureName:fs.find(f=>f.featureId===r.featureId)?.name??null,known:fs.some(f=>f.featureId===r.featureId)}))};});
for(const [name,schema,create] of [['createLegacyRule',CreateLegacyRuleBody,true],['updateLegacyRule',UpdateLegacyRuleBody,false]] as const){registerSimHandler(name,async ctx=>{
 const b=ctx.req.body,code=create?b.legacyCode:ctx.req.params.code,old=(await rules(ctx)).find(r=>r.legacyCode===code);if(create&&old)ctx.fail('CONFLICT','같은 코드의 규칙이 있습니다.');if(!create&&!old)ctx.fail('NOT_FOUND','변환 규칙을 찾을 수 없습니다.');
 const {reason,...input}=b,n={...old,...input,legacyCode:code,source:'REGISTERED',version:(old?.version??0)+1,updatedBy:ctx.actor.id,updatedAt:ctx.iso()};if(!(await R.allSummaries(ctx)).some(f=>f.featureId===n.featureId))ctx.fail('VALIDATION','등록된 Feature를 선택하세요.');
 ctx.put(RULE,code,n,{created:create});ctx.audit({action:create?'LEGACY_RULE_CREATE':'LEGACY_RULE_UPDATE',target:code,before:old??null,after:n,reason,componentId:'D05-03'});ctx.emit('legacy.rule.changed',code,{legacyCode:code,featureId:n.featureId,version:n.version});return n;
},{body:schema});}
async function models(ctx:SimReadContext){const base=await ctx.snapshot<any>('lakeModels');return base?{...base,items:(base.items??[]).map((m:any)=>ctx.get<any>(MODEL,m.modelId+'@'+m.version)??m)}:null;}
registerSimReader('lakeModels',ctx=>ctx.list(MODEL).length?models(ctx):undefined);
registerSimHandler('approveLakeModel',async ctx=>{
 const base=await models(ctx);if(!base?.connected)ctx.fail('GUARD_FAILED','내장 Data Lake 모델 원천이 없습니다.');const b=ctx.req.body,key=ctx.req.params.id+'@'+b.version,m=base.items.find((m:any)=>m.modelId===ctx.req.params.id&&m.version===b.version);if(!m)ctx.fail('NOT_FOUND','모델 판을 찾을 수 없습니다.');if(m.use!=='PENDING')ctx.fail('GUARD_FAILED','이미 결정한 모델 판입니다.');if(m.approvals.some((a:any)=>a.by===ctx.actor.id))ctx.fail('SEPARATION_OF_DUTY','서로 다른 두 사람이 결정해야 합니다.');if(b.decision==='APPROVE'&&m.drift)ctx.fail('GUARD_FAILED','드리프트 모델은 승인할 수 없습니다.');
 const approvals=[...m.approvals,{by:ctx.actor.id,role:ctx.actor.role,decision:b.decision,reason:b.reason,at:ctx.iso()}],use=b.decision==='REJECT'?'REJECTED':approvals.filter(a=>a.decision==='APPROVE').length>=MODEL_USE_REQUIRED?'APPROVED':'PENDING',n={...m,approvals,use,usable:modelUsable({use,drift:m.drift}),localOnly:true};ctx.put(MODEL,key,n);ctx.audit({action:'LAKE_MODEL_USE',target:key,before:{use:m.use,approvals:m.approvals.length},after:{use,approvals:approvals.length,required:MODEL_USE_REQUIRED},reason:b.reason,componentId:'D05-01'});ctx.emit('lake.model.use',m.modelId,{modelId:m.modelId,version:m.version,decision:b.decision,use,localOnly:true});return n;
},{body:LakeModelDecisionBody});
export async function localIntakes(ctx:SimReadContext){const base=rows(await ctx.snapshot('killIntakes',{},{}));const received=rows(await ctx.snapshot('killIntakes',{}, {status:'RECEIVED'}));return merge(merge(base,received,'intakeId'),ctx.list(INTAKE),'intakeId');}
registerSimReader('killIntakes',async ctx=>ctx.list(INTAKE).length?{items:(await localIntakes(ctx)).filter(x=>!ctx.req.query.status||x.status===ctx.req.query.status)}:undefined);
registerSimHandler('dismissKillIntake',async ctx=>{
 const id=ctx.req.params.id,i=(await localIntakes(ctx)).find(x=>x.intakeId===id);if(!i)ctx.fail('NOT_FOUND','접수를 찾을 수 없습니다.');if(i.status!=='RECEIVED')ctx.fail('CONFLICT','이미 처리한 접수입니다.');const n={...i,status:'DISMISSED',closedBy:ctx.actor.id,closedAt:ctx.iso(),closeReason:ctx.req.body.reason};ctx.put(INTAKE,id,n);ctx.audit({action:'KILL_INTAKE_DISMISS',target:id,before:{status:i.status},after:{status:n.status},reason:n.closeReason,componentId:'D03-03'});return n;
},{body:KillIntakeDismissBody});
// Rejudge closure is a human no-impact record, independent of external polling.
registerSimReader('almWorkProducts',ctx=>readLocalWp(ctx,ctx.req.params.id,ctx.req.params.ver));
registerSimReader('lakeAnomalyEvidence',async ctx=>{if(!ctx.list(MODEL).length)return undefined;const base=await ctx.snapshot<any>();if(!base)return undefined;return {...base,items:(base.items??[]).map((r:any)=>{const m=r.model&&ctx.get<any>(MODEL,r.model.modelId+'@'+r.model.version);return m?{...r,model:{...r.model,usable:m.usable}}:r;})};});
registerSimReader('lakeTrials',async ctx=>{if(!ctx.list(MODEL).length)return undefined;const base=await ctx.snapshot<any>();if(!base?.model)return undefined;const m=ctx.get<any>(MODEL,base.model.modelId+'@'+base.model.version);return m?{...base,model:m,targets:m.usable?base.targets:[]}:undefined;});
registerSimReader('almRejudge',async ctx=>ctx.list(REJUDGE).length?{items:(await allRejudges(ctx)).filter(r=>(!ctx.req.query.status||r.status===ctx.req.query.status)&&(!ctx.req.query.featureId||r.featureId===ctx.req.query.featureId))}:undefined);
registerSimHandler('closeAlmRejudge',async ctx=>{
 const b=ctx.req.body;if(typeof b.reason!=='string'||b.reason.trim().length<2||b.reason.trim().length>500)ctx.fail('VALIDATION','종료 사유를 2~500자로 입력하세요.');const all=await ctx.read<any>('almRejudge',{},{}),id=Number(ctx.req.params.id),r=rows(all).find(r=>r.rejudgeId===id);if(!r)ctx.fail('NOT_FOUND','재판정 요청을 찾을 수 없습니다.');if(r.status!=='OPEN')ctx.fail('CONFLICT','이미 닫힌 요청입니다.');const n={...r,status:'RESOLVED',resolvedBy:ctx.actor.id,resolvedAt:ctx.iso(),reason:b.reason.trim(),how:'closed'};ctx.put(REJUDGE,String(id),n);ctx.audit({action:'ALM_REJUDGE_CLOSE',target:r.featureId+'@'+r.version+'#'+r.gate,before:{status:'OPEN'},after:{status:'RESOLVED',rejudgeId:id},reason:n.reason,componentId:'D05-01'});return n;
},{body:CloseRejudgeBody});
registerSimHandler('runLegacyBridge',async ctx=>{
 const id=ctx.req.params.id,l=(await links(ctx)).find(x=>x.linkId===id);if(!l)ctx.fail('NOT_FOUND','연계 설정을 찾을 수 없습니다.');if(l.status!=='ACTIVE'||l.bridge.type==='REALTIME')ctx.fail('GUARD_FAILED','활성 배치·파일 브리지만 수동 실행합니다.');
 const result=await (await import('./business')).importLocalPlantOrders(ctx,l.plant),next={...l,lastRun:{at:ctx.iso(),status:'SUCCEEDED',orders:result.orders.length,unresolved:result.unresolved,reason:null,by:ctx.actor.id},localOnly:true};ctx.put(LINK,id,next);ctx.audit({action:'LEGACY_BRIDGE_RUN',target:id,after:{bridgeId:l.bridge.bridgeId,orders:result.orders.length,unresolved:result.unresolved,localOnly:true},componentId:'D05-03'});return next;
},{body:RunLegacyBridgeBody});
async function messages(ctx:SimReadContext){return merge(rows(await ctx.snapshot('legacyMessages',{},{})),ctx.list(MSG),'messageId');}
registerSimReader('legacyMessages',async ctx=>{if(!ctx.list(MSG).length)return undefined;const q=ctx.req.query;return {items:(await messages(ctx)).filter(x=>(!q.vin||q.vin===x.vin)&&(!q.status||q.status===x.status)).sort((a,b)=>b.messageId.localeCompare(a.messageId)).slice(0,Math.min(1000,Math.max(1,Number(q.limit)||200)))};});
registerSimHandler('receiveLegacyMessage',async ctx=>{
 const b=ctx.req.body,active=(await links(ctx)).find(l=>l.system===b.system&&l.status==='ACTIVE'&&l.bridge.type==='REALTIME'),vehicles=rows(await ctx.read('legacyVehicles')),ids=[...new Set((await R.allSummaries(ctx)).map(f=>String(f.featureId)))];
 const result=active?legacyToSdv(b,vehicles.find(v=>v.vin===b.vin),ids):{ok:false as const,reason:'활성 실시간 연계 설정의 메시지만 변환합니다.'};
 const messageId=ctx.nextId('LMSG',(await messages(ctx)).map(m=>m.messageId)),success=result.ok===true,row={messageId,at:ctx.iso(),direction:'LEGACY_TO_SDV',system:b.system,vin:b.vin,formatIn:b.format,formatOut:success?'SDV-FEATURE-STATE-1':null,status:success?'CONVERTED':'FAILED',reason:result.ok===false?result.reason:null,actorId:ctx.actor.id,output:result.ok===true?result.message:null,localOnly:true,vehicleApplicationPerformed:false};ctx.put(MSG,messageId,row,{created:true});ctx.audit({action:'LEGACY_MESSAGE_CONVERT',target:b.system+':'+b.vin,after:{messageId,status:row.status,localOnly:true},reason:row.reason,result:success?'ALLOWED':'FAILED',componentId:'D05-07'});return row;
},{body:LegacyMessageBody});
async function transmissions(ctx:SimReadContext){return merge(rows(await ctx.snapshot('settlementTransmissions',{},{})),ctx.list(SETTLE),'transmissionId');}
async function usage(ctx:SimReadContext,period:string){
 const grants=await ctx.read<any>('entitlements',{},{});if(!Array.isArray(grants?.items))throw new (await import('../engine')).SimError('GUARD_FAILED','이용 권한 원천이 없습니다.');
 const products=rows(await ctx.read('listProducts')),names=new Map<string,string>(products.map(p=>[p.catalogId,p.name])),lines=settlementUsage(period,grants.items,names),sent=(await transmissions(ctx)).find(t=>t.period===period&&t.status==='SENT');
 return {period,...settlementRange(period),closed:periodClosed(period,ctx.now().toISOString()),items:SETTLEMENT_ITEMS,cycle:SETTLEMENT_CYCLE,lines,totals:settlementTotals(lines),sent:sent?{transmissionId:sent.transmissionId,at:sent.at,receiptId:sent.receiptId}:null,localOnly:true};
}
registerSimReader('settlementUsage',async ctx=>{
 const p=ctx.req.query.period||previousPeriod(ctx.now().toISOString()),parsed=SettlementPeriod.safeParse(p);if(!parsed.success)throw new (await import('../engine')).SimError('VALIDATION','정산 기간은 YYYY-MM 형식입니다.');return usage(ctx,p);
});
registerSimReader('settlementTransmissions',async ctx=>ctx.list(SETTLE).length?{items:(await transmissions(ctx)).filter(t=>!ctx.req.query.period||t.period===ctx.req.query.period).sort((a,b)=>b.transmissionId.localeCompare(a.transmissionId)).slice(0,200)}:undefined);
registerSimHandler('sendSettlement',async ctx=>{
 const b=ctx.req.body;if(!periodClosed(b.period,ctx.iso()))ctx.fail('GUARD_FAILED','종료한 달의 사용량만 정산합니다.');const all=await transmissions(ctx);if(all.some(t=>t.period===b.period&&t.status==='SENT'))ctx.fail('CONFLICT','이 기간의 정산 기록이 이미 있습니다.');const u=await usage(ctx,b.period),id=ctx.nextId('STL',all.map(t=>t.transmissionId)),payload={period:b.period,lines:u.lines},payloadSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const t={transmissionId:id,period:b.period,at:ctx.iso(),status:'SENT',trigger:'MANUAL',actorId:ctx.actor.id,attempt:all.filter(t=>t.period===b.period).length+1,lines:u.lines.length,totals:u.totals,receiptId:'LOCAL-DEMO-'+id,reason:null,errorId:null,localOnly:true,deliveryMode:'LOCAL_DEMO',externalTransmissionPerformed:false,payloadSha256,payload};ctx.put(SETTLE,id,t,{created:true});ctx.audit({action:'SETTLEMENT_SEND',target:'SETTLEMENT:'+b.period,after:{transmissionId:id,receiptId:t.receiptId,totals:t.totals,payloadSha256,externalTransmissionPerformed:false},reason:b.reason,componentId:'D05-04'});ctx.emit('settlement.sent',b.period,{transmissionId:id,period:b.period,receiptId:t.receiptId,totals:t.totals,externalTransmissionPerformed:false});return t;
},{body:SendSettlementBody});
