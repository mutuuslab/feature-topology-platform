// 차량 쪽 요청 서명기(출시 준비 RD-SEC-08) — 실제 차량 텔레매틱스 유닛이 하는 일을 시험·5년 재생·e2e가 똑같이 한다.
// 차량은 공장에서 주입받은 차량 키(HKDF(epoch 루트, epoch, VIN))만 갖고, 요청 키는 그 차량 키에서 파생한다(루트 비밀은 차량에 없다).
// 규격: contracts/src/rules/vehicle-auth.ts · docs/80-integration/80-40-vehicle-channel.md
import { VEHICLE_AUTH_HEADERS, vehicleRequestCanonical } from '@ff/contracts';
import { createHash, randomBytes } from 'node:crypto';
import { aesCmac, hkdf16 } from './crypto';

/** 차량 키 — 모의 공장 주입. 실제 차량은 생산 라인에서 이 값을 보안 저장소에 받는다 */
export const vehicleKeyFromRoot = (root: Buffer, epoch: number, vin: string) => hkdf16(root, `epoch:${epoch}`, `ffp-vehicle-key|${vin}`);

/** 요청 인증 키 — 같은 차량 키에서 용도만 나눈다(cmd_auth·state_auth와 다른 키) */
export const requestKeyOf = (vehicleKey: Buffer) => hkdf16(vehicleKey, 'ffp-request-auth', 'ffp-vehicle-request-key|v1');

export const sha256Hex = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

export interface SignOptions {
  vehicleKey: Buffer;
  vin: string;
  epoch: number;
  method: string;
  /** 보낼 경로 그대로(쿼리 포함) */
  path: string;
  /** 보낼 본문 원문 — 없으면 빈 본문 */
  body?: string;
  /** 차량 시계(ms) — 생략하면 지금 */
  now?: number;
  nonce?: string;
}

/** 서명 머리글 — X-Vehicle-Id·key epoch·시각·nonce·CMAC */
export function signVehicleRequest(o: SignOptions): Record<string, string> {
  const timestamp = String(Math.trunc(o.now ?? Date.now()));
  const nonce = o.nonce ?? randomBytes(16).toString('base64url');
  const canonical = vehicleRequestCanonical({ method: o.method, path: o.path, vin: o.vin, keyEpoch: o.epoch, timestamp, nonce, bodySha256: sha256Hex(o.body ?? '') });
  const mac = aesCmac(requestKeyOf(o.vehicleKey), Buffer.from(canonical, 'utf8')).toString('base64url');
  return {
    [VEHICLE_AUTH_HEADERS.vin]: o.vin,
    [VEHICLE_AUTH_HEADERS.epoch]: String(o.epoch),
    [VEHICLE_AUTH_HEADERS.timestamp]: timestamp,
    [VEHICLE_AUTH_HEADERS.nonce]: nonce,
    [VEHICLE_AUTH_HEADERS.mac]: mac,
  };
}
