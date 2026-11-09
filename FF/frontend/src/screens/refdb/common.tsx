// Feature DB 화면 공통 — 응답 모양, 상태 배지(정책 안내 툴팁), 내 행위자, 내보내기 파일 받기.
// 상태 → 허용 규칙은 contracts REF_STATUS_POLICY 하나(등록 화면·승인 전이·산정 과제와 같은 표).
import { snapshotFile, REF_STATUS_POLICY, type FeatureRefRow, type RefQuality, type RefChangeStatus, type RefChange, type RefCriterionResult, type RefGlossary, type RefRelease, type RefSource, type RefStatus, type RefStatusPolicy, type RefSubfunction, type TaxonomyNode } from '@ff/contracts';
import { useUiLocale } from '../../locale/react';
import { Link } from 'react-router-dom';
import { actorFor } from '../../api/actor';
import { ApiError, pathOf, STATIC_MODE, toApiError, VIEW_ROLES } from '../../api/client';
import { errors as E } from '../../copy/errors';
import { OIDC_AUTH } from '../../auth-mode';
import { useApi } from '../../api/hooks';
import { refStatusText, CHANGE_STATUS_LABEL, featureDb as FD, refDetail as RD, refQualityCopy as QC } from '../../copy/refdb';
import { IdChip, Lozenge, Panel, SummaryLine, VerdictBadge, type LozengeAppearance } from '../../design';
import '../../design/lozenge.css';

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
  /** 요청 중 행의 추가 요청이 승인됐지만 아직 발행 전(P5-3) — 없으면 null */
  awaitingPublish?: { changeId: string; decidedAt: string | null; label: string; hint: string } | null;
}

/** 목록·상세의 변경 요청 — 서버가 발행 대기 여부와 도메인을 붙인다 */
export type RefChangeView = RefChange & { awaitingPublish?: boolean; domain?: string | null };

export interface RefChangeDetailResponse {
  change: RefChangeView;
  checks?: RefCriterionResult[];
  impact?: { features: RefUsage[]; recalcRequired: boolean; recalcFields: string[]; costProjects: {estId:string;name:string;status:string;lineNos:number[];basisVersion:string;refRelease:string|null;recalcRequired:boolean;awaitingPublish:boolean}[] };
  usedBy: RefUsage[];
}

export type RefReleasesResponse = { items: RefRelease[] };

/** 버전 발행 응답 — 발행 기록 + 반영한 요청 */
export interface RefPublishResponse {
  release: RefRelease;
  applied?: unknown[];
  retired?: unknown[];
}

/** 상태 → 배지 무리 — 활성 완료 · 검토 필요 진행 · 폐기 예정 이동 · 폐기 제거 · 요청 중 새것(색은 Lozenge 토큰만) */
const LOOK: Record<RefStatus, LozengeAppearance> = { ACTIVE: 'success', REVIEW: 'moved', DEPRECATED: 'moved', RETIRED: 'removed', PENDING: 'new' };

/**
 * 기준 행 상태 배지 — Feature DB 화면·등록 화면·Feature 상세 '기준 행' 탭이 함께 쓴다(예전에는 색이 다른 두 벌이었다).
 * 이름은 엑셀 BQ 값(contracts REF_STATUS_POLICY), 툴팁은 정책 안내
 */
export function RefStatusBadge({ status }: { status: RefStatus }) {
  useUiLocale();
  const p = REF_STATUS_POLICY[status];
  if (!p) return <Lozenge>{status}</Lozenge>;
  return (
    <span title={refStatusText[status].hint} data-ref-status={status}>
      <Lozenge appearance={LOOK[status]}>{refStatusText[status].label}</Lozenge>
    </span>
  );
}

const CHANGE_VERDICT: Record<RefChangeStatus, string> = { DRAFT: 'UNJUDGED', REVIEW: 'CONDITIONAL', APPROVED: 'CONDITIONAL', REJECTED: 'FAIL', PUBLISHED: 'PASS' };

/** 변경 요청 상태 배지 — 변경 요청 화면과 콘솔 홈 대기열이 함께 쓴다 */
export function ChangeStatusBadge({ status }: { status: RefChangeStatus }) {
  return <VerdictBadge value={CHANGE_VERDICT[status] ?? 'UNJUDGED'} label={CHANGE_STATUS_LABEL[status] ?? status} />;
}

/** 서버 안내(막지 않은 기준 행 경고) — 등록·전이·Release Sign-off·새 Version 응답의 warnings[](backend feature-refs RefWarning) */
export interface RefWarning {
  code: string;
  refId: string;
  message: string;
  status?: string;
  /** 폐기 예정·폐기 행의 대체 기준 행(있으면) */
  replacedBy?: string | null;
}

