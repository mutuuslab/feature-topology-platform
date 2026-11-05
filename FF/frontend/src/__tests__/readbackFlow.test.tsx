import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionProvider, resetMotion, useMotion } from '../state/motion';
import { MemoryRouter } from 'react-router-dom';
import { ReadbackFlow, type VehicleReadback } from '../screens/ops/ReadbackFlow';

const rows: VehicleReadback[] = [
  { vin: 'VIN-A', publicationId: 'PUB-A', at: '2026-11-05T00:00:00Z', observed: 'ON', sequence: 8 },
  { vin: 'VIN-B', publicationId: 'PUB-B', at: '2026-11-05T00:01:00Z', observed: 'OFF', rejectReason: 'TTL_EXPIRED', sequence: 9 },
  { vin: 'VIN-C', publicationId: 'PUB-C', at: '2026-11-05T00:02:00Z', observed: 'OFF', sequence: 10 },
];
const mount = (data = rows) => render(<MemoryRouter><MotionProvider><ReadbackFlow rows={data} updatedAt={Date.parse(rows[2].at)} fetching={false} onOpen={vi.fn()} /></MotionProvider></MemoryRouter>);
afterEach(() => { cleanup(); resetMotion(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('원본 시각·거부 사유를 재생하고 정지·속도·타임라인 조작을 따른다', () => {
  vi.useFakeTimers(); mount();
  const active = () => screen.getByTestId('readback-active-record');
  expect(active()).toHaveTextContent('VIN-A');
  act(() => vi.advanceTimersByTime(2420));
  expect(active()).toHaveTextContent('VIN-B'); expect(active()).toHaveTextContent('TTL_EXPIRED');
  expect(active().querySelector('time')).toHaveAttribute('dateTime', rows[1].at);
  fireEvent.click(screen.getByRole('button', { name: '일시정지', exact: true }));
  act(() => vi.advanceTimersByTime(9600)); expect(active()).toHaveTextContent('VIN-B');
  fireEvent.change(screen.getByRole('combobox', { name: '재생 속도' }), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: '재생', exact: true }));
  act(() => vi.advanceTimersByTime(620)); expect(active()).toHaveTextContent('VIN-C');
  fireEvent.click(within(screen.getByRole('group', { name: '회신 재생 타임라인' })).getAllByRole('button')[0]);
  act(() => vi.advanceTimersByTime(2420)); expect(active()).toHaveTextContent('VIN-A');
  expect(screen.getByRole('button', { name: '재생', exact: true })).toBeVisible();
});

it('최신 조회는 기존 기록을 재수신으로 꾸미지 않고 새 회신에서만 모션을 만든다', () => {
  vi.useFakeTimers();
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: '최신 회신 조회' }));
  expect(screen.getByTestId('readback-active-record')).toHaveTextContent('VIN-C');
  expect(document.querySelector('.rx-flow__packet')).toBeNull();
  act(() => vi.advanceTimersByTime(12000));
  expect(document.querySelector('.rx-flow__packet')).toBeNull();
  const newRow = { ...rows[2], vin: 'VIN-D', at: '2026-11-05T00:03:00Z' };
  view.rerender(<MemoryRouter><MotionProvider><ReadbackFlow rows={[...rows, newRow]} updatedAt={Date.parse(newRow.at)} fetching={false} onOpen={vi.fn()} /></MotionProvider></MemoryRouter>);
  expect(screen.getByTestId('readback-active-record')).toHaveTextContent('VIN-D');
  const packet = document.querySelector('.rx-flow__packet'); expect(packet).not.toBeNull();
  view.rerender(<MemoryRouter><MotionProvider><ReadbackFlow rows={[...rows, newRow]} updatedAt={Date.parse(newRow.at) + 5000} fetching={false} onOpen={vi.fn()} /></MotionProvider></MemoryRouter>);
  expect(document.querySelector('.rx-flow__packet')).toBe(packet);
  fireEvent.animationEnd(packet!);
  expect(document.querySelector('.rx-flow__packet')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '일시정지', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '재생', exact: true }));
  expect(document.querySelector('.rx-flow__packet')).toBeNull();
});

it('동작 줄이기를 존중하고 탭이 숨겨지면 재생을 멈춘다', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  mount();
  act(() => vi.advanceTimersByTime(4800)); expect(screen.getByTestId('readback-active-record')).toHaveTextContent('VIN-A');
  expect(document.querySelector('.rx-flow__packet')).toBeNull();
  expect(screen.getByText('화면 모션 정지')).toBeVisible();
  const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  act(() => vi.advanceTimersByTime(4800)); expect(screen.getByTestId('readback-active-record')).toHaveTextContent('VIN-A');
  spy.mockRestore();
});

it('원본 중복을 제거하고 상세 열기에 해당 회신을 전달한다', () => {
  const open = vi.fn();
  render(<MemoryRouter><MotionProvider><ReadbackFlow rows={[rows[1], rows[0], rows[0]]} updatedAt={0} fetching={false} onOpen={open} /></MotionProvider></MemoryRouter>);
  expect(within(screen.getByRole('group', { name: '회신 재생 타임라인' })).getAllByRole('button')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '회신 상세', exact: true }));
  expect(open).toHaveBeenCalledWith(rows[0]);
});

it('빈 회신은 차량·수신 모션을 만들어내지 않는다', () => {
  mount([]); expect(screen.queryByRole('region', { name: '차량으로부터 수신' })).toBeNull();
});

it('같은 시각의 새 차량 회신을 감지하고 boot·metric이 다른 원본은 보존한다', () => {
  const first = { ...rows[0], vin: 'VIN-Z', bootId: 'boot-1', metricType: 'ACK' };
  const second = { ...first, bootId: 'boot-2', metricType: 'READBACK' };
  const view = mount([first, second]);
  expect(within(screen.getByRole('group', { name: '회신 재생 타임라인' })).getAllByRole('button')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '최신 회신 조회' }));
  const next = { ...second, vin: 'VIN-A' };
  view.rerender(<MemoryRouter><MotionProvider><ReadbackFlow rows={[first, second, next]} updatedAt={0} fetching={false} onOpen={vi.fn()} /></MotionProvider></MemoryRouter>);
  expect(screen.getByTestId('readback-active-record')).toHaveTextContent('VIN-A');
  expect(document.querySelector('.rx-flow__packet')).not.toBeNull();
});

it('플랫폼 공용 모션 정지가 순환 재생도 정지한다', () => {
  vi.useFakeTimers();
  function Stop() { const motion = useMotion(); return <button onClick={() => motion.setLive(false)}>전체 모션 정지</button>; }
  render(<MemoryRouter><MotionProvider><Stop /><ReadbackFlow rows={rows} updatedAt={0} fetching={false} onOpen={vi.fn()} /></MotionProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '전체 모션 정지' }));
  act(() => vi.advanceTimersByTime(4800));
  expect(screen.getByTestId('readback-active-record')).toHaveTextContent('VIN-A');
  expect(document.querySelector('.rx-flow__packet')).toBeNull();
});
