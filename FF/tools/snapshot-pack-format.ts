// Shared by the Node producer and the Pages resolver. No Node APIs or environment values.
export const PACK_VERSION = 1;
export const PACK_INDEX = 'vehicle-query-index.json';
export const PACK_DIR = 'vehicle-query-packets';
export interface PacketEntry { body: string; sha256: string; bytes: number }
export interface VehiclePacket { version: number; vin: string; responses: Record<string, PacketEntry> }
export interface PacketIndex { version: number; vins: string[]; catalogIds: string[]; flagKeys: string[]; logicalFiles: number; packets: { vin: string; file: string; sha256: string; bytes: number }[] }
export function packedRequest(file: string): { vin: string; family: 'vehicleEligibility' | 'activationDecide' } | null {
  let m = /^vehicles_([A-Za-z0-9._-]+)_eligibility_catalogId_([A-Za-z0-9._-]+)\.json$/.exec(file);
  if (m) return { vin: m[1], family: 'vehicleEligibility' };
  m = /^activation_decide_vin_([A-Za-z0-9._-]+)_flagKey_([A-Za-z0-9._-]+)\.json$/.exec(file);
  return m ? { vin: m[1], family: 'activationDecide' } : null;
}
export function packetFile(digest: string): string {
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('Invalid VIN digest');
  return `${PACK_DIR}/${digest}.json`;
}
