import type { INestApplication } from '@nestjs/common';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { actor,bootApp,withRef } from '../helpers';
import { DB,type Db } from '../../src/kernel/db';
import { LocalKek,SecretVault } from '../../src/kernel/kms/key-protection';
import {randomBytes} from 'node:crypto';
import { sealSecrets } from '../../src/kernel/kms/secret-columns';

const EST=actor('cost.reference.writer','COST_ESTIMATOR');
const APPROVER=actor('cost.reference.reviewer','COST_APPROVER');
const DEV=actor('cost.reference.dev','IMPLEMENTER');
describe('Feature DB-first cost source contract',()=>{
 let app:INestApplication,http:()=>any,db:Db;
 beforeAll(async()=>{const b=await bootApp({showcaseFill:false});({app,http}=b);db=b.get<Db>(DB);});
 afterAll(()=>app?.close());
 const preview=async(refId='BC-BCM-004')=>(await http().get(`/api/cost/references/${refId}`).set(EST).expect(200)).body;
 const selection=(p:any,feature:any=null)=>({refId:p.ref.refId,refRelease:p.refRelease,referenceSha256:p.referenceSha256,feature});
 const create=async(ref:any)=>(await http().post('/api/cost/projects').set(EST).send({name:'Feature DB 기준 산정',references:[ref]}).expect(201)).body.estId;
 const detail=async(id:string,role=EST)=>(await http().get(`/api/cost/projects/${id}`).set(role).expect(200)).body;

 it('starts from a published reference without registering or fabricating a Feature; engine, scope and count remain useful',async()=>{
  const before=db.get<{n:number}>('SELECT count(*) n FROM feature_version')!.n;
  const p=await preview();const id=await create(selection(p));const d=await detail(id);
  expect(d.lines).toHaveLength(1);expect(d.features).toEqual([]);
  expect(d.lines[0]).toMatchObject({featureId:null,version:null,role:'REFERENCE',sourceRevision:1,source:{kind:'FEATURE_DB',stale:false,release:p.refRelease,referenceSha256:p.referenceSha256}});
  expect(d.result.totals.totalMm).toBeGreaterThan(0);
  expect(db.get<{n:number}>('SELECT count(*) n FROM feature_version')!.n).toBe(before);
  const list=(await http().get('/api/cost/projects').set(EST).expect(200)).body.items.find((v:any)=>v.estId===id);
  expect(list).toMatchObject({referenceCount:1,featureCount:0});expect(list.scope.domains).toContain(p.ref.domain);
 });

 it('rejects stale hashes/releases, duplicate references and arbitrary Feature links atomically',async()=>{
  const p=await preview();const s=selection(p);const id=await create(s);
  await http().post(`/api/cost/projects/${id}/references`).set(EST).send(s).expect(409);
  await http().post('/api/cost/projects').set(EST).send({name:'old hash',references:[{...s,referenceSha256:'0'.repeat(64)}]}).expect(409);
  await http().post('/api/cost/projects').set(EST).send({name:'old release',references:[{...s,refRelease:'v999.0'}]}).expect(409);
  await http().patch(`/api/cost/projects/${id}/lines/1/source`).set(EST).send({selection:{...s,feature:{featureId:'FEAT-99999',version:'1.0.0',sha256:'0'.repeat(64)}},revision:1,reason:'연결 검토'}).expect(404);
  expect((await detail(id)).lines[0].sourceRevision).toBe(1);
 });

 it('links only an actual compatible Feature and appends revisions without losing estimate inputs',async()=>{
  const p=await preview();const id=await create(selection(p));
  const body=withRef({name:'실제 산정 연결',description:'참조 연결 시험',requirementIds:['REQ-COST-REF'],country:'KR',vehicleModel:'NX4 PE',trim:'Premium',ownerId:'구매본부',asil:'QM'},p.ref.refId);
  const f=(await http().post('/api/features').set(actor('ref.author','FEATURE_AUTHOR')).send(body).expect(201)).body;
  const candidate=(await preview()).features.find((v:any)=>v.featureId===f.featureId && v.version===f.version);
  const linked={featureId:candidate.featureId,version:candidate.version,sha256:candidate.sha256};
  await http().patch(`/api/cost/projects/${id}/lines/1`).set(EST).send({qty:3,m:2}).expect(200);
  const current=await preview();
  const changed=(await http().patch(`/api/cost/projects/${id}/lines/1/source`).set(EST).send({selection:selection(current,linked),revision:1,reason:'실제 등록 Feature 연결'}).expect(200)).body;
  expect(changed.lines[0]).toMatchObject({featureId:f.featureId,version:f.version,sourceRevision:2,inputs:{qty:3,m:2},source:{kind:'REGISTERED_FEATURE'}});
  await http().patch(`/api/cost/projects/${id}/lines/1/source`).set(EST).send({selection:selection(current),revision:1,reason:'오래된 개정'}).expect(409);
  const old=(await http().get(`/api/cost/projects/${id}/lines/1/sources/1`).set(DEV).expect(200)).body;
  expect(old.feature).toBeNull();expect(old.history.map((v:any)=>v.revision)).toEqual([1,2]);
 });

 it('retains captured facts until explicit refresh; changed sources block submission',async()=>{
  const p=await preview();const id=await create(selection(p));const before=(await detail(id)).result.totals.totalMm;
  const old=db.get<{doc:string}>('SELECT doc FROM feature_ref WHERE ref_id=?',p.ref.refId)!.doc;
  const ref=JSON.parse(old);ref.benchmarkEur=ref.benchmarkEur>0?ref.benchmarkEur*2:100000;
  try{
   db.run('UPDATE feature_ref SET doc=? WHERE ref_id=?',JSON.stringify(ref),p.ref.refId);
   const d=await detail(id);expect(d.lines[0].source.stale).toBe(true);expect(d.result.totals.totalMm).toBe(before);
   await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({action:'SUBMIT',reason:'원천 변경 전'}).expect(422);
   const fresh=(await http().patch(`/api/cost/projects/${id}`).set(EST).send({useLatestBasis:true}).expect(200)).body;
   expect(fresh.lines[0].sourceRevision).toBe(2);expect(fresh.lines[0].source.stale).toBe(false);
   expect(fresh.result.totals.totalMm).not.toBe(before);
  }finally{db.run('UPDATE feature_ref SET doc=? WHERE ref_id=?',old,p.ref.refId);}
 });

 it('keeps monetary source bodies sealed, projections redacted and KEK verification possible',async()=>{
  const id=await create(selection(await preview()));const d=await detail(id,DEV);
  await http().get('/api/cost/references/BC-BCM-004').set(DEV).expect(403);
  for(const key of ['benchmarkEur','kearneyNote','makeBuyVolume','makeBuyPremium','totalCost','unitPrice']) expect(JSON.stringify(d)).not.toContain(`"${key}"`);
  const row=db.get<{doc_sealed:string}>('SELECT doc_sealed FROM cost_reference_revision WHERE est_id=?',id)!;
  expect(row.doc_sealed.startsWith('ffenc1.')).toBe(true);expect(row.doc_sealed).not.toContain('benchmarkEur');
  expect(()=>db.run('UPDATE cost_reference_revision SET reason=? WHERE est_id=?','rewrite',id)).toThrow(/immutable/);
  expect(()=>db.run('DELETE FROM cost_reference_revision WHERE est_id=?',id)).toThrow(/append only/);
  expect(sealSecrets(db,app.get(SecretVault)).verified).toBeGreaterThan(0);
  const oldVault=app.get(SecretVault);const rotated=new SecretVault(new LocalKek(randomBytes(32)),[oldVault.current]);
  try{expect(sealSecrets(db,rotated).rewrapped).toBeGreaterThan(0);const changed=db.get<{doc_sealed:string}>('SELECT doc_sealed FROM cost_reference_revision WHERE est_id=?',id)!.doc_sealed;expect(changed).not.toBe(row.doc_sealed);expect(changed.split('.').slice(3)).toEqual(row.doc_sealed.split('.').slice(3));}
  finally{sealSecrets(db,new SecretVault(oldVault.current,[rotated.current]));}
  const raw=(await http().get(`/api/cost/projects/${id}/lines/1/sources/1`).set(EST).expect(200)).body;
  expect(raw.snapshot.reference.refId).toBe('BC-BCM-004');
  const hidden=(await http().get(`/api/cost/projects/${id}/lines/1/sources/1`).set(DEV).expect(200)).body;
  expect(hidden.snapshot).toBeUndefined();
 });

 it('preserves SoD and pins approved source revision; removal never reuses historical line identities',async()=>{
  const id=await create(selection(await preview()));
  await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({action:'SUBMIT',reason:'산정 검토 요청'}).expect(201);
  await http().post(`/api/cost/projects/${id}/transitions`).set(actor('cost.reference.writer','COST_APPROVER')).send({action:'APPROVE',reason:'자기 승인'}).expect(403);
  await http().post(`/api/cost/projects/${id}/transitions`).set(APPROVER).send({action:'APPROVE',reason:'구매 산정 승인'}).expect(201);
  const approved=await detail(id);expect(approved.approvals[0].sources).toEqual([{lineNo:1,revision:1}]);
  expect(()=>db.run('DELETE FROM cost_approval_source WHERE est_id=?',id)).toThrow(/append only/);
  await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({action:'REVISE',reason:'범위 개정'}).expect(201);
  await http().delete(`/api/cost/projects/${id}/lines/1`).set(EST).expect(200);
  const current=await preview();
  const added=(await http().post(`/api/cost/projects/${id}/references`).set(EST).send(selection(current)).expect(201)).body;
  expect(added.lines[0].lineNo).toBe(2);expect(added.approvals[0].resultSha256).toBe(approved.approvals[0].resultSha256);
  await http().get(`/api/cost/projects/${id}/lines/1/sources/1`).set(DEV).expect(200);
 });
 it('captures unselected duplicate targets used by bundle checks and detects their later changes',async()=>{
  const rows=db.all<{doc:string}>('SELECT doc FROM feature_ref').map(row=>JSON.parse(row.doc));const ref=rows.find(ref=>ref.duplicateOf && ref.status==='ACTIVE' && rows.some(target=>target.refId===ref.duplicateOf));expect(ref).toBeDefined();
  const p=await preview(ref.refId);const id=await create(selection(p));
  const source=(await http().get(`/api/cost/projects/${id}/lines/1/sources/1`).set(EST).expect(200)).body;
  expect(source.snapshot.relatedReferences.map((ref:any)=>ref.refId)).toContain(ref.duplicateOf);
  const old=db.get<{doc:string}>('SELECT doc FROM feature_ref WHERE ref_id=?',ref.duplicateOf)!.doc;
  try{db.run('UPDATE feature_ref SET doc=? WHERE ref_id=?',JSON.stringify({...JSON.parse(old),adminMemo:'후속 원천 변경 시험'}),ref.duplicateOf);expect((await detail(id)).lines[0].source.stale).toBe(true);await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({action:'SUBMIT',reason:'연관 원천 변경'}).expect(422);}
  finally{db.run('UPDATE feature_ref SET doc=? WHERE ref_id=?',old,ref.duplicateOf);}
 });
});
