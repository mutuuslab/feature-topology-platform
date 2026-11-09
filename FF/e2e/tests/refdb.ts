// Feature DB(기준 기능) 도우미 — Feature 등록은 대표(PRIMARY) 기준 행이 있어야 한다(30-95 §6.2, 400 REFDB_LINK_REQUIRED).
// 화면 시험은 제안 1단계에서 기준 행을 고르고, API 시험은 등록 본문에 featureRefs를 붙인다. 데이터는 Feature DB v1.3(엑셀 가져옴).
import { expect, type Page } from '@playwright/test';
import { settle } from './settle';

/** 시험에 쓰는 기준 행 — 모두 활성(ACTIVE). ASIL은 대표 ASIL(등록 ASIL과 다르면 사유가 필요하다) */
export const REF = {
  /** 오토 홀드 · 별칭 AVH · 대표 ASIL B */
  avh: 'CH-BRK-009',
  /** 신호등 인식 · QM */
  trafficLight: 'AD-ADS-004',
  /** 전자 호라이즌(ADASIS v3) · QM */
  horizon: 'AD-ADS-013',
  /** 야간 투시 · QM */
  nightVision: 'AD-ADS-021',
  /** 기상·시정 인식 · QM */
  weather: 'AD-ADS-023',
  /** SOTIF 감시·트리거 조건 기록 · QM */
  sotif: 'AD-ADS-019',
  /** 자율주행 데이터 기록장치(DSSAD) · QM */
  dssad: 'AD-ADS-020',
} as const;

/**
 * API로 Feature를 만들 때 붙일 기준 행 연결(QM 행) — 병렬 시험이 같은 범위(KR·NX4 PE·Premium)에 같은 대표 행을 쓰면
 * 409 REFDB_DUPLICATE_IN_SCOPE가 나므로 확인 사유를 함께 보낸다(같은 범위에 없으면 서버가 무시한다).
 */
export const apiRefs = (refId: string = REF.trafficLight) => ({
  featureRefs: [{ refId, role: 'PRIMARY' as const }],
  confirmDuplicate: true,
  duplicateReason: 'e2e 시험 — 같은 기준 행을 쓰는 시험 Feature',
});

/** 제안 1단계 — 검색해서 대표 기준 행을 고르고 2단계(등록 정보 확인)로 간다 */
export async function pickPrimaryRef(page: Page, query: string, refId: string) {
  await openRefPicker(page);
  await page.locator('input[name="refSearch"]').fill(query);
  const choose = page.getByRole('button', { name: `${refId} 기본 정보 가져오기` });
  // The search is debounced. Wait for this exact result, not pre-query calm.
  await expect(choose).toBeVisible({ timeout: 15_000 });
  await settle(page, { scope: '[role="dialog"]' });
  await choose.click();
  await expect(page.locator(`[data-ref-chosen="${refId}"][data-role="PRIMARY"]`)).toBeVisible();
  await page.locator('[data-ui="refPickNext"]').click();
  await expect(page.locator('input[name="name"]')).toBeVisible();
}

/** The document editor opens reference selection as a separate dialog. */
export async function openRefPicker(page: Page) {
  await page.getByRole('button', { name: '기준 Feature 선택', exact: true }).click();
  await expect(page.locator('input[name="refSearch"]')).toBeVisible();
}

/** Acknowledge the actual scope before any create request, including error-path tests. */
export async function submitProposedFeature(page: Page) {
  await page.locator('[data-ui="reviewFeature"]').click();
  const review = page.getByTestId('registration-review');
  await expect(review.locator('[data-ui="createFeature"]')).toBeDisabled();
  await review.getByRole('checkbox').check();
  await review.locator('[data-ui="createFeature"]').click();
}
