// Only explicitly allowlisted, independently reviewed executable demos may enter a public static artifact.
import { createHash, randomUUID, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { FF } from './lib.ts';
const require=createRequire(import.meta.url);
const {canonicalJson,routeUrl}=require(join(FF,'contracts','dist','index.js')) as typeof import('../contracts/src/index');
export const SOFTWARE_DEMO_PREFIX='// Feature Platform executable test software. No ECU installation.\n';
export const SOFTWARE_DEMO_INDEX='api-snapshot/software-demo-index.json';
const MAX_BYTES=4*1024*1024;
export interface SoftwareDemoAllow {packageId:string;vin:string;flagKey:string;expectedSha256:string}
export interface SoftwareDemoCaptureOptions {apiUrl:string;outDir:string;expectedBuildSha:string;allowlist:SoftwareDemoAllow[];headers?:Record<string,string>}
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
function requireValue(value:unknown,message:string):asserts value{if(!value)throw new Error(`SW demo capture: ${message}`);}
/** Explicit public showcase preset. Only our generated test source enters the isolated snapshot API. */
export async function prepareSnapshotSoftwareDemo(options:{apiUrl:string;expectedBuildSha:string}):Promise<Omit<SoftwareDemoCaptureOptions,'outDir'>>{
  const url=new URL(options.apiUrl);
  requireValue(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&!url.username&&!url.password&&!url.search&&!url.hash,'snapshot preparation requires a loopback demo API');
  requireValue(/^[a-f0-9]{40}$/.test(options.expectedBuildSha),'full snapshot source SHA required');
  const author={'X-Actor-Id':'usr-integrator','X-Actor-Role':'IMPLEMENTER'};
  const reviewer={'X-Actor-Id':'usr-coordinator','X-Actor-Role':'RELEASE_MANAGER'};
  async function call(path:string,init:RequestInit={}){
    const response=await fetch(options.apiUrl.replace(/\/$/,'')+path,{...init,headers:{...author,...init.headers}});
    requireValue(response.ok,`snapshot preparation HTTP ${response.status}`);return response;
  }
  const health=await(await call(routeUrl('health'))).json();
  requireValue(health.status==='ok'&&health.mode==='demo'&&health.commit===options.expectedBuildSha,'snapshot API source or demo mode mismatch');
  const {feature:f}=await(await call(routeUrl('featureDetail',{id:'FEAT-00022',ver:'1.0.0'}))).json();
  requireValue(f?.featureId==='FEAT-00022'&&f.version==='1.0.0'&&Array.isArray(f.swIds)&&typeof f.swIds[0]==='string'&&f.swIds[0],'public showcase Feature and SW component required');
  const metadata={featureId:f.featureId,featureVersion:f.version,swId:f.swIds[0],source:'EXECUTABLE_DEMO',installationPerformed:false};
  const bytes=Buffer.from(SOFTWARE_DEMO_PREFIX+`export const metadata = ${JSON.stringify(metadata,null,2)};\nexport function calculate(a, b) { return Number(a) + Number(b); }\nconsole.log(JSON.stringify({ ...metadata, selfTest: calculate(2, 3) === 5 }));\n`);
  const sha256=hash(bytes),name=`${f.featureId}-${f.version}-demo.mjs`;
  const uploaded=await(await call(routeUrl('uploadSoftware'),{method:'POST',headers:{'Content-Type':'application/octet-stream','Idempotency-Key':randomUUID(),'X-File-Name':name,'X-File-Type':'text/javascript'},body:bytes})).json();
  requireValue(typeof uploaded.fileId==='string'&&uploaded.sha256===sha256&&uploaded.bytes===bytes.length,'uploaded public demo bytes must match the generated template');
  const draft=await(await call(routeUrl('createSoftwarePackage'),{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({fileId:uploaded.fileId,featureId:f.featureId,featureVersion:f.version,swId:f.swIds[0],sha256,source:'EXECUTABLE_DEMO',reason:'Public snapshot: generated test software; no vehicle installation.'})})).json();
  requireValue(/^SWP-[A-Za-z0-9-]+$/.test(draft.packageId)&&draft.status==='DRAFT'&&draft.createdBy===author['X-Actor-Id']&&draft.sha256===sha256,'native draft must preserve the generated source and author');
  const reviewed=await(await call(routeUrl('reviewSoftwarePackage',{id:draft.packageId}),{method:'POST',headers:{...reviewer,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({revision:draft.revision,decision:'APPROVE',reason:'Public snapshot: separate demo-role review of the generated template; no installation.'})})).json();
  requireValue(reviewed.packageId===draft.packageId&&reviewed.status==='APPROVED'&&reviewed.createdBy===author['X-Actor-Id']&&reviewed.reviewedBy===reviewer['X-Actor-Id']&&reviewed.sha256===sha256,'separate native demo-role review required');
  // The strict capture still performs the actual Flag verdict, native download, Ed25519 and byte verification.
  return {apiUrl:options.apiUrl,expectedBuildSha:options.expectedBuildSha,allowlist:[{packageId:draft.packageId,vin:'KMH-NX4-0001',flagKey:'care_00022_signal',expectedSha256:sha256}]};
}
export async function captureSoftwareDemos(options:SoftwareDemoCaptureOptions){
  requireValue(/^https?:\/\//.test(options.apiUrl)&&/^[a-f0-9]{40}$/.test(options.expectedBuildSha),'explicit API URL and full source SHA required');
  requireValue(Array.isArray(options.allowlist)&&options.allowlist.length>0&&new Set(options.allowlist.map(a=>a.packageId)).size===options.allowlist.length,'unique explicit package allowlist required');
  const headers={'X-Actor-Id':'usr-integrator','X-Actor-Role':'IMPLEMENTER',...options.headers};
  async function call(path:string,init:RequestInit={}){const response=await fetch(options.apiUrl.replace(/\/$/,'')+path,{...init,headers:{...headers,...init.headers}});requireValue(response.ok,`HTTP ${response.status} for allowed capture`);return response;}
  const health=await (await call(routeUrl('health'))).json();
  requireValue(health.status==='ok'&&health.mode==='demo'&&health.commit===options.expectedBuildSha,'API source or demo mode mismatch');
  const pending:{item:any;bytes:Buffer}[]=[];
  // Validate every item before writing any public bytes. A later failure must not leave an earlier secret-looking partial package.
  for(const allowed of options.allowlist){
    requireValue(/^SWP-[A-Za-z0-9-]+$/.test(allowed.packageId)&&/^[a-f0-9]{64}$/.test(allowed.expectedSha256)&&allowed.vin&&allowed.flagKey,'invalid allowlist entry');
    const verdict=await (await call(routeUrl('checkSoftwareDownload',{id:allowed.packageId}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vin:allowed.vin,flagKey:allowed.flagKey})})).json();
    const p=verdict.package,m=verdict.manifest,s=verdict.signature,k=verdict.publicKey;
    requireValue(verdict.allowed===true&&verdict.blocked===null&&verdict.vin===allowed.vin&&verdict.flagKey===allowed.flagKey&&verdict.evaluation?.value===true&&verdict.evaluation?.reason==='POLICY_MATCH','native Flag download verdict must allow this exact VIN and flag');
    requireValue(p?.packageId===allowed.packageId&&p.status==='APPROVED'&&p.source==='EXECUTABLE_DEMO'&&p.sha256===allowed.expectedSha256,'only approved allowlisted executable demo hashes may be captured');
    requireValue(p.createdBy&&p.reviewedBy&&p.createdBy!==p.reviewedBy&&p.reviewedAt,'independent native review is required');
    requireValue(p.mediaType==='text/javascript'&&p.name===`${p.featureId}-${p.featureVersion}-demo.mjs`&&p.bytes>0&&p.bytes<=MAX_BYTES,'only bounded JavaScript demo files may be captured');
    requireValue(m?.schema==='ff.software.v1'&&['packageId','featureId','featureVersion','swId','name','bytes','sha256','mediaType','source','createdBy','createdAt','reviewedBy','reviewedAt'].every(key=>m[key]===p[key])&&canonicalJson(m.sbom)===canonicalJson(p.sbom),'native signed manifest and visible package must match');
    requireValue(k?.purpose==='policy'&&Number.isFinite(Date.parse(k.notAfter))&&Date.parse(k.notAfter)>Date.now()&&s?.alg==='Ed25519','live policy-purpose signing key required');
    requireValue(s.payloadHash==='sha256:'+hash(canonicalJson(m))&&verify(null,Buffer.from(s.payloadHash),k.pem,Buffer.from(s.signature,'base64')),'native Ed25519 manifest signature verification failed');
    const response=await call(routeUrl('softwareDownload',{id:allowed.packageId},{vin:allowed.vin,flagKey:allowed.flagKey}));
    requireValue(response.headers.get('X-Content-SHA256')===allowed.expectedSha256,'native byte response digest must match the allowlist');
    const bytes=Buffer.from(await response.arrayBuffer());requireValue(bytes.length===p.bytes&&hash(bytes)===allowed.expectedSha256,'actual downloaded byte length or SHA mismatch');
    const text=bytes.toString('utf8');requireValue(text.startsWith(SOFTWARE_DEMO_PREFIX)&&Buffer.from(text).equals(bytes),'demo marker or UTF-8 source mismatch');
    const match=/export const metadata = (\{[\s\S]*?\});\r?\nexport function calculate/.exec(text);requireValue(match,'expected executable demo metadata required');
    const metadata=JSON.parse(match[1]);requireValue(metadata.source==='EXECUTABLE_DEMO'&&metadata.installationPerformed===false&&metadata.featureId===p.featureId&&metadata.featureVersion===p.featureVersion&&metadata.swId===p.swId,'explicit demo/non-installation metadata must match this Feature and SW');
    const history=await (await call(routeUrl('softwareDownloadHistory',{id:allowed.packageId}))).json();requireValue(Array.isArray(history.items),'native download history is required');
    pending.push({item:{package:{...p,provenance:'CAPTURED_EXECUTABLE_DEMO'},verdict,history,asset:`api-snapshot/files/software/${allowed.expectedSha256}.mjs`,expectedSha256:allowed.expectedSha256,sourceCommit:health.commit,capturedAt:new Date().toISOString()},bytes});
  }
  const index={schema:'ff.software-demo-capture.v1',sourceCommit:health.commit,items:pending.map(p=>p.item)};
  const target=join(options.outDir,SOFTWARE_DEMO_INDEX);requireValue(!existsSync(target),'capture index already exists; use a fresh artifact directory');
  for(const {item,bytes} of pending){const path=join(options.outDir,item.asset);mkdirSync(dirname(path),{recursive:true});if(existsSync(path))requireValue(hash(readFileSync(path))===item.expectedSha256,'existing demo asset hash mismatch');else writeFileSync(path,bytes);}
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(index));
  return {items:pending.length,bytes:pending.reduce((sum,p)=>sum+p.bytes.length,0),sourceCommit:health.commit,index:SOFTWARE_DEMO_INDEX};
}
