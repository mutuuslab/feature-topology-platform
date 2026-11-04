// The authenticated gateway supplies the envelope; public-key trust and local Safety Guard stay independent.
import { SignedUnleashCache } from '@ff/contracts';
import type { FlagClient } from './distance.ts';

export interface LocalFlagBoundary { killed?: boolean; localGuardAllows?: boolean; }
export type LocalGuardResolver = (key: string, vin: string) => LocalFlagBoundary | Promise<LocalFlagBoundary>;

export class SnapshotFlagClient implements FlagClient {
  readonly cache: SignedUnleashCache;
  private readonly now: () => number;
  private readonly localGuard: LocalGuardResolver;

  constructor(cache: SignedUnleashCache, trustedNow: () => number, localGuard: LocalGuardResolver = () => ({})) {
    this.cache = cache;
    this.now = trustedNow;
    this.localGuard = localGuard;
  }

  async getBooleanValue(key: string, fallback: false, context: { targetingKey: string }): Promise<boolean> {
    if (fallback !== false || context?.targetingKey !== this.cache.vin) return false;
    try {
      const boundary = await this.localGuard(key, this.cache.vin);
      // Read time after the local decision: waiting for a Guard must never extend a signed TTL.
      return this.cache.resolve(key, this.now(), boundary).value;
    } catch { return false; }
  }
}
