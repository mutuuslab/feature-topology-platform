import { describe, expect, it } from 'vitest';
import { searchLocally } from '../screens/refdb/refSearch';

const rows = [
  { refId: 'A1', nameKo: '주행 기능', nameEn: 'Drive', domain: 'A', component: 'C1', asilRep: 'B', status: 'ACTIVE' as const },
  { refId: 'A2', nameKo: '안전 기능', nameEn: 'Safety', domain: 'A', component: 'C2', asilRep: 'D', status: 'REVIEW' as const },
  { refId: 'A3', nameKo: '편의 기능', nameEn: 'Comfort', domain: 'A', component: 'C1', asilRep: 'QM', status: 'ACTIVE' as const },
  { refId: 'B1', nameKo: '주행 기능', nameEn: 'Drive', domain: 'B', component: 'C1', asilRep: 'B', status: 'RETIRED' as const },
];

describe('Feature DB 다중 조건 탐색', () => {
  it('같은 축은 합집합·다른 축은 교집합이며 페이지 전에 전체 수와 패싯을 계산한다', () => {
    const first = searchLocally(rows, { domain: 'A', asils: 'B,D', statuses: 'ACTIVE,REVIEW', limit: 1 });
    expect(first.total).toBe(2); expect(first.items.map(r => r.refId)).toEqual(['A1']);
    expect(first.facets.status).toMatchObject({ ACTIVE: 1, REVIEW: 1, RETIRED: 0 });
    expect(searchLocally(rows, { domain: 'A', asils: 'B,D', statuses: 'ACTIVE,REVIEW', limit: 1, offset: 1 }).items.map(r => r.refId)).toEqual(['A2']);
  });
  it('필터 없는 전체·기존 단일 상태와 불일치 조건을 보존한다', () => {
    expect(searchLocally(rows, {}).total).toBe(4);
    expect(searchLocally(rows, { status: 'RETIRED' }).items.map(r => r.refId)).toEqual(['B1']);
    expect(searchLocally(rows, { asils: 'D', statuses: 'RETIRED' }).total).toBe(0);
  });
});
