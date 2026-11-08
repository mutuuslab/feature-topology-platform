import { localizedCopy } from '../locale/runtime';
export const fleetSearch = /* @__PURE__ */ localizedCopy('fleet-search.fleetSearch', {
  label: '차량 검색',
  placeholder: 'VIN·차량 이름·적용 범위',
  empty: '검색 조건에 맞는 차량이 없습니다.',
  matches: (n: number, total: number) => `전체 ${total.toLocaleString()}대 중 검색 결과 ${n.toLocaleString()}대`,
});
