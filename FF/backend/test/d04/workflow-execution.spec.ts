import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WORKFLOW_EXECUTION_MODEL as M } from '../../src/generated/workflow-execution-model';
import { DB, type Db } from '../../src/kernel/db';
import { canonicalJson } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { WorkflowExecutionService } from '../../src/workflows/workflow-execution.service';
import { EventService } from '../../src/kernel/event.service';
import { actor, bootApp } from '../helpers';

const SYS=actor('usr-sysadmin','SYSTEM_ADMIN'), AUTHOR=actor('usr-commerce','PRODUCT_AUTHOR'), REVIEWER=actor('usr-integrator','IMPLEMENTER'), OPS=actor('usr-operator','OPERATOR');
const A='FPW.18-A01',NEXT='FPW.18-A02',WP='WP-ANALYSIS-SCOPE';
describe('업무 건·산출물·독립 검토·인계',()=>{
  let app:INestApplication,http:()=>any,db:Db;
  beforeAll(async()=>{({app,http}=await bootApp({at:'2026-11-08T00:00:00.000Z',showcaseFill:false}));db=app.get(DB);});
  afterAll(()=>app.close());
  const create=async()=> (await http().post('/api/workflow/cases').set(AUTHOR).send({processId:'FPW.18',title:'운영 개선 분석',targetRef:'FEAT-00022@1.0.0'}).expect(201)).body;
  const grant=(active:boolean,accountId='usr-integrator')=>http().post('/api/workflow/roles').set(SYS).send({accountId,roleId:'R-DPO',active,reason:'업무 분리 검토 담당 배정'});
  const fields=()=>Object.fromEntries(M.processes.find(p=>p.id==='FPW.18')!.products.find(w=>w.key===WP)!.content.map((_,i)=>[String(i),`검토 내용 ${i}`]));
  const artifact=(id:string,version:number,references:string[]=[])=>http().post(`/api/workflow/cases/${id}/artifacts`).set(AUTHOR).send({version,activityId:A,productKey:WP,fields:fields(),references,files:[],reason:'분석 범위 작성'});
  it('127활동·125산출물의 실제 필수 내용과 RACI를 실행 모델에 보존한다',()=>{
    expect(M.processes.flatMap(p=>p.activities)).toHaveLength(127);
    expect(new Set(M.processes.flatMap(p=>p.products.map(w=>w.key))).size).toBe(125);
    expect(M.processes.every(p=>p.activities.every(a=>a.outputs.every(key=>M.processes.some(v=>v.products.some(w=>w.key===key)))))).toBe(true);
  });
  it('원천은 실제 DB 레코드와 해시만 조회하고 주소·알 수 없는 대상은 미확보로 남긴다',async()=>{
    const d=await create(),id=d.item.caseId;
    const source=(await http().get(`/api/workflow/cases/${id}/sources`).set(AUTHOR).expect(200)).body;
    expect(source.status).toBe('RESOLVED');
    const feature=source.items.find((s:any)=>s.kind==='FEATURE');
    expect(feature.id).toBe('FEAT-00022');expect(feature.revision).toBe('1.0.0');
    expect(feature.recordHash).toBe(createHash('sha256').update(canonicalJson(feature.record)).digest('hex'));
    expect(feature.verification).toBe('RECORD_OBSERVED');
    expect(source.unavailable).not.toContain('FEATURE');
    const external=(await http().post('/api/workflow/cases').set(AUTHOR).send({processId:'FPW.18',title:'외부 분석',targetRef:'https://example.com/report.pdf'}).expect(201)).body;
    expect((await http().get(`/api/workflow/cases/${external.item.caseId}/sources`).set(AUTHOR).expect(200)).body).toMatchObject({status:'DECLARED',items:[]});
    expect((await http().get(`/api/workflow/cases/${id}`).set(AUTHOR).expect(200)).body.item.version).toBe(1);
  });
  it('업무 대상별 상태가 독립이며 미배정·미확인·비활성 계정은 처리하지 못한다',async()=>{
    const first=await create(),second=await create();
    expect(first.item.caseId).not.toBe(second.item.caseId);
    await http().post('/api/workflow/cases').set(REVIEWER).send({processId:'FPW.18',title:'권한 없는 분석',targetRef:'OTHER'}).expect(403);
    expect(db.get<{n:number}>("SELECT COUNT(*) AS n FROM audit WHERE actor_id='usr-integrator' AND action='WORKFLOW_CASE_CREATE' AND result='DENIED'")!.n).toBeGreaterThan(0);
    await grant(true,'unknown-actor').expect(422);
    await http().post('/api/workflow/cases').set(actor('unknown-actor','PRODUCT_AUTHOR')).send({processId:'FPW.18',title:'없는 계정',targetRef:'OTHER'}).expect(403);
    await http().post('/api/accounts/usr-integrator/deactivate').set(SYS).send({reason:'퇴사 처리 시험'}).expect(201);
    await grant(true).expect(422);
    await http().get('/api/workflow/cases').set(REVIEWER).expect(403);
    await http().get('/api/workflow/roles').set(REVIEWER).expect(403);
    await http().get('/api/workflow/cases').set(actor('unknown-actor','AUDITOR')).expect(403);
    await http().post('/api/accounts/usr-integrator/reactivate').set(SYS).send({reason:'재활성 처리 시험'}).expect(201);
    await grant(true).expect(201);
    await grant(false).expect(201);
    expect((await http().get('/api/workflow/identity').set(REVIEWER).expect(200)).body.roleIds).not.toContain('R-DPO');
  });
  it('내용만 있고 근거·첨부가 없으면 제출을 막고, 동시 버전 변경은412로 보존한다',async()=>{
    const d=await create(),id=d.item.caseId;
    await http().post(`/api/workflow/cases/${id}/activities/${A}/submit`).set(AUTHOR).send({version:1,note:'검토 요청'}).expect(422);
    await artifact(id,1).expect(201);
    await artifact(id,1,['DOC-01']).expect(412);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/submit`).set(AUTHOR).send({version:2,note:'검토 요청'}).expect(422);
    const fixed=(await artifact(id,2,['DOC-ANALYSIS-01']).expect(201)).body;
    expect(fixed.item.artifacts).toHaveLength(2);
    expect(fixed.item.artifacts[0].references).toEqual([]);
  });
  it('서로 다른 실제 담당자가 같은 버전에 동시에 저장하면 한 건만 보존하고 다른 요청은412다',async()=>{
    const d=await create(),id=d.item.caseId,second=actor('usr-productowner','PRODUCT_APPROVER');
    const body={version:1,activityId:A,productKey:WP,fields:fields(),references:['DOC-CONCURRENT-B'],files:[],reason:'두 번째 담당자 작성'};
    await http().post('/api/workflow/roles').set(SYS).send({accountId:'usr-productowner',roleId:'R-PDA',active:true,reason:'같은 분석 업무 공동 담당'}).expect(201);
    const results=await Promise.all([artifact(id,1,['DOC-CONCURRENT-A']),http().post(`/api/workflow/cases/${id}/artifacts`).set(second).send(body)]);
    expect(results.map(r=>r.status).sort()).toEqual([201,412]);
    const saved=(await http().get(`/api/workflow/cases/${id}`).set(AUTHOR).expect(200)).body;
    expect(saved.item).toMatchObject({version:2});expect(saved.item.artifacts).toHaveLength(1);
    expect(saved.history.filter((h:any)=>h.action==='WORKFLOW_ARTIFACT_CREATE')).toHaveLength(1);
    await http().post('/api/workflow/roles').set(SYS).send({accountId:'usr-productowner',roleId:'R-PDA',active:false,reason:'공동 담당 시험 배정 철회'}).expect(201);
  });
  it('자기 결과의 독립 검토를 막고 명시 역할 철회 후 기존 건의 쓰기도 거부한다',async()=>{
    const d=await create(),id=d.item.caseId;await artifact(id,1,['DOC-02']).expect(201);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/submit`).set(AUTHOR).send({version:2,note:'검토 요청'}).expect(201);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/review`).set(AUTHOR).send({version:3,decision:'ACCEPT',reason:'스스로 승인'}).expect(403);
    await grant(true).expect(201);await grant(false).expect(201);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/review`).set(REVIEWER).send({version:3,decision:'ACCEPT',reason:'철회 후 시도'}).expect(403);
    await grant(true).expect(201);
    const accepted=(await http().post(`/api/workflow/cases/${id}/activities/${A}/review`).set(REVIEWER).send({version:3,decision:'ACCEPT',reason:'독립 검토 완료'}).expect(201)).body;
    expect(accepted.item.activities[A]).toMatchObject({status:'ACCEPTED',submittedBy:'usr-commerce',reviewedBy:'usr-integrator'});
    await artifact(id,4,['DOC-03']).expect(409);
  });
  it('인계 요청의 재시도는 멱등이고 다음 담당자만 인수·반송하며 감사 이력이 남는다',async()=>{
    const d=await create(),id=d.item.caseId;await artifact(id,1,['DOC-04']).expect(201);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/submit`).set(AUTHOR).send({version:2,note:'검토 요청'}).expect(201);
    await grant(true).expect(201);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/review`).set(REVIEWER).send({version:3,decision:'ACCEPT',reason:'독립 확인'}).expect(201);
    const body={version:4,requestKey:'handoff-retry-001',fromActivityId:A,toActivityId:NEXT,note:'운영 분석으로 인계'};
    const offered=(await http().post(`/api/workflow/cases/${id}/handoffs`).set(AUTHOR).send(body).expect(201)).body;
    const retried=(await http().post(`/api/workflow/cases/${id}/handoffs`).set(AUTHOR).send(body).expect(201)).body;
    expect(retried.item.handoffs).toEqual(offered.item.handoffs);expect(retried.history).toHaveLength(offered.history.length);
    await http().post(`/api/workflow/cases/${id}/handoffs`).set(AUTHOR).send({...body,note:'다른 본문 재사용'}).expect(409);
    const handoffId=offered.item.handoffs[0].handoffId;
    await http().post(`/api/workflow/cases/${id}/handoffs/${handoffId}/receive`).set(AUTHOR).send({version:5,decision:'ACCEPT',reason:'자기 인수'}).expect(403);
    const received=(await http().post(`/api/workflow/cases/${id}/handoffs/${handoffId}/receive`).set(OPS).send({version:5,decision:'ACCEPT',reason:'산출물 확인 후 인수'}).expect(201)).body;
    expect(received.item.handoffs[0]).toMatchObject({status:'ACCEPTED',receivedBy:'usr-operator'});
    expect(received.history.map((h:any)=>h.action)).toContain('WORKFLOW_HANDOFF_RECEIVE');
    expect(db.get<{n:number}>("SELECT COUNT(*) AS n FROM audit WHERE action='WORKFLOW_HANDOFF_RECEIVE'")!.n).toBeGreaterThan(0);
  });
  it('부정한 첨부·활동·산출물 이름을 거부하고 원천 Gate·정책 승인 기록을 만들지 않는다',async()=>{
    const d=await create(),id=d.item.caseId;
    const before=db.get<{n:number}>('SELECT COUNT(*) AS n FROM gate_record')?.n;
    await http().post(`/api/workflow/cases/${id}/artifacts`).set(AUTHOR).send({version:1,activityId:A,productKey:WP,fields:fields(),references:[],files:[{name:'../file',mediaType:'text/plain',base64:'YQ=='}],reason:'잘못된 첨부'}).expect(400);
    await http().post(`/api/workflow/cases/${id}/artifacts`).set(AUTHOR).send({version:1,activityId:A,productKey:'WP-NOPE',fields:{},references:['DOC-05'],files:[],reason:'잘못된 산출물'}).expect(400);
    expect((await http().get(`/api/workflow/cases/${id}`).set(AUTHOR).expect(200)).body.item.version).toBe(1);
    expect(db.get<{n:number}>('SELECT COUNT(*) AS n FROM gate_record')?.n).toBe(before);
  });
  it('다른 수행 역할의 앞 활동이 수락되어도 실제 인수 전에는 다음 활동의 제출이 막힌다',async()=>{
    const d=await create(),id=d.item.caseId;await artifact(id,1,['DOC-HANDOFF-REQUIRED']).expect(201);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/submit`).set(AUTHOR).send({version:2,note:'검토 요청'}).expect(201);await grant(true).expect(201);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/review`).set(REVIEWER).send({version:3,decision:'ACCEPT',reason:'독립 검토 확인'}).expect(201);
    const process=M.processes.find(p=>p.id==='FPW.18')!,wp=process.products.find(p=>p.key===process.activities.find(a=>a.id===NEXT)!.outputs[0])!;
    await http().post(`/api/workflow/cases/${id}/artifacts`).set(OPS).send({version:4,activityId:NEXT,productKey:wp.key,fields:Object.fromEntries(wp.content.map((_,i)=>[String(i),`운영 분석 ${i}`])),references:['DOC-OPS-RESULT'],files:[],reason:'다음 담당자 분석 초안'}).expect(201);
    const submit=(version:number)=>http().post(`/api/workflow/cases/${id}/activities/${NEXT}/submit`).set(OPS).send({version,note:'분석 독립 검토 요청'});
    expect((await submit(5).expect(422)).body.error.message).toContain('실제 인수');
    const offered=(await http().post(`/api/workflow/cases/${id}/handoffs`).set(AUTHOR).send({version:5,requestKey:'required-handoff-001',fromActivityId:A,toActivityId:NEXT,note:'운영 분석 담당 인계'}).expect(201)).body;
    await submit(6).expect(422);
    await http().post(`/api/workflow/cases/${id}/handoffs/${offered.item.handoffs[0].handoffId}/receive`).set(OPS).send({version:6,decision:'ACCEPT',reason:'내용과 범위 실제 인수'}).expect(201);
    expect((await submit(7).expect(201)).body.item.activities[NEXT].status).toBe('SUBMITTED');
  });
  it('인계 이벤트 저장 실패는 건·인계·성공 이력을 함께 롤백하고 같은 요청 재시도는 한 번만 저장한다',async()=>{
    const d=await create(),id=d.item.caseId;await artifact(id,1,['DOC-DELIVERY-RETRY']).expect(201);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/submit`).set(AUTHOR).send({version:2,note:'검토 요청'}).expect(201);await grant(true).expect(201);
    await http().post(`/api/workflow/cases/${id}/activities/${A}/review`).set(REVIEWER).send({version:3,decision:'ACCEPT',reason:'독립 검토 확인'}).expect(201);
    const body={version:4,requestKey:'handoff-outbox-failure',fromActivityId:A,toActivityId:NEXT,note:'다음 담당자에게 전달'};
    const events=app.get(EventService),publish=events.publish.bind(events);
    const spy=vi.spyOn(events,'publish').mockImplementation((...args)=>{if(args[0]==='workflow.case.changed'&&args[1]===id)throw new Error('test outbox persistence failure');return publish(...args);});
    try{await http().post(`/api/workflow/cases/${id}/handoffs`).set(AUTHOR).send(body).expect(500);}finally{spy.mockRestore();}
    const after=(await http().get(`/api/workflow/cases/${id}`).set(AUTHOR).expect(200)).body;
    expect(after.item).toMatchObject({version:4,handoffs:[]});
    expect(after.history.filter((h:any)=>h.action==='WORKFLOW_HANDOFF_OFFER')).toEqual([]);
    expect(db.get<{n:number}>("SELECT COUNT(*) AS n FROM audit WHERE target=? AND action='WORKFLOW_HANDOFF_OFFER' AND result='FAILED'",id)!.n).toBe(1);
    const retry=(await http().post(`/api/workflow/cases/${id}/handoffs`).set(AUTHOR).send(body).expect(201)).body;
    const again=(await http().post(`/api/workflow/cases/${id}/handoffs`).set(AUTHOR).send(body).expect(201)).body;
    expect(retry.item.handoffs).toHaveLength(1);expect(again.history).toEqual(retry.history);
  });
  it('OIDC 배정 대상은 실제 세션에서 확인한 활성 계정이며 부서나 임의 계정 이름은 권한을 만들지 않는다',()=>{
    const prior=process.env.FF_AUTH;
    try{
      process.env.FF_AUTH='oidc';
      for(const sub of ['oidc-workflow-admin','oidc-workflow-reviewer'])db.run('INSERT INTO auth_session(id_hash,sub,roles,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)',`session-${sub}`,sub,'["AUDITOR"]','2026-11-08T00:00:00.000Z','2026-11-09T00:00:00.000Z','2026-11-08T00:00:00.000Z');
      const service=app.get(WorkflowExecutionService),admin={id:'oidc-workflow-admin',role:'SYSTEM_ADMIN' as const,correlationId:'workflow-account-test'},reviewer={id:'oidc-workflow-reviewer',role:'AUDITOR' as const,correlationId:'workflow-account-test'};
      expect(service.assignableAccounts(admin).items.map(a=>a.id)).toContain(reviewer.id);
      expect(service.assignableAccounts(admin).items.map(a=>a.id)).not.toContain('caller-supplied-account');
      const original=service.roleIds(reviewer);
      expect(()=>service.setGrant(admin,{accountId:'caller-supplied-account',roleId:'R-DPO',active:true,reason:'없는 계정 시도'})).toThrow();
      service.setGrant(admin,{accountId:reviewer.id,roleId:'R-DPO',active:true,reason:'확인된 독립 검토 계정'});
      expect(service.roleIds(reviewer)).toContain('R-DPO');
      service.setGrant(admin,{accountId:reviewer.id,roleId:'R-DPO',active:false,reason:'업무 역할 철회'});
      expect(service.roleIds(reviewer)).toEqual(original);
    }finally{if(prior===undefined)delete process.env.FF_AUTH;else process.env.FF_AUTH=prior;}
  });
  it('실제 첨부 bytes의 해시를 보존하며 전역100kb보다 작은96KiB 도메인 상한으로 큰 저장을 거부한다',async()=>{
    const d=await create(),id=d.item.caseId,data=Buffer.from('실제 검토 근거 원문');
    const body={version:1,activityId:A,productKey:WP,fields:fields(),references:[],files:[{name:'review.txt',mediaType:'text/plain',base64:data.toString('base64')}],reason:'실제 파일 근거'};
    const saved=(await http().post(`/api/workflow/cases/${id}/artifacts`).set(AUTHOR).send(body).expect(201)).body;
    expect(saved.item.artifacts[0].files[0]).toMatchObject({sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length});
    const large={...body,version:2,files:[{name:'large.txt',mediaType:'text/plain',base64:Buffer.alloc(73*1024,97).toString('base64')}]};
    await http().post(`/api/workflow/cases/${id}/artifacts`).set(AUTHOR).send(large).expect(400);
    expect((await http().get(`/api/workflow/cases/${id}`).set(AUTHOR).expect(200)).body.item.version).toBe(2);
  });
});
