// 독립 HTML 팝업을 실제로 열고 공유 모의 원장·플랫폼 추적까지 확인한다. 실외부 서비스로 쓰기는 보내지 않는다.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const PR = 'https://github.com/mutuuslab/feature-topology-platform/pull/9';

async function asRole(page: Page, role: string) {
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('fp.state.v2', JSON.stringify({ role: value, department: 'ALL' })), role);
}

test.describe('외부 도구 별도 창 · 담당자별 연계', () => {
  test.describe.configure({ mode: 'serial' });
  for (const role of ['author', 'approver', 'quality', 'coordinator']) {
    test(`${role}: CodeBeamer·JIRA 별도 창에서 의견 등록 → 공유 원장·webhook 수신`, async ({ page, context, request }) => {
      const tag = `${role} 외부 창 검토 ${randomUUID().slice(0, 8)}`;
      const trace = await (await request.get(`${API}/api/integrations/sync/features/FEAT-00001/2.1.0`)).json();
      await asRole(page, role);
      await page.goto('/features/FEAT-00001/2.1.0?tab=ext');
      const tab = page.getByTestId('ext-links');
      await expect(tab).toBeVisible();

      const [cb] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /^codeBeamer .*새 창 열기$/ }).first().click()]);
      await expect(cb).toHaveURL(new RegExp(`/external.html\\?system=codebeamer&key=${trace.requirements[0].key}&role=${role}`));
      await expect(cb.getByText('가상 연계 시연', { exact: true })).toBeVisible();
      await expect(cb.getByRole('heading', { name: trace.requirements[0].title, exact: true })).toBeVisible();
      await expect(cb.getByRole('navigation')).toHaveCount(0);
      await cb.getByLabel('검토 의견', { exact: true }).fill(tag);
      const cbResponse = cb.waitForResponse((response) => response.url().endsWith('/api/integrations/mock/codebeamer/act') && response.request().method() === 'POST');
      await cb.getByRole('button', { name: '의견 등록', exact: true }).click();
      expect((await cbResponse).status()).toBe(200);
      await expect(cb.getByRole('region', { name: '의견 기록' })).toContainText(tag);
      const cbRead = (await (await request.get(`${API}/api/integrations/mock/codebeamer/items`)).json()).items.find((item: any) => item.key === trace.requirements[0].key);
      expect(cbRead.comments.some((comment: any) => comment.text === tag && comment.by === (role === 'quality' ? 'seo.safety' : 'jung.req'))).toBe(true);

      // 같은 창의 희망 값이 아니라 별도 플랫폼 창이 서버에서 다시 읽은 상태를 검증한다.
      if (role === 'quality') {
        const original = cbRead.status;
        const changed = original === 'Draft' ? 'Approved' : 'Draft';
        try {
          await cb.getByRole('combobox', { name: '상태', exact: true }).selectOption(changed);
          await cb.getByRole('button', { name: '상태 변경 요청' }).click();
          await expect(cb.getByTestId('external-current-status')).toHaveText(changed);
          await expect(tab.getByRole('row').filter({ has: page.locator(`.ds-ext[data-key="${cbRead.key}"]`) }).getByRole('cell').last()).toHaveText(changed);
          const after = await (await request.get(`${API}/api/integrations/sync/features/FEAT-00001/2.1.0`)).json();
          expect(after.stale).toContain(cbRead.key);
          await expect(tab.getByRole('list', { name: /추적/ })).toContainText(/개정된 요구/);
        } finally {
          const current = (await (await request.get(`${API}/api/integrations/mock/codebeamer/items`)).json()).items.find((item: any) => item.key === cbRead.key);
          if (current.status !== original) {
            const restore = await request.post(`${API}/api/integrations/mock/codebeamer/act`, { headers: { 'X-Actor-Id': 'usr-quality', 'X-Actor-Role': 'SAFETY_OFFICER' }, data: { key: cbRead.key, action: 'TRANSITION', status: original, externalUser: 'seo.safety', deliver: true } });
            expect(restore.status()).toBe(200);
          }
        }
      }

      const [jira] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /^Jira .*새 창 열기$/ }).first().click()]);
      await expect(jira).toHaveURL(new RegExp(`/external.html\\?system=jira&key=${trace.epic.key}&role=${role}`));
      await expect(jira.getByText('가상 연계 시연', { exact: true })).toBeVisible();
      await expect(jira.getByRole('button', { name: '보드', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await jira.getByRole('button', { name: '목록', exact: true }).click();
      await expect(jira.getByRole('button', { name: '목록', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await jira.getByLabel('검토 의견', { exact: true }).fill(tag);
      const jiraResponse = jira.waitForResponse((response) => response.url().endsWith('/api/integrations/mock/jira/act') && response.request().method() === 'POST');
      await jira.getByRole('button', { name: '의견 등록', exact: true }).click();
      expect((await jiraResponse).status()).toBe(200);
      await expect(jira.getByRole('region', { name: '의견 기록' })).toContainText(tag);
      const jiraRead = (await (await request.get(`${API}/api/integrations/mock/jira/items`)).json()).items.find((item: any) => item.key === trace.epic.key);
      expect(jiraRead.comments.some((comment: any) => comment.text === tag)).toBe(true);
      const inbox = (await (await request.get(`${API}/api/integrations/sync/inbox`)).json()).items;
      expect(inbox.some((entry: any) => entry.key === trace.epic.key && entry.externalUser === ({ author: 'kim.author', approver: 'lee.approver', quality: 'choi.quality', coordinator: 'park.release' }[role]))).toBe(true);
      await cb.close(); await jira.close();
    });
  }

  test('작성자의 JIRA 승인 요청은 플랫폼에서 거부되고 별도 창에도 되돌린 상태가 표시된다', async ({ page, context, request }) => {
    await asRole(page, 'author');
    await page.goto('/features/FEAT-00013/0.3.0?tab=ext');
    const [jira] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /^Jira .*새 창 열기$/ }).first().click()]);
    await jira.getByRole('combobox', { name: '상태', exact: true }).selectOption('Approved');
    await jira.getByRole('button', { name: '상태 변경 요청' }).click();
    await expect(jira.getByRole('status', { name: '플랫폼 수신 결과' })).toContainText('거부·되돌림');
    await expect(jira.getByTestId('external-current-status')).toHaveText('Proposed');
    const stored = await (await request.get(`${API}/api/features/FEAT-00013/versions/0.3.0`)).json();
    expect(stored.feature.lifecycle).toBe('PROPOSED');
    await expect(jira.getByRole('region', { name: '의견 기록' })).toContainText('되돌립니다');
    await jira.close();
  });

  test('GitHub는 실제 PR 주소의 별도 창과 가져온 소스·커밋 링크를 제공한다', async ({ page, context }) => {
    // 외부 사이트 가용성과 무관하게 실제 링크의 팝업 탐색을 검증한다. PR에 게시하지 않는다.
    await context.route(PR, (route) => route.fulfill({ contentType: 'text/html', body: '<title>PR navigation fixture</title><main>PR navigation fixture</main>' }));
    await asRole(page, 'integrator');
    await page.goto('/integration/connectors?tab=sync');
    await expect(page.getByRole('link', { name: 'Flag 소스', exact: true })).toHaveAttribute('href', /^https:\/\/github\.com\/mutuuslab\/feature-topology-platform\/blob\/[0-9a-f]{40}\//);
    await expect(page.getByRole('link', { name: /스캔한 커밋/ })).toHaveAttribute('href', /\/commit\/[0-9a-f]{40}$/);
    const [github] = await Promise.all([context.waitForEvent('page'), page.getByRole('link', { name: /^GitHub .*PR #9.*새 창 열기$/ }).click()]);
    await expect(github).toHaveURL(PR);
    // Playwright는 생성 관계를 보존한다. 실제 페이지의 opener 접근이 차단됐는지를 본다.
    expect(await github.evaluate(() => window.opener === null)).toBe(true);
    await github.close();
  });
});
