import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExperimentResultCharts, type ExperimentResults } from '../screens/ext/ExperimentAnalysis';

afterEach(cleanup);
const result: ExperimentResults = { days: 2, control: .1, treatment: .12, diff: .02, ci95: [-.01,.05], enough: false, significant: false, verdict: 'INSUFFICIENT', fleet: null };
describe('실험 결과의 근거와 시각화', () => {
  it('0을 포함한 신뢰구간·표본 부족·시연 출처를 보존하고 미집계 Fleet 일치율을 만들지 않는다', () => {
    render(<ExperimentResultCharts result={{ ...result, fleet: { vehicles: 0, agreement: 1, deployedPolicyId: null, diverged: [] } }} type="SHADOW" minSamples={1000} />);
    expect(screen.getByText('모의 표본으로 계산한 효과 추정')).toBeTruthy();
    expect(screen.getByText('표본이 부족해 아직 결론을 낼 수 없습니다.', {exact:false})).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('-1.00 ~ 5.00%p');
    expect(screen.queryByRole('progressbar', {name:'일치'})).toBeNull();
    expect(screen.getByText('비교할 차량이 없습니다. 일치율을 표시하지 않습니다.')).toBeTruthy();
  });
  it('실제 응답의 차량 판단·표본 수만 표시한다', () => {
    render(<ExperimentResultCharts result={{ ...result, enough: true, sampleCounts:{control:1200,treatment:1000}, fleet:{vehicles:10,agreement:.8,deployedPolicyId:'POL-00002',diverged:[{vin:'SYNTHETIC-1',shadow:false,current:true},{vin:'SYNTHETIC-2',shadow:false,current:true}]} }} type="SHADOW" minSamples={1000} />);
    expect(screen.getByRole('progressbar', {name:'일치'}).getAttribute('value')).toBe('0.8');
    expect(screen.getByText('불일치: 2 / 10')).toBeTruthy();
    expect(screen.getByText(/관측 표본 수: 대조군 1,200/)).toBeTruthy();
  });
});
