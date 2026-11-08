import assert from 'node:assert/strict';
import { createHash,generateKeyPairSync,sign } from 'node:crypto';
import { mkdtempSync,existsSync,readFileSync,rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename,join,resolve,sep } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { captureSoftwareDemos,SOFTWARE_DEMO_INDEX,SOFTWARE_DEMO_PREFIX } from './software-demo-capture.ts';
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
