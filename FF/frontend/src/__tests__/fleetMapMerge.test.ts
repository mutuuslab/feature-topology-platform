// 전세계 지도 군집 — 이웃 격자의 군집 단추가 화면에서 겹치면(대상 크기 2.5.8 위반, 정적 빌드 axe) 하나로 합친다
import { describe, expect, it } from 'vitest';
import type { MapVehicleGroup } from '@ff/contracts';
import { groupSize, mergeOverlapping } from '../screens/ops/FleetMapCanvas';

const g = (id: string, lng: number, count: number, states: Record<string, number>): MapVehicleGroup => ({ id, lat: 0, lng, count, states, vins: Array.from({ length: count }, (_, i) => `${id}-${i}`) });
// 경도 1도 = 10px
const project = (lng: number, lat: number) => ({ x: lng * 10, y: lat * 10 });

describe('mergeOverlapping', () => {
  it('겹치는 두 군집은 대수·상태·차량을 더하고 중심은 대수 가중 평균', () => {
    const out = mergeOverlapping([g('a', 0, 12, { '--ok': 10, '--faint': 2 }), g('b', 2, 4, { '--ok': 1, '--warn': 3 })], project);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(16);
    expect(out[0].states).toEqual({ '--ok': 11, '--faint': 2, '--warn': 3 });
    expect(out[0].vins).toHaveLength(16);
    expect(out[0].lng).toBeCloseTo(0.5);
  });
  it('충분히 떨어진 군집은 그대로 — 합친 뒤 남은 단추끼리는 겹치지 않는다', () => {
    const far = (groupSize(50) + 4) / 10 + 1;
    const out = mergeOverlapping([g('a', 0, 3, { x: 3 }), g('b', far, 3, { x: 3 }), g('c', 1, 2, { x: 2 }), g('d', far * 3, 9, { x: 9 })], project);
    expect(out.map((o) => o.count).sort((a, b) => a - b)).toEqual([3, 5, 9]);
    for (const a of out) for (const b of out) if (a !== b) expect(Math.abs(project(a.lng, 0).x - project(b.lng, 0).x)).toBeGreaterThanOrEqual((groupSize(a.count) + groupSize(b.count)) / 2 + 4);
  });
});
