import { CreateWorkflowCaseBody, WorkflowActivityReviewBody, WorkflowActivitySubmitBody, WorkflowArtifactBody, WorkflowExecutionError, WorkflowHandoffBody, WorkflowHandoffReceiveBody, WorkflowRoleGrantBody, addWorkflowArtifact, executionActivity, offerWorkflowHandoff, receiveWorkflowHandoff, reviewWorkflowActivity, submitWorkflowActivity, type WorkflowCase, type WorkflowCaseDetail, type WorkflowCaseHistory, type WorkflowCommandActor, type WorkflowRoleGrant, type WorkflowStoredFile } from '@ff/contracts';
import { WORKFLOW_EXECUTION_MODEL as M } from '../../../../../contracts/src/generated/workflow-execution-model';
import { registerSimHandler, registerSimReader, SimError } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';
import { canonicalJson, type WorkflowSourceObservation, type WorkflowSourceView } from '@ff/contracts';

const CASE='workflowCase',GRANT='workflowGrant',HISTORY='workflowHistory';
const state=(ctx:SimReadContext,id:string)=>ctx.get<{state:string}>('f0Account',id)?.state??(Object.prototype.hasOwnProperty.call(M.personas,id.replace(/^usr-/,''))?'ACTIVE':'ABSENT');
function grants(ctx:SimReadContext):WorkflowRoleGrant[] {const latest=new Map<string,WorkflowRoleGrant>();for(const g of ctx.list<WorkflowRoleGrant>(GRANT).sort((a,b)=>a.id-b.id))latest.set(`${g.accountId}|${g.roleId}`,g);return [...latest.values()].filter(g=>ctx.actor.role==='SYSTEM_ADMIN'||g.accountId===ctx.actor.id);}
function roles(ctx:SimReadContext):string[] {return state(ctx,ctx.actor.id)!=='ACTIVE'?[]:[...new Set([...(M.personas[ctx.actor.persona]??[]),...grants(ctx).filter(g=>g.active&&g.accountId===ctx.actor.id).map(g=>g.roleId)])];}
function canRead(ctx:SimReadContext,item:WorkflowCase) {const mine=roles(ctx),activities=M.processes.find(p=>p.id===item.processId)!.activities;return ctx.actor.role==='SYSTEM_ADMIN'||item.createdBy===ctx.actor.id||[...activities,...item.handoffs.map(h=>executionActivity(M,h.toActivityId))].some(a=>[...a.raci.R,a.raci.A,...a.raci.C,...a.raci.I].some(r=>mine.includes(r)));}
function detail(ctx:SimReadContext,id:string):WorkflowCaseDetail {const item=ctx.get<WorkflowCase>(CASE,id);if(!item)throw new SimError('NOT_FOUND','업무 건을 찾을 수 없습니다.');if(!canRead(ctx,item))throw new SimError('FORBIDDEN','이 업무 건의 담당·검토·협의 역할이 아닙니다.');return {item,model:M.processes.find(p=>p.id===item.processId)!,roleIds:roles(ctx),history:ctx.list<WorkflowCaseHistory>(HISTORY).filter(h=>h.caseId===id).sort((a,b)=>a.id-b.id)};}
function active(ctx:SimWriteContext) {if(state(ctx,ctx.actor.id)!=='ACTIVE')ctx.fail('FORBIDDEN','사용 중인 실제 계정으로 확인된 담당자만 업무를 처리할 수 있습니다.');}
function record(ctx:SimWriteContext,item:WorkflowCase,action:string,info:Record<string,unknown>) {const id=ctx.list(HISTORY).length+1;ctx.put(HISTORY,String(id),{id,caseId:item.caseId,version:item.version,action,by:ctx.actor.id,at:ctx.iso(),detail:info});ctx.audit({action,target:item.caseId,after:{version:item.version,...info},componentId:'D04-04'});ctx.emit('workflow.case.changed',item.caseId,{caseId:item.caseId,action,version:item.version,...info},{componentId:'D04-04'});}
function change(ctx:SimWriteContext,action:string,info:Record<string,unknown>,fn:(item:WorkflowCase,who:WorkflowCommandActor)=>WorkflowCase) {active(ctx);const old=detail(ctx,ctx.req.params.id).item;let next:WorkflowCase;try{next=fn(old,{id:ctx.actor.id,roleIds:roles(ctx),at:ctx.iso()});}catch(e){if(e instanceof WorkflowExecutionError)ctx.fail(e.code,e.message,e.details,{action,target:old.caseId,reason:e.message,componentId:'D04-04',result:e.code==='FORBIDDEN'?'DENIED':'FAILED'});throw e;}if(next!==old){if(new TextEncoder().encode(JSON.stringify(next)).length>5*1024*1024)ctx.fail('GUARD_FAILED','업무 건 첨부·이력이 5MiB를 넘습니다. 새 업무 건으로 분리하세요.');ctx.put(CASE,next.caseId,next);record(ctx,next,action,info);}return detail(ctx,old.caseId);}
registerSimReader('workflowIdentity',ctx=>({accountId:ctx.actor.id,accountState:state(ctx,ctx.actor.id),roleIds:roles(ctx),roles:M.roles,canAssign:ctx.actor.role==='SYSTEM_ADMIN'}));
registerSimReader('workflowAssignableAccounts',async ctx=>{
  if(ctx.actor.role!=='SYSTEM_ADMIN')throw new SimError('FORBIDDEN','업무 역할 배정 대상은 시스템 관리자만 조회할 수 있습니다.');
  const known=Object.keys(M.personas).map(id=>`usr-${id}`);
  return {items:known.filter(id=>state(ctx,id)==='ACTIVE').map(id=>({id,state:'ACTIVE'}))};
});
registerSimReader('workflowRoleGrants',ctx=>({items:grants(ctx)}));
registerSimReader('workflowCases',ctx=>({items:ctx.list<WorkflowCase>(CASE).filter(c=>canRead(ctx,c)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(({artifacts,activities,handoffs,...c})=>({...c,artifactCount:artifacts.length,submitted:Object.values(activities).filter(a=>a.status==='SUBMITTED').length,accepted:Object.values(activities).filter(a=>a.status==='ACCEPTED').length,handoffs:handoffs.filter(h=>h.status==='OFFERED').length}))}));
registerSimReader('workflowCase',ctx=>detail(ctx,ctx.req.params.id));
registerSimReader('workflowCaseSources',async ctx=>{
  const item=detail(ctx,ctx.req.params.id).item;
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
registerSimHandler('createWorkflowArtifact',async ctx=>{const b=WorkflowArtifactBody.parse(ctx.req.body);const files:WorkflowStoredFile[]=await Promise.all(b.files.map(async f=>{if(/[\x00-\x1f\x7f/\\]/.test(f.name)||!/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(f.mediaType))ctx.fail('VALIDATION','첨부 이름·유형을 확인하세요.');let decoded:string;try{decoded=atob(f.base64);}catch{ctx.fail('VALIDATION','첨부 형식을 확인하세요.');}if(!decoded!.length||decoded!.length>256*1024||btoa(decoded!)!==f.base64)ctx.fail('VALIDATION','첨부는 정상 형식의 256KiB 이하 파일이어야 합니다.');const bytes=Uint8Array.from(decoded!,v=>v.charCodeAt(0)),digest=await crypto.subtle.digest('SHA-256',bytes);return {...f,bytes:bytes.length,sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')};}));return change(ctx,'WORKFLOW_ARTIFACT_CREATE',{activityId:b.activityId,productKey:b.productKey},(item,who)=>addWorkflowArtifact(M,item,b,who,{artifactId:ctx.nextId('WPA',item.artifacts.map(v=>v.artifactId)),files}));},{body:WorkflowArtifactBody});
registerSimHandler('submitWorkflowActivity',ctx=>change(ctx,'WORKFLOW_ACTIVITY_SUBMIT',{activityId:ctx.req.params.activityId},(item,who)=>submitWorkflowActivity(M,item,ctx.req.params.activityId,WorkflowActivitySubmitBody.parse(ctx.req.body),who)),{body:WorkflowActivitySubmitBody});
registerSimHandler('reviewWorkflowActivity',ctx=>change(ctx,'WORKFLOW_ACTIVITY_REVIEW',{activityId:ctx.req.params.activityId,decision:ctx.req.body.decision},(item,who)=>reviewWorkflowActivity(M,item,ctx.req.params.activityId,WorkflowActivityReviewBody.parse(ctx.req.body),who)),{body:WorkflowActivityReviewBody});
registerSimHandler('offerWorkflowHandoff',async ctx=>{
  const b=WorkflowHandoffBody.parse(ctx.req.body),{version:_v,...payload}=b;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
  const payloadHash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  return change(ctx,'WORKFLOW_HANDOFF_OFFER',{fromActivityId:b.fromActivityId,toActivityId:b.toActivityId},(item,who)=>offerWorkflowHandoff(M,item,b,who,{handoffId:ctx.nextId('WFH',item.handoffs.map(h=>h.handoffId)),payloadHash}));
},{body:WorkflowHandoffBody});
registerSimHandler('receiveWorkflowHandoff',ctx=>change(ctx,'WORKFLOW_HANDOFF_RECEIVE',{handoffId:ctx.req.params.handoffId,decision:ctx.req.body.decision},(item,who)=>receiveWorkflowHandoff(M,item,ctx.req.params.handoffId,WorkflowHandoffReceiveBody.parse(ctx.req.body),who)),{body:WorkflowHandoffReceiveBody});
