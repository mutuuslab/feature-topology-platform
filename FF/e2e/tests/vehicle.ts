// e2e의 차량 쪽 — 실제 차량처럼 공장 주입 차량 키로 요청에 서명한다(출시 준비 RD-SEC-08, docs/80-integration/80-40-vehicle-channel.md).
// e2e 백엔드는 FF_VEHICLE_AUTH=required로 뜬다(playwright.config.ts) — 서명 없는 차량 요청은 401.
// 시험 전용 루트(공개 값)를 FF_HSM_VEHICLE_ROOT로 주입하고, 차량 키는 그 루트에서 파생한다(차량에는 루트가 아니라 차량 키만 있다).
import type { APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { signVehicleRequest, vehicleKeyFromRoot } from '../../backend/src/kernel/vehicle-auth-client';

/** e2e 전용 차량 키 루트 — 공개된 시험 값(운영 모드는 FF_HSM_VEHICLE_ROOT를 거부한다) */
export const E2E_VEHICLE_ROOT = createHash('sha256').update('ff-e2e-vehicle-root|not-a-secret').digest('base64');

const API = `http://localhost:${process.env.E2E_API_PORT ?? 9111}`;

/** 차량 서명 POST — 본문 원문을 서명한 그대로 보낸다 */
export function vehiclePost(request: APIRequestContext, vin: string, path: string, body: unknown) {
  const text = JSON.stringify(body);
  const headers = signVehicleRequest({ vehicleKey: vehicleKeyFromRoot(Buffer.from(E2E_VEHICLE_ROOT, 'base64'), 1, vin), vin, epoch: 1, method: 'POST', path, body: text });
  return request.post(`${API}${path}`, { headers: { ...headers, 'content-type': 'application/json' }, data: text });
}
