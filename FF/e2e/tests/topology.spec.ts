// Topology·의존관계 검증(/arch/topology) — 3초 테스트 잔여 UX3-04(2026-10-18 S4 재검토).
//   • 핵심 메시지는 "N 미판정·FAIL 관계"인데 그래프 기본 선택은 초록 관계(FEAT-00022)라 실패가 보이지 않았다
//   • 실패로 가는 링크가 없었다(데이터 사전점검 링크만)
//   • 시연 모드에서 노드 라벨이 핵심 메시지보다 컸다(그래프가 viewBox보다 넓게 늘어나 라벨도 함께 커짐)
// 2026-11-06 그래프 2판(도메인 레인·카드 노드·직교 간선): 노드 선택·경로·필터·표 보기·키보드·axe·끌기 프레임 시간.
// 같은 화면의 Feature 상세(UX3-08): 스테퍼 막힘 사유에 역할 코드 "(RELEASE_MANAGER)"가 보였다.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { settle } from './settle';

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
    await expect(page.locator('.ds-topo-node[data-state="sel"]')).toBeVisible();
    await page.locator('#main h1').click();
    await page.keyboard.press('p');
    await expect(page.locator('html')).toHaveAttribute('data-present', 'on');
    const m = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.fontSize = 'var(--fs-md)';
      document.body.append(probe);
      const md = parseFloat(getComputedStyle(probe).fontSize);
      probe.remove();
      // 화면에 그려진 글자 크기 = CSS 글자 크기 × 화면 변환 배율(확대·이동 g 포함)
      const svg = document.querySelector('svg.ds-topo') as SVGSVGElement;
      const label = Math.max(...[...svg.querySelectorAll<SVGGraphicsElement>('.ds-topo-label')].map((t) => parseFloat(getComputedStyle(t).fontSize) * (t.getScreenCTM()?.a ?? 1)));
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

const graph = async (page: Page, url = '/arch/topology') => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(url);
  await settle(page);
  await expect(page.locator('.topo-stage')).toBeVisible();
};
const status = (page: Page) => page.locator('.topo-wb__status');

test('그래프: 도메인 레인·카드 노드·직교 간선 — 노드를 누르면 주소·선택·이웃 강조가 바뀐다', async ({ page }) => {
  await graph(page);
  await expect(page.locator('.topo-lanehead > [data-domain]').first()).toHaveAttribute('data-domain', 'AD');
  // 간선 경로는 가로·세로 구간만(직교)
  const orth = await page.locator('.ds-topo-edge').evaluateAll((els) => els.every((e) => !/[CS]/.test(e.getAttribute('d') ?? '')));
  expect(orth).toBe(true);
  // 찾기로 Feature를 고르면 그 주변으로 화면이 옮겨 간다 — 옮긴 뒤 보이는 이웃 카드를 실제 마우스로 누른다
  const search = page.getByRole('combobox', { name: 'Feature 찾기' });
  await search.fill('00022');
  await search.press('Enter');
  await expect(page).toHaveURL(/feature=FEAT-00022/);
  const target = page.locator('[data-node="FEAT-00022"]');
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ds-topo-node[data-dim]').first()).toBeAttached();
  await expect(page.getByRole('complementary', { name: '선택 정보' })).toContainText('전방 안전거리');
  await page.waitForTimeout(500); // 화면 이동 모션(320ms)이 끝난 뒤
  const neighbor = page.locator('[data-node="FEAT-00145"] .topo-card').first();
  await neighbor.click();
  await expect(page).toHaveURL(/feature=FEAT-00145/);
  await expect(page.locator('[data-node="FEAT-00145"]')).toHaveAttribute('aria-pressed', 'true');
});

