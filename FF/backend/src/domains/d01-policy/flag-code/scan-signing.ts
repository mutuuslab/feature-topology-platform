// Flag 스캔 서명 키(20-97 §2) — Ed25519. 페이로드는 contracts flagScanSigningPayload(접두 + JCS(manifest)).
// 시연 키 ff-demo-scan-1은 공개된 고정 시드에서 만든다(생성기와 백엔드가 같은 키). 운영 모드는 시연 키를 믿지 않는다.
// 서버 스캔 키는 FF_FLAG_SCAN_PRIVATE_KEY(PKCS#8 PEM)·FF_FLAG_SCAN_KEY_ID에서 읽는다. 다른 모듈을 가져오지 않는다(도구가 바로 읽는다).
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const DEMO_SCAN_KEY_ID = 'ff-demo-scan-1';
/** 공개된 시연 전용 시드 — 비밀이 아니다. 운영 모드에서는 이 키의 서명을 거부한다 */
export const DEMO_SCAN_SEED_TEXT = 'ff-demo-scan-1 — 시연 전용 공개 키, 운영에 쓰지 않는다';
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function demoScanPrivateKey(): KeyObject {
  const seed = createHash('sha256').update(DEMO_SCAN_SEED_TEXT, 'utf8').digest();
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}
export const demoScanPublicKeyPem = () => createPublicKey(demoScanPrivateKey()).export({ type: 'spki', format: 'pem' }).toString();

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** 페이로드(flagScanSigningPayload 결과)를 서명 — base64url 64바이트 */
export const signScanPayload = (payload: string, key: KeyObject) => b64url(sign(null, Buffer.from(payload, 'utf8'), key));
export function verifyScanPayload(payload: string, signature: string, publicKey: KeyObject): boolean {
  try {
    return /^[A-Za-z0-9_-]{86}$/.test(signature) && verify(null, Buffer.from(payload, 'utf8'), publicKey, fromB64url(signature));
  } catch {
    return false;
  }
}

type Env = Record<string, string | undefined>;
/** 서버가 스캔에 쓰는 서명 키 — 설정 키가 있으면 그것, 없으면(운영 모드가 아닐 때만) 시연 키 */
export function serverScanKey(env: Env = process.env): { keyId: string; key: KeyObject } | null {
  const pem = env.FF_FLAG_SCAN_PRIVATE_KEY?.trim();
  if (pem) return { keyId: env.FF_FLAG_SCAN_KEY_ID?.trim() || 'ff-scan-1', key: createPrivateKey(pem.replace(/\\n/g, '\n')) };
  if (env.FF_ENV === 'production') return null;
  return { keyId: DEMO_SCAN_KEY_ID, key: demoScanPrivateKey() };
}
/** 믿는 검증 키 — 서버 스캔 키(설정)와, 운영 모드가 아니면 시연 키 */
export function trustedScanKeys(env: Env = process.env): Map<string, KeyObject> {
  const out = new Map<string, KeyObject>();
  if (env.FF_ENV !== 'production') out.set(DEMO_SCAN_KEY_ID, createPublicKey(demoScanPrivateKey()));
  const pem = env.FF_FLAG_SCAN_PRIVATE_KEY?.trim();
  if (pem) out.set(env.FF_FLAG_SCAN_KEY_ID?.trim() || 'ff-scan-1', createPublicKey(createPrivateKey(pem.replace(/\\n/g, '\n'))));
  return out;
}
