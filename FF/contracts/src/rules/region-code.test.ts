// 적용 지역 코드 ↔ 시장·국가 대응 표(B7 (b), FR-CRC-001-002·003, FR-GLB-001-001) — 코드 체계·등록 검증·Variant Rule 후보
import { describe, expect, it } from 'vitest';
import { CreateComplianceRuleBody } from '../schemas/compliance-rule';
import { REGION_CODES, REGION_CODE_TABLE, regionCodeIssues, regionCodeCountries, variantRuleCandidates } from './region-code';

describe('적용 지역 코드 체계 @req FR-CRC-001-002', () => {
  it('1~9·A~D·G 14개, 각 코드는 시장 하나에 대응', () => {
    expect(REGION_CODES).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'G']);
    expect(REGION_CODE_TABLE.map((r) => r.code)).toEqual([...REGION_CODES]);
    expect(REGION_CODE_TABLE.find((r) => r.code === '1')).toMatchObject({ nameKo: '한국', market: 'KR', countries: ['KR'] });
    expect(REGION_CODE_TABLE.find((r) => r.code === '4')).toMatchObject({ nameKo: '유럽', market: 'EU', countries: ['EU'] });
    expect(REGION_CODE_TABLE.find((r) => r.code === 'G')).toMatchObject({ nameKo: '인니', market: 'OTHER', countries: ['ID'] });
  });
  it('목록 밖 코드는 사유와 함께 거부', () => {
    expect(regionCodeIssues(['E'], ['EU'])[0]).toMatch(/E.*1~9·A~D·G/);
    expect(regionCodeIssues(['4', '4'], ['EU'])[0]).toMatch(/두 번/);
  });
  it('코드의 시장이 적용 지역(시장)에 없으면 거부', () => {
    expect(regionCodeIssues(['4'], ['KR'])[0]).toMatch(/유럽.*EU/);
    expect(regionCodeIssues(['4', '1'], ['EU', 'KR'])).toEqual([]);
  });
  it('룰 등록 본문 — 지역 코드는 선택, 틀리면 저장하지 않는다', () => {
    const base = {
      ruleId: 'CR-REG-901', name: '유럽 개인정보', type: 'PRIVACY', criteria: [{ check: 'SAFE_DEFAULT_OFF' }], approverIds: ['usr-safety'],
      evidence: { docName: 'GDPR' }, validFrom: '2026-01-01',
    };
    expect(CreateComplianceRuleBody.safeParse({ ...base, scope: { markets: ['EU'] } }).success).toBe(true);
    expect(CreateComplianceRuleBody.safeParse({ ...base, scope: { markets: ['EU'], regionCodes: ['4'] } }).success).toBe(true);
    const bad = CreateComplianceRuleBody.safeParse({ ...base, scope: { markets: ['EU'], regionCodes: ['Z'] } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].path).toEqual(['scope', 'regionCodes']);
  });
});

describe('지역 코드 → 국가, Variant Rule 후보 @req FR-CRC-001-003', () => {
  it('코드 묶음의 국가', () => {
    expect(regionCodeCountries(['1', '3'])).toEqual(['KR', 'ME']);
    expect(regionCodeCountries(['2'])).toEqual([]);
  });
  it('Variant 조건(국가·차종·트림·UPG-VC)과 26580 구성(상품)을 코드 국가로 고른다', () => {
    const features = [
      { featureId: 'FEAT-00001', version: '1.0.0', name: 'A', country: 'KR', vehicleModel: 'NX4', trim: 'P', upgVc: ['U1'], lifecycle: 'APPROVED' },
      { featureId: 'FEAT-00002', version: '1.0.0', name: 'B', country: 'KR', vehicleModel: 'NX4', trim: 'P', upgVc: ['U1'], lifecycle: 'VERIFIED' },
      { featureId: 'FEAT-00003', version: '1.0.0', name: 'C', country: 'US', vehicleModel: 'NX4', trim: 'P', upgVc: [], lifecycle: 'APPROVED' },
      { featureId: 'FEAT-00004', version: '1.0.0', name: 'D', country: 'KR', vehicleModel: 'CN7', trim: 'S', upgVc: [], lifecycle: 'RETIRED' },
    ];
    const products = [
      { catalogId: 'CAT-00001', version: '1.0.0', name: '주차 패키지', country: 'KR', vehicleModel: 'NX4', trim: 'P', type: 'PACKAGE', lifecycle: 'DEVELOPING', features: ['FEAT-00001'] },
      { catalogId: 'CAT-00002', version: '1.0.0', name: '미국 패키지', country: 'US', vehicleModel: 'NX4', trim: 'P', type: 'PACKAGE', lifecycle: 'DEVELOPING', features: [] },
    ];
    const c = variantRuleCandidates(['1'], features, products);
    expect(c.countries).toEqual(['KR']);
    expect(c.variantConditions).toEqual([{ key: 'KR/NX4/P/U1', source: 'VARIANT_CONDITION', country: 'KR', vehicleModel: 'NX4', trim: 'P', upgVc: ['U1'], regionCodes: ['1'], featureIds: ['FEAT-00001', 'FEAT-00002'] }]);
    expect(c.compositions.map((p) => p.catalogId)).toEqual(['CAT-00001']);
    expect(c.compositions[0]).toMatchObject({ source: 'COMPOSITION_RULE', regionCodes: ['1'] });
  });
});
