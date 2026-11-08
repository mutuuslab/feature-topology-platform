import { createHash } from 'node:crypto';
import { canonicalJson } from '@ff/contracts';
import type { Db } from '../kernel/db';

const TABLES = ['feature_version', 'product', 'policy', 'policy_revision', 'safety_profile', 'gate_signoff', 'gate_record', 'approver_key', 'pki_key', 'hsm_secret'] as const;
export type ShowcasePreservation = Record<string, Record<string, string>>;
/** Hash complete original rows, including signatures and references, without exporting private key material. */
export function captureShowcaseOriginals(db: Db): ShowcasePreservation {
  const out: ShowcasePreservation = {};
  for (const table of TABLES) {
    const keys = db.all<{ name: string; pk: number }>(`PRAGMA table_info(${table})`).filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
    if (!keys.length) throw new Error(`전시 원본 보존 검사 PK 없음: ${table}`);
    out[table] = {};
    for (const row of db.all<Record<string, unknown>>(`SELECT * FROM ${table}`)) {
      const id = keys.map(k => String(row[k])).join('@');
      out[table][id] = createHash('sha256').update(canonicalJson(row)).digest('hex');
    }
  }
  return out;
}
export function compareShowcaseOriginals(before: ShowcasePreservation, after: ShowcasePreservation) {
  return Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, {
    checked: Object.keys(rows).length,
    changed: Object.entries(rows).filter(([id, hash]) => after[table]?.[id] !== undefined && after[table][id] !== hash).map(([id]) => id),
    missing: Object.keys(rows).filter(id => after[table]?.[id] === undefined),
  }]));
}
