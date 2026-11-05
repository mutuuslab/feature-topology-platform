// 독립 외부 화면의 읽기 전용 결합. 제목·본문·Flag 이름으로 연결을 추측하지 않는다.
import type { FeatureFlagRow } from '@ff/contracts';

export interface ExternalItemRef {
  system: string;
  key: string;
  fields: Record<string, unknown>;
}
export interface ExternalFeature {
  featureId: string;
  version: string;
  name?: string;
  ownerId?: string;
  lifecycle?: string;
  country?: string;
  vehicleModel?: string;
  trim?: string;
  requirementIds?: string[];
}
export type TraceOrigin = 'REQUIREMENT_ID' | 'EXTERNAL_FEATURE' | 'PARENT_EPIC' | 'POLICY';
export interface ExternalFeatureLink extends ExternalFeature {
  origins: TraceOrigin[];
}

export const fieldText = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
export const personText = (value: unknown): string | null => {
  if (typeof value === 'string') return fieldText(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return fieldText(record.displayName) ?? fieldText(record.name) ?? fieldText(record.accountId) ?? fieldText(record.id);
};
export const featureKey = (feature: Pick<ExternalFeature, 'featureId' | 'version'>) => `${feature.featureId}@${feature.version}`;
export const featureTarget = (id: unknown, version: unknown): Pick<ExternalFeature, 'featureId' | 'version'> | null => {
  const featureId = fieldText(id);
  const ver = fieldText(version);
  return featureId && /^FEAT-\d{5}$/.test(featureId) && ver && /^\d+\.\d+\.\d+$/.test(ver) ? { featureId, version: ver } : null;
};
export const featureHref = (feature: Pick<ExternalFeature, 'featureId' | 'version'>, tab = 'ext') => `/features/${feature.featureId}/${feature.version}?${new URLSearchParams({ tab })}`;
export const flagMapHref = (flagKey: string) => `/fleet/map?${new URLSearchParams({ lens: 'activation', flagKey })}`;

/** 읽기 응답이 깨졌을 때 링크를 만들어 내거나 렌더 중 멈추지 않도록, 화면에서 사용하는 필드를 확인한다. */
export function validFlagRows(value: unknown): value is FeatureFlagRow[] {
  const https = (url: unknown) => {
    if (typeof url !== 'string') return false;
    try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; }
  };
  const record = (entry: unknown): entry is Record<string, any> => !!entry && typeof entry === 'object' && !Array.isArray(entry);
  return Array.isArray(value) && value.every((row) => record(row) && !!fieldText(row.flagKey) &&
    (row.featureId === null || !!featureTarget(row.featureId, row.version)) &&
    (row.policy === null || (record(row.policy) && /^POL-\d{5}$/.test(row.policy.policyId) && typeof row.policy.status === 'string' && Number.isInteger(row.policy.revision) && typeof row.policy.controlPoint === 'string')) &&
    (row.publication === null || (record(row.publication) && !!fieldText(row.publication.publicationId) && typeof row.publication.status === 'string' && Number.isInteger(row.publication.confirmed) && row.publication.confirmed >= 0 && Number.isInteger(row.publication.denominator) && row.publication.denominator >= 0)) &&
    Array.isArray(row.sources) && row.sources.every((source: unknown) => record(source) && ['GITHUB', 'GITLAB'].includes(source.provider) &&
      ['commit', 'path', 'symbol', 'contentHash', 'importedAt', 'importedBy', 'provenance'].every((key) => typeof source[key] === 'string') &&
      /^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(source.commit) && Number.isInteger(source.line) && source.line >= 1 && https(source.repository) && https(source.url)));
}

/** JIRA 프로젝트 키는 실제 이슈 키에서, 요구 그룹은 실제 요구 ID 접두부에서만 얻는다. */
export function itemContext(item: ExternalItemRef) {
  if (item.system === 'JIRA') return { project: /^([A-Z][A-Z0-9_]*)-\d+$/.exec(item.key)?.[1] ?? null, requirementGroup: null };
  const requirementId = fieldText(item.fields.reqId);
  return { project: fieldText(item.fields.project), requirementGroup: requirementId ? /^(.*)-\d+$/.exec(requirementId)?.[1] ?? requirementId : null };
}

export function externalTrace(item: ExternalItemRef, features: ExternalFeature[], flagRows: FeatureFlagRow[], siblings: ExternalItemRef[] = []) {
  const targets = new Map<string, ExternalFeatureLink>();
  const requirementId = fieldText(item.fields.reqId);
  const policyId = fieldText(item.fields.policyId);
  const direct = featureTarget(item.fields.featureId, item.fields.version);
  const parentKey = fieldText(item.fields.parentKey);
  const parent = item.system === 'JIRA' && parentKey ? siblings.find((candidate) => candidate.system === 'JIRA' && candidate.key === parentKey) : undefined;
  const parentTarget = parent ? featureTarget(parent.fields.featureId, parent.fields.version) : null;
  const add = (target: ExternalFeature, origin: TraceOrigin) => {
    const key = featureKey(target);
    const actual = features.find((feature) => featureKey(feature) === key);
    const prior = targets.get(key);
    targets.set(key, { ...target, ...actual, origins: [...new Set([...(prior?.origins ?? []), origin])] });
  };
  if (item.system === 'CODEBEAMER' && requirementId) {
    for (const feature of features) if (feature.requirementIds?.includes(requirementId)) add(feature, 'REQUIREMENT_ID');
  }
  if (item.system === 'JIRA') {
    if (direct) add(direct, 'EXTERNAL_FEATURE');
    if (parentTarget) add(parentTarget, 'PARENT_EPIC');
  }
  const policyRows = item.system === 'JIRA' && policyId ? flagRows.filter((row) => row.policy?.policyId === policyId) : [];
  for (const row of policyRows) {
    const target = featureTarget(row.featureId, row.version);
    if (target) add({ ...target, name: row.featureName ?? undefined }, 'POLICY');
  }
  // CR에 정책 ID가 있으면 그 정책만 보여 준다. 같은 Feature의 다른 Flag를 이 CR의 근거로 붙이지 않는다.
  const flags = item.system === 'JIRA' && policyId ? policyRows : flagRows.filter((row) => {
    const target = featureTarget(row.featureId, row.version);
    return target && targets.has(featureKey(target));
  });
  const declared = direct ?? parentTarget;
  const referenceConflict = !!declared && policyRows.some((row) => {
    const target = featureTarget(row.featureId, row.version);
    return target && featureKey(target) !== featureKey(declared);
  });
  return { features: [...targets.values()], flags, requirementId, policyId, parentKey, referenceConflict };
}
