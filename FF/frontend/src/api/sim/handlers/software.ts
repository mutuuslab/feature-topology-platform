// Software delivered inside a browser is explicitly LOCAL_SIMULATION. Native-signed executable demos require an explicit byte-capture allowlist.
import { canonicalJson, evaluateFlag, grantState, variantRow } from '@ff/contracts';
import { SoftwareDownloadCheckBody, SoftwarePackageBody, SoftwarePackageDecisionBody } from '../../../../../contracts/src/schemas/software-delivery';
import { gateDenied } from '../../client';
import { sha256, verifySoftwareManifest, type SoftwareVerdict } from '../../software';
import { readBrowserBinary, stageBrowserBinary, verifiedBrowserBlob } from '../binary-store';
import { registerSimDownload, registerSimHandler, registerSimReader, SimError } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';

const PACKAGE='softwarePackage',DOWNLOAD='softwareDownload',COMPONENT='D04-01';
const LOCAL='LOCAL_SIMULATION',CAPTURED='CAPTURED_EXECUTABLE_DEMO';
type Package=Record<string,any>&{packageId:string;featureId:string;featureVersion:string;swId:string;fileId:string;name:string;bytes:number;sha256:string;mediaType:string;source:string;status:string;revision:number;createdBy:string;createdAt:string;reviewedBy:string|null;reviewedAt:string|null;signature:any;sbom:Record<string,unknown>;provenance?:string;publicKey?:any};
interface Capture {package:Package;verdict:SoftwareVerdict;asset:string;expectedSha256:string;sourceCommit:string;capturedAt:string}
async function captures():Promise<Capture[]>{
  const response=await fetch(import.meta.env.BASE_URL+'api-snapshot/software-demo-index.json');
  const gate=await gateDenied(response);if(gate)throw gate;
  if(response.status===404||!(response.headers.get('content-type')??'').includes('json'))return [];
  if(!response.ok)throw new SimError('INTERNAL','SW 공개 시험 원문 인덱스를 읽지 못했습니다.');
  const index=await response.json();if(index.schema!=='ff.software-demo-capture.v1'||!Array.isArray(index.items))throw new SimError('INTERNAL','SW 공개 시험 원문 인덱스 형식이 다릅니다.');
  return index.items;
}
async function packages(ctx:SimReadContext):Promise<Package[]>{
  const base=await ctx.snapshot<{items:Package[]}>('softwarePackages');
  if(!base||!Array.isArray(base.items))throw new SimError('INTERNAL','SW 패키지 원천 스냅샷이 없습니다.');
  const map=new Map(base.items.map(p=>[p.packageId,p]));
  for(const capture of await captures())map.set(capture.package.packageId,{...(map.get(capture.package.packageId)??capture.package),provenance:CAPTURED});
  for(const item of ctx.list<Package>(PACKAGE))map.set(item.packageId,item);
  return [...map.values()].sort((a,b)=>a.packageId.localeCompare(b.packageId));
}
async function get(ctx:SimReadContext,id:string){const item=(await packages(ctx)).find(p=>p.packageId===id);if(!item)throw new SimError('NOT_FOUND','SW 패키지를 찾을 수 없습니다.');return item;}
const manifest=(p:Package)=>({schema:'ff.software.v1',packageId:p.packageId,featureId:p.featureId,featureVersion:p.featureVersion,swId:p.swId,name:p.name,bytes:p.bytes,sha256:p.sha256,mediaType:p.mediaType,source:p.source,sbom:p.sbom,createdBy:p.createdBy,createdAt:p.createdAt,reviewedBy:p.reviewedBy,reviewedAt:p.reviewedAt,...(p.provenance===LOCAL?{provenance:LOCAL}:{})});
const writer=(ctx:SimReadContext)=>{if(!['IMPLEMENTER','RELEASE_MANAGER'].includes(ctx.actor.role))throw new SimError('FORBIDDEN','SW 업로드·등록은 개발 또는 출시 담당자가 수행합니다.');};
async function feature(ctx:SimReadContext,id:string,ver:string){const d=await ctx.read<any>('featureDetail',{id,ver});if(!d?.feature)throw new SimError('NOT_FOUND','대상 Feature 버전이 없습니다.');return d.feature;}
const b64=(bytes:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function localSign(ctx:SimWriteContext,p:Package){
  const keys=ctx.state<{privateKey?:JsonWebKey;publicKey?:JsonWebKey;spki?:string}>('softwareSigning',()=>({}));
  if(!keys.privateKey){const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);keys.privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey);keys.publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);keys.spki=b64(await crypto.subtle.exportKey('spki',pair.publicKey));}
  const key=await crypto.subtle.importKey('jwk',keys.privateKey!,'Ed25519',false,['sign']);
  const payloadHash='sha256:'+await sha256(canonicalJson(manifest(p)));
  return {signature:{keyId:'LOCAL-SOFTWARE-KEY',alg:'Ed25519',payloadHash,signature:b64(await crypto.subtle.sign('Ed25519',key,new TextEncoder().encode(payloadHash)))},publicKey:{pem:`-----BEGIN PUBLIC KEY-----\n${keys.spki}\n-----END PUBLIC KEY-----`,purpose:'policy',notAfter:'2099-01-01T00:00:00.000Z',provenance:LOCAL}};
}
async function localFile(ctx:SimReadContext,p:Package){
  const file=await readBrowserBinary(p.fileId);
  if(file.version!==ctx.overlay.version||file.scope!==`software:${p.createdBy}`||file.ownerId!==p.createdBy||file.file.sha256!==p.sha256||file.file.bytes!==p.bytes||file.file.name!==p.name)throw new SimError('GUARD_FAILED','SW 매니페스트와 저장된 원문이 일치하지 않습니다.');
  return verifiedBrowserBlob(p.fileId);
}
function record(ctx:SimWriteContext,action:string,p:Package,reason:string){ctx.audit({action,target:p.packageId,after:p,reason,componentId:COMPONENT});ctx.emit(action.toLowerCase().replaceAll('_','.'),p.packageId,{packageId:p.packageId,status:p.status,revision:p.revision,provenance:LOCAL},{componentId:COMPONENT});}
registerSimReader('softwarePackages',async ctx=>({items:await packages(ctx)}));
registerSimReader('softwarePackage',ctx=>get(ctx,ctx.req.params.id));
registerSimHandler('uploadSoftware',async ctx=>{
  writer(ctx);const b=ctx.req.body;if(!(b?.blob instanceof Blob))ctx.fail('VALIDATION','실제 SW 파일 바이트가 필요합니다.');
  const referenced=new Set<string>(ctx.list<Package>(PACKAGE).map(p=>p.fileId));
  for(const item of ctx.list<any>('workflowCase'))for(const artifact of item.artifacts??[])for(const file of artifact.files??[])if(file.fileId)referenced.add(file.fileId);
  const file=await stageBrowserBinary(b.blob,{scope:`software:${ctx.actor.id}`,ownerId:ctx.actor.id,requestKey:b.requestKey,version:ctx.overlay.version,name:b.name,mediaType:b.mediaType},referenced);
  ctx.audit({action:'SOFTWARE_UPLOAD',target:file.fileId,after:{bytes:file.bytes,sha256:file.sha256,provenance:LOCAL},componentId:COMPONENT});
  return {fileId:file.fileId,name:file.name,bytes:file.bytes,sha256:file.sha256,mediaType:file.mediaType,provenance:LOCAL};
});
registerSimHandler('createSoftwarePackage',async ctx=>{
  writer(ctx);const b=ctx.req.body,f=await feature(ctx,b.featureId,b.featureVersion);
  if(!f.swIds?.includes(b.swId))ctx.fail('VALIDATION','선택한 SW는 이 Feature 버전의 구성품이어야 합니다.');
  const file=await readBrowserBinary(b.fileId);
  if(file.version!==ctx.overlay.version||file.scope!==`software:${ctx.actor.id}`||file.ownerId!==ctx.actor.id)ctx.fail('FORBIDDEN','본인이 SW 등록 경로로 올린 파일만 연결할 수 있습니다.');
  if(file.file.sha256!==b.sha256)ctx.fail('GUARD_FAILED','입력한 SW SHA-256과 실제 파일이 다릅니다.');
  await verifiedBrowserBlob(b.fileId);
  const old=(await packages(ctx)).find(p=>p.fileId===b.fileId);
  if(old){if(['featureId','featureVersion','swId','source'].some(k=>old[k]!==b[k]))ctx.fail('CONFLICT','이미 다른 구성으로 등록된 SW 파일입니다.');return old;}
  const item:Package={packageId:`SWP-${crypto.randomUUID()}`,featureId:b.featureId,featureVersion:b.featureVersion,swId:b.swId,fileId:b.fileId,name:file.file.name,bytes:file.file.bytes,sha256:b.sha256,mediaType:file.file.mediaType,source:b.source,status:'DRAFT',revision:1,createdBy:ctx.actor.id,createdAt:ctx.iso(),reviewedBy:null,reviewedAt:null,reason:b.reason,signature:null,sbom:{},provenance:LOCAL};
  const swVersion=f.swIds.length===f.swVersions.length?f.swVersions[f.swIds.indexOf(b.swId)]:null;
  item.sbom={bomFormat:'CycloneDX',specVersion:'1.5',serialNumber:`urn:uuid:${item.packageId.slice(4)}`,version:1,metadata:{timestamp:item.createdAt,properties:[{name:'ff:feature',value:`${item.featureId}@${item.featureVersion}`},{name:'ff:evidence-boundary',value:'LOCAL_SIMULATION; file-inventory-only; not a supplier or vulnerability attestation'}]},components:[{type:'application','bom-ref':item.swId,name:item.swId,...(swVersion?{version:swVersion}:{}),hashes:[{alg:'SHA-256',content:item.sha256}]}]};
  ctx.attachBinary([b.fileId]);ctx.put(PACKAGE,item.packageId,item,{created:true});record(ctx,'SOFTWARE_REGISTER',item,b.reason);return item;
},{body:SoftwarePackageBody});
registerSimHandler('reviewSoftwarePackage',async ctx=>{
  const id=ctx.req.params.id,b=ctx.req.body,p=await get(ctx,id);
  if(ctx.actor.role!=='RELEASE_MANAGER')ctx.fail('FORBIDDEN','SW 패키지 검토는 출시 담당자가 수행합니다.');
  if(p.revision!==b.revision)ctx.fail('PRECONDITION_FAILED','다른 담당자가 SW 패키지를 변경했습니다. 다시 조회하세요.');
  if(p.createdBy===ctx.actor.id)ctx.fail('FORBIDDEN','SW 업로드·등록자와 검토자는 달라야 합니다.');
  const next={...p,revision:p.revision+1,reason:b.reason};
  if(b.decision==='APPROVE'){
    if(p.status!=='DRAFT')ctx.fail('CONFLICT','초안 SW만 승인할 수 있습니다.');
    await localFile(ctx,p);next.reviewedBy=ctx.actor.id;next.reviewedAt=ctx.iso();next.provenance=LOCAL;
    Object.assign(next,await localSign(ctx,next),{status:'APPROVED'});
  }else{if(p.status!=='APPROVED')ctx.fail('CONFLICT','승인된 SW만 회수할 수 있습니다.');next.status='REVOKED';}
  ctx.put(PACKAGE,id,next);record(ctx,`SOFTWARE_${b.decision}`,next,b.reason);return next;
},{body:SoftwarePackageDecisionBody});
async function sourceArray(ctx:SimReadContext,name:string){const r=await ctx.read<{items:any[]}>(name);if(!Array.isArray(r?.items))throw new SimError('INTERNAL',`SW 판정 원천을 읽지 못했습니다: ${name}`);return r.items;}
async function evaluate(ctx:SimReadContext,p:Package,vin:string,flagKey:string){
  const current=(await sourceArray(ctx,'listPolicies')).find(r=>r.flagKey===flagKey&&r.status==='DEPLOYED');
  if(!current||current.featureId!==p.featureId||current.featureVersion!==p.featureVersion)return {blocked:'DEPLOYED_FEATURE_MISMATCH',policy:null,evaluation:null};
  const f=await feature(ctx,p.featureId,p.featureVersion),vehicle=(await sourceArray(ctx,'vehicles')).find(v=>v.vin===vin);
  if(!vehicle)throw new SimError('NOT_FOUND',`차량 ${vin}을(를) 찾을 수 없습니다.`);
  const killed=(await sourceArray(ctx,'killRequests')).some(k=>k.status==='ACTIVE'&&(k.featureIds??[k.featureId]).includes(p.featureId)&&(k.vins??[]).includes(vin)&&!(k.restoredVins??[]).includes(vin));
  let entitled:boolean|null=null;
  if(current.entitlementCatalogId){
    const [bs,ps,gs]=await Promise.all(['baselines','listProducts','entitlements'].map(name=>sourceArray(ctx,name)));
    const ids=new Set(bs.filter(b=>b.featureId===p.featureId).map(b=>b.baselineId)),catalogs=new Set(ps.filter(p=>p.baselineIds?.some((id:string)=>ids.has(id))).map(p=>p.catalogId));
    const today=new Date(ctx.now().getTime()+9*3600000).toISOString().slice(0,10);
    entitled=gs.some(g=>g.vin===vin&&catalogs.has(g.catalogId)&&grantState(g,today).effective&&(g.usesLeft==null||g.usesLeft>0));
  }
  const support=variantRow({...f,featureId:p.featureId,version:p.featureVersion},vehicle);
  const result=await evaluateFlag({policy:current,scope:{country:f.country,vehicleModel:f.vehicleModel,trim:f.trim},vehicle,killed,entitlementActive:entitled,support:{verdict:support.verdict,reason:support.reason}});
  return {blocked:!result.value||result.reason!=='POLICY_MATCH'?result.reason:!f.swIds?.includes(p.swId)?'SOFTWARE_COMPONENT_REMOVED':null,policy:{policyId:current.policyId,revision:current.revision,featureId:current.featureId,featureVersion:current.featureVersion},evaluation:result};
}
async function check(ctx:SimReadContext,id:string,vin:string,flagKey:string){
  const p=await get(ctx,id),m=manifest(p),capture=(await captures()).find(c=>c.package.packageId===id);
  const publicKey=p.provenance===LOCAL?p.publicKey:capture?.verdict.publicKey??null;
  let blocked=p.status!=='APPROVED'?(p.status==='REVOKED'?'PACKAGE_REVOKED':'PACKAGE_NOT_APPROVED'):null;
  let result:{blocked:string|null;policy:any;evaluation:any}={blocked:null,policy:null,evaluation:null};
  if(!blocked&&p.provenance!==LOCAL&&!capture)blocked='SOFTWARE_BYTES_NOT_CAPTURED';
  const proof={allowed:true,blocked:null,vin,flagKey,manifest:m,package:p,signature:p.signature,publicKey,policy:null,evaluation:null} as unknown as SoftwareVerdict;
  if(!blocked&&!await verifySoftwareManifest(proof).catch(()=>false))blocked='MANIFEST_SIGNATURE_INVALID';
  if(!blocked){result=await evaluate(ctx,p,vin,flagKey);blocked=result.blocked;}
  if(!blocked){if(p.provenance===LOCAL)await localFile(ctx,p);else if(!capture)blocked='SOFTWARE_BYTES_NOT_CAPTURED';}
  return {allowed:blocked===null,blocked,vin,flagKey,package:p,manifest:m,signature:p.signature,publicKey,policy:result.policy,evaluation:result.evaluation,boundary:'FILE_DOWNLOAD_ONLY',provenance:p.provenance??CAPTURED};
}
registerSimHandler('checkSoftwareDownload',ctx=>check(ctx,ctx.req.params.id,ctx.req.body.vin,ctx.req.body.flagKey),{body:SoftwareDownloadCheckBody});
registerSimDownload('softwareDownload',async ctx=>{
  if(!['IMPLEMENTER','RELEASE_MANAGER','OPERATOR'].includes(ctx.actor.role))throw new SimError('FORBIDDEN','SW 다운로드 검증 권한이 없습니다.');
  const query=SoftwareDownloadCheckBody.safeParse(ctx.req.query);if(!query.success)throw new SimError('VALIDATION','차량 VIN과 Flag 키가 필요합니다.');
  const verdict=await check(ctx,ctx.req.params.id,query.data.vin,query.data.flagKey);
  if(!verdict.allowed)throw new SimError('GUARD_FAILED','SW 다운로드 조건을 충족하지 못했습니다.',{blocked:verdict.blocked});
  let blob:Blob;
  if(verdict.package.provenance===LOCAL)blob=await localFile(ctx,verdict.package);
  else {
    const capture=(await captures()).find(c=>c.package.packageId===verdict.package.packageId);
    if(!capture||capture.package.source!=='EXECUTABLE_DEMO'||capture.expectedSha256!==verdict.package.sha256||capture.asset!==`api-snapshot/files/software/${capture.expectedSha256}.mjs`)throw new SimError('GUARD_FAILED','공개가 허용된 시험 SW 원문이 없습니다.');
    const response=await fetch(import.meta.env.BASE_URL+capture.asset),gate=await gateDenied(response);if(gate)throw gate;
    if(!response.ok)throw new SimError('NOT_FOUND','캡처된 SW 원문을 찾을 수 없습니다.');
    blob=await response.blob();if(blob.size!==verdict.package.bytes||await sha256(blob)!==verdict.package.sha256)throw new SimError('GUARD_FAILED','공개 시험 SW 원문의 길이 또는 SHA-256이 다릅니다.');
  }
  const downloadId=`SWDL-${crypto.randomUUID()}`,receipt={downloadId,packageId:verdict.package.packageId,vin:query.data.vin,flagKey:query.data.flagKey,actorId:ctx.actor.id,at:ctx.iso(),bytes:blob.size,sha256:verdict.package.sha256,policy:verdict.policy,evaluation:verdict.evaluation,state:'BROWSER_BLOB_READY',boundary:'FILE_DOWNLOAD_ONLY',provenance:LOCAL};
  ctx.put(DOWNLOAD,downloadId,receipt,{created:true});ctx.audit({action:'SOFTWARE_DOWNLOAD_READY',target:receipt.packageId,after:receipt,componentId:COMPONENT});
  return blob;
});
registerSimReader('softwareDownloadHistory',async ctx=>{
  const item=await get(ctx,ctx.req.params.id),base=await ctx.snapshot<{items:any[]}>('softwareDownloadHistory',{id:ctx.req.params.id});
  if(item.provenance!==LOCAL&&!base)throw new SimError('INTERNAL','캡처한 native SW 다운로드 이력이 없습니다.');
  return {items:[...ctx.list<any>(DOWNLOAD).filter(d=>d.packageId===ctx.req.params.id),...(base?.items??[])]};
});
for(const route of ['vehicleSoftwareDownload','vehicleSoftwareManifest'])registerSimReader(route,()=>{throw new SimError('FORBIDDEN','차량 키 인증은 native 차량 채널에서 검증합니다. 브라우저 시연은 실제 차량 신원을 만들지 않습니다.');});
