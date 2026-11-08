import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { addWorkflowArtifact, executionActivity, offerWorkflowHandoff, receiveWorkflowHandoff, reviewWorkflowActivity, submitWorkflowActivity, WorkflowExecutionError, type CreateWorkflowCaseBody, type WorkflowActivityReviewBody, type WorkflowActivitySubmitBody, type WorkflowArtifactBody, type WorkflowCase, type WorkflowCaseDetail, type WorkflowCaseHistory, type WorkflowCommandActor, type WorkflowHandoffBody, type WorkflowHandoffReceiveBody, type WorkflowRoleGrant, type WorkflowRoleGrantBody, type WorkflowStoredFile } from '@ff/contracts';
import { WORKFLOW_EXECUTION_MODEL as MODEL } from '../generated/workflow-execution-model';
import { AccountDirectory } from '../kernel/account-directory';
import { type Actor } from '../kernel/actor';
import { AuditService } from '../kernel/audit.service';
import { authModeOf } from '../kernel/auth/auth-config';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { DomainError } from '../kernel/errors';
import { EventService } from '../kernel/event.service';
import { workflowSources } from './workflow-source';
import { BinaryStore } from '../kernel/binary-store';
import { canonicalJson, handlesActivity, workflowTransferProducts, offerCrossCaseWorkflow, receiveCrossCaseWorkflow, type WorkflowCrossCaseOfferBody, type WorkflowCrossCaseReceiveBody, type WorkflowTransferTarget } from '@ff/contracts';

const COMPONENT = 'D04-04';
const hash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
interface GrantRow { id:number; account_id:string; role_id:string; active:number; by_actor:string; at:string; reason:string }
interface CaseRow { case_id:string; process_id:string; version:number; doc:string }

