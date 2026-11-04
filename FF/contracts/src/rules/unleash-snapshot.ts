// UL-LIVE: Edge is a replica; only the authenticated FF gateway issues vehicle snapshots.
import { z } from 'zod';
import { FClass } from '../schemas/safety';
import { canonicalJson } from './canonical';

export const UNLEASH_SNAPSHOT_TTL_MS = 60_000;
export const UNLEASH_SNAPSHOT_MAX_TTL_MS = 300_000;
const Flag = z.object({ flagKey: z.string().min(1), featureId: z.string().min(1), policyId: z.string().min(1), revision: z.number().int().positive(), contentHash: z.string().min(1), fClass: FClass, value: z.boolean(), reason: z.string().min(1), guardRequired: z.boolean() }).strict();
export const UnleashSnapshotPayload = z.object({ schema: z.literal('FF-UNLEASH-SNAPSHOT/1'), source: z.literal('UNLEASH_EDGE'), vin: z.string().min(1), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), issuedAt: z.string().datetime(), expiresAt: z.string().datetime(), flags: z.array(Flag) }).strict();
export const SignedUnleashSnapshot = z.object({ payload: UnleashSnapshotPayload, signature: z.object({ alg: z.literal('EdDSA'), kid: z.string().min(1), value: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict() }).strict();
export type SignedUnleashSnapshot = z.infer<typeof SignedUnleashSnapshot>;
export type UnleashSnapshotPayload = z.infer<typeof UnleashSnapshotPayload>;

/** Trust must be provisioned separately (activate-purpose Ed25519 public keys), never supplied by the response. */
export class SignedUnleashCache {
  private current: SignedUnleashSnapshot | null = null;
  private highWater = 0;
  private observedAt = 0;
  constructor(readonly vin: string, private readonly verify: (canonical: string, signature: SignedUnleashSnapshot['signature']) => boolean) {}
  accept(input: unknown, now: number): { accepted: boolean; reason: string } {
    if (!Number.isFinite(now) || now < this.observedAt) return { accepted: false, reason: 'CLOCK' };
    this.observedAt = now;
    const parsed = SignedUnleashSnapshot.safeParse(input);
    if (!parsed.success) return { accepted: false, reason: 'FORMAT' };
    const s = parsed.data, p = s.payload;
    const issued = Date.parse(p.issuedAt), expires = Date.parse(p.expiresAt);
    if (p.vin !== this.vin) return { accepted: false, reason: 'VIN' };
    if (issued > now || expires <= now || expires <= issued || expires - issued > UNLEASH_SNAPSHOT_MAX_TTL_MS) return { accepted: false, reason: 'TTL' };
    if (p.sequence < this.highWater) return { accepted: false, reason: 'REPLAY' };
    if (new Set(p.flags.map((f) => f.flagKey)).size !== p.flags.length || p.flags.some((f) => f.guardRequired !== !['F0', 'F1'].includes(f.fClass))) return { accepted: false, reason: 'FORMAT' };
    try { if (!this.verify(canonicalJson(p), s.signature)) return { accepted: false, reason: 'SIGNATURE' }; }
    catch { return { accepted: false, reason: 'SIGNATURE' }; }
    // An equal sequence may retry the identical envelope, but cannot replace it with different data.
    if (this.current && p.sequence === this.highWater && canonicalJson(this.current.payload) !== canonicalJson(p)) return { accepted: false, reason: 'REPLAY' };
    this.current = s;
    this.highWater = p.sequence;
    return { accepted: true, reason: 'VERIFIED' };
  }
  /** F2+ still require the local Safety Guard. A live local kill always overrides cached data. */
  resolve(flagKey: string, now: number, options: { killed?: boolean; localGuardAllows?: boolean } = {}) {
    if (!Number.isFinite(now) || now < this.observedAt) return { value: false, reason: 'SAFE_OFF_CLOCK' };
    this.observedAt = now;
    const p = this.current?.payload;
    if (!p || now < Date.parse(p.issuedAt) || now >= Date.parse(p.expiresAt)) return { value: false, reason: 'SAFE_OFF_EXPIRED' };
    if (options.killed) return { value: false, reason: 'KILL_SWITCH' };
    const f = p.flags.find((x) => x.flagKey === flagKey);
    if (!f) return { value: false, reason: 'FLAG_NOT_FOUND' };
    if (f.guardRequired && !options.localGuardAllows) return { value: false, reason: 'SAFETY_GUARD' };
    return { value: f.value, reason: f.reason, expiresAt: p.expiresAt };
  }
  /** Persist only this verified envelope; on restart re-accept it against provisioned trust and the current clock. */
  snapshot(): SignedUnleashSnapshot | null { return this.current ? structuredClone(this.current) : null; }
}
