import { CreateWorkflowCaseBody, WorkflowActivityReviewBody, WorkflowActivitySubmitBody, WorkflowArtifactBody, WorkflowExecutionError, WorkflowHandoffBody, WorkflowHandoffReceiveBody, WorkflowRoleGrantBody, addWorkflowArtifact, executionActivity, offerWorkflowHandoff, receiveWorkflowHandoff, reviewWorkflowActivity, submitWorkflowActivity, type WorkflowCase, type WorkflowCaseDetail, type WorkflowCaseHistory, type WorkflowCommandActor, type WorkflowRoleGrant, type WorkflowStoredFile } from '@ff/contracts';
import { WORKFLOW_EXECUTION_MODEL as M } from '../../../../../contracts/src/generated/workflow-execution-model';
import { registerSimHandler as registerHandler, registerSimReader as registerReader, SimError } from '../engine';
import type { SimHandler, SimReader, SimReadContext, SimWriteContext } from '../types';
import { hydrateWorkflowSnapshot } from './workflow-snapshot';
import { canonicalJson, type WorkflowSourceObservation, type WorkflowSourceView } from '@ff/contracts';
import { handlesActivity, workflowTransferProducts, offerCrossCaseWorkflow, receiveCrossCaseWorkflow, WorkflowCrossCaseOfferBody, WorkflowCrossCaseReceiveBody } from '@ff/contracts';
import { readBrowserBinary, stageBrowserBinary, verifiedBrowserBlob } from '../binary-store';

