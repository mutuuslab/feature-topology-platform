import { activationState, type RuntimeFlagView } from './fleet-map';
import { ADOPTION_COUNTRY_POINTS } from './telemetry-metrics';

/** Public country/market representative points. Never vehicle coordinates. */
export const ADOPTION_STATES = ['ON', 'CANARY', 'OFF', 'DISABLED', 'UNKNOWN'] as const;
export type AdoptionMetricState = typeof ADOPTION_STATES[number];
export function flagAdoptionCounts(
  runtime: readonly { vin: string; link: 'ONLINE' | 'OFFLINE'; kills: string[]; flags: RuntimeFlagView[]; pending?: string[] }[],
  vehicles: readonly { vin: string; country: string }[],
  flags: readonly { flagKey: string; stageRatio: number }[],
) {
  const countries = new Map(vehicles.map((v) => [v.vin, v.country]));
  const groups = new Map<string, { flag: string; country: string; state: AdoptionMetricState; lat: string; lon: string; vehicles: number }>();
  for (const f of flags) for (const v of runtime) {
    const country = countries.get(v.vin), point = country && ADOPTION_COUNTRY_POINTS[country];
    if (!country || !point) continue; // Unknown countries have no invented location.
    const raw = activationState(v, f.flagKey);
    const state = raw === 'ON' && f.stageRatio < 1 ? 'CANARY' : raw;
    const key = JSON.stringify([f.flagKey, country, state]);
    const row = groups.get(key) ?? { flag: f.flagKey, country, state, lat: String(point[0]), lon: String(point[1]), vehicles: 0 };
    row.vehicles++; groups.set(key, row);
  }
  return [...groups.values()];
}
