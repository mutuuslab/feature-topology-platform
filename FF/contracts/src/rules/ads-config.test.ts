// ADS 구성 규칙 — ODD 의미 검증·승인 상한 비교(ADS-BE09), 승인 조합 대조·보안 최소 버전(ADS-BE10), VIN 지원 판정 4상태(ORC-BE02)
import { describe, expect, it } from 'vitest';
import {
  classifyVehicleConfig,
  compareDeploySettings,
  compareToLimit,
  compatSummary,
  configSetRegistrationBlocker,
  mergeSecurityMin,
  countVerdicts,
  decideEligibility,
  eligibilityState,
  oddApprovalBlockedReason,
  oddConditionDiff,
  oddConditionText,
  recoveryCandidateVerdict,
  siteStatus,
  validateOddProfile,
  type ConfigSet,
  type EligibilityInput,
  type OddCondition,
  type VehicleConfigReport,
} from './ads-config';

const speed = (op: OddCondition['op'], value: number | null, unit: string | null, axis: OddCondition['axis'] = 'DYNAMIC'): OddCondition => ({ key: 'speedMax', axis, label: '최고 속도', op, value, unit });
const ENVELOPE: OddCondition[] = [speed('LE', 130, 'km/h'), { key: 'roadType', axis: 'ROAD', label: '도로 종류', op: 'IN', value: ['고속도로', '자동차 전용도로'], unit: null }];

describe('ODD 의미 검증', () => {
  it('경계·단위를 글자로 쓴다', () => {
    expect(oddConditionText(speed('LE', 80, 'km/h'))).toBe('80 km/h 이하(포함)');
    expect(oddConditionText(speed('LT', 80, 'km/h'))).toBe('80 km/h 미만');
  });

  it('km/h·m/s 혼용을 단위 혼용으로 잡는다', () => {
    const issues = validateOddProfile({ envelope: ENVELOPE, conditions: [speed('LE', 25, 'm/s')] });
    expect(issues.map((i) => i.code)).toContain('UNIT_MIX');
    expect(issues.find((i) => i.code === 'UNIT_MIX')!.short).toBe('속도 단위 혼용 km/h·m/s');
  });

  it('단위를 바꿔 비교한다 — 40 m/s(144 km/h)는 130 km/h 상한 초과, 30 m/s(108 km/h)는 안', () => {
    expect(compareToLimit('speedMax', speed('LE', 40, 'm/s'), ENVELOPE[0]).verdict).toBe('EXCEEDS');
    expect(compareToLimit('speedMax', speed('LE', 30, 'm/s'), ENVELOPE[0]).verdict).toBe('WITHIN');
  });

  it("'<'↔'<=' 경계 오기 — 상한이 '80 미만'인데 '80 이하(포함)'면 상한 초과", () => {
    expect(compareToLimit('speedMax', speed('LE', 80, 'km/h'), speed('LT', 80, 'km/h')).verdict).toBe('EXCEEDS');
    expect(compareToLimit('speedMax', speed('LT', 80, 'km/h'), speed('LE', 80, 'km/h')).verdict).toBe('WITHIN');
  });

  it('연산자 오기 — 최고 속도에 이상(포함)을 쓰면 오류', () => {
    expect(validateOddProfile({ envelope: ENVELOPE, conditions: [speed('GE', 100, 'km/h')] }).map((i) => i.code)).toContain('OPERATOR_MISUSE');
  });

  it('배제 우선 위반 — 배제한 공사 구간을 도로 조건이 포함하면 오류', () => {
    const issues = validateOddProfile({
      envelope: [],
      conditions: [
        { key: 'roadSection', axis: 'EXCLUSION', label: '배제 구간', op: 'IN', value: ['공사 구간'], unit: null },
        { key: 'roadSection', axis: 'ROAD', label: '운행 구간', op: 'IN', value: ['본선', '공사 구간'], unit: null },
      ],
    });
    expect(issues.map((i) => i.code)).toEqual(['EXCLUSION_OVERLAP']);
  });

  it('오류 2건(단위 혼용·상한 초과)이면 ux 막힘 사유 문장 그대로', () => {
    const issues = validateOddProfile({ envelope: ENVELOPE, conditions: [speed('LE', 40, 'm/s')] });
    expect(issues.map((i) => i.code).sort()).toEqual(['ENVELOPE_EXCEEDED', 'UNIT_MIX']);
    expect(oddApprovalBlockedReason(issues)).toBe('의미 검증 오류 2건(속도 단위 혼용 km/h·m/s, 승인 상한 초과)이 남아 승인할 수 없습니다 — 초안에서 고친 뒤 다시 검증하세요.');
    expect(oddApprovalBlockedReason([])).toBeNull();
  });

  it('배포 설정 비교 — 값 없음·단위 해석 실패는 판단 불가(상한 안으로 세지 않음)', () => {
    const rows = compareDeploySettings(
      [
        { settingId: 'a', featureId: 'F', featureVersion: '1.0.0', flagKey: 'k', key: 'speedMax', label: 's', op: 'LE', value: 120, unit: 'km/h' },
        { settingId: 'b', featureId: 'F', featureVersion: '1.0.0', flagKey: 'k', key: 'speedMax', label: 's', op: 'LE', value: 140, unit: 'km/h' },
        { settingId: 'c', featureId: 'F', featureVersion: '1.0.0', flagKey: 'k', key: 'speedMax', label: 's', op: 'LE', value: null, unit: 'km/h' },
        { settingId: 'd', featureId: 'F', featureVersion: '1.0.0', flagKey: 'k', key: 'speedMax', label: 's', op: 'LE', value: 70, unit: 'mph' },
      ],
      ENVELOPE,
    );
    expect(countVerdicts(rows)).toEqual({ WITHIN: 1, EXCEEDS: 1, UNDECIDABLE: 2 });
  });

  it('적용 장소 — 지도 버전이 상한 밖이면 노출 보류, 변경 영향 미확정이면 승인 대기', () => {
    const ap = { mapVersions: ['2.2'], infraVersions: ['1.0'] };
    const site = { siteId: 's', name: 'n', kind: 'ROAD_SECTION' as const, mapVersion: '2.2', infraVersion: '1.0', impactConfirmed: true };
    expect(siteStatus(site, ap).status).toBe('APPROVED');
    expect(siteStatus({ ...site, mapVersion: '2.3' }, ap)).toMatchObject({ status: 'EXPOSURE_HOLD', reason: '노출 보류 — 지도 버전 2.3이 승인 상한 밖' });
    expect(siteStatus({ ...site, impactConfirmed: false }, ap)).toMatchObject({ status: 'PENDING', code: 'IMPACT_REVIEW_OPEN' });
  });

  it('변경 전후 — 바뀐 조건만, 배제가 먼저', () => {
    const before = [speed('LE', 80, 'km/h')];
    const after = [speed('LE', 100, 'km/h'), { key: 'roadSection', axis: 'EXCLUSION' as const, label: '배제 구간', op: 'IN' as const, value: ['터널'], unit: null }];
    expect(oddConditionDiff(before, after)).toEqual([
      { field: '배제 · 배제 구간', before: '—', after: '터널 중 하나' },
      { field: '동적 · 최고 속도', before: '80 km/h 이하(포함)', after: '100 km/h 이하(포함)' },
    ]);
  });
});

