// SBOM·VEX·공급망 원산지 (보고서 v1.1 15장 · FFG-SBOM-002·003·007, FFG-SEC-006) — D06-11 보안 취약점 모니터링·D06-08 보안 배포의 순수 규칙.
//   - CycloneDX 1.6 필수 구조 검사: 생성할 때마다 통과해야 저장한다(SBOM-002). 공식 JSON Schema 전체 대조는 스키마 파일 반입 뒤 하네스로.
//   - 배포 패키지 결합: SBOM의 대상(metadata.component) 해시가 서명할 패키지 해시와 같아야 서명한다(SBOM-003).
//   - 원산지: 텔레매틱스·OTA·Feature Flag·ADS 구성요소는 개발 주체·국가를, 미국 시장은 소유·통제까지 기록한다(SEC-006·SBOM-007, BIS 15 CFR 791).
//   - VEX: 취약점 판정(not_affected·affected·fixed·under_investigation)으로 영향 구성요소 → Feature를 특정한다(15.2.2).
import { z } from 'zod';

const Hash = z.object({ alg: z.literal('SHA-256'), content: z.string().regex(/^[0-9a-f]{64}$/) }).passthrough();
const Property = z.object({ name: z.string().min(1), value: z.string() }).passthrough();
export const CdxComponent = z
  .object({
    'bom-ref': z.string().min(1),
    type: z.enum(['application', 'library', 'framework', 'firmware', 'file', 'container', 'operating-system', 'device', 'data']),
    name: z.string().min(1),
    version: z.string().min(1),
    purl: z.string().startsWith('pkg:').optional(),
    /** CycloneDX에서 선택 — 배포 패키지 결합(SBOM-003)에는 대상(metadata.component) 해시가 필요하다 */
    hashes: z.array(Hash).optional(),
    properties: z.array(Property).optional(),
  })
  .passthrough();
export type CdxComponent = z.infer<typeof CdxComponent>;
export const CdxBom = z
  .object({
    bomFormat: z.literal('CycloneDX'),
    specVersion: z.literal('1.6'),
    serialNumber: z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/),
    version: z.number().int().min(1),
    metadata: z.object({ timestamp: z.string(), component: CdxComponent }).passthrough(),
    components: z.array(CdxComponent),
    dependencies: z.array(z.object({ ref: z.string(), dependsOn: z.array(z.string()).optional() }).passthrough()).optional(),
  })
  .passthrough();
export type CdxBom = z.infer<typeof CdxBom>;

/**
 * 생성 시 구조 검사 — 위반이면 저장하지 않는다. bom-ref 중복·없는 의존 대상도 위반.
 * @rule FFG-SBOM-002 — 플랫폼 생성 SBOM의 저장 전 검사(CycloneDX 1.6 필수 구조). 협력사 납품 SBOM 입고 검사는 같은 함수
 */
export function sbomErrors(bom: unknown): string[] {
  const r = CdxBom.safeParse(bom);
  if (!r.success) return r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  const refs = r.data.components.map((c) => c['bom-ref']);
  const out: string[] = [];
  const dup = refs.filter((x, i) => refs.indexOf(x) !== i);
  if (dup.length) out.push(`bom-ref 중복: ${[...new Set(dup)].join(', ')}`);
  const known = new Set([...refs, r.data.metadata.component['bom-ref']]);
  for (const d of r.data.dependencies ?? []) for (const t of [d.ref, ...(d.dependsOn ?? [])]) if (!known.has(t)) out.push(`없는 의존 대상: ${t}`);
  return out;
}

/**
 * 배포 패키지 결합 — SBOM 대상 해시와 서명할 패키지 해시가 같아야 한다.
 * @rule FFG-SBOM-003 — 해시 불일치 패키지는 서명하지 않는다(보안 배포 D06-08이 서명 직전에 부른다)
 */
export function sbomBinding(bom: Pick<CdxBom, 'metadata'>, packageSha256: string): { ok: boolean; message: string } {
  const h = bom.metadata.component.hashes?.find((x) => x.alg === 'SHA-256')?.content;
  const want = packageSha256.replace(/^sha256:/, '');
  return h === want ? { ok: true, message: `SBOM 대상 해시 = 패키지 해시 ${want.slice(0, 12)}…` } : { ok: false, message: `SBOM 대상 해시 ${h?.slice(0, 12) ?? '없음'}… ≠ 패키지 해시 ${want.slice(0, 12)}… — 서명하지 않는다` };
}

