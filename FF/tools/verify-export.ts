// 감사·검증 이력 내보내기 파일 독립 검증 — 서버 없이 파일과 공개 키만으로 내용 해시·서명을 확인한다(외부 감사 대응, 기능명세서 B4).
//   node tools/verify-export.ts <내보낸 파일.csv|json> --keys <공개 키 목록.json(GET /api/pki/keys 응답) | 공개 키.pem>
// 확인: ① 데이터 부분 SHA-256 = 서명 대상 sha256 ② JSON은 행 수 = rows ③ 사람이 읽는 머리 줄 = 서명 대상
//       ④ 서명 입력 해시 = 'sha256:'+hex(정규 JSON(서명 대상)) ⑤ Ed25519 서명이 그 키(용도 export)로 맞다. 하나라도 어긋나면 종료 코드 1.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FF } from './lib.ts';

const require = createRequire(import.meta.url);
const { parseExportFile, canonicalJson } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../contracts/src/index');

export interface ExportKey {
  keyId: string;
  publicKeyPem: string;
  purpose?: string;
}

export interface ExportVerdict {
  ok: boolean;
  kind: string | null;
  rows: number | null;
  keyId: string | null;
  generatedBy: string | null;
  problems: string[];
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** 파일 내용 + 공개 키들 → 판정. 키는 keyId로 고르고, 용도가 있으면 export여야 한다 */
export function verifyExportText(text: string, keys: ExportKey[]): ExportVerdict {
  let parsed: ReturnType<typeof parseExportFile>;
  try {
    parsed = parseExportFile(text);
  } catch (e) {
    return { ok: false, kind: null, rows: null, keyId: null, generatedBy: null, problems: [`파일을 읽을 수 없습니다: ${(e as Error).message}`] };
  }
  const p = parsed.payload;
  const problems = [...parsed.mismatches];
  if (sha256(parsed.data) !== p.sha256) problems.push('데이터 부분의 SHA-256이 서명 대상과 다릅니다(내용이 바뀌었습니다)');
  if (parsed.rowCount !== null && parsed.rowCount !== p.rows) problems.push(`행 수가 다릅니다(파일 ${parsed.rowCount} · 서명 ${p.rows})`);
  const signedHash = 'sha256:' + sha256(canonicalJson(p));
  if (parsed.payloadHash !== null && parsed.payloadHash !== signedHash) problems.push('서명 입력 해시가 서명 대상과 다릅니다');
  const key = keys.find((k) => k.keyId === parsed.signature.keyId);
  if (!key) problems.push(`서명 키 ${parsed.signature.keyId}의 공개 키가 없습니다`);
  else if (key.purpose && key.purpose !== 'export') problems.push(`서명 키 ${key.keyId}는 내보내기 용도가 아닙니다(${key.purpose})`);
  else if (parsed.signature.alg !== 'Ed25519') problems.push(`알 수 없는 서명 알고리즘: ${parsed.signature.alg}`);
  else {
    let good = false;
    try {
      good = verify(null, Buffer.from(signedHash), createPublicKey(key.publicKeyPem), Buffer.from(parsed.signature.signature, 'base64'));
    } catch {
      good = false;
    }
    if (!good) problems.push('서명이 맞지 않습니다');
  }
  return { ok: problems.length === 0, kind: p.kind, rows: p.rows, keyId: parsed.signature.keyId, generatedBy: p.generatedBy, problems };
}

/** 키 파일 — GET /api/pki/keys 응답(JSON) 또는 PEM 하나(keyId는 파일의 서명 줄 것을 쓴다) */
export function loadKeys(text: string, keyIdForPem?: string): ExportKey[] {
  const t = text.trim();
  if (t.startsWith('-----BEGIN')) return [{ keyId: keyIdForPem ?? '*', publicKeyPem: t }];
  const j = JSON.parse(t) as { items?: ExportKey[] } | ExportKey[];
  return Array.isArray(j) ? j : (j.items ?? []);
}

function main(argv: string[]): number {
  const file = argv[0];
  const ki = argv.indexOf('--keys');
  if (!file || ki < 0 || !argv[ki + 1]) {
    console.error('사용법: node tools/verify-export.ts <내보낸 파일> --keys <GET /api/pki/keys 응답.json | 공개 키.pem>');
    return 2;
  }
  const text = readFileSync(file, 'utf8');
  let keyId: string | undefined;
  try {
    keyId = parseExportFile(text).signature.keyId;
  } catch {
    keyId = undefined;
  }
  const v = verifyExportText(text, loadKeys(readFileSync(argv[ki + 1], 'utf8'), keyId));
  console.log(v.ok ? `통과 — ${v.kind} ${v.rows}행 · 서명 키 ${v.keyId} · 내보낸 사람 ${v.generatedBy}` : `실패 — ${v.problems.join(' / ')}`);
  return v.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
