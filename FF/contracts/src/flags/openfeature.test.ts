// OpenFeature 경계 순수 규칙 — FFG-OFT-001·002·003·004·005·007, FFG-PLT-011 (TC-FF-51·52)
import { describe, expect, it } from 'vitest';
import type { Policy } from '../schemas/policy';
import { contextViolations, evaluationSpan, flagCatalog, flagdExport, flagManifest, OPENFEATURE_PINS, OPENFEATURE_SCOPE, openFeatureAllowed } from './openfeature';

const P = (o: Partial<Policy>): Policy => ({ policyId: 'POL-00001', revision: 1, status: 'DEPLOYED', flagKey: 'k', featureId: 'FEAT-00001', featureVersion: '1.0.0', safeDefault: false, description: 'd', ...o }) as Policy;
const fClassOf = (f: string) => (f === 'FEAT-00022' ? 'F3' : f === 'FEAT-00024' ? 'F1' : 'F0') as 'F0' | 'F1' | 'F3';

describe('OpenFeature 경계 — TC-FF-51', () => {
  it('FFG-OFT-001·FFG-PLT-011: F0·F1만 OpenFeature로 평가', () => {
    expect(['F0', 'F1', 'F2', 'F3', 'F4'].map((f) => openFeatureAllowed(f as any))).toEqual([true, true, false, false, false]);
  });

  it('FFG-OFT-003: 위치·운전자 식별·연락처·동적 상태 키는 금지, targetingKey·등록 속성은 허용', () => {
    expect(contextViolations({ targetingKey: 'x', country: 'KR', vehicleTrim: 'Premium' })).toEqual([]);
    expect(contextViolations({ latitude: 1, driverId: 'd', email: 'e', speed: 3 }).map((v) => v.kind)).toEqual(['위치', '운전자 식별', '연락처', '차량 동적 상태']);
  });

  it('FFG-OFT-004: 감사 span은 OTel feature_flag 의미 규약 속성, 가명 subject만', () => {
    const s = evaluationSpan({ flagKey: 'k', provider: 'p', subject: 'abc123', fClass: 'F1', variant: 'on', reason: 'TARGETING_MATCH', errorType: null, snapshotVersion: 'snap-1', at: 't', traceSeed: 'x' });
    expect(s).toMatchObject({ name: 'feature_flag.evaluation', attributes: { 'feature_flag.key': 'k', 'feature_flag.provider.name': 'p', 'feature_flag.context.id': 'abc123', 'feature_flag.result.reason': 'targeting_match', 'feature_flag.result.variant': 'on', 'feature_flag.version': 'snap-1', 'ffp.f_class': 'F1' } });
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('flagd 내보내기·매니페스트 — TC-FF-52 · OF-7', () => {
  const policies = [P({ flagKey: 'care_00022_param', featureId: 'FEAT-00022' }), P({ policyId: 'POL-00003', flagKey: 'ivi_00024_guide', featureId: 'FEAT-00024' }), P({ policyId: 'POL-00004', flagKey: 'draft_only', status: 'DRAFT' })];

  it('FFG-OFT-005·002: flagd는 F0·F1만, defaultVariant=off, 결과 검사', () => {
    const f = flagdExport(flagCatalog(policies, fClassOf));
    expect(Object.keys(f.flags)).toEqual(['ivi_00024_guide']);
    expect(f.flags.ivi_00024_guide.defaultVariant).toBe('off');
    expect(f.excluded).toEqual([{ flagKey: 'care_00022_param', fClass: 'F3' }]);
    expect(f.check.ok).toBe(true);
  });

  it('OF-7: 매니페스트는 F0·F1 boolean, revision마다 기본값이 다르거나 Safe State가 아니면 위반', () => {
    expect(flagManifest(flagCatalog(policies, fClassOf))).toMatchObject({ flags: { ivi_00024_guide: { flagType: 'boolean', defaultValue: false } }, findings: [] });
    const drift = flagCatalog([P({ flagKey: 'a' }), P({ policyId: 'POL-00009', flagKey: 'a', revision: 2, safeDefault: true })], fClassOf);
    expect(flagManifest(drift).findings.map((x) => x.rule).sort()).toEqual(['FFG-OFT-002', 'OF7-DEFAULT-DRIFT']);
  });

  it('FFG-OFT-007: SDK Version은 정확 고정(범위 기호 없음), 범위 표는 OF-1~7·경계 완료 + 범위 밖 2건', () => {
    expect(Object.values(OPENFEATURE_PINS.sdks).every((v) => /^\d+\.\d+\.\d+$/.test(v))).toBe(true);
    expect(OPENFEATURE_SCOPE.filter((s) => s.status === 'done')).toHaveLength(8);
    expect(OPENFEATURE_SCOPE.filter((s) => s.status === 'excluded').map((s) => s.id)).toEqual(['OUT-1', 'OUT-2']);
  });
});