@Injectable()
export class WorkflowExecutionService {
  constructor(@Inject(DB) private readonly db:Db,private readonly accounts:AccountDirectory,private readonly clock:Clock,private readonly audit:AuditService,private readonly events:EventService,private readonly binary:BinaryStore) {}
  private active(actor:Actor) {
    if (this.accounts.state(actor.id) !== 'ACTIVE') {
      this.audit.denied(actor,'WORKFLOW_EXECUTE',actor.id,'활성 계정으로 확인되지 않음',COMPONENT);
      throw new DomainError('FORBIDDEN','사용 중인 실제 계정으로 확인된 담당자만 업무를 처리할 수 있습니다.');
    }
  }
  grants(actor:Actor): WorkflowRoleGrant[] {
    this.active(actor);
    const rows = this.db.all<GrantRow>('SELECT * FROM workflow_role_grant ORDER BY id');
    const latest = new Map<string,GrantRow>();
    for (const row of rows) latest.set(`${row.account_id}|${row.role_id}`,row);
    return [...latest.values()].filter((r) => actor.role === 'SYSTEM_ADMIN' || r.account_id === actor.id).map((r) => ({id:r.id,accountId:r.account_id,roleId:r.role_id,active:!!r.active,by:r.by_actor,at:r.at,reason:r.reason}));
  }
  roleIds(actor:Actor): string[] {
    if (this.accounts.state(actor.id) !== 'ACTIVE') return [];
    const permissions = actor.roles?.length ? actor.roles : [actor.role];
    const native = authModeOf() === 'demo' && actor.id.startsWith('usr-') ? MODEL.personas[actor.id.slice(4)] ?? [] : MODEL.roles.filter((r) => r.platformRoles.some((p) => permissions.includes(p as never))).map((r) => r.id);
    return [...new Set([...native,...this.grants(actor).filter((g) => g.active && g.accountId === actor.id).map((g) => g.roleId)])];
  }
  identity(actor:Actor) { const accountState=this.accounts.state(actor.id);return {accountId:actor.id,accountState,roleIds:this.roleIds(actor),roles:MODEL.roles,canAssign:accountState==='ACTIVE'&&actor.role === 'SYSTEM_ADMIN'}; }
  assignableAccounts(actor:Actor) {
    this.active(actor);
    if(actor.role!=='SYSTEM_ADMIN')throw new DomainError('FORBIDDEN','업무 역할 배정 대상은 시스템 관리자만 조회할 수 있습니다.');
    // OIDC accounts are confirmed by actual authenticated sessions, never caller-supplied names or departments.
    const seen=authModeOf()==='oidc'?this.db.all<{sub:string}>('SELECT DISTINCT sub FROM auth_session').map(r=>r.sub):[];
    const ids=[...new Set([...this.accounts.list().map(a=>a.id),...seen])];
    return {items:ids.map(id=>({id,state:this.accounts.state(id)})).filter(a=>a.state==='ACTIVE')};
  }
  setGrant(actor:Actor,body:WorkflowRoleGrantBody) {
    this.active(actor);
    if (actor.role !== 'SYSTEM_ADMIN') throw new DomainError('FORBIDDEN','업무 역할 배정은 시스템 관리자만 할 수 있습니다.');
    if (!MODEL.roles.some((r) => r.id === body.roleId)) {
      this.audit.failed(actor,'WORKFLOW_ROLE_GRANT',body.accountId,'업무 모델에 없는 역할',COMPONENT);
      throw new DomainError('VALIDATION','업무 모델에 없는 역할입니다.');
    }
    if (body.active && this.accounts.state(body.accountId) !== 'ACTIVE') {
      this.audit.failed(actor,'WORKFLOW_ROLE_GRANT',body.accountId,'활성 실계정 미확인',COMPONENT);
      throw new DomainError('GUARD_FAILED','사용 중인 계정으로 확인된 대상에게만 역할을 배정하세요.');
    }
    const at = this.clock.iso();
    this.db.tx(() => {
      this.db.run('INSERT INTO workflow_role_grant(account_id,role_id,active,by_actor,at,reason) VALUES(?,?,?,?,?,?)',body.accountId,body.roleId,body.active?1:0,actor.id,at,body.reason);
      this.audit.record(actor,'WORKFLOW_ROLE_GRANT',body.accountId,{after:{roleId:body.roleId,active:body.active},reason:body.reason,componentId:COMPONENT});
      this.events.publish('workflow.role.changed',body.accountId,{accountId:body.accountId,roleId:body.roleId,active:body.active},{componentId:COMPONENT,correlationId:actor.correlationId});
    });
    return this.grants(actor);
  }
  private item(id:string): WorkflowCase {
    const row = this.db.get<CaseRow>('SELECT * FROM workflow_case WHERE case_id=?',id);
    if (!row) throw new DomainError('NOT_FOUND','업무 건을 찾을 수 없습니다.');
    return JSON.parse(row.doc) as WorkflowCase;
  }
  private activity(id:string) {try{return executionActivity(MODEL,id);}catch(e){if(e instanceof WorkflowExecutionError)throw new DomainError(e.code,e.message,e.details);throw e;}}
  private canRead(actor:Actor,item:WorkflowCase) {
    if (actor.role === 'SYSTEM_ADMIN') return true;
    const roles = this.roleIds(actor);
    const acts = MODEL.processes.find((p) => p.id === item.processId)!.activities;
    const relevant = [...acts,...item.handoffs.filter(h=>!h.toCaseId).map((h) => executionActivity(MODEL,h.toActivityId))];
    return item.createdBy === actor.id || relevant.some((a) => [...a.raci.R,a.raci.A,...a.raci.C,...a.raci.I].some((r) => roles.includes(r)));
  }
  list(actor:Actor) {
    this.active(actor);
    const items = this.db.all<CaseRow>('SELECT * FROM workflow_case ORDER BY updated_at DESC,case_id').map((r) => JSON.parse(r.doc) as WorkflowCase).filter((c) => this.canRead(actor,c));
    return {items:items.map(({artifacts,activities,handoffs,...c}) => ({...c,artifactCount:artifacts.length,submitted:Object.values(activities).filter((a) => a.status === 'SUBMITTED').length,accepted:Object.values(activities).filter((a) => a.status === 'ACCEPTED').length,handoffs:handoffs.filter((h) => h.status === 'OFFERED').length}))};
  }
  detail(actor:Actor,id:string): WorkflowCaseDetail {
    this.active(actor);
    const item = this.item(id);
    if (!this.canRead(actor,item)) throw new DomainError('FORBIDDEN','이 업무 건의 담당·검토·협의 역할이 아닙니다.');
    const history = this.db.all<{id:number;case_id:string;version:number;action:string;by_actor:string;at:string;detail:string}>('SELECT * FROM workflow_case_history WHERE case_id=? ORDER BY id',id).map((r):WorkflowCaseHistory => ({id:r.id,caseId:r.case_id,version:r.version,action:r.action,by:r.by_actor,at:r.at,detail:JSON.parse(r.detail)}));
    const transferVersions:Record<string,number>={};
    for(const h of item.handoffs) for(const key of [h.fromCaseId,h.toCaseId]) if(key) { const row=this.db.get<{version:number}>('SELECT version FROM workflow_case WHERE case_id=?',key); if(row)transferVersions[key]=row.version; }
    return {item,model:MODEL.processes.find((p) => p.id === item.processId)!,roleIds:this.roleIds(actor),history,transferVersions};
  }
  create(actor:Actor,body:CreateWorkflowCaseBody) {
    this.active(actor);
    const process = MODEL.processes.find((p) => p.id === body.processId);
    if (!process) {
      this.audit.failed(actor,'WORKFLOW_CASE_CREATE',body.targetRef,'업무 모델에 없는 절차',COMPONENT);
      throw new DomainError('VALIDATION','업무 모델에 없는 절차입니다.');
    }
    const roles = this.roleIds(actor);
    if (!process.activities.some((a) => [...a.raci.R,a.raci.A].some((r) => roles.includes(r)))) {
      this.audit.denied(actor,'WORKFLOW_CASE_CREATE',body.targetRef,'절차 수행·책임 역할 미배정',COMPONENT);
      throw new DomainError('FORBIDDEN','이 절차를 수행·책임지는 역할로 배정되지 않았습니다.');
    }
    const at=this.clock.iso(), caseId=`WFC-${randomUUID()}`;
    const item:WorkflowCase={caseId,processId:body.processId,title:body.title,targetRef:body.targetRef,version:1,createdBy:actor.id,createdAt:at,updatedAt:at,activities:{},artifacts:[],handoffs:[]};
    this.db.tx(() => {
      this.db.run('INSERT INTO workflow_case(case_id,process_id,version,created_by,updated_at,doc) VALUES(?,?,?,?,?,?)',caseId,item.processId,1,actor.id,at,JSON.stringify(item));
      this.record(actor,item,'WORKFLOW_CASE_CREATE',{targetRef:item.targetRef});
    });
    return this.detail(actor,caseId);
  }
  sources(actor:Actor,id:string) {
    this.active(actor);
    const item=this.detail(actor,id).item;
    return workflowSources(this.db,item.targetRef,this.clock.iso());
  }
  private record(actor:Actor,item:WorkflowCase,action:string,detail:Record<string,unknown>) {
    this.db.run('INSERT INTO workflow_case_history(case_id,version,action,by_actor,at,detail) VALUES(?,?,?,?,?,?)',item.caseId,item.version,action,actor.id,this.clock.iso(),JSON.stringify(detail));
    this.audit.record(actor,action,item.caseId,{after:{version:item.version,...detail},componentId:COMPONENT});
    this.events.publish('workflow.case.changed',item.caseId,{caseId:item.caseId,action,version:item.version,...detail},{componentId:COMPONENT,correlationId:actor.correlationId});
  }
  private change(actor:Actor,id:string,action:string,detail:Record<string,unknown>,fn:(item:WorkflowCase,who:WorkflowCommandActor)=>WorkflowCase) {
    this.active(actor);
    try { this.db.tx(() => {
      const old=this.item(id);
      if (!this.canRead(actor,old)) throw new DomainError('FORBIDDEN','이 업무 건에 접근할 담당 역할이 아닙니다.');
      let next:WorkflowCase;
      try { next=fn(old,{id:actor.id,roleIds:this.roleIds(actor),at:this.clock.iso()}); }
      catch(e) { if (e instanceof WorkflowExecutionError) throw new DomainError(e.code,e.message,e.details); throw e; }
      if (next === old) return;
      const doc=JSON.stringify(next);
      if (Buffer.byteLength(doc)>5*1024*1024) throw new DomainError('GUARD_FAILED','업무 건 첨부·이력이 5MiB를 넘습니다. 새 업무 건으로 분리하세요.');
      const changed=this.db.run('UPDATE workflow_case SET doc=?,version=?,updated_at=? WHERE case_id=? AND version=?',doc,next.version,next.updatedAt,id,old.version);
      if (changed.changes !== 1) throw new DomainError('PRECONDITION_FAILED','동시에 변경된 업무 건입니다. 최신 기록을 다시 불러오세요.');
      this.record(actor,next,action,detail);
    }); } catch (error) {
      // Failed domain changes roll back first; their audit record must survive independently.
      if (error instanceof DomainError) {
        if (error.code === 'FORBIDDEN') this.audit.denied(actor,action,id,error.message,COMPONENT);
        else this.audit.failed(actor,action,id,error.message,COMPONENT);
      } else this.audit.failed(actor,action,id,'업무 변경을 저장하지 못했습니다.',COMPONENT);
      throw error;
    }
    return this.detail(actor,id);
  }
  artifact(actor:Actor,id:string,body:WorkflowArtifactBody) {
    const files:WorkflowStoredFile[]=body.files.map((f) => {
      if (/[\x00-\x1f\x7f/\\]/.test(f.name) || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(f.mediaType)) throw new DomainError('VALIDATION','첨부 이름·유형을 확인하세요.');
      const data=Buffer.from(f.base64,'base64');
      if (!data.length || data.length>256*1024 || data.toString('base64')!==f.base64) throw new DomainError('VALIDATION','첨부는 정상 형식의 256KiB 이하 파일이어야 합니다.');
      return {...f,sha256:hash(data),bytes:data.length};
    });
    return this.change(actor,id,'WORKFLOW_ARTIFACT_CREATE',{activityId:body.activityId,productKey:body.productKey},(item,who) => {
      if(body.fileIds?.length)this.fileWritable(actor,id,body.activityId,body.version);
      const uploaded=(body.fileIds??[]).map(fileId=>{const f=this.binary.attach(fileId,`workflow:${id}:${body.activityId}`,actor.id);return {fileId:f.file_id,name:f.name,mediaType:f.media_type,base64:'',sha256:f.sha256,bytes:f.bytes,uploadedBy:f.owner_id};});
      if(new Set(body.fileIds??[]).size!==(body.fileIds??[]).length)throw new DomainError('VALIDATION','동일 첨부를 중복 연결할 수 없습니다.');
      return addWorkflowArtifact(MODEL,item,body,who,{artifactId:`WPA-${randomUUID()}`,files:[...files,...uploaded]});
    });
  }
  private fileWritable(actor:Actor,id:string,activityId:string,expected:number) {
    this.active(actor);const item=this.item(id),a=this.activity(activityId);
    if(!Number.isSafeInteger(expected)||expected!==item.version)throw new DomainError('PRECONDITION_FAILED','업무 건 최신 버전을 확인하고 파일을 다시 올리세요.');
    if(a.processId!==item.processId||!handlesActivity({roleIds:this.roleIds(actor)},a))throw new DomainError('FORBIDDEN','이 활동의 수행·책임 역할만 파일을 올릴 수 있습니다.');
    if(['SUBMITTED','ACCEPTED'].includes(item.activities[activityId]?.status))throw new DomainError('CONFLICT','검토 중·수락된 활동에는 파일을 올릴 수 없습니다.');
  }
  uploadFile(actor:Actor,id:string,activityId:string,expected:number,meta:{name:string;mediaType:string;requestKey:string},input:AsyncIterable<Uint8Array>) {
    return this.binary.upload(input,{...meta,scope:`workflow:${id}:${activityId}`,ownerId:actor.id},()=>this.fileWritable(actor,id,activityId,expected),(f,replay)=>{
      if(replay)return;
      this.audit.record(actor,'WORKFLOW_FILE_UPLOAD',id,{after:{activityId,fileId:f.file_id,bytes:f.bytes,sha256:f.sha256},componentId:COMPONENT});
      this.events.publish('workflow.file.uploaded',id,{caseId:id,activityId,fileId:f.file_id,bytes:f.bytes},{componentId:COMPONENT,correlationId:actor.correlationId});
    }).then(f=>({fileId:f.file_id,name:f.name,mediaType:f.media_type,base64:'',bytes:f.bytes,sha256:f.sha256,uploadedBy:f.owner_id}));
  }
  downloadFile(actor:Actor,id:string,fileId:string) {
    this.active(actor);const item=this.item(id),roles=this.roleIds(actor);
    const can=(activityId:string)=>{const a=executionActivity(MODEL,activityId);return [...a.raci.R,a.raci.A,...a.raci.C].some(r=>roles.includes(r));};
    const direct=item.artifacts.some(a=>a.files.some(f=>f.fileId===fileId)&&can(a.activityId));
    const incoming=item.handoffs.some(h=>h.toCaseId===id&&h.status!=='RETURNED'&&can(h.toActivityId)&&h.artifacts?.some(a=>a.files.some(f=>f.fileId===fileId)));
    if(!direct&&!incoming)throw new DomainError('FORBIDDEN','이 활동 또는 수신 인계의 첨부 조회 역할이 아닙니다.');
    return this.binary.download(fileId);
  }
  submit(actor:Actor,id:string,activityId:string,body:WorkflowActivitySubmitBody) { return this.change(actor,id,'WORKFLOW_ACTIVITY_SUBMIT',{activityId},(item,who)=>submitWorkflowActivity(MODEL,item,activityId,body,who)); }
  review(actor:Actor,id:string,activityId:string,body:WorkflowActivityReviewBody) { return this.change(actor,id,'WORKFLOW_ACTIVITY_REVIEW',{activityId,decision:body.decision},(item,who)=>reviewWorkflowActivity(MODEL,item,activityId,body,who)); }
  offer(actor:Actor,id:string,body:WorkflowHandoffBody) {
    const {version:_v,...payload}=body;
    return this.change(actor,id,'WORKFLOW_HANDOFF_OFFER',{fromActivityId:body.fromActivityId,toActivityId:body.toActivityId},(item,who)=>offerWorkflowHandoff(MODEL,item,body,who,{handoffId:`WFH-${randomUUID()}`,payloadHash:hash(JSON.stringify(payload))}));
  }
  receive(actor:Actor,id:string,handoffId:string,body:WorkflowHandoffReceiveBody) { return this.change(actor,id,'WORKFLOW_HANDOFF_RECEIVE',{handoffId,decision:body.decision},(item,who)=>receiveWorkflowHandoff(MODEL,item,handoffId,body,who)); }
  transferTargets(actor:Actor,id:string,fromActivityId:string) {
    const source=this.detail(actor,id).item,a=this.activity(fromActivityId),who={roleIds:this.roleIds(actor)};
    if(a.processId!==source.processId||!handlesActivity(who,a))throw new DomainError('FORBIDDEN','발신 활동의 수행·책임 역할이 아닙니다.');
    const items:WorkflowTransferTarget[]=this.db.all<CaseRow>('SELECT * FROM workflow_case WHERE case_id<>?',id).map(r=>JSON.parse(r.doc) as WorkflowCase).filter(t=>t.targetRef===source.targetRef).map(t=>({caseId:t.caseId,title:t.title,processId:t.processId,version:t.version,activities:MODEL.processes.find(p=>p.id===t.processId)!.activities.map(b=>({id:b.id,productKeys:workflowTransferProducts(MODEL,a.id,b.id)})).filter(b=>b.productKeys.length>0)})).filter(t=>t.activities.length>0);
    // Discovery exposes only routing metadata, never the recipient's artifacts/history or roles.
    return {items};
  }
  private transfer(actor:Actor,id:string,otherId:string,action:string,fn:(source:WorkflowCase,target:WorkflowCase,who:WorkflowCommandActor)=>[WorkflowCase,WorkflowCase],receive=false) {
    this.active(actor);
    try {this.db.tx(()=>{
      const current=this.item(id),other=this.item(otherId);
      if(!this.canRead(actor,current))throw new DomainError('FORBIDDEN','이 업무 건의 담당 역할이 아닙니다.');
      const who={id:actor.id,roleIds:this.roleIds(actor),at:this.clock.iso()};
      let pair:[WorkflowCase,WorkflowCase];
      try {pair=receive?fn(other,current,who):fn(current,other,who);}catch(e){if(e instanceof WorkflowExecutionError)throw new DomainError(e.code,e.message,e.details);throw e;}
      const originals=receive?[other,current]:[current,other];
      pair.forEach((next,i)=>{
        const old=originals[i];if(next===old)return;
        const doc=JSON.stringify(next);
        if(Buffer.byteLength(doc)>5*1024*1024)throw new DomainError('GUARD_FAILED','인계 기록을 포함한 업무 건이 5MiB를 넘습니다.');
        if(this.db.run('UPDATE workflow_case SET doc=?,version=?,updated_at=? WHERE case_id=? AND version=?',doc,next.version,next.updatedAt,next.caseId,old.version).changes!==1)throw new DomainError('PRECONDITION_FAILED','동시에 변경된 업무 건입니다.');
        this.record(actor,next,action,{otherCaseId:originals[1-i].caseId});
      });
    });}catch(e){if(e instanceof DomainError&&e.code==='FORBIDDEN')this.audit.denied(actor,action,id,e.message,COMPONENT);else this.audit.failed(actor,action,id,e instanceof Error?e.message:'인계 저장 실패',COMPONENT);throw e;}
    return this.detail(actor,id);
  }
  offerCrossCase(actor:Actor,id:string,body:WorkflowCrossCaseOfferBody) {
    const {version:_v,targetVersion:_t,...payload}=body;
    return this.transfer(actor,id,body.toCaseId,'WORKFLOW_CROSS_CASE_OFFER',(source,target,who)=>{
      const accepted=source.activities[body.fromActivityId],keys=workflowTransferProducts(MODEL,body.fromActivityId,body.toActivityId);
      const artifacts=source.artifacts.filter(a=>accepted?.artifactIds.includes(a.artifactId)&&keys.includes(a.productKey));
      return offerCrossCaseWorkflow(MODEL,source,target,body,who,{handoffId:`WFH-${randomUUID()}`,payloadHash:hash(canonicalJson(payload)),artifactsHash:hash(canonicalJson(artifacts))});
    });
  }
  receiveCrossCase(actor:Actor,id:string,handoffId:string,body:WorkflowCrossCaseReceiveBody) {
    const item=this.detail(actor,id).item,h=item.handoffs.find(h=>h.handoffId===handoffId);
    if(!h?.fromCaseId||h.toCaseId!==id)throw new DomainError('NOT_FOUND','수신 업무 건의 인계가 없습니다.');
    return this.transfer(actor,id,h.fromCaseId,'WORKFLOW_CROSS_CASE_RECEIVE',(source,target,who)=>receiveCrossCaseWorkflow(MODEL,source,target,handoffId,body,who),true);
  }
}