/** 경고 줄 — 서버 문장 + 대체 행 링크 */
export function RefWarningItems({ warnings }: { warnings: readonly RefWarning[] }) {
  return (
    <ul className="ds-check">
      {warnings.map((w, i) => (
        <li key={`${w.code}-${w.refId}-${i}`} data-state="REVIEW" data-warning={w.code}>
          <span>
            {w.message}
            {w.replacedBy && (
              <span className="ds-check__detail" data-replaced-by={w.replacedBy}>
                {RD.f.replacedBy} <RefChip id={w.replacedBy} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 기준 행 경고 목록 — 일은 끝났고, 사람이 확인할 것만 남긴다(role=status로 읽힌다) */
export function RefWarningList({ warnings, title }: { warnings: readonly RefWarning[] | undefined | null; title: string }) {
  if (!warnings?.length) return null;
  return (
    <section className="ds-callout" data-tone="warn" role="status" aria-label={title} data-testid="ref-warnings">
      <p className="ds-callout__title">{title}</p>
      <RefWarningItems warnings={warnings} />
    </section>
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

/** 화면 역할의 행위자 ID — 직무 분리(요청자·검토자 ≠ 승인자, contracts refChangeDuty) 판단에 쓴다 */
export const myActorId = (role: string) => actorFor(role).id;

/** 정적 공개본의 내보내기 파일 — 스냅샷 이름 규칙에 확장자만 xlsx(tools/snapshot-api.ts가 발행본마다 같은 이름으로 받아 둔다) */
export const staticExportFile = (url: string) => snapshotFile(url).replace(/\.json$/, '.xlsx');

/**
 * 내보내기 파일 받기 — call()은 JSON만 읽으므로 직접 받는다. 금액 열은 서버가 역할로 정하므로 행위자 머리글을 붙인다.
 * 서버가 아직 JSON만 주면(xlsx 준비 전) JSON 파일로 받는다. 정적 공개본은 받아 둔 파일을 내려받는다(2026-11-05).
 */
export async function downloadExport(role: string, release: string | null): Promise<void> {
  const url = pathOf('exportRefdb', {}, { format: 'xlsx', release });
  const a = actorFor(role, VIEW_ROLES.exportRefdb);
  const headers: Record<string, string> = { 'X-Actor-Role': a.role };
  if (!OIDC_AUTH) headers['X-Actor-Id'] = a.id;
  const res = STATIC_MODE ? await fetch(import.meta.env.BASE_URL + staticExportFile(url)) : await fetch(url, { headers });
  // 정적 호스팅은 없는 파일에 SPA 대체 응답(index.html, 200)을 준다 — 받은 파일로 내리지 않는다
  if (STATIC_MODE && (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html'))) throw new ApiError(404, 'NOT_FOUND', E.notInSnapshot);
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
  // 서버 파일 이름(FeatureDB_v1.4.xlsx)과 같게 — 받은 이름이 화면마다 달랐다(P5-11)
  link.download = exportDownloadName(res.headers.get('content-disposition'), release, ext);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

/** 내보내기 받기 이름 — 서버 Content-Disposition의 이름, 없으면 같은 규칙(FeatureDB_<버전>.<확장자>) */
export function exportDownloadName(disposition: string | null, release: string | null, ext: string): string {
  const m = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null;
  return m?.[1] ?? `FeatureDB_${release ?? 'current'}.${ext}`;
}

/** 품질 지표 한 줄 항목 — 발행본 N행(+요청 중 M)·출처 없음·속성 미입력·근거 12개월 경과·규모 근거 D·발행 대기·최신 발행(P5-7·P5-8) */
export function refQualityItems(q: RefQuality): { k: string; v: string | number }[] {
  return [
    { k: QC.key, v: QC.published(q.published, q.pending) },
    { k: FD.q.noSource, v: q.noSource },
    { k: QC.attrMissing, v: q.attrMissing },
    { k: FD.q.stale, v: q.evidenceStale },
    { k: FD.q.gradeD, v: `${(q.sizeGradeDShare * 100).toFixed(1)}%` },
    { k: FD.q.awaiting, v: q.awaitingPublish },
    { k: FD.q.release, v: q.latestRelease ?? '—' },
  ];
}

/** 콘솔 홈의 Feature DB 품질 한 줄(Feature DB 관리 부서) — 응답이 품질 지표 모양일 때만 그린다 */
export function RefQualityPanel() {
  const q = useApi<RefQuality>('refQuality');
  const d = q.data;
  if (!d || typeof d.published !== 'number') return null;
  return (
    <Panel title={QC.title} id="ws-refdb-quality" actions={<Link to="/master/feature-db">{QC.open} →</Link>}>
      <SummaryLine label={QC.title} items={refQualityItems(d)} />
    </Panel>
  );
}
