import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJson, ROUTES, routeUrl, snapshotContent, snapshotFile } from '@ff/contracts';

const id = 'FEAT-00013', ver = '0.3.0';
const url = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}) => routeUrl(name, params, query as Record<string, string>);
const feature = { featureId: id, version: ver, name: '알림', description: '알림 기능', lifecycle: 'PROPOSED', requirementIds: ['REQ-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'usr-author', asil: 'QM', tags: [], upgVc: [], functions: [], swIds: [], swVersions: [], ecuPnos: [], controlPoints: [], dependencyIds: [], _missing: {} };
const baseline = (baselineId: string, featureId: string, name: string) => {
  const snapshot = { ...feature, baselineId, featureId, name };
  return { baselineId, featureId, version: ver, snapshot, approvedBy: 'usr-bom', approvedAt: '2026-10-18T00:00:00.000Z', contentHash: 'sha256:' + createHash('sha256').update(canonicalJson(snapshotContent(snapshot as any))).digest('hex') };
};
const baselines = [baseline('BL-00001', id, '알림'), baseline('BL-00002', 'FEAT-00022', '경고')];
const history = [
  { id: '1', at: '2026-10-18T00:00:00.000Z', actorId: 'usr-author', action: 'FEATURE_CREATE', version: ver, items: ['name'], reason: '등록' },
  { id: '2', at: '2026-10-19T00:00:00.000Z', actorId: 'usr-approver', action: 'GATE_JUDGE G1', version: '0.4.0', items: ['status'], reason: '판정' },
  { id: '3', at: '2026-10-17T16:00:00.000Z', actorId: 'usr-author', action: 'FEATURE_UPDATE', version: ver, items: ['name'], reason: 'KST 18일 변경' },
  { id: '4', at: '2026-10-18T16:00:00.000Z', actorId: 'usr-author', action: 'FEATURE_UPDATE', version: ver, items: ['name'], reason: 'KST 19일 변경' },
];
const snapshots: Record<string, unknown> = {
  [url('auditChain')]: { ok: true, verified: 0, head: 'aa'.repeat(32), checkedAt: '2026-10-18T00:00:00.000Z' },
  [url('events', {}, { limit: 500, recent: '1' })]: { items: [] },
  [url('audit', {}, { limit: 500 })]: { items: [], nextCursor: null },
  [url('notifications', {}, { limit: 200 })]: { items: [], unread: 0, byCategory: {} },
  [url('featureHistory', { id })]: { featureId: id, items: history },
  [url('featureReviews', { id })]: { items: [{ recordId: 'FRV-00001', version: ver }, { recordId: 'FRV-00002', version: '0.4.0' }] },
  [url('featureRetireRequests')]: { items: [{ requestId: 'FRT-00001', featureId: id, status: 'PENDING' }, { requestId: 'FRT-00002', featureId: 'FEAT-00022', status: 'REJECTED' }] },
  [url('baselines')]: { items: baselines },
  [url('baselineChangesets')]: { items: [{ changesetId: 'BCS-00001', featureId: id }] },
  [url('releaseCandidate', { id, ver })]: { snapshot: null, verified: null },
  [url('releaseCandidates')]: { items: [] },
  [url('deletedDrafts')]: { items: [] },
  [url('gateNaRequests', { id, ver })]: { items: [] },
  [url('listPolicies')]: { items: [{ policyId: 'POL-00001', flagKey: 'alert', featureId: id, featureVersion: ver, status: 'DRAFT' }] },
  [url('accounts')]: { items: ['author', 'sysadmin', 'steward'].map((name) => ({ id: `usr-${name}`, state: 'ACTIVE', roles: null, changedAt: null, changedBy: null, reason: null })) },
  [url('complianceRule', { id: 'CR-REG-001' })]: { rule: { ruleId: 'CR-REG-001', ownerId: 'usr-former' }, ownerState: 'ABSENT', ownerTransfers: [] },
};
const originalFiles = new Map(Object.entries(snapshots).map(([u,data])=>['/'+snapshotFile(u),data]));
const files = new Map(originalFiles);
let sim: typeof import('../api/sim');
let engine: typeof import('../api/sim/engine');
const call = (name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}, body?: unknown, role = 'author') => sim.simCall<any>(ROUTES.find((r) => r.name === name)!, url(name, params, query), { params, body, role });

beforeEach(async () => {
  files.clear(); for(const [key,value] of originalFiles)files.set(key,value);
  vi.resetModules();
  vi.stubEnv('VITE_DATA_MODE', 'static');
  vi.stubGlobal('fetch', vi.fn(async (u: string) => files.has(u) ? new Response(JSON.stringify(files.get(u)), { headers: { 'Content-Type': 'application/json' } }) : new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })));
  localStorage.clear();
  (window as any).__simUnhandled = [];
  sim = await import('../api/sim');
  engine = await import('../api/sim/engine');
});
afterEach(() => {
  engine?.__resetSimForTest();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('F0 공개 진입점 계정 기록과 소유자 이관', () => {
  it('비활성/재활성 기록은 실제 조회와 감사에 반영된다', async () => {
    expect(await call('deactivateAccount', { id: 'usr-author' }, {}, { reason: '부서 이동 기록' }, 'sysadmin')).toMatchObject({ id: 'usr-author', state: 'INACTIVE' });
    expect((await call('accounts', {}, {}, undefined, 'sysadmin')).items).toContainEqual(expect.objectContaining({ id: 'usr-author', state: 'INACTIVE' }));
    expect(await call('reactivateAccount', { id: 'usr-author' }, {}, { reason: '복귀 기록' }, 'sysadmin')).toMatchObject({ state: 'ACTIVE' });
    expect(engine.__overlayForTest()!.audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'ACCOUNT_DEACTIVATE', result: 'ALLOWED' }), expect.objectContaining({ action: 'ACCOUNT_REACTIVATE', result: 'ALLOWED' })]));
    expect((window as any).__simUnhandled).toEqual([]);
  });
  it('자기 비활성 기록과 권한 없는 변경은 성공으로 가장하지 않는다', async () => {
    await expect(call('deactivateAccount', { id: 'usr-sysadmin' }, {}, { reason: '자기 계정 기록' }, 'sysadmin')).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    await expect(call('deactivateAccount', { id: 'usr-steward' }, {}, { reason: '권한 없는 기록' }, 'author')).rejects.toMatchObject({ status: 403 });
    expect(engine.__overlayForTest()!.entities).toEqual({});
  });
  it('부재 소유자의 룰은 적격 계정으로 이관하고 조회·이력에 남긴다', async () => {
    expect(await call('transferComplianceRuleOwner', { id: 'CR-REG-001' }, {}, { toOwnerId: 'usr-steward', reason: '퇴사 소유자 이관' }, 'sysadmin')).toMatchObject({ ownerId: 'usr-steward' });
    expect(await call('complianceRule', { id: 'CR-REG-001' }, {}, undefined, 'sysadmin')).toMatchObject({ rule: { ownerId: 'usr-steward' }, ownerState: 'ACTIVE', ownerTransfers: [expect.objectContaining({ fromOwnerId: 'usr-former', toOwnerId: 'usr-steward' })] });
    expect((window as any).__simUnhandled).toEqual([]);
  });
  it('F0-ownerState: 계정 상태 변경 뒤 룰 상태를 다시 계산하고 비활성 소유자를 이관한다', async () => {
    const key = '/' + snapshotFile(url('complianceRule', { id: 'CR-REG-001' }));
    const previous = files.get(key) as any;
    files.set(key, { ...previous, rule: { ...previous.rule, ownerId: 'usr-author' }, ownerState: 'ACTIVE' });
    try {
      expect(await call('complianceRule', { id: 'CR-REG-001' })).toMatchObject({ ownerState: 'ACTIVE' });
      await call('deactivateAccount', { id: 'usr-author' }, {}, { reason: '소유자 부서 이동 기록' }, 'sysadmin');
      expect(await call('complianceRule', { id: 'CR-REG-001' })).toMatchObject({ rule: { ownerId: 'usr-author' }, ownerState: 'INACTIVE', ownerTransfers: [] });
      await call('reactivateAccount', { id: 'usr-author' }, {}, { reason: '소유자 복귀 기록' }, 'sysadmin');
      expect(await call('complianceRule', { id: 'CR-REG-001' })).toMatchObject({ ownerState: 'ACTIVE' });
      await call('deactivateAccount', { id: 'usr-author' }, {}, { reason: '이관을 위한 비활성 기록' }, 'sysadmin');
      await call('transferComplianceRuleOwner', { id: 'CR-REG-001' }, {}, { toOwnerId: 'usr-steward', reason: '비활성 소유자 인계' }, 'sysadmin');
      expect(await call('complianceRule', { id: 'CR-REG-001' })).toMatchObject({ rule: { ownerId: 'usr-steward' }, ownerState: 'ACTIVE', ownerTransfers: [expect.objectContaining({ fromOwnerId: 'usr-author', fromState: 'INACTIVE', toOwnerId: 'usr-steward' })] });
    } finally { files.set(key, previous); }
  });
});

