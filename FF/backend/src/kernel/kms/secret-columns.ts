// 봉인 대상 열 — DB에 저장되는 개인키·비밀은 모두 여기에 등록한다(출시 준비 RD-SEC-06).
// 시작 때 sealSecrets가 평문 레코드(이전 판 DB)를 봉인하고, 이전 KEK로 감싼 레코드를 지금 KEK로 다시 감싼 뒤,
// 모든 레코드가 지금 KEK로 열리는지 확인한다 — 잘못된 KEK면 첫 요청이 아니라 시작에서 멈춘다.
import type { Db } from '../db';
import { isSealed, type SecretVault } from './key-protection';

export interface SecretColumn {
  table: string;
  column: string;
  /** 레코드 ID SQL 식 — AAD에 들어간다(같은 표의 다른 행으로 옮긴 암호문 거부) */
  id: string;
}

export const SECRET_COLUMNS: SecretColumn[] = [
  { table: 'pki_key', column: 'private_pem', id: 'key_id' },
  { table: 'approver_key', column: 'private_pem', id: 'user_id' },
  { table: 'hsm_secret', column: 'secret', id: "name || ':' || epoch" },
];

export const aadOf = (c: Pick<SecretColumn, 'table' | 'column'>, id: string) => `${c.table}.${c.column}|${id}`;

const col = (table: string, column: string) => {
  const c = SECRET_COLUMNS.find((x) => x.table === table && x.column === column);
  if (!c) throw new Error(`봉인 대상으로 등록되지 않은 열 ${table}.${column}`);
  return c;
};

/** 쓰기 — 서비스가 비밀을 저장하기 직전에 부른다 */
export const sealFor = (vault: SecretVault, table: string, column: string, id: string, plain: string) => vault.seal(plain, aadOf(col(table, column), id));
/** 읽기 — 쓰기 직전에만 풀고, 결과를 다른 곳에 남기지 않는다 */
export const openFor = (vault: SecretVault, table: string, column: string, id: string, sealed: string) => vault.open(sealed, aadOf(col(table, column), id));

export interface SealReport {
  sealed: number;
  rewrapped: number;
  verified: number;
}

/**
 * 시작 때 한 번 — 평문 봉인·이전 KEK 레코드 다시 감싸기·전체 확인. 바뀐 것이 있으면 이전 평문이 남지 않게
 * WAL을 비우고 VACUUM으로 빈 페이지를 지운다(secure_delete는 SqliteDb가 켠다).
 */
export function sealSecrets(db: Db, vault: SecretVault): SealReport {
  const out: SealReport = { sealed: 0, rewrapped: 0, verified: 0 };
  db.tx(() => {
    for (const c of SECRET_COLUMNS) {
      const rows = db.all<{ rid: string; v: string }>(`SELECT ${c.id} AS rid, ${c.column} AS v FROM ${c.table}`);
      for (const r of rows) {
        const rid = String(r.rid);
        let next = r.v;
        if (!isSealed(next)) {
          next = vault.seal(next, aadOf(c, rid));
          out.sealed++;
        } else if (!vault.isCurrent(next)) {
          next = vault.rewrap(next);
          out.rewrapped++;
        }
        vault.open(next, aadOf(c, rid)); // 열리지 않으면(잘못된 KEK·변조) 여기서 던져 시작을 멈춘다
        out.verified++;
        if (next !== r.v) db.run(`UPDATE ${c.table} SET ${c.column} = ? WHERE ${c.id} = ?`, next, rid);
      }
    }
  });
  if (out.sealed || out.rewrapped) {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  return out;
}
