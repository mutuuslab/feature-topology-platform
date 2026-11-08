import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonicalJson, executionProduct, ROUTES, routeUrl, snapshotFile } from '@ff/contracts';
import { WORKFLOW_EXECUTION_MODEL as M } from '../../../contracts/src/generated/workflow-execution-model';

let sim:typeof import('../api/sim'),engine:typeof import('../api/sim/engine');
const run=(name:string,role:string,body?:unknown,params:Record<string,string>={},query:Record<string,string>={})=>sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,params,query),{role,body,params,query});
beforeEach(async()=>{
  localStorage.clear();vi.stubEnv('VITE_DATA_MODE','static');
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>new Response(JSON.stringify(String(input).includes(snapshotFile(routeUrl('auditChain')))?{head:'transfer-tests',verified:0}:{items:[]}),{headers:{'Content-Type':'application/json'}})));
  sim=await import('../api/sim');engine=await import('../api/sim/engine');
});
afterEach(()=>{engine.__resetSimForTest();vi.unstubAllEnvs();vi.unstubAllGlobals();localStorage.clear();});
const create=(processId:string,role:string,targetRef='SAME-TARGET')=>run('createWorkflowCase',role,{processId,targetRef,title:`Case ${processId}`});
async function prepared(){
  let source=await create('FPW.1','author');const id=source.item.caseId;
  for(const productKey of ['WP-FEAT-REG','WP-REF-LINK'])source=await run('createWorkflowArtifact','author',{version:source.item.version,activityId:'FPW.1-A01',productKey,fields:Object.fromEntries(executionProduct(M,productKey).content.map((_,i)=>[String(i),`Content ${i}`])),references:['SOURCE-RECORD'],files:[],reason:'Write output'},{id});
  source=await run('submitWorkflowActivity','author',{version:source.item.version,note:'Review this output'},{id,activityId:'FPW.1-A01'});
  source=await run('reviewWorkflowActivity','integrator',{version:source.item.version,decision:'ACCEPT',reason:'Independent review'},{id,activityId:'FPW.1-A01'});
  const target=await create('FPW.2','safety2');
  const body={version:source.item.version,targetVersion:target.item.version,toCaseId:target.item.caseId,requestKey:'static-cross-case-key',fromActivityId:'FPW.1-A01',toActivityId:'FPW.2-A05',note:'Actual reviewed transfer'};
  return {source,target,body};
}
it('static uses the same two-case CAS, sealed payload, receipt and request idempotency',async()=>{
  const {source,target,body}=await prepared(),id=source.item.caseId,tid=target.item.caseId;
  await expect(run('offerCrossCaseWorkflow','author',{...body,targetVersion:2},{id})).rejects.toMatchObject({status:412});
  expect((await run('workflowCase','safety2',undefined,{id:tid})).item.handoffs).toEqual([]);
  const sent=await run('offerCrossCaseWorkflow','author',body,{id}),h=sent.item.handoffs[0];
  expect(h.artifacts.map((a:any)=>a.productKey)).toEqual(['WP-REF-LINK']);
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(h.artifacts))))].map(v=>v.toString(16).padStart(2,'0')).join('');expect(h.artifactsHash).toBe(sha);
  expect((await run('offerCrossCaseWorkflow','author',{...body,version:999},{id})).item.version).toBe(sent.item.version);
  const incoming=await run('workflowCase','safety2',undefined,{id:tid});expect(incoming.transferVersions[id]).toBe(sent.item.version);
  const receipt={version:incoming.item.version,sourceVersion:sent.item.version,decision:'RETURN',reason:'Return the actual package'};
  await expect(run('receiveCrossCaseWorkflow','author',receipt,{id:tid,handoffId:h.handoffId})).rejects.toMatchObject({status:403});
  const returned=await run('receiveCrossCaseWorkflow','safety2',receipt,{id:tid,handoffId:h.handoffId});
  expect(returned.item.activities).toEqual({});expect(returned.item.handoffs[0].status).toBe('RETURNED');
  expect((await run('workflowCase','author',undefined,{id})).item.handoffs[0]).toEqual(returned.item.handoffs[0]);
  expect((await run('receiveCrossCaseWorkflow','safety2',receipt,{id:tid,handoffId:h.handoffId})).item.version).toBe(returned.item.version);
});
it('does not turn outbound target activities into editable source-case activities',async()=>{
  const {source,body}=await prepared(),id=source.item.caseId;await run('offerCrossCaseWorkflow','author',body,{id});
  await expect(run('createWorkflowArtifact','safety2',{version:source.item.version+1,activityId:'FPW.2-A05',productKey:'WP-REF-LINK',fields:{'0':'should not edit source'},references:['X'],files:[],reason:'Wrong case activity'},{id})).rejects.toMatchObject({status:422});
});
it('does not claim binary success without actual IndexedDB byte storage',async()=>{
  const s=await create('FPW.1','author'),id=s.item.caseId;
  await expect(run('uploadWorkflowFile','author',{version:1,blob:new Blob(['real bytes']),name:'source.bin',mediaType:'application/octet-stream',requestKey:'actual-file-key'},{id,activityId:'FPW.1-A01'})).rejects.toThrow(/IndexedDB/);
  expect((await run('workflowCase','author',undefined,{id})).item).toMatchObject({version:1,artifacts:[]});
});
