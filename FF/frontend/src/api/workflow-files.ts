import { HUMAN_ROLES, ROUTES, routeUrl, type WorkflowStoredFile } from '@ff/contracts';
import { OIDC_AUTH } from '../auth-mode';
import { actorFor } from './actor';
import { STATIC_MODE, gateDenied, toApiError } from './client';

async function binaryCall(name:string,params:Record<string,string>,role:string,upload?:{blob:Blob;version:number;name:string;mediaType:string;requestKey:string}):Promise<any> {
  const route=ROUTES.find(r=>r.name===name)!;
  if(STATIC_MODE){const sim=await import('./sim');await sim.simReady();return sim.simCall(route,routeUrl(name,params),{params,role,body:upload});}
  const a=actorFor(role,upload?HUMAN_ROLES:undefined),headers:Record<string,string>={'X-Actor-Role':a.role};
  if(!OIDC_AUTH)headers['X-Actor-Id']=a.id;
  if(upload)Object.assign(headers,{'Content-Type':'application/octet-stream','If-Match':`"${upload.version}"`,'Idempotency-Key':upload.requestKey,'X-File-Name':encodeURIComponent(upload.name),'X-File-Type':upload.mediaType});
  const res=await fetch(routeUrl(name,params),{method:route.method,headers,body:upload?.blob});
  const gate=await gateDenied(res);if(gate)throw gate;
  if(!res.ok)throw toApiError(res,await res.json().catch(()=>null));
  return upload?res.json():res.blob();
}
export const uploadWorkflowFile=(id:string,activityId:string,version:number,file:File,role:string,requestKey:string)=>binaryCall('uploadWorkflowFile',{id,activityId},role,{blob:file,version,name:file.name,mediaType:file.type||'application/octet-stream',requestKey}) as Promise<WorkflowStoredFile>;
export async function workflowFileBlob(id:string,file:WorkflowStoredFile,role:string):Promise<Blob> {
  const blob:Blob=file.fileId?await binaryCall('workflowFile',{id,fileId:file.fileId},role):new Blob([Uint8Array.from(atob(file.base64),v=>v.charCodeAt(0))]);
  const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(blob.size!==file.bytes||actual!==file.sha256)throw new Error('첨부 길이 또는 SHA-256이 일치하지 않습니다.');
  return blob;
}
