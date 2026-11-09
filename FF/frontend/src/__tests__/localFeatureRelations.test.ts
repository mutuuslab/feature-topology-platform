import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile, proposeVariability, computeCompleteness, FeatureVariability } from '@ff/contracts';
let sim: typeof import('../api/sim'), engine: typeof import('../api/sim/engine'), files: Map<string, any>;
const params = { id: 'FEAT-00022', ver: '1.0.0' };
const native = { featureId: params.id, version: params.ver, name: 'Native synthetic relations', description: 'Synthetic only', lifecycle: 'RELEASED', country: 'KR', vehicleModel: 'DEMO', trim: 'BASE', baselineId: 'BL-1', ownerId: 'Demo', tags: [], asil: 'QM', requirementIds: ['REQ-SHARED'], upgVc: [], functions: [{ functionId: 'FUNC-000001', label: 'Synthetic' }], swIds: ['SW-DEMO'], swVersions: ['1.0.0'], ecuPnos: ['ECU-DEMO'], controlPoints: ['Flag'], dependencyIds: [], catalogIds: [], gateRecordIds: [], featureRefs: [{ refId: 'AD-PRK-004', role: 'PRIMARY', refVersion: 'v1.3' }] };
const REF = (refId: string, o: Record<string, unknown> = {}) => ({ refId, status: 'ACTIVE', replacedBy: null, registeredIn: 'v0.5', evidenceCheckedAt: '2026-09-20', domain: 'ADAS & AD', cluster: 'Parking', component: 'Parking assistance', swStack: 'Application', lifecycle: 'Commodity', techStack: 'Automotive', vehicleType: '공통', region: '글로벌', nameEn: 'Surround view', nameKo: '서라운드 뷰', aliases: [], autoQuality: 'High', techQuality: 'High', asilRep: 'QM', method: 'Parametric', tshirt: 'L', bundleId: null, bundleRep: null, sizeEvidenceGrade: 'D', relevance: 'High', sourceIds: ['S20'], sourceDetail: 'ISO 16505', remark: '', basisType: '표준 기반 도출', duplicateOf: null, requires: [], excludes: [], procurement: '협력사 개발', swPackage: '', licenseItem: '', billing: '', definition: null, adminMemo: '', ...o });
const refs = [REF('AD-PRK-004'), REF('AD-PRK-005', { nameKo: 'Other reference', excludes: ['AD-PRK-004'] })];
const declaration = { catalogueRole: 'PRIMARY', parentRefId: null, featureType: 'SET', variability: 'OR', bindingTime: 'OTA', variationPoints: [] };
const create = { name: 'New local relations', description: 'Public synthetic request', requirementIds: ['REQ-NEW'], country: 'KR', vehicleModel: 'DEMO', trim: 'NEW', ownerId: 'Demo', asil: 'QM', tags: [], upgVc: [], controlPoints: ['Flag'], featureRefs: [{ refId: 'AD-PRK-004', role: 'PRIMARY' }] };
const specs = [['CB-1','SYS_REQ',[]],['CB-2','SYS_ARCH',[['CB-1','allocated']]],['CB-3','SW_REQ',[['CB-1','derived']]],['CB-4','SW_ARCH',[['CB-3','allocated']]],['CB-5','SW_DD',[['CB-4','refines']]],['CB-6','TEST_SPEC',[['CB-1','verifies'],['CB-2','verifies'],['CB-3','verifies'],['CB-4','verifies'],['CB-5','verifies']]]] as const;
const mockItems = specs.map(([key, kind, rels]) => ({ system: 'CODEBEAMER', key, kind: 'REQUIREMENT', title: 'Synthetic '+kind, body: 'Synthetic', status: 'Approved', revision: 1, updatedAt: '2026-11-10T00:00:00Z', updatedBy: 'jung.req', comments: [], fields: { ffFeatureId: params.id, wpKind: kind, reqId: kind === 'SYS_REQ' ? 'REQ-SHARED' : null, ffVersion: null, relations: rels.map(([to, kind]) => ({to,kind})) } }));
const put = (name: string, data: any, p: Record<string,string> = {}, q: Record<string,any> = {}) => files.set(snapshotFile(routeUrl(name,p,q)),data);
const run = (name: string, body?: any, p: Record<string,string> = {}, role = 'author') => sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,p),{body,params:p,role});
const get = (name:string,p:Record<string,string>) => run(name,undefined,p);
const clone = <T>(v:T):T => structuredClone(v);
beforeEach(async()=>{
 vi.resetModules(); vi.stubEnv('VITE_DATA_MODE','static'); localStorage.clear(); files = new Map();
 put('auditChain',{head:'synthetic-relations',valid:true,count:0});
 put('listFeatures',{items:[clone(native)],total:1},{},{latestOnly:false});
 put('featureDetail',{feature:clone(native),meta:{createdBy:'usr-author',createdAt:'2026-11-09T00:00:00Z'},gates:{},versions:[{version:params.ver,lifecycle:'RELEASED'}]},params);
 put('listRefs',{items:clone(refs),total:refs.length,limit:200,offset:0},{},{limit:200});
 for(const r of refs)put('refDetail',{ref:clone(r),usedBy:[]},{refId:r.refId});
 put('refReleases',{items:[{release:'v1.3'}]});put('listRefChanges',{items:[]});put('deletedDrafts',{items:[]});put('dependencies',{items:[]});
 put('featureVariability',{featureId:params.id,version:params.ver,variability:{...declaration,variationPoints:proposeVariability(refs[0],native).variationPoints},source:'EDITED',updatedBy:'native-author',updatedAt:'2026-11-09T00:00:00Z',history:[{id:7,field:'variability',final:declaration,actorId:'native-author'}],signature:{original:'immutable'}},params);
 put('safetyProfile',{profile:{featureId:params.id,version:params.ver,regClass:'R0',adsFeature:false,asilRef:'QM'},asil:{conditions:[]}},params);
 put('analysisEvidence',{current:{},history:[],g7:[],asilDeviation:null},params);
 const wpItems=mockItems.map(i=>({key:i.key,kind:i.fields.wpKind,title:i.title,status:i.status,approved:true,version:i.revision,ffVersion:null,reqId:i.fields.reqId}));
 const relations=mockItems.flatMap(i=>i.fields.relations.map(r=>({...r,from:i.key,suspect:false})));
 const result=computeCompleteness({featureId:params.id,version:params.ver,ctx:{asil:'QM',cyber:false},items:wpItems,relations});
 put('almWorkProducts',{featureId:params.id,version:params.ver,result,cyberWhy:'native',items:wpItems,gateMode:'enforce',hash:'original-hash',computedAt:'2026-11-09T00:00:00Z',evidence:[{gate:'G2',hash:'original-hash',gateRecordId:'RG-ORIGINAL',items:[]}],changes:[],rejudge:[],signature:{original:'unchanged'}},params);
 put('extSync',{items:[{system:'CODEBEAMER',mode:'mock',pending:0}]});put('mockExtItems',{items:clone(mockItems)},{system:'codebeamer'});put('almRejudge',{items:[]},{},{status:'OPEN'});
 vi.stubGlobal('fetch',vi.fn(async(u:string)=>{const key=decodeURIComponent(String(u)).replace(/^\//,'');return files.has(key)?new Response(JSON.stringify(files.get(key)),{headers:{'content-type':'application/json'}}):new Response('<!doctype html>',{headers:{'content-type':'text/html'}})}));
 sim=await import('../api/sim');engine=await import('../api/sim/engine');await sim.simReady();await import('../api/sim/handlers/local-feature-relations');
});
afterEach(()=>{engine.__resetSimForTest();vi.unstubAllGlobals();vi.unstubAllEnvs();localStorage.clear()});
async function created(body:any={}){const f=await run('createFeature',{...create,...body});return {id:f.featureId,ver:f.version};}
async function version(changes:any={}){const r=await run('createVersion',{baseVersion:params.ver,bump:'minor',reason:'Synthetic new version',changes},{id:params.id});return {id:r.feature.featureId,ver:r.feature.version};}

it('starts from actual creation/ref declarations and canonical proposal, not a nonexistent native target file',async()=>{
 const p=await created();vi.mocked(fetch).mockClear();const v=await get('featureVariability',p);
 expect(v).toMatchObject({featureId:p.id,version:p.ver,source:'PROPOSED',inheritedFrom:null,history:[]});expect(v.variability.bindingTime).toBe('RUNTIME_FLAG');expect(v.variability.variationPoints.some((x:any)=>x.assetKind==='FLAG')).toBe(true);
 expect(vi.mocked(fetch).mock.calls.filter(([u])=>String(u).endsWith(snapshotFile(routeUrl('featureVariability',p))))).toHaveLength(0);
});
it('persists validated creation variability in the same transaction, and keeps explicit draft edits over the initial proposal',async()=>{
 const p=await created({variability:declaration});let v=await get('featureVariability',p);expect(v).toMatchObject({source:'EDITED',updatedBy:'usr-author',variability:{featureType:'SET',variability:'OR',bindingTime:'OTA'}});expect(v.variability.variationPoints.some((x:any)=>x.assetKind==='FLAG')).toBe(true);
 await run('updateDraft',{variability:{...declaration,featureType:'INTEGER'},controlPoints:['Parameter']},p);v=await get('featureVariability',p);expect(v.variability.featureType).toBe('INTEGER');expect(v.variability.variationPoints.some((x:any)=>x.assetKind==='PARAMETER')).toBe(true);expect(v.variability.variationPoints.some((x:any)=>x.assetKind==='FLAG')).toBe(false);
});
it('rolls back a rejected creation declaration together with the Feature instead of leaving a partial local record',async()=>{
 await expect(created({variability:{...declaration,catalogueRole:'SUB',parentRefId:'UNKNOWN-REF'}})).rejects.toMatchObject({code:'GUARD_FAILED'});
 expect(engine.__overlayForTest()!.entities.regFeature??{}).toEqual({});expect(engine.__overlayForTest()!.entities.localFeatureVariability??{}).toEqual({});
});
it('inherits the actual recorded base profile, preserving edited fields and deriving variation points from current controls',async()=>{
 const before=clone(files.get(snapshotFile(routeUrl('featureVariability',params))));const p=await version({controlPoints:['Parameter']});const v=await get('featureVariability',p);
 expect(v).toMatchObject({inheritedFrom:'1.0.0',source:'EDITED',variability:{featureType:'SET',variability:'OR',bindingTime:'OTA'}});expect(v.variability.variationPoints.some((x:any)=>x.assetKind==='PARAMETER')).toBe(true);expect(v.variability.variationPoints.some((x:any)=>x.assetKind==='FLAG')).toBe(false);expect(await get('featureVariability',params)).toEqual(before);
});
it('follows explicit updated primary reference and excludes rather than returning the previous reference profile',async()=>{
 const p=await created();await run('updateDraft',{featureRefs:[{refId:'AD-PRK-005',role:'PRIMARY'}]},p);expect((await get('featureVariability',p)).variability.variability).toBe('ALTERNATIVE');
});
it('does not replace missing native lineage/evidence with a guessed nearest base or an empty profile',async()=>{
 const p=await version();files.delete(snapshotFile(routeUrl('featureVariability',params)));await expect(get('featureVariability',p)).rejects.toMatchObject({code:'GUARD_FAILED'});
});
it('preserves native relation/evidence responses and unknown target failures',async()=>{
 const a=clone(files.get(snapshotFile(routeUrl('featureVariability',params)))),b=clone(files.get(snapshotFile(routeUrl('almWorkProducts',params))));await created();expect(await get('featureVariability',params)).toEqual(a);expect(await get('almWorkProducts',params)).toEqual(b);
 for(const name of ['featureVariability','almWorkProducts'])await expect(get(name,{id:'FEAT-99999',ver:'1.0.0'})).rejects.toMatchObject({status:404,code:'NOT_FOUND'});
});
it('returns exact missing-kind completeness for an unlinked created Feature without inventing a remote connection or approval',async()=>{
 const p=await created();const v=await get('almWorkProducts',p);expect(v).toMatchObject({featureId:p.id,version:p.ver,evidence:[],items:[],remoteVerified:false,remoteReads:0,gateMode:'enforce',availability:{state:'UNLINKED'},result:{rate:0,passedKinds:0}});expect(v.result.problems.length).toBeGreaterThan(0);expect(v.requirementCheck.missing).toEqual(['REQ-NEW']);expect(v.stages.some((s:any)=>s.blockers.length)).toBe(true);
});
it('uses actual version-applicable mock items/relations and local revisions, never cloning old Gate approvals',async()=>{
 const before=clone(files.get(snapshotFile(routeUrl('almWorkProducts',params))));const p=await version();let v=await get('almWorkProducts',p);expect(v.result.rate).toBe(100);expect(v.evidence).toEqual([]);expect(v.remoteVerified).toBe(false);
 await run('mockExtAct',{key:'CB-1',action:'TRANSITION',status:'Draft',externalUser:'jung.req',deliver:false},{system:'codebeamer'},'integrator');v=await get('almWorkProducts',p);expect(v.items.find((i:any)=>i.key==='CB-1')).toMatchObject({version:2,approved:false,status:'Draft'});expect(v.result.rate).toBeLessThan(100);expect(v.result.suspects).toBeGreaterThan(0);expect(await get('almWorkProducts',params)).toEqual(before);
});
it('respects explicit FF Version item allocation instead of treating old-version evidence as new-version completeness',async()=>{
 const items=files.get(snapshotFile(routeUrl('mockExtItems',{system:'codebeamer'}))).items;for(const i of items)i.fields.ffVersion=params.ver;
 const p=await version();const v=await get('almWorkProducts',p);expect(v.items).toEqual([]);expect(v.result.rate).toBe(0);expect(v.evidence).toEqual([]);
});
it('shows current declared requirement relations without fabricating unrelated work products',async()=>{
 const p=await created({requirementIds:['REQ-SHARED']});let v=await get('almWorkProducts',p);expect(v.items.map((i:any)=>i.key)).toEqual(['CB-1']);expect(v.result.rate).toBeLessThan(100);
 await run('updateDraft',{requirementIds:['REQ-NOT-LINKED']},p);v=await get('almWorkProducts',p);expect(v.items).toEqual([]);expect(v.requirementCheck.missing).toEqual(['REQ-NOT-LINKED']);
});
it.each(['off','live'])('reports %s as not collected, without making remote requests or inventing source items',async mode=>{
 const p=await created();put('extSync',{items:[{system:'CODEBEAMER',mode,pending:0}]});const v=await get('almWorkProducts',p);expect(v).toMatchObject({availability:{state:'NOT_COLLECTED',mode},remoteVerified:false,remoteReads:0,result:{rate:0}});expect(v.items).toEqual([]);
});
it('rejects missing global/native sources and a forged creation marker instead of manufacturing successful empty data',async()=>{
 const p=await created();files.delete(snapshotFile(routeUrl('mockExtItems',{system:'codebeamer'})));await expect(get('almWorkProducts',p)).rejects.toMatchObject({code:'GUARD_FAILED'});
 files.delete(snapshotFile(routeUrl('listRefs',{}, {limit:200})));await expect(get('featureVariability',p)).rejects.toMatchObject({code:'GUARD_FAILED'});
 const o=engine.__overlayForTest()!;o.entities.regFeature[p.id+'@'+p.ver].row.version='9.9.9';await expect(get('featureVariability',p)).rejects.toMatchObject({code:'GUARD_FAILED'});
});
it('keeps an actual stored local WP view and human rejudge closure ahead of recomputation',async()=>{
 const p=await version();await run('refreshAlmWorkProducts',{},p,'integrator');const saved=await get('almWorkProducts',p);expect(saved.localOnly).toBe(true);expect(saved.gateMode).toBe('enforce');expect(engine.__overlayForTest()!.entities.localAlmWorkProducts[p.id+'@'+p.ver].view.gateMode).toBe('enforce');
 await run('mockExtAct',{key:'CB-1',action:'TRANSITION',status:'Draft',externalUser:'jung.req',deliver:false},{system:'codebeamer'},'integrator');const after=await get('almWorkProducts',p);expect(after.hash).toBe(saved.hash);expect(after.items).toEqual(saved.items);
});

it('preserves a native-source absence before first read instead of treating it as an empty defined profile',async()=>{
 files.delete(snapshotFile(routeUrl('featureVariability',params)));await expect(get('featureVariability',params)).rejects.toMatchObject({status:404});
 files.delete(snapshotFile(routeUrl('almWorkProducts',params)));await expect(get('almWorkProducts',params)).rejects.toMatchObject({status:404});
});
it('keeps native autofill history when an actual editable native draft declaration is updated',async()=>{
 const f=files.get(snapshotFile(routeUrl('featureDetail',params))).feature;f.lifecycle='PROPOSED';files.get(snapshotFile(routeUrl('listFeatures',{}, {latestOnly:false}))).items[0].lifecycle='PROPOSED';
 const original=clone(files.get(snapshotFile(routeUrl('featureVariability',params))));await run('updateDraft',{variability:{...declaration,featureType:'INTEGER'}},params);
 const v=await get('featureVariability',params);expect(v.variability.featureType).toBe('INTEGER');expect(v.history).toEqual(original.history);expect(files.get(snapshotFile(routeUrl('featureVariability',params)))).toEqual(original);
});
it('rejects missing base-version lineage rather than silently inheriting the latest native profile',async()=>{
 const p=await version();const o=engine.__overlayForTest()!;o.audit=o.audit.filter(a=>a.action!=='FEATURE_VERSION_CREATE');o.events=o.events.filter(e=>e.type!=='feature.version.created');await expect(get('featureVariability',p)).rejects.toMatchObject({code:'GUARD_FAILED'});
});

it('rejects refresh without real global policy mode and commits no weakened warn result',async()=>{
 const p=await version();files.get(snapshotFile(routeUrl('almWorkProducts',params))).gateMode=undefined;
 await expect(get('almWorkProducts',p)).rejects.toMatchObject({code:'GUARD_FAILED'});
 await expect(run('refreshAlmWorkProducts',{},p,'integrator')).rejects.toMatchObject({code:'GUARD_FAILED'});
 expect(engine.__overlayForTest()!.entities.localAlmWorkProducts??{}).toEqual({});
});
