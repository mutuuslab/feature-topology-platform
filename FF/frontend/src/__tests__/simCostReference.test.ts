import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {canonicalCostSource,costFeatureSourceOf,ROUTES,routeUrl,snapshotFile} from '@ff/contracts';

const FF=join(__dirname,'..','..','..');
const basis=JSON.parse(readFileSync(join(FF,'data/reference/cost-basis/v1.3.json'),'utf8'));
const original=JSON.parse(readFileSync(join(FF,'data/reference/feature-db/v1.3/refs.json'),'utf8')).find((r:any)=>r.refId==='BC-BCM-004');
const hash=(v:any)=>createHash('sha256').update(canonicalCostSource(v)).digest('hex');
const feature={featureId:'FEAT-90001',version:'1.0.0',name:'Reference integration fixture',asil:'QM',lifecycle:'PROPOSED',country:'KR',vehicleModel:'NX4 PE',trim:'Premium',requirementIds:['REQ-COST-REF'],featureRefs:[{refId:original.refId,role:'PRIMARY',refVersion:'v1.3'}]};
let sim:typeof import('../api/sim'),engine:typeof import('../api/sim/engine'),files:Map<string,any>;
const put=(name:string,value:any,params:Record<string,string>={})=>files.set(snapshotFile(routeUrl(name,params)),value);
const run=(name:string,body?:any,params:Record<string,string>={},actorRole:any='COST_ESTIMATOR')=>sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,params),{params,body,role:actorRole==='COST_APPROVER'?'approver':actorRole==='IMPLEMENTER'?'integrator':'viewer',actorRole});
beforeEach(async()=>{
 vi.resetModules();vi.stubEnv('VITE_DATA_MODE','static');localStorage.clear();files=new Map();
 put('costBasisList',{latest:'v1.3',items:[{version:'v1.3',status:'PUBLISHED'}]});put('costBasis',{basis},{version:'v1.3'});put('costProjects',{items:[],view:'FULL'});put('refReleases',{items:[{release:'v1.3',publishedAt:'2026-09-29T00:00:00Z'}]});
 put('refDetail',{ref:original},{refId:original.refId});put('featureDetail',{feature},{id:feature.featureId,ver:feature.version});
 put('costReference',{ref:original,ord:12,basisVersion:'v1.3',refRelease:'v1.3',referenceSha256:hash(original),usable:true,missing:[],sources:[],features:[{featureId:feature.featureId,version:feature.version,name:feature.name,asil:feature.asil,lifecycle:feature.lifecycle,sha256:hash(costFeatureSourceOf(feature as any))}]},{refId:original.refId});
 vi.stubGlobal('fetch',vi.fn(async(u:string)=>{const key=decodeURIComponent(String(u)).replace(/^\//,'');return files.has(key)?new Response(JSON.stringify(files.get(key)),{headers:{'Content-Type':'application/json'}}):new Response('<!doctype html>',{headers:{'Content-Type':'text/html'}});}));
 sim=await import('../api/sim');engine=await import('../api/sim/engine');
});
afterEach(()=>{engine.__resetSimForTest();vi.unstubAllEnvs();vi.unstubAllGlobals();localStorage.clear();});
const selection=async(featureLink=false)=>{const p=await run('costReference',undefined,{refId:original.refId});return {refId:original.refId,refRelease:p.refRelease,referenceSha256:p.referenceSha256,feature:featureLink?{featureId:feature.featureId,version:feature.version,sha256:hash(costFeatureSourceOf(feature as any))}:null};};
const create=async()=>{const s=await selection();return (await run('costProjectCreate',{name:'Feature DB estimate',references:[s]})).estId as string;};

describe('static Feature DB-first estimates',()=>{
 it('creates from a reference, calculates, redacts financial source evidence and never creates a Feature',async()=>{
  const id=await create();const d=await run('costProject',undefined,{estId:id});expect(d.lines[0]).toMatchObject({featureId:null,version:null,role:'REFERENCE',sourceRevision:1,source:{kind:'FEATURE_DB',stale:false}});expect(d.result.totals.totalMm).toBeGreaterThan(0);expect(d.features).toEqual([]);
  const dev=await run('costProject',undefined,{estId:id},'IMPLEMENTER');for(const key of ['benchmarkEur','makeBuyVolume','makeBuyPremium','kearneyNote','totalCost'])expect(JSON.stringify(dev)).not.toContain(`"${key}"`);
  const history=await run('costReferenceHistory',undefined,{estId:id,lineNo:'1',revision:'1'},'IMPLEMENTER');expect(history.snapshot).toBeUndefined();
 });
 it('checks stale/duplicate selections and keeps a real Feature link with append-only source revisions',async()=>{
  const id=await create();await expect(run('costReferenceAdd',await selection(),{estId:id})).rejects.toMatchObject({code:'CONFLICT'});
  await expect(run('costProjectCreate',{name:'stale',references:[{...await selection(),referenceSha256:'0'.repeat(64)}]})).rejects.toMatchObject({code:'CONFLICT'});
  await run('costLineUpdate',{qty:3},{estId:id,lineNo:'1'});const linked=await run('costReferenceUpdate',{selection:await selection(true),revision:1,reason:'Actual Feature link'},{estId:id,lineNo:'1'});
  expect(linked.lines[0]).toMatchObject({featureId:feature.featureId,version:feature.version,sourceRevision:2,inputs:{qty:3}});
  expect((await run('costReferenceHistory',undefined,{estId:id,lineNo:'1',revision:'1'})).feature).toBeNull();
 });
 it('pins approved source revisions and keeps removed history across project revision',async()=>{
  const id=await create();await run('costTransition',{action:'SUBMIT',reason:'Review source'},{estId:id});await run('costTransition',{action:'APPROVE',reason:'Independent review'},{estId:id},'COST_APPROVER');
  const approved=await run('costProject',undefined,{estId:id});expect(approved.approvals[0].sources).toEqual([{lineNo:1,revision:1}]);
  await run('costTransition',{action:'REVISE',reason:'Scope revision'},{estId:id});await run('costLineRemove',{}, {estId:id,lineNo:'1'});const added=await run('costReferenceAdd',await selection(),{estId:id});expect(added.lines[0].lineNo).toBe(2);expect(added.approvals[0].resultSha256).toBe(approved.approvals[0].resultSha256);
  expect((await run('costReferenceHistory',undefined,{estId:id,lineNo:'1',revision:'1'})).reference.refId).toBe(original.refId);
 });
 it('refuses a missing source snapshot instead of inventing benchmark prices',async()=>{
  files.delete(snapshotFile(routeUrl('costReference',{refId:original.refId})));await expect(run('costReference',undefined,{refId:original.refId})).rejects.toMatchObject({code:'CONFLICT'});
 });
 it('keeps captured engine facts until explicit source refresh and blocks stale submission',async()=>{
  const id=await create();const before=(await run('costProject',undefined,{estId:id})).result.totals.totalMm;
  (engine.__overlayForTest()!.entities.refRow ??= {})[original.refId]={...original,benchmarkEur:original.benchmarkEur*2};
  const stale=await run('costProject',undefined,{estId:id});expect(stale.lines[0].source.stale).toBe(true);expect(stale.result.totals.totalMm).toBe(before);
  await expect(run('costTransition',{action:'SUBMIT',reason:'Stale source'},{estId:id})).rejects.toMatchObject({code:'GUARD_FAILED'});
  const fresh=await run('costProjectUpdate',{useLatestBasis:true},{estId:id});expect(fresh.lines[0].sourceRevision).toBe(2);expect(fresh.lines[0].source.stale).toBe(false);expect(fresh.result.totals.totalMm).not.toBe(before);
 });
});
