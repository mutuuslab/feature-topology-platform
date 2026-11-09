// Browser WebCrypto port of native supplier-proof. No URI is fetched. Native parity is regression tested.
// 체크섬과 대상 manifest를 서버가 재계산한다. 저장된 VERIFIED 문자열이나 출처 URI는 검증 근거가 아니다.
import { sha256 } from '../../software';
import { canonicalJson } from '../../../../../contracts/src/rules/canonical';
import { CHECKSUM_FORMAT, type ArtifactIntegrity, type SupplierPackageRow } from '../../../../../contracts/src/rules/supplier';
import type { SubmitSupplierArtifactBody } from '../../../../../contracts/src/schemas/supplier';

type Target = Pick<SupplierPackageRow, 'featureId' | 'featureVersion' | 'version'>;
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
export const artifactChecksum = async (text: string) => `sha256:${await sha256(text)}`;

/** 출처를 브라우저에서 읽을 수 있는 HTTPS 주소로 제한한다. 서버는 임의 주소를 자동으로 fetch하지 않는다(내부망 요청 방지). */
export function publicArtifactUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && u.hostname.includes('.') && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname) && !/\.(localhost|local|internal)$/i.test(u.hostname);
  } catch { return false; }
}

/** UTF-8 JSON 보관 형식: 일반 산출물은 package 대상 manifest, OpenAPI는 x-ff-package 확장으로 결속한다.
 *  내용 일치/구문 확인이며 공급사의 시험·인증을 플랫폼이 대신 실행했다는 뜻은 아니다. 실제 검수자가 별도 승인한다. */
export async function verifyArtifact(pkg: Target, a: SubmitSupplierArtifactBody): Promise<{ integrity: ArtifactIntegrity; reason: string; bodyChecksum: string | null }> {
  if (a.text === null || a.text === undefined) return { integrity: 'DECLARED', reason: '본문 미보관 — 출처와 체크섬만 신고됨', bodyChecksum: null };
  const bodyChecksum = await artifactChecksum(a.text);
  const bad = (reason: string) => ({ integrity: 'MISMATCH' as const, reason, bodyChecksum });
  if (!publicArtifactUri(a.uri)) return bad('외부 HTTPS 출처가 아닌 산출물입니다');
  if (!CHECKSUM_FORMAT.test(a.checksum) || bodyChecksum !== a.checksum) return bad('서버가 계산한 본문 체크섬이 신고 값과 다릅니다');
  if (a.version !== pkg.version) return bad('산출물 버전과 패키지 버전이 다릅니다');
  let doc: Record<string, unknown> | null;
  try { doc = object(JSON.parse(a.text)); } catch { return bad('검수용 JSON 본문을 해석할 수 없습니다'); }
  if (!doc) return bad('검수 본문은 JSON 객체여야 합니다');
  const binding = object(doc[a.type === 'API_CONTRACT' && a.apiFormat === 'OPENAPI' ? 'x-ff-package' : 'package']);
  if (!binding || binding.featureId !== pkg.featureId || binding.featureVersion !== pkg.featureVersion || binding.packageVersion !== pkg.version) return bad('본문 manifest의 Feature·Version·패키지 버전이 대상과 다릅니다');
  const fields: Record<string, keyof SubmitSupplierArtifactBody> = { FEATURE_MAPPING: 'mappingIds', CAPABILITY_MANIFEST: 'capability', VARIANT_COMPAT: 'variants', DIAGNOSTICS: 'diagnostics', SAFETY_SECURITY: 'safety', TEST_EVIDENCE: 'testEvidence', RELEASE_NOTE: 'releaseNote' };
  const field = fields[a.type];
  if (field && canonicalJson(doc[field]) !== canonicalJson(a[field])) return bad(`본문 ${field}와 제출 메타데이터가 다릅니다`);
  if (a.type === 'API_CONTRACT') {
    if (a.apiFormat === 'OPENAPI') {
      const info = object(doc.info);
      if (typeof doc.openapi !== 'string' || !/^3\.2\.\d+$/.test(doc.openapi) || !info || info.version !== pkg.version || !object(doc.paths)) return bad('OpenAPI 3.2 계약의 info.version·paths를 확인하세요');
    } else if (typeof doc.protobuf !== 'string' || !/syntax\s*=\s*["']proto3["']\s*;/.test(doc.protobuf)) return bad('Protobuf 계약의 proto3 본문이 필요합니다');
  }
  return { integrity: 'VERIFIED', reason: '보관 본문 SHA-256·대상 manifest·메타데이터 일치', bodyChecksum };
}
