import assert from 'node:assert/strict';
import { createHash,generateKeyPairSync,sign } from 'node:crypto';
import { mkdtempSync,existsSync,readFileSync,rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename,join,resolve,sep } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { captureSoftwareDemos,prepareSnapshotSoftwareDemo,SOFTWARE_DEMO_INDEX,SOFTWARE_DEMO_PREFIX } from './software-demo-capture.ts';
import { FF } from './lib.ts';
const require=createRequire(import.meta.url),{canonicalJson}=require(join(FF,'contracts/dist/index.js'));
const SOURCE='a'.repeat(40),{privateKey,publicKey}=generateKeyPairSync('ed25519');
function cleanup(path:string){const target=resolve(path),root=resolve(tmpdir());assert.ok(target.startsWith(root+sep)&&basename(target).startsWith('ff-software-'));rmSync(target,{recursive:true,force:true});}
function fixture(change=''){
  const metadata={featureId:'FEAT-00022',featureVersion:'1.0.0',swId:'SW-TEST',source:'EXECUTABLE_DEMO',installationPerformed:false};
  const bytes=Buffer.from((change==='marker'?'// private unmarked software\n':SOFTWARE_DEMO_PREFIX)+`export const metadata = ${JSON.stringify(metadata)};\nexport function calculate(a,b){return a+b;}\n`);
  const sha=createHash('sha256').update(bytes).digest('hex');
  const p={packageId:'SWP-test-package',featureId:metadata.featureId,featureVersion:metadata.featureVersion,swId:metadata.swId,fileId:'file',name:'FEAT-00022-1.0.0-demo.mjs',bytes:bytes.length,sha256:sha,mediaType:'text/javascript',source:change==='source'?'UPLOADED_SOFTWARE':'EXECUTABLE_DEMO',status:'APPROVED',revision:2,createdBy:'usr-dev',createdAt:'2026-11-09T00:00:00Z',reviewedBy:change==='self'?'usr-dev':'usr-rm',reviewedAt:'2026-11-09T00:00:01Z',sbom:{bomFormat:'CycloneDX'}};
  const {fileId,status,revision,...signed}=p,m={schema:'ff.software.v1',...signed},payloadHash='sha256:'+createHash('sha256').update(canonicalJson(m)).digest('hex');
  const verdict={allowed:change!=='blocked',blocked:change==='blocked'?'KILL_SWITCH':null,vin:'VIN-TEST',flagKey:'flag-test',package:p,manifest:m,signature:{keyId:'KEY-0001',alg:'Ed25519',payloadHash,signature:sign(null,Buffer.from(payloadHash),privateKey).toString('base64')},publicKey:{pem:publicKey.export({type:'spki',format:'pem'}).toString(),purpose:'policy',notAfter:change==='expiry'?'2020-01-01T00:00:00Z':'2099-01-01T00:00:00Z'},evaluation:{value:true,reason:'POLICY_MATCH'}};
  if(change==='signature')verdict.signature.signature=Buffer.alloc(64).toString('base64');
  return {bytes,verdict,allow:{packageId:p.packageId,vin:verdict.vin,flagKey:verdict.flagKey,expectedSha256:change==='allowhash'?'0'.repeat(64):sha}};
}
async function withServer(change:string,fn:(apiUrl:string,f:ReturnType<typeof fixture>)=>Promise<void>){
  const f=fixture(change),server=createServer((req,res)=>{
    if(req.url==='/api/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',mode:'demo',commit:SOURCE}));}
    else if(req.url?.endsWith('/check')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(f.verdict));}
    else if(req.url?.includes('/download?')){res.setHeader('Content-Type','application/octet-stream');res.setHeader('X-Content-SHA256',f.verdict.package.sha256);res.end(change==='bytes'?Buffer.from('corrupt original'):f.bytes);}
    else if(req.url?.endsWith('/history')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:[{state:'STREAM_OPENED'}]}));}
    else{res.statusCode=404;res.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${(server.address() as any).port}`,f);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
test('captures only the exact approved demo and preserves native signature plus original bytes',async()=>{
  const out=mkdtempSync(join(tmpdir(),'ff-software-capture-'));
  try{await withServer('',async(apiUrl,f)=>{
    const result=await captureSoftwareDemos({apiUrl,outDir:out,expectedBuildSha:SOURCE,allowlist:[f.allow]});assert.equal(result.items,1);
    const index=JSON.parse(readFileSync(join(out,SOFTWARE_DEMO_INDEX),'utf8')),row=index.items[0];
    assert.equal(row.package.provenance,'CAPTURED_EXECUTABLE_DEMO');assert.equal(row.verdict.signature.signature,f.verdict.signature.signature);assert.deepEqual(readFileSync(join(out,row.asset)),f.bytes);
  });}finally{cleanup(out);}
});
for(const change of ['source','self','blocked','expiry','signature','bytes','marker','allowhash'])test(`rejects ${change} without writing a public index or byte directory`,async()=>{
  const out=mkdtempSync(join(tmpdir(),'ff-software-reject-'));
  try{await withServer(change,async(apiUrl,f)=>{await assert.rejects(captureSoftwareDemos({apiUrl,outDir:out,expectedBuildSha:SOURCE,allowlist:[f.allow]}));assert.equal(existsSync(join(out,'api-snapshot')),false);});}finally{cleanup(out);}
});
test('requires exact source SHA and a nonempty explicit allowlist',async()=>{
  const out=mkdtempSync(join(tmpdir(),'ff-software-boundary-'));
  try{await withServer('',async(apiUrl,f)=>{
    await assert.rejects(captureSoftwareDemos({apiUrl,outDir:out,expectedBuildSha:'b'.repeat(40),allowlist:[f.allow]}),/source/);
    await assert.rejects(captureSoftwareDemos({apiUrl,outDir:out,expectedBuildSha:SOURCE,allowlist:[]}),/allowlist/);
    assert.equal(existsSync(join(out,'api-snapshot')),false);
  });}finally{cleanup(out);}
});

async function withPreparation(change:string,fn:(apiUrl:string,state:{writes:string[];uploaded:Buffer;roles:string[]})=>Promise<void>){
  const state={writes:[] as string[],uploaded:Buffer.alloc(0),roles:[] as string[]};
  const server=createServer(async(req,res)=>{
    const parts:Buffer[]=[];for await(const chunk of req)parts.push(Buffer.from(chunk));
    const body=Buffer.concat(parts),url=req.url??'';res.setHeader('Content-Type','application/json');
    if(req.method==='POST'){state.writes.push(url);state.roles.push(`${req.headers['x-actor-id']}:${req.headers['x-actor-role']}`);}
    if(url==='/api/health')return res.end(JSON.stringify({status:'ok',mode:change==='production'?'production':'demo',commit:change==='sha'?'b'.repeat(40):SOURCE}));
    if(url==='/api/features/FEAT-00022/versions/1.0.0')return res.end(JSON.stringify({feature:{featureId:'FEAT-00022',version:'1.0.0',swIds:change==='component'?[]:['SW-TEST']}}));
    if(url==='/api/software/uploads'){
      state.uploaded=body;assert.equal(req.headers['content-type'],'application/octet-stream');
      assert.equal(req.headers['x-file-name'],'FEAT-00022-1.0.0-demo.mjs');assert.equal(req.headers['x-file-type'],'text/javascript');
      res.statusCode=201;return res.end(JSON.stringify({fileId:'file-demo',bytes:body.length,sha256:change==='upload'?'0'.repeat(64):createHash('sha256').update(body).digest('hex')}));
    }
    if(url==='/api/software/packages'){
      const payload=JSON.parse(body.toString());assert.equal(payload.fileId,'file-demo');assert.equal(payload.source,'EXECUTABLE_DEMO');
      assert.equal(payload.sha256,createHash('sha256').update(state.uploaded).digest('hex'));assert.equal(payload.swId,'SW-TEST');
      res.statusCode=201;return res.end(JSON.stringify({packageId:'SWP-public-demo',revision:1,status:'DRAFT',createdBy:'usr-integrator',sha256:payload.sha256}));
    }
    if(url==='/api/software/packages/SWP-public-demo/review'){
      const payload=JSON.parse(body.toString());assert.equal(payload.revision,1);assert.equal(payload.decision,'APPROVE');
      return res.end(JSON.stringify({packageId:'SWP-public-demo',status:'APPROVED',createdBy:'usr-integrator',reviewedBy:change==='self'?'usr-integrator':'usr-coordinator',sha256:createHash('sha256').update(state.uploaded).digest('hex')}));
    }
    res.statusCode=404;res.end();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${(server.address() as any).port}`,state);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}

