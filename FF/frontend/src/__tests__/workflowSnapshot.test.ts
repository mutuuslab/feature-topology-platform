import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ROUTES, routeUrl, snapshotFile, type WorkflowCase } from '@ff/contracts';
import { WORKFLOW_EXECUTION_MODEL as M } from '../../../contracts/src/generated/workflow-execution-model';

let sim: typeof import('../api/sim'), engine: typeof import('../api/sim/engine');
const process = M.processes.find(p => p.id === 'FPW.18')!;
const activity = process.activities[0], product = process.products.find(p => p.key === activity.outputs[0])!;
const fields = Object.fromEntries(product.content.map((_, i) => [String(i), `가상 초안 ${i}`]));
const item: WorkflowCase = { caseId:'WFC-captured',processId:process.id,title:'가상 서버 업무 초안',targetRef:'FEAT-00289@0.1.0',version:2,createdBy:'usr-commerce',createdAt:'2026-11-09T00:00:00.000Z',updatedAt:'2026-11-09T00:00:00.000Z',activities:{},handoffs:[],artifacts:[{artifactId:'WPA-captured',activityId:activity.id,productKey:product.key,revision:1,by:'usr-commerce',at:'2026-11-09T00:00:00.000Z',fields,references:['FEAT-00289@0.1.0'],files:[],reason:'가상 시연 — 승인 전 초안'}] };
const history = [{id:1,caseId:item.caseId,version:1,action:'WORKFLOW_CASE_CREATE',by:'usr-commerce',at:item.createdAt,detail:{targetRef:item.targetRef}}];
const other = {...item,caseId:'WFC-other',processId:'FPW.1',createdBy:'usr-author',artifacts:[]};
const source = {targetRef:item.targetRef,status:'RESOLVED',items:[{kind:'FEATURE',id:'FEAT-00289',revision:'0.1.0',state:'PROPOSED',recordHash:'a'.repeat(64),record:{featureId:'FEAT-00289'},observedAt:item.createdAt,verification:'RECORD_OBSERVED'}],unavailable:[],limitation:'캡처 시점의 정본 조회. 외부 승인 검증 아님'};
const run=(name:string,role='commerce',params:Record<string,string>={},body?:unknown)=>sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,params),{params,role,body});
beforeEach(async()=>{
  vi.stubEnv('VITE_DATA_MODE','static'); localStorage.clear();
  const responses:Record<string,unknown>={};
  const add=(name:string,body:unknown,params:Record<string,string>={},query:Record<string,unknown>={})=>{responses[snapshotFile(routeUrl(name,params,query))]=body;};
  add('auditChain',{head:'a'.repeat(64),verified:0}); add('events',{items:[]},{},{limit:500,recent:'1'}); add('audit',{items:[]},{},{limit:500}); add('notifications',{items:[],unread:0,byCategory:{}},{},{limit:200});
  add('workflowCases',{items:[{caseId:item.caseId},{caseId:other.caseId}]});
  add('workflowCase',{item,history,roleIds:['R-SYS']},{id:item.caseId}); add('workflowCase',{item:other,history:[],roleIds:['R-SYS']},{id:other.caseId});
  add('workflowCaseSources',source,{id:item.caseId});
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{const body=responses[String(input).replace(/^\//,'')];return body?new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}}):new Response('<html>',{headers:{'Content-Type':'text/html'}});}));
  sim=await import('../api/sim'); engine=await import('../api/sim/engine');
});
afterEach(()=>{engine?.__resetSimForTest();vi.unstubAllEnvs();vi.unstubAllGlobals();localStorage.clear();});

it('hydrates identical server artifacts/history/sources while enforcing the requesting persona and preserving explicit role grants',async()=>{
  expect((await run('workflowCases')).items.map((c:any)=>c.caseId)).toEqual([item.caseId]);
  expect((await run('workflowCases','sysadmin')).items).toHaveLength(2);
  const detail=await run('workflowCase','commerce',{id:item.caseId});
  expect(detail.item).toEqual(item); expect(detail.history).toEqual(history);
  expect(detail.roleIds).toEqual(M.personas.commerce); expect(detail.roleIds).not.toContain('R-SYS');
  expect(await run('workflowCaseSources','commerce',{id:item.caseId})).toEqual(source);
  await expect(run('workflowCase','commerce',{id:other.caseId})).rejects.toMatchObject({status:403});
  expect((await run('workflowRoleGrants','sysadmin')).items).toEqual([]);
  expect(engine.__overlayForTest()!.audit).toHaveLength(0);
});

it('edits a captured draft with optimistic versions, keeps its original revision and never overwrites local changes on the next hydration',async()=>{
  const body={version:2,activityId:activity.id,productKey:product.key,fields:{...fields,'0':'로컬 보완'},references:['DEMO-LOCAL'],files:[],reason:'가상 시연 초안 보완'};
  const edited=await run('createWorkflowArtifact','commerce',{id:item.caseId},body);
  expect(edited.item.version).toBe(3); expect(edited.item.artifacts[0]).toEqual(item.artifacts[0]);
  expect(edited.item.artifacts[1].revision).toBe(2);
  await expect(run('createWorkflowArtifact','commerce',{id:item.caseId},body)).rejects.toMatchObject({status:412});
  expect((await run('workflowCase','sysadmin',{id:item.caseId})).item.artifacts[1].fields['0']).toBe('로컬 보완');
  expect((await run('workflowRoleGrants','sysadmin')).items).toEqual([]);
});
