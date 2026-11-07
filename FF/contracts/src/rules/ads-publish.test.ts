// ADS 발행 검사 — 정책 컴파일 ODD 상한(ADS-BE09), 발행 후보·차량 증명(ADS-BE10), 결정적 빌드 digest 입력(ADS-BE11), 분류·시장 기준선(ADS-BE16)
import { describe, expect, it } from 'vitest';
import type { ConfigSet, DeploySetting, OddCondition, OddProfile, VehicleConfigReport } from './ads-config';
import type { AdsClassification, MarketBaseline } from './ads-change';
import {
  buildDigestInput,
  classificationConfirmHash,
  classificationReleaseBlocker,
  marketOf,
  oddCompileBlockers,
  POLICY_COMPILER_VERSION,
  publishCandidates,
  recoveryDecisionBlockers,
  recoveryMetadataVerdict,
  siteAdditionVerdict,
  validateOddRequired,
} from './ads-publish';

const NOW = Date.parse('2026-11-06T00:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const sp = (op: OddCondition['op'], value: number, unit: string): OddCondition => ({ key: 'speedMax', axis: 'DYNAMIC', label: '최고 속도', op, value, unit });
const PROFILE: OddProfile = {
  profileId: 'ODD-FEAT-00004-v1', featureId: 'FEAT-00004', featureVersion: '4.1.0', version: 1, status: 'APPROVED', basedOn: null,
  conditions: [sp('LE', 80, 'km/h')], envelope: [sp('LT', 130, 'km/h'), { key: 'region', axis: 'GEOGRAPHY', label: '운행 국가', op: 'IN', value: ['KR'], unit: null }],
  mapVersions: ['2.2'], infraVersions: ['IF-1.5'], sites: [], createdBy: 'usr-author', createdAt: ago(100), approvedBy: 'usr-safety', approvedAt: ago(90), approvalReason: '승인',
};
const setting = (id: string, over: Partial<DeploySetting>): DeploySetting => ({ settingId: id, featureId: 'FEAT-00004', featureVersion: '4.1.0', flagKey: 'hda2_speed', key: 'speedMax', label: '최고 속도', op: 'LE', value: 100, unit: 'km/h', ...over });

describe('정책 컴파일 — 승인 상한(ADS-BE09·FFP-F016)', () => {
  it('상한 안 설정만이면 막힘 없음, 다른 Flag 설정은 보지 않는다', () => {
    expect(oddCompileBlockers({ flagKey: 'hda2_speed', settings: [setting('a', {}), setting('b', { flagKey: 'other', value: 300 })], profile: PROFILE })).toEqual([]);
  });
  it('경계 초과(속도)·경계 오기(< ↔ <=)·지역 확대는 빌드 거부 — 사유 코드와 설정 ID', () => {
    const b = oddCompileBlockers({
      flagKey: 'hda2_speed',
      settings: [setting('a', { value: 140 }), setting('b', { value: 130, op: 'LE' }), setting('c', { key: 'region', label: '운행 국가', op: 'IN', value: ['KR', 'JP'], unit: null })],
      profile: PROFILE,
    });
    expect(b.map((x) => [x.code, x.ref])).toEqual([['ODD_ENVELOPE_EXCEEDED', 'a'], ['ODD_ENVELOPE_EXCEEDED', 'b'], ['ODD_ENVELOPE_EXCEEDED', 'c']]);
    expect(b[1].message).toContain('경계 포함 여부');
  });
  it('km/h ↔ m/s 혼용은 환산해 비교(40 m/s = 144 km/h → 초과), 해석 못 하는 단위는 판단 불가로 거부', () => {
    const b = oddCompileBlockers({ flagKey: 'hda2_speed', settings: [setting('a', { value: 40, unit: 'm/s' }), setting('b', { value: 70, unit: 'mph' })], profile: PROFILE });
    expect(b.map((x) => x.code)).toEqual(['ODD_ENVELOPE_EXCEEDED', 'ODD_UNDECIDABLE']);
  });
  it('승인 프로파일이 없으면 배포 설정을 대조할 수 없어 거부', () => {
    expect(oddCompileBlockers({ flagKey: 'hda2_speed', settings: [setting('a', {})], profile: null }).map((x) => x.code)).toEqual(['ODD_PROFILE_MISSING']);
    expect(oddCompileBlockers({ flagKey: 'hda2_speed', settings: [setting('a', {})], profile: { ...PROFILE, status: 'DRAFT' } }).map((x) => x.code)).toEqual(['ODD_PROFILE_MISSING']);
  });
});

describe('ODD 필수 조건(FFP-F026)', () => {
  it('승인 상한의 필수 조건이 프로파일 조건에 없으면 REQUIRED_MISSING', () => {
    const envelope: OddCondition[] = [{ ...sp('LE', 130, 'km/h'), required: true }, { key: 'region', axis: 'GEOGRAPHY', label: '운행 국가', op: 'IN', value: ['KR'], unit: null, required: true }];
    expect(validateOddRequired({ envelope, conditions: [sp('LE', 80, 'km/h')] }).map((i) => [i.code, i.key])).toEqual([['REQUIRED_MISSING', 'region']]);
    expect(validateOddRequired({ envelope, conditions: [sp('LE', 80, 'km/h'), { key: 'region', axis: 'GEOGRAPHY', label: '운행 국가', op: 'IN', value: ['KR'], unit: null }] })).toEqual([]);
  });
});

describe('적용 장소 추가 — 변경 영향 확정(HT02)', () => {
  it('변경 영향 참조가 없거나 확정 전이면 승인 대기(IMPACT_REVIEW_OPEN), 다른 Feature의 영향은 받지 않는다', () => {
    expect(siteAdditionVerdict(null, PROFILE)).toMatchObject({ status: 'PENDING', code: 'IMPACT_REVIEW_OPEN' });
    expect(siteAdditionVerdict({ impactId: 'CI-1', featureId: 'FEAT-00004', version: '4.1.0', scopeStatus: 'REVIEW_REQUIRED' }, PROFILE)).toMatchObject({ status: 'PENDING', code: 'IMPACT_REVIEW_OPEN' });
    expect(siteAdditionVerdict({ impactId: 'CI-2', featureId: 'FEAT-00009', version: '1.0.0', scopeStatus: 'CONFIRMED' }, PROFILE)).toMatchObject({ status: 'PENDING', code: 'IMPACT_OTHER_FEATURE' });
    expect(siteAdditionVerdict({ impactId: 'CI-3', featureId: 'FEAT-00004', version: '4.1.0', scopeStatus: 'CONFIRMED' }, PROFILE)).toMatchObject({ status: 'APPROVED', code: null });
  });
});

const SET: ConfigSet = {
  setId: 'CFG-1', featureId: 'FEAT-00004', featureVersion: '4.1.0', hw: [{ ecuPno: 'A', hwRevision: 'R1' }, { ecuPno: 'B', hwRevision: 'R1' }],
  ecuSw: [{ ecuPno: 'A', swId: 'SW-A', version: '1.2.0' }, { ecuPno: 'B', swId: 'SW-B', version: '2.0.0' }], model: null, calibration: null, oddProfileId: null, flagKey: null,
  securityMin: [{ swId: 'SW-A', version: '1.1.0' }], status: 'APPROVED', approvedBy: 'usr-variant', approvedAt: ago(500),
};
const rep = (vin: string, over: Partial<VehicleConfigReport> = {}): VehicleConfigReport => ({
  vin, reportedAt: ago(1), ecus: [{ ecuPno: 'A', hwRevision: 'R1', sw: [{ swId: 'SW-A', version: '1.2.0' }] }, { ecuPno: 'B', hwRevision: 'R1', sw: [{ swId: 'SW-B', version: '2.0.0' }] }],
  model: null, calibration: null, recovery: null, recoveryCandidate: null, ...over,
});
const CLS: AdsClassification = { featureId: 'FEAT-00004', version: '4.1.0', adsFeature: false, ddtImpact: 'SUPPORT', safetyRelated: true, owner: 'ADAS', source: 'MANUAL', status: 'CONFIRMED', confirmedBy: 'usr-safety', confirmedAt: ago(10), lifecycleOwners: { CREATE: 'a', OPERATE: 'b', SUSPEND: 'c', DISPOSE: 'd' } };
const BL = (market: string, approvalStatus: MarketBaseline['approvalStatus'], oddProfileRef: string | null = 'ODD-FEAT-00004-v1'): MarketBaseline => ({ market, featureId: 'FEAT-00004', version: '4.1.0', approvalType: 'SELF_CERT', regulations: [], oddProfileRef, approvalStatus, assumed: false, note: null });

describe('발행 후보 — 승인 조합·시장 기준선(ADS-BE10·BE16)', () => {
  const base = { adsScope: true, fClass: 'F2' as const, sets: [SET], baselines: [BL('KR', 'APPROVED')], approvedOddProfileId: 'ODD-FEAT-00004-v1', classification: CLS, now: NOW };
  it('개별 버전이 모두 보안 최소 이상이어도 조합이 다르면 CONFIG_SET_NOT_APPROVED로 제외, 부분 복구·형상 미확인도 제외', () => {
    const r = publishCandidates(base, [
      { vin: 'V1', country: 'KR', report: rep('V1') },
      { vin: 'V2', country: 'KR', report: rep('V2', { ecus: [{ ecuPno: 'A', hwRevision: 'R1', sw: [{ swId: 'SW-A', version: '1.3.0' }] }, { ecuPno: 'B', hwRevision: 'R1', sw: [{ swId: 'SW-B', version: '2.0.0' }] }] }) },
      { vin: 'V3', country: 'KR', report: rep('V3', { recovery: { targets: ['A', 'B'], recovered: ['A'] } }) },
      { vin: 'V4', country: 'KR', report: null },
    ]);
    expect(r.targets).toEqual(['V1']);
    expect(r.excluded.map((x) => [x.vin, x.code])).toEqual([['V2', 'CONFIG_SET_NOT_APPROVED'], ['V3', 'RECOVERY_PARTIAL'], ['V4', 'CONFIG_UNCONFIRMED']]);
    expect(r.blockers).toEqual([]);
  });
  it('미승인 시장·다른 ODD 프로파일 시장은 MARKET_NOT_APPROVED·ODD_NOT_APPROVED로 제외(미리보기 사유)', () => {
    const r = publishCandidates({ ...base, baselines: [BL('KR', 'APPROVED'), BL('EU', 'UNKNOWN'), BL('JP', 'APPROVED', 'ODD-FEAT-00004-v2')] }, [
      { vin: 'K', country: 'KR', report: rep('K') },
      { vin: 'D', country: 'DE', report: rep('D') },
      { vin: 'J', country: 'JP', report: rep('J') },
      { vin: 'U', country: 'US', report: rep('U') },
    ]);
    expect(r.targets).toEqual(['K']);
    expect(r.excluded.map((x) => [x.vin, x.code])).toEqual([['D', 'MARKET_NOT_APPROVED'], ['J', 'ODD_NOT_APPROVED'], ['U', 'MARKET_NOT_APPROVED']]);
    expect(marketOf('DE')).toBe('EU');
    expect(marketOf('KR')).toBe('KR');
  });
  it('승인 조합 없는 F2+ ADS 구성 대상은 CONFIG_SET_MISSING으로 발행 거부, F0·F1은 허용하되 조합 미검증 수', () => {
    expect(publishCandidates({ ...base, sets: [] }, [{ vin: 'K', country: 'KR', report: rep('K') }]).blockers.map((b) => b.code)).toEqual(['CONFIG_SET_MISSING']);
    const f1 = publishCandidates({ ...base, sets: [], fClass: 'F1' }, [{ vin: 'K', country: 'KR', report: rep('K') }, { vin: 'K2', country: 'KR', report: null }]);
    expect(f1.blockers).toEqual([]);
    expect(f1.targets).toEqual(['K', 'K2']);
    expect(f1.unverifiedCombo).toBe(2);
  });
  it('ADS 구성 대상이 아니면 기존 범위 그대로(제외 없음), 조합 미검증은 세지 않는다', () => {
    const r = publishCandidates({ ...base, adsScope: false, sets: [], baselines: [] }, [{ vin: 'K', country: 'KR', report: null }]);
    expect(r).toMatchObject({ targets: ['K'], excluded: [], blockers: [], unverifiedCombo: 0 });
  });
  it('분류 미등록(추정 초안·DDT 영향 빈칸·확정 전)은 CLS_UNREGISTERED', () => {
    expect(publishCandidates({ ...base, classification: { ...CLS, status: 'DRAFT', source: 'INFERRED' } }, []).blockers.map((b) => b.code)).toEqual(['CLS_UNREGISTERED']);
    expect(publishCandidates({ ...base, classification: { ...CLS, ddtImpact: null } }, []).blockers.map((b) => b.code)).toEqual(['CLS_UNREGISTERED']);
    expect(publishCandidates({ ...base, classification: null }, []).blockers.map((b) => b.code)).toEqual(['CLS_UNREGISTERED']);
  });
});

describe('분류 확정 서명·출시 전이(ADS-BE16·FFP-F001)', () => {
  it('ddt_impact는 확정 서명 대상 — 확정 뒤 바꾸면 해시가 달라 재확정 필요', () => {
    const h = classificationConfirmHash(CLS);
    expect(classificationConfirmHash({ ...CLS, ddtImpact: 'NONE' })).not.toBe(h);
    expect(classificationConfirmHash({ ...CLS, confirmedAt: ago(1), source: 'INFERRED' })).toBe(h);
  });
  it('ADS 구성 대상 Version의 RELEASED 전이는 미분류면 거부, 확정·4축이면 통과, 대상 밖은 보지 않는다', () => {
    expect(classificationReleaseBlocker({ adsScope: true, classification: null })?.code).toBe('CLS_UNREGISTERED');
    expect(classificationReleaseBlocker({ adsScope: true, classification: CLS })).toBeNull();
    expect(classificationReleaseBlocker({ adsScope: false, classification: null })).toBeNull();
  });
});

describe('결정적 빌드 digest 입력(ADS-BE11·FFP-F013)', () => {
  const draft = { kind: 'POLICY', featureId: 'FEAT-00004', featureVersion: '4.1.0', flagKey: 'k', spec: { b: 2, a: 1 }, contentHash: 'sha256:x', desired: 'sha256:x', kill: null, oddProfileRef: 'ODD-1' };
  it('발행 메타(publicationId·issuedAt·sequence·대상)는 digest 입력에 넣지 않고, 키 순서가 달라도 같다', () => {
    const a = buildDigestInput(draft);
    expect(buildDigestInput({ ...draft, spec: { a: 1, b: 2 } })).toBe(a);
    expect(a).not.toContain('issuedAt');
    expect(a).toContain(POLICY_COMPILER_VERSION);
    expect(buildDigestInput({ ...draft, oddProfileRef: 'ODD-2' })).not.toBe(a);
  });
});

describe('복구 결정 — 메타데이터 재검증(ADS-BE10·FFP-F040)', () => {
  it('서명 키 만료·epoch 낮음·승인 조합 아님은 거부 사유', () => {
    const ok = { keyNotAfter: ago(-100), keyEpoch: 3, configSetRef: 'CFG-1' };
    const ctx = { now: NOW, currentEpoch: 3, approvedSetIds: ['CFG-1'] };
    expect(recoveryMetadataVerdict(ok, ctx)).toEqual({ ok: true, reasons: [] });
    expect(recoveryMetadataVerdict({ ...ok, keyNotAfter: ago(1) }, ctx).reasons.map((r) => r.code)).toEqual(['SIGNATURE_EXPIRED']);
    expect(recoveryMetadataVerdict({ ...ok, keyEpoch: 2 }, ctx).reasons.map((r) => r.code)).toEqual(['EPOCH_STALE']);
    expect(recoveryMetadataVerdict({ ...ok, configSetRef: 'CFG-9' }, ctx).reasons.map((r) => r.code)).toEqual(['CONFIG_SET_NOT_APPROVED']);
  });
  it('이전 버전 복구는 보안 최소 버전 미달 후보·부분 복구 보고·메타데이터 오류면 결정 거부', () => {
    const meta = { ok: true, reasons: [] };
    expect(recoveryDecisionBlockers({ path: 'RESTORE_PREVIOUS', set: SET, report: rep('V', { recoveryCandidate: { swId: 'SW-A', version: '1.0.0' } }), metadata: meta, now: NOW }).map((b) => b.code)).toEqual(['SECURITY_MIN_VIOLATION']);
    expect(recoveryDecisionBlockers({ path: 'SAFE_STATE', set: SET, report: rep('V', { recoveryCandidate: { swId: 'SW-A', version: '1.0.0' } }), metadata: meta, now: NOW })).toEqual([]);
    expect(recoveryDecisionBlockers({ path: 'RESTORE_PREVIOUS', set: SET, report: rep('V', { recoveryCandidate: { swId: 'SW-A', version: '1.2.0' } }), metadata: { ok: false, reasons: [{ code: 'EPOCH_STALE', message: 'm' }] }, now: NOW }).map((b) => b.code)).toEqual(['EPOCH_STALE']);
  });
});
