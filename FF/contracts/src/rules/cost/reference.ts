// Feature DB-first cost sources. Display/estimate evidence does not create Feature or purchase approval.
import type { FeatureVersionRow } from '../../schemas/dataset';
import { REF_MONEY_FIELDS, type FeatureRefRow, type RefSource } from '../../schemas/refdb';
import type { CostBasis } from './basis';
import type { CostRefFacts } from './engine';

/** Deterministic source text: independent of JSON property order; array order remains source order. */
export function canonicalCostSource(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalCostSource).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${JSON.stringify(k)}:${canonicalCostSource(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export const costRefFactsOf = (r: FeatureRefRow, ord: number): CostRefFacts => ({
  refId:r.refId,ord,tshirt:r.tshirt,asilRep:r.asilRep,lifecycle:r.lifecycle,autoQuality:r.autoQuality,
  benchmarkEur:r.benchmarkEur ?? null,bundleId:r.bundleId || null,bundleRep:!!r.bundleRep,
  sizeEvidenceGrade:r.sizeEvidenceGrade || null,duplicateOf:r.duplicateOf || null,requires:r.requires ?? [],
});

export const costReferenceMissing = (r: FeatureRefRow, basis: CostBasis): string[] => [
  !Number.isFinite(basis.sizePoints[r.tshirt]) && 'TSHIRT_BASIS',
  !basis.asil[r.asilRep] && 'ASIL_BASIS',
  !Number.isFinite(basis.overall.lifecycle[r.lifecycle]) && 'LIFECYCLE_BASIS',
  !Number.isFinite(basis.overall.quality[r.autoQuality]) && 'QUALITY_BASIS',
].filter((value): value is string => !!value);

export const costFeatureSourceOf = (f: FeatureVersionRow) => ({
  featureId:f.featureId,version:f.version,name:f.name,asil:f.asil,lifecycle:f.lifecycle,
  country:f.country,vehicleModel:f.vehicleModel,trim:f.trim,requirementIds:f.requirementIds,
  featureRefs:f.featureRefs ?? [],
});
export type CostFeatureSource = ReturnType<typeof costFeatureSourceOf>;
export interface CostReferenceProvenance {kind:'WORKBOOK_DERIVED_REFERENCE';workbookSha256:string;sourceReferenceRelease:string;capturedPublicRelease:string;capturedPublicReferenceSha256:string;boundary:string}
export interface CostReferenceSnapshot {
  reference:FeatureRefRow;
  /** Unselected duplicate targets can influence bundle inclusion checks in the engine. */
  relatedReferences?:FeatureRefRow[];
  facts:CostRefFacts;
  feature:CostFeatureSource|null;
  sources:RefSource[];
}
export const costReferencePublic = (reference: FeatureRefRow) => {
  const out={...reference} as Partial<FeatureRefRow>;
  for(const field of REF_MONEY_FIELDS) delete out[field];
  return out as Omit<FeatureRefRow,typeof REF_MONEY_FIELDS[number]>;
};
export interface CostReferenceRevision {
  revision:number;release:string;referenceSha256:string;featureSha256:string|null;
  capturedBy:string;capturedAt:string;reason:string;
}
export interface CostReferenceOrigin extends CostReferenceRevision {
  provenance?:CostReferenceProvenance|null;
  kind:'FEATURE_DB'|'REGISTERED_FEATURE'|'LEGACY_FEATURE_LINK';
  stale:boolean;latestRelease:string|null;currentReferenceSha256:string|null;
  reference:ReturnType<typeof costReferencePublic>|null;feature:CostFeatureSource|null;
  sources:RefSource[];history:CostReferenceRevision[];
}

/** A selected estimate row is not an empty workbook row. Unknown quantity/active expense is not zero. */
export function costInputMissing(lines:readonly {lineNo:number;inputs:{qty?:number|null}}[],expenses:readonly {qty:number|null;unitPrice:number|null}[]=[]):string[]{
 const missing=lines.filter(l=>l.inputs.qty===null||l.inputs.qty===undefined).map(l=>'산정 줄 '+l.lineNo+' 수량');
 expenses.forEach((e,i)=>{if((e.qty!==null&&e.unitPrice===null)||(e.qty===null&&e.unitPrice!==null))missing.push('별도 비용 '+(i+1)+' 수량·단가');});return missing;
}