describe('P10 로컬 업무와 기록 조회', () => {
  it.each([
    ['requestGateNa', { id, ver }, { gate: 'G3', reason: '공통 기능 검토' }, 'quality'],
    ['decideGateNa', { rid: 'GNA-00001' }, { decision: 'APPROVE', reason: '검토 완료' }, 'safety2'],
    ['rejectFeature', { id, ver }, { reason: '요구 보완', issues: [{ item: '근거 누락', detail: '' }], reworkReason: '근거 재작성' }, 'approver'],
    ['requestFeatureRetire', { id, ver }, { reason: '사업 취소 폐기 요청' }, 'author'],
    ['decideFeatureRetire', { rid: 'FRT-00001' }, { decision: 'APPROVE', reason: '사업 취소 확인' }, 'approver'],
    ['deleteFeatureDraft', { id, ver }, { reason: '잘못 등록한 초안 정리' }, 'author'],
    ['deleteRelationDraft', { id: 'DEP-00001' }, { reason: '잘못 맺은 초안 관계 정리' }, 'author'],
  ] as const)('%s는 조회 역할의 변경을 거부한다', async (name, params, body, role) => {
    await expect(call(name, params, {}, body, 'viewer')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(engine.__overlayForTest()!.entities).toEqual({});
    expect(engine.__overlayForTest()!.audit.some((a) => a.action === name && a.result === 'ALLOWED')).toBe(false);
    expect((window as any).__simUnhandled).toEqual([]);
  });

  it('이력의 변경자·기간·변경 항목·Version을 실제 기록에서 거른다', async () => {
    const result = await call('featureHistory', { id }, { actorId: 'usr-author', from: '2026-10-18', to: '2026-10-18', item: 'name', version: ver });
    expect(result.items.map((r: any) => r.id)).toEqual(['1', '3']);
    expect(result.filter).toMatchObject({ from: '2026-10-17T15:00:00.000Z', to: '2026-10-18T15:00:00.000Z' });
  });
  it('잘못된 이력 기간은 400이고 빈 조회로 위장하지 않는다', async () => {
    await expect(call('featureHistory', { id }, { from: 'not-a-date' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION' });
  });
  it('반려 기록 Version과 폐기 요청 Feature·상태를 거른다', async () => {
    expect((await call('featureReviews', { id }, { version: ver })).items.map((r: any) => r.recordId)).toEqual(['FRV-00001']);
    expect((await call('featureRetireRequests', {}, { featureId: id, status: 'PENDING' })).items.map((r: any) => r.requestId)).toEqual(['FRT-00001']);
  });
  it('임의 두 Baseline 비교는 공용 계약으로 계산하고 내용 해시도 검증한다', async () => {
    const result = await call('compareBaselines', {}, { left: 'BL-00001', right: 'BL-00002' });
    expect(result.sameFeature).toBe(false);
    expect(result.items).toContainEqual(expect.objectContaining({ field: 'name', before: '알림', after: '경고' }));
    const mine = await call('featureBaselines', { id });
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].verified).toBe(true);
  });
  it('정책 단계는 현재 시연 정책 상태에서 계산한다', async () => {
    const result = await call('policyStages', {}, { featureId: id, stage: 'Draft' });
    expect(result.items.map((p: any) => p.policyId)).toEqual(['POL-00001']);
    await expect(call('policyStages', {}, { stage: 'Unknown' })).rejects.toMatchObject({ status: 400, code: 'VALIDATION' });
  });
});


describe('P10 local commands with independent approval',()=>{
 const seed=(lifecycle='PROPOSED',policies:any[]=[])=>{
  const set=(name:string,p:Record<string,string>,body:unknown,q:Record<string,unknown>={})=>files.set('/'+snapshotFile(url(name,p,q)),body);
  set('featureDetail',{id,ver},{feature:{...feature,lifecycle},meta:{createdBy:'usr-author',createdAt:null},gates:{},dependencies:{outgoing:[],incoming:[]},versions:[{version:ver,lifecycle}]});
  set('listFeatures',{},{items:[{...feature,lifecycle,isLatest:true}]},{latestOnly:false});set('listPolicies',{},{items:policies});set('featureReviews',{id},{items:[]});set('featureRetireRequests',{},{items:[]});set('traceLinks',{},{items:[]},{featureId:id});set('dependencies',{},{items:[]});
 };
 it('N/A approval records a real local signature; duplicate, self-approval and mandatory Gate bypass are denied',async()=>{
  seed();await expect(call('requestGateNa',{id,ver},{},{gate:'G1',reason:'모든 기능 공통 검토'},'quality')).rejects.toMatchObject({code:'GUARD_FAILED'});
  const req=await call('requestGateNa',{id,ver},{},{gate:'G3',reason:'독립 검토가 필요한 공통 기능'},'quality');
  await expect(call('requestGateNa',{id,ver},{},{gate:'G3',reason:'같은 요청 중복 확인'},'quality')).rejects.toMatchObject({code:'CONFLICT'});
  const allowed=await call('decideGateNa',{rid:req.requestId},{},{decision:'APPROVE',reason:'독립 검토 완료'},'safety2');
  expect(allowed).toMatchObject({request:{status:'APPROVED',requestedBy:'usr-quality',decidedBy:'usr-safety2'},record:{status:'N/A',evidenceRef:req.requestId}});
  const log=(engine.__overlayForTest()!.data.regGates as any)[id+'@'+ver][0];expect(log.decision.signature.kid).toMatch(/^SIM-GATE-/);expect(log.decision.signature.value).toHaveLength(86);
  expect((await call('gates',{id,ver})).naRequests).toContainEqual(expect.objectContaining({requestId:req.requestId,status:'APPROVED'}));
  expect((await call('gates',{id,ver})).goNoGo.notApplicable).toContain('G3');
  expect((await call('gateNaRequests',{id,ver})).items).toContainEqual(expect.objectContaining({requestId:req.requestId,status:'APPROVED'}));
  const own=await call('requestGateNa',{id,ver},{},{gate:'G2',reason:'QM 기능 해당 없음 검토'},'quality');
  await expect(call('decideGateNa',{rid:own.requestId},{},{decision:'APPROVE',reason:'자기 승인'},'quality')).rejects.toMatchObject({code:'SEPARATION_OF_DUTY'});
 });
 it('rejection preserves PROPOSED with the rework evidence and author cannot reject',async()=>{
  seed();const body={reason:'요구 보완',issues:[{item:'근거 누락',detail:''}],reworkReason:'근거 재작성'};
  await expect(call('rejectFeature',{id,ver},{},body,'author')).rejects.toMatchObject({code:'FORBIDDEN'});
  const r=await call('rejectFeature',{id,ver},{},body,'approver');expect(r).toMatchObject({kind:'REJECT',to:'PROPOSED',issues:body.issues});
  expect((await call('featureReviews',{id},{version:ver})).items).toContainEqual(expect.objectContaining({recordId:r.recordId,reworkReason:body.reworkReason}));expect((await call('featureDetail',{id,ver})).feature.lifecycle).toBe('PROPOSED');
 });
 it('retire request keeps the state until independent approval, then persists RETIRED and denies replay',async()=>{
  seed();const r=await call('requestFeatureRetire',{id,ver},{},{reason:'사업 취소 폐기 요청'},'author');expect((await call('featureDetail',{id,ver})).feature.lifecycle).toBe('PROPOSED');
  const result=await call('decideFeatureRetire',{rid:r.requestId},{},{decision:'APPROVE',reason:'사업 취소 독립 확인'},'approver');expect(result).toMatchObject({request:{status:'APPROVED'},feature:{lifecycle:'RETIRED'}});
  expect((await call('featureDetail',{id,ver})).feature.lifecycle).toBe('RETIRED');await expect(call('decideFeatureRetire',{rid:r.requestId},{},{decision:'APPROVE',reason:'중복 승인'},'approver')).rejects.toMatchObject({code:'GUARD_FAILED'});
 });
 it('deployed Flag blocks retirement approval while a rejection remains possible',async()=>{
  seed('RELEASED',[{policyId:'POL-X',flagKey:'alert',featureId:id,featureVersion:ver,status:'DEPLOYED'}]);const r=await call('requestFeatureRetire',{id,ver},{},{reason:'출시 버전 폐기 요청'},'author');
  await expect(call('decideFeatureRetire',{rid:r.requestId},{},{decision:'APPROVE',reason:'배포 중인 Flag 확인'},'approver')).rejects.toMatchObject({code:'GUARD_FAILED'});
  expect((await call('decideFeatureRetire',{rid:r.requestId},{},{decision:'REJECT',reason:'Flag 퇴역 먼저 완료'},'approver')).request.status).toBe('REJECTED');
 });
 it('deletes an unreferenced own draft with a tombstone and removes it from list and detail',async()=>{
  seed();expect(await call('deleteFeatureDraft',{id,ver},{},{reason:'잘못 등록한 초안 정리'},'author')).toMatchObject({recordId:id+'@'+ver,entity:'feature-version'});
  expect((await call('listFeatures',{}, {latestOnly:false})).items).toEqual([]);await expect(call('featureDetail',{id,ver})).rejects.toMatchObject({code:'NOT_FOUND'});
  expect((await call('deletedDrafts')).items).toContainEqual(expect.objectContaining({recordId:id+'@'+ver}));
 });
 it('denies deletion of a referenced draft and preserves its state',async()=>{
  seed('PROPOSED',[{policyId:'POL-X',featureId:id,featureVersion:ver,status:'DRAFT'}]);await expect(call('deleteFeatureDraft',{id,ver},{},{reason:'참조 초안 삭제 시도'},'author')).rejects.toMatchObject({code:'GUARD_FAILED',details:{code:'DRAFT_REFERENCED'}});
  expect((await call('featureDetail',{id,ver})).feature.lifecycle).toBe('PROPOSED');
 });
 it('deletes a draft relation and updates source membership without resurrecting it',async()=>{
  seed();const dependency={dependencyId:'DEP-09999',sourceFeatureId:id,sourceVersion:ver,targetFeatureId:'FEAT-00022',targetVersion:'1.0.0'};
  files.set('/'+snapshotFile(url('dependencies')),{items:[dependency]});
  const detailKey='/'+snapshotFile(url('featureDetail',{id,ver})),d=files.get(detailKey) as any;files.set(detailKey,{...d,feature:{...d.feature,dependencyIds:[dependency.dependencyId]}});
  await call('deleteRelationDraft',{id:dependency.dependencyId},{},{reason:'잘못 맺은 초안 관계 정리'},'author');
  expect((await call('dependencies')).items).toEqual([]);expect((await call('featureDetail',{id,ver})).feature.dependencyIds).toEqual([]);
  expect((await call('deletedDrafts')).items).toContainEqual(expect.objectContaining({entity:'feature-relation',recordId:dependency.dependencyId}));
 });
 it('previous PASS remains deletion evidence after the latest Gate became FAIL',async()=>{
  seed();files.set('/'+snapshotFile(url('gates',{id,ver})),{gates:[{gate:'G1',latest:{gateRecordId:'GR-2',status:'FAIL'},history:[{gateRecordId:'GR-1',status:'PASS'},{gateRecordId:'GR-2',status:'FAIL'}]}]});
  await expect(call('deleteFeatureDraft',{id,ver},{},{reason:'과거 승인 이력 삭제 시도'},'author')).rejects.toMatchObject({code:'GUARD_FAILED',details:{code:'DRAFT_HAS_APPROVAL'}});
 });

});
