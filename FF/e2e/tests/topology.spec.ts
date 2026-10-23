// Topology·의존관계 검증(/arch/topology) — 3초 테스트 잔여 UX3-04(2026-10-18 S4 재검토).
//   • 핵심 메시지는 "N 미판정·FAIL 관계"인데 그래프 기본 선택은 초록 관계(FEAT-00022)라 실패가 보이지 않았다
//   • 실패로 가는 링크가 없었다(데이터 사전점검 링크만)
//   • 시연 모드에서 노드 라벨이 핵심 메시지보다 컸다(그래프가 viewBox보다 넓게 늘어나 라벨도 함께 커짐)
// 같은 화면의 Feature 상세(UX3-08): 스테퍼 막힘 사유에 역할 코드 "(RELEASE_MANAGER)"가 보였다.
import { expect, test } from '@playwright/test';

test('Topology: 기본 그래프는 첫 미판정·FAIL 관계를 보이고, 핵심 메시지 행동이 미판정·FAIL 목록을 연다', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/arch/topology');
  const key = page.locator('#main [data-key-message]');
  await expect(key.locator('.ds-key__value')).toHaveText(/^\d+$/);
  // 기본 초점 그래프에 판정이 PASS가 아닌 관계가 있고, 그 관계가 선택(굵게) 표시된다
  const selected = page.locator('.ds-topo-edge[data-selected]');
  await expect(selected).toHaveCount(1);
  expect(await selected.getAttribute('data-verdict')).not.toBe('PASS');

  await key.getByRole('link', { name: '관계 목록에서 보기 →' }).click();
  await expect(page).toHaveURL(/verdict=open/);
  const rows = page.locator('#topo-table tbody tr');
  await expect(rows).toHaveCount(Number(await key.locator('.ds-key__value').innerText()));
  await expect(rows.locator('.ds-badge[data-gate="PASS"]')).toHaveCount(0);
});

for (const width of [1366, 1920]) {
  test(`Topology 시연 모드(${width}): 노드 라벨은 --fs-md 이하, 핵심 메시지보다 작다`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    await page.goto('/arch/topology');
    await expect(page.locator('.ds-topo-node').first()).toBeVisible();
    await page.locator('#main h1').click();
    await page.keyboard.press('p');
    await expect(page.locator('html')).toHaveAttribute('data-present', 'on');
    const m = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.fontSize = 'var(--fs-md)';
      document.body.append(probe);
      const md = parseFloat(getComputedStyle(probe).fontSize);
      probe.remove();
      const svg = document.querySelector('svg.ds-topo') as SVGSVGElement;
      const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const label = Math.max(...[...svg.querySelectorAll('.ds-topo-label')].map((t) => parseFloat(getComputedStyle(t).fontSize) * scale));
      const key = Math.max(...[...document.querySelectorAll('#main [data-key-message], #main [data-key-message] *')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
      return { md, label, key };
    });
    expect(m.label, `노드 라벨 ${m.label.toFixed(1)}px ≤ --fs-md ${m.md}px`).toBeLessThanOrEqual(m.md + 0.5);
    expect(m.label).toBeLessThan(m.key);
  });
}

test('Feature 상세: 스테퍼 막힘 사유에 역할 코드가 아니라 한글 역할 라벨', async ({ page }) => {
  await page.goto('/features/FEAT-00022/1.0.0');
  const next = page.locator('.ds-step[data-lifecycle="DEPRECATED"] .ds-step__blockers');
  await expect(next).toContainText('허용 역할이 아닙니다');
  await expect(next).not.toContainText(/[A-Z]+_[A-Z]+/);
  await expect(next).toContainText('Feature 출시 담당자');
});