const NOW = Date.parse('2026-11-06T00:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const SET: ConfigSet = {
  setId: 'CFG-FEAT-00022-01', featureId: 'FEAT-00022', featureVersion: '1.0.0',
  hw: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B' }, { ecuPno: '95790-NX300', hwRevision: 'Rev.C' }],
  ecuSw: [{ ecuPno: '99211-NX400', swId: 'SW-CARE-SDIST-APP', version: '1.2.1' }, { ecuPno: '95790-NX300', swId: 'SW-CAMERA-FW', version: '8.1.0' }],
  model: { id: 'MDL-GAP', version: '1.4.0' }, calibration: { id: 'CAL-NX4', version: '2026.10' }, oddProfileId: null, flagKey: null,
  securityMin: [{ swId: 'SW-CARE-SDIST-APP', version: '1.2.0' }], status: 'APPROVED', approvedBy: 'usr-variant', approvedAt: ago(500),
};
const report = (over: Partial<VehicleConfigReport> = {}): VehicleConfigReport => ({
  vin: 'V', reportedAt: ago(1),
  ecus: [{ ecuPno: '99211-NX400', hwRevision: 'Rev.B', sw: [{ swId: 'SW-CARE-SDIST-APP', version: '1.2.1' }] }, { ecuPno: '95790-NX300', hwRevision: 'Rev.C', sw: [{ swId: 'SW-CAMERA-FW', version: '8.1.0' }] }],
  model: { id: 'MDL-GAP', version: '1.4.0' }, calibration: { id: 'CAL-NX4', version: '2026.10' }, recovery: null, recoveryCandidate: null,
  ...over,
});

