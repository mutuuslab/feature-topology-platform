// 목록 가젯 본문 — 필터 결과·나에게 할당됨·활동 스트림(Jira 가젯과 같은 모양). 필요할 때만 읽는 묶음.
import { useApi } from '../../../api/hooks';
import { dashboard } from '../../../copy/dashboard';
import { useProcedureInbox } from '../../../data/procedureProgress';
import { Lozenge } from '../../../design';
import { useInbox } from '../Inbox';
import type { GadgetBodyProps } from './Dashboard';
import { Avatar, GadgetState, JiraTable, KeyLink, Status, TableFoot, type Column } from './parts';
import { fieldValue, filterRows, SourceData, sourceOf, type FieldKey, type Row } from './sources';

const B = dashboard.board;
const Bd = B.body;
const F = B.fields;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function FilterResults({ gadget }: GadgetBodyProps) {
  const c = gadget.config;
  const src = sourceOf(c.source);
  const wanted = (Array.isArray(c.columns) ? (c.columns as string[]) : ['summary', 'status']).filter((k): k is FieldKey => k !== 'key' && src.columns.includes(k as FieldKey));
  const rowsMax = num(c.rows, 10);
  const sort = (typeof c.sort === 'string' ? c.sort : 'key') as FieldKey;
  const desc = c.order === 'desc';
  const columns: Column<Row>[] = [
    { key: 'key', header: F.key, cell: (r) => <KeyLink to={r.to}>{r.key}</KeyLink> },
    ...wanted.map((k): Column<Row> => ({ key: k, header: F[k], grow: k === 'summary', cell: (r) => (k === 'status' ? <Status value={r.status} /> : <span className={k === 'summary' ? 'jd-summary' : undefined}>{fieldValue(r, k) || '—'}</span>) })),
  ];
  return (
    <SourceData key={src.id} source={src.id}>
      {({ rows, state, error, retry }) => {
        const hit = filterRows(src.id, rows, String(c.status ?? ''), !!c.mine && src.mineFilter);
        const sorted = [...hit].sort((a, b) => fieldValue(a, sort).localeCompare(fieldValue(b, sort), 'ko', { numeric: true }) * (desc ? -1 : 1));
        const shown = sorted.slice(0, rowsMax);
        return (
          <GadgetState state={state} error={error} retry={retry} empty={!hit.length}>
            <JiraTable caption={B.types.filter.title} rows={shown} rowKey={(r) => r.key} columns={columns} />
            <TableFoot shown={shown.length} total={hit.length} to={src.screen} />
          </GadgetState>
        );
      }}
    </SourceData>
  );
}

interface AssignedRow {
  key: string;
  to: string;
  summary: string;
  due: string | null;
  overdue: boolean;
  status: string;
  appearance: 'inprogress' | 'moved' | 'removed';
}

const t10 = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

function Assigned({ gadget, role }: GadgetBodyProps) {
  const inbox = useInbox();
  const proc = useProcedureInbox(role);
  const Q = dashboard.board.mineState;
  const rows: AssignedRow[] = [
    ...inbox.items
      .filter((i) => i.mine)
      .map((i): AssignedRow => ({ key: i.item, to: i.to, summary: i.detail, due: null, overdue: false, status: Q.yes, appearance: 'inprogress' })),
    ...(proc.data?.items ?? []).map(
      (a): AssignedRow => ({
        key: a.activityId,
        to: `/procedures/${encodeURIComponent(a.processId)}`,
        summary: `${a.processName} · ${a.activityName}`,
        due: t10(a.dueAt),
        overdue: a.overdue,
        status: a.kind === 'REVIEW' ? Bd.kind.REVIEW : Bd.kind.TODO,
        appearance: a.overdue ? 'removed' : a.kind === 'REVIEW' ? 'moved' : 'inprogress',
      }),
    ),
  ];
  const max = num(gadget.config.rows, 10);
  const shown = rows.slice(0, max);
  const loading = inbox.loading || proc.status === 'loading' || proc.status === 'idle';
  return (
    <GadgetState state={loading && !rows.length ? 'loading' : inbox.error && !rows.length ? 'error' : 'ready'} error={inbox.error as never} retry={inbox.retry} empty={!rows.length} emptyText={Bd.assignedEmpty}>
      <JiraTable
        caption={B.types.assigned.title}
        rows={shown}
        rowKey={(r) => r.key}
        columns={[
          { key: 'key', header: F.key, cell: (r) => <KeyLink to={r.to}>{r.key}</KeyLink> },
          { key: 'summary', header: F.summary, grow: true, cell: (r) => <span className="jd-summary">{r.summary}</span> },
          { key: 'due', header: F.due, cell: (r) => (r.due ? <span className={r.overdue ? 'jd-overdue' : 'jd-nowrap'}>{r.due}</span> : <span className="jd-muted">{Bd.noDue}</span>) },
          { key: 'status', header: F.status, cell: (r) => <Lozenge appearance={r.appearance}>{r.overdue ? Bd.overdue : r.status}</Lozenge> },
        ]}
      />
      <TableFoot shown={shown.length} total={rows.length} to="/admin/approval" />
    </GadgetState>
  );
}

interface AuditItem {
  id: number;
  at: string;
  actorId: string;
  action: string;
  target: string;
  result: string;
}

/** 날짜 무리 이름 — 오늘·어제·날짜 */
function dayLabel(iso: string, now = new Date()) {
  const d = iso.slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const y = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  return d === today ? Bd.today : d === y ? Bd.yesterday : d;
}

function Activity({ gadget }: GadgetBodyProps) {
  const q = useApi<{ items?: AuditItem[] }>('audit', { query: { limit: 500 } });
  const items = (Array.isArray(q.data?.items) ? q.data!.items! : []).slice(0, num(gadget.config.rows, 10));
  const groups: { day: string; items: AuditItem[] }[] = [];
  for (const it of items) {
    const day = dayLabel(it.at);
    const g = groups.at(-1);
    if (g && g.day === day) g.items.push(it);
    else groups.push({ day, items: [it] });
  }
  return (
    <GadgetState state={q.isPending ? 'loading' : q.isError ? 'error' : 'ready'} error={q.error} retry={() => void q.refetch()} empty={!items.length} emptyText={Bd.activityEmpty}>
      <div className="jd-stream">
        {groups.map((g) => (
          <section key={g.day} aria-label={g.day}>
            <h3 className="jd-stream__day">{g.day}</h3>
            <ul>
              {g.items.map((it) => (
                <li key={it.id}>
                  <Avatar who={it.actorId} />
                  <p>
                    <strong>{it.actorId}</strong> <code className="jd-code">{it.action}</code> <KeyLink to={`/audit?target=${encodeURIComponent(it.target)}`}>{it.target}</KeyLink>
                    {it.result !== 'ALLOWED' && (
                      <>
                        {' '}
                        <Status value={it.result} />
                      </>
                    )}
                    <time dateTime={it.at}>{it.at.slice(11, 16)}</time>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </GadgetState>
  );
}

export default function ListBody(p: GadgetBodyProps) {
  if (p.gadget.type === 'filter') return <FilterResults {...p} />;
  if (p.gadget.type === 'assigned') return <Assigned {...p} />;
  return <Activity {...p} />;
}
