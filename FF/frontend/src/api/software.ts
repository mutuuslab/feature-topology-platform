import { canonicalJson,ROUTES,routeUrl,type Role } from '@ff/contracts';
import { actorFor } from './actor';
import { STATIC_MODE,gateDenied,toApiError } from './client';
import { OIDC_AUTH } from '../auth-mode';

export interface SoftwarePackageView {
  packageId:string;featureId:string;featureVersion:string;swId:string;fileId:string;name:string;bytes:number;sha256:string;mediaType:string;
  source:'UPLOADED_SOFTWARE'|'EXECUTABLE_DEMO';status:'DRAFT'|'APPROVED'|'REVOKED';revision:number;createdBy:string;createdAt:string;reviewedBy:string|null;
  provenance?:'LOCAL_SIMULATION'|'CAPTURED_EXECUTABLE_DEMO';
}
export interface SoftwareVerdict {
  allowed:boolean;blocked:string|null;vin:string;flagKey:string;package:SoftwarePackageView;manifest:unknown;
  signature:{keyId:string;payloadHash:string;signature:string}|null;publicKey:{pem:string;purpose:string;notAfter:string}|null;
  policy:{policyId:string;revision:number}|null;evaluation:{value:boolean;reason:string;trace?:{step:string;result:string;detail:string}[]}|null;
  checkedAt?:string;signatureCheck?:{valid:boolean;reason:string};
}
/** KILL=false means no emergency block. Unknown evidence never receives a passing color. */
export function softwareTraceTone(step:{step:string;result:string}):'pass'|'blocked'|'unknown'{
  if(!['TRUE','FALSE'].includes(step.result))return 'unknown';
  return (step.step==='KILL'?step.result==='FALSE':step.result==='TRUE')?'pass':'blocked';
}
async function binary(name:string,role:string,params:Record<string,string>,query:Record<string,string>,file?:File){
  const route=ROUTES.find(r=>r.name===name)!;
  if(STATIC_MODE){const sim=await import('./sim');await sim.simReady();return sim.simCall(route,routeUrl(name,params,query),{params,query,role,body:file?{blob:file,name:file.name,mediaType:file.type||'application/octet-stream',requestKey:crypto.randomUUID()}:undefined});}
  const actor=actorFor(role,route.roles as Role[]|undefined),headers:Record<string,string>={'X-Actor-Role':actor.role};
  if(!OIDC_AUTH)headers['X-Actor-Id']=actor.id;
  if(file)Object.assign(headers,{'Content-Type':'application/octet-stream','Idempotency-Key':crypto.randomUUID(),'X-File-Name':encodeURIComponent(file.name),'X-File-Type':file.type||'application/octet-stream'});
  const response=await fetch(routeUrl(name,params,query),{method:route.method,headers,body:file});
  const gate=await gateDenied(response);if(gate)throw gate;
  if(!response.ok)throw toApiError(response,await response.json().catch(()=>null));
  return file?response.json():response.blob();
}
export async function sha256(value:Blob|string){const bytes=typeof value==='string'?new TextEncoder().encode(value):await value.arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export const uploadSoftware=(file:File,role:string)=>binary('uploadSoftware',role,{}, {},file) as Promise<{fileId:string;sha256:string;bytes:number}>;
export async function verifySoftwareManifest(verdict:SoftwareVerdict){
  if(!verdict.allowed||!verdict.signature||!verdict.publicKey||verdict.publicKey.purpose!=='policy'||!Number.isFinite(Date.parse(verdict.publicKey.notAfter))||Date.parse(verdict.publicKey.notAfter)<=Date.now())return false;
  const manifest=verdict.manifest as Record<string,unknown>|null;
  if(!manifest||manifest.schema!=='ff.software.v1'||['packageId','featureId','featureVersion','swId','name','bytes','sha256','source'].some(key=>manifest[key]!==verdict.package[key as keyof SoftwarePackageView]))return false;
  const manifestHash='sha256:'+await sha256(canonicalJson(verdict.manifest));
  if(manifestHash!==verdict.signature.payloadHash)return false;
  const pem=verdict.publicKey.pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
  const key=await crypto.subtle.importKey('spki',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'Ed25519'},false,['verify']);
  return crypto.subtle.verify('Ed25519',key,Uint8Array.from(atob(verdict.signature.signature),c=>c.charCodeAt(0)),new TextEncoder().encode(manifestHash));
}
export async function downloadSoftware(verdict:SoftwareVerdict,role:string){
  if(!await verifySoftwareManifest(verdict))throw new Error('SOFTWARE_INTEGRITY');
  const blob:Blob=await binary('softwareDownload',role,{id:verdict.package.packageId},{vin:verdict.vin,flagKey:verdict.flagKey});
  if(blob.size!==verdict.package.bytes||await sha256(blob)!==verdict.package.sha256)throw new Error('SOFTWARE_INTEGRITY');
  return blob;
}
