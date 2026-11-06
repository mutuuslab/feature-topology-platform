// 전세계 차량 지도 — 홈 수신 현황의 국가·차종 고리에서 온 조건 안내(지도 묶음에만 실린다)
export const mapScope = {
  note: (country: string, model: string) => `${[country && `국가 ${country}`, model && `차종 ${model}`].filter(Boolean).join(' · ')} 차량만 보고 있습니다.`,
  clear: '모든 차량 보기',
};
