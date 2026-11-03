// Feature DB·SW 개발비 산정 메뉴(2026-11-04 "메뉴만") — 메뉴 위치와 준비 중 화면이 열리는지 지킨다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MENU, routeOf } from '../routes';
import { FeatureDbScreen, SwCostScreen } from '../screens/planned/PlannedScreens';
import { featureDb, swCost } from '../copy/refdbCost';

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

  it('준비 중 화면은 메뉴 이름을 제목으로 보이고 설계 문서를 가리킨다', () => {
    render(<FeatureDbScreen />);
    expect(screen.getByRole('heading', { level: 1, name: featureDb.title })).toBeTruthy();
    expect(screen.getByText(featureDb.doc)).toBeTruthy();
    cleanup();
    render(<SwCostScreen />);
    expect(screen.getByRole('heading', { level: 1, name: swCost.title })).toBeTruthy();
    expect(screen.getByText(swCost.doc)).toBeTruthy();
  });
});
