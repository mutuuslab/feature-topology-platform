import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJson, executionProduct, workflowTransferProducts } from '@ff/contracts';
import { WORKFLOW_EXECUTION_MODEL as M } from '../../src/generated/workflow-execution-model';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

const SYS=actor('usr-sysadmin','SYSTEM_ADMIN'),AUTHOR=actor('usr-commerce','PRODUCT_AUTHOR'),REVIEW=actor('usr-integrator','IMPLEMENTER'),RECIPIENT=actor('usr-safety2','SAFETY_OFFICER');
const A='FPW.1-A01',TO='FPW.2-A05';
describe('cross-case native transfers and actual binary files',()=>{
  let app:INestApplication,http:()=>any,db:Db;
  beforeAll(async()=>{
    ({app,http}=await bootApp({at:'2026-11-09T00:00:00.000Z',showcaseFill:false}));db=app.get(DB);
    for(const [accountId,roleId] of [['usr-commerce','R-FO'],['usr-integrator','R-ARC']])await http().post('/api/workflow/roles').set(SYS).send({accountId,roleId,active:true,reason:'분리 검토·인계 회귀 배정'}).expect(201);
  });
  afterAll(()=>app.close());
  const create=async(processId='FPW.1',targetRef='CASE-TARGET')=>(await http().post('/api/workflow/cases').set(processId==='FPW.1'?AUTHOR:RECIPIENT).send({processId,targetRef,title:`인계 ${processId}`}).expect(201)).body;
  const detail=async(id:string,who=AUTHOR)=>(await http().get(`/api/workflow/cases/${id}`).set(who).expect(200)).body;
  async function accepted(binary=false){
    let d=await create();const id=d.item.caseId;
    for(const productKey of [ 'WP-FEAT-REG','WP-REF-LINK']){
      const fields=Object.fromEntries(executionProduct(M,productKey).content.map((_,i)=>[String(i),`실제 작성 항목 ${i}`]));
      let fileIds:string[]=[];
      if(binary&&productKey==='WP-REF-LINK')fileIds=[(await upload(id,d.item.version,Buffer.alloc(1024*1024+37,0x5a),'accepted-file-key').expect(201)).body.fileId];
      d=(await http().post(`/api/workflow/cases/${id}/artifacts`).set(AUTHOR).send({version:d.item.version,activityId:A,productKey,fields,references:['SOURCE-REVIEWED'],fileIds,reason:'실제 산출물 작성'}).expect(201)).body;
    }
    d=(await http().post(`/api/workflow/cases/${id}/activities/${A}/submit`).set(AUTHOR).send({version:d.item.version,note:'독립 검토 요청'}).expect(201)).body;
    return (await http().post(`/api/workflow/cases/${id}/activities/${A}/review`).set(REVIEW).send({version:d.item.version,decision:'ACCEPT',reason:'실제 분리 검토'}).expect(201)).body;
  }
  const upload=(id:string,version:number,data:Buffer,key='binary-request-key')=>http().post(`/api/workflow/cases/${id}/activities/${A}/uploads`).set(AUTHOR).set('Content-Type','application/octet-stream').set('If-Match',`"${version}"`).set('Idempotency-Key',key).set('X-File-Name',encodeURIComponent('설계자료.bin')).set('X-File-Type','application/octet-stream').send(data);
  it('raw normative model has 63 cross-process exact output/input relationships',()=>{
    const acts=M.processes.flatMap(p=>p.activities);
    expect(acts.flatMap(a=>acts.filter(b=>a.processId!==b.processId&&workflowTransferProducts(M,a.id,b.id).length))).toHaveLength(63);
  });
  it('stores >JSON-cap actual bytes, replays by actual content, rejects other activity and stale CAS atomically',async()=>{
    const d=await create(),id=d.item.caseId,bytes=Buffer.alloc(1024*1024+37,0x67);
    const f=(await upload(id,1,bytes).expect(201)).body;
    expect(f).toMatchObject({bytes:bytes.length,base64:'',sha256:createHash('sha256').update(bytes).digest('hex')});
    expect((await upload(id,1,bytes).expect(201)).body.fileId).toBe(f.fileId);
    await upload(id,1,Buffer.from('different')).expect(409);
    await http().get(`/api/workflow/cases/${id}/files/${f.fileId}`).set(AUTHOR).expect(403);
    const body={version:1,activityId:A,productKey:'WP-REF-LINK',fields:{},references:[],fileIds:[f.fileId],reason:'실제 바이트 연결'};
    await http().post(`/api/workflow/cases/${id}/artifacts`).set(AUTHOR).send({...body,version:2}).expect(412);
    expect(db.get<any>('SELECT status FROM binary_object WHERE file_id=?',f.fileId).status).toBe('READY');
    await http().post(`/api/workflow/cases/${id}/artifacts`).set(AUTHOR).send(body).expect(201);
    const r=await http().get(`/api/workflow/cases/${id}/files/${f.fileId}`).set(AUTHOR).expect(200);
    expect(Buffer.from(r.body)).toEqual(bytes);expect(r.headers['x-content-sha256']).toBe(f.sha256);
    await http().get(`/api/workflow/cases/${id}/files/${f.fileId}`).set(actor('usr-operator','OPERATOR')).expect(403);
    await upload(id,1,Buffer.from('stale'),'stale-upload-key').expect(412);
    expect(db.get<any>('SELECT COUNT(*) AS n FROM binary_object WHERE request_key=?','stale-upload-key').n).toBe(0);
  });
  it('offers immutable reviewed payload into another process; both cases change together, retry has no new events',async()=>{
    const s=await accepted(true),t=await create('FPW.2'),id=s.item.caseId,tid=t.item.caseId;
    const body={version:s.item.version,targetVersion:1,toCaseId:tid,requestKey:'cross-case-request-001',fromActivityId:A,toActivityId:TO,note:'검토된 원천 인계'};
    const targets=(await http().get(`/api/workflow/cases/${id}/transfer-targets`).query({fromActivityId:A}).set(AUTHOR).expect(200)).body;
    expect(targets.items.find((v:any)=>v.caseId===tid).activities).toContainEqual({id:TO,productKeys:['WP-REF-LINK']});
    await http().post(`/api/workflow/cases/${id}/transfers`).set(AUTHOR).send({...body,targetVersion:2}).expect(412);
    expect((await detail(id)).item.version).toBe(body.version);expect((await detail(tid,RECIPIENT)).item.version).toBe(1);
    const offered=(await http().post(`/api/workflow/cases/${id}/transfers`).set(AUTHOR).send(body).expect(201)).body;
    const h=offered.item.handoffs[0];expect(h.artifacts).toHaveLength(1);
    expect(h.artifactsHash).toBe(createHash('sha256').update(canonicalJson(h.artifacts)).digest('hex'));
    expect(h.artifacts[0].productKey).toBe('WP-REF-LINK');
    const retried=(await http().post(`/api/workflow/cases/${id}/transfers`).set(AUTHOR).send({...body,version:99,targetVersion:99}).expect(201)).body;
    expect(retried.item.version).toBe(offered.item.version);expect(retried.history.length).toBe(offered.history.length);
    await http().post(`/api/workflow/cases/${id}/transfers`).set(AUTHOR).send({...body,note:'다른 내용'}).expect(409);
    const incoming=await detail(tid,RECIPIENT),f=h.artifacts[0].files[0];
    expect(incoming.item.handoffs[0]).toEqual(h);expect(incoming.item.activities).toEqual({});
    await http().get(`/api/workflow/cases/${tid}/files/${f.fileId}`).set(RECIPIENT).expect(200);
    await http().post(`/api/workflow/cases/${tid}/handoffs/${h.handoffId}/receive`).set(RECIPIENT).send({version:incoming.item.version,decision:'ACCEPT',reason:'레거시 우회 불가'}).expect(422);
    const receive={version:incoming.item.version,sourceVersion:offered.item.version,decision:'ACCEPT',reason:'수신 근거 확인'};
    await http().post(`/api/workflow/cases/${tid}/transfers/${h.handoffId}/receive`).set(AUTHOR).send(receive).expect(403);
    await http().post(`/api/workflow/cases/${tid}/transfers/${h.handoffId}/receive`).set(RECIPIENT).send({...receive,sourceVersion:1}).expect(412);
    const got=(await http().post(`/api/workflow/cases/${tid}/transfers/${h.handoffId}/receive`).set(RECIPIENT).send(receive).expect(201)).body;
    expect(got.item.handoffs[0].status).toBe('ACCEPTED');expect(got.item.activities).toEqual({});
    const again=(await http().post(`/api/workflow/cases/${tid}/transfers/${h.handoffId}/receive`).set(RECIPIENT).send(receive).expect(201)).body;
    expect(again.item.version).toBe(got.item.version);
  });
  it('rejects unrelated inputs, different targets and unreviewed source without partial state',async()=>{
    const s=await create(),t=await create('FPW.2'),other=await create('FPW.2','DIFFERENT');
    const body={version:1,targetVersion:1,toCaseId:t.item.caseId,requestKey:'unreviewed-request',fromActivityId:A,toActivityId:TO,note:'검토 전 인계'};
    await http().post(`/api/workflow/cases/${s.item.caseId}/transfers`).set(AUTHOR).send(body).expect(422);
    await http().post(`/api/workflow/cases/${s.item.caseId}/transfers`).set(AUTHOR).send({...body,toActivityId:'FPW.2-A02'}).expect(422);
    await http().post(`/api/workflow/cases/${s.item.caseId}/transfers`).set(AUTHOR).send({...body,toCaseId:other.item.caseId}).expect(422);
    expect((await detail(s.item.caseId)).item.handoffs).toEqual([]);
  });
  it('rolls back both case documents and histories when the second CAS write fails',async()=>{
    const s=await accepted(),t=await create('FPW.2'),id=s.item.caseId,tid=t.item.caseId;
    const body={version:s.item.version,targetVersion:1,toCaseId:tid,requestKey:'two-case-atomic-key',fromActivityId:A,toActivityId:TO,note:'양방 저장 실패 검증'};
    const run=db.run.bind(db);let updates=0;
    const spy=vi.spyOn(db,'run').mockImplementation((sql,...params)=>{if(sql.startsWith('UPDATE workflow_case SET')&&++updates===2)throw new Error('second case persistence failed');return run(sql,...params);});
    try{await http().post(`/api/workflow/cases/${id}/transfers`).set(AUTHOR).send(body).expect(500);}finally{spy.mockRestore();}
    const after=await detail(id),target=await detail(tid,RECIPIENT);
    expect(after.item).toEqual(s.item);expect(target.item).toEqual(t.item);expect(after.history).toEqual(s.history);expect(target.history).toEqual(t.history);
    await http().post(`/api/workflow/cases/${id}/transfers`).set(AUTHOR).send(body).expect(201);
  });
  it('accepts only one concurrent offer from the same source version and preserves the losing recipient',async()=>{
    const s=await accepted(),targets=await Promise.all([create('FPW.2'),create('FPW.2')]),id=s.item.caseId;
    const responses=await Promise.all(targets.map((t,i)=>http().post(`/api/workflow/cases/${id}/transfers`).set(AUTHOR).send({version:s.item.version,targetVersion:1,toCaseId:t.item.caseId,requestKey:`concurrent-transfer-${i}`,fromActivityId:A,toActivityId:TO,note:'동시 양방 인계'})));
    expect(responses.map(r=>r.status).sort()).toEqual([201,412]);
    for(let i=0;i<targets.length;i++){const t=await detail(targets[i].item.caseId,RECIPIENT);expect(t.item.handoffs).toHaveLength(responses[i].status===201?1:0);expect(t.item.version).toBe(responses[i].status===201?2:1);}
  });
  it('return revokes the recipient attachment path and role revocation prevents an actual receipt',async()=>{
    const s=await accepted(true),t=await create('FPW.2'),id=s.item.caseId,tid=t.item.caseId;
    const sent=(await http().post(`/api/workflow/cases/${id}/transfers`).set(AUTHOR).send({version:s.item.version,targetVersion:1,toCaseId:tid,requestKey:'return-permission-key',fromActivityId:A,toActivityId:TO,note:'반송 권한 검증'}).expect(201)).body;
    const h=sent.item.handoffs[0],fileId=h.artifacts[0].files[0].fileId;
    const operator=actor('usr-operator','OPERATOR');
    const grant=(active:boolean)=>http().post('/api/workflow/roles').set(SYS).send({accountId:'usr-operator',roleId:'R-SM',active,reason:'수신 검토 담당 시험 배정'}).expect(201);
    await grant(true);await http().get(`/api/workflow/cases/${tid}/files/${fileId}`).set(operator).expect(200);await grant(false);
    await http().get(`/api/workflow/cases/${tid}/files/${fileId}`).set(operator).expect(403);
    await http().post(`/api/workflow/cases/${tid}/transfers/${h.handoffId}/receive`).set(operator).send({version:2,sourceVersion:sent.item.version,decision:'ACCEPT',reason:'철회된 역할'}).expect(403);
    await http().post(`/api/workflow/cases/${tid}/transfers/${h.handoffId}/receive`).set(RECIPIENT).send({version:2,sourceVersion:sent.item.version,decision:'RETURN',reason:'원천 보완 후 다시 인계 요청'}).expect(201);
    await http().get(`/api/workflow/cases/${tid}/files/${fileId}`).set(RECIPIENT).expect(403);
    await http().get(`/api/workflow/cases/${id}/files/${fileId}`).set(AUTHOR).expect(200);
  });
});
