// Feature DB·SW 개발비 산정 메뉴(2026-11-04 "메뉴만") — 메뉴 위치와 화면이 열리는지 지킨다.
// 둘 다 실제 화면으로 열었다 — Feature DB는 screens/refdb, SW 개발비 산정은 screens/cost(C3).
import { describe, expect, it } from 'vitest';
import { MENU, routeOf } from '../routes';
import { swCost } from '../copy/cost';
import { featureDb } from '../copy/refdb';

describe('Feature DB·SW 개발비 산정 메뉴', () => {
  it('Feature DB는 기준정보, SW 개발비 산정은 독립 구매·비용 메뉴에 있다', () => {
    const itemsOf = (key: string) => MENU.find((g) => g.key === key)!.items.map((r) => r.menu);
    expect(itemsOf('master')).toContain('/master/feature-db');
    expect(itemsOf('procurement')).toContain('/procurement/sw-cost');
    expect(itemsOf('release')).not.toContain('/procurement/sw-cost');
  });

  it('메뉴 링크가 자기 화면으로 열린다 (옛 /cost 이동 주소와 섞이지 않는다)', () => {
    expect(routeOf('/master/feature-db')?.title).toBe(featureDb.title);
    expect(routeOf('/procurement/sw-cost')?.title).toBe(swCost.title);
    expect(routeOf('/cost')?.parent).toBe('/biz/trials');
  });

  it('Feature DB·SW 개발비 산정은 준비 중 화면이 아니라 목록·상세 화면을 연다', () => {
    expect(routeOf('/master/feature-db/CH-BRK-009')?.parent).toBe('/master/feature-db');
    expect(routeOf('/master/feature-db/changes')?.parent).toBe('/master/feature-db');
    expect(routeOf('/master/feature-db/changes/CR-2026-001')?.parent).toBe('/master/feature-db/changes');
    expect(routeOf('/procurement/sw-cost/EST-0001')?.parent).toBe('/procurement/sw-cost');
    expect(routeOf('/procurement/sw-cost/basis')?.title).toBe('계수·단가 표');
  });
});
