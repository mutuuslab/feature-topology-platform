// 공개 시연 사이트의 브라우저 안 쓰기 — registry 묶음(api/sim/handlers/registry, 설계 20-60).
// 제안(Feature 등록) → 안전 분류 확정 → 분석 근거(HARA) → Gate 판정 → 정의 승인(자동 개발 착수), Release Sign-off → 출시, Baseline 요청·결정,
// Feature DB 추가 요청·변경 요청 → 도메인 검토 → 승인(직무 분리 SOD-13·14·15) → 발행, 업무 절차 활동 완료·취소를 서버와 같은 규칙으로 보는지 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile, computeCompleteness } from '@ff/contracts';

const url = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => routeUrl(name, params, query as Record<string, string>);
const GATE = (id: string, ver: string, g: string, n: number) => ({ gateRecordId: `SIM-${g}-${String(n).padStart(6, '0')}`, featureId: id, featureVersion: ver, country: 'KR', gate: g, gateName: g, inputResult: 'PASS', rationale: '이관', evidenceRef: `EV-${g}`, judgeRole: '판정', judgedAt: '2026-03-03T09:00:00+09:00', status: 'PASS', gateStageLifecycle: 'PROPOSED', currentLifecycle: 'VERIFIED', transitionNote: '', _missing: {} });
const ROW = (o: Record<string, unknown>) => ({
  description: '설명',
  requirementIds: ['REQ-1'],
  country: 'KR',
  vehicleModel: 'NX4 PE',
  trim: 'Premium',
  baselineId: null,
  ownerId: 'UX기획팀',
  tags: [],
  asil: 'QM',
  upgVc: ['F111A111001'],
  functions: [{ functionId: 'FUNC-000004', label: 'SVM' }],
  swIds: ['SW-SVM'],
  swVersions: ['1.0.0'],
  ecuPnos: ['99211-NX400'],
  controlPoints: ['Signal'],
  dependencyIds: [],
  catalogIds: [],
  gateRecordIds: [],
  _missing: {},
  featureRefs: [{ refId: 'AD-PRK-004', role: 'PRIMARY', refVersion: 'v1.3' }],
  ...o,
});
const F144 = ROW({ featureId: 'FEAT-00144', name: '서라운드 뷰 모니터', version: '3.3.0', lifecycle: 'VERIFIED', baselineId: 'BL-00162' });
const F13 = ROW({ featureId: 'FEAT-00013', name: '예측 공조', version: '0.3.0', lifecycle: 'PROPOSED', functions: [], swIds: [], swVersions: [], ecuPnos: [], featureRefs: [{ refId: 'AD-PRK-005', role: 'PRIMARY', refVersion: 'v1.3' }] });
const gates144 = Object.fromEntries(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'].map((g, i) => [g, GATE('FEAT-00144', '3.3.0', g, 100 + i)]));
const summary = (f: any, gates: Record<string, any>) => ({ featureId: f.featureId, version: f.version, isLatest: true, name: f.name, country: f.country, vehicleModel: f.vehicleModel, trim: f.trim, lifecycle: f.lifecycle, baselineId: f.baselineId, ownerId: f.ownerId, asil: f.asil, tags: f.tags, controlPoints: f.controlPoints, featureRefCount: 1, gates: Object.fromEntries(Object.entries(gates).map(([g, r]) => [g, r.status])) });
const REF = (refId: string, o: Record<string, unknown> = {}) => ({ refId, status: 'ACTIVE', replacedBy: null, registeredIn: 'v0.5', evidenceCheckedAt: '2026-09-20', domain: 'ADAS & AD', cluster: 'Parking', component: 'Parking assistance', swStack: 'Application', lifecycle: 'Commodity', techStack: 'Automotive', vehicleType: '공통', region: '글로벌', nameEn: 'Surround view', nameKo: '서라운드 뷰', aliases: [], autoQuality: 'High', techQuality: 'High', asilRep: 'QM', method: 'Parametric', tshirt: 'L', bundleId: null, bundleRep: null, sizeEvidenceGrade: 'D', relevance: 'High', sourceIds: ['S20'], sourceDetail: 'ISO 16505', remark: '', basisType: '표준 기반 도출', duplicateOf: null, requires: [], excludes: [], procurement: '협력사 개발', swPackage: '', licenseItem: '', billing: '', definition: null, adminMemo: '', ...o });
const CHANGE = (changeId: string, refId: string, reviewer: string, opinion = 'AGREE') => ({ changeId, kind: 'MODIFY', refId, before: { tshirt: 'L' }, after: { tshirt: 'M' }, reason: '사내 실적 반영', requestedBy: 'usr-author', requestedAt: '2026-11-06T02:15:18.974Z', status: 'REVIEW', reviews: [{ reviewerId: reviewer, opinion, comment: '검토', at: '2026-11-06T02:15:19.000Z' }], decision: null, release: null, checks: [], awaitingPublish: false, domain: 'ADAS & AD' });
const usedBy144 = [{ featureId: 'FEAT-00144', version: '3.3.0', role: 'PRIMARY', refVersion: 'v1.3', lifecycle: 'VERIFIED', name: '서라운드 뷰 모니터', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }];

const PROFILE144 = {
  featureId: 'FEAT-00144', version: '3.3.0', status: 'CONFIRMED', source: 'MANUAL', fClass: 'F1', deactClass: 'DC1', regClass: 'R0', flagType: 'OPS', adsFeature: false, adsfType: null, gsrMandatory: false,
  itemIds: [], haraRef: null, asilRef: 'QM', safetyGoalIds: [], safeState: null, endState: null, takeoverMs: 0, rampMs: 0, faultRampMs: 0, faultTolerantTimeMs: 0, maxPendingMs: 600000, maxCycleWaitMs: 28800000,
  maxActivationScope: { vehicles: 50000, perWindow: 5000 }, markets: ['KR'], rxswin: [], approvalProfile: null, evidenceManifestId: null, sbomRef: null, rollbackTarget: null, expiresAt: null, retirementPlan: null,
  confirmedBy: 'usr-quality', confirmedAt: '2026-11-01T00:00:00.000Z', confirmSig: 'sig',
};
const SNAP: Record<string, unknown> = {
  [url('almWorkProducts', { id: 'FEAT-00144', ver: '3.3.0' })]: { featureId: 'FEAT-00144', version: '3.3.0', gateMode: 'warn', items: [] },
  [url('auditChain')]: { ok: true, verified: 10, head: 'bb'.repeat(32), checkedAt: '2026-11-06T01:00:00.000Z' },
  [url('events', {}, { limit: 500, recent: '1' })]: { items: [{ seq: 41, id: 'e41', type: 'x', at: '2026-11-06T00:00:00.000Z', aggregate: 'A', componentId: null, payload: {} }] },
  [url('audit', {}, { limit: 500 })]: { items: [{ id: 233, at: '2026-11-06T00:00:00.000Z', actorId: 'usr-author', actorRole: 'FEATURE_AUTHOR', action: 'X', target: 'Y', result: 'ALLOWED', reason: null, before: null, after: null, correlationId: null, componentId: null }], nextCursor: null },
  [url('notifications', {}, { limit: 200 })]: { items: [], unread: 0, byCategory: {} },
  [url('listFeatures', {}, { latestOnly: false })]: { total: 2, items: [summary(F144, gates144), summary(F13, {})], nextCursor: null, facets: {} },
  [url('featureDetail', { id: 'FEAT-00144', ver: '3.3.0' })]: { feature: F144, meta: { createdBy: null, createdAt: null }, gates: gates144, dependencies: { outgoing: [], incoming: [] }, functions: [], trace: [], baseline: null, products: [], pendingBaselineRequest: null, transitions: [], versions: [{ version: '3.3.0', lifecycle: 'VERIFIED', baselineId: 'BL-00162' }] },
  [url('gates', { id: 'FEAT-00144', ver: '3.3.0' })]: { gates: Object.values(gates144).map((r: any) => ({ gate: r.gate, latest: r, decision: { state: 'IMPORTED', reason: null }, status: 'PASS', history: [r] })), lifecycle: 'VERIFIED', rehara: [] },
  [url('releaseSignoff', { id: 'FEAT-00144', ver: '3.3.0' })]: { signoff: null, valid: false, stale: false },
  [url('safetyProfile', { id: 'FEAT-00144', ver: '3.3.0' })]: { profile: PROFILE144, findings: [], asil: { conditions: [{ id: 'TOOL_CONFIDENCE', met: true }] } },
  [url('featureDetail', { id: 'FEAT-00013', ver: '0.3.0' })]: { feature: F13, meta: { createdBy: null, createdAt: null }, gates: {}, dependencies: { outgoing: [], incoming: [] }, functions: [], trace: [], baseline: null, products: [], pendingBaselineRequest: null, transitions: [], versions: [{ version: '0.3.0', lifecycle: 'PROPOSED', baselineId: null }] },
  [url('refDetail', { refId: 'AD-PRK-004' })]: { ref: REF('AD-PRK-004'), usedBy: usedBy144 },
  [url('refDetail', { refId: 'AD-PRK-005' })]: { ref: REF('AD-PRK-005', { nameKo: '주차 경고' }), usedBy: [] },
  [url('listRefs', {}, { limit: 200 })]: { items: [REF('AD-PRK-001'), REF('AD-PRK-002'), REF('AD-PRK-004'), REF('AD-PRK-005', { nameKo: '주차 경고' })], total: 4, offset: 0, limit: 200 },
  [url('refDetail', { refId: 'AD-PRK-001' })]: { ref: REF('AD-PRK-001'), usedBy: [] },
  [url('refDetail', { refId: 'AD-PRK-002' })]: { ref: REF('AD-PRK-002'), usedBy: [] },
  [url('masterSw')]: { items: [{ swId: 'SW-SVM', version: '1.0.0', ecuPno: '99211-NX400', safetyClass: 'F1', lifecycle: 'RELEASED' }] },
  [url('masterEcu')]: { items: [{ ecuPno: '99211-NX400', lifecycle: 'ACTIVE' }] },
  [url('refTaxonomy')]: { items: [{ nodeId: 'AD', level: 'DOMAIN', parentId: null, nameEn: 'ADAS & AD', abbr: 'AD' }, { nodeId: 'AD/Parking assistance', level: 'COMPONENT', parentId: 'AD', nameEn: 'Parking assistance', abbr: 'PRK', abbrs: ['PRK'], clusterIds: ['AD:Parking'] }, { nodeId: 'AD:Parking', level: 'CLUSTER', parentId: 'AD', nameEn: 'Parking', abbr: null }] },
  [url('refSources')]: { items: [{ sourceId: 'S20', title: 'ISO 16505', checkedAt: null, nextReviewAt: null, usedBy: 3 }], noNextReview: 1 },
  [url('refReleases')]: { items: [{ release: 'v1.4' }] },
  [url('listRefChanges')]: { items: [CHANGE('CR-2026-006', 'AD-PRK-004', 'usr-approver'), CHANGE('CR-2026-007', 'AD-PRK-005', 'usr-steward'), CHANGE('CR-2026-008', 'AD-PRK-005', 'usr-approver', 'REVISE')], total: 3 },
  [url('refChangeDetail', { id: 'CR-2026-006' })]: { change: CHANGE('CR-2026-006', 'AD-PRK-004', 'usr-approver') },
  [url('refChangeDetail', { id: 'CR-2026-007' })]: { change: CHANGE('CR-2026-007', 'AD-PRK-005', 'usr-steward') },
  [url('refChangeDetail', { id: 'CR-2026-008' })]: { change: CHANGE('CR-2026-008', 'AD-PRK-005', 'usr-approver', 'REVISE') },
  [url('baselineRequests')]: { items: [] },
  [url('baselines')]: { items: [{ baselineId: 'BL-00162', featureId: 'FEAT-00144', version: '3.3.0', snapshot: { lifecycle: 'VERIFIED' }, products: [] }] },
  [url('procedureState')]: { items: [], done: [], updatedAt: null },
  [url('dependencies')]: { items: [] },
  [url('listPolicies')]: { items: [{ policyId: 'POL-00007', flagKey: 'svm_view_flag', featureId: 'FEAT-00144', featureVersion: '3.3.0', status: 'DEPLOYED' }] },
  [url('flagRetirements')]: { items: [], steps: [] },
};
const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
const html = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
const byFile = new Map(Object.entries(SNAP).map(([u, v]) => ['/' + snapshotFile(u), v]));

let sim: typeof import('../api/sim');
let engine: typeof import('../api/sim/engine');
const R = (name: string) => ROUTES.find((r) => r.name === name)!;
const run = (name: string, role: string, o: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; actorRole?: any } = {}) =>
  sim.simCall<any>(R(name), url(name, o.params, o.query), { params: o.params, body: o.body, role, actorRole: o.actorRole });
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { status: number; code: string; message: string; details?: any };
  }
  throw new Error('거부되어야 합니다');
};
const audits = () => engine.__overlayForTest()!.audit;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (byFile.has(u) ? json(byFile.get(u)) : html())));
  localStorage.clear();
  byFile.clear(); for(const [u,v] of Object.entries(SNAP)) byFile.set('/'+snapshotFile(u),structuredClone(v));
  sim = await import('../api/sim');
  engine = await import('../api/sim/engine');
  await sim.simReady(); await import('../api/sim/handlers/local-feature-relations');
});
afterEach(() => {
  engine.__resetSimForTest();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const CREATE = { name: '후방 주차 안내', description: '후방 카메라 주차 안내', requirementIds: ['REQ-PARK-0201'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Exclusive', ownerId: 'Parking기획팀', asil: 'QM', tags: ['parking'], upgVc: ['F111A111001'], controlPoints: ['Flag'], featureRefs: [{ refId: 'AD-PRK-004', role: 'PRIMARY' }] };
const pass = (gate: string, extra: Record<string, unknown> = {}) => ({ gate, inputResult: 'PASS', rationale: `${gate} 통과`, evidenceRef: `EV-${gate}`, ...extra });


const nativeP={id:'FEAT-00144',ver:'3.3.0'};
const set=(name:string,v:any,p:Record<string,string>={},q:Record<string,unknown>={})=>byFile.set('/'+snapshotFile(url(name,p,q)),v);
const mockItems=()=>[
 ['CB-1','SYS_REQ',[]],['CB-2','SYS_ARCH',[['CB-1','allocated']]],['CB-3','SW_REQ',[['CB-1','derived']]],['CB-4','SW_ARCH',[['CB-3','allocated']]],['CB-5','SW_DD',[['CB-4','refines']]],['CB-6','TEST_SPEC',[['CB-1','verifies'],['CB-2','verifies'],['CB-3','verifies'],['CB-4','verifies'],['CB-5','verifies']]]
].map(([key,kind,rels]:any)=>({system:'CODEBEAMER',key,kind:'REQUIREMENT',title:'Synthetic '+kind,body:'Synthetic',status:'Approved',revision:1,updatedBy:'demo',updatedAt:'2026-11-10T00:00:00Z',comments:[],fields:{ffFeatureId:'FEAT-00144',wpKind:kind,reqId:kind==='SYS_REQ'?'REQ-1':null,ffVersion:null,relations:rels.map(([to,kind]:any)=>({to,kind}))}}));
function arrange(mode='enforce', items=mockItems()){
 const fetched=items.map(i=>({key:i.key,kind:i.fields.wpKind,title:i.title,status:i.status,approved:i.status==='Approved',version:i.revision,ffVersion:null,reqId:i.fields.reqId}));
 const relations=items.flatMap(i=>i.fields.relations.map((r:any)=>({...r,from:i.key,suspect:false})));
 const result=computeCompleteness({featureId:nativeP.id,version:nativeP.ver,ctx:{asil:'QM',cyber:false},items:fetched,relations});
 set('almWorkProducts',{featureId:nativeP.id,version:nativeP.ver,gateMode:mode,result,items:fetched,hash:'original-native-hash',evidence:[],changes:[],requirementCheck:{missing:[],unlisted:[]},signature:'native-original'},nativeP);
 set('extSync',{items:[{system:'CODEBEAMER',mode:'mock',pending:0}]});set('mockExtItems',{items},{system:'codebeamer'});set('almRejudge',{items:[]},{},{status:'OPEN'});
 set('analysisEvidence',{current:{},history:[],g7:[],asilDeviation:null},nativeP);
}
async function localAt(lifecycle:string){
 const f=await run('createFeature','author',{body:CREATE}),p={id:f.featureId,ver:f.version};
 engine.__overlayForTest()!.entities.regFeature[p.id+'@'+p.ver].row={...f,lifecycle,requirementIds:['REQ-1'],functions:F144.functions,swIds:F144.swIds,swVersions:F144.swVersions,ecuPnos:F144.ecuPnos};
 if(lifecycle!=='PROPOSED'){
  const o=engine.__overlayForTest()!,key=p.id+'@'+p.ver;o.entities.regSafety??={};o.entities.regSafety[key]={...PROFILE144,featureId:p.id,version:p.ver};
  o.data.regGates??={};o.data.regGates[key]=['G1','G2','G3','G4','G5','G6','G7'].map((g,i)=>({record:GATE(p.id,p.ver,g,i+1),decision:{state:'IMPORTED'}}));
 }
 set('listPolicies',{items:[{policyId:'POL-SYNTHETIC',featureId:p.id,featureVersion:p.ver,controlPoint:'Flag',status:'APPROVED'}]});
 const items=byFile.get('/'+snapshotFile(url('mockExtItems',{system:'codebeamer'}))).items;for(const i of items)i.fields.ffFeatureId=p.id;
 return p;
}
async function context(p:Record<string,string>){
 const o=engine.__overlayForTest()!;return {overlay:o,actor:{id:'usr-approver',role:'FEATURE_APPROVER',persona:'approver'},req:{params:p},now:()=>new Date(),
 snapshot:async(n:string,a:Record<string,string>={},q:Record<string,unknown>={})=>structuredClone(byFile.get('/'+snapshotFile(url(n,a,q)))??null),
 read:async(n:string,a:Record<string,string>={},q:Record<string,unknown>={})=>run(n,'approver',{params:a,query:q}),
 get:(c:string,id:string)=>o.entities[c]?.[id],list:(c:string)=>Object.values(o.entities[c]??{})} as any;
}
async function blockers(p:Record<string,string>,to:any){const row=engine.__overlayForTest()!.entities.regFeature?.[p.id+'@'+p.ver]?.row??F144;return (await import('../api/sim/handlers/local-feature-relations')).localAlmTransitionBlockers(await context(p),row,to);}
const input=(gate:string)=>({gate,inputResult:'PASS',rationale:'Synthetic guarded decision',evidenceRef:'EV-DEMO'});

it.each(['warn','off'])('retains actual %s mode and ordinary lifecycle behavior',async mode=>{
 arrange(mode);const p=await localAt('PROPOSED');byFile.delete('/'+snapshotFile(url('mockExtItems',{system:'codebeamer'})));expect(await blockers(p,'APPROVED')).toEqual([]);
 const d=await run('featureDetail','approver',{params:p});expect(d.transitions[0].blockers.every((b:any)=>b.code!=='WORK_PRODUCT')).toBe(true);
});
it('blocks G2 PASS after existing safety/analysis prerequisites when actual required products are absent',async()=>{
 arrange('enforce',[]);const p=await localAt('PROPOSED');await run('judgeGate','quality',{params:p,body:input('G1')});await run('confirmSafetyProfile','quality',{params:p,body:{reason:'Confirm synthetic safety'}});
 const h=await run('recordHara','quality',{params:p,body:{docId:'HARA-DEMO',asil:'QM',safetyGoals:[{id:'SG-1',text:'Synthetic safe behavior',asil:'QM'}],reason:'Synthetic analysis'}});
 const f=await fails(run('judgeGate','quality',{params:p,body:{...input('G2'),evidenceRef:h.recordId}}));expect(f).toMatchObject({code:'GUARD_FAILED',details:{blockers:expect.arrayContaining([expect.objectContaining({code:'WORK_PRODUCT',ref:'G2'})])}});
 expect(engine.__overlayForTest()!.data.regGates[p.id+'@'+p.ver].some((x:any)=>x.record.gate==='G2')).toBe(false);
});
it.each([['G5','DEVELOPING'],['G8','VERIFIED']])('blocks actual %s PASS, not just its preview',async(gate,stage)=>{
 arrange('enforce',[]);const p=await localAt(stage);const f=await fails(run('judgeGate','quality',{params:p,body:input(gate)}));expect(f.code).toBe('GUARD_FAILED');expect(f.details.blockers.some((b:any)=>b.code==='WORK_PRODUCT'&&b.ref===gate)).toBe(true);
});
it('uses identical stage blockers in preview and actual manual transition with valid Gates/signoff',async()=>{
 arrange('enforce',[]);await run('signRelease','author',{params:nativeP,body:{reason:'Independent synthetic release confirmation'}});
 const d=await run('featureDetail','coordinator',{params:nativeP}),b=d.transitions.find((t:any)=>t.to==='RELEASED').blockers;expect(b.some((v:any)=>v.code==='WORK_PRODUCT')).toBe(true);
 const f=await fails(run('transition','coordinator',{params:nativeP,body:{to:'RELEASED',reason:'Attempt bypass'}}));expect(f.details.blockers).toEqual(b);expect((await run('featureDetail','coordinator',{params:nativeP})).feature.lifecycle).toBe('VERIFIED');
});
it('checks declared requirements against actual SYS_REQ identifiers before APPROVED',async()=>{
 arrange();const p=await localAt('PROPOSED');engine.__overlayForTest()!.entities.regFeature[p.id+'@'+p.ver].row.requirementIds=['REQ-NOT-IN-CB'];expect((await blockers(p,'APPROVED')).some(x=>x.message.includes('REQ-NOT-IN-CB'))).toBe(true);
});
it('blocks auto-advance on actual OPEN rejudge after accepting an unrelated valid decision',async()=>{
 arrange();const p=await localAt('APPROVED');set('almRejudge',{items:[{rejudgeId:42,featureId:p.id,version:p.ver,gate:'G2',itemKey:'CB-1',itemTitle:'Synthetic',fromVersion:1,toVersion:2,status:'OPEN'}]},{},{status:'OPEN'});
 const g=await run('judgeGate','quality',{params:p,body:{...input('G1'),inputResult:'CONDITIONAL'}});expect(g.feature.lifecycle).toBe('APPROVED');expect((await blockers(p,'DEVELOPING')).some(b=>b.code==='REJUDGE_OPEN')).toBe(true);
});
it('rechecks actual mock revisions instead of trusting a saved complete view',async()=>{
 arrange();const p=await localAt('DEVELOPING');await run('refreshAlmWorkProducts','integrator',{params:p,body:{}});
 await run('mockExtAct','integrator',{params:{system:'codebeamer'},body:{key:'CB-3',action:'TRANSITION',status:'Draft',externalUser:'demo',deliver:false}});
 const f=await fails(run('judgeGate','quality',{params:p,body:input('G5')}));expect(f.details.blockers.some((b:any)=>b.code==='WORK_PRODUCT')).toBe(true);
});
it('writes actual computed Gate evidence and closes only same-gate rejudges in the accepted transaction',async()=>{
 arrange();const p=await localAt('DEVELOPING');set('almRejudge',{items:[{rejudgeId:42,featureId:p.id,version:p.ver,gate:'G5',itemKey:'CB-3',itemTitle:'Synthetic',fromVersion:0,toVersion:1,status:'OPEN'},{rejudgeId:43,featureId:p.id,version:p.ver,gate:'G8',itemKey:'CB-6',itemTitle:'Synthetic',fromVersion:0,toVersion:1,status:'OPEN'}]},{},{status:'OPEN'});
 const g=await run('judgeGate','quality',{params:p,body:input('G5')});const o=engine.__overlayForTest()!;const ev=o.entities.localAlmWorkProducts[p.id+'@'+p.ver].view.evidence.find((e:any)=>e.gate==='G5');expect(ev.gateRecordId).toBe(g.record.gateRecordId);expect(ev.hash).toMatch(/^[a-f0-9]{64}$/);expect(ev.items).toHaveLength(6);expect(o.entities.localAlmRejudge['42'].status).toBe('RESOLVED');expect(o.entities.localAlmRejudge['43']).toBeUndefined();expect(g.feature.lifecycle).toBe('DEVELOPING');
});
it('fails closed on absent global/open source while leaving captured native evidence unchanged',async()=>{
 arrange();await run('listFeatures','author');const original=structuredClone(byFile.get('/'+snapshotFile(url('almWorkProducts',nativeP))));byFile.delete('/'+snapshotFile(url('almRejudge',{}, {status:'OPEN'})));
 expect((await blockers(nativeP,'RELEASED')).some(b=>b.ref==='ALM_SOURCE')).toBe(true);expect(byFile.get('/'+snapshotFile(url('almWorkProducts',nativeP)))).toEqual(original);
});

it('prevents automatic DEVELOPING→VERIFIED on the same incomplete stage that blocks manual preview',async()=>{
 arrange('enforce',[]);const p=await localAt('DEVELOPING');const g=await run('judgeGate','quality',{params:p,body:input('G1')});expect(g.record.status).toBe('PASS');expect(g.feature.lifecycle).toBe('DEVELOPING');expect((await blockers(p,'VERIFIED')).some(b=>b.code==='WORK_PRODUCT'&&b.ref==='G5')).toBe(true);
});
it('allows the existing automatic VERIFIED advance when actual enforce work products are complete and no rejudge is open',async()=>{
 arrange();const p=await localAt('DEVELOPING');const g=await run('judgeGate','quality',{params:p,body:input('G5')});expect(g.record.status).toBe('PASS');expect(g.feature.lifecycle).toBe('VERIFIED');
});