const CASE='workflowCase',GRANT='workflowGrant',HISTORY='workflowHistory';
function registerSimReader(name:string,fn:SimReader) { registerReader(name,async ctx=>{activeRead(ctx);await hydrateWorkflowSnapshot(ctx);try{return await fn(ctx);}catch(e){if(e instanceof WorkflowExecutionError)throw new SimError(e.code,e.message,e.details);throw e;}}); }
function registerSimHandler(name:string,fn:SimHandler,opts:Parameters<typeof registerHandler>[2]={}) { registerHandler(name,async ctx=>{active(ctx);await hydrateWorkflowSnapshot(ctx);return fn(ctx);},opts); }
const state=(ctx:SimReadContext,id:string)=>ctx.get<{state:string}>('f0Account',id)?.state??(Object.prototype.hasOwnProperty.call(M.personas,id.replace(/^usr-/,''))?'ACTIVE':'ABSENT');
function grants(ctx:SimReadContext):WorkflowRoleGrant[] {const latest=new Map<string,WorkflowRoleGrant>();for(const g of ctx.list<WorkflowRoleGrant>(GRANT).sort((a,b)=>a.id-b.id))latest.set(`${g.accountId}|${g.roleId}`,g);return [...latest.values()].filter(g=>ctx.actor.role==='SYSTEM_ADMIN'||g.accountId===ctx.actor.id);}
function roles(ctx:SimReadContext):string[] {return state(ctx,ctx.actor.id)!=='ACTIVE'?[]:[...new Set([...(M.personas[ctx.actor.persona]??[]),...grants(ctx).filter(g=>g.active&&g.accountId===ctx.actor.id).map(g=>g.roleId)])];}
function canRead(ctx:SimReadContext,item:WorkflowCase) {const mine=roles(ctx),activities=M.processes.find(p=>p.id===item.processId)!.activities;return ctx.actor.role==='SYSTEM_ADMIN'||item.createdBy===ctx.actor.id||[...activities,...item.handoffs.filter(h=>!h.toCaseId).map(h=>executionActivity(M,h.toActivityId))].some(a=>[...a.raci.R,a.raci.A,...a.raci.C,...a.raci.I].some(r=>mine.includes(r)));}
function activeRead(ctx:SimReadContext){if(state(ctx,ctx.actor.id)!=='ACTIVE')throw new SimError('FORBIDDEN','사용 중인 실제 계정으로 확인된 담당자만 업무를 처리할 수 있습니다.');}
function detail(ctx:SimReadContext,id:string):WorkflowCaseDetail {activeRead(ctx);const item=ctx.get<WorkflowCase>(CASE,id);if(!item)throw new SimError('NOT_FOUND','업무 건을 찾을 수 없습니다.');if(!canRead(ctx,item))throw new SimError('FORBIDDEN','이 업무 건의 담당·검토·협의 역할이 아닙니다.');const transferVersions:Record<string,number>={};for(const h of item.handoffs)for(const key of [h.fromCaseId,h.toCaseId])if(key){const c=ctx.get<WorkflowCase>(CASE,key);if(c)transferVersions[key]=c.version;}return {item,model:M.processes.find(p=>p.id===item.processId)!,roleIds:roles(ctx),history:ctx.list<WorkflowCaseHistory>(HISTORY).filter(h=>h.caseId===id).sort((a,b)=>a.id-b.id),transferVersions};}
function active(ctx:SimWriteContext) {if(state(ctx,ctx.actor.id)!=='ACTIVE')ctx.fail('FORBIDDEN','사용 중인 실제 계정으로 확인된 담당자만 업무를 처리할 수 있습니다.');}
function record(ctx:SimWriteContext,item:WorkflowCase,action:string,info:Record<string,unknown>) {const id=Math.max(0,...ctx.list<WorkflowCaseHistory>(HISTORY).map(h=>h.id))+1;ctx.put(HISTORY,String(id),{id,caseId:item.caseId,version:item.version,action,by:ctx.actor.id,at:ctx.iso(),detail:info});ctx.audit({action,target:item.caseId,after:{version:item.version,...info},componentId:'D04-04'});ctx.emit('workflow.case.changed',item.caseId,{caseId:item.caseId,action,version:item.version,...info},{componentId:'D04-04'});}
function change(ctx:SimWriteContext,action:string,info:Record<string,unknown>,fn:(item:WorkflowCase,who:WorkflowCommandActor)=>WorkflowCase) {active(ctx);const old=detail(ctx,ctx.req.params.id).item;let next:WorkflowCase;try{next=fn(old,{id:ctx.actor.id,roleIds:roles(ctx),at:ctx.iso()});}catch(e){if(e instanceof WorkflowExecutionError)ctx.fail(e.code,e.message,e.details,{action,target:old.caseId,reason:e.message,componentId:'D04-04',result:e.code==='FORBIDDEN'?'DENIED':'FAILED'});throw e;}if(next!==old){if(new TextEncoder().encode(JSON.stringify(next)).length>5*1024*1024)ctx.fail('GUARD_FAILED','업무 건 첨부·이력이 5MiB를 넘습니다. 새 업무 건으로 분리하세요.');ctx.put(CASE,next.caseId,next);record(ctx,next,action,info);}return detail(ctx,old.caseId);}
registerSimReader('workflowIdentity',ctx=>({accountId:ctx.actor.id,accountState:state(ctx,ctx.actor.id),roleIds:roles(ctx),roles:M.roles,canAssign:state(ctx,ctx.actor.id)==='ACTIVE'&&ctx.actor.role==='SYSTEM_ADMIN'}));
registerSimReader('workflowAssignableAccounts',async ctx=>{
  activeRead(ctx);
  if(ctx.actor.role!=='SYSTEM_ADMIN')throw new SimError('FORBIDDEN','업무 역할 배정 대상은 시스템 관리자만 조회할 수 있습니다.');
  const known=Object.keys(M.personas).map(id=>`usr-${id}`);
  return {items:known.filter(id=>state(ctx,id)==='ACTIVE').map(id=>({id,state:'ACTIVE'}))};
});
registerSimReader('workflowRoleGrants',ctx=>{activeRead(ctx);return {items:grants(ctx)};});
registerSimReader('workflowCases',ctx=>{activeRead(ctx);return {items:ctx.list<WorkflowCase>(CASE).filter(c=>canRead(ctx,c)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(({artifacts,activities,handoffs,...c})=>({...c,artifactCount:artifacts.length,submitted:Object.values(activities).filter(a=>a.status==='SUBMITTED').length,accepted:Object.values(activities).filter(a=>a.status==='ACCEPTED').length,handoffs:handoffs.filter(h=>h.status==='OFFERED').length}))};});
registerSimReader('workflowCase',ctx=>detail(ctx,ctx.req.params.id));
registerSimReader('workflowCaseSources',async ctx=>{
  const item=detail(ctx,ctx.req.params.id).item;
  const captured=await ctx.snapshot<WorkflowSourceView>('workflowCaseSources',{id:item.caseId});
  const sourceEdited=Object.entries(ctx.overlay.entities).some(([key,rows])=>![CASE,GRANT,HISTORY,'f0Account'].includes(key)&&Object.keys(rows).length>0);
  if(captured?.targetRef===item.targetRef&&!sourceEdited)return captured;
  const view:WorkflowSourceView={targetRef:item.targetRef,status:'DECLARED',items:[],unavailable:[],limitation:'정적 시연 데이터의 현재 레코드와 내용 해시입니다. 실제 외부 파일·개인 서명·원천 승인 유효성은 원천 시스템에서 확인하세요.'};
  const match=/^(FEAT-\d+)@([0-9]+\.[0-9]+\.[0-9]+)$/.exec(item.targetRef);
  if(!match)return view;
  const [,id,ver]=match;
  const observe=async(kind:WorkflowSourceObservation['kind'],record:Record<string,any>,sourceId:string,revision:unknown=null,state:unknown=null)=>{
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(record)));
    view.items.push({kind,id:sourceId,record,recordHash:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''),revision:revision===null?null:String(revision),state:state===null?null:String(state),observedAt:ctx.now().toISOString(),verification:'RECORD_OBSERVED'});
  };
  try{const feature=(await ctx.read('featureDetail',{id,ver})).feature;if(feature)await observe('FEATURE',feature,id,ver,feature.lifecycle??null);else return view;}catch{view.unavailable.push('FEATURE');return view;}
  view.status='RESOLVED';
  const rows=(v:any):any[]=>Array.isArray(v)?v:v?.items??[];
  for(const [kind,name,key,params,query] of [
    ['EVIDENCE','evidenceLedger','evidenceRef',{},{}],
    ['POLICY','listPolicies','policyId',{},{}],
    ['BASELINE','baselines','baselineId',{},{}],
  ] as const){
    try{const records=rows(await ctx.read(name,params,query)).filter(r=>r.featureId===id&&(r.featureVersion??r.version)===ver);for(const r of records)await observe(kind,r,r[key],r.revision??r.version??null,r.status??null);}catch{view.unavailable.push(kind);}
  }
  view.unavailable.push('GATE','ANALYSIS','ALM_ITEM','SUPPLIER_ARTIFACT','SUPPLIER_PACKAGE');
  return view;
});
registerSimHandler('setWorkflowRoleGrant',ctx=>{active(ctx);const b=WorkflowRoleGrantBody.parse(ctx.req.body);if(ctx.actor.role!=='SYSTEM_ADMIN')ctx.fail('FORBIDDEN','업무 역할 배정은 시스템 관리자만 할 수 있습니다.');if(!M.roles.some(r=>r.id===b.roleId))ctx.fail('VALIDATION','업무 모델에 없는 역할입니다.');if(b.active&&state(ctx,b.accountId)!=='ACTIVE')ctx.fail('GUARD_FAILED','사용 중인 계정으로 확인된 대상에게만 역할을 배정하세요.');const id=ctx.list(GRANT).length+1;ctx.put(GRANT,String(id),{...b,id,by:ctx.actor.id,at:ctx.iso()});ctx.audit({action:'WORKFLOW_ROLE_GRANT',target:b.accountId,after:{roleId:b.roleId,active:b.active},reason:b.reason,componentId:'D04-04'});ctx.emit('workflow.role.changed',b.accountId,{accountId:b.accountId,roleId:b.roleId,active:b.active},{componentId:'D04-04'});return {items:grants(ctx)};},{body:WorkflowRoleGrantBody});
registerSimHandler('createWorkflowCase',ctx=>{active(ctx);const b=CreateWorkflowCaseBody.parse(ctx.req.body),process=M.processes.find(p=>p.id===b.processId);if(!process)ctx.fail('VALIDATION','업무 모델에 없는 절차입니다.');if(!process.activities.some(a=>[...a.raci.R,a.raci.A].some(r=>roles(ctx).includes(r))))ctx.fail('FORBIDDEN','이 절차를 수행·책임지는 역할로 배정되지 않았습니다.');const caseId=ctx.nextId('WFC',ctx.list<WorkflowCase>(CASE).map(c=>c.caseId)),at=ctx.iso();const item:WorkflowCase={...b,caseId,version:1,createdBy:ctx.actor.id,createdAt:at,updatedAt:at,activities:{},artifacts:[],handoffs:[]};ctx.put(CASE,caseId,item,{created:true});record(ctx,item,'WORKFLOW_CASE_CREATE',{targetRef:item.targetRef});return detail(ctx,caseId);},{body:CreateWorkflowCaseBody});
registerSimHandler('createWorkflowArtifact',async ctx=>{const b=WorkflowArtifactBody.parse(ctx.req.body);const files:WorkflowStoredFile[]=await Promise.all(b.files.map(async f=>{if(/[\x00-\x1f\x7f/\\]/.test(f.name)||!/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(f.mediaType))ctx.fail('VALIDATION','첨부 이름·유형을 확인하세요.');let decoded:string;try{decoded=atob(f.base64);}catch{ctx.fail('VALIDATION','첨부 형식을 확인하세요.');}if(!decoded!.length||decoded!.length>256*1024||btoa(decoded!)!==f.base64)ctx.fail('VALIDATION','첨부는 정상 형식의 256KiB 이하 파일이어야 합니다.');const bytes=Uint8Array.from(decoded!,v=>v.charCodeAt(0)),digest=await crypto.subtle.digest('SHA-256',bytes);return {...f,bytes:bytes.length,sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')};}));files.push(...await browserAttachmentFiles(ctx,b));return change(ctx,'WORKFLOW_ARTIFACT_CREATE',{activityId:b.activityId,productKey:b.productKey},(item,who)=>addWorkflowArtifact(M,item,b,who,{artifactId:ctx.nextId('WPA',item.artifacts.map(v=>v.artifactId)),files}));},{body:WorkflowArtifactBody});
registerSimHandler('submitWorkflowActivity',ctx=>change(ctx,'WORKFLOW_ACTIVITY_SUBMIT',{activityId:ctx.req.params.activityId},(item,who)=>submitWorkflowActivity(M,item,ctx.req.params.activityId,WorkflowActivitySubmitBody.parse(ctx.req.body),who)),{body:WorkflowActivitySubmitBody});
registerSimHandler('reviewWorkflowActivity',ctx=>change(ctx,'WORKFLOW_ACTIVITY_REVIEW',{activityId:ctx.req.params.activityId,decision:ctx.req.body.decision},(item,who)=>reviewWorkflowActivity(M,item,ctx.req.params.activityId,WorkflowActivityReviewBody.parse(ctx.req.body),who)),{body:WorkflowActivityReviewBody});
registerSimHandler('offerWorkflowHandoff',async ctx=>{
  const b=WorkflowHandoffBody.parse(ctx.req.body),{version:_v,...payload}=b;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
  const payloadHash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  return change(ctx,'WORKFLOW_HANDOFF_OFFER',{fromActivityId:b.fromActivityId,toActivityId:b.toActivityId},(item,who)=>offerWorkflowHandoff(M,item,b,who,{handoffId:ctx.nextId('WFH',item.handoffs.map(h=>h.handoffId)),payloadHash}));
},{body:WorkflowHandoffBody});
registerSimHandler('receiveWorkflowHandoff',ctx=>change(ctx,'WORKFLOW_HANDOFF_RECEIVE',{handoffId:ctx.req.params.handoffId,decision:ctx.req.body.decision},(item,who)=>receiveWorkflowHandoff(M,item,ctx.req.params.handoffId,WorkflowHandoffReceiveBody.parse(ctx.req.body),who)),{body:WorkflowHandoffReceiveBody});

const sha=async(v:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(v))))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function browserAttachmentFiles(ctx:SimWriteContext,b:WorkflowArtifactBody):Promise<WorkflowStoredFile[]> {
  const ids=b.fileIds??[];if(new Set(ids).size!==ids.length)ctx.fail('VALIDATION','동일 첨부를 중복 연결할 수 없습니다.');
  const files:WorkflowStoredFile[]=[];
  for(const id of ids){
    const row=await readBrowserBinary(id);
    const existing=ctx.get<WorkflowCase>(CASE,ctx.req.params.id)?.artifacts.some(a=>a.files.some(f=>f.fileId===id));
    if(row.version!==ctx.overlay.version||row.scope!==`workflow:${ctx.req.params.id}:${b.activityId}`||row.ownerId!==ctx.actor.id&&!existing)ctx.fail('FORBIDDEN','이 활동의 기존 첨부 또는 본인이 올린 임시 첨부만 연결할 수 있습니다.');
    if(row.expires<Date.now()&&!existing)ctx.fail('CONFLICT','첨부 업로드를 다시 완료하세요.');
    await verifiedBrowserBlob(id);files.push(row.file);
  }
  ctx.attachBinary(ids);return files;
}
registerSimReader('workflowTransferTargets',ctx=>{
  const source=detail(ctx,ctx.req.params.id).item,a=executionActivity(M,ctx.req.query.fromActivityId);
  if(a.processId!==source.processId||!handlesActivity({roleIds:roles(ctx)},a))throw new SimError('FORBIDDEN','발신 활동의 수행·책임 역할이 아닙니다.');
  return {items:ctx.list<WorkflowCase>(CASE).filter(t=>t.caseId!==source.caseId&&t.targetRef===source.targetRef).map(t=>({caseId:t.caseId,title:t.title,processId:t.processId,version:t.version,activities:M.processes.find(p=>p.id===t.processId)!.activities.map(b=>({id:b.id,productKeys:workflowTransferProducts(M,a.id,b.id)})).filter(b=>b.productKeys.length)})).filter(t=>t.activities.length)};
});
function pairChange(ctx:SimWriteContext,pair:[WorkflowCase,WorkflowCase],old:[WorkflowCase,WorkflowCase],action:string){
  pair.forEach((next,i)=>{if(next===old[i])return;if(new TextEncoder().encode(JSON.stringify(next)).length>5*1024*1024)ctx.fail('GUARD_FAILED','인계 기록을 포함한 업무 건이 5MiB를 넘습니다.');ctx.put(CASE,next.caseId,next);record(ctx,next,action,{otherCaseId:old[1-i].caseId});});
  return detail(ctx,ctx.req.params.id);
}
registerSimHandler('offerCrossCaseWorkflow',async ctx=>{
  const b=WorkflowCrossCaseOfferBody.parse(ctx.req.body),source=detail(ctx,ctx.req.params.id).item,target=ctx.get<WorkflowCase>(CASE,b.toCaseId);
  if(!target)ctx.fail('NOT_FOUND','수신 업무 건이 없습니다.');
  const {version:_v,targetVersion:_t,...payload}=b,accepted=source.activities[b.fromActivityId],keys=workflowTransferProducts(M,b.fromActivityId,b.toActivityId);
  const artifacts=source.artifacts.filter(a=>accepted?.artifactIds.includes(a.artifactId)&&keys.includes(a.productKey));
  const identity={handoffId:`WFH-${crypto.randomUUID()}`,payloadHash:await sha(payload),artifactsHash:await sha(artifacts)};
  try{return pairChange(ctx,offerCrossCaseWorkflow(M,source,target!,b,{id:ctx.actor.id,roleIds:roles(ctx),at:ctx.iso()},identity),[source,target!],'WORKFLOW_CROSS_CASE_OFFER');}catch(e){if(e instanceof WorkflowExecutionError)ctx.fail(e.code,e.message);throw e;}
},{body:WorkflowCrossCaseOfferBody});
registerSimHandler('receiveCrossCaseWorkflow',ctx=>{
  const target=detail(ctx,ctx.req.params.id).item,h=target.handoffs.find(h=>h.handoffId===ctx.req.params.handoffId),source=h?.fromCaseId?ctx.get<WorkflowCase>(CASE,h.fromCaseId):null;
  if(!source)ctx.fail('NOT_FOUND','발신 인계가 없습니다.');
  try{return pairChange(ctx,receiveCrossCaseWorkflow(M,source!,target,ctx.req.params.handoffId,WorkflowCrossCaseReceiveBody.parse(ctx.req.body),{id:ctx.actor.id,roleIds:roles(ctx),at:ctx.iso()}),[source!,target],'WORKFLOW_CROSS_CASE_RECEIVE');}catch(e){if(e instanceof WorkflowExecutionError)ctx.fail(e.code,e.message);throw e;}
},{body:WorkflowCrossCaseReceiveBody});
function binaryWritable(ctx:SimReadContext,id:string,activityId:string,version:number){
  const item=detail(ctx,id).item,a=executionActivity(M,activityId);
  if(item.version!==version)throw new SimError('PRECONDITION_FAILED','업무 건 최신 버전을 다시 확인하세요.');
  if(a.processId!==item.processId||!handlesActivity({roleIds:roles(ctx)},a))throw new SimError('FORBIDDEN','이 활동의 수행·책임 역할만 파일을 올릴 수 있습니다.');
  if(['SUBMITTED','ACCEPTED'].includes(item.activities[activityId]?.status))throw new SimError('CONFLICT','검토 중·수락된 활동에는 파일을 올릴 수 없습니다.');
}
registerSimHandler('uploadWorkflowFile',async ctx=>{
  const b=ctx.req.body,{id,activityId}=ctx.req.params;
  binaryWritable(ctx,id,activityId,b.version);
  if(!(b.blob instanceof Blob))ctx.fail('VALIDATION','실제 파일 바이트가 필요합니다.');
  const referenced=new Set(ctx.list<WorkflowCase>(CASE).flatMap(c=>c.artifacts.flatMap(a=>a.files.map(f=>f.fileId).filter((id):id is string=>!!id))));
  const result=await stageBrowserBinary(b.blob,{scope:`workflow:${id}:${activityId}`,ownerId:ctx.actor.id,requestKey:b.requestKey,version:ctx.overlay.version,name:b.name,mediaType:b.mediaType},referenced);
  binaryWritable(ctx,id,activityId,b.version);
  ctx.audit({action:'WORKFLOW_FILE_UPLOAD',target:id,after:{fileId:result.fileId,bytes:result.bytes,sha256:result.sha256},componentId:'D04-04'});
  return result;
});
registerSimReader('workflowFile',async ctx=>{
  const item=detail(ctx,ctx.req.params.id).item,fileId=ctx.req.params.fileId;
  const can=(activityId:string)=>{const a=executionActivity(M,activityId);return [...a.raci.R,a.raci.A,...a.raci.C].some(r=>roles(ctx).includes(r));};
  if(!item.artifacts.some(a=>can(a.activityId)&&a.files.some(f=>f.fileId===fileId))&&!item.handoffs.some(h=>h.toCaseId===item.caseId&&h.status!=='RETURNED'&&can(h.toActivityId)&&h.artifacts?.some(a=>a.files.some(f=>f.fileId===fileId))))throw new SimError('FORBIDDEN','이 활동 또는 수신 인계의 첨부 조회 역할이 아닙니다.');
  const row=await readBrowserBinary(fileId);if(row.version!==ctx.overlay.version)throw new SimError('NOT_FOUND','현재 시연 판의 첨부가 아닙니다.');
  return verifiedBrowserBlob(fileId);
});
