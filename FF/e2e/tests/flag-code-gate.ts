// Flag 코드 연결 출시 관문(20-97 §3.4·§3.6) — 시험이 새로 만든 정책 키는 차량 SW 저장소에 호출이 없어 게시가 막힌다.
// 정책·배포 흐름을 보는 시험은 실제 절차대로 구현 담당이 출시 차단 해제를 요청하고 Feature 승인자(다른 사람)가 승인한 뒤 배포한다.
import { expect, type APIRequestContext } from '@playwright/test';

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;
const H = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });

export async function waiveFlagCodeGate(request: APIRequestContext, flagKey: string, featureId: string, version: string) {
  const r = await request.get(`${API}/api/flag-code/coverage/${flagKey}`, { headers: H('usr-viewer', 'AUDITOR') });
  expect(r.status(), await r.text()).toBe(200);
  const row = (await r.json()).row as { releaseBlocking: boolean; waiver: { state: string } | null };
  if (!row.releaseBlocking) return;
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const w = await request.post(`${API}/api/flag-code/waivers`, { headers: H('usr-integrator', 'IMPLEMENTER'), data: { flagKey, featureId, version, reason: 'e2e — 차량 SW 반영 전 정책 흐름 확인', expiresAt } });
  expect(w.status(), await w.text()).toBe(201);
  const d = await request.post(`${API}/api/flag-code/waivers/${(await w.json()).waiverId}/decision`, { headers: H('usr-approver', 'FEATURE_APPROVER'), data: { decision: 'APPROVE', comment: 'e2e 승인' } });
  expect(d.status(), await d.text()).toBe(200);
}
