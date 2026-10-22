// 회귀(2026-10-23): 차량 상세(/twin/vehicle)의 3D 씬이 화면 밖에서도 그림자·dpr 2 렌더 루프를 계속 돌려
// 본문 스레드가 수 초씩 막혔다 — GPU 없는 CI에서 같은 화면의 접근성·배치 시험이 60초 시간 초과로 배포를 막았다.
// 화면 밖이면 루프를 멈추고(frameloop=demand), 스크롤해 보이면 다시 돈다.
import { expect, test } from '@playwright/test';

test('차량 상세 3D 씬은 화면 밖에서 렌더 루프를 멈추고, 보이면 다시 돈다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/twin/vehicle/VIN-DEMO-017');
  const root = page.getByTestId('veh-scene-root');
  test.skip(!(await root.count()) && (await page.getByTestId('vehicle-3d-fallback').count()) > 0, 'WebGL 없음 — 씬 대신 대체 문구');
  await expect(root).toHaveAttribute('data-in-view', 'false');
  await page.getByRole('button', { name: '차량 3D 보기 ↓' }).click();
  await expect(root).toHaveAttribute('data-in-view', 'true');
});
