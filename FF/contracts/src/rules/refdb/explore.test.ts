// Feature DB 목록 탐색 — 다중 선택 필터·축별 수·트리 수·요약이 같은 행 집합에서 나오는지
import { describe, expect, it } from 'vitest';
import { refRow } from '../../testing/refdb';
import { facetFilter, facetList } from '../facets';
import { exploreRefs, refTreeKey } from './explore';

const rows = [
  refRow({ refId: 'CH-BRK-001', asilRep: 'D', tshirt: 'M', lifecycle: 'Commodity', sourceIds: ['S01', 'S02'], sizeEvidenceGrade: 'D' }),
  refRow({ refId: 'CH-BRK-002', asilRep: 'C', tshirt: 'S', lifecycle: 'Innovation', sourceIds: ['S02'], status: 'REVIEW' }),
  refRow({ refId: 'CH-BRK-003', asilRep: 'QM', tshirt: 'S', lifecycle: 'Commodity', sourceIds: ['S03'] }),
  refRow({ refId: 'BC-BCM-001', domain: 'Body & Comfort', component: 'Body control module', asilRep: 'QM', tshirt: 'L', lifecycle: 'Commodity', sourceIds: ['S01'], sizeEvidenceGrade: 'D' }),
];

describe('facetFilter — 같은 축은 합집합, 다른 축은 교집합, 수는 자기 축만 빼고', () => {
  const axes = { a: (r: { a: string; b: string[] }) => r.a, b: (r: { a: string; b: string[] }) => r.b };
  const data = [
    { a: 'x', b: ['1', '2'] },
    { a: 'y', b: ['2'] },
    { a: 'x', b: ['3'] },
  ];
  it('선택이 없으면 모든 행과 전체 수', () => {
    const r = facetFilter(data, axes, {});
    expect(r.rows).toHaveLength(3);
    expect(r.facets).toEqual({ a: { x: 2, y: 1 }, b: { 1: 1, 2: 2, 3: 1 } });
  });
  it('여러 값 축은 하나라도 맞으면 통과하고, 다른 축 수는 걸러진 행으로 센다', () => {
    const r = facetFilter(data, axes, { b: ['2'], a: ['x', 'y'] });
    expect(r.rows).toEqual([data[0], data[1]]);
    expect(r.facets.b).toEqual({ 1: 1, 2: 2, 3: 1 });
    expect(r.facets.a).toEqual({ x: 1, y: 1 });
  });
  it('쉼표 목록은 빈 값·중복을 뺀다', () => expect(facetList(' A,,B,A ')).toEqual(['A', 'B']));
});

describe('exploreRefs', () => {
  it('ASIL 다중 선택 — 표 행·요약·다른 축 수가 같은 집합', () => {
    const r = exploreRefs(rows, { asils: 'C,D' });
    expect(r.rows.map((x) => x.refId)).toEqual(['CH-BRK-001', 'CH-BRK-002']);
    expect(r.summary).toEqual({ rows: 2, domains: 1, components: 1, sources: 2, asilCD: 2, gradeD: 1, review: 1 });
    expect(r.facets.asilRep).toEqual({ D: 1, C: 1, QM: 2 });
    expect(r.facets.tshirt).toEqual({ M: 1, S: 1 });
    expect(r.facets.status).toEqual({ ACTIVE: 1, REVIEW: 1, DEPRECATED: 0, RETIRED: 0, PENDING: 0 });
  });
  it('도메인을 골라도 트리 수는 다른 도메인을 함께 센다', () => {
    const r = exploreRefs(rows, { domain: 'Body & Comfort' });
    expect(r.rows.map((x) => x.refId)).toEqual(['BC-BCM-001']);
    expect(r.facets.tree).toEqual({ [refTreeKey('Chassis & Vehicle Dynamics', 'Brake control (ESC/ABS)')]: 3, [refTreeKey('Body & Comfort', 'Body control module')]: 1 });
    expect(r.facets.lifecycle).toEqual({ Commodity: 1 });
  });
  it('출처 하나와 상태 다중 선택을 함께', () => {
    const r = exploreRefs(rows, { source: 'S02', statuses: 'REVIEW' });
    expect(r.rows.map((x) => x.refId)).toEqual(['CH-BRK-002']);
    expect(r.facets.source).toEqual({ S02: 1 });
    expect(r.facets.status.ACTIVE).toBe(1);
  });
});
