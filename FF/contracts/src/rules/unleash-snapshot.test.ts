import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { canonicalJson } from './canonical';
import { SignedUnleashCache, type SignedUnleashSnapshot } from './unleash-snapshot';

const keys = generateKeyPairSync('ed25519');
const now = Date.parse('2026-11-05T00:00:00.000Z');
const envelope = (changes: Partial<SignedUnleashSnapshot['payload']> = {}): SignedUnleashSnapshot => {
  const payload: SignedUnleashSnapshot['payload'] = { schema: 'FF-UNLEASH-SNAPSHOT/1', source: 'UNLEASH_EDGE', vin: 'VIN-1', sequence: 1, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(), flags: [{ flagKey: 'assist', featureId: 'FEAT-00022', policyId: 'POL-00002', revision: 1, contentHash: 'sha256:trusted', fClass: 'F1', guardRequired: false, value: true, reason: 'TARGETING_MATCH' }], ...changes };
  return { payload, signature: { alg: 'EdDSA', kid: 'activate-1', value: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64url') } };
};
const cache = () => new SignedUnleashCache('VIN-1', (canonical, s) => s.kid === 'activate-1' && verify(null, Buffer.from(canonical), keys.publicKey, Buffer.from(s.value, 'base64url')));

describe('Unleash vehicle last-signed TTL cache', () => {
  it('verifies real Ed25519, remains usable offline within TTL and switches off exactly at expiry', () => {
    const c = cache(), s = envelope();
    expect(c.accept(s, now).accepted).toBe(true);
    expect(c.resolve('assist', now + 59999).value).toBe(true);
    expect(c.resolve('assist', now + 60000)).toEqual({ value: false, reason: 'SAFE_OFF_EXPIRED' });
    expect(c.accept(s, now + 60000)).toEqual({ accepted: false, reason: 'TTL' });
  });
  it('never accepts a response public key as trust; tampering and a different key are rejected', () => {
    const c = cache(), changed = envelope(); changed.payload.flags[0].value = false;
    expect(c.accept(changed, now).reason).toBe('SIGNATURE');
    const forged = envelope(); forged.signature.kid = 'attacker'; expect(c.accept(forged, now).reason).toBe('SIGNATURE');
    expect(c.resolve('assist', now).value).toBe(false);
  });
  it.each([
    ['other VIN', { vin: 'VIN-2' }, 'VIN'],
    ['expired', { expiresAt: new Date(now).toISOString() }, 'TTL'],
    ['future-issued', { issuedAt: new Date(now + 1).toISOString() }, 'TTL'],
    ['overlong TTL', { expiresAt: new Date(now + 300001).toISOString() }, 'TTL'],
  ] as const)('rejects %s', (_name, change, reason) => expect(cache().accept(envelope(change), now).reason).toBe(reason));
  it('rejects old signed data without replacing the newer trusted cache', () => {
    const c = cache(); expect(c.accept(envelope({ sequence: 2, issuedAt: new Date(now + 1000).toISOString() }), now + 1000).accepted).toBe(true);
    expect(c.accept(envelope(), now + 2000).reason).toBe('REPLAY');
    expect(c.resolve('assist', now + 2000).value).toBe(true);
  });
  it('enforces local kill and Safety Guard independently of Edge true', () => {
    const c = cache(), s = envelope(); s.payload.flags[0].fClass = 'F2'; s.payload.flags[0].guardRequired = true;
    const payload = s.payload; s.signature.value = sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64url');
    expect(c.accept(s, now).accepted).toBe(true);
    expect(c.resolve('assist', now).reason).toBe('SAFETY_GUARD');
    expect(c.resolve('assist', now, { localGuardAllows: true }).value).toBe(true);
    expect(c.resolve('assist', now, { localGuardAllows: true, killed: true })).toEqual({ value: false, reason: 'KILL_SWITCH' });
  });
  it('does not expose mutable verified state; persisted envelopes must verify again after restart', () => {
    const c = cache(); c.accept(envelope(), now);
    const persisted = c.snapshot()!; persisted.payload.flags[0].value = false;
    expect(c.resolve('assist', now).value).toBe(true);
    expect(cache().accept(persisted, now).reason).toBe('SIGNATURE');
  });
  it('expired data cannot resurrect when the local clock moves backwards', () => {
    const c = cache(); c.accept(envelope(), now);
    expect(c.resolve('assist', now + 60000).value).toBe(false);
    expect(c.resolve('assist', now + 50000)).toEqual({ value: false, reason: 'SAFE_OFF_CLOCK' });
    expect(c.accept(envelope(), now + 50000).reason).toBe('CLOCK');
  });
  it('newer kill/off data in the same millisecond is accepted and the previous ON cannot replay', () => {
    const c = cache(), on = envelope(); expect(c.accept(on, now).accepted).toBe(true);
    const off = envelope({ sequence: 2, flags: [{ ...on.payload.flags[0], value: false, reason: 'KILL_SWITCH' }] });
    expect(c.accept(off, now).accepted).toBe(true); expect(c.resolve('assist', now).value).toBe(false);
    expect(c.accept(on, now).reason).toBe('REPLAY');
  });

});
