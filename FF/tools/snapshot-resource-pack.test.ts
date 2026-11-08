import { afterEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { basename,join,resolve,sep } from 'node:path';
import { tmpdir } from 'node:os';
import { logicalFile,packArtifact,packedLogicalFiles,hash } from './snapshot-pack.ts';
import { packResources,resourceLogicalFiles } from './snapshot-resource-pack.ts';
import { RESOURCE_INDEX,resourcePacketFile,resourceRequest,PAGES_MAX_FILE_BYTES } from './snapshot-resource-format.ts';
import { onRequest } from '../functions/api-snapshot/[[path]].ts';
import { COOKIE,handle,signToken } from '../functions/_middleware.ts';

const roots:string[]=[];
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'ff-resource-pack-'));roots.push(root);const api=join(root,'api-snapshot');mkdirSync(api);
  const put=(file:string,value:unknown)=>writeFileSync(join(api,file),JSON.stringify(value));
  put('vehicles.json',{items:[{vin:'ego-01'}]});put('products.json',{items:[{catalogId:'CAT-00001'}]});put('policies.json',{items:[{flagKey:'flag_a',status:'DEPLOYED'}]});
  put('features_latestOnly_false.json',{items:[{featureId:'FEAT-00001',version:'1.0.0'}]});
  put(logicalFile('vehicleEligibility',{vin:'ego-01'},{catalogId:'CAT-00001'}),{eligible:true});put(logicalFile('activationDecide',{},{vin:'ego-01',flagKey:'flag_a'}),{value:false});
  const files=['vehicles_ego-01_runtime.json','vehicles_ego-01_requests.json','vehicles_ego-01_status.json','vehicles_ego-01_feature-state.json','vehicles_ego-01_verdicts.json','vehicles_ego-01_customer-state.json','vehicles_ego-01_openfeature.json','vehicles_ego-01_installs.json','features_FEAT-00001.json','features_FEAT-00001_history.json','features_FEAT-00001_reviews_version_1.0.0.json','features_FEAT-00001_versions_1.0.0_safety.json'];
  for(const suffix of ['baselines','evaluations','ops-metrics','reviews','trace-links'])files.push(`features_FEAT-00001_${suffix}.json`);
  for(const suffix of ['','_analysis','_baseline-checklist','_classification','_flag-code-gate','_gate-na-requests','_gates','_release-candidate','_release-signoff','_support-drills','_variability'])files.push(`features_FEAT-00001_versions_1.0.0${suffix}.json`);
  const originals=new Map(files.map((f,i)=>[f,` {"value":"한글 ${i}","actorRole":"${i%2?'AUDITOR':'FEATURE_AUTHOR'}","scope":"${f}"}\n`]));
  for(const [f,body]of originals)writeFileSync(join(api,f),body);
  put('workflow_cases.json',{items:[{roleIds:['R-SYS'],caseId:'WFC-private'}]});
  return{root,api,files,originals};
}
afterEach(()=>{for(const root of roots.splice(0)){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('ff-resource-pack-'));rmSync(root,{recursive:true,force:true});}});
const assets=(api:string,calls:string[])=>({fetch:async(request:Request)=>{const url=new URL(request.url);calls.push(url.pathname);assert.match(url.pathname,/^\/api-snapshot\/(vehicle-query-packets|resource-query-packets)\/[0-9a-f]{64}\.json$/);assert.equal(url.search,'');assert.equal(request.headers.get('Cookie'),null);const file=join(api,url.pathname.slice('/api-snapshot/'.length));return existsSync(file)?new Response(readFileSync(file,'utf8'),{headers:{'Content-Type':'application/json'}}):new Response(null,{status:404});}});

