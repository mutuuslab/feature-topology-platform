// Additional exact read families. No workflow/identity/role/person-specific captures enter these packets.
export const RESOURCE_VERSION = 1;
export const RESOURCE_INDEX = 'resource-query-index.json';
export const RESOURCE_DIR = 'resource-query-packets';
export const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;
export type ResourceKind = 'VEHICLE' | 'FEATURE';
export interface ResourcePacket { version:number; kind:ResourceKind; id:string; responses:Record<string,{body:string;bytes:number;sha256:string}> }
export interface ResourceIndex { version:number; logicalFiles:number; packets:{kind:ResourceKind;id:string;file:string;bytes:number;sha256:string;files:string[]}[] }
export function resourceRequest(file:string):{kind:ResourceKind;id:string;version?:string}|null {
  let m=/^vehicles_([A-Za-z0-9._-]+)_(runtime|requests|status|feature-state|verdicts|customer-state|openfeature|installs)\.json$/.exec(file);
  if(m)return {kind:'VEHICLE',id:m[1]};
  m=/^features_(FEAT-\d{5})(?:_(?:baselines|evaluations|history|ops-metrics|reviews|trace-links))?\.json$/.exec(file);
  if(m)return {kind:'FEATURE',id:m[1]};
  m=/^features_(FEAT-\d{5})_reviews_version_(\d+\.\d+\.\d+)\.json$/.exec(file);
  if(m)return {kind:'FEATURE',id:m[1],version:m[2]};
  m=/^features_(FEAT-\d{5})_versions_(\d+\.\d+\.\d+)(?:_(?:analysis|baseline-checklist|classification|flag-code-gate|gate-na-requests|gates|release-candidate|release-signoff|safety|support-drills|variability))?\.json$/.exec(file);
  return m?{kind:'FEATURE',id:m[1],version:m[2]}:null;
}
export function resourcePacketFile(hash:string) {
  if(!/^[0-9a-f]{64}$/.test(hash))throw new Error('Invalid resource digest');
  return `${RESOURCE_DIR}/${hash}.json`;
}
export const resourceCandidate=(file:string)=>file.startsWith('features_FEAT-')||/^vehicles_.*_(?:runtime|requests|status|feature-state|verdicts|customer-state|openfeature|installs)(?:_|\.json)/.test(file);
