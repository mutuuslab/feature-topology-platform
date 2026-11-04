// /procurement/sw-cost/basis — 계수·단가 표 버전(D-COST-8). 목록은 모두, 표 내용(단가)은 산정 역할만(서버가 403).
// 원가 기준 관리자는 최신 발행 표를 복사해 자주 바뀌는 값(사내 단가·월 환산 일수·환율·부가세·공통 비율)을 고친 초안을 만들고 발행한다.
// 발행해도 승인된 과제의 결과는 그대로 — 작성 중 과제는 '최신 계수 표로 맞추기'로 옮긴다.
import { useState } from 'react';
import type { CostBasis } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { costBasis as T } from '../../copy/cost';
import { AsyncView, Button, DataTable, DiffView, Drawer, ErrorNote, Field, KeyValue, PageHeader, Panel, whyDisabled } from '../../design';
import { usePermission, when } from '../shared';
import { BackLink, COST_MONEY, money, pct } from './common';

interface BasisMeta {
  version: string;
  status: 'DRAFT' | 'PUBLISHED';
  note: string;
  createdBy: string;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
}
interface BasisDetail {
  version: string;
  status: string;
  note: string;
  basis: CostBasis;
}

const ADMIN = ['COST_BASIS_ADMIN'] as const;

/** 잎 값 펼치기 — 경로 → 값(차이 표용) */
function flatten(x: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = x;
  return out;
}

export function CostBasisScreen() {
  const list = useApi<{ items: BasisMeta[]; latest: string | null }>('costBasisList');
  const money$ = usePermission(COST_MONEY);
  const admin = usePermission(ADMIN);
  const items = list.data?.items ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const version = picked ?? list.data?.latest ?? null;
  const prev = version ? items[items.findIndex((i) => i.version === version) + 1]?.version ?? null : null;
  const [drafting, setDrafting] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  return (
    <div className="ds-screen">
      <PageHeader
        codes="D07-01 · COST BASIS"
        title={T.title}
        lead={T.lead}
        message={list.data ? { tone: 'neutral', value: items.length, text: `${T.key} ${list.data.latest ?? '—'}` } : { tone: 'neutral', text: T.title }}
        actions={
          <>
            <BackLink to="/procurement/sw-cost">{T.back}</BackLink>
            <Button variant="primary" disabled={!admin.ok || !list.data?.latest} reason={whyDisabled([!admin.ok, admin.hint])} onClick={() => setDrafting(true)}>
              {T.draft}
            </Button>
          </>
        }
      />
      <AsyncView state={asyncState(list, items.length === 0)} error={list.error} onRetry={() => list.refetch()}>
        <DataTable
          rows={items}
          rowKey={(i) => i.version}
          caption={T.caption}
          onOpen={(i) => setPicked(i.version)}
          columns={[
            { key: 'version', header: T.cols.version, cell: (i) => (i.version === version ? <b>{i.version}</b> : i.version) },
            { key: 'status', header: T.cols.status, cell: (i) => T.status[i.status] ?? i.status },
            { key: 'note', header: T.cols.note, cell: (i) => i.note },
            { key: 'created', header: T.cols.created, cell: (i) => `${i.createdBy} · ${when(i.createdAt)}`, minor: true },
            {
              key: 'published',
              header: T.cols.published,
              cell: (i) =>
                i.status === 'PUBLISHED' ? (
                  `${i.publishedBy ?? ''} · ${when(i.publishedAt)}`
                ) : (
                  <Button disabled={!admin.ok} reason={whyDisabled([!admin.ok, admin.hint])} onClick={() => setPublishing(i.version)}>
                    {T.publish}
                  </Button>
                ),
            },
          ]}
        />
        {version && (money$.ok ? <BasisContent version={version} prev={prev} /> : <p className="ds-field__hint">{T.moneyOnly}</p>)}
      </AsyncView>
      {drafting && list.data?.latest && <DraftDrawer from={list.data.latest} onClose={() => setDrafting(false)} />}
      {publishing && <PublishDrawer version={publishing} onClose={() => setPublishing(null)} />}
    </div>
  );
}

function BasisContent({ version, prev }: { version: string; prev: string | null }) {
  const q = useApi<BasisDetail>('costBasis', { params: { version } });
  const p = useApi<BasisDetail>('costBasis', { params: { version: prev ?? '' } }, { enabled: !!prev });
  const b = q.data?.basis;
  const diff = (() => {
    if (!b || !p.data) return null;
    const a = flatten(b);
    const z = flatten(p.data.basis);
    return [...new Set([...Object.keys(a), ...Object.keys(z)])]
      .filter((k) => k !== 'version' && !k.startsWith('source') && JSON.stringify(a[k]) !== JSON.stringify(z[k]))
      .map((k) => ({ field: k, before: z[k], after: a[k] }));
  })();
  return (
    <AsyncView state={asyncState(q)} error={q.error} onRetry={() => q.refetch()}>
      {b && (
        <div className="ds-stack">
          <div className="ds-split">
            <Panel title={`${T.detail(version)} · ${T.misc}`}>
              <KeyValue
                rows={[
                  { k: T.miscRows.daysPerMonth, v: b.rates.daysPerMonth },
                  { k: T.miscRows.vat, v: pct(b.vat) },
                  { k: T.miscRows.fx, v: b.benchmark.fx.toLocaleString('ko-KR') },
                  { k: T.miscRows.anchor, v: `€ ${b.benchmark.anchorEur.toLocaleString('ko-KR')}` },
                  { k: T.miscRows.pm, v: pct(b.commonPct.pm) },
                  { k: T.miscRows.scm, v: pct(b.commonPct.scm) },
                  { k: T.miscRows.pi, v: pct(b.commonPct.pi) },
                  { k: T.miscRows.checklist, v: b.checklist.length },
                ]}
              />
            </Panel>
            <Panel title={T.kosa}>
              <DataTable
                rows={Object.entries(b.rates.kosa).map(([job, r]) => ({ job, ...r }))}
                rowKey={(r) => r.job}
                caption={T.kosa}
                columns={[
                  { key: 'job', header: T.kosaCols.job, cell: (r) => r.job },
                  { key: 'daily', header: T.kosaCols.daily, cell: (r) => money(r.daily), align: 'right' },
                  { key: 'monthly', header: T.kosaCols.monthly, cell: (r) => money(r.monthly), align: 'right' },
                ]}
              />
            </Panel>
          </div>
          <Panel title={T.roles}>
            <DataTable
              rows={b.rates.roles}
              rowKey={(r) => r.role}
              caption={T.roles}
              columns={[
                { key: 'role', header: T.rolesCols.role, cell: (r) => r.role },
                { key: 'kosa', header: T.rolesCols.kosa, cell: (r) => r.kosaJob },
                { key: 'grade', header: T.rolesCols.grade, cell: (r) => r.engineeringGrade, minor: true },
                { key: 'inhouse', header: T.rolesCols.inhouse, cell: (r) => money(r.inhouseMonthly), align: 'right' },
              ]}
            />
          </Panel>
          {prev && diff && (
            <Panel title={T.diff(version, prev)}>
              <DiffView rows={diff} />
            </Panel>
          )}
        </div>
      )}
    </AsyncView>
  );
}

