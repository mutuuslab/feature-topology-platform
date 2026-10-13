// 커널 암호 유틸 — 소프트웨어 HSM(pki-kms/hsm.service.ts)과 감사 해시 체인이 쓴다. 외부 의존성 없이 node:crypto만.
// AES-CMAC-128(RFC 4493): 차량별 봉투 cmd_auth·상태 증명 state_auth(보고서 9.2·9.7). HKDF-SHA256(RFC 5869): 차량 키 파생.
import { createCipheriv, createHash, hkdfSync } from 'node:crypto';

const BLOCK = 16;
const RB = 0x87;

function shiftLeft(b: Buffer): Buffer {
  const out = Buffer.alloc(BLOCK);
  for (let i = 0; i < BLOCK; i++) out[i] = ((b[i] << 1) & 0xff) | (i + 1 < BLOCK ? b[i + 1] >> 7 : 0);
  return out;
}

function aesBlock(key: Buffer, block: Buffer): Buffer {
  const c = createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}

function subkeys(key: Buffer): [Buffer, Buffer] {
  const l = aesBlock(key, Buffer.alloc(BLOCK));
  const k1 = shiftLeft(l);
  if (l[0] & 0x80) k1[BLOCK - 1] ^= RB;
  const k2 = shiftLeft(k1);
  if (k1[0] & 0x80) k2[BLOCK - 1] ^= RB;
  return [k1, k2];
}

/** AES-CMAC-128 (RFC 4493) — 16바이트 태그 */
export function aesCmac(key: Buffer, msg: Buffer): Buffer {
  if (key.length !== 16) throw new Error('AES-CMAC-128 키는 16바이트');
  const [k1, k2] = subkeys(key);
  const n = Math.max(1, Math.ceil(msg.length / BLOCK));
  const complete = msg.length > 0 && msg.length % BLOCK === 0;
  const last = Buffer.alloc(BLOCK);
  const tail = msg.subarray((n - 1) * BLOCK);
  if (complete) for (let i = 0; i < BLOCK; i++) last[i] = tail[i] ^ k1[i];
  else {
    tail.copy(last);
    last[tail.length] = 0x80;
    for (let i = 0; i < BLOCK; i++) last[i] ^= k2[i];
  }
  let x: Buffer = Buffer.alloc(BLOCK);
  for (let i = 0; i < n - 1; i++) {
    const y = Buffer.alloc(BLOCK);
    for (let j = 0; j < BLOCK; j++) y[j] = x[j] ^ msg[i * BLOCK + j];
    x = aesBlock(key, y);
  }
  const y = Buffer.alloc(BLOCK);
  for (let j = 0; j < BLOCK; j++) y[j] = x[j] ^ last[j];
  return aesBlock(key, y);
}

/** HKDF-SHA256(RFC 5869) — 차량 키 = HKDF(root, salt=epoch, info="ffp-vehicle-key|<vin>") 16바이트 */
export function hkdf16(root: Buffer, salt: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', root, Buffer.from(salt), Buffer.from(info), 16));
}

export const sha256hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** 고정 시간 비교 — 태그 비교로 시간 차 누설을 막는다 */
export function equalBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** 대상 식별 해시 — SHA-256(VIN ‖ ECU 부품 번호 ‖ SW 버전) 앞 4바이트(보고서 9.2절 ICD 예제). 플랫폼 봉투와 차량 Guard가 같은 값을 쓴다 */
export const targetHashOf = (vin: string, ecu: string, sw: string) => parseInt(sha256hex(`${vin}${ecu}${sw}`).slice(0, 8), 16);

/** 차량 가명(status_report v2 vehicle_pseudonym) — VIN을 그대로 싣지 않는다(FFG-TEL-001) */
export const vehiclePseudonym = (vin: string) => sha256hex(`ffp-pseudonym|${vin}`).slice(0, 16);
