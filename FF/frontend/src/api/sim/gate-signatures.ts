// Actual browser-local Gate signatures. This namespace never supplies a native/HSM trust anchor.
import { decisionState, jcs, type GateDecision, type GateDecisionPayload, type GateRecordRow } from '@ff/contracts';
import { SimError } from './engine';
import type { SimReadContext, SimWriteContext } from './types';

const LOCAL = 'SIM-GATE-';
const STORE = 'gxLocalGateKeys';
type LocalKey = { kid: string; source: 'LOCAL_SIMULATION'; purpose: 'gate'; version: string; createdAt: string; notAfter: string; publicKey: JsonWebKey; privateKey: JsonWebKey };
type KeyStore = { current: string | null; keys: Record<string, LocalKey> };
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pemBytes = (pem: string) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));

async function nativeGateKey(ctx: SimReadContext, kid: string): Promise<CryptoKey | null> {
  if (kid.startsWith(LOCAL)) return null;
  const keys = await ctx.snapshot<{ items: any[] }>('pkiKeys');
  if (!Array.isArray(keys?.items)) throw new SimError('INTERNAL', 'Gate 공개키 원천 스냅샷을 읽을 수 없습니다.', { source: 'pkiKeys' });
  const entry = keys.items.find((k) => k.keyId === kid), now = ctx.now().getTime();
  if (!entry || entry.alg !== 'Ed25519' || entry.purpose !== 'gate' || !['ACTIVE', 'RETIRED'].includes(entry.status) || !Number.isFinite(Date.parse(entry.notAfter)) || !Number.isFinite(Date.parse(entry.createdAt)) || Date.parse(entry.notAfter) <= now || Date.parse(entry.createdAt) > now) return null;
  const spki = pemBytes(entry.publicKeyPem);
  const fingerprint = 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', spki))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  if (entry.fingerprint !== fingerprint) return null;
  return crypto.subtle.importKey('spki', spki, { name: 'Ed25519' }, false, ['verify']);
}

export async function verifyNativeGateAttestation(ctx: SimReadContext, payload: unknown, signature: GateDecision['signature']): Promise<boolean> {
  if (signature?.alg !== 'EdDSA' || typeof signature.kid !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature.value ?? '')) return false;
  try {
    const key = await nativeGateKey(ctx, signature.kid);
    return !!key && await crypto.subtle.verify('Ed25519', key, decode(signature.value), enc.encode(jcs(payload)));
  } catch (error) { if (error instanceof SimError) throw error; return false; }
}

export async function signLocalGate(ctx: SimWriteContext, payload: GateDecisionPayload): Promise<GateDecision> {
  const state = ctx.state<KeyStore>(STORE, () => ({ current: null, keys: {} }));
  let key = state.current ? state.keys[state.current] : null;
  if (!key || key.version !== ctx.overlay.version || Date.parse(key.notAfter) <= ctx.now().getTime()) {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
    key = { kid: LOCAL + crypto.randomUUID(), source: 'LOCAL_SIMULATION', purpose: 'gate', version: ctx.overlay.version, createdAt: ctx.iso(), notAfter: new Date(ctx.now().getTime() + 365 * 86400_000).toISOString(), publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey), privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey) };
    state.keys[key.kid] = key; state.current = key.kid;
  }
  const privateKey = await crypto.subtle.importKey('jwk', key.privateKey, { name: 'Ed25519' }, false, ['sign']);
  return { payload, signature: { alg: 'EdDSA', kid: key.kid, value: b64url(new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, enc.encode(jcs(payload))))) }, signedAt: ctx.iso() };
}

/** Public captured keys are mandatory for native evidence; a local key can never shadow their kid. */
export async function verifyGateBytes(ctx: SimReadContext, record: GateRecordRow, decision: GateDecision | null, baselineId: string | null, local: boolean): Promise<{ valid: boolean; reason: string | null }> {
  if (!decision) return { valid: false, reason: '서명된 Gate 원문이 없습니다.' };
  const sig = decision.signature;
  if (sig?.alg !== 'EdDSA' || !/^[A-Za-z0-9_-]{86}$/.test(sig.value ?? '')) return { valid: false, reason: 'Gate 서명 형식이 올바르지 않습니다.' };
  if (decision.payload?.target?.baselineId !== baselineId) return { valid: false, reason: 'Gate 결정의 Baseline이 현재 Feature와 다릅니다.' };
  const now = ctx.now().getTime(), signed = Date.parse(decision.signedAt);
  if (!Number.isFinite(signed) || signed > now + 60_000) return { valid: false, reason: 'Gate 서명 시각을 확인할 수 없습니다.' };
  try {
    let key: CryptoKey;
    if (local) {
      const entry = (ctx.overlay.data[STORE] as KeyStore | undefined)?.keys[sig.kid];
      if (!sig.kid.startsWith(LOCAL) || !entry || entry.source !== 'LOCAL_SIMULATION' || entry.purpose !== 'gate' || entry.version !== ctx.overlay.version || !Number.isFinite(Date.parse(entry.notAfter)) || !Number.isFinite(Date.parse(entry.createdAt)) || Date.parse(entry.notAfter) <= now || Date.parse(entry.createdAt) > signed) return { valid: false, reason: '이 브라우저 판의 유효한 로컬 Gate 키가 없습니다.' };
      key = await crypto.subtle.importKey('jwk', entry.publicKey, { name: 'Ed25519' }, false, ['verify']);
    } else {
      if (sig.kid.startsWith(LOCAL)) return { valid: false, reason: '로컬 키를 native Gate 신뢰앵커로 사용할 수 없습니다.' };
      const native = await nativeGateKey(ctx, sig.kid);
      if (!native) return { valid: false, reason: '유효한 native Gate 공개키가 없거나 만료됐습니다.' };
      key = native;
    }
    const verified = await crypto.subtle.verify('Ed25519', key, decode(sig.value), enc.encode(jcs(decision.payload)));
    const state = decisionState(record, decision, verified);
    return { valid: state.state === 'SIGNED' || state.state === 'IMPORTED', reason: state.reason };
  } catch (error) {
    if (error instanceof SimError) throw error;
    return { valid: false, reason: 'Gate 서명·키 원문을 검증하지 못했습니다.' };
  }
}
