import { workbench as T } from '../../copy/workbench';

export const SOURCES = ['flags', 'refs', 'replies', 'cost'] as const;
export type SourceKey = typeof SOURCES[number];
export const sourceRoute = { flags: 'featureFlags', refs: 'listRefs', replies: 'fleetRuntime', cost: 'costProjects' } as const;
export type CellValue = string | number | boolean | null;
export interface Column { key: string; kind?: 'number' | 'money' | 'date' }
export interface DataRow { id: string; values: Record<string, CellValue>; links: { kind: keyof typeof T.open; href: string }[] }
export interface DataPage { rows: DataRow[]; columns: Column[]; total: number; nextOffset?: number; masked: boolean; release?: string }
export type Operator = keyof typeof T.operators;
export interface Filter { id: string; field: string; op: Operator; value: string; values: string[] }
export interface ViewConfig { source: SourceKey; filters: Filter[]; search: string; columns: string[] }
export interface SavedView extends ViewConfig { id: string; name: string }
export interface QueryHistory extends ViewConfig { id: string; at: string; result: 'SUCCESS' | 'ERROR' | 'FORBIDDEN'; count: number | null }
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === 'string' && value.length ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const arr = (value: unknown): any[] => { if (!Array.isArray(value) || !value.every(object)) throw new Error(T.malformed); return value; };
const columns = (keys: string[], numeric: string[] = [], dates: string[] = []): Column[] => keys.map((key) => ({ key, ...(numeric.includes(key) ? { kind: 'number' as const } : dates.includes(key) ? { kind: 'date' as const } : {}) }));

