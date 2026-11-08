// 출시 도우미(GX, FR-RDD-001-006·결정 B8 (c)) — 출시 전(G8·G9 미통과) Version은 Shadow만이라 차량에서 실제로 켜는 배포 시험은
// 출시한 Version으로 한다: G8·G9 PASS → Feature Owner Release Sign-off → RELEASED(출시 담당). VERIFIED가 된 뒤(정책 승인 뒤)에 부른다.
import { expect, type APIRequestContext } from '@playwright/test';
import { waiveFlagCodeGate } from './flag-code-gate';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });

async function post(request: APIRequestContext, path: string, headers: Record<string, string>, data: unknown, code: number) {
  const r = await request.post(`${API}${path}`, { headers, data });
  expect(r.status(), await r.text()).toBe(code);
}

export async function releaseVersionApi(request: APIRequestContext, featureId: string, version: string) {
  const base = `/api/features/${featureId}/versions/${version}`;
  const f = await (await request.get(`${API}${base}`)).json();
  if (f.feature?.lifecycle === 'RELEASED') return;
  for (const gate of ['G8', 'G9']) await post(request, `${base}/gates`, H('usr-quality', 'GATE_JUDGE'), { gate, inputResult: 'PASS', rationale: '출시 조건 확인', evidenceRef: `EV-${gate}` }, 201);
  await post(request, `${base}/release-signoff`, H('usr-author', 'FEATURE_AUTHOR'), { reason: '출시 책임 확인' }, 201);
  // 등록 때 만든 Feature Flag도 코드 연결 전이면 출시 관문이 막는다 — 실제 절차대로 출시 차단 해제(구현 담당 요청 → 승인자 승인) 뒤 출시
  const blocked = await request.get(`${API}${base}`);
  const flags = ((await blocked.json()).transitions ?? []).find((t: { to: string }) => t.to === 'RELEASED')?.blockers?.filter((b: { code: string }) => b.code === 'FLAG_CODE_MISSING') ?? [];
  for (const b of flags as { ref: string }[]) await waiveFlagCodeGate(request, b.ref, featureId, version);
  await post(request, `${base}/transitions`, H('usr-coordinator', 'RELEASE_MANAGER'), { to: 'RELEASED', reason: '출시' }, 200);
}
