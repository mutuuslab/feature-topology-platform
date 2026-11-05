// Feature 상세 '기준 행' 탭(30-95 §5.3) — 대표·포함 기준 행과 지금 상태, 연결 당시 Feature DB 버전.
// 연결 뒤 발행된 변경이 그 기준 행에 있으면 "v1.4에서 바뀜" — Feature 값은 자동으로 바꾸지 않는다(사람이 확인).
// 안내는 Version 상태를 따른다 — 고칠 수 있는 초안(PROPOSED)만 "초안에서 연결하세요", 확정된 Version은 "새 Version에서"(하네스 리뷰 F12).
// 정의 승인 막힘(요청 중·폐기 행, 연결 없음 — 사용자 결정 2026-11-04)과 출시 뒤 폐기 예정·폐기 행 경고(막지 않음)를 한 줄로 요약한다.
// 기준 행 조회가 실패하면 막힘 여부를 '모름'으로 말한다(숨기면 막힘이 없는 것처럼 읽혔다).
import { useState } from 'react';
import { REF_STATUS_POLICY, type FeatureRefLink, type Lifecycle, type RefStatus } from '@ff/contracts';
import { useQueries } from '@tanstack/react-query';
import { call, isPersonal } from '../../api/client';
import { useApi } from '../../api/hooks';
import { featureRefsTab as T, propose as P } from '../../copy/propose';
import { Button, DataTable, Panel } from '../../design';
import { useAppShell } from '../../store';
import { RefChip, RefStatusBadge } from '../refdb/common';
import { usePermission } from '../shared';
import { RefLinkEditor, type DraftFeature } from './RefLinkEditor';

