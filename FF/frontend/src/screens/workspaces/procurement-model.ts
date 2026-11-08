import type { CostListItem, CostListResponse } from '../cost/common';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const statuses = new Set(['DRAFT', 'SUBMITTED', 'APPROVED']);

/** The list API returns totalCost in KRW, even when the project display currency is USD/EUR.
 * Conversion needs the project's basis FX, which this API intentionally does not expose. */
export function costHomeSummary(value: unknown) {
  if (!record(value) || !['FULL', 'MM_ONLY'].includes(String(value.view)) || !Array.isArray(value.items)) return null;
  if (!value.items.every((p) => record(p) && typeof p.estId === 'string' && typeof p.name === 'string' && statuses.has(String(p.status)) && typeof p.createdBy === 'string')) return null;
  const data = value as unknown as CostListResponse;
  const approved = data.items.filter((p) => p.status === 'APPROVED');
  const mmValid = (p: CostListItem) => validNumber(p.totals?.totalMm);
  const moneyValid = (p: CostListItem) => mmValid(p) && validNumber(p.totals?.totalCost);
  const knownMm = approved.filter(mmValid);
  const knownMoney = data.view === 'FULL' ? approved.filter(moneyValid) : [];
  const mmSum = knownMm.reduce((n, p) => n + p.totals!.totalMm, 0);
  const moneySum = knownMoney.reduce((n, p) => n + p.totals!.totalCost!, 0);
  return {
    items: data.items,
    view: data.view,
    approved: approved.length,
    drafts: data.items.filter((p) => p.status === 'DRAFT'),
    submitted: data.items.filter((p) => p.status === 'SUBMITTED'),
    // A successful empty list is zero; missing calculation results are unknown, never zero.
    approvedMm: (!approved.length || knownMm.length) && Number.isFinite(mmSum) ? mmSum : null,
    approvedKrw: data.view === 'FULL' && (!approved.length || knownMoney.length) && Number.isFinite(moneySum) ? moneySum : null,
    incomplete: approved.filter((p) => data.view === 'FULL' ? !moneyValid(p) : !mmValid(p)).length,
  };
}

export interface SupplierDelivery {
  supplier: string;
  swId: string;
  version: string;
}

/** A delivery is an IF-08 record, not an approval or accepted handover. */
export function supplierHomeGroups(value: unknown) {
  if (!record(value) || !Array.isArray(value.items) || !value.items.every((r) => record(r) && typeof r.supplier === 'string' && typeof r.swId === 'string' && typeof r.version === 'string')) return null;
  const groups = new Map<string, number>();
  for (const row of value.items as SupplierDelivery[]) groups.set(row.supplier, (groups.get(row.supplier) ?? 0) + 1);
  return [...groups].map(([supplier, count]) => ({ supplier, count })).sort((a, b) => b.count - a.count || a.supplier.localeCompare(b.supplier, 'ko'));
}
