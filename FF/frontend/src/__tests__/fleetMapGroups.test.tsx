// 전세계 지도 — 세계 축척에서 등록 차량 자동차 기호가 한국·유럽에 겹쳐 상태를 읽을 수 없던 결함(디자인 검토 2026-11-05).
// 넓게 볼 때는 군집(상태 색 고리 + 대수, 누르면 확대), 가까이 볼 때는 한 대씩 — 같은 좌표 차량은 떨어뜨린다.
import { describe, expect, it, vi } from 'vitest';
import type { FleetMapVehicle } from '@ff/contracts';
import { groupElement, toGeoJSON, varLabel } from '../screens/ops/FleetMapCanvas';

const car = (vin: string, lat: number, lng: number, activation: FleetMapVehicle['activation'], source: FleetMapVehicle['source'] = 'DEMO'): FleetMapVehicle => ({
  vin, label: vin, source, country: 'KR', region: '수도권', vehicleModel: 'NX4', trim: 'base',
  position: { lat, lng, precision: 'COARSE', city: '서울', heading: 0 } as FleetMapVehicle['position'],
  moving: false, stale: false, link: 'ONLINE', subscription: 'PAID', activation, kills: [],
});
const seoul = [car('A', 37.55, 126.97, 'ON'), car('B', 37.55, 126.97, 'ON'), car('C', 37.56, 126.99, 'UNKNOWN')];
const syn = car('SYN-1', 37.55, 126.97, null, 'SYNTHETIC');
const el = document.body;

describe('지도 차량 배치(화면)', () => {
  it('세계 축척 — 가까운 등록 차량은 점 대신 군집 하나, 합성 차량은 그대로', () => {
    const { data, groups } = toGeoJSON(el, [...seoul, syn], 'activation', 1.5);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    expect(groups[0].states).toEqual({ '--ok': 2, '--warn': 1 });
    expect(data.features.map((f) => f.properties.vin)).toEqual(['SYN-1']);
  });

  it('고른 차량은 세계 축척에서도 자동차로 남는다', () => {
    const { data, groups } = toGeoJSON(el, seoul, 'activation', 1.5, 'C');
    expect(groups[0].vins).toEqual(['A', 'B']);
    expect(data.features.map((f) => f.properties.vin)).toEqual(['C']);
  });

  it('도시 축척 — 한 대씩, 같은 좌표 두 대는 다른 자리에 그린다', () => {
    const { data, groups } = toGeoJSON(el, seoul, 'activation', 9);
    expect(groups).toEqual([]);
    const [a, b] = data.features.filter((f) => ['A', 'B'].includes(f.properties.vin)).map((f) => f.geometry.coordinates);
    expect(a).not.toEqual(b);
  });

  it('군집 단추 — 상태별 대수를 읽어 주고 누르면 확대한다', () => {
    const open = vi.fn();
    const b = groupElement({ id: 'g', lat: 37.5, lng: 127, count: 3, states: { '--ok': 2, '--warn': 1 }, vins: ['A', 'B', 'C'] }, (name) => varLabel(name, 'activation'), open);
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('aria-label')).toMatch(/3대/);
    expect(b.getAttribute('aria-label')).toContain(`${varLabel('--ok', 'activation')} 2`);
    expect(b.style.getPropertyValue('--fm-group-ring')).toContain('var(--ok)');
    expect(b.textContent).toBe('3');
    b.click();
    expect(open).toHaveBeenCalledOnce();
  });
});
