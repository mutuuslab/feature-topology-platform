import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { ROUTES,routeUrl,snapshotFile } from '@ff/contracts';
const id='FEAT-00022',ver='1.0.0',files=new Map<string,unknown>();
const feature={featureId:id,version:ver,name:'시험 기능',lifecycle:'PROPOSED',country:'KR',asil:'QM',ownerId:'ADAS기획팀',requirementIds:['REQ-1'],controlPoints:[],dependencyIds:[],featureRefs:[],functions:[],swIds:[],swVersions:[],ecuPnos:[],tags:[],_missing:{}};
let sim:typeof import('../api/sim'),engine:typeof import('../api/sim/engine');
const run=(name:string,role:string,body?:unknown,params:Record<string,string>={},query:Record<string,unknown>={})=>sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,params,query as any),{role,body,params});
const put=(name:string,body:unknown,params:Record<string,string>={},query:Record<string,unknown>={})=>files.set('/'+snapshotFile(routeUrl(name,params,query as any)),body);
beforeEach(async()=>{
 vi.resetModules();vi.stubEnv('VITE_DATA_MODE','static');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-09T02:00:00Z'));localStorage.clear();files.clear();
 put('listFeatures',{items:[{...feature,isLatest:true}]},{},{latestOnly:false});put('featureDetail',{feature,meta:{createdBy:'usr-author'},gates:{},versions:[{version:ver}],dependencies:{outgoing:[],incoming:[]}},{id,ver});
 put('featureTrace',{feature,links:[],requirements:[{reqId:'REQ-1'}],evidence:[]},{id});
 put('traceSourceLookup',{found:true,element:{elementType:'HIL',name:'내장 시험',version:'1.0.0'}},{},{kind:'TEST_CASE',elementId:'TC-1'});
 put('accounts',{items:['steward','quality','integrator','author'].map(n=>({id:'usr-'+n,state:'ACTIVE'}))});
 vi.stubGlobal('fetch',vi.fn(async(u:string)=>new Response(JSON.stringify(files.get(u)??{items:[]}),{headers:{'Content-Type':'application/json'}})));
 sim=await import('../api/sim');engine=await import('../api/sim/engine');
});
afterEach(()=>{engine?.__resetSimForTest();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('trace links and append-only Test Evidence recompute coverage, keep unlink history and reject invalid source/duplicates/future times',async()=>{
 const req=await run('createTraceLink','author',{featureId:id,kind:'REQUIREMENT',elementId:'REQ-1',elementType:'SYSTEM',sourceSystem:'CODEBEAMER'});expect(req.existence).toBe('NOT_CHECKED');
 const b={featureId:id,kind:'TEST_CASE',elementId:'TC-1',elementType:'HIL',sourceSystem:'TMS',required:true};
 const tc=await run('createTraceLink','author',b);expect(tc).toMatchObject({existence:'VERIFIED',sourceRef:'CAPTURED_SOURCE:TMS:TC-1'});
 await expect(run('createTraceLink','author',b)).rejects.toMatchObject({code:'CONFLICT'});
 await expect(run('createTraceLink','author',{...b,elementId:'TC-UNKNOWN'})).rejects.toMatchObject({code:'GUARD_FAILED'});
 expect((await run('featureTrace','viewer',undefined,{id})).coverage).toMatchObject({requirement:{ratio:1},test:{required:1,withEvidence:0},missingRequiredEvidence:true});
 const ev={evidenceId:'EV-1',executedAt:'2026-11-08T00:00:00Z',result:'PASS',environment:'로컬 HIL 시연'};
 await expect(run('createTestEvidence','quality',{...ev,executedAt:'2030-01-01T00:00:00Z'},{id:tc.linkId})).rejects.toMatchObject({code:'VALIDATION'});
 await run('createTestEvidence','quality',ev,{id:tc.linkId});await expect(run('createTestEvidence','quality',ev,{id:tc.linkId})).rejects.toMatchObject({code:'CONFLICT'});
 expect((await run('featureTrace','viewer',undefined,{id})).coverage.test).toMatchObject({required:1,withEvidence:1,ratio:1});
 await run('unlinkTraceLink','author',{reason:'다른 시험으로 대체'},{id:tc.linkId});
 const result=await run('featureTrace','viewer',undefined,{id});expect(result.links.find((l:any)=>l.linkId===tc.linkId).status).toBe('UNLINKED');expect(result.evidence).toHaveLength(1);
 await expect(run('createTestEvidence','quality',{...ev,evidenceId:'EV-2'},{id:tc.linkId})).rejects.toMatchObject({code:'CONFLICT'});
 expect((await run('traceLinks','viewer',undefined,{}, {status:'ALL'})).items).toHaveLength(2);
});
const rule={ruleId:'CR-DEMO-001',name:'로컬 배포 규칙',type:'SAFETY',scope:{markets:['KR'],featureIds:[id]},criteria:[{check:'SAFE_DEFAULT_OFF'}],approverIds:['usr-quality'],evidence:{docName:'시연 검토 근거'},validFrom:'2026-01-01',validTo:'2030-01-01'};
it('compliance keeps versions and review history, enforces owner/designated independence, and withdraws approvals on revision',async()=>{
 await expect(run('createComplianceRule','steward',{...rule,approverIds:['usr-steward']})).rejects.toMatchObject({code:'VALIDATION'});
 await run('createComplianceRule','steward',rule);await expect(run('createComplianceRule','steward',rule)).rejects.toMatchObject({code:'CONFLICT'});
 await run('requestComplianceApproval','steward',{note:'독립 검토 요청'},{id:rule.ruleId});
 await expect(run('decideComplianceRule','steward',{decision:'APPROVE',reason:'본인 승인'},{id:rule.ruleId})).rejects.toMatchObject({code:'SEPARATION_OF_DUTY'});
 await expect(run('decideComplianceRule','integrator',{decision:'APPROVE',reason:'대상자 외 승인'},{id:rule.ruleId})).rejects.toMatchObject({code:'FORBIDDEN'});
 expect((await run('decideComplianceRule','quality',{decision:'APPROVE',reason:'검토 완료'},{id:rule.ruleId})).status).toBe('APPROVED');
 await expect(run('updateComplianceRule','quality',{name:'소유자 외 수정',reason:'수정 시도'},{id:rule.ruleId})).rejects.toMatchObject({code:'FORBIDDEN'});
 const next=await run('updateComplianceRule','steward',{criteria:[{check:'REQUIREMENT_TRACE'}],reason:'검증 기준 개정'},{id:rule.ruleId});expect(next).toMatchObject({version:'2.0',status:'PROPOSED',decidedBy:null});
 await run('requestComplianceApproval','steward',{note:'개정 검토 요청'},{id:rule.ruleId});
 await run('updateComplianceRule','steward',{name:'로컬 배포 규칙 개정',reason:'명칭 보완'},{id:rule.ruleId});
 const d=await run('complianceRule','viewer',undefined,{id:rule.ruleId});expect(d.versions).toHaveLength(3);expect(d.versions[0].status).toBe('APPROVED');expect(d.requests.some((q:any)=>q.status==='WITHDRAWN')).toBe(true);expect(d.changes.length).toBeGreaterThan(3);
 expect((await run('complianceRules','viewer')).items).toContainEqual(expect.objectContaining({ruleId:rule.ruleId,status:'PROPOSED'}));
});

it('expiry stays scheduled beyond the browser timer limit and retires once at its actual due time',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-09T02:00:00Z'));
 await run('createComplianceRule','steward',{...rule,validTo:'2027-02-01'});
 await vi.advanceTimersByTimeAsync(2_147_483_647);
 expect((await run('complianceRule','viewer',undefined,{id:rule.ruleId})).rule.status).toBe('PROPOSED');
 expect(engine.__overlayForTest()!.tasks.some(t=>t.kind==='local.compliance.expire')).toBe(true);
 await vi.advanceTimersByTimeAsync(Date.parse('2027-02-02T00:00:00Z')-Date.now());
 expect((await run('complianceRule','viewer',undefined,{id:rule.ruleId})).rule.status).toBe('RETIRED');
 expect(engine.__overlayForTest()!.audit.filter(a=>a.action==='COMPLIANCE_RULE_RETIRE')).toHaveLength(1);
});

it('operational actions keep history and refuse closing without newly measured effect',async()=>{
 const f={findingId:'FND-1',featureId:id,version:ver,status:'DETECTED',severity:'ACTION',axis:'OPERATION',cause:'status_rejected_rate',dueAt:'2026-11-12T00:00:00Z',detectedAt:'2026-11-08T00:00:00Z',actions:[],effect:null,history:[],evidence:{indicators:[{name:'status_rejected_rate',current:0.1}]},repeats:0};
 put('featureHealthFinding',f,{id:'FND-1'});put('featureHealth',{connected:true,asOf:'2026-11-08T00:00:00Z',rows:[{featureId:id,version:ver,openFindings:1,overdue:0}],findings:[f]});
 await run('moveFinding','operator',{to:'ANALYZING',note:'원인 분석 시작'},{id:f.findingId});
 await expect(run('moveFinding','operator',{to:'ACTING',note:'조치 연결 없음'},{id:f.findingId})).rejects.toMatchObject({code:'GUARD_FAILED'});
 await run('moveFinding','operator',{to:'ACTING',note:'기존 조치 연결',action:{kind:'JIRA',ref:'FFP-1',title:'기록된 결함 조치'}},{id:f.findingId});
 await run('moveFinding','operator',{to:'VERIFYING',note:'효과 측정 대기'},{id:f.findingId});
 await expect(run('moveFinding','operator',{to:'CLOSED',note:'근거 없는 종료'},{id:f.findingId})).rejects.toMatchObject({code:'GUARD_FAILED'});
 const saved=await run('featureHealthFinding','viewer',undefined,{id:f.findingId});expect(saved.effect).toMatchObject({after:null,met:null,samples:null});expect(saved.history).toHaveLength(3);
 expect((await run('featureHealth','viewer')).findings[0].status).toBe('VERIFYING');
});
it('bill-of-features computes a real catalogue constraint result instead of ACCEPTED',async()=>{
 const result=await run('checkBillOfFeatures','commerce',{country:'KR',vehicleModel:'NX4',trim:'Premium',type:'PACKAGE',baselineIds:['BL-NOT-EXISTS']});
 expect(result.result).toBe('FAIL');expect(result.issues.length).toBeGreaterThan(0);expect(result).not.toHaveProperty('status','ACCEPTED');
});
