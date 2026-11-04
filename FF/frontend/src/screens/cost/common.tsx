// SW 개발비 산정 화면 공통 — 응답 모양, 금액 표시(과제 통화, D-COST-10), 상태 배지, 엑셀 내보내기 받기.
// 금액은 서버가 산정 역할에만 준다(view FULL) — 응답에 금액 필드가 없으면 그리지 않는다.
import type { CostCheckStatus, CostEstimate, CostLineInputs, CostProjectStatus, CostSettingsInput, RefStatus } from '@ff/contracts';
import { Link } from 'react-router-dom';
import { actorFor } from '../../api/actor';
import { pathOf, toApiError, type ApiError } from '../../api/client';
import { OIDC_AUTH } from '../../auth-mode';
import { COST_STATUS_LABEL, COST_STATUS_TONE } from '../../copy/cost';
import { IdChip, VerdictBadge } from '../../design';

export const COST_WRITERS = ['COST_ESTIMATOR'] as const;
export const COST_APPROVERS = ['COST_APPROVER'] as const;
export const COST_CHECKERS = ['COST_ESTIMATOR', 'COST_APPROVER'] as const;
export const COST_MONEY = ['COST_ESTIMATOR', 'COST_APPROVER', 'COST_VIEWER', 'COST_BASIS_ADMIN'] as const;

export type CostView = 'FULL' | 'MM_ONLY';

export interface CostListItem {
  estId: string;
  name: string;
  target: string;
  status: CostProjectStatus;
  currency: string;
  basisVersion: string;
  basisStale: boolean;
  featureCount: number;
  totals: { totalMm: number; totalCost?: number } | null;
  createdBy: string;
  updatedAt: string;
}
export interface CostListResponse {
  items: CostListItem[];
  view: CostView;
}

/** 서버 결과 — FULL은 엔진 결과 그대로, MM_ONLY는 금액 필드가 빠진 부분 */
export type CostResult = Partial<CostEstimate> & Pick<CostEstimate, 'lines' | 'counts' | 'sizeEvidenceShare'> & { view: CostView; totals: Partial<CostEstimate['totals']> & Pick<CostEstimate['totals'], 'eFeat' | 'totalMm'> };

export interface CostLineRow {
  lineNo: number;
  featureId: string;
  version: string;
  refId: string;
  role: 'PRIMARY' | 'INCLUDED';
  featureAsil: string;
  inputs: CostLineInputs;
  refStatus: RefStatus | null;
  refKnown: boolean;
  ref: { nameKo: string; component: string; tshirt: string; asilRep: string } | null;
}

export interface CostCheckItem {
  no: number;
  category: string;
  item: string;
  method: string;
  source: string;
  purchaseKey: boolean;
  status: CostCheckStatus;
  memo: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface CostDetailResponse {
  project: {
    estId: string;
    name: string;
    target: string;
    currency: string;
    settings: CostSettingsInput;
    basisVersion: string;
    refRelease: string | null;
    rev: number;
    lastReason: string | null;
    status: CostProjectStatus;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    latestBasisVersion: string;
    latestRefRelease: string | null;
  };
  lines: CostLineRow[];
  features: { featureId: string; version: string; name: string | null; asil: string; lifecycle: string | null }[];
  mbd: { refId: string; seq: number; counts: (number | null)[] }[];
  checks: { items: CostCheckItem[]; rate: number | null; open: number; unchecked: number };
  result: CostResult | null;
  error: string | null;
  approvals: { rev: number; approvedBy: string; approvedAt: string; reason: string; basisVersion: string; resultSha256: string }[];
  options: {
    aace: string[];
    confidence: string[];
    presets: string[];
    methods: string[];
    rateBases: string[];
    drivers: { key: string; label: string; ratings: string[] }[];
    changeTypes: string[];
    asil: string[];
    currencies: string[];
    directExpenseItems: { item: string; unit: string }[];
  };
  fx?: number | null;
  view: CostView;
}

export const costPath = (estId: string) => `/procurement/sw-cost/${encodeURIComponent(estId)}`;

export function CostChip({ id }: { id: string }) {
  return <IdChip id={id} to={costPath(id)} copy={false} />;
}

export function CostStatusBadge({ status }: { status: CostProjectStatus }) {
  const v = { neutral: 'UNJUDGED', warn: 'PENDING', ok: 'PASS' } as const;
  return <VerdictBadge value={v[COST_STATUS_TONE[status]]} label={COST_STATUS_LABEL[status]} />;
}

const nf = (digits: number) => new Intl.NumberFormat('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 공수 — M/M 소수 둘째 자리 */
export const mm = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : nf(2).format(x));
/** 비율 — % 소수 첫째 자리 */
export const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `${nf(1).format(x * 100)}%`);

/** 금액(원 → 과제 통화). 원화는 원 단위, 다른 통화는 환율로 나눠 통화 코드와 함께 */
export function money(krw: number | null | undefined, currency = 'KRW', fx: number | null | undefined = 1): string {
  if (krw == null || !Number.isFinite(krw)) return '—';
  if (currency === 'KRW' || !fx) return `${nf(0).format(krw)}원`;
  return `${currency} ${nf(0).format(krw / fx)}`;
}

/** 핵심 메시지 큰 숫자 — 원화는 백만원, 다른 통화는 천 단위 */
export function moneyKey(krw: number, currency = 'KRW', fx: number | null | undefined = 1): { value: string; unit: string } {
  if (currency === 'KRW' || !fx) return { value: nf(1).format(krw / 1e6), unit: '백만원' };
  return { value: nf(1).format(krw / fx / 1e3), unit: `천 ${currency}` };
}

/** 엑셀 내보내기 받기 — call()은 JSON만 읽으므로 직접 받는다. 경고는 머리글(X-Cost-Export-Warnings) */
export async function downloadCostExport(role: string, estId: string): Promise<string[]> {
  const url = pathOf('costExport', { estId });
  const a = actorFor(role, COST_MONEY);
  const headers: Record<string, string> = { 'X-Actor-Role': a.role };
  if (!OIDC_AUTH) headers['X-Actor-Id'] = a.id;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    throw toApiError(res, data) as ApiError;
  }
  const warnings = JSON.parse(decodeURIComponent(res.headers.get('x-cost-export-warnings') ?? '%5B%5D')) as string[];
  const href = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = `SW_cost_${estId}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  return warnings;
}

export function FeatureLinkChip({ featureId, version }: { featureId: string; version: string }) {
  return <IdChip id={featureId} version={version} to={`/features/${encodeURIComponent(featureId)}/${encodeURIComponent(version)}`} />;
}

export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link className="ds-btn" to={to}>
      {children}
    </Link>
  );
}
