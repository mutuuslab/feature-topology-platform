import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AdsTraceDoc, AdsTraceVerdict } from '@ff/contracts';
import { traceSummary } from '../../../contracts/src/rules/ads-evidence';
import { AppProvider } from '../store';
import TraceAdsScreen from '../screens/ads/TraceAds';
import { traceCoverage } from '../screens/ads/trace-coverage';

const sha='a'.repeat(64);
const requirement=(id: string, verdict: string|null, evidence=['proof.ts:1']) => ({ id, title:`요구 ${id}`, category:'범위', priority:'P0', owner:'Owner', content:'내용', acceptance:'조건', basis:'근거', tests:[], claims:[], hazards:[], defects:[], review:verdict ? {verdict,evidence,tests:[],gap:'검토 이유',plan:[]} : null });
const fixture: AdsTraceDoc={source:{file:'source.html',sha256:sha,revision:'1',date:'2026-11-08'},reviewed:{sha256:sha,reviewedAt:'2026-11-08',reviewedCommit:'checked'},requirements:[requirement('A','구현'),requirement('B','부분'),requirement('C','미구현'),requirement('D','구현',[]),requirement('E',null),requirement('X','범위 밖',['scope-note.md:2'])],tests:[],scenarios:[]};
beforeEach(()=>{localStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({...fixture,summary:traceSummary(fixture)}),{headers:{'Content-Type':'application/json'}})));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('3개 표시 집계는 제외를 분리하고 원판정 7종을 승격하거나 수정하지 않는다',()=>{
  const verdicts=Object.freeze<AdsTraceVerdict[]>(['IMPLEMENTED','PARTIAL','NOT_IMPLEMENTED','SOURCE_CHANGED','NO_EVIDENCE','UNJUDGED','OUT_OF_SCOPE']);
  expect(traceCoverage(verdicts)).toEqual({total:6,excluded:1,counts:{IMPLEMENTED:1,REVIEW:3,UNJUDGED:2}});
  expect(verdicts).toHaveLength(7);
});

it('범위 안 막대 3조각·집계 선택·원판정 필터·제외 근거 열기를 함께 제공한다',async()=>{
  const before=JSON.stringify(fixture);
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><AppProvider><TraceAdsScreen/></AppProvider></MemoryRouter></QueryClientProvider>);
  await screen.findByText('요구 A');
  const chart=screen.getByRole('figure',{name:'범위 안 요구의 구현·검토 분포'});
  expect(chart.querySelectorAll('.ads-stages__seg')).toHaveLength(3);
  expect(chart.querySelector('figcaption')?.textContent).toContain('5');
  fireEvent.click(within(chart).getByRole('button',{name:/^검토·조치 필요/}));
  expect(screen.getByText('요구 B')).toBeTruthy();
  expect(screen.getByText('요구 C')).toBeTruthy();
  expect(screen.queryByText('요구 A')).toBeNull();
  fireEvent.click(screen.getByText('원판정 7종으로 자세히 보기'));
  const raw=screen.getByRole('radiogroup',{name:'원판정 필터'});
  expect(within(raw).getAllByRole('radio')).toHaveLength(8);
  fireEvent.click(within(raw).getByRole('radio',{name:'미구현 1개'}));
  expect(screen.getByText('요구 C')).toBeTruthy();
  expect(screen.queryByText('요구 B')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'범위 밖 1개 근거 보기'}));
  fireEvent.click(screen.getByText('요구 X'));
  expect(await screen.findByText('scope-note.md:2')).toBeTruthy();
  expect(JSON.stringify(fixture)).toBe(before);
});
