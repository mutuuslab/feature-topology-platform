import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { createHash,generateKeyPairSync,sign,webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';
import { canonicalJson,ROUTES,routeUrl,snapshotFile } from '@ff/contracts';
let sim:typeof import('../api/sim'),engine:typeof import('../api/sim/engine'),sources:Map<string,unknown>,capture:any,sequence=0,bytesRequests=0;
const F='FEAT-00022',V='1.0.0',VIN='VIN-SW-TEST',FLAG='flag-software',ID='SWP-software-test';
const bytes=Buffer.from('export const original = "actual signed bytes";\n'),sha=createHash('sha256').update(bytes).digest('hex');
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const f={featureId:F,version:V,name:'SW source',description:'SW source',country:'KR',vehicleModel:'NX',trim:'Base',ownerId:'usr-author',swIds:['SW-REAL'],swVersions:['1.0.0'],upgVc:['VC-REAL'],lifecycle:'APPROVED',baselineId:null,tags:[],controlPoints:[],functions:[],ecuPnos:[],requirementIds:[],dependencyIds:[],catalogIds:[],gateRecordIds:[],_missing:{},asil:'QM'};
const policy={policyId:'POL-00001',revision:1,featureId:F,featureVersion:V,flagKey:FLAG,status:'DEPLOYED',enabled:true,safeDefault:false,strategies:[],entitlementCatalogId:null,rollout:{mode:'ALL',basisPoints:10000,salt:'software-tests'},stageBasisPoints:null,contentHash:'policy-source'};
const vehicle={vin:VIN,label:'Trusted source vehicle',country:'KR',vehicleModel:'NX',trim:'Base',quality:'TRUSTED',upgVc:'VC-REAL',swVersion:'1.0.0',canary:false};
function packageOf(){
 const p={packageId:ID,featureId:F,featureVersion:V,swId:'SW-REAL',fileId:'native-only',name:'FEAT-00022-1.0.0-demo.mjs',bytes:bytes.length,sha256:sha,mediaType:'text/javascript',source:'EXECUTABLE_DEMO',status:'APPROVED',revision:2,createdBy:'usr-integrator',createdAt:'2026-11-09T00:00:00Z',reviewedBy:'usr-coordinator',reviewedAt:'2026-11-09T00:01:00Z',sbom:{bomFormat:'CycloneDX'}};
 const {fileId,status,revision,...fields}=p,manifest={schema:'ff.software.v1',...fields},payloadHash='sha256:'+createHash('sha256').update(canonicalJson(manifest)).digest('hex');
 return {...p,signature:{keyId:'KEY-0001',alg:'Ed25519',payloadHash,signature:sign(null,Buffer.from(payloadHash),privateKey).toString('base64')}};
}
const set=(name:string,body:unknown,params={},query={})=>sources.set('/'+snapshotFile(routeUrl(name,params,query)),body);
const run=(name:string,role='integrator',body?:unknown,params:Record<string,string>={},query:Record<string,string>={})=>sim.simCall<any>(ROUTES.find(r=>r.name===name)!,routeUrl(name,params,query),{role,body,params,query});
beforeEach(async()=>{
 vi.stubEnv('VITE_DATA_MODE','static');vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',NodeBlob);localStorage.clear();sources=new Map();bytesRequests=0;
 const p=packageOf(),{signature,...visible}=p,{fileId,status,revision,...fields}=visible,manifest={schema:'ff.software.v1',...fields};
 capture={package:p,verdict:{allowed:true,blocked:null,package:p,manifest,signature,publicKey:{pem:publicKey.export({type:'spki',format:'pem'}).toString(),purpose:'policy',notAfter:'2099-01-01T00:00:00Z'}},asset:`api-snapshot/files/software/${sha}.mjs`,expectedSha256:sha,sourceCommit:'a'.repeat(40),capturedAt:'2026-11-09T00:00:00Z'};
 set('softwarePackages',{items:[p]});set('softwareDownloadHistory',{items:[]},{id:ID});
 set('auditChain',{head:`software-tests-${++sequence}`,verified:0});set('events',{items:[]});set('audit',{items:[]});
 set('listPolicies',{items:[policy]});set('policyDetail',{policy},{id:policy.policyId});
 set('vehicles',{items:[vehicle]});set('killRequests',{items:[]});set('exceptionPolicies',{items:[]});
 set('listFeatures',{items:[f]}, {},{latestOnly:false});set('featureDetail',{feature:f,meta:{createdBy:'usr-author'},gates:{},versions:[{version:V,lifecycle:'APPROVED'}],trace:[],dependencies:{outgoing:[],incoming:[]},functions:[],products:[],transitions:[]},{id:F,ver:V});
 sources.set('/api-snapshot/software-demo-index.json',{schema:'ff.software-demo-capture.v1',items:[capture]});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  const path=String(url);if(path.endsWith('/'+capture.asset)){bytesRequests++;return new Response(bytes);}
  const matched=[...sources].find(([key])=>path.endsWith(key));return matched?new Response(JSON.stringify(matched[1]),{headers:{'Content-Type':'application/json'}}):new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
 }));
 sim=await import('../api/sim');engine=await import('../api/sim/engine');
});
afterEach(()=>{engine.__resetSimForTest();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();localStorage.clear();});
it('verifies native-captured bytes, applies real current Flag rules, and atomically records a browser receipt',async()=>{
 const verdict=await run('checkSoftwareDownload','integrator',{vin:VIN,flagKey:FLAG},{id:ID});expect(verdict).toMatchObject({allowed:true,provenance:'CAPTURED_EXECUTABLE_DEMO',package:{provenance:'CAPTURED_EXECUTABLE_DEMO'},evaluation:{value:true,reason:'POLICY_MATCH'}});
 const blob=await run('softwareDownload','integrator',undefined,{id:ID},{vin:VIN,flagKey:FLAG});expect(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex')).toBe(sha);
 expect((await run('softwareDownloadHistory','viewer',undefined,{id:ID})).items[0]).toMatchObject({state:'BROWSER_BLOB_READY',bytes:bytes.length,sha256:sha,provenance:'LOCAL_SIMULATION'});
 expect(bytesRequests).toBe(1);
});
it.each(['off','none','unsupported','unknown','killed'] as const)('re-evaluates changed source %s and denies original bytes',async kind=>{
 if(kind==='off')set('listPolicies',{items:[{...policy,enabled:false}]});
 if(kind==='none')set('listPolicies',{items:[{...policy,rollout:{...policy.rollout,mode:'NONE'}}]});
 if(kind==='unsupported')set('vehicles',{items:[{...vehicle,swVersion:'0.0.1'}]});
 if(kind==='unknown')set('vehicles',{items:[{...vehicle,quality:'UNKNOWN'}]});
 if(kind==='killed')set('killRequests',{items:[{killId:'KILL-test',featureId:F,status:'ACTIVE',vins:[VIN]}]});
 const verdict=await run('checkSoftwareDownload','integrator',{vin:VIN,flagKey:FLAG},{id:ID});expect(verdict.allowed).toBe(false);
 await expect(run('softwareDownload','integrator',undefined,{id:ID},{vin:VIN,flagKey:FLAG})).rejects.toMatchObject({status:422});expect(bytesRequests).toBe(0);
});
it('checks changed Flag policy again after a previous positive verdict',async()=>{
 expect((await run('checkSoftwareDownload','integrator',{vin:VIN,flagKey:FLAG},{id:ID})).allowed).toBe(true);
 engine.__overlayForTest()!.entities.policy={[policy.policyId]:{...policy,enabled:false}};
 await expect(run('softwareDownload','integrator',undefined,{id:ID},{vin:VIN,flagKey:FLAG})).rejects.toMatchObject({status:422});expect(bytesRequests).toBe(0);
});
it.each(['absent','signature','expired','altered metadata'] as const)('never releases native private or invalid capture: %s',async kind=>{
 if(kind==='absent')sources.delete('/api-snapshot/software-demo-index.json');
 if(kind==='signature')capture.package.signature.signature=Buffer.alloc(64).toString('base64');
 if(kind==='expired')capture.verdict.publicKey.notAfter='2020-01-01T00:00:00Z';
 if(kind==='altered metadata')set('softwarePackages',{items:[{...packageOf(),swId:'SW-ALTERED'}]});
 const verdict=await run('checkSoftwareDownload','integrator',{vin:VIN,flagKey:FLAG},{id:ID});expect(verdict.allowed).toBe(false);expect(bytesRequests).toBe(0);
});
it('enforces download roles and refuses to fabricate signed vehicle identity',async()=>{
 await expect(run('softwareDownload','viewer',undefined,{id:ID},{vin:VIN,flagKey:FLAG})).rejects.toMatchObject({status:403});
 await expect(run('vehicleSoftwareManifest','viewer',undefined,{id:ID,vin:VIN},{flagKey:FLAG})).rejects.toMatchObject({status:403});expect(bytesRequests).toBe(0);
});
it('rejects corrupted public bytes before committing a successful receipt',async()=>{
 const original=globalThis.fetch;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>String(url).endsWith('/'+capture.asset)?new Response('corrupt software'):original(url)));
 await expect(run('softwareDownload','integrator',undefined,{id:ID},{vin:VIN,flagKey:FLAG})).rejects.toMatchObject({status:422});
 expect((await run('softwareDownloadHistory','viewer',undefined,{id:ID})).items).toEqual([]);
});
it('does not acknowledge local uploads without actual IndexedDB byte storage',async()=>{
 await expect(run('uploadSoftware','integrator',{blob:new NodeBlob(['actual bytes']),name:'test.mjs',mediaType:'text/javascript',requestKey:'software-file-test'})).rejects.toThrow(/IndexedDB/);
 expect((await run('softwarePackages')).items).toHaveLength(1);
});
it('preserves revision, independent-review and author-role boundaries before any byte access',async()=>{
 await expect(run('reviewSoftwarePackage','coordinator',{revision:1,decision:'REVOKE',reason:'Stale revision'},{id:ID})).rejects.toMatchObject({status:412});
 set('softwarePackages',{items:[{...packageOf(),status:'DRAFT',createdBy:'usr-coordinator',revision:1}]});engine.__resetSimForTest();
 await expect(run('reviewSoftwarePackage','coordinator',{revision:1,decision:'APPROVE',reason:'Cannot self approve'},{id:ID})).rejects.toMatchObject({status:403});
 await expect(run('createSoftwarePackage','viewer',{})).rejects.toMatchObject({status:403});
 expect(bytesRequests).toBe(0);
});
it('restricts audited GET effects to explicitly declared binary download routes',()=>{
 expect(()=>engine.registerSimDownload('softwarePackage',async()=>({ok:true}))).toThrow(/바이너리 GET/);
});