describe('승인 조합 대조', () => {
  it('부합·불일치(개별 버전이 유효해도 조합 밖)·부분 복구·보안 최소 버전 미달·형상 미확인', () => {
    expect(classifyVehicleConfig(SET, report(), NOW).cls).toBe('MATCH');
    const mismatch = classifyVehicleConfig(SET, report({ calibration: { id: 'CAL-NX4', version: '2026.09' } }), NOW);
    expect(mismatch).toMatchObject({ cls: 'MISMATCH', code: 'CONFIG_SET_NOT_APPROVED' });
    const partial = classifyVehicleConfig(SET, report({ recovery: { targets: ['99211-NX400', '95790-NX300'], recovered: ['99211-NX400'] } }), NOW);
    expect(partial).toMatchObject({ cls: 'PARTIAL_RECOVERY', code: 'RECOVERY_PARTIAL' });
    expect(partial.reasons).toEqual(['99211-NX400 복구됨', '95790-NX300 미복구']);
    const low = report();
    low.ecus[0].sw[0].version = '1.1.9';
    expect(classifyVehicleConfig(SET, low, NOW).cls).toBe('BELOW_SECURITY_MIN');
    expect(classifyVehicleConfig(SET, report({ reportedAt: ago(72) }), NOW).cls).toBe('UNCONFIRMED');
    expect(classifyVehicleConfig(SET, null, NOW).cls).toBe('UNCONFIRMED');
  });

  it('형상 미확인은 부합·조합 밖 어느 쪽에도 세지 않는다', () => {
    expect(compatSummary([{ cls: 'MATCH' }, { cls: 'UNCONFIRMED' }, { cls: 'PARTIAL_RECOVERY' }, { cls: 'MISMATCH' }, { cls: 'BELOW_SECURITY_MIN' }])).toEqual({ outside: 3, partial: 1, unconfirmed: 1, match: 1, total: 5 });
  });

  it('보안 최소 버전 — 복구 후보 불가와 등록 거부', () => {
    expect(recoveryCandidateVerdict(SET, { swId: 'SW-CARE-SDIST-APP', version: '1.1.9' })).toEqual({ allowed: false, reason: '복구 후보 불가 — 보안 최소 버전 미달(SW-CARE-SDIST-APP 1.1.9 < 1.2.0)' });
    expect(recoveryCandidateVerdict(SET, { swId: 'SW-CARE-SDIST-APP', version: '1.2.0' }).allowed).toBe(true);
    expect(configSetRegistrationBlocker({ ecuSw: [{ ecuPno: 'E', swId: 'SW-CARE-SDIST-APP', version: '1.1.0' }], securityMin: SET.securityMin })).toBe('ECU SW 하나가 보안 최소 버전보다 낮아 이 조합을 등록할 수 없습니다.');
    expect(configSetRegistrationBlocker(SET)).toBeNull();
    // 비교할 수 없는 버전(앞자리 0)은 통과로 보지 않는다
    expect(configSetRegistrationBlocker({ ecuSw: [{ ecuPno: 'E', swId: 'SW-CARE-SDIST-APP', version: '01.1.0' }], securityMin: SET.securityMin })).toBe('ECU SW 버전을 보안 최소 버전과 비교할 수 없어 이 조합을 등록할 수 없습니다.');
    // 하한 합치기 — SW마다 높은 쪽, 요청으로 낮출 수 없다
    expect(mergeSecurityMin([{ swId: 'A', version: '1.2.0' }], [{ swId: 'A', version: '1.0.0' }, { swId: 'B', version: '2.0.0' }])).toEqual([{ swId: 'A', version: '1.2.0' }, { swId: 'B', version: '2.0.0' }]);
    expect(mergeSecurityMin([{ swId: 'A', version: '1.2.0' }], [{ swId: 'A', version: '1.10.0' }])).toEqual([{ swId: 'A', version: '1.10.0' }]);
  });
});