test('showcase prepares only the generated executable bytes via upload and a separate demo review',async()=>{
  await withPreparation('',async(apiUrl,state)=>{
    const result=await prepareSnapshotSoftwareDemo({apiUrl,expectedBuildSha:SOURCE});
    assert.deepEqual(state.roles,['usr-integrator:IMPLEMENTER','usr-integrator:IMPLEMENTER','usr-coordinator:RELEASE_MANAGER']);
    assert.equal(result.allowlist.length,1);assert.equal(result.allowlist[0].expectedSha256,createHash('sha256').update(state.uploaded).digest('hex'));
    assert.equal(result.allowlist[0].vin,'KMH-NX4-0001');assert.equal(result.allowlist[0].flagKey,'care_00022_signal');
    const logs:string[]=[];
    runInNewContext(state.uploaded.toString().replace('export const metadata','const metadata').replace('export function calculate','function calculate'),{console:{log:(v:string)=>logs.push(v)}},{timeout:1000});
    const execution=JSON.parse(logs[0]);assert.equal(execution.selfTest,true);assert.equal(execution.installationPerformed,false);assert.equal(execution.swId,'SW-TEST');
  });
});
for(const change of ['production','sha','component','upload','self'])test(`showcase preparation rejects ${change} before producing a capture allowlist`,async()=>{
  await withPreparation(change,async(apiUrl,state)=>{
    await assert.rejects(prepareSnapshotSoftwareDemo({apiUrl,expectedBuildSha:SOURCE}));
    assert.equal(state.writes.length,['production','sha','component'].includes(change)?0:change==='upload'?1:3);
  });
});
test('showcase preparation rejects a non-loopback API before making a request',async()=>{
  await assert.rejects(prepareSnapshotSoftwareDemo({apiUrl:'https://example.com',expectedBuildSha:SOURCE}),/loopback/);
});
