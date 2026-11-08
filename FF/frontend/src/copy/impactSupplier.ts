import { localizedCopy } from '../locale/runtime';
// 변경 영향 분석 보강 문구(W5, 담당자 개선 P5-2) — 구매 담당이 협력사에서 시작하고, 바뀐 항목은 한글 이름으로(영문 필드 키는 툴팁).
export const impactPlus = /* @__PURE__ */ localizedCopy('impactSupplier.impactPlus', {
  supplier: '협력사',
  supplierAny: '협력사로 찾기 (선택)',
  supplierLead: (n: number) => `이 협력사 SW를 쓰는 Feature ${n}개 — 골라서 영향을 봅니다`,
  supplierNone: '이 협력사 SW를 쓰는 Feature가 없습니다',
  pick: (id: string, ver: string) => `${id} ${ver} 영향 보기`,
  featureId: 'Feature ID',
  version: 'Version',
  /** 바뀐 항목(contracts REJUDGE_MAP 키) 한글 이름 */
  field: {
    name: '이름',
    description: '설명',
    ownerId: '담당(Owner)',
    requirementIds: '요구사항',
    upgVc: '차량 사양 코드',
    asil: 'ASIL',
    functions: '기능 분해',
    swIds: 'SW ID',
    swVersions: 'SW 버전',
    ecuPnos: 'ECU 부품 번호',
    controlPoints: '제어점',
    dependencyIds: '의존 Feature',
    tags: '태그',
  } as Record<string, string>,
});
