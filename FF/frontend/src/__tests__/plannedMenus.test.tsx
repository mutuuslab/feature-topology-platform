// Feature DB·SW 개발비 산정 메뉴(2026-11-04) — 메뉴 위치, Feature DB 화면 연결, 개발비 산정 준비 중 화면을 지킨다.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MENU, routeOf } from '../routes';
import { SwCostScreen } from '../screens/planned/PlannedScreens';
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

  it('개발비 산정 준비 중 화면은 메뉴 이름을 제목으로 보이고 설계 문서를 가리킨다', () => {
    render(<SwCostScreen />);
    expect(screen.getByRole('heading', { level: 1, name: swCost.title })).toBeTruthy();
    expect(screen.getByText(swCost.doc)).toBeTruthy();
  });

  it('Feature DB 메뉴는 준비 중이 아니라 Feature DB 화면(D01-01)으로 열린다', () => {
    expect(routeOf('/master/feature-db')?.components).toEqual(['D01-01']);
  });
});
