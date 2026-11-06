// 지도 차량 배치 — 세계 축척에서 등록 차량 기호가 겹쳐 상태를 읽을 수 없던 결함(디자인 검토 2026-11-05).
// 넓게 볼 때는 같은 격자의 차량을 군집(상태별 대수)으로, 가까이 볼 때는 한 대씩, 같은 좌표 차량은 원·나선으로 떨어뜨린다.
import { describe, expect, it } from 'vitest';
import { MAP_GROUP_ZOOM, MAP_SPREAD_PX, layoutMapVehicles, spreadOffsetPx } from './fleet-map';

const car = (vin: string, lat: number, lng: number, state = 'ON') => ({ vin, position: { lat, lng }, state });
const seoul = Array.from({ length: 6 }, (_, i) => car(`KR-${i}`, 37.5 + i * 0.02, 127 + i * 0.02, i % 3 ? 'ON' : 'UNKNOWN'));
const berlin = [car('DE-1', 52.52, 13.4, 'OFF'), car('DE-2', 52.53, 13.41, 'OFF')];
const lone = car('US-1', 40.7, -74, 'ON');
const all = [...seoul, ...berlin, lone, { vin: 'NOPOS', position: null, state: 'ON' }];
const state = (v: { state: string }) => v.state;

describe('지도 차량 배치', () => {
  it('세계 축척에서는 가까운 차량을 군집으로 묶고 상태별 대수를 센다 — 혼자인 차량은 그대로', () => {
    const { groups, placed } = layoutMapVehicles(all, 1.5, state);
    const kr = groups.find((g) => g.vins.includes('KR-0'))!;
    expect(kr.count).toBe(6);
    expect(kr.states).toEqual({ UNKNOWN: 2, ON: 4 });
    expect(groups.find((g) => g.vins.includes('DE-1'))!.states).toEqual({ OFF: 2 });
    expect(placed.map((p) => p.vin)).toEqual(['US-1']);
    // 군집 대수 + 한 대씩 = 위치 있는 차량 전부(빠지거나 두 번 세지 않는다)
    expect(groups.reduce((n, g) => n + g.count, 0) + placed.length).toBe(9);
  });

  it('고른 차량은 군집에 넣지 않는다', () => {
    const { groups, placed } = layoutMapVehicles(all, 1.5, state, new Set(['KR-2']));
    expect(groups.find((g) => g.vins.includes('KR-0'))!.count).toBe(5);
    expect(placed.map((p) => p.vin)).toContain('KR-2');
  });

  it(`확대 ${MAP_GROUP_ZOOM} 이상이면 한 대씩 그린다`, () => {
    const { groups, placed } = layoutMapVehicles(all, MAP_GROUP_ZOOM, state);
    expect(groups).toEqual([]);
    expect(placed).toHaveLength(9);
    expect(placed.every((p) => !p.offset)).toBe(true);
  });

  it('같은 좌표 차량은 화면에서 서로 떨어뜨린다(같은 자리에 두 대가 겹치지 않는다)', () => {
    const stack = Array.from({ length: 12 }, (_, i) => car(`S-${String(i).padStart(2, '0')}`, 37.55, 126.97));
    const zoom = 8;
    const { placed } = layoutMapVehicles(stack, zoom, state);
    expect(placed).toHaveLength(12);
    expect(placed.every((p) => p.offset)).toBe(true);
    // 화면 px로 바꿔 가장 가까운 두 차량 거리 — 받침 원 지름(18px)의 절반 이상
    const px = 512 * 2 ** zoom / 360;
    const cos = Math.cos((37.55 * Math.PI) / 180);
    const xy = placed.map((p) => [(p.lng - 126.97) * px, (p.lat - 37.55) * px / cos]);
    let min = Infinity;
    for (let i = 0; i < xy.length; i++) for (let j = i + 1; j < xy.length; j++) min = Math.min(min, Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]));
    expect(min).toBeGreaterThan(9);
    // 펼친 범위는 작게 — 다른 동네 차량으로 읽히지 않게
    expect(Math.max(...xy.map(([x, y]) => Math.hypot(x, y)))).toBeLessThan(MAP_SPREAD_PX * 3);
  });

  it('펼친 자리 — 한 대는 제자리, 8대까지는 같은 반지름의 원', () => {
    expect(spreadOffsetPx(0, 1)).toEqual([0, 0]);
    for (let i = 0; i < 5; i++) expect(Math.hypot(...spreadOffsetPx(i, 5))).toBeCloseTo(MAP_SPREAD_PX, 6);
  });
});
