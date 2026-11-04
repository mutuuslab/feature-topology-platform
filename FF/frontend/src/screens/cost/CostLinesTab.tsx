// 기능 목록 탭 — 담은 FF Feature마다 기준 행 줄(대표 먼저). 줄을 열면 입력(엑셀 03 AF~AQ)과 MBD 복잡도 작업(12)을 고친다.
// Feature 담기는 Feature DB에 연결된 FF Feature만(D-COST-9) — 연결 없는 Feature는 서버가 막고 화면은 이유를 보인다.
import { useMemo, useState } from 'react';
import { COST_LINE_REVIEW, COST_OWNED, COST_PRIORITIES, type CostLineInputs } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { costLines as T } from '../../copy/cost';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, Panel, whyDisabled } from '../../design';
import { RefChip } from '../refdb/common';
import { usePermission } from '../shared';
import { COST_WRITERS, FeatureLinkChip, mm, money, type CostDetailResponse, type CostLineRow } from './common';

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export function CostLinesTab({ d }: { d: CostDetailResponse }) {
  const perm = usePermission(COST_WRITERS);
  const editable = perm.ok && d.project.status === 'DRAFT';
  const why = whyDisabled([!perm.ok, perm.hint], [d.project.status !== 'DRAFT', T.save]);
  const [adding, setAdding] = useState(false);
  const [line, setLine] = useState<CostLineRow | null>(null);
  const remove = useApiMutation('costFeatureRemove', ['costProject', 'costProjects']);
  const results = useMemo(() => new Map((d.result?.lines ?? []).map((r) => [r.refId, r])), [d.result]);
  const full = d.view === 'FULL';
  const columns = [
    { key: 'ref', header: T.cols.ref, cell: (l: CostLineRow) => <span><RefChip id={l.refId} /> {l.ref?.nameKo ?? ''}</span> },
    { key: 'role', header: T.cols.role, cell: (l: CostLineRow) => T.role[l.role], minor: true },
    { key: 'path', header: T.cols.path, cell: (l: CostLineRow) => (results.get(l.refId)?.bundleIncluded ? T.bundled : (results.get(l.refId)?.path ?? '—')) },
    { key: 'qty', header: T.cols.qty, cell: (l: CostLineRow) => l.inputs.qty ?? 0, align: 'right' as const },
    { key: 'change', header: T.cols.change, cell: (l: CostLineRow) => l.inputs.changeType ?? '—', minor: true },
    { key: 'asil', header: T.cols.asil, cell: (l: CostLineRow) => l.inputs.asil ?? l.featureAsil, minor: true },
    { key: 'variants', header: T.cols.variants, cell: (l: CostLineRow) => l.inputs.variants ?? 1, align: 'right' as const, minor: true },
    { key: 'e', header: T.cols.e, cell: (l: CostLineRow) => mm(results.get(l.refId)?.e), align: 'right' as const },
    ...(full ? [{ key: 'labor', header: T.cols.labor, cell: (l: CostLineRow) => money(results.get(l.refId)?.laborKrw, d.project.currency, d.fx), align: 'right' as const }] : []),
    { key: 'check', header: T.cols.check, cell: (l: CostLineRow) => [results.get(l.refId)?.check, results.get(l.refId)?.prereqCheck].filter(Boolean).join(' · ') || '—', minor: true },
  ];
  return (
    <div className="ds-stack">
      <div>
        <Button variant="primary" disabled={!editable} reason={why} onClick={() => setAdding(true)}>
          {T.add}
        </Button>
      </div>
      {!d.features.length && <p className="ds-field__hint">{T.empty}</p>}
      {d.features.map((f) => {
        const rows = d.lines.filter((l) => l.featureId === f.featureId && l.version === f.version);
        const title = f.name ?? f.featureId;
        return (
          <Panel
            key={`${f.featureId}@${f.version}`}
            title={title}
            actions={
              <>
                <FeatureLinkChip featureId={f.featureId} version={f.version} />
                <Button disabled={!editable || remove.isPending} reason={why} onClick={() => remove.mutate({ params: { estId: d.project.estId, featureId: f.featureId, version: f.version } })}>
                  {T.remove}
                </Button>
              </>
            }
          >
            <DataTable<CostLineRow> rows={rows} columns={columns} rowKey={(l) => String(l.lineNo)} caption={T.caption(title)} onOpen={editable ? (l) => setLine(l) : undefined} pageSize={50} />
          </Panel>
        );
      })}
      <ErrorNote error={remove.error} />
      {adding && <AddDrawer d={d} onClose={() => setAdding(false)} />}
      {line && <LineDrawer d={d} line={line} onClose={() => setLine(null)} />}
    </div>
  );
}

interface FeatureHit {
  featureId: string;
  version: string;
  name: string;
  lifecycle: string;
  featureRefs?: { refId: string }[];
  featureRefCount?: number;
}