test('additional exact families preserve every byte and role metadata; workflow captures remain separate',async()=>{
  const f=fixture(),report=packArtifact(f.root);assert.equal(report.logical,30);
  assert.equal(resourceLogicalFiles(f.api).length,28);assert.equal(packedLogicalFiles(f.api).length,30);
  assert.equal(existsSync(join(f.api,'workflow_cases.json')),true);assert.equal(resourceRequest('workflow_cases.json'),null);
  const calls:string[]=[],env={ASSETS:assets(f.api,calls)};
  for(const [file,body]of f.originals)for(const method of ['GET','HEAD']){
    const r=await onRequest({request:new Request('https://local.test/api-snapshot/'+file,{method}),env,next:async()=>new Response(null,{status:404})});
    assert.equal(r.status,200);assert.equal(r.headers.get('Content-Length'),String(Buffer.byteLength(body)));assert.equal(await r.text(),method==='HEAD'?'':body);
  }
  assert.equal(packArtifact(f.root).idempotent,true);
});

test('canonical resource/version and packet path corruption fail closed without dropping raw records',()=>{
  const f=fixture();writeFileSync(join(f.api,'features_FEAT-00001_versions_9.0.0_safety.json'),'{}');
  assert.throws(()=>packResources(f.api),/canonical source/);assert.equal(existsSync(join(f.api,RESOURCE_INDEX)),false);
  for(const file of f.files)assert.equal(existsSync(join(f.api,file)),true);
});

test('a whole omitted resource group or query cannot be relabeled as complete canonical coverage',()=>{
  const f=fixture();packArtifact(f.root);const path=join(f.api,RESOURCE_INDEX),index=JSON.parse(readFileSync(path,'utf8'));
  const removed=index.packets.pop();index.logicalFiles-=removed.files.length;writeFileSync(path,JSON.stringify(index));
  assert.throws(()=>resourceLogicalFiles(f.api),/canonical ID coverage/);
});

test('resource packets and logical GET/HEAD remain behind the existing cookie gate',async()=>{
  const f=fixture();packArtifact(f.root);const calls:string[]=[],env={FF_GATE_SECRET:'unit-fixture-gate-key-only-32-chars',ASSETS:assets(f.api,calls)};
  for(const path of ['/api-snapshot/'+f.files[0],'/api-snapshot/'+resourcePacketFile(hash('FEATURE:FEAT-00001'))]){
    const request=new Request('https://local.test'+path);let next=0;
    const denied=await handle(request,env,async()=>{next++;return new Response('should not run');});assert.equal(denied.status,401);assert.equal(next,0);
  }
  const request=new Request('https://local.test/api-snapshot/'+f.files[8],{headers:{Cookie:`${COOKIE}=${await signToken(env.FF_GATE_SECRET,Date.now())}`}});
  const r=await handle(request,env,()=>onRequest({request,env,next:async()=>new Response(null,{status:404})}));assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control')??'',/private/);
});

test('encoded traversal, unknown query families and writes cannot select or reinterpret resource packets',async()=>{
  const f=fixture();packArtifact(f.root);const calls:string[]=[],env={ASSETS:assets(f.api,calls)};
  for(const file of ['features_FEAT-00001_unknown.json','features_FEAT-%2f.._history.json','vehicles_ego%2f.._runtime.json','vehicles_ego-01_runtime_actorRole_SYSTEM_ADMIN.json']){
    const r=await onRequest({request:new Request('https://local.test/api-snapshot/'+file),env,next:async()=>new Response('unsafe fallback')});assert.equal(r.status,404);
  }
  const r=await onRequest({request:new Request('https://local.test/api-snapshot/'+f.files[0],{method:'POST'}),env,next:async()=>new Response('unsafe fallback')});assert.equal(r.status,405);assert.equal(calls.length,0);
});

test('corrupt resources do not count as coverage; a packet larger than 25MiB never replaces the originals',()=>{
  const f=fixture();packArtifact(f.root);const index=JSON.parse(readFileSync(join(f.api,RESOURCE_INDEX),'utf8'));index.packets[0].file='../../outside.json';writeFileSync(join(f.api,RESOURCE_INDEX),JSON.stringify(index));assert.throws(()=>resourceLogicalFiles(f.api),/resource path/);
  const large=fixture();writeFileSync(join(large.api,large.files[0]),JSON.stringify({value:'x'.repeat(PAGES_MAX_FILE_BYTES)}));assert.throws(()=>packResources(large.api),/25MiB/);assert.equal(existsSync(join(large.api,large.files[0])),true);assert.equal(existsSync(join(large.api,RESOURCE_INDEX)),false);
});
