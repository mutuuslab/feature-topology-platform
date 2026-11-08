import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DB, type Db } from './db';
import { DomainError } from './errors';
import { Scheduler } from './scheduler';

export const BINARY_FILE_MAX = 64 * 1024 * 1024;
export const BINARY_TOTAL_MAX = 1024 * 1024 * 1024;
export const BINARY_CHUNK_BYTES = 256 * 1024;
export interface BinaryObject { file_id: string; scope: string; request_key: string; owner_id: string; name: string; media_type: string; status: 'UPLOADING'|'READY'|'ATTACHED'; bytes: number; sha256: string; chunks: number; expires_at: string; created_at: string }
const error = (code: 'VALIDATION'|'CONFLICT'|'GUARD_FAILED'|'NOT_FOUND', message: string): never => { throw new DomainError(code,message); };
/** Opaque byte storage only. Every domain must authorize scope/actor before upload, attach and download. */
@Injectable()
export class BinaryStore implements OnApplicationBootstrap {
  constructor(@Inject(DB) private readonly db: Db,@Optional() private readonly scheduler?:Scheduler) {}
  onApplicationBootstrap() {
    if(!this.scheduler||this.scheduler.manual)return;
    const tick=()=>{try{this.expire();}catch(e){new Logger('BinaryStore').error(e instanceof Error?e.message:'Binary expiry failed');}this.scheduler!.after(3600000,tick);};
    tick();
  }
  get(id: string): BinaryObject { return this.db.get<BinaryObject>('SELECT * FROM binary_object WHERE file_id=?',id) ?? error('NOT_FOUND','저장된 첨부를 찾을 수 없습니다.'); }
  private remove(id: string) {
    const row=this.get(id);if(row.status==='ATTACHED')error('CONFLICT','산출물 버전에 연결된 첨부는 보존됩니다.');
    this.db.run('DELETE FROM binary_chunk WHERE file_id=?',id);
    this.db.run('DELETE FROM binary_object WHERE file_id=?',id);
    this.db.run('UPDATE binary_capacity SET used_bytes=used_bytes-? WHERE id=1',row.bytes);
  }
  expire(now = new Date()) {
    return this.db.tx(()=>{
      this.db.run('UPDATE binary_capacity SET used_bytes=used_bytes WHERE id=1');
      const rows=this.db.all<{file_id:string}>("SELECT file_id FROM binary_object WHERE status<>'ATTACHED' AND expires_at<?",now.toISOString());
      for(const r of rows)this.remove(r.file_id);
      return rows.length;
    });
  }
  /** Bytes arrive incrementally; incomplete/aborted/over-limit streams leave no persistent chunks. */
  async upload(input: AsyncIterable<Uint8Array>, meta: {scope:string;requestKey:string;ownerId:string;name:string;mediaType:string}, authorize: ()=>void, onReady:(file:BinaryObject,replay:boolean)=>void=()=>{}): Promise<BinaryObject> {
    authorize();
    if(!meta.name.trim()||meta.name.length>180||/[\x00-\x1f\x7f/\\]/.test(meta.name)||!/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(meta.mediaType)||meta.requestKey.length<8||meta.requestKey.length>100)error('VALIDATION','첨부 이름·유형·요청 번호를 확인하세요.');
    this.expire();
    const id=randomUUID();
    const old=this.db.tx(()=>{
      // Capacity row also serializes duplicate reservations across PostgreSQL connections.
      this.db.run('UPDATE binary_capacity SET used_bytes=used_bytes WHERE id=1');
      const prior=this.db.get<BinaryObject>('SELECT * FROM binary_object WHERE scope=? AND request_key=?',meta.scope,meta.requestKey);
      if(prior){
        if(prior.owner_id!==meta.ownerId||prior.name!==meta.name||prior.media_type!==meta.mediaType||prior.status==='UPLOADING')error('CONFLICT','같은 첨부 요청 번호의 담당자·내용이 다르거나 업로드 중입니다.');
        return prior;
      }
      const at=new Date().toISOString();
      this.db.run('INSERT INTO binary_object(file_id,scope,request_key,owner_id,name,media_type,status,bytes,sha256,chunks,expires_at,created_at) VALUES(?,?,?,?,?,?,?,0,NULL,0,?,?)',id,meta.scope,meta.requestKey,meta.ownerId,meta.name,meta.mediaType,'UPLOADING',new Date(Date.now()+3600000).toISOString(),at);
      return null;
    });
    let total=0,seq=0;const digest=createHash('sha256');
    try {
      for await(const value of input){
        if(!(value instanceof Uint8Array))error('VALIDATION','바이너리 본문이 필요합니다.');
        total+=value.byteLength;if(total>BINARY_FILE_MAX)error('GUARD_FAILED','파일은 64MiB 이하여야 합니다.');
        digest.update(value);
        if(!old)for(let offset=0;offset<value.length;offset+=BINARY_CHUNK_BYTES){
          const bytes=value.subarray(offset,offset+BINARY_CHUNK_BYTES);
          this.db.tx(()=>{
            if(this.db.run('UPDATE binary_capacity SET used_bytes=used_bytes+? WHERE id=1 AND used_bytes+?<=?',bytes.length,bytes.length,BINARY_TOTAL_MAX).changes!==1)error('GUARD_FAILED','첨부 저장소 전체 용량 1GiB를 초과합니다. 관리자에게 문의하세요.');
            this.db.run('INSERT INTO binary_chunk(file_id,seq,data) VALUES(?,?,?)',id,seq++,bytes);
            this.db.run('UPDATE binary_object SET bytes=bytes+?,chunks=?,expires_at=? WHERE file_id=?',bytes.length,seq,new Date(Date.now()+3600000).toISOString(),id);
          });
        }
      }
      if(!total)error('VALIDATION','빈 파일은 첨부할 수 없습니다.');
      const sha=digest.digest('hex');
      return this.db.tx(()=>{
        authorize(); // Case CAS/role changes during the stream are checked again before publication.
        if(old){if(old.bytes!==total||old.sha256!==sha)error('CONFLICT','같은 요청 번호로 다른 파일 바이트를 보낼 수 없습니다.');const result=this.get(old.file_id);onReady(result,true);return result;}
        this.db.run("UPDATE binary_object SET status='READY',sha256=?,expires_at=? WHERE file_id=? AND status='UPLOADING'",sha,new Date(Date.now()+86400000).toISOString(),id);
        const result=this.get(id);onReady(result,false);return result;
      });
    }catch(e){if(!old)this.db.tx(()=>this.remove(id));throw e;}
  }
  /** Call inside the domain's case CAS transaction; rollback restores READY and all domain history. */
  attach(id: string,scope:string,ownerId:string): BinaryObject {
    if(!this.db.inTransaction)throw new Error('Binary attachment must share the domain transaction');
    const row=this.get(id);
    if(row.scope!==scope||row.status!=='ATTACHED'&&row.owner_id!==ownerId)throw new DomainError('FORBIDDEN','이 활동의 기존 첨부 또는 본인이 올린 임시 첨부만 연결할 수 있습니다.');
    if(row.status==='UPLOADING'||row.expires_at<new Date().toISOString()&&row.status!=='ATTACHED')error('CONFLICT','첨부 업로드를 다시 완료하세요.');
    this.verify(id);
    this.db.run("UPDATE binary_object SET status='ATTACHED' WHERE file_id=?",id);
    return row;
  }
  verify(id: string) {
    const row=this.get(id);if(row.status==='UPLOADING')error('CONFLICT','업로드가 완료되지 않았습니다.');
    const digest=createHash('sha256');let size=0;
    for(let n=0;n<row.chunks;n++){
      const r=this.db.get<{data:Uint8Array}>('SELECT data FROM binary_chunk WHERE file_id=? AND seq=?',id,n);
      if(!r||r.data.length>BINARY_CHUNK_BYTES)error('GUARD_FAILED','첨부 저장 바이트가 손상됐습니다.');
      digest.update(r.data);size+=r.data.length;
    }
    if(size!==row.bytes||digest.digest('hex')!==row.sha256)error('GUARD_FAILED','첨부 길이 또는 SHA-256이 일치하지 않습니다.');
    return row;
  }
  download(id: string) {
    const row=this.verify(id),db=this.db;
    const stream=Readable.from((function*(){for(let seq=0;seq<row.chunks;seq++)yield Buffer.from(db.get<{data:Uint8Array}>('SELECT data FROM binary_chunk WHERE file_id=? AND seq=?',id,seq)!.data);})());
    return {row,stream};
  }
}
