// 실제 구성 Attestation — FFG-VEH-007: 구성 1개 변조를 검출한다(정책 해시·Feature Version·BOM·빠짐·모름)
import { describe, expect, it } from 'vitest';
import { attestationMismatches, type AttestationEntry, type ExpectedConfig } from './attestation';
import { VehicleReportBody } from './vehicle-requests';

const H = (c: string) => 'sha256:' + c.repeat(64);
const expected: ExpectedConfig[] = [
  { featureId: 'FEAT-00022', flagKey: 'care_00022_param', featureVersion: '1.0.0', policyHash: H('a'), publicationId: 'PUB-00001', bomBaselineId: 'BL-00028' },
  { featureId: 'FEAT-00022', flagKey: 'care_00022_signal', featureVersion: '1.0.0', policyHash: H('b'), publicationId: 'PUB-00002', bomBaselineId: null },
];
const same: AttestationEntry[] = expected.map((e) => ({ featureId: e.featureId, featureVersion: e.featureVersion, flagKey: e.flagKey, policyHash: e.policyHash, bomBaselineId: e.bomBaselineId }));

describe('실제 구성 Attestation (FFG-VEH-007)', () => {
  it('FFG-VEH-007 같은 구성이면 불일치 없음 — 기대 BOM이 없으면 BOM은 비교하지 않는다', () => {
    expect(attestationMismatches(same, expected)).toEqual([]);
    expect(attestationMismatches(same.map((s, i) => (i === 1 ? { ...s, bomBaselineId: 'BL-00099' } : s)), expected)).toEqual([]);
  });

  it('FFG-VEH-007 구성 1개 변조마다 해당 불일치 — 해시·Version·BOM·빠짐·모름', () => {
    const codes = (r: AttestationEntry[]) => attestationMismatches(r, expected).map((m) => m.code);
    expect(codes([{ ...same[0], policyHash: H('c') }, same[1]])).toEqual(['POLICY_HASH']);
    expect(codes([{ ...same[0], featureVersion: '0.9.0' }, same[1]])).toEqual(['FEATURE_VERSION']);
    expect(codes([{ ...same[0], bomBaselineId: 'BL-00001' }, same[1]])).toEqual(['BOM']);
    expect(codes([same[0]])).toEqual(['MISSING']);
    expect(codes([...same, { ...same[0], flagKey: 'care_00022_x' }])).toEqual(['UNEXPECTED']);
  });

  it('FFG-VEH-007 차량 보고 ATTESTATION 형식 — 해시 형식이 틀리면 받지 않는다', () => {
    const base = { type: 'ATTESTATION', bootId: 'B-1', sequence: 1, observedAt: '2026-10-15T00:00:00Z' };
    expect(VehicleReportBody.safeParse({ ...base, configs: same }).success).toBe(true);
    expect(VehicleReportBody.safeParse({ ...base, configs: [{ ...same[0], policyHash: 'abc' }] }).success).toBe(false);
  });
});