/** 원산지 관리 대상 범주 — 텔레매틱스(VCS)·OTA·Feature Flag·ADS */
export const ORIGIN_CATEGORIES = ['VCS', 'OTA', 'FF', 'ADS'] as const;
const prop = (c: CdxComponent, name: string) => c.properties?.find((p) => p.name === name)?.value?.trim() || null;

/**
 * 원산지 속성 누락 — 대상 범주 구성요소마다 개발 주체·국가, 미국 시장 VCS·ADS는 소유·통제까지.
 * @rule FFG-SEC-006, FFG-SBOM-007 — 속성 기록·누락 검출. 10년 보존은 SBOM 저장소 보존 설정, 적합성 선언 작성은 법무
 */
export function originErrors(bom: Pick<CdxBom, 'components'>, markets: string[]): string[] {
  const us = markets.includes('US');
  const out: string[] = [];
  for (const c of bom.components) {
    const cat = prop(c, 'ffp:category');
    if (!cat || !(ORIGIN_CATEGORIES as readonly string[]).includes(cat)) continue;
    const need = ['ffp:origin:developer', 'ffp:origin:country', ...(us && (cat === 'VCS' || cat === 'ADS') ? ['ffp:origin:ownership', 'ffp:origin:control'] : [])];
    const missing = need.filter((n) => !prop(c, n));
    if (missing.length) out.push(`${c['bom-ref']}(${cat}): ${missing.map((m) => m.replace('ffp:origin:', '')).join('·')} 없음`);
  }
  return out;
}

export const VEX_STATES = ['not_affected', 'affected', 'fixed', 'under_investigation'] as const;
export const VexStatement = z
  .object({
    vulnId: z.string().min(3),
    /** 영향 대상 구성요소 bom-ref(또는 purl) */
    affects: z.array(z.string().min(1)).min(1),
    state: z.enum(VEX_STATES),
    /** not_affected는 근거가 필요하다(CycloneDX impactAnalysisJustification) */
    justification: z.enum(['code_not_present', 'code_not_reachable', 'requires_configuration', 'requires_dependency', 'requires_environment', 'protected_by_compiler', 'protected_at_runtime', 'protected_at_perimeter', 'protected_by_mitigating_control']).optional(),
    detail: z.string().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.state !== 'not_affected' || !!v.justification, { message: 'not_affected 판정에는 근거(justification)가 필요합니다', path: ['justification'] });
export type VexStatement = z.infer<typeof VexStatement>;

/** Kill 경로 구성요소 — affected면 최우선, 대체 전달 경로 검토(15.2.2) */
export const KILL_PATH_CATEGORY = 'KILL_PATH';

/**
 * VEX 판정 → 영향 Feature(그 구성요소를 쓰는 SBOM의 대상 Feature)와 조치 권고.
 * affected → 보안 사유 차단 또는 업데이트 결정(Kill 경로면 최우선), under_investigation → 조사, 그 밖 → 조치 없음.
 */
export function vexImpact(v: VexStatement, sboms: { featureId: string; featureVersion: string; bom: Pick<CdxBom, 'components'> }[]) {
  const hit = (c: CdxComponent) => v.affects.includes(c['bom-ref']) || (!!c.purl && v.affects.includes(c.purl));
  const features = sboms
    .filter((s) => s.bom.components.some(hit))
    .map((s) => ({ featureId: s.featureId, featureVersion: s.featureVersion, killPath: s.bom.components.some((c) => hit(c) && prop(c, 'ffp:category') === KILL_PATH_CATEGORY) }));
  const action = v.state === 'affected' ? (features.some((f) => f.killPath) ? 'KILL_PATH_PRIORITY' : 'SECURITY_KILL_OR_UPDATE') : v.state === 'under_investigation' ? 'INVESTIGATE' : 'NONE';
  return { vulnId: v.vulnId, state: v.state, features, action } as const;
}
