// 분석 근거 도우미(담당자 웨이브 W3, P3-3) — G2 PASS는 이 Version의 HARA(+보안 관련이면 TARA), G7 PASS는 SM·CSM 두 사람 서명이 필요하다.
// API로 Feature를 준비하는 시험은 안전 분류 확정 뒤 recordAnalysisApi, G7 앞에 signG7Api를 부른다.
import { expect, type APIRequestContext } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });

async function post(request: APIRequestContext, path: string, headers: Record<string, string>, data: unknown) {
  const r = await request.post(`${API}${path}`, { headers, data });
  expect(r.status(), await r.text()).toBe(201);
}

/** HARA(Safety Manager)·TARA(CSM) — G2 PASS 전에 */
export async function recordAnalysisApi(request: APIRequestContext, featureId: string, version: string) {
  const base = `/api/features/${featureId}/versions/${version}/analysis`;
  await post(request, `${base}/hara`, H('usr-safety', 'SAFETY_OFFICER'), { docId: `HARA-${featureId}`, asil: 'B', safetyGoals: [{ id: 'SG-01', text: '의도하지 않은 작동을 막는다', asil: 'B' }], reason: 'e2e HARA' });
  await post(request, `${base}/tara`, H('usr-csm', 'SECURITY_OFFICER'), { docId: `TARA-${featureId}`, threats: [{ id: 'TS-01', text: '정책 위·변조', cal: 'CAL2' }], reason: 'e2e TARA' });
}

/** G7 서명 — Safety Manager·CSM 서로 다른 두 사람. G7 PASS 전에 */
export async function signG7Api(request: APIRequestContext, featureId: string, version: string) {
  const base = `/api/features/${featureId}/versions/${version}/analysis`;
  await post(request, `${base}/g7-safety`, H('usr-safety', 'SAFETY_OFFICER'), { reason: 'G7 기능안전 확인' });
  await post(request, `${base}/g7-security`, H('usr-csm', 'SECURITY_OFFICER'), { reason: 'G7 사이버보안 확인' });
}
