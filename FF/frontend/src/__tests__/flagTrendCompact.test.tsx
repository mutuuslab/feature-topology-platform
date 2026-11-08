import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FlagEvaluationSeries } from '@ff/contracts';
import { flagCode } from '../copy/flag-code';
import { EvalTrend } from '../screens/flag-code/trend';

afterEach(cleanup);
it('겹치는 원천은 차이를 키보드로 읽고 원본 시계열도 펼쳐 정확한 두 값을 확인한다',()=>{
  const series=FlagEvaluationSeries.parse({flagKey:'test_flag',window:'24h',bucketMinutes:60,stats:[],buckets:Array.from({length:24},(_,i)=>['UNLEASH_EDGE','VEHICLE_SDK'].map((source,index)=>({bucketStart:new Date(Date.UTC(2026,10,8,i)).toISOString(),source,evaluations:1000+i+index*2,enabled:500,fallbacks:0,errors:0}))).flat()});
  render(<EvalTrend series={series}/>);
  const difference=screen.getByRole('img',{name:flagCode.evaluations.seriesDifferenceLabel});
  fireEvent.keyDown(difference,{key:'ArrowRight'});
  expect(within(screen.getByRole('status')).getByText('2')).toBeTruthy();
  fireEvent.keyDown(difference,{key:'Escape'});
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByText(flagCode.evaluations.seriesOriginal));
  const original=screen.getByRole('img',{name:flagCode.evaluations.seriesLabel('test_flag','24h')});
  fireEvent.keyDown(original,{key:'ArrowRight'});
  expect(within(screen.getByRole('status')).getByText('1,000')).toBeTruthy();
  expect(within(screen.getByRole('status')).getByText('1,002')).toBeTruthy();
});