/** 'v1.10' > 'v1.9' — 발행 버전 비교 */
export function releaseCmp(a: string, b: string): number {
  const n = (v: string) => v.replace(/^v/, '').split('.').map((x) => Number(x) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

interface RefDetailView {
  ref: { refId: string; nameKo: string; nameEn: string; status: RefStatus; replacedBy?: string | null };
}

function useRefDetail(refId: string) {
  return useApi<RefDetailView>('refDetail', { params: { refId } });
}

function RefName({ refId }: { refId: string }) {
  const q = useRefDetail(refId);
  if (q.isError) return <span className="ds-field__hint">{T.unknown}</span>;
  return <span>{q.data?.ref.nameKo ?? '—'}</span>;
}

function RefStatusCell({ refId }: { refId: string }) {
  const q = useRefDetail(refId);
  if (q.isError) return <span className="ds-field__hint" data-ref-status-unknown={refId}>{T.unknown}</span>;
  return q.data ? <RefStatusBadge status={q.data.ref.status} /> : <span>—</span>;
}

/** 연결 뒤 발행된 이 행의 변경 중 가장 최근 버전 */
function ChangedIn({ refId, since }: { refId: string; since: string }) {
  const q = useApi<{ items: { release: string | null; status: string }[] }>('listRefChanges', { query: { refId, status: 'PUBLISHED' } });
  const newer = (q.data?.items ?? []).map((c) => c.release).filter((r): r is string => !!r && releaseCmp(r, since) > 0).sort(releaseCmp);
  const last = newer.at(-1);
  if (q.isError) return <span className="ds-field__hint">{T.unknown}</span>;
  if (!q.data) return <span>—</span>;
  return last ? (
    <span className="ds-tag" data-ref-changed={last}>
      {T.changedIn(last)}
    </span>
  ) : (
    <span className="ds-field__hint">{T.unchanged}</span>
  );
}

/** 고칠 수 있는 초안 — 연결을 바로 바꿀 수 있다 */
const editable = (lc?: Lifecycle | string) => !lc || lc === 'PROPOSED';
/** 출시 쪽 단계 — 폐기 예정·폐기 행은 막지 않고 경고한다(대체 행으로 다음 Version에서) */
const releaseSide = (lc?: Lifecycle | string) => lc === 'VERIFIED' || lc === 'RELEASED';

function BlockNote({ links, lifecycle }: { links: FeatureRefLink[]; lifecycle?: Lifecycle | string }) {
  // 행 칸과 같은 쿼리 키라 다시 부르지 않는다 — 역할마다 응답이 다른 조회(personal)는 키에 역할이 들어간다(api/hooks useApi와 같다)
  const { role } = useAppShell();
  const personal = isPersonal('refDetail');
  const qs = useQueries({
    queries: links.map((l) => ({
      queryKey: personal ? ['refDetail', { refId: l.refId }, {}, role] : ['refDetail', { refId: l.refId }, {}],
      queryFn: ({ signal }: { signal: AbortSignal }) => call<RefDetailView>('refDetail', { params: { refId: l.refId }, signal, ...(personal ? { role } : {}) }),
    })),
  });
  const statuses = qs.flatMap((q) => (q.data ? [q.data.ref] : []));
  if (editable(lifecycle) && statuses.some((r) => REF_STATUS_POLICY[r.status]?.blocksApproval))
    return (
      <p className="ds-field__error" data-testid="ref-blocks-approval">
        {T.blocked}
      </p>
    );
  if (qs.some((q) => q.isError))
    return (
      <p className="ds-field__hint" data-testid="ref-status-unknown">
        {editable(lifecycle) ? T.unknownBlock : T.unknownStatus}
      </p>
    );
  const retired = statuses.filter((r) => r.status === 'DEPRECATED' || r.status === 'RETIRED');
  if (releaseSide(lifecycle) && retired.length)
    return (
      <p className="ds-callout" data-tone="warn" data-testid="ref-retired-warning">
        {T.retiredWarn(retired.map((r) => (r.replacedBy ? `${r.refId} → ${r.replacedBy}` : r.refId)).join(', '))}
      </p>
    );
  return null;
}

/** 초안 연결 바꾸기 — 초안(PROPOSED)이고 Feature를 넘겨받았을 때만. 작성자 역할이 아니면 이유와 함께 막는다 */
function EditLinks({ f, links, lifecycle }: { f?: DraftFeature; links: FeatureRefLink[]; lifecycle?: Lifecycle | string }) {
  const perm = usePermission(['FEATURE_AUTHOR']);
  const [open, setOpen] = useState(false);
  if (!f || !editable(lifecycle)) return null;
  if (open) return <RefLinkEditor f={f} links={links} onClose={() => setOpen(false)} />;
  return (
    <div>
      <Button data-ui="editFeatureRefs" disabled={!perm.ok} reason={perm.hint} onClick={() => setOpen(true)}>
        {links.length ? T.edit.open : T.edit.openNone}
      </Button>
    </div>
  );
}

export function FeatureRefsTab({ links, lifecycle, feature }: { links: FeatureRefLink[]; lifecycle?: Lifecycle | string; feature?: DraftFeature }) {
  if (!links.length)
    return (
      <Panel id="feature-refs">
        {/* 연결이 없는 Feature는 정의 승인이 막힌다(사용자 결정 2026-11-04, REFDB_LINK_BLOCKED) — 이미 승인된 Version은 그대로 */}
        {editable(lifecycle) ? (
          <p className="ds-field__error" data-testid="ref-blocks-approval">
            {T.noneDraft}
          </p>
        ) : (
          <p className="ds-field__hint">{T.noneFixed}</p>
        )}
        <EditLinks f={feature} links={links} lifecycle={lifecycle} />
      </Panel>
    );
  const rows = [...links].sort((a, b) => (a.role === b.role ? 0 : a.role === 'PRIMARY' ? -1 : 1));
  return (
    <Panel id="feature-refs">
      <BlockNote links={rows} lifecycle={lifecycle} />
      <DataTable
        caption={T.caption}
        rows={rows}
        rowKey={(r) => r.refId}
        pageSize={0}
        columns={[
          { key: 'role', header: T.col.role, cell: (r) => <span className="ds-tag">{P.role[r.role]}</span> },
          { key: 'id', header: T.col.refId, cell: (r) => <RefChip id={r.refId} /> },
          { key: 'name', header: T.col.name, cell: (r) => <RefName refId={r.refId} /> },
          { key: 'status', header: T.col.status, cell: (r) => <RefStatusCell refId={r.refId} /> },
          { key: 'ver', header: T.col.refVersion, cell: (r) => <span className="ds-mono">{r.refVersion}</span> },
          { key: 'chg', header: T.col.change, cell: (r) => <ChangedIn refId={r.refId} since={r.refVersion} /> },
        ]}
      />
      <EditLinks f={feature} links={links} lifecycle={lifecycle} />
    </Panel>
  );
}
