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

const COMPONENT = 'D04-04';
const hash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
interface GrantRow { id:number; account_id:string; role_id:string; active:number; by_actor:string; at:string; reason:string }
interface CaseRow { case_id:string; process_id:string; version:number; doc:string }

@Injectable()
export class WorkflowExecutionService {
  constructor(@Inject(DB) private readonly db:Db,private readonly accounts:AccountDirectory,private readonly clock:Clock,private readonly audit:AuditService,private readonly events:EventService) {}
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
  private canRead(actor:Actor,item:WorkflowCase) {
    if (actor.role === 'SYSTEM_ADMIN') return true;
    const roles = this.roleIds(actor);
    const acts = MODEL.processes.find((p) => p.id === item.processId)!.activities;
    const relevant = [...acts,...item.handoffs.map((h) => executionActivity(MODEL,h.toActivityId))];
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
    return {item,model:MODEL.processes.find((p) => p.id === item.processId)!,roleIds:this.roleIds(actor),history};
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
    return this.change(actor,id,'WORKFLOW_ARTIFACT_CREATE',{activityId:body.activityId,productKey:body.productKey},(item,who) => addWorkflowArtifact(MODEL,item,body,who,{artifactId:`WPA-${randomUUID()}`,files}));
  }
  submit(actor:Actor,id:string,activityId:string,body:WorkflowActivitySubmitBody) { return this.change(actor,id,'WORKFLOW_ACTIVITY_SUBMIT',{activityId},(item,who)=>submitWorkflowActivity(MODEL,item,activityId,body,who)); }
  review(actor:Actor,id:string,activityId:string,body:WorkflowActivityReviewBody) { return this.change(actor,id,'WORKFLOW_ACTIVITY_REVIEW',{activityId,decision:body.decision},(item,who)=>reviewWorkflowActivity(MODEL,item,activityId,body,who)); }
  offer(actor:Actor,id:string,body:WorkflowHandoffBody) {
    const {version:_v,...payload}=body;
    return this.change(actor,id,'WORKFLOW_HANDOFF_OFFER',{fromActivityId:body.fromActivityId,toActivityId:body.toActivityId},(item,who)=>offerWorkflowHandoff(MODEL,item,body,who,{handoffId:`WFH-${randomUUID()}`,payloadHash:hash(JSON.stringify(payload))}));
  }
  receive(actor:Actor,id:string,handoffId:string,body:WorkflowHandoffReceiveBody) { return this.change(actor,id,'WORKFLOW_HANDOFF_RECEIVE',{handoffId,decision:body.decision},(item,who)=>receiveWorkflowHandoff(MODEL,item,handoffId,body,who)); }
}