function DraftDrawer({ from, onClose }: { from: string; onClose: () => void }) {
  const q = useApi<BasisDetail>('costBasis', { params: { version: from } });
  const draft = useApiMutation('costBasisDraft', ['costBasisList']);
  const [version, setVersion] = useState('');
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState<Record<string, string>>({});
  const b = q.data?.basis;
  const val = (k: string, now: number | null) => edit[k] ?? (now == null ? '' : String(now));
  const num = (k: string, now: number | null) => {
    const s = val(k, now).trim();
    return s === '' ? null : Number(s);
  };
  const why = whyDisabled([!version.trim(), T.draftVersion], [note.trim().length < 2, T.draftNote]);
  const fields: [string, string, number | null][] = b
    ? [
        ['daysPerMonth', T.miscRows.daysPerMonth, b.rates.daysPerMonth],
        ['vat', T.miscRows.vat, b.vat],
        ['fx', T.miscRows.fx, b.benchmark.fx],
        ['pm', T.miscRows.pm, b.commonPct.pm],
        ['scm', T.miscRows.scm, b.commonPct.scm],
        ['pi', T.miscRows.pi, b.commonPct.pi],
        ...b.rates.roles.map((r): [string, string, number | null] => [`inhouse:${r.role}`, `${T.rolesCols.inhouse} · ${r.role}`, r.inhouseMonthly]),
      ]
    : [];
  return (
    <Drawer open title={T.draftTitle} onClose={onClose} dirty={!!version || !!note || Object.keys(edit).length > 0}>
      <AsyncView state={asyncState(q)} error={q.error}>
        {b && (
          <form
            className="ds-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const fx = num('fx', b.benchmark.fx)!;
              const next: CostBasis = {
                ...b,
                version: version.trim(),
                vat: num('vat', b.vat)!,
                benchmark: { ...b.benchmark, fx },
                currencies: { ...b.currencies, EUR: fx },
                commonPct: { pm: num('pm', b.commonPct.pm)!, scm: num('scm', b.commonPct.scm)!, pi: num('pi', b.commonPct.pi)! },
                rates: { ...b.rates, daysPerMonth: num('daysPerMonth', b.rates.daysPerMonth)!, roles: b.rates.roles.map((r) => ({ ...r, inhouseMonthly: num(`inhouse:${r.role}`, r.inhouseMonthly) })) },
              };
              draft.mutate({ body: { basis: next, note: note.trim() } }, { onSuccess: onClose });
            }}
          >
            <p className="ds-field__hint">{T.draftFrom(from)}</p>
            <Field label={T.draftVersion}>
              <input className="ds-input ds-input--mono" value={version} onChange={(e) => setVersion(e.target.value)} maxLength={40} />
            </Field>
            <div className="ds-form-grid">
              {fields.map(([k, label, now]) => (
                <Field key={k} label={label}>
                  <input className="ds-input" type="number" step="any" min="0" value={val(k, now)} onChange={(e) => setEdit((x) => ({ ...x, [k]: e.target.value }))} />
                </Field>
              ))}
            </div>
            <Field label={T.draftNote}>
              <textarea className="ds-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </Field>
            <ErrorNote error={draft.error} />
            <Button type="submit" variant="primary" disabled={!!why || draft.isPending} reason={why}>
              {T.draftSave}
            </Button>
          </form>
        )}
      </AsyncView>
    </Drawer>
  );
}

function PublishDrawer({ version, onClose }: { version: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const m = useApiMutation('costBasisPublish', ['costBasisList', 'costProjects', 'costProject']);
  const why = whyDisabled([reason.trim().length < 2, T.publishReason]);
  return (
    <Drawer open title={T.publishTitle(version)} onClose={onClose} dirty={!!reason}>
      <form
        className="ds-stack"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate({ params: { version }, body: { reason: reason.trim() } }, { onSuccess: onClose });
        }}
      >
        <Field label={T.publishReason}>
          <textarea className="ds-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <ErrorNote error={m.error} />
        <Button type="submit" variant="primary" disabled={!!why || m.isPending} reason={why}>
          {T.publish}
        </Button>
      </form>
    </Drawer>
  );
}
