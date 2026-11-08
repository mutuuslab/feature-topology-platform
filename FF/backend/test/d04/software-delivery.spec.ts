import type { INestApplication } from '@nestjs/common';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { createHash } from 'node:crypto';
import { actor,bootApp } from '../helpers';
import { SoftwareDeliveryService,type SoftwarePackage } from '../../src/software/software-delivery.service';
import { ActivationService } from '../../src/domains/d01-policy/activation/activation.service';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { FleetRepo,PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { DB,type Db } from '../../src/kernel/db';
import { PkiService } from '../../src/domains/d06-qsec/pki-kms/pki.service';
import { Clock } from '../../src/kernel/clock';
import { signVehicleRequest,vehicleKeyFromRoot } from '../../src/kernel/vehicle-auth-client';

const DEV=actor('usr-dev','IMPLEMENTER'),REVIEW=actor('usr-rm','RELEASE_MANAGER');
describe('실제 SW 원문·서명·Flag 조건 다운로드',()=>{
 let app:INestApplication,http:()=>any,service:SoftwareDeliveryService,db:Db,featureId:string,version:string,swId:string,flagKey:string,vin:string,p:SoftwarePackage;
 const bytes=Buffer.from('export const run = () => ({ feature: "download-test", value: true });\n');
 const sha=createHash('sha256').update(bytes).digest('hex');
 const root=createHash('sha256').update('software-delivery-public-test-root').digest();
 const saved={auth:process.env.FF_VEHICLE_AUTH,root:process.env.FF_HSM_VEHICLE_ROOT};
 beforeAll(async()=>{
   process.env.FF_VEHICLE_AUTH='required';process.env.FF_HSM_VEHICLE_ROOT=root.toString('base64');
   ({app,http}=await bootApp({demoActivity:true,showcaseFill:false,at:'2026-11-09T00:00:00Z'}));
   service=app.get(SoftwareDeliveryService);db=app.get(DB);
   const features=app.get(FeatureRepo),fleet=app.get(FleetRepo),activation=app.get(ActivationService);
   outer:for(const policy of app.get(PolicyRepo).all().filter(x=>x.status==='DEPLOYED')){
     const f=features.get(policy.featureId,policy.featureVersion);if(!f?.swIds.length)continue;
     for(const v of fleet.vehicles().filter(v=>v.country===f.country&&v.vehicleModel===f.vehicleModel&&v.trim===f.trim)){
       const d=await activation.decide(v.vin,policy.flagKey);if(d.result.value&&d.result.reason==='POLICY_MATCH'){featureId=f.featureId;version=f.version;swId=f.swIds[0];flagKey=policy.flagKey;vin=v.vin;break outer;}
     }
   }
   expect(vin,'기존 실제 seed 배포·지원·권한으로 허용된 차량이 필요합니다').toBeTruthy();
 },60_000);
 afterAll(async()=>{await app?.close();if(saved.auth===undefined)delete process.env.FF_VEHICLE_AUTH;else process.env.FF_VEHICLE_AUTH=saved.auth;if(saved.root===undefined)delete process.env.FF_HSM_VEHICLE_ROOT;else process.env.FF_HSM_VEHICLE_ROOT=saved.root;});
 const upload=(data=bytes,key='software-upload-test')=>http().post('/api/software/uploads').set(DEV).set('Content-Type','application/octet-stream').set('X-File-Name','demo-feature.mjs').set('X-File-Type','text/javascript').set('Idempotency-Key',key).send(data);
 const body=(fileId:string,hash=sha)=>({fileId,featureId,featureVersion:version,swId,sha256:hash,source:'EXECUTABLE_DEMO',reason:'실제 원문 다운로드 통합 시험'});
 const review=(id:string,revision:number,decision='APPROVE')=>http().post(`/api/software/packages/${id}/review`).set(REVIEW).send({revision,decision,reason:'원문과 대상 SW 독립 검토'});
 const check=(id=p.packageId,key=flagKey)=>http().post(`/api/software/packages/${id}/check`).set(REVIEW).send({vin,flagKey:key});
 const download=(id=p.packageId,key=flagKey)=>http().get(`/api/software/packages/${id}/download`).query({vin,flagKey:key}).set(REVIEW).buffer(true).parse((res:any,done:any)=>{const parts:Buffer[]=[];res.on('data',(v:Buffer)=>parts.push(v));res.on('end',()=>done(null,Buffer.concat(parts)));});
 it('실제 업로드·재전송은 같은 바이트만 허용하고 다른 바이트는 거부한다',async()=>{
   const u=(await upload().expect(201)).body;expect(u).toMatchObject({bytes:bytes.length,sha256:sha});
   expect((await upload().expect(201)).body.fileId).toBe(u.fileId);
   await upload(Buffer.from('changed')).expect(409);
   await http().post('/api/software/packages').set(DEV).send(body(u.fileId,'0'.repeat(64))).expect(422);
   await http().post('/api/software/packages').set(DEV).send({...body(u.fileId),swId:'SW-NOT-A-COMPONENT'}).expect(400);
   p=(await http().post('/api/software/packages').set(DEV).send(body(u.fileId)).expect(201)).body;
   expect(p.status).toBe('DRAFT');expect((await check().expect(201)).body).toMatchObject({allowed:false,blocked:'PACKAGE_NOT_APPROVED'});
   await download().expect(422);
 });
 it('등록자 자기검토·권한없는 승인·낡은 revision을 거부하고 독립 검토로 서명한다',async()=>{
   await http().post(`/api/software/packages/${p.packageId}/review`).set(actor('usr-dev','RELEASE_MANAGER')).send({revision:1,decision:'APPROVE',reason:'자기 검토 시도'}).expect(403);
   await http().post(`/api/software/packages/${p.packageId}/review`).set(DEV).send({revision:1,decision:'APPROVE',reason:'역할 우회 시도'}).expect(403);
   await review(p.packageId,2).expect(412);p=(await review(p.packageId,1).expect(201)).body;
   expect(p).toMatchObject({status:'APPROVED',reviewedBy:'usr-rm',revision:2,signature:{alg:'Ed25519'}});
   const c=(await check().expect(201)).body;expect(c).toMatchObject({allowed:true,evaluation:{value:true,reason:'POLICY_MATCH'},boundary:'FILE_DOWNLOAD_ONLY'});
   expect(app.get(PkiService).verify(c.manifest,c.signature,app.get(PkiService).keys(),'policy').valid).toBe(true);
   expect(c.manifest.sbom).toMatchObject({bomFormat:'CycloneDX',components:[{name:swId,hashes:[{alg:'SHA-256',content:sha}]}]});
 });
 it('실제 native Flag 평가 뒤 원문을 내려보내고 클라이언트가 SHA-256을 독립 대조한다',async()=>{
   const r=await download().expect(200);expect(r.body).toEqual(bytes);expect(r.headers['x-content-sha256']).toBe(sha);
   expect(createHash('sha256').update(r.body).digest('hex')).toBe(sha);expect(r.headers['content-length']).toBe(String(bytes.length));
   expect((await http().get(`/api/software/packages/${p.packageId}/history`).expect(200)).body.items[0]).toMatchObject({sha256:sha,state:'STREAM_OPENED',policy:{featureId,featureVersion:version}});
   await http().get(`/api/software/packages/${p.packageId}/download`).set(REVIEW).expect(400);
   await http().get(`/api/software/packages/${p.packageId}/download`).query({vin,flagKey}).set(actor('usr-auditor','AUDITOR')).expect(403);
 });
 it('Flag 꺼짐과 대상 제외는 실제 평가에서 false가 되어 파일을 거부한다',async()=>{
   const active=app.get(PolicyRepo).deployed(flagKey)!;
   const original=db.get<{doc:string}>('SELECT doc FROM policy WHERE policy_id=?',active.policyId)!.doc;
   for(const patch of [{enabled:false},{rollout:{...active.rollout,mode:'NONE'}}]){
     db.run('UPDATE policy SET doc=? WHERE policy_id=?',JSON.stringify({...JSON.parse(original),...patch}),active.policyId);
     const c=(await check().expect(201)).body;expect(c.allowed).toBe(false);expect(c.evaluation.value).toBe(false);await download().expect(422);
   }
   db.run('UPDATE policy SET doc=? WHERE policy_id=?',original,active.policyId);
 });
 it('실제 HTTP에서 차량 키 서명으로 내려받고 무서명·재생·다른 VIN 요청을 거부한다',async()=>{
   const path=`/vehicle/v1/${encodeURIComponent(vin)}/software/${p.packageId}/download?flagKey=${encodeURIComponent(flagKey)}`;
   const headers=signVehicleRequest({vehicleKey:vehicleKeyFromRoot(root,1,vin),vin,epoch:1,method:'GET',path,now:app.get(Clock).now().getTime()});
   await http().get(path).set('X-Vehicle-Id',vin).expect(401);
   const r=await http().get(path).set(headers).buffer(true).parse((res:any,done:any)=>{const chunks:Buffer[]=[];res.on('data',(b:Buffer)=>chunks.push(b));res.on('end',()=>done(null,Buffer.concat(chunks)));}).expect(200);
   expect(r.body).toEqual(bytes);await http().get(path).set(headers).expect(401);
   const mp=path.replace('/download?','/manifest?'),mh=signVehicleRequest({vehicleKey:vehicleKeyFromRoot(root,1,vin),vin,epoch:1,method:'GET',path:mp,now:app.get(Clock).now().getTime()});
   expect((await http().get(mp).set(mh).expect(200)).body.manifest.sha256).toBe(sha);
   const other=app.get(FleetRepo).vehicles().find(v=>v.vin!==vin)!.vin;
   const forged=signVehicleRequest({vehicleKey:vehicleKeyFromRoot(root,1,other),vin:other,epoch:1,method:'GET',path,now:app.get(Clock).now().getTime()});
   await http().get(path).set(forged).expect(403);
 });
 it('서명 키 만료를 다운로드 가능으로 처리하지 않는다',async()=>{
   const keyId=p.signature!.keyId,old=db.get<{not_after:string}>('SELECT not_after FROM pki_key WHERE key_id=?',keyId)!.not_after;
   db.run('UPDATE pki_key SET not_after=? WHERE key_id=?','2020-01-01T00:00:00Z',keyId);
   expect((await check().expect(201)).body).toMatchObject({allowed:false,blocked:'MANIFEST_SIGNATURE_INVALID'});await download().expect(422);
   db.run('UPDATE pki_key SET not_after=? WHERE key_id=?',old,keyId);
 });
 it('다른 Flag·서명손상·원문손상·패키지 회수를 실제 다운로드 성공으로 만들지 않는다',async()=>{
   expect((await check(p.packageId,'unknown_flag').expect(201)).body).toMatchObject({allowed:false,blocked:'DEPLOYED_FEATURE_MISMATCH'});
   const stored=db.get<{doc:string}>('SELECT doc FROM software_package WHERE package_id=?',p.packageId)!.doc;
   const damaged=JSON.parse(stored);damaged.signature.signature='AAAA';db.run('UPDATE software_package SET doc=? WHERE package_id=?',JSON.stringify(damaged),p.packageId);
   expect((await check().expect(201)).body).toMatchObject({allowed:false,blocked:'MANIFEST_SIGNATURE_INVALID'});await download().expect(422);
   db.run('UPDATE software_package SET doc=? WHERE package_id=?',stored,p.packageId);
   const original=db.get<{data:Uint8Array}>('SELECT data FROM binary_chunk WHERE file_id=? AND seq=0',p.fileId)!.data;
   db.run('UPDATE binary_chunk SET data=? WHERE file_id=? AND seq=0',Buffer.from('corrupt'),p.fileId);await download().expect(422);
   db.run('UPDATE binary_chunk SET data=? WHERE file_id=? AND seq=0',original,p.fileId);
   p=(await review(p.packageId,2,'REVOKE').expect(201)).body;expect(p.status).toBe('REVOKED');await download().expect(422);
 });
 it('서명된 차량 경로는 다른 VIN으로 위장하지 못한다',async()=>{
   await expect(service.download({id:'vehicle:OTHER',role:'VEHICLE',correlationId:'scope-test'},p.packageId,vin,flagKey)).rejects.toMatchObject({code:'VEHICLE_SCOPE'});
 });
});