describe('VIN 지원 판정 4상태', () => {
  const base = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
    vehicle: { vin: 'V', country: 'KR' },
    catalog: { catalogId: 'CAT-00019', country: 'KR', saleType: '체험' },
    legalProfile: { profileId: 'KR', status: 'CONFIRMED' },
    productApproval: { approvedBy: 'usr-product' },
    feature: { featureId: 'FEAT-00022', version: '1.0.0', swId: 'SW-CARE-SDIST-APP', requiredSw: '1.2.1', ecuPnos: ['99211-NX400'] },
    asBuiltEcus: null,
    report: report(),
    grants: [],
    now: NOW,
    ...over,
  });

  it('모두 충족이면 바로 구매 가능(지원 확인됨)', () => {
    expect(decideEligibility(base()).state).toBe('ELIGIBLE');
  });

  it("설치 기록 연동 전에는 SW가 낮아도 '업데이트 후 가능'을 내지 않고 차량 확인 필요 — 미확인", () => {
    const low = report();
    low.ecus[0].sw[0].version = '1.1.9';
    const d = decideEligibility(base({ report: low }));
    expect(d.state).toBe('VEHICLE_CHECK');
    expect(d.reasons.find((r) => r.axis === 'SW')).toMatchObject({ result: 'UNCONFIRMED', code: 'OTA_INSTALL_UNLINKED' });
    expect(d.headline).toBe('차량 확인 필요 — SW 1.2.1 필요, 설치 기록 연동 전이라 미확인');
    expect(decideEligibility(base({ report: low, otaLinked: true })).state).toBe('UPDATE_REQUIRED');
  });

  it("SW 조건 충족 + 출고 구성·차량 보고 구성 모두 없음 → 업데이트 후 가능 아님(차량 확인 필요 — 판단 불가)", () => {
    const d = decideEligibility(base({ report: null, otaLinked: true }));
    expect(d.state).toBe('VEHICLE_CHECK');
    expect(d.reasons.find((r) => r.axis === 'HW')).toMatchObject({ result: 'UNDECIDABLE', code: 'AS_BUILT_UNKNOWN' });
    expect(d.headline).toBe('차량 확인 필요 — 판단 불가(출고 구성 기록 없음)');
  });

  it('형상 보고가 오래되면 차량 확인 필요 — 미확인(형상 보고 3일 전)', () => {
    expect(decideEligibility(base({ report: report({ reportedAt: ago(72) }) })).headline).toBe('차량 확인 필요 — 미확인(형상 보고 3일 전)');
  });

  it('필요 ECU가 없으면 부품 미장착', () => {
    const d = decideEligibility(base({ feature: { featureId: 'F', version: '1.0.0', swId: null, requiredSw: null, ecuPnos: ['99211-GN700'] } }));
    expect(d.state).toBe('HW_MISSING');
  });

  it('법적 승인 있음·내부 상품 승인 없음 / 그 반대 → 서로 다른 사유 코드, 둘 다 있어야 바로 가능', () => {
    const noProduct = decideEligibility(base({ productApproval: null }));
    const noLegal = decideEligibility(base({ legalProfile: { profileId: 'KR', status: 'VERIFY_REQUIRED' } }));
    expect(noProduct.state).toBe('VEHICLE_CHECK');
    expect(noLegal.state).toBe('VEHICLE_CHECK');
    expect(noProduct.reasons[0].code).toBe('PRODUCT_APPROVAL_MISSING');
    expect(noLegal.reasons[0].code).toBe('LEGAL_APPROVAL_UNCONFIRMED');
  });

  it('사유 칸 하나라도 판단 불가·미확인이면 전체 차량 확인 필요 — 구매 가능 아님', () => {
    const r = (axis: 'MARKET' | 'SW' | 'HW' | 'RIGHTS', result: 'MET' | 'UNDECIDABLE' | 'UNCONFIRMED') => ({ axis, result, basis: '', code: '' });
    expect(eligibilityState([r('MARKET', 'MET'), r('SW', 'MET'), r('HW', 'MET'), r('RIGHTS', 'UNCONFIRMED')])).toBe('VEHICLE_CHECK');
    expect(eligibilityState([r('MARKET', 'MET'), r('SW', 'MET'), r('HW', 'MET')])).toBe('VEHICLE_CHECK');
  });

  it('시장이 다르거나 체험을 이미 썼으면 판매 대상 아님', () => {
    expect(decideEligibility(base({ vehicle: { vin: 'V', country: 'EU' } })).state).toBe('NOT_OFFERED');
    expect(decideEligibility(base({ grants: [{ grantId: 'ENT-00007', kind: '체험', status: 'EXPIRED', validTo: '2026-10-01' }] })).state).toBe('NOT_OFFERED');
    expect(decideEligibility(base({ grants: [{ grantId: 'ENT-00001', kind: '체험', status: 'ACTIVE', validTo: '2026-12-01' }] })).reasons[3]).toMatchObject({ result: 'MET', code: 'RIGHTS_HELD' });
  });
});
