// 내보내기 독립 검증 도구 — 서버가 만드는 것과 같은 방식(contracts csvFile·정규 JSON·Ed25519)으로 파일을 만들고,
// 공개 키만으로 통과하는지, 데이터·머리 줄·서명·키를 바꾸면 실패하는지 본다. 네트워크·서버 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF } from './lib.ts';
import { loadKeys, verifyExportText } from './verify-export.ts';

const require = createRequire(import.meta.url);
const { csvBody, csvFile, exportSignedPayload, canonicalJson, AUDIT_EXPORT_COLUMNS } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const pem = (k: typeof publicKey) => k.export({ type: 'spki', format: 'pem' }).toString();
const KEYS = [{ keyId: 'KEY-EXP-0001', purpose: 'export', publicKeyPem: pem(publicKey) }];

/** 서버(HistoryExportService.file)와 같은 순서로 파일을 만든다 */
function make(format: 'csv' | 'json', rows: Record<string, unknown>[], filters: Record<string, string> = { targetPrefix: 'POL-00001' }) {
  const generatedAt = '2026-11-06T01:00:00.000Z';
  const period = { from: '2026-11-05T15:00:00.000Z', to: null };
  const body = format === 'csv' ? csvBody(AUDIT_EXPORT_COLUMNS, rows) : canonicalJson(rows);
  const payload = exportSignedPayload({ kind: 'audit', generatedAt, generatedBy: 'usr-viewer', period, filters, rows: rows.length, sha256: sha(body) });
  const payloadHash = 'sha256:' + sha(canonicalJson(payload));
  const signature = { keyId: 'KEY-EXP-0001', alg: 'Ed25519', payloadHash, signature: sign(null, Buffer.from(payloadHash), privateKey).toString('base64') };
  const integrity = { rows: rows.length, sha256: payload.sha256, chainFrom: 'GENESIS', chainTo: 'f'.repeat(64), signature };
  if (format === 'csv') return String.fromCharCode(0xfeff) + csvFile({ kind: 'audit', generatedAt, generatedBy: 'usr-viewer', period, filters, integrity }, body);
  return JSON.stringify({ kind: 'audit', generatedAt, generatedBy: 'usr-viewer', period, filters, integrity, rows }, null, 2);
}

const ROWS = [
  { id: 1, at: '2026-11-06T01:00:00.000Z', actorId: 'usr-author', actorRole: 'FEATURE_AUTHOR', action: 'POLICY_CREATE', target: 'POL-00001', result: 'ALLOWED', reason: '줄바꿈\r\n있는 사유, "따옴표"', before: null, after: { flagKey: 'care_00022_flag' }, changes: [], prevHash: 'GENESIS', hash: 'a'.repeat(64) },
  { id: 2, at: '2026-11-06T01:00:00.000Z', actorId: 'usr-viewer', actorRole: 'AUDITOR', action: 'POLICY_VIEW', target: 'POL-00001', result: 'ALLOWED', reason: null, before: null, after: null, changes: [], prevHash: 'a'.repeat(64), hash: 'f'.repeat(64) },
];

test('CSV·JSON — 공개 키만으로 통과(칸 안 줄바꿈·따옴표가 있어도)', () => {
  for (const f of ['csv', 'json'] as const) {
    const v = verifyExportText(make(f, ROWS), KEYS);
    assert.deepEqual(v.problems, [], f);
    assert.equal(v.ok, true);
    assert.equal(v.rows, 2);
    assert.equal(v.generatedBy, 'usr-viewer');
  }
});

test('데이터 한 글자만 바꿔도 실패 — CSV 행·JSON 행', () => {
  const csv = make('csv', ROWS).replace('POLICY_VIEW', 'POLICY_EDIT');
  assert.match(verifyExportText(csv, KEYS).problems.join(), /SHA-256/);
  const env = JSON.parse(make('json', ROWS));
  env.rows[1].actorId = 'usr-other';
  assert.equal(verifyExportText(JSON.stringify(env), KEYS).ok, false);
  env.rows.pop();
  assert.match(verifyExportText(JSON.stringify(env), KEYS).problems.join(), /행 수|SHA-256/);
});

test('머리 줄만 바꾸면 실패 — 내보낸 사람·기간·조건을 꾸민 파일', () => {
  const csv = make('csv', ROWS);
  assert.equal(verifyExportText(csv.replace('generatedBy=usr-viewer', 'generatedBy=usr-opslead'), KEYS).ok, false);
  assert.equal(verifyExportText(csv.replace('"generatedBy":"usr-viewer"', '"generatedBy":"usr-opslead"'), KEYS).ok, false); // 서명 대상 줄을 바꾸면 서명이 틀린다
  assert.equal(verifyExportText(csv.replace('# period=2026-11-05T15:00:00.000Z..', '# period=2026-11-01T15:00:00.000Z..'), KEYS).ok, false);
  const env = JSON.parse(make('json', ROWS));
  env.filters = {};
  assert.match(verifyExportText(JSON.stringify(env), KEYS).problems.join(), /서명/);
});

test('다른 키·용도가 다른 키·없는 키는 실패, 서명 줄이 없으면 읽지 않는다', () => {
  const csv = make('csv', ROWS);
  assert.match(verifyExportText(csv, [{ ...KEYS[0], publicKeyPem: pem(other.publicKey) }]).problems.join(), /서명이 맞지 않습니다/);
  assert.match(verifyExportText(csv, [{ ...KEYS[0], purpose: 'policy' }]).problems.join(), /용도/);
  assert.match(verifyExportText(csv, []).problems.join(), /공개 키가 없습니다/);
  assert.equal(verifyExportText('id,at\r\n1,x\r\n', KEYS).ok, false);
});

test('키 파일 — GET /api/pki/keys 응답과 PEM 하나를 모두 읽는다', () => {
  assert.equal(loadKeys(JSON.stringify({ items: KEYS }))[0].keyId, 'KEY-EXP-0001');
  const one = loadKeys(pem(publicKey), 'KEY-EXP-0001');
  assert.equal(verifyExportText(make('csv', ROWS), one).ok, true);
});
