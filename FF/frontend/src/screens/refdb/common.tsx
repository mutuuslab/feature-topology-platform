// Feature DB 화면 공통 — 응답 모양, 상태 배지(정책 안내 툴팁), 내 행위자, 내보내기 파일 받기.
// 상태 → 허용 규칙은 contracts REF_STATUS_POLICY 하나(등록 화면·승인 전이·산정 과제와 같은 표).
import { REF_STATUS_POLICY, type FeatureRefRow, type RefChange, type RefCriterionResult, type RefGlossary, type RefRelease, type RefSource, type RefStatus, type RefStatusPolicy, type RefSubfunction, type TaxonomyNode } from '@ff/contracts';
import { Link } from 'react-router-dom';
import { actorFor } from '../../api/actor';
import { pathOf, toApiError, type ApiError } from '../../api/client';
import { OIDC_AUTH } from '../../auth-mode';
import { IdChip, VerdictBadge } from '../../design';

/** 목록·상세 응답의 기준 행 — 금액 필드(벤치마크 €)는 서버가 산정 역할에만 준다 */
export type RefRowView = Omit<FeatureRefRow, 'benchmarkEur' | 'kearneyNote'> & Partial<Pick<FeatureRefRow, 'benchmarkEur' | 'kearneyNote'>>;

export interface RefListResponse {
  items: (RefRowView & { subfunctionCount?: number })[];
  total: number;
  offset: number;
  limit: number;
  /** 패싯 — 도메인·컴포넌트·상태별 수(검색 결과 기준) */
  facets?: Record<string, unknown>;
  /** 지금 발행 버전(없으면 null) */
  release?: string | null;
}

/** 변경 요청 상세의 연결 색인(feature_ref_link) 한 줄 */
export interface RefUsage {
  featureId: string;
  version: string;
  refId?: string;
  role: 'PRIMARY' | 'INCLUDED';
  refVersion: string;
  /** 상세·영향 응답은 Feature 이름·상태·적용 범위를 함께 준다 */
  name?: string | null;
  lifecycle?: string | null;
  country?: string | null;
  vehicleModel?: string | null;
  trim?: string | null;
  ownerId?: string | null;
}

/** 상세 응답의 상태 정책 — contracts REF_STATUS_POLICY 값 + 대체 행 요약 */
export type RefDetailPolicy = RefStatusPolicy & { status: RefStatus; replacedBy: { refId: string; nameKo: string; status: RefStatus } | null };

export interface RefDetailResponse {
  ref: RefRowView;
  taxonomy?: { domain: TaxonomyNode | null; cluster: TaxonomyNode | null; component: TaxonomyNode | null };
  /** 출처 ID마다 출처 표 행(표에 없으면 source null) */
  sources?: { sourceId: string; source: RefSource | null }[];
  glossary?: RefGlossary[];
  subfunctions: RefSubfunction[];
  usedBy: RefUsage[];
  policy?: RefDetailPolicy;
}

/** 목록·상세의 변경 요청 — 서버가 발행 대기 여부와 도메인을 붙인다 */
export type RefChangeView = RefChange & { awaitingPublish?: boolean; domain?: string | null };

export interface RefChangeDetailResponse {
  change: RefChangeView;
  checks?: RefCriterionResult[];
  impact?: { features: RefUsage[]; recalcRequired: boolean; recalcFields: string[]; costProjects: unknown[] };
  usedBy: RefUsage[];
}

export type RefReleasesResponse = { items: RefRelease[] };

/** 버전 발행 응답 — 발행 기록 + 반영한 요청 */
export interface RefPublishResponse {
  release: RefRelease;
  applied?: unknown[];
  retired?: unknown[];
}

/** 상태 → 판정 색(활성 PASS · 경고 CONDITIONAL · 막힘 FAIL) */
const VERDICT: Record<RefStatus, string> = { ACTIVE: 'PASS', REVIEW: 'CONDITIONAL', DEPRECATED: 'CONDITIONAL', PENDING: 'CONDITIONAL', RETIRED: 'FAIL' };

/** 상태 배지 — 이름은 엑셀 BQ 값, 툴팁은 정책 안내 */
export function RefStatusBadge({ status }: { status: RefStatus }) {
  const p = REF_STATUS_POLICY[status];
  if (!p) return <span className="ds-mono">{status}</span>;
  return (
    <span title={p.hint} data-ref-status={status}>
      <VerdictBadge value={VERDICT[status]} label={p.ko} />
    </span>
  );
}

export const refPath = (refId: string) => `/master/feature-db/${encodeURIComponent(refId)}`;
export const changePath = (id: string) => `/master/feature-db/changes/${encodeURIComponent(id)}`;

/** 기준 행 ID 칩 — 상세로 가는 링크 */
export function RefChip({ id }: { id: string }) {
  return <IdChip id={id} to={refPath(id)} copy={false} />;
}

export function RefChips({ ids }: { ids: readonly string[] }) {
  if (!ids.length) return <>—</>;
  return (
    <span className="ds-chips">
      {ids.map((id) => (
        <RefChip key={id} id={id} />
      ))}
    </span>
  );
}

/** 이 기준 행을 쓰는 Feature 링크 */
export function FeatureLink({ u }: { u: Pick<RefUsage, 'featureId' | 'version'> }) {
  return <IdChip id={u.featureId} version={u.version} to={`/features/${encodeURIComponent(u.featureId)}/${encodeURIComponent(u.version)}`} />;
}

export function TextLink({ to, children }: { to: string; children: string }) {
  return (
    <Link className="ds-btn" to={to}>
      {children}
    </Link>
  );
}

/** 화면 역할의 행위자 ID — 직무 분리(SOD-13·14) 판단에 쓴다 */
export const myActorId = (role: string) => actorFor(role).id;

/**
 * 내보내기 파일 받기 — call()은 JSON만 읽으므로 직접 받는다. 금액 열은 서버가 역할로 정하므로 행위자 머리글을 붙인다.
 * 서버가 아직 JSON만 주면(xlsx 준비 전) JSON 파일로 받는다.
 */
export async function downloadExport(role: string, release: string | null): Promise<void> {
  const url = pathOf('exportRefdb', {}, { format: 'xlsx', release });
  const a = actorFor(role);
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
  const type = res.headers.get('content-type') ?? '';
  const blob = await res.blob();
  const ext = type.includes('json') ? 'json' : 'xlsx';
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `feature-db-${release ?? 'latest'}.${ext}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}