/** 허용한 필드만 표·상세에 전달한다. 원본 응답은 저장 조회에 보관하지 않는다. */
export function normalizePage(source: SourceKey, body: unknown, allowMoney = true): DataPage {
  if (source === 'flags') {
    const rows = arr(body).map((item): DataRow => {
      if (!text(item.flagKey) || !Array.isArray(item.sources)) throw new Error(T.malformed);
      const policy = object(item.policy) ? item.policy : null;
      const publication = object(item.publication) ? item.publication : null;
      const links: DataRow['links'] = [];
      if (text(item.featureId) && text(item.version)) links.push({ kind: 'feature', href: '/features/' + encodeURIComponent(item.featureId) + '/' + encodeURIComponent(item.version) + '?tab=flags' });
      if (text(policy?.policyId)) links.push({ kind: 'policy', href: '/policies/' + encodeURIComponent(policy!.policyId) });
      links.push({ kind: 'map', href: '/fleet/map?' + new URLSearchParams({ lens: 'activation', flagKey: item.flagKey }) });
      for (const location of item.sources) if (object(location) && typeof location.url === 'string' && /^https:\/\//.test(location.url)) links.push({ kind: 'source', href: location.url });
      return { id: item.flagKey + '@' + (item.featureId ?? '') + '@' + (item.version ?? ''), values: { flagKey: item.flagKey, featureId: text(item.featureId), version: text(item.version), name: text(item.featureName), policyId: text(policy?.policyId), status: text(policy?.status), revision: number(policy?.revision), controlPoint: text(policy?.controlPoint), sources: item.sources.length, publication: text(publication?.status), confirmed: number(publication?.confirmed), denominator: number(publication?.denominator) }, links };
    });
    return { rows, columns: columns(['flagKey', 'featureId', 'version', 'name', 'policyId', 'status', 'revision', 'controlPoint', 'sources', 'publication', 'confirmed', 'denominator'], ['revision', 'sources', 'confirmed', 'denominator']), total: rows.length, masked: false };
  }
  if (!object(body)) throw new Error(T.malformed);
  const items = arr(body.items);
  if (source === 'refs') {
    const rows = items.map((item): DataRow => {
      if (!text(item.refId)) throw new Error(T.malformed);
      return { id: item.refId, values: { refId: item.refId, name: text(item.nameKo), nameEn: text(item.nameEn), domain: text(item.domain), component: text(item.component), asil: text(item.asilRep), status: text(item.status), evidence: text(item.sizeEvidenceGrade), sourceIds: Array.isArray(item.sourceIds) ? item.sourceIds.filter((id: unknown) => typeof id === 'string').join(', ') : null, subfunctions: number(item.subfunctionCount) }, links: [{ kind: 'ref', href: '/master/feature-db/' + encodeURIComponent(item.refId) }] };
    });
    const total = number(body.total);
    if (total === null || total < rows.length) throw new Error(T.malformed);
    const offset = number(body.offset) ?? 0;
    return { rows, columns: columns(['refId', 'name', 'nameEn', 'domain', 'component', 'asil', 'status', 'evidence', 'sourceIds', 'subfunctions'], ['subfunctions']), total, ...(rows.length && offset + rows.length < total ? { nextOffset: offset + rows.length } : {}), masked: false, ...(text(body.release) ? { release: body.release } : {}) };
  }
  if (source === 'replies') {
    const rows = items.map((item): DataRow => {
      if (!text(item.vin)) throw new Error(T.malformed);
      const last = object(item.last) ? item.last : null;
      const flagKeys = Array.isArray(item.flags) ? item.flags.filter(object).map((flag: any) => text(flag.flagKey)).filter(Boolean) as string[] : [];
      return { id: item.vin, values: { vin: item.vin, name: text(item.label), scope: text(item.scope), link: text(item.link), quality: text(item.quality), publicationId: text(last?.publicationId), kind: text(last?.kind), result: text(last?.result), at: text(last?.at), flagKeys: flagKeys.join(', ') || null }, links: [{ kind: 'vehicle', href: '/fleet/vehicles/' + encodeURIComponent(item.vin) }, ...(text(last?.publicationId) ? [{ kind: 'publication' as const, href: '/deployments/' + encodeURIComponent(last!.publicationId) }] : []), ...flagKeys.map((flagKey) => ({ kind: 'map' as const, href: '/fleet/map?' + new URLSearchParams({ lens: 'activation', flagKey }) }))] };
    });
    return { rows, columns: columns(['vin', 'name', 'link', 'quality', 'result', 'at', 'publicationId', 'kind', 'scope', 'flagKeys'], [], ['at']), total: rows.length, masked: false };
  }
  if (body.view !== 'FULL' && body.view !== 'MM_ONLY') throw new Error(T.malformed);
  const full = body.view === 'FULL' && allowMoney;
  const rows = items.map((item): DataRow => {
    if (!text(item.estId)) throw new Error(T.malformed);
    const totals = object(item.totals) ? item.totals : null;
    return { id: item.estId, values: { estId: item.estId, name: text(item.name), status: text(item.status), features: number(item.featureCount), totalMm: number(totals?.totalMm), ...(full ? { totalCost: number(totals?.totalCost), currency: text(item.currency) } : {}), basis: text(item.basisVersion), updatedAt: text(item.updatedAt) }, links: [{ kind: 'cost', href: '/procurement/sw-cost/' + encodeURIComponent(item.estId) }] };
  });
  return { rows, columns: [...columns(['estId', 'name', 'status', 'features', 'totalMm'], ['features', 'totalMm']), ...(full ? [{ key: 'totalCost', kind: 'money' as const }, { key: 'currency' }] : []), ...columns(['basis', 'updatedAt'], [], ['updatedAt'])], total: rows.length, masked: !full };
}

export function filterRows(rows: DataRow[], filters: Filter[], search: string) {
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter((row) => (!needle || Object.values(row.values).some((value) => value !== null && String(value).toLocaleLowerCase().includes(needle))) && filters.every((filter) => {
    if (!Object.prototype.hasOwnProperty.call(row.values, filter.field)) return false;
    const value = row.values[filter.field];
    if (filter.op === 'empty') return value === null || value === undefined || value === '';
    if (value === null || value === undefined) return false;
    const actual = String(value); const expected = filter.value;
    switch (filter.op) {
      case 'contains': return actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
      case 'eq': return actual === expected;
      case 'neq': return actual !== expected;
      case 'in': return filter.values.includes(actual);
      case 'gte': return expected.trim() !== '' && Number.isFinite(Number(expected)) && typeof value === 'number' && value >= Number(expected);
      case 'lte': return expected.trim() !== '' && Number.isFinite(Number(expected)) && typeof value === 'number' && value <= Number(expected);
      default: return false;
    }
  }));
}

export function conditionSummary(config: Pick<ViewConfig, 'source' | 'search' | 'filters'>) {
  return [T.sourceNames[config.source], ...(config.search.trim() ? [T.search + ': ' + config.search.trim()] : []), ...config.filters.map((filter) => (T.columns[filter.field] ?? filter.field) + ' ' + T.operators[filter.op] + (filter.op === 'empty' ? '' : ' [' + (filter.op === 'in' ? filter.values.join(', ') : filter.value) + ']'))].join('\n');
}

export function validView(value: unknown): value is ViewConfig {
  return object(value) && SOURCES.includes(value.source) && typeof value.search === 'string' && value.search.length <= 500 && Array.isArray(value.columns) && value.columns.length <= 30 && value.columns.every((key: unknown) => typeof key === 'string') && Array.isArray(value.filters) && value.filters.length <= 12 && value.filters.every((filter: any) => object(filter) && typeof filter.id === 'string' && typeof filter.field === 'string' && Object.prototype.hasOwnProperty.call(T.operators, filter.op) && typeof filter.value === 'string' && filter.value.length <= 500 && Array.isArray(filter.values) && filter.values.length <= 200 && filter.values.every((entry: unknown) => typeof entry === 'string'));
}
