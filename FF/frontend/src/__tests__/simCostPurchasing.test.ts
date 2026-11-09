import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {canonicalCostSource,costFeatureSourceOf,ROUTES,routeUrl,snapshotFile,costReviewSyntheticExample} from '@ff/contracts';

const FF=join(__dirname,'..','..','..');
const basis=JSON.parse(readFileSync(join(FF,'data/reference/cost-basis/v1.3.json'),'utf8'));
const original=JSON.parse(readFileSync(join(FF,'data/reference/feature-db/v1.3/refs.json'),'utf8')).find((r:any)=>r.refId==='BC-BCM-004');
const hash=(v:any)=>createHash('sha256').update(canonicalCostSource(v)).digest('hex');
const feature={featureId:'FEAT-90001',version:'1.0.0',name:'Reference integration fixture',asil:'QM',lifecycle:'PROPOSED',country:'KR',vehicleModel:'NX4 PE',trim:'Premium',requirementIds:['REQ-COST-REF'],featureRefs:[{refId:original.refId,role:'PRIMARY',refVersion:'v1.3'}]};
let sim:typeof import('../api/sim'),engine:typeof import('../api/sim/engine'),files:Map<string,any>;
const put=(name:string,value:any,params:Record<string,string>={})=>files.set(snapshotFile(routeUrl(name,params)),value);
const run=(name:string,body?:any,params:Record<string,string>={},actorRole:any='COST_ESTIMATOR')=>sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,params),{params,body,role:actorRole==='COST_APPROVER'?'approver':actorRole==='IMPLEMENTER'?'integrator':actorRole==='COST_BASIS_ADMIN'?'approver':'viewer',actorRole});
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

describe('purchasing review in the persistent browser simulation',()=>{
 for(const kind of ['SCOPE','TUNING','CHANGE','QUOTE','PRICE','MCU']as const)it(kind+' calculates, separates opinions and creates only a prepared handoff',async()=>{
  const estId=await create(),params={estId};let v=await run('costReviewCreate',{kind,title:'Purchasing '+kind},params);const caseId=v.document.caseId,p={estId,caseId};
  expect(v.assessment.ready).toBe(false);v=await run('costReviewUpdate',{revision:v.document.revision,inputs:await costReviewSyntheticExample(kind),reason:'Load explicit synthetic source'},p);expect(v.assessment.findings).toEqual([]);
  const inputHash=v.document.contentSha256;v=await run('costReviewAction',{revision:v.document.revision,action:'SUBMIT',reason:'Independent review'},p);
  await expect(run('costReviewAction',{revision:v.document.revision,action:'APPROVE',reason:'No own approval'},p,'COST_ESTIMATOR')).rejects.toMatchObject({code:'FORBIDDEN'});
  if(v.assessment.technicalRequired){const tech=await run('costReview',undefined,p,'IMPLEMENTER');expect(tech.view).toBe('TECHNICAL_SCOPE');expect(JSON.stringify(tech)).not.toMatch(/quotedTotal|bodyBase64|unitPrice|estimateCost/);v=await run('costReviewAction',{revision:v.document.revision,action:'TECHNICAL_AGREE',reason:'Actual scope reviewed'},p,'IMPLEMENTER');}
  if(v.assessment.termsRequired)v=await run('costReviewAction',{revision:v.document.revision,action:'TERMS_CONFIRMED',reason:'Source Terms acknowledged, not a contract approval'},p,'COST_BASIS_ADMIN');
  v=await run('costReviewAction',{revision:v.document.revision,action:'APPROVE',reason:'Independent cost decision'},p,'COST_APPROVER');expect(v.document.approval.contentSha256).toBe(inputHash);
  v=await run('costReviewAction',{revision:v.document.revision,action:'HANDOFF',reason:'Prepare internal handoff only'},p);expect(v.document.handoff).toMatchObject({state:'PREPARED',boundary:'NO_EXTERNAL_PAYMENT'});
  const h=await run('costReview',undefined,{...p},'COST_ESTIMATOR');expect(h.document.handoff.handoffId).toBe(v.document.handoff.handoffId);expect(h.history.length).toBeGreaterThan(3);
 });
 it('keeps missing selected quantities and partial direct expenses out of calculated totals',async()=>{const estId=await create();let v=await run('costLineUpdate',{qty:null},{estId,lineNo:'1'});expect(v.result).toBeNull();expect(v.error).toContain('미확정');v=await run('costLineUpdate',{qty:0},{estId,lineNo:'1'});expect(v.result.totals.totalMm).toBe(0);v=await run('costProjectUpdate',{settings:{directExpenses:[{item:'확인 중 비용',qty:1,unitPrice:null}]}},{estId});expect(v.result).toBeNull();expect(v.error).toContain('미확정');});
 it('rejects tampered bytes, stale revision and baseline changes without replacing inputs',async()=>{
  const estId=await create(),v=await run('costReviewCreate',{kind:'QUOTE',title:'Baseline test'},{estId}),p={estId,caseId:v.document.caseId},inputs=await costReviewSyntheticExample('QUOTE');const bad=structuredClone(inputs);bad.evidence[0].bodyBase64=btoa('changed');
  await expect(run('costReviewUpdate',{revision:1,inputs:bad,reason:'Tamper'},p)).rejects.toMatchObject({code:'GUARD_FAILED'});
  let saved=await run('costReviewUpdate',{revision:1,inputs,reason:'Valid source'},p);
  await expect(run('costReviewUpdate',{revision:1,inputs,reason:'Concurrent stale'},p)).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  const overlay=engine.__overlayForTest()!;overlay.entities.refChange??={};overlay.entities.refChange['CR-COST']={changeId:'CR-COST',kind:'MODIFY',refId:original.refId,before:original,after:{benchmarkEur:99},status:'DRAFT',requestedBy:'fixture',requestedAt:'2026-11-09T00:00:00Z',reason:'Benchmark correction',reviews:[]};const impact=await run('refChangeDetail',undefined,{id:'CR-COST'});expect(impact.impact.costProjects).toEqual([expect.objectContaining({estId,lineNos:[1],recalcRequired:true})]);
  await run('costLineUpdate',{qty:2},{estId,lineNo:'1'});expect((await run('costReview',undefined,p)).baselineStale).toBe(true);
  await expect(run('costReviewAction',{revision:saved.document.revision,action:'SUBMIT',reason:'Stale baseline'},p)).rejects.toMatchObject({code:'GUARD_FAILED'});
  saved=await run('costReviewAction',{revision:saved.document.revision,action:'REFRESH_BASELINE',reason:'Explicit baseline refresh'},p);expect(saved.baselineStale).toBe(false);expect(saved.document.inputs).toEqual(inputs);
 });
});