test('그래프: 경로 찾기·영향 분석·필터·표 보기', async ({ page }) => {
  await graph(page, '/arch/topology?feature=FEAT-00001');
  await page.getByRole('button', { name: '경로 찾기', exact: true }).click();
  await page.getByRole('combobox', { name: '도착 Feature' }).selectOption('FEAT-00002');
  await expect(status(page)).toContainText('1단계 경로 — 의존 방향(원천→대상)');
  await expect(page.locator('[data-node="FEAT-00002"] .topo-card__badge')).toHaveText('2');
  await page.getByRole('button', { name: '영향 분석', exact: true }).click();
  await expect(page.getByRole('button', { name: '영향 분석', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(status(page)).toContainText('FEAT-00001');
  // 필터 — 판정 미판정·FAIL만이면 PASS 간선이 없다
  await page.getByRole('combobox', { name: '관계 판정' }).selectOption('open');
  await expect(page.locator('.topo-stage .ds-topo-edge[data-tone="PASS"]')).toHaveCount(0);
  await expect(page.locator('.topo-stage .ds-topo-edge').first()).toBeAttached();
  // 표 보기 — 같은 Feature를 표로
  await page.getByRole('radio', { name: '표' }).click();
  await expect(page.locator('.topo-stage')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Feature 목록' }).locator('tbody tr').first()).toBeVisible();
});

test('그래프: 키보드 — Tab으로 그래프에 들어와 화살표로 이동, Enter로 선택', async ({ page }) => {
  await graph(page);
  const first = page.locator('.ds-topo-node[tabindex="0"]');
  await expect(first).toHaveCount(1);
  const start = await first.getAttribute('data-node');
  await first.focus();
  await page.keyboard.press('ArrowRight');
  const moved = await page.evaluate(() => document.activeElement?.getAttribute('data-node'));
  expect(moved).toBeTruthy();
  expect(moved).not.toBe(start);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`feature=${moved}`));
});

test('그래프: axe(WCAG 2.2 AA) — 그래프·경로 모드·표 보기에서 serious/critical 0', async ({ page }) => {
  await graph(page);
  const check = async () => {
    const r = await new AxeBuilder({ page }).include('#topo-graph').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  };
  await check();
  await page.getByRole('button', { name: '경로 찾기', exact: true }).click();
  await check();
  await page.getByRole('radio', { name: '표' }).click();
  await check();
});

test('그래프: 끌어 이동·확대가 프레임 예산(16.7ms) 안 — 60fps', async ({ page }) => {
  await graph(page);
  // 페이지 안에서 프레임마다 포인터 이동(끌기 150프레임) 뒤 Ctrl+휠 확대 60프레임을 보내고, 프레임 간격과 처리 시간을 잰다
  const r = await page.evaluate(async () => {
    const stage = document.querySelector('.topo-stage') as HTMLElement;
    const box = stage.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const ev = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', buttons: 1 });
    const frames: number[] = [], work: number[] = [];
    stage.dispatchEvent(ev('pointerdown', cx, cy));
    let last = performance.now();
    for (let i = 0; i < 210; i++) {
      await new Promise<void>((done) => requestAnimationFrame((t) => {
        frames.push(t - last);
        last = t;
        const t0 = performance.now();
        if (i < 150) stage.dispatchEvent(ev('pointermove', cx - i * 3, cy - i * 1.5));
        else {
          if (i === 150) stage.dispatchEvent(ev('pointerup', cx, cy));
          stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: i % 2 ? 40 : -30, clientX: cx, clientY: cy }));
        }
        work.push(performance.now() - t0);
        done();
      }));
    }
    const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
    return { n: frames.length, p50: pct(frames.slice(3), 0.5), p95: pct(frames.slice(3), 0.95), work95: pct(work, 0.95), nodes: document.querySelectorAll('.ds-topo-node').length, edges: document.querySelectorAll('.topo-stage .topo-edge').length };
  });
  console.log(`topology frames ${JSON.stringify(r)}`);
  expect(r.work95, `처리 p95 ${r.work95.toFixed(2)}ms`).toBeLessThan(8);
  expect(r.p95, `프레임 p95 ${r.p95.toFixed(1)}ms`).toBeLessThan(20);
});
