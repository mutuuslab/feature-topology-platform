// Feature DB·SW 개발비 산정 메뉴(2026-11-04 "메뉴만") — 메뉴 위치와 화면이 열리는지 지킨다.
// Feature DB는 2단계에서 실제 화면(screens/refdb)으로 열었다 — SW 개발비 산정만 준비 중 화면으로 남는다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MENU, routeOf } from '../routes';
import * as Planned from '../screens/planned/PlannedScreens';
import { swCost } from '../copy/refdbCost';
import { featureDb } from '../copy/refdb';

afterEach(cleanup);

describe('Feature DB·SW 개발비 산정 메뉴', () => {
  it('Feature DB는 기준정보, SW 개발비 산정은 상품·출시 메뉴에 있다', () => {
    const itemsOf = (key: string) => MENU.find((g) => g.key === key)!.items.map((r) => r.menu);
    expect(itemsOf('master')).toContain('/master/feature-db');
    expect(itemsOf('release')).toContain('/procurement/sw-cost');
  });

  it('메뉴 링크가 자기 화면으로 열린다 (옛 /cost 이동 주소와 섞이지 않는다)', () => {
    expect(routeOf('/master/feature-db')?.title).toBe(featureDb.title);
    expect(routeOf('/procurement/sw-cost')?.title).toBe(swCost.title);
    expect(routeOf('/cost')?.parent).toBe('/biz/trials');
  });

  it('Feature DB는 준비 중 화면이 아니라 목록·상세·변경 요청 화면을 연다', () => {
    expect('FeatureDbScreen' in Planned).toBe(false);
    expect(routeOf('/master/feature-db/CH-BRK-009')?.parent).toBe('/master/feature-db');
    expect(routeOf('/master/feature-db/changes')?.parent).toBe('/master/feature-db');
    expect(routeOf('/master/feature-db/changes/CR-2026-001')?.parent).toBe('/master/feature-db/changes');
  });

  it('SW 개발비 산정 준비 중 화면은 메뉴 이름을 제목으로 보이고 설계 문서를 가리킨다', () => {
    render(<Planned.SwCostScreen />);
    expect(screen.getByRole('heading', { level: 1, name: swCost.title })).toBeTruthy();
    expect(screen.getByText(swCost.doc)).toBeTruthy();
  });
});
