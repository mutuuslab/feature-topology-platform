import type { WorkflowStoredFile } from '@ff/contracts';
import { openSimDatabase } from './store';

export const BLOB_STORE = 'binary';
export const FILE_MAX = 64 * 1024 * 1024, TOTAL_MAX = 1024 * 1024 * 1024;
export interface BrowserBinary { fileId:string;scope:string;ownerId:string;requestKey:string;version:string;expires:number;blob:Blob;file:WorkflowStoredFile }
const digest=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
export async function readBrowserBinary(id:string):Promise<BrowserBinary> {
  const db=await openSimDatabase();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(BLOB_STORE,'readonly'),r=tx.objectStore(BLOB_STORE).get(id);tx.oncomplete=()=>r.result?resolve(r.result):reject(new Error('첨부 바이트가 이 브라우저에 없습니다.'));tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
export async function verifiedBrowserBlob(id:string):Promise<Blob> {
  const r=await readBrowserBinary(id);
  if(r.blob.size!==r.file.bytes||await digest(r.blob)!==r.file.sha256)throw new Error('첨부 길이 또는 SHA-256이 일치하지 않습니다.');
  return r.blob;
}
/** Actual Blob in IndexedDB. No base64 or localStorage payload; no memory-only success fallback. */
export async function stageBrowserBinary(blob:Blob,meta:{scope:string;ownerId:string;requestKey:string;version:string;name:string;mediaType:string},referenced:ReadonlySet<string>):Promise<WorkflowStoredFile> {
  if(typeof indexedDB==='undefined'||!indexedDB)throw new Error('첨부 보존에는 IndexedDB가 필요합니다.');
  if(!blob.size||blob.size>FILE_MAX||!meta.name||meta.name.length>180||/[\x00-\x1f\x7f/\\]/.test(meta.name)||!/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(meta.mediaType)||meta.requestKey.length<8||meta.requestKey.length>100)throw new Error('파일은 정상 이름·유형의 64MiB 이하 파일이어야 합니다.');
  const sha256=await digest(blob),fileId=crypto.randomUUID();
  const file:WorkflowStoredFile={fileId,name:meta.name,mediaType:meta.mediaType,base64:'',sha256,bytes:blob.size,uploadedBy:meta.ownerId};
  const db=await openSimDatabase();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(BLOB_STORE,'readwrite'),s=tx.objectStore(BLOB_STORE),r=s.getAll();let result=file,problem:Error|undefined;
    r.onsuccess=()=>{
      const rows=r.result as BrowserBinary[];
      const kept=rows.filter(row=>{const remove=row.version!==meta.version||row.expires<Date.now()&&!referenced.has(row.fileId);if(remove)s.delete(row.fileId);return !remove;});
      const old=kept.find(row=>row.scope===meta.scope&&row.requestKey===meta.requestKey);
      if(old){if(old.ownerId!==meta.ownerId||old.file.name!==meta.name||old.file.mediaType!==meta.mediaType||old.file.sha256!==sha256||old.file.bytes!==blob.size){problem=new Error('같은 첨부 요청 번호의 내용이 다릅니다.');tx.abort();}else result=old.file;return;}
      if(kept.reduce((sum,row)=>sum+row.file.bytes,0)+blob.size>TOTAL_MAX){problem=new Error('첨부 저장소 전체 용량 1GiB를 초과합니다.');tx.abort();return;}
      s.put({...meta,fileId,expires:Date.now()+86400000,blob,file} satisfies BrowserBinary,fileId);
    };
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(problem??tx.error??new Error('첨부 저장이 취소됐습니다.'));tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}
}
