// Feature 등록 자동 채움(20-60 §5.3) — 기준 행 하나로 칸·출처·범위·관련·중복·변이 프로필, 이름·설명 → 기준 행 추천, 칸별 결정.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FeatureVariability } from '../../schemas/ple';
import { CreateFeatureBody } from '../../schemas/api';
import { autofillDecisions, autofillFromRef, controlPointPlan, duplicateHints, nameSimilarity, ownerCandidate, proposeVariability, regionCountries, relatedCandidates, scopeCandidates, suggestRefsFromText, type PleFeature, type PleRef } from './autofill';

const ref = (o: Partial<PleRef> & { refId: string }): PleRef => ({ status: 'ACTIVE', nameKo: o.refId, nameEn: o.refId, domain: 'Body & Comfort', component: 'Seat', asilRep: 'QM', tshirt: 'S', ...o });
const SEAT = ref({
  refId: 'BC-SEAT-001',
  nameKo: '전동 시트 전후·높이·틸트',
  nameEn: 'Power seat fore/aft, height, tilt',
  swStack: 'Application',
  lifecycle: 'Commodity',
  vehicleType: '공통',
  region: '글로벌',
  asilRep: 'QM',
  tshirt: 'S',
  requires: ['BC-SEAT-009'],
  sourceDetail: 'UN R17',
  definition: { level: 'L2', parentRefId: '없음', summary: '시트 위치를 모터로 조정한다', io: { read: '스위치 입력', write: '모터 구동' }, drivers: { states: '5', dtcs: '5', calibrations: '12', variants: '3' }, regulations: 'FMVSS 207 · UN R17' },
});
const MEM = ref({ refId: 'BC-SEAT-009', nameKo: '시트 메모리', nameEn: 'Seat memory', bundleId: 'KRN-S1', bundleRep: true });
const LUMBAR = ref({ refId: 'BC-SEAT-003', nameKo: '요추 지지(4방향)', nameEn: 'Lumbar support', bundleId: 'KRN-S1', bundleRep: false, region: 'Euro NCAP' });
const SCC = ref({ refId: 'AD-LON-002', nameKo: '적응형 순항 제어', nameEn: 'Adaptive cruise control', domain: 'ADAS & AD', component: 'Longitudinal', asilRep: 'B', aliases: ['ACC'] });
const refs = new Map([SEAT, MEM, LUMBAR, SCC].map((r) => [r.refId, r]));
const F = (id: string, refId: string, o: Partial<PleFeature> = {}): PleFeature => ({ featureId: id, version: '1.0.0', name: id, country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', lifecycle: 'RELEASED', featureRefs: [{ refId, role: 'PRIMARY' }], ...o });
const features = [F('FEAT-00001', 'BC-SEAT-009', { name: '시트 메모리' }), F('FEAT-00002', 'BC-SEAT-001', { country: 'EU', vehicleModel: 'MX5', trim: 'Premium', name: '전동 시트' }), F('FEAT-00003', 'BC-SEAT-003', { name: '요추 지지' }), F('FEAT-00004', 'AD-LON-002', { country: 'US', vehicleModel: 'EV9', trim: 'GT', name: '스마트 크루즈' })];

describe('자동 채움 — 기준 행 하나로 칸 채우기', () => {
  const r = autofillFromRef(SEAT, { features, refsById: refs, scope: { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }, name: '전동 시트 전후·높이·틸트' });
  const field = (k: string) => r.fields.find((f) => f.key === k);
  it('이름·설명·ASIL·도메인·컴포넌트·SW 계층·T-shirt·태그·규제를 기준 행 열 출처와 함께', () => {
    expect(field('name')).toMatchObject({ value: '전동 시트 전후·높이·틸트', source: { kind: 'REF', ref: 'BC-SEAT-001' } });
    expect(field('description')?.value).toBe('시트 위치를 모터로 조정한다');
    expect(field('asil')?.value).toBe('QM');
    expect(field('domain')?.value).toBe('Body & Comfort');
    expect(field('component')?.value).toBe('Seat');
    expect(field('swLayer')?.value).toBe('Application');
    expect(field('tshirt')?.value).toBe('S');
    expect(field('tags')?.value).toEqual(['Body & Comfort', 'Seat', 'Application', 'Commodity', '공통', '글로벌']);
    expect(field('regulations')?.value).toEqual(['FMVSS 207', 'UN R17']);
  });
  it('제어점 — Flag는 규칙, Parameter·Signal·DTC는 기준 행 정의가 있을 때만', () => {
    expect(controlPointPlan(SEAT).map((c) => c.type)).toEqual(['Flag', 'Parameter', 'Signal', 'DTC']);
    expect(controlPointPlan(MEM).map((c) => c.type)).toEqual(['Flag']);
    expect(controlPointPlan(SEAT)[0].source.kind).toBe('RULE');
  });
  it('적용 범위 후보 — 지역(글로벌 = 모든 등록 국가), 같은 컴포넌트 Feature가 많은 범위 먼저', () => {
    expect(r.scopeCandidates[0]).toMatchObject({ country: 'KR', vehicleModel: 'NX4 PE', sameComponent: 2 });
    expect(r.scopeCandidates.map((s) => s.country).sort()).toEqual(['EU', 'KR', 'US']);
    expect(scopeCandidates(LUMBAR, features, refs).map((s) => s.country)).toEqual(['EU']);
    expect(regionCountries('UNECE 협약국', ['KR', 'US', 'EU'])).toEqual(['EU', 'KR']);
  });
  it('담당 후보 — 같은 컴포넌트 Feature의 담당, 없으면 같은 도메인', () => {
    const fs = features.map((f, i) => ({ ...f, ownerId: i < 2 ? '바디상품기획팀' : '시트팀' }));
    expect(ownerCandidate(SEAT, fs, refs)).toEqual({ owner: '바디상품기획팀', basis: 'COMPONENT', count: 2 });
    expect(ownerCandidate(ref({ refId: 'BC-X-001', component: 'Mirror' }), fs, refs)?.basis).toBe('DOMAIN');
    expect(ownerCandidate(SEAT, features, refs)).toBeNull();
    expect(autofillFromRef(SEAT, { features: fs, refsById: refs }).fields.find((f) => f.key === 'owner')).toMatchObject({ value: '바디상품기획팀', source: { kind: 'CATALOGUE' } });
  });
  it('관련 Feature 후보 — 기준 행 선행(REQUIRES)과 같은 컴포넌트, 같은 범위 먼저', () => {
    expect(r.related[0]).toMatchObject({ featureId: 'FEAT-00001', kind: 'REQUIRES', viaRef: 'BC-SEAT-009' });
    expect(r.related.map((x) => x.kind)).toContain('SAME_COMPONENT');
    expect(relatedCandidates(MEM, features, refs).map((x) => x.kind)).toContain('REQUIRED_BY');
  });
  it('중복 — 다른 범위의 같은 기준 행은 확인 안내(막지 않음)', () => {
    expect(r.duplicates).toEqual([expect.objectContaining({ kind: 'OTHER_SCOPE', featureId: 'FEAT-00002', blocking: false })]);
    const same = duplicateHints({ refId: 'BC-SEAT-009', scope: { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' } }, features);
    expect(same[0]).toMatchObject({ kind: 'SAME_SCOPE', blocking: true });
    const sim = duplicateHints({ refId: 'X', name: '시트 메모리 기능', scope: { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' } }, features);
    expect(sim.map((d) => d.kind)).toEqual(['SIMILAR_NAME']);
    expect(nameSimilarity('시트 메모리', '시트  메모리')).toBe(1);
    expect(nameSimilarity('시트 메모리', '헤드램프')).toBe(0);
  });
  it('26580 변이 프로필 — 상위 없으면 주요, 변형 3개면 ENUM, Flag면 런타임 결합, 변이점은 제어점·컴포넌트마다', () => {
    expect(r.variability).toMatchObject({ catalogueRole: 'PRIMARY', parentRefId: null, featureType: 'ENUM', variability: 'OPTIONAL', bindingTime: 'RUNTIME_FLAG' });
    expect(r.variability.variationPoints.map((v) => v.assetKind)).toEqual(['FLAG', 'PARAMETER', 'SIGNAL', 'DTC', 'SW_COMPONENT']);
    expect(FeatureVariability.safeParse(r.variability).success).toBe(true);
  });
  it('묶음의 대표가 아닌 행은 하위 feature, 상위 = 묶음 대표', () => {
    const v = proposeVariability(LUMBAR, { bundleRepOf: (b) => (b === 'KRN-S1' ? 'BC-SEAT-009' : undefined) });
    expect(v).toMatchObject({ catalogueRole: 'SUB', parentRefId: 'BC-SEAT-009', featureType: 'BOOLEAN' });
  });
  it('배타가 있는 행은 대안(ALTERNATIVE), 하위 feature에 상위가 없으면 스키마가 거부', () => {
    expect(proposeVariability({ ...MEM, excludes: ['BC-SEAT-003'] }).variability).toBe('ALTERNATIVE');
    expect(FeatureVariability.safeParse({ catalogueRole: 'SUB', parentRefId: null, featureType: 'BOOLEAN', variability: 'OPTIONAL', bindingTime: 'BUILD', variationPoints: [] }).success).toBe(false);
  });
  it('등록 본문에 변이 프로필을 함께 보낼 수 있다(선택)', () => {
    const body = { name: 'n', description: 'd', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'o', asil: 'QM', featureRefs: [{ refId: 'BC-SEAT-001', role: 'PRIMARY' }] };
    expect(CreateFeatureBody.safeParse(body).success).toBe(true);
    expect(CreateFeatureBody.safeParse({ ...body, variability: r.variability }).success).toBe(true);
    expect(CreateFeatureBody.safeParse({ ...body, variability: { ...r.variability, variability: 'SOMETIMES' } }).success).toBe(false);
  });
});

describe('칸별 결정 — 제안 그대로·고침·제안 없던 칸', () => {
  const r = autofillFromRef(SEAT, { features, refsById: refs });
  const base = { name: '전동 시트 전후·높이·틸트', description: '시트 위치를 모터로 조정한다', asil: 'QM', tags: ['Body & Comfort', 'Seat', 'Application', 'Commodity', '공통', '글로벌'], refRegulations: ['FMVSS 207', 'UN R17'], controlPoints: ['Flag', 'Parameter', 'Signal', 'DTC'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' };
  it('모두 제안 그대로면 ACCEPTED(태그·제어점 순서 무시)', () => {
    const rows = autofillDecisions(r, { ...base, tags: [...base.tags].reverse(), controlPoints: ['DTC', 'Flag', 'Parameter', 'Signal'] });
    expect(rows.every((x) => x.decision === 'ACCEPTED')).toBe(true);
    expect(rows.find((x) => x.field === 'asil')).toMatchObject({ sourceKind: 'REF', sourceRef: 'BC-SEAT-001 · 대표 ASIL(L)' });
  });
  it('이름·ASIL을 고치고 후보 밖 범위로 등록하면 EDITED, 변이 프로필을 바꿔도 EDITED', () => {
    const rows = autofillDecisions(r, { ...base, name: '전동 시트 원격', asil: 'A', country: 'JP', variability: { ...r.variability, variability: 'OR' } });
    const d = Object.fromEntries(rows.map((x) => [x.field, x.decision]));
    expect(d).toMatchObject({ name: 'EDITED', asil: 'EDITED', scope: 'EDITED', variability: 'EDITED', description: 'ACCEPTED' });
  });
  it('키 순서가 다른 같은 변이 프로필은 ACCEPTED', () => {
    const v = r.variability;
    const reordered = { variationPoints: v.variationPoints, bindingTime: v.bindingTime, variability: v.variability, featureType: v.featureType, parentRefId: v.parentRefId, catalogueRole: v.catalogueRole };
    expect(autofillDecisions(r, { ...base, variability: reordered }).find((x) => x.field === 'variability')?.decision).toBe('ACCEPTED');
  });
});

describe('이름·설명 → 기준 행 추천', () => {
  it('기능명 포함·별칭·단어 겹침 순, 폐기 행 제외', () => {
    const s = suggestRefsFromText('전동 시트 전후·높이·틸트 원격 조정', [SEAT, MEM, LUMBAR, SCC, ref({ refId: 'BC-SEAT-099', nameKo: '전동 시트 옛 방식', status: 'RETIRED' })]);
    expect(s[0]).toMatchObject({ refId: 'BC-SEAT-001' });
    expect(s[0].reasons[0]).toContain('기능명');
    expect(s.map((x) => x.refId)).not.toContain('BC-SEAT-099');
    expect(suggestRefsFromText('ACC 켜기', [SCC])[0].reasons).toContain("별칭 'ACC'");
    expect(suggestRefsFromText('a', [SCC])).toEqual([]);
  });
  it('사내 용어(SCC)로 Feature DB v1.3의 적응형 순항 제어를 찾는다', () => {
    const all = JSON.parse(readFileSync(join(__dirname, '../../../../data/reference/feature-db/v1.3/refs.json'), 'utf8')) as PleRef[];
    const s = suggestRefsFromText('고속도로에서 SCC 간격 유지', all);
    expect(s[0].refId).toBe('AD-LON-002');
    expect(s[0].reasons.join(' ')).toContain("사내 용어 'SCC'");
  });
});
