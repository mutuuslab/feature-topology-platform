import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SqliteDb, type Db } from '../../src/kernel/db';
import { BINARY_MIGRATION } from '../../src/kernel/migrations-binary';
import { BinaryStore, BINARY_CHUNK_BYTES, BINARY_FILE_MAX, BINARY_TOTAL_MAX } from '../../src/kernel/binary-store';

const meta={scope:'domain:case:activity',ownerId:'owner',requestKey:'request-unique-key',name:'source.bin',mediaType:'application/octet-stream'};
const stream=async function*(bytes:Uint8Array){yield bytes;};
describe('shared binary store atomicity, quotas, actual bytes',()=>{
  const dbs:Db[]=[];
  const setup=()=>{const db=new SqliteDb();db.exec(BINARY_MIGRATION.sql);dbs.push(db);return {db,store:new BinaryStore(db)};};
  afterEach(()=>{for(const db of dbs.splice(0))db.close();});
  it('handles arbitrary chunk boundaries and verifies real hashes before download',async()=>{
    const {db,store}=setup(),data=Buffer.alloc(BINARY_CHUNK_BYTES*3+7,0xa5);
    const row=await store.upload((async function*(){yield data.subarray(0,3);yield data.subarray(3,BINARY_CHUNK_BYTES*2+2);yield data.subarray(BINARY_CHUNK_BYTES*2+2);})(),meta,()=>{});
    expect(row.bytes).toBe(data.length);expect(row.sha256).toBe(createHash('sha256').update(data).digest('hex'));
    expect(db.all<any>('SELECT data FROM binary_chunk').every(c=>c.data.length<=BINARY_CHUNK_BYTES)).toBe(true);
    const {stream:out}=store.download(row.file_id),parts:Buffer[]=[];for await(const part of out)parts.push(Buffer.from(part));expect(Buffer.concat(parts)).toEqual(data);
    db.run('UPDATE binary_chunk SET data=? WHERE file_id=? AND seq=0',Buffer.from('damage'),row.file_id);
    expect(()=>store.download(row.file_id)).toThrow(/SHA-256|길이/);
  });
  it('rolls back attachment in the case transaction and refuses other owner/scope',async()=>{
    const {db,store}=setup(),row=await store.upload(stream(Buffer.from('actual')),meta,()=>{});
    expect(()=>db.tx(()=>store.attach(row.file_id,'other',meta.ownerId))).toThrow();
    expect(()=>db.tx(()=>store.attach(row.file_id,meta.scope,'other'))).toThrow();
    expect(()=>db.tx(()=>{store.attach(row.file_id,meta.scope,meta.ownerId);throw new Error('case CAS failed');})).toThrow('case CAS');
    expect(store.get(row.file_id).status).toBe('READY');
    db.tx(()=>store.attach(row.file_id,meta.scope,meta.ownerId));
    db.tx(()=>expect(store.attach(row.file_id,meta.scope,'other-author').owner_id).toBe(meta.ownerId));
    store.expire(new Date(Date.now()+86400000*2));expect(store.get(row.file_id).status).toBe('ATTACHED');
  });
  it('cleans partial stream, byte quota failure, final authorization failure and expired orphan bytes',async()=>{
    const {db,store}=setup(),data=Buffer.alloc(20000);
    await expect(store.upload((async function*(){yield data;throw new Error('stream abort');})(),meta,()=>{})).rejects.toThrow('stream abort');
    expect(db.get<any>('SELECT used_bytes FROM binary_capacity').used_bytes).toBe(0);
    expect(db.all('SELECT * FROM binary_chunk')).toHaveLength(0);
    let checks=0;await expect(store.upload(stream(data),meta,()=>{if(++checks===2)throw new Error('case changed during upload');})).rejects.toThrow('case changed');
    expect(db.all('SELECT * FROM binary_object')).toHaveLength(0);
    await expect(store.upload(stream(data),meta,()=>{},()=>{throw new Error('audit outbox failed');})).rejects.toThrow('audit outbox failed');
    expect(db.all('SELECT * FROM binary_object')).toHaveLength(0);
    db.run('UPDATE binary_capacity SET used_bytes=?',BINARY_TOTAL_MAX-2);
    await expect(store.upload(stream(data),meta,()=>{})).rejects.toThrow(/1GiB/);
    expect(db.get<any>('SELECT used_bytes FROM binary_capacity').used_bytes).toBe(BINARY_TOTAL_MAX-2);
    db.run('UPDATE binary_capacity SET used_bytes=0');
    const row=await store.upload(stream(data),meta,()=>{});expect(store.expire(new Date(Date.now()+86400000*2))).toBe(1);
    expect(()=>store.get(row.file_id)).toThrow();expect(db.get<any>('SELECT used_bytes FROM binary_capacity').used_bytes).toBe(0);
  });
  it('enforces per-file cap without retaining streamed chunks, and empty uploads leave nothing',async()=>{
    const {db,store}=setup();
    await expect(store.upload(stream(new Uint8Array(0)),meta,()=>{})).rejects.toThrow();
    await expect(store.upload((async function*(){const block=Buffer.alloc(BINARY_CHUNK_BYTES);for(let n=0;n<=BINARY_FILE_MAX/BINARY_CHUNK_BYTES;n++)yield block;})(),meta,()=>{})).rejects.toThrow(/64MiB/);
    expect(db.all('SELECT * FROM binary_object')).toHaveLength(0);expect(db.get<any>('SELECT used_bytes FROM binary_capacity').used_bytes).toBe(0);
  });
  it('uses explicit SQLite BLOB / PostgreSQL BYTEA schema with identical keys and constraints',()=>{
    expect(BINARY_MIGRATION.sql).toContain('data BLOB NOT NULL');expect(BINARY_MIGRATION.pg).toContain('data BYTEA NOT NULL');
    expect(BINARY_MIGRATION.sql.replace('data BLOB','data BYTEA')).toBe(BINARY_MIGRATION.pg);
  });
});
