// 화면이 다 그려질 때까지 기다리고, 다 그려진 화면에 로딩·오류 상자가 없는지 본다(하네스 리뷰 H9, 2026-11-04).
// 예전 대기는 `.catch(() => undefined)`로 시간 초과를 삼켜 — 끝나지 않는 로딩·오류 상자 위에서 나머지 점검이 '통과'했다.
import { expect, type Page } from '@playwright/test';

export interface SettleOptions {
  /** 로딩을 기다릴 범위 — 기본 본문(#main) */
  scope?: string;
  /** 오류 상자를 볼 범위 — 기본 scope와 같다. null이면 보지 않는다(오류 화면 자체를 보는 시험) */
  errors?: string | null;
  timeout?: number;
}

/** 로딩 표식(data-state=loading·aria-busy)이 사라질 때까지 — 시간 안에 안 사라지면 실패, 그 뒤 오류 상자(data-state=error) 0 */
export async function settle(page: Page, opts: SettleOptions = {}) {
  const scope = opts.scope ?? '#main';
  const timeout = opts.timeout ?? 15_000;
  await expect(page.locator(`${scope} [data-state="loading"], ${scope} [aria-busy="true"]`), `${scope} 로딩이 ${timeout}ms 안에 끝나지 않았다`).toHaveCount(0, { timeout });
  const errors = opts.errors === undefined ? scope : opts.errors;
  if (errors) await expect(page.locator(`${errors} [data-state="error"]`), `${errors}에 오류 상자가 보인다`).toHaveCount(0, { timeout: 2_000 });
}
