// SBOM·VEX·원산지 — FFG-SBOM-002(생성 시 구조 검사) · SBOM-003(해시 결합) · SEC-006·SBOM-007(원산지) · 15.2.2 VEX 판정
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { originErrors, sbomBinding, sbomErrors, VexStatement, vexImpact, type CdxBom } from './sbom';

// 보고서 코드 패키지가 만든 실제 CycloneDX 1.6 SBOM(부록 E)
const PKG = resolve(__dirname, '../../../../../2026-09-23_FF_IMP/FF_Safety_Guide_v2/sbom/ff_examples.cdx.json');
const H = (c: string) => c.repeat(64);
const comp = (ref: string, cat?: string, origin: Record<string, string> = {}) => ({
  'bom-ref': ref,
  type: 'library' as const,
  name: ref.split('@')[0],
  version: ref.split('@')[1] ?? '1.0.0',
  purl: `pkg:generic/x/${ref}`,
  hashes: [{ alg: 'SHA-256' as const, content: H('a') }],
  properties: [...(cat ? [{ name: 'ffp:category', value: cat }] : []), ...Object.entries(origin).map(([k, v]) => ({ name: `ffp:origin:${k}`, value: v }))],
});
const bom = (components: ReturnType<typeof comp>[]): CdxBom => ({
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: 'urn:uuid:11111111-2222-3333-4444-555555555555',
  version: 1,
  metadata: { timestamp: '2026-10-15T00:00:00Z', component: { ...comp('pkg@1.0.0'), type: 'application', hashes: [{ alg: 'SHA-256', content: H('b') }] } },
  components,
});

describe('SBOM 구조 검사 (FFG-SBOM-002)', () => {
  it.skipIf(!existsSync(PKG))('보고서 코드 패키지의 CycloneDX 1.6 SBOM은 통과한다', () => {
    expect(sbomErrors(JSON.parse(readFileSync(PKG, 'utf8')))).toEqual([]);
  });
  it('형식·버전·해시 형식이 틀리거나 bom-ref 중복·없는 의존 대상이면 위반', () => {
    expect(sbomErrors({ ...bom([]), specVersion: '1.5' })[0]).toMatch(/specVersion/);
    expect(sbomErrors(bom([{ ...comp('a@1'), hashes: [{ alg: 'SHA-256', content: 'xyz' }] }])).join()).toMatch(/hashes/);
    expect(sbomErrors(bom([comp('a@1'), comp('a@1')]))).toEqual(['bom-ref 중복: a@1']);
    expect(sbomErrors({ ...bom([comp('a@1')]), dependencies: [{ ref: 'a@1', dependsOn: ['ghost@9'] }] })).toEqual(['없는 의존 대상: ghost@9']);
  });
});

describe('패키지 해시 결합 (FFG-SBOM-003)', () => {
  it('SBOM 대상 해시와 패키지 해시가 같아야 서명 — 다르면 거부', () => {
    expect(sbomBinding(bom([]), `sha256:${H('b')}`).ok).toBe(true);
    expect(sbomBinding(bom([]), H('c'))).toMatchObject({ ok: false, message: expect.stringMatching(/서명하지 않는다/) });
  });
});

describe('원산지 (FFG-SEC-006 · FFG-SBOM-007)', () => {
  it('텔레매틱스·OTA·FF·ADS 구성요소는 개발 주체·국가, 미국 시장 VCS·ADS는 소유·통제까지 — 그 밖 범주는 대상 아님', () => {
    const b = bom([comp('tcu@1', 'VCS', { developer: 'Mutuus Lab', country: 'KR' }), comp('ota@1', 'OTA', { developer: 'Mutuus Lab' }), comp('lib@1')]);
    expect(originErrors(b, ['KR'])).toEqual(['ota@1(OTA): country 없음']);
    expect(originErrors(b, ['US'])).toEqual(['tcu@1(VCS): ownership·control 없음', 'ota@1(OTA): country 없음']);
    expect(originErrors(bom([comp('tcu@1', 'VCS', { developer: 'M', country: 'KR', ownership: 'Mutuus Lab GmbH', control: 'KR' })]), ['US'])).toEqual([]);
  });
});

describe('VEX 판정 → 영향 Feature (15.2.2)', () => {
  const sboms = [
    { featureId: 'FEAT-00022', featureVersion: '1.0.0', bom: bom([comp('json-lib@2', 'KILL_PATH'), comp('ui@1')]) },
    { featureId: 'FEAT-00024', featureVersion: '1.0.0', bom: bom([comp('ui@1')]) },
  ];
  it('not_affected는 근거가 필요하다', () => {
    expect(VexStatement.safeParse({ vulnId: 'CVE-2026-0001', affects: ['ui@1'], state: 'not_affected' }).success).toBe(false);
    expect(VexStatement.safeParse({ vulnId: 'CVE-2026-0001', affects: ['ui@1'], state: 'not_affected', justification: 'code_not_reachable' }).success).toBe(true);
  });
  it('affected면 그 구성요소를 쓰는 Feature 전부 — Kill 경로 구성요소면 최우선', () => {
    expect(vexImpact({ vulnId: 'CVE-1', affects: ['ui@1'], state: 'affected' }, sboms)).toMatchObject({ action: 'SECURITY_KILL_OR_UPDATE', features: [{ featureId: 'FEAT-00022', killPath: false }, { featureId: 'FEAT-00024' }] });
    expect(vexImpact({ vulnId: 'CVE-2', affects: ['json-lib@2'], state: 'affected' }, sboms)).toMatchObject({ action: 'KILL_PATH_PRIORITY', features: [{ featureId: 'FEAT-00022', killPath: true }] });
    expect(vexImpact({ vulnId: 'CVE-3', affects: ['pkg:generic/x/ui@1'], state: 'under_investigation' }, sboms).action).toBe('INVESTIGATE');
    expect(vexImpact({ vulnId: 'CVE-4', affects: ['ui@1'], state: 'fixed' }, sboms).action).toBe('NONE');
  });
});
