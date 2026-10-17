// 5년 운영 규모 화면 문구 — 대상 차량은 모집단 모델(가정값)과 가중 표본으로 보인다(contracts/src/rules/population.ts).
// ko.ts와 따로 둔다: 규모 표기·가정 안내만 모았다.
import { formatCount, formatExact } from '../design/format';

export const ops5y = {
  fleetMap: {
    sourceAll: '시연 + 대상 차량(가중 표본)',
    represented: (n: number) => `대표 ${formatCount(n)}대`,
    legendCluster: '대상 차량 묶음 — 숫자는 대표 대수',
    clusterNote: (represented: number, sample: number) => `이 범위의 표본 ${formatExact(sample)}대가 대상 차량 ${formatCount(represented)}대를 대표합니다. 묶음을 누르거나 확대하면 표본 차량이 보입니다.`,
    pointsNote: (n: number) => `이 범위의 표본 차량 ${formatExact(n)}대를 받았습니다 — 한 대가 여러 대를 대표합니다(표·집계는 가중 대수).`,
    activationNote: '대상 차량 표본은 구독 상태만 있어 기능 활성 보기에서는 회색으로 보입니다. 기능 활성은 시연 차량과 수신 표본만 보고합니다.',
  },
  home: {
    /** 모집단 모델의 운행 중 대상 차량(가정값) — 5년 운영 데이터일 때만 */
    target: '대상 차량(운행 중)',
  },
  trial: {
    period: '기간',
    monthly: '4주 합계',
    periods: { 26: '26주', 52: '1년', 260: '5년' } as Record<number, string>,
  },
} as const;
