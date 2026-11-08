import type { FeatureVersionRow } from '../schemas/dataset';
import type { Policy } from '../schemas/policy';
import type { FlagCoverageRow } from '../schemas/flag-code';
import type { ComplianceRegistryInput } from './compliance-rule';
import type { AdsClassification, MarketBaseline } from './ads-change';
import type { ConfigSet, DeploySetting, OddProfile, VehicleConfigReport } from './ads-config';

export const GX_SOURCE_SCHEMA = 'ff-gx-deploy-sources/1' as const;
export const GX_SOURCE_TTL_MS = 24 * 3600_000;
/** The current lifecycle is evaluated independently; changes to technical scope invalidate the capture. */
export function gxFeatureFacts(f: FeatureVersionRow) {
  return { featureId: f.featureId, version: f.version, baselineId: f.baselineId, country: f.country, vehicleModel: f.vehicleModel, trim: f.trim, asil: f.asil, requirementIds: f.requirementIds, swIds: f.swIds, swVersions: f.swVersions ?? [], ecuPnos: f.ecuPnos ?? [], controlPoints: f.controlPoints, tags: f.tags };
}
export interface ExceptionDeploySourcesPayload {
  schema: typeof GX_SOURCE_SCHEMA;
  observedAt: string;
  validUntil: string;
  sourceRevision: string;
  policy: Pick<Policy, 'policyId' | 'revision' | 'contentHash' | 'featureId' | 'featureVersion' | 'flagKey'>;
  feature: ReturnType<typeof gxFeatureFacts>;
  compliance: ComplianceRegistryInput;
  flagCode: { connected: boolean; row: FlagCoverageRow };
  ads: { settings: DeploySetting[]; profile: OddProfile | null; classification: AdsClassification | null; sets: ConfigSet[]; baselines: MarketBaseline[]; fClass: string | null; enforced: boolean; vehicles: { vin: string; country: string; report: VehicleConfigReport | null }[] };
}
export interface ExceptionDeploySources {
  payload: ExceptionDeploySourcesPayload;
  /** Gate-purpose attestation of read facts; this is not an approval or a new Gate decision. */
  signature: { alg: 'EdDSA'; kid: string; value: string };
}
