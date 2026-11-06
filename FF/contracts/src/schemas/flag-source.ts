// Git SDK 호출 위치의 개발자/CI 스냅샷. 원격 저장소가 확인한 증명이나 차량 적용 상태가 아니다.
import { z } from 'zod';
import { ControlPointType } from '../enums';
import { PublicationStatus } from './ops';
import { PolicyStatus } from './policy';

const clean = (max: number) => z.string().min(1).max(max).refine((s) => s === s.trim() && !/[\x00-\x1f\x7f]/.test(s), '앞뒤 공백과 제어 문자는 쓸 수 없습니다.');
export const FlagSourceProvider = z.enum(['GITLAB', 'GITHUB']);
export type FlagSourceProvider = z.infer<typeof FlagSourceProvider>;
export const FLAG_SOURCE_METHODS = ['getBooleanValue', 'getBooleanDetails', 'getStringValue', 'getNumberValue', 'getObjectValue', 'isEnabled', 'getVariant'] as const;
export const FlagSourceMethod = z.enum(FLAG_SOURCE_METHODS);
export const FlagSourceSafeDefault = z.enum(['EXPLICIT_FALSE', 'SDK_DEFAULT', 'UNCONFIRMED']);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'sha256: 뒤에 소문자 16진수 64자리를 쓰세요.');

export const FlagSourceRepository = clean(2048).superRefine((value, ctx) => {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || value.includes('?') || value.includes('#') || !u.hostname || !u.pathname.replace(/\//g, '')) throw new Error();
  } catch {
    ctx.addIssue({ code: 'custom', message: '저장소 주소는 인증 정보·질의·fragment가 없는 HTTPS 주소여야 합니다.' });
  }
}).transform((value) => new URL(value).href.replace(/\.git\/?$/, '').replace(/\/$/, ''));

export const FlagSourcePath = clean(1024).refine((value) => !value.includes('\\') && !/^[a-zA-Z]:/.test(value) && value.split('/').every((s) => !!s && s !== '.' && s !== '..'), '소스 경로는 상위 경로 이동이 없는 상대 POSIX 경로여야 합니다.');
export const FlagSourceUsage = z.object({
  flagKey: clean(200),
  path: FlagSourcePath,
  line: z.number().int().min(1).max(10_000_000),
  symbol: clean(500),
  method: FlagSourceMethod,
  safeDefault: FlagSourceSafeDefault,
  contentHash: digest,
}).strict();
export type FlagSourceUsage = z.infer<typeof FlagSourceUsage>;

export const FlagSourceManifest = z.object({
  format: z.literal('ff-flag-source/v1'),
  provider: FlagSourceProvider,
  repository: FlagSourceRepository,
  commit: z.string().regex(/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/, '축약하지 않은 Git 커밋 해시를 쓰세요.').transform((s) => s.toLowerCase()),
  scannedAt: z.string().datetime({ offset: true }).transform((s) => new Date(s).toISOString()),
  filesScanned: z.number().int().min(0).max(5000),
  unresolvedCalls: z.number().int().min(0).max(1_000_000),
  usages: z.array(FlagSourceUsage).max(100_000),
}).strict().superRefine((manifest, ctx) => {
  const files = new Map<string, string>();
  for (const [index, usage] of manifest.usages.entries()) {
    const prior = files.get(usage.path);
    if (prior && prior !== usage.contentHash) ctx.addIssue({ code: 'custom', path: ['usages', index, 'contentHash'], message: '같은 파일의 내용 해시가 서로 다릅니다.' });
    files.set(usage.path, usage.contentHash);
    const sdkDefault = usage.method === 'isEnabled' || usage.method === 'getVariant';
    if (sdkDefault !== (usage.safeDefault === 'SDK_DEFAULT')) ctx.addIssue({ code: 'custom', path: ['usages', index, 'safeDefault'], message: 'SDK 호출 방식과 기본값 분류가 맞지 않습니다.' });
  }
  if (files.size > manifest.filesScanned) ctx.addIssue({ code: 'custom', path: ['filesScanned'], message: '사용처 파일 수보다 스캔한 파일 수가 작습니다.' });
});
export type FlagSourceManifest = z.infer<typeof FlagSourceManifest>;

/** CI_IMPORT·DEMO: v1 가져오기. FF_SCAN·CI_ATTESTED: 연결 저장소의 v2 서명 스캔(20-97) — Feature Flag 탭 1단계에 v1·v2를 함께 싣는다 */
export const FlagSourceProvenance = z.enum(['CI_IMPORT', 'DEMO', 'FF_SCAN', 'CI_ATTESTED']);
export const FlagSourceImport = z.object({
  manifestId: z.string(),
  manifest: FlagSourceManifest,
  contentHash: digest,
  importedAt: z.string().datetime({ offset: true }),
  importedBy: z.string(),
  provenance: FlagSourceProvenance,
  latest: z.boolean(),
}).strict();
export type FlagSourceImport = z.infer<typeof FlagSourceImport>;

export const FlagSourceLocation = FlagSourceUsage.omit({ flagKey: true }).extend({
  repository: FlagSourceRepository,
  provider: FlagSourceProvider,
  commit: z.string(),
  url: z.string().url(),
  importedAt: z.string(),
  importedBy: z.string(),
  provenance: FlagSourceProvenance,
}).strict();
export type FlagSourceLocation = z.infer<typeof FlagSourceLocation>;

export const FeatureFlagRow = z.object({
  flagKey: z.string(),
  featureId: z.string().nullable(),
  version: z.string().nullable(),
  featureName: z.string().nullable(),
  policy: z.object({ policyId: z.string(), status: PolicyStatus, revision: z.number().int(), controlPoint: ControlPointType }).strict().nullable(),
  sources: z.array(FlagSourceLocation),
  publication: z.object({ publicationId: z.string(), status: PublicationStatus, confirmed: z.number().int().min(0), denominator: z.number().int().min(0) }).strict().nullable(),
}).strict();
export type FeatureFlagRow = z.infer<typeof FeatureFlagRow>;

export const FeatureFlagsQuery = z.object({ featureId: z.string().regex(/^FEAT-\d{5}$/).optional(), version: z.string().regex(/^\d+\.\d+\.\d+$/).optional() }).strict();
export type FeatureFlagsQuery = z.infer<typeof FeatureFlagsQuery>;

/** 경로 각 조각을 따로 인코딩해 파일 이름을 URL의 질의나 fragment로 해석하지 않게 한다. */
export function flagSourceUrl(source: { provider: FlagSourceProvider; repository: string; commit: string; path: string; line: number }): string {
  return `${source.repository}/${source.provider === 'GITLAB' ? '-/blob' : 'blob'}/${source.commit}/${source.path.split('/').map(encodeURIComponent).join('/')}#L${source.line}`;
}
