// 오버레이 저장 — IndexedDB(없으면 메모리). 방문자 브라우저에만 남고, 스냅샷 판(version)이 바뀌면 버린다.
// localStorage SIM_FLAG는 "바뀐 시연 데이터가 있다"는 표시 — API 클라이언트가 이것을 보고 읽기도 이 모듈을 거친다(첫 화면은 불러오지 않음).
import { SIM_FLAG } from '../client';
import type { SimOverlay } from './types';

const DB = 'ff-sim';
const STORE = 'overlay';
const KEY = 'current';

export const emptyOverlay = (version: string): SimOverlay => ({
  version,
  entities: {},
  created: {},
  audit: [],
  notifications: [],
  events: [],
  reads: {},
  readAllAt: {},
  seq: {},
  chain: { head: null, count: 0 },
  tasks: [],
  data: {},
});

const hasIdb = () => typeof indexedDB !== 'undefined' && indexedDB !== null;

export function openSimDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if(!hasIdb()){reject(new Error('첨부 보존에는 IndexedDB가 필요합니다.'));return;}
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);if(!req.result.objectStoreNames.contains('binary'))req.result.createObjectStore('binary');};
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openSimDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 메모리 사본(IndexedDB가 없거나 막힌 브라우저 — 새로고침하면 처음 상태) */
let memory: SimOverlay | null = null;

export async function loadOverlay(version: string): Promise<SimOverlay> {
  let saved: SimOverlay | undefined;
  if (hasIdb()) {
    try {
      saved = await idb<SimOverlay>('readonly', (s) => s.get(KEY));
    } catch {
      saved = undefined;
    }
  } else saved = memory ?? undefined;
  // 배포(스냅샷)가 바뀌면 예전 오버레이는 새 스냅샷과 섞이지 않게 버린다
  if (saved && saved.version === version) return saved;
  if (saved) await clearOverlay();
  return emptyOverlay(version);
}

export async function saveOverlay(o: SimOverlay, requiredBinaryIds:readonly string[]=[]): Promise<void> {
  if(hasIdb()||requiredBinaryIds.length){
    const db=await openSimDatabase();
    try{await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction([STORE,'binary'],'readwrite');let problem:Error|undefined;
      for(const id of requiredBinaryIds){const r=tx.objectStore('binary').get(id);r.onsuccess=()=>{if(!r.result){problem=new Error('첨부 바이트가 없어 산출물을 저장하지 않았습니다.');tx.abort();}};}
      const prior=tx.objectStore(STORE).get(KEY),revision=(o.storageRevision??0)+1;
      prior.onsuccess=()=>{
        const saved=prior.result as SimOverlay|undefined;
        if(saved&&saved.version!==o.version||(saved?.storageRevision??0)!==(o.storageRevision??0)) {problem=new Error('다른 탭에서 시연 데이터를 변경했습니다. 페이지를 새로고침하고 다시 확인하세요.');tx.abort();return;}
        tx.objectStore(STORE).put({...o,storageRevision:revision},KEY);
      };
      tx.oncomplete=()=>{o.storageRevision=revision;resolve();};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(problem??tx.error);
    });}finally{db.close();}
    try{localStorage.setItem(SIM_FLAG,o.version);}catch{/* marker only */}
    return;
  }
  try {
    localStorage.setItem(SIM_FLAG, o.version);
  } catch {
    /* 저장소 막힘 — 이 탭에서만 유지 */
  }
  memory = structuredClone(o);
}

export async function clearOverlay(): Promise<void> {
  memory = null;
  try {
    localStorage.removeItem(SIM_FLAG);
  } catch {
    /* 무시 */
  }
  if (hasIdb()) {
    try {
      const db=await openSimDatabase();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction([STORE,'binary'],'readwrite');tx.objectStore(STORE).delete(KEY);tx.objectStore('binary').clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
    } catch {
      /* 무시 */
    }
  }
}
