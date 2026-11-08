import { localizedCopy } from '../locale/runtime';
// 데이터 신선도 칩 문구(TL-UI01) — 디자인 키트에 실리므로 짧게 둔다. 화면 문구는 copy/lake.ts.
export const freshness = /* @__PURE__ */ localizedCopy('freshness.freshness', {
  now: '방금 적재',
  lag: (t: string) => `${t} 지연`,
  hold: '판단 보류',
  unknown: '적재 기록 없음',
  minutes: (n: number) => `${n}분`,
  hours: (n: number) => `${n}시간`,
  days: (n: number) => `${n}일`,
  asOf: (t: string) => `${t} 기준`,
  hint: (dataset: string, asOf: string, sla: string) => `출처 ${dataset} · ${asOf} · 신선도 기준 ${sla}`,
  holdReason: (sla: string) => `신선도 기준(${sla})을 넘었습니다. 이 지표로 내리는 판단은 보류합니다.`,
  gallery: { title: '데이터 신선도 칩', hint: '텔레메트리 수치마다 출처·기준 시각·지연, 기준을 넘으면 판단 보류' },
});
