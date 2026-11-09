import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { ROUTES,routeUrl,snapshotFile } from '@ff/contracts';
import command from '../../../harness/guide/schema/examples/kill_safety_dc2_eu.ok.json';
const files=new Map<string,unknown>();
let sim:typeof import('../api/sim'),engine:typeof import('../api/sim/engine');
const run=(name:string,role:string,body?:unknown,params:Record<string,string>={},query:Record<string,unknown>={})=>sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,params,query as any),{role,body,params});
const put=(name:string,body:unknown,params:Record<string,string>={},query:Record<string,unknown>={})=>files.set('/'+snapshotFile(routeUrl(name,params,query as any)),body);
beforeEach(async()=>{
 vi.resetModules();vi.stubEnv('VITE_DATA_MODE','static');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-09T02:00:00Z'));localStorage.clear();files.clear();
 put('listFeatures',{items:[{featureId:'FEAT-00022',version:'1.0.0',lifecycle:'DEVELOPING',isLatest:true}]},{},{latestOnly:false});
 vi.stubGlobal('fetch',vi.fn(async(u:string)=>new Response(JSON.stringify(files.get(u)??{items:[]}),{headers:{'Content-Type':'application/json'}})));
 sim=await import('../api/sim');engine=await import('../api/sim/engine');
});
afterEach(()=>{engine?.__resetSimForTest();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('local API keys expose the random secret once, retain only its real hash and remove the hash on revocation',async()=>{
 const body={name:'Local demo collector',system:'DEMO',role:'AUDITOR',reason:'오프라인 검토'};
 await expect(run('issueApiKey','viewer',body)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(run('issueApiKey','opslead',{...body,expiresOn:'2026-01-01'})).rejects.toMatchObject({code:'VALIDATION'});
 const k=await run('issueApiKey','opslead',body);expect(k.secret).toMatch(/^ffk_AK-\d{4}_[A-Za-z0-9_-]{43}$/);expect(k.localOnly).toBe(true);
 const next=await run('issueApiKey','opslead',body);expect(next.secret).not.toBe(k.secret);
 const stored=engine.__overlayForTest()!,secretHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(k.secret)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 expect(stored.entities.localApiKey[k.keyId].hash).toBe(secretHash);expect(JSON.stringify(stored)).not.toContain(k.secret);
 const list=await run('apiKeys','viewer');expect(list.items).toHaveLength(2);expect(JSON.stringify(list)).not.toContain(secretHash);expect(JSON.stringify(list)).not.toContain(k.secret);
 await run('revokeApiKey','opslead',{reason:'사용 종료'},{id:k.keyId});expect(engine.__overlayForTest()!.entities.localApiKey[k.keyId].hash).toBeNull();
 expect((await run('apiKeys','viewer')).items.find((x:any)=>x.keyId===k.keyId).state).toBe('REVOKED');
 await expect(run('revokeApiKey','opslead',{reason:'중복 폐기'},{id:k.keyId})).rejects.toMatchObject({code:'CONFLICT'});
});
const link={system:'ERP-DEMO',name:'Demo plant',kind:'PLANT-ERP',endpoint:'https://erp.example/orders',bridgeType:'BATCH',schedule:'DAILY',plant:'TMA',status:'INACTIVE',note:null};
it('legacy configurations validate bridge combinations, block active deletion and preserve tombstones and history',async()=>{
 await expect(run('createLegacyLink','integrator',{...link,bridgeType:'REALTIME'})).rejects.toMatchObject({code:'VALIDATION'});
 const l=await run('createLegacyLink','integrator',link);expect(l.bridge).toMatchObject({type:'BATCH',ruleSystem:'PLANT-ERP'});
 await expect(run('createLegacyLink','integrator',link)).rejects.toMatchObject({code:'CONFLICT'});
 await run('updateLegacyLink','integrator',{status:'ACTIVE',reason:'설정 검토'},{id:l.linkId});
 await expect(run('deleteLegacyLink','integrator',{reason:'활성 상태'},{id:l.linkId})).rejects.toMatchObject({code:'GUARD_FAILED'});
 await run('updateLegacyLink','integrator',{status:'INACTIVE',reason:'삭제 준비'},{id:l.linkId});
 await run('deleteLegacyLink','integrator',{reason:'설정 폐기'},{id:l.linkId});expect((await run('legacyLinks','viewer')).items).toHaveLength(0);
 const newer=await run('createLegacyLink','integrator',link);expect(newer.linkId).not.toBe(l.linkId);expect(newer.lastRun).toBeNull();
 expect(engine.__overlayForTest()!.audit.some(a=>a.action==='LEGACY_LINK_DELETE')).toBe(true);
});
it('legacy rule changes require an existing Feature and override a captured rule without mutating its source',async()=>{
 const original={legacyCode:'OPT-AA',system:'PLANT-ERP',description:'기본 옵션',featureId:'FEAT-00022',source:'FIXTURE',version:0,note:null};put('legacyMappings',{items:[original]});
 const b={legacyCode:'OPT-BB',system:'PLANT-ERP',description:'새 옵션',featureId:'FEAT-99999',reason:'변환 검토'};
 await expect(run('createLegacyRule','integrator',b)).rejects.toMatchObject({code:'VALIDATION'});
 await run('createLegacyRule','integrator',{...b,featureId:'FEAT-00022'});
 await run('updateLegacyRule','integrator',{description:'확인한 옵션',reason:'명세 보완'},{code:'OPT-AA'});
 const all=(await run('legacyMappings','viewer')).items;expect(all).toHaveLength(2);expect(all.find((x:any)=>x.legacyCode==='OPT-AA')).toMatchObject({source:'REGISTERED',version:1,description:'확인한 옵션'});expect(original.description).toBe('기본 옵션');
});
it('model approval requires two independent people and refuses drift, disconnected or already decided models',async()=>{
 const m={modelId:'MODEL-1',version:'1',use:'PENDING',approvals:[],drift:false,usable:false,datasetHash:'a'.repeat(64),trainedAt:'2026-10-01T00:00:00Z'};put('lakeModels',{connected:true,items:[m,{...m,modelId:'MODEL-2',drift:true}]});
 await expect(run('approveLakeModel','quality',{version:'1',decision:'APPROVE',reason:'드리프트 검토'},{id:'MODEL-2'})).rejects.toMatchObject({code:'GUARD_FAILED'});
 expect((await run('approveLakeModel','quality',{version:'1',decision:'APPROVE',reason:'첫 독립 검토'},{id:'MODEL-1'})).use).toBe('PENDING');
 await expect(run('approveLakeModel','quality',{version:'1',decision:'APPROVE',reason:'동일인 두 번'},{id:'MODEL-1'})).rejects.toMatchObject({code:'SEPARATION_OF_DUTY'});
 const approved=await run('approveLakeModel','opslead',{version:'1',decision:'APPROVE',reason:'운영 독립 검토'},{id:'MODEL-1'});expect(approved).toMatchObject({use:'APPROVED',usable:true,datasetHash:m.datasetHash,trainedAt:m.trainedAt});expect(approved.approvals).toHaveLength(2);
 expect((await run('lakeModels','viewer')).items[0].use).toBe('APPROVED');expect(m.use).toBe('PENDING');
 await expect(run('approveLakeModel','quality',{version:'1',decision:'REJECT',reason:'완료 후 변경'},{id:'MODEL-1'})).rejects.toMatchObject({code:'GUARD_FAILED'});
});
it('closing an intake keeps source facts, filters the open queue and cannot execute a kill',async()=>{
 const i={intakeId:'KI-1',status:'RECEIVED',vins:['VIN-1'],featureId:'FEAT-00022',receivedAt:'2026-11-01T00:00:00Z',killId:null};put('killIntakes',{items:[i]},{},{status:'RECEIVED'});
 const n=await run('dismissKillIntake','operator',{reason:'중복 제보 확인'},{id:i.intakeId});expect(n).toMatchObject({status:'DISMISSED',receivedAt:i.receivedAt,killId:null,vins:i.vins});
 expect((await run('killIntakes','viewer',undefined,{}, {status:'RECEIVED'})).items).toHaveLength(0);expect(engine.__overlayForTest()!.entities.kill??{}).toEqual({});
 await expect(run('dismissKillIntake','operator',{reason:'중복 처리'},{id:i.intakeId})).rejects.toMatchObject({code:'CONFLICT'});
});
it('no-impact rejudge closure updates the local queue and rejects a repeated decision',async()=>{
 const r={rejudgeId:1,featureId:'FEAT-00022',version:'1.0.0',gate:'G2',status:'OPEN',released:true,fromVersion:1,toVersion:2};put('almRejudge',{items:[r]});
 const n=await run('closeAlmRejudge','quality',{reason:'출시 버전 영향 없음 검토'},{id:'1'});expect(n).toMatchObject({status:'RESOLVED',resolvedBy:'usr-quality',fromVersion:1,toVersion:2});
 expect((await run('almRejudge','viewer',undefined,{}, {status:'OPEN'})).items).toHaveLength(0);
 await expect(run('closeAlmRejudge','quality',{reason:'중복 종료'},{id:'1'})).rejects.toMatchObject({code:'CONFLICT'});
});
it('a local bridge resolves real demo order options against the newly registered rule and retains unresolved codes',async()=>{
 const l=await run('createLegacyLink','integrator',{...link,status:'ACTIVE'});
 const first=await run('runLegacyBridge','integrator',{}, {id:l.linkId});expect(first.lastRun).toMatchObject({orders:2,status:'SUCCEEDED'});expect(first.lastRun.unresolved).toContain('OPT-XHUD');
 await run('createLegacyRule','integrator',{legacyCode:'OPT-XHUD',system:'PLANT-ERP',description:'시험 옵션 매핑',featureId:'FEAT-00022',reason:'시연 범위 연결'});
 const next=await run('runLegacyBridge','integrator',{}, {id:l.linkId});expect(next.lastRun.orders).toBe(2);expect(next.lastRun.unresolved).not.toContain('OPT-XHUD');
 const orders=(await run('legacyOrders','viewer',undefined,{}, {plant:'TMA'})).items;expect(orders).toHaveLength(2);expect(orders.find((o:any)=>o.orderId==='PO-TMA-26100002').resolved).toContainEqual({legacyCode:'OPT-XHUD',featureId:'FEAT-00022'});
});
it('legacy message conversion records both failure and actual parsed source values without applying vehicle state',async()=>{
 put('legacyVehicles',{items:[{vin:'LEGACY-001',codingUnit:'BCM'}]});
 const msg={format:'LGC-CODING-1',system:'DMS-DEMO',vin:'LEGACY-001',unit:'BCM',records:[{did:'F1022',value:'01'}],readAt:'2026-11-08T01:00:00Z'};
 const failure=await run('receiveLegacyMessage','operator',msg);expect(failure.status).toBe('FAILED');expect(failure.output).toBeNull();
 await run('createLegacyLink','integrator',{...link,system:'DMS-DEMO',kind:'DEALER-DMS',bridgeType:'REALTIME',schedule:null,plant:null,status:'ACTIVE'});
 const converted=await run('receiveLegacyMessage','operator',msg);expect(converted).toMatchObject({status:'CONVERTED',vehicleApplicationPerformed:false,output:{observedAt:'2026-11-08T01:00:00.000Z',features:[{featureId:'FEAT-00022',state:'ENABLED',source:{unit:'BCM',did:'F1022'}}]}});
 expect((await run('legacyMessages','viewer')).items).toHaveLength(2);expect(engine.__overlayForTest()!.audit.find(a=>a.action==='LEGACY_MESSAGE_CONVERT'&&a.result==='FAILED')).toBeTruthy();expect(engine.__overlayForTest()!.entities.vehicle??{}).toEqual({});
});
it('local settlement hashes the actual grant aggregate, excludes synthetic grants and blocks open periods and duplicates',async()=>{
 const g={grantId:'ENT-1',vin:'VIN-1',catalogId:'CAT-1',kind:'구독',status:'ACTIVE',validFrom:'2026-10-01',validTo:'2026-10-31',acceptedAt:null,convertedAt:null,source:'DEMO'};
 put('entitlements',{items:[g,{...g,grantId:'ENT-2',vin:'FAKE',source:'SYNTHETIC'}]});put('listProducts',{items:[{catalogId:'CAT-1',name:'실제 상품명'}]});
 await expect(run('sendSettlement','operator',{period:'2026-11',reason:'미종료 기간'})).rejects.toMatchObject({code:'GUARD_FAILED'});
 const r=await run('sendSettlement','operator',{period:'2026-10',reason:'로컬 묶음 검토'});expect(r).toMatchObject({deliveryMode:'LOCAL_DEMO',externalTransmissionPerformed:false,totals:{subscriptionVehicles:1,subscriptionDays:31}});expect(r.receiptId).toMatch(/^LOCAL-DEMO-/);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(r.payload))))].map(x=>x.toString(16).padStart(2,'0')).join('');expect(r.payloadSha256).toBe(hash);
 expect((await run('settlementUsage','viewer',undefined,{}, {period:'2026-10'})).sent.transmissionId).toBe(r.transmissionId);
 await expect(run('sendSettlement','operator',{period:'2026-10',reason:'중복 시도'})).rejects.toMatchObject({code:'CONFLICT'});expect((await run('settlementTransmissions','viewer')).items).toHaveLength(1);
});
it('EOL decisions use the captured scan comparison, preserve source facts and refuse unverified release evidence',async()=>{
 const vin='KMH-NX4-0001',scan={vin,plant:'TMA',scannedAt:'2026-11-01T00:00:00Z',orderEcus:[{ecuPno:'ECU-1',hwRevision:'A'}],builtEcus:[{ecuPno:'ECU-1',hwRevision:'B'}],checks:[],lastCheck:null,acceptance:{summary:{accepted:0,total:1}}};
 put('eolVehicle',scan,{vin});put('eolMismatches',{items:[{...scan,verdict:'MISMATCH',status:'QUALITY_HOLD'}],summary:{total:1,hold:1,unconfirmed:0,match:0,shippedWithMismatch:0}});
 const body={vin,decision:'REWORK',cause:'개정 불일치',reason:'품질 보류 검토'};
 await expect(run('createEolCheck','viewer',body)).rejects.toMatchObject({code:'FORBIDDEN'});
 const made=await run('createEolCheck','steward',body);expect(made).toMatchObject({source:'LOCAL_SIMULATION',factoryRecordUpdated:false});
 expect((await run('eolVehicle','viewer',undefined,{vin})).status).toBe('REWORK');
 await expect(run('createEolCheck','steward',{...body,decision:'RELEASE'})).rejects.toMatchObject({code:'GUARD_FAILED'});
 await expect(run('createEolCheck','steward',{...body,decision:'RELEASE',shippedEvidence:'입력된 출고 근거'})).rejects.toMatchObject({code:'GUARD_FAILED'});
 await run('createEolCheck','steward',{...body,decision:'RELEASE',recheckResult:'PASS',reworkRef:'RW-DEMO-1'});
 const detail=await run('eolVehicle','viewer',undefined,{vin});expect(detail).toMatchObject({status:'RECHECK_PASSED',verdict:'MISMATCH',scannedAt:scan.scannedAt,orderEcus:scan.orderEcus,builtEcus:scan.builtEcus,acceptance:scan.acceptance});expect(detail.checks).toHaveLength(2);
 const list=await run('eolMismatches','viewer');expect(list.items[0].status).toBe('RECHECK_PASSED');expect(list.summary.shippedWithMismatch).toBe(0);
});
it('gate preview returns schema/rule findings without updating the ledger or attesting unavailable native approval signatures',async()=>{
 const before=JSON.stringify(engine.__overlayForTest()?.data.killLedger??{});
 const bad=await run('gatePreview','operator',{type:'invalid'});expect(bad).toMatchObject({result:'SCHEMA_FAIL',ledgerChanged:false});
 const v=await run('gatePreview','operator',command);expect(v).toMatchObject({result:'FAIL',approvalVerification:'UNVERIFIED_OFFLINE',ledgerChanged:false});expect(v.findings.find((f:any)=>f.rule==='FFG-PLT-005')).toMatchObject({ok:false});
 expect(JSON.stringify(engine.__overlayForTest()?.data.killLedger??{})).toBe(before);expect(engine.__overlayForTest()!.entities.publication??{}).toEqual({});
});
