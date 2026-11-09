// Explicit classification of newly created, synthetic non-ADS policy fixtures only.
// This is not a default in the release helper and never reclassifies captured vehicle Features.
import { expect, type APIRequestContext } from '@playwright/test';
const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
export async function classifyNonAdsFixture(request: APIRequestContext, featureId: string, version: string, owner: string) {
  const url = `${API}/api/features/${featureId}/versions/${version}/classification`;
  const body = { adsFeature: false, ddtImpact: 'NONE', safetyRelated: false, owner,
    lifecycleOwners: { CREATE: owner, OPERATE: '차량운영센터', SUSPEND: owner, DISPOSE: owner },
    reason: 'Synthetic E2E non-ADS policy fixture; not vehicle certification' };
  const draft = await request.put(url, { headers: { 'X-Actor-Id': 'usr-author', 'X-Actor-Role': 'FEATURE_AUTHOR' }, data: body });
  expect(draft.status(), await draft.text()).toBe(200);
  expect((await draft.json()).classification).toMatchObject({ adsFeature: false, ddtImpact: 'NONE', safetyRelated: false, owner, status: 'DRAFT' });
  const confirmed = await request.post(`${url}/confirm`, { headers: { 'X-Actor-Id': 'usr-safety', 'X-Actor-Role': 'SAFETY_OFFICER' }, data: { reason: 'Independent confirmation of explicit synthetic fixture classification' } });
  expect(confirmed.status(), await confirmed.text()).toBe(201);
  const view = await confirmed.json();
  expect(view.classification).toMatchObject({ status: 'CONFIRMED', confirmedBy: 'usr-safety' });
  expect(view.completeness.classified).toBe(true);
}