function AddDrawer({ d, onClose }: { d: CostDetailResponse; onClose: () => void }) {
  const [text, setText] = useState('');
  const q = useApi<{ items: FeatureHit[] }>('listFeatures', { query: { q: text.trim() || undefined, latestOnly: 'true', limit: '30' } }, { enabled: text.trim().length >= 2 });
  const add = useApiMutation('costFeatureAdd', ['costProject', 'costProjects']);
  const taken = new Set(d.features.map((f) => `${f.featureId}@${f.version}`));
  const hits = q.data?.items ?? [];
  return (
    <Drawer open title={T.addTitle} onClose={onClose}>
      <div className="ds-stack">
        <Field label={T.search} hint={T.searchHint}>
          <input className="ds-input" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {text.trim().length >= 2 && (
          <AsyncView state={asyncState(q, hits.length === 0)} error={q.error} filtered>
            <ul className="ds-linklist">
              {hits.map((f) => {
                const linked = (f.featureRefCount ?? f.featureRefs?.length ?? 0) > 0;
                const already = taken.has(`${f.featureId}@${f.version}`);
                const why = whyDisabled([!linked, T.noLink], [already, T.pick]);
                return (
                  <li key={`${f.featureId}@${f.version}`}>
                    <FeatureLinkChip featureId={f.featureId} version={f.version} /> {f.name}{' '}
                    <Button disabled={!!why || add.isPending} reason={why} onClick={() => add.mutate({ params: { estId: d.project.estId }, body: { featureId: f.featureId, version: f.version } }, { onSuccess: onClose })}>
                      {T.pick}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </AsyncView>
        )}
        <ErrorNote error={add.error} />
      </div>
    </Drawer>
  );
}

function LineDrawer({ d, line, onClose }: { d: CostDetailResponse; line: CostLineRow; onClose: () => void }) {
  const [v, setV] = useState<CostLineInputs>(line.inputs);
  const items0 = d.mbd.filter((m) => m.refId === line.refId).map((m) => m.counts);
  const [items, setItems] = useState<(number | null)[][]>(items0);
  const save = useApiMutation('costLineUpdate', ['costProject', 'costProjects']);
  const mbd = useApiMutation('costMbdPut', ['costProject', 'costProjects']);
  const set = <K extends keyof CostLineInputs>(k: K, x: CostLineInputs[K]) => setV((o) => ({ ...o, [k]: x }));
  const o = d.options;
  const select = <K extends 'changeType' | 'asil' | 'priority' | 'owned' | 'reviewStatus'>(k: K, label: string, values: readonly string[], hint?: string) => (
    <Field label={label} hint={hint}>
      <select className="ds-select" aria-label={label} value={(v[k] as string | null | undefined) ?? ''} onChange={(e) => set(k, (e.target.value || null) as CostLineInputs[K])}>
        <option value="">{T.none}</option>
        {values.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </Field>
  );
  const num = (k: 'qty' | 'variants' | 'm' | 'o' | 'p' | 'actual', label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input className="ds-input" type="number" min="0" step="any" value={v[k] ?? ''} onChange={(e) => set(k, numOrNull(e.target.value))} />
    </Field>
  );
  return (
    <Drawer open title={T.editTitle(line.refId)} onClose={onClose} dirty={JSON.stringify(v) !== JSON.stringify(line.inputs)}>
      <div className="ds-stack">
        <form
          className="ds-stack"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ params: { estId: d.project.estId, lineNo: String(line.lineNo) }, body: v }, { onSuccess: onClose });
          }}
        >
          <div className="ds-form-grid">
            {num('qty', T.fields.qty)}
            {select('changeType', T.fields.changeType, o.changeTypes)}
            {select('asil', T.fields.asil, o.asil, T.fields.asilHint(line.featureAsil))}
            {num('variants', T.fields.variants)}
            {num('m', T.fields.m, T.fields.directHint)}
            {num('o', T.fields.o)}
            {num('p', T.fields.p)}
            {select('priority', T.fields.priority, COST_PRIORITIES)}
            {select('owned', T.fields.owned, COST_OWNED)}
            {num('actual', T.fields.actual)}
            {select('reviewStatus', T.fields.reviewStatus, COST_LINE_REVIEW)}
          </div>
          <Field label={T.fields.memo}>
            <input className="ds-input" value={v.memo ?? ''} maxLength={500} onChange={(e) => set('memo', e.target.value || null)} />
          </Field>
          <ErrorNote error={save.error} />
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {T.save}
          </Button>
        </form>
        <Panel title={T.mbd}>
          <p className="ds-field__hint">{T.mbdHint}</p>
          {items.map((counts, i) => (
            <div key={i} className="ds-form-grid">
              {T.mbdLevels.map((lv, k) => (
                <Field key={lv} label={lv}>
                  <input className="ds-input" type="number" min="0" step="1" value={counts[k] ?? ''} onChange={(e) => setItems((xs) => xs.map((c, j) => (j === i ? c.map((x, m) => (m === k ? numOrNull(e.target.value) : x)) : c)))} />
                </Field>
              ))}
              <Button onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>{T.mbdRemove}</Button>
            </div>
          ))}
          <div>
            <Button onClick={() => setItems((xs) => [...xs, [null, null, null, null, null]])}>{T.mbdAdd}</Button>{' '}
            <Button variant="primary" disabled={mbd.isPending || JSON.stringify(items) === JSON.stringify(items0)} onClick={() => mbd.mutate({ params: { estId: d.project.estId, refId: line.refId }, body: { items: items.map((counts) => ({ counts })) } })}>
              {T.mbdSave}
            </Button>
          </div>
          <ErrorNote error={mbd.error} />
        </Panel>
      </div>
    </Drawer>
  );
}
