// Feature 상세 '기준 행' 탭(30-95 §5.3) — 대표·포함 기준 행과 지금 상태, 연결 당시 Feature DB 버전.
// 연결 뒤 발행된 변경이 그 기준 행에 있으면 "v1.4에서 바뀜" — Feature 값은 자동으로 바꾸지 않는다(사람이 확인).
import { REF_STATUS_POLICY, type FeatureRefLink, type RefStatus } from '@ff/contracts';
import { useQueries } from '@tanstack/react-query';
import { call } from '../../api/client';
import { useApi } from '../../api/hooks';
import { featureRefsTab as T, propose as P } from '../../copy/propose';
import { DataTable, Panel } from '../../design';
import { RefStatusBadge } from '../home/propose/RefStatusBadge';

/** 'v1.10' > 'v1.9' — 발행 버전 비교 */
export function releaseCmp(a: string, b: string): number {
  const n = (v: string) => v.replace(/^v/, '').split('.').map((x) => Number(x) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

interface RefDetailView {
  ref: { refId: string; nameKo: string; nameEn: string; status: RefStatus };
}

function useRefDetail(refId: string) {
  return useApi<RefDetailView>('refDetail', { params: { refId } });
}

function RefName({ refId }: { refId: string }) {
  const q = useRefDetail(refId);
  return <span>{q.data?.ref.nameKo ?? '—'}</span>;
}

function RefStatusCell({ refId }: { refId: string }) {
  const q = useRefDetail(refId);
  return q.data ? <RefStatusBadge status={q.data.ref.status} /> : <span>—</span>;
}

/** 연결 뒤 발행된 이 행의 변경 중 가장 최근 버전 */
function ChangedIn({ refId, since }: { refId: string; since: string }) {
  const q = useApi<{ items: { release: string | null; status: string }[] }>('listRefChanges', { query: { refId, status: 'PUBLISHED' } });
  const newer = (q.data?.items ?? []).map((c) => c.release).filter((r): r is string => !!r && releaseCmp(r, since) > 0).sort(releaseCmp);
  const last = newer.at(-1);
  if (!q.data) return <span>—</span>;
  return last ? (
    <span className="ds-tag" data-ref-changed={last}>
      {T.changedIn(last)}
    </span>
  ) : (
    <span className="ds-field__hint">{T.unchanged}</span>
  );
}

function BlockNote({ links }: { links: FeatureRefLink[] }) {
  // 승인 막힘(요청 중·폐기)은 행마다 상태로 보이고, 여기서는 한 줄 요약만 — 행 칸과 같은 쿼리 키라 다시 부르지 않는다
  const qs = useQueries({
    queries: links.map((l) => ({ queryKey: ['refDetail', { refId: l.refId }, {}], queryFn: ({ signal }: { signal: AbortSignal }) => call<RefDetailView>('refDetail', { params: { refId: l.refId }, signal }) })),
  });
  return qs.some((q) => q.data && REF_STATUS_POLICY[q.data.ref.status]?.blocksApproval) ? (
    <p className="ds-field__error" data-testid="ref-blocks-approval">
      {T.blocked}
    </p>
  ) : null;
}

export function FeatureRefsTab({ links, missing }: { links: FeatureRefLink[]; missing?: string }) {
  if (!links.length)
    return (
      <Panel id="feature-refs">
        <p className="ds-field__hint">{missing ? T.missing : T.none}</p>
      </Panel>
    );
  const rows = [...links].sort((a, b) => (a.role === b.role ? 0 : a.role === 'PRIMARY' ? -1 : 1));
  return (
    <Panel id="feature-refs">
      <BlockNote links={rows} />
      <DataTable
        caption={T.caption}
        rows={rows}
        rowKey={(r) => r.refId}
        pageSize={0}
        columns={[
          { key: 'role', header: T.col.role, cell: (r) => <span className="ds-tag">{P.role[r.role]}</span> },
          { key: 'id', header: T.col.refId, cell: (r) => <span className="ds-mono ds-nowrap">{r.refId}</span> },
          { key: 'name', header: T.col.name, cell: (r) => <RefName refId={r.refId} /> },
          { key: 'status', header: T.col.status, cell: (r) => <RefStatusCell refId={r.refId} /> },
          { key: 'ver', header: T.col.refVersion, cell: (r) => <span className="ds-mono">{r.refVersion}</span> },
          { key: 'chg', header: T.col.change, cell: (r) => <ChangedIn refId={r.refId} since={r.refVersion} /> },
        ]}
      />
    </Panel>
  );
}
