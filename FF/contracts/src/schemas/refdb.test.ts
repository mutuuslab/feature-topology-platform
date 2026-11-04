// Feature DB 계약(30-95 §5) — 기준 행 스키마, Feature ↔ 기준 행 연결 refine(대표 정확히 1·중복 금지), 등록 본문
import { describe, expect, it } from 'vitest';
import { refRow } from '../testing/refdb';
import { CreateFeatureBody, UpdateDraftBody } from './api';
import { FeatureVersionRow } from './dataset';
import { loadDataset } from '../testing/fixtures';
import { CreateRefChangeBody, FeatureRefLinks, FeatureRefRow, featureRefsProblems, featureRefsValid, REF_ID_PATTERN, REF_MONEY_FIELDS, RequestRefAddBody } from './refdb';

const body = (featureRefs: unknown) => ({ name: '오토 홀드', description: '정차 유지', country: 'KR', vehicleModel: 'NX4', trim: 'PE', ownerId: 'usr-author', asil: 'B', featureRefs });

describe('Feature DB 계약', () => {
  it('기준 행 — §5.1 필드, 필수 정보(도메인·클러스터·컴포넌트·영/한 기능명·T-shirt) 빈 값 금지, 대표 ASIL은 QM·A~D', () => {
    expect(FeatureRefRow.safeParse(refRow()).success).toBe(true);
    for (const k of ['domain', 'cluster', 'component', 'nameEn', 'nameKo', 'tshirt'] as const) expect(FeatureRefRow.safeParse(refRow({ [k]: ' ' })).success, k).toBe(false);
    expect(FeatureRefRow.safeParse({ ...refRow(), asilRep: 'ASIL B' }).success).toBe(false);
    expect(FeatureRefRow.safeParse({ ...refRow(), refId: 'FEAT-00001' }).success).toBe(false);
    expect(FeatureRefRow.safeParse(refRow({ definition: { level: 'L2', scopeIn: ['정차 유지'], io: { read: 'Vehicle.Speed' } } })).success).toBe(true);
    expect(Object.keys(FeatureRefRow.shape)).toHaveLength(42);
  });

  it('벤치마크 필드는 한 목록 — 금액·Kearney 메모·Make/Buy 물량·프리미엄 네 개(엑셀 O·P·V·W), 모두 기준 행 필드', () => {
    // 회귀: 목록이 금액 2개뿐이라 백엔드가 Make/Buy 2개를 따로 더했다
    expect([...REF_MONEY_FIELDS]).toEqual(['benchmarkEur', 'kearneyNote', 'makeBuyVolume', 'makeBuyPremium']);
    for (const k of REF_MONEY_FIELDS) expect(Object.keys(FeatureRefRow.shape)).toContain(k);
  });

  it('ID 형식 — 도메인 2글자·컴포넌트 2~4글자(숫자 허용)·일련번호 3자리', () => {
    for (const ok of ['BC-BCM-001', 'CH-BRK-009', 'CO-V2X-003', 'PL-SOVD-016', 'PL-AP-021']) expect(REF_ID_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['BCM-001', 'B-BCM-001', 'BC-BCMXY-001', 'BC-BCM-01', 'bc-bcm-001', 'BC-2CM-001']) expect(REF_ID_PATTERN.test(bad), bad).toBe(false);
  });

  it('연결 — 대표 정확히 1개, 같은 행 중복 금지', () => {
    expect(featureRefsValid([{ refId: 'CH-BRK-009', role: 'PRIMARY' }, { refId: 'CH-BRK-006', role: 'INCLUDED' }])).toBe(true);
    expect(featureRefsProblems([{ refId: 'CH-BRK-009', role: 'INCLUDED' }])).toEqual(['대표(PRIMARY) 기준 행을 하나 고르세요.']);
    expect(featureRefsProblems([{ refId: 'CH-BRK-009', role: 'PRIMARY' }, { refId: 'CH-BRK-006', role: 'PRIMARY' }])[0]).toMatch(/하나만/);
    expect(featureRefsProblems([{ refId: 'CH-BRK-009', role: 'PRIMARY' }, { refId: 'CH-BRK-009', role: 'INCLUDED' }])[0]).toMatch(/두 번/);
    expect(FeatureRefLinks.safeParse([{ refId: 'CH-BRK-009', role: 'PRIMARY', refVersion: 'v1.3' }]).success).toBe(true);
    expect(FeatureRefLinks.safeParse([{ refId: 'CH-BRK-009', role: 'PRIMARY' }]).success).toBe(false); // 저장 행은 발행 버전 필수
  });

  it('Feature 등록 본문 — featureRefs 필수(D-REF-3), refine 위반은 400 대상', () => {
    expect(CreateFeatureBody.safeParse(body([{ refId: 'CH-BRK-009', role: 'PRIMARY' }])).success).toBe(true);
    expect(CreateFeatureBody.safeParse(body(undefined)).success).toBe(false);
    expect(CreateFeatureBody.safeParse(body([])).success).toBe(false);
    expect(CreateFeatureBody.safeParse(body([{ refId: 'CH-BRK-009', role: 'INCLUDED' }])).success).toBe(false);
    const dev = CreateFeatureBody.safeParse({ ...body([{ refId: 'CH-BRK-009', role: 'PRIMARY' }]), asil: 'C', asilDeviation: { from: 'B', to: 'C', reason: '' } });
    expect(dev.success).toBe(false);
  });

  it('초안 수정 — 연결은 바꿀 수 있고(refine 적용), 중복 확인 필드는 받지 않는다', () => {
    expect(UpdateDraftBody.safeParse({ featureRefs: [{ refId: 'CH-BRK-006', role: 'PRIMARY' }] }).success).toBe(true);
    expect(UpdateDraftBody.safeParse({ featureRefs: [{ refId: 'CH-BRK-006', role: 'INCLUDED' }] }).success).toBe(false);
    expect(UpdateDraftBody.safeParse({ confirmDuplicate: true }).success).toBe(false);
    expect(UpdateDraftBody.parse({ name: '새 이름' })).toEqual({ name: '새 이름' }); // 보내지 않은 연결을 기본값으로 덮지 않는다
  });

  it('연결 도입 전 시드 Feature 버전도 그대로 읽힌다(featureRefs 선택)', () => {
    const f = loadDataset().features[0];
    expect(FeatureVersionRow.safeParse(f).success).toBe(true);
    expect(FeatureVersionRow.safeParse({ ...f, featureRefs: [{ refId: 'CH-BRK-009', role: 'PRIMARY', refVersion: 'v1.3' }] }).success).toBe(true);
  });

  it('추가 요청은 출처 ID나 근거 메모가 있어야 하고, 변경 요청은 대상 행을 밝힌다', () => {
    const add = { domain: 'Chassis & Vehicle Dynamics', component: 'Brake control (ESC/ABS)', nameEn: 'Brake hold', nameKo: '브레이크 유지', tshirt: 'S', asilRep: 'B' };
    expect(RequestRefAddBody.safeParse(add).success).toBe(false);
    expect(RequestRefAddBody.safeParse({ ...add, basisNote: 'UN R13-H 5.2' }).success).toBe(true);
    expect(RequestRefAddBody.safeParse({ ...add, sourceIds: ['S12'] }).success).toBe(true);
    expect(CreateRefChangeBody.safeParse({ kind: 'MODIFY', after: { tshirt: 'M' }, reason: '실적 반영' }).success).toBe(false);
    expect(CreateRefChangeBody.safeParse({ kind: 'MODIFY', refId: 'CH-BRK-009', after: { tshirt: 'M' }, reason: '실적 반영' }).success).toBe(true);
    expect(CreateRefChangeBody.safeParse({ kind: 'DEPRECATE', refId: 'CH-BRK-009', reason: '표준 삭제 예고' }).success).toBe(false);
    expect(CreateRefChangeBody.safeParse({ kind: 'DEPRECATE', refId: 'CH-BRK-009', after: { replacedBy: 'CH-BRK-010' }, reason: '표준 삭제 예고' }).success).toBe(true);
  });
});
