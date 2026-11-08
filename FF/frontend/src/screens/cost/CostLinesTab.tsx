// Feature DB 기준 행 중심 목록. 실제 FF Feature 연결은 선택이며 입력과 원천 개정은 별도로 편집한다.
import { useMemo, useState } from 'react';
import { COST_LINE_REVIEW, COST_OWNED, COST_PRIORITIES, type CostLineInputs } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { costActual as A, costLines as T,costReference as R } from '../../copy/cost';
import { AsyncView, Button, DataTable, Drawer, ErrorNote, Field, Panel, whyDisabled } from '../../design';
import { CostReferencePicker } from './CostReferencePicker';
import { CostReferenceEvidence } from './CostReferenceEvidence';
import { RefChip } from '../refdb/common';
import { usePermission } from '../shared';
import { COST_WRITERS, FeatureLinkChip, mm, money, type CostDetailResponse, type CostLineRow } from './common';

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export function CostLinesTab({ d }: { d: CostDetailResponse }) {
  const perm = usePermission(COST_WRITERS);
  const editable = perm.ok && d.project.status === 'DRAFT';
  const why = whyDisabled([!perm.ok, perm.hint], [d.project.status !== 'DRAFT', T.save]);
  const [source,setSource]=useState<CostLineRow|null>(null);
  const [adding, setAdding] = useState(false);
  const [line, setLine] = useState<CostLineRow | null>(null);
  const [actualOf, setActualOf] = useState<CostLineRow | null>(null);
  const approvedEditable = perm.ok && d.project.status === 'APPROVED';
  const actuals = useMemo(() => new Map((d.actuals ?? []).map((row) => [row.refId, row])), [d.actuals]);
  const remove = useApiMutation('costLineRemove', ['costProject', 'costProjects']);
  const results = useMemo(() => new Map((d.result?.lines ?? []).map((r) => [r.refId, r])), [d.result]);
  const full = d.view === 'FULL';
  const columns = [
    { key: 'ref', header: T.cols.ref, cell: (l: CostLineRow) => <span><RefChip id={l.refId} /> {l.ref?.nameKo ?? ''}</span> },
    {key:'feature',header:R.feature,cell:(l:CostLineRow)=>l.featureId && l.version?<FeatureLinkChip featureId={l.featureId} version={l.version}/>:R.referenceOnly,minor:true},
    { key: 'role', header: T.cols.role, cell: (l: CostLineRow) => T.role[l.role], minor: true },
    { key: 'path', header: T.cols.path, cell: (l: CostLineRow) => (results.get(l.refId)?.bundleIncluded ? T.bundled : (results.get(l.refId)?.path ?? '—')) },
    { key: 'qty', header: T.cols.qty, cell: (l: CostLineRow) => l.inputs.qty ?? 0, align: 'right' as const },
    { key: 'change', header: T.cols.change, cell: (l: CostLineRow) => l.inputs.changeType ?? '—', minor: true },
    { key: 'asil', header: T.cols.asil, cell: (l: CostLineRow) => l.inputs.asil ?? l.featureAsil, minor: true },
    { key: 'variants', header: T.cols.variants, cell: (l: CostLineRow) => l.inputs.variants ?? 1, align: 'right' as const, minor: true },
    { key: 'e', header: T.cols.e, cell: (l: CostLineRow) => mm(results.get(l.refId)?.e), align: 'right' as const },
    ...(full ? [{ key: 'labor', header: T.cols.labor, cell: (l: CostLineRow) => money(results.get(l.refId)?.laborKrw, d.project.currency, d.fx), align: 'right' as const }] : []),
    { key: 'actual', header: A.col, cell: (l: CostLineRow) => approvedEditable ? <Button variant="ghost" aria-label={A.title(l.refId)} onClick={() => setActualOf(l)}>{actuals.has(l.refId) ? mm(actuals.get(l.refId)!.actual) : A.enter}</Button> : mm(actuals.get(l.refId)?.actual ?? l.inputs.actual ?? null), align: 'right' as const },
    { key: 'check', header: T.cols.check, cell: (l: CostLineRow) => [results.get(l.refId)?.check, results.get(l.refId)?.prereqCheck].filter(Boolean).join(' · ') || '—', minor: true },
    {key:'actions',header:R.source,cell:(l:CostLineRow)=><span><Button onClick={()=>setSource(l)}>{R.source}</Button>{' '}<Button disabled={!editable} reason={why} onClick={()=>setLine(l)}>{R.edit}</Button>{' '}<Button disabled={!editable || remove.isPending} reason={why} onClick={()=>remove.mutate({params:{estId:d.project.estId,lineNo:String(l.lineNo)}})}>{R.remove}</Button>{l.source?.stale && <span role="status">{R.stale}</span>}</span>},
  ];
  return (
    <div className="ds-stack">
      <div>
        <Button variant="primary" disabled={!editable} reason={why} onClick={() => setAdding(true)}>
          {T.add}
        </Button>
      </div>
      <p className="ds-field__hint">{R.sourceGuide}</p>
      {!d.lines.length && <p className="ds-field__hint">{T.empty}</p>}
      <DataTable<CostLineRow> rows={d.lines} columns={columns} rowKey={l=>String(l.lineNo)} caption={R.title} onOpen={editable?l=>setLine(l):l=>setSource(l)} pageSize={50}/>
      {source && <CostReferenceEvidence d={d} line={source} editable={editable} onClose={()=>setSource(null)}/>}
      <ErrorNote error={remove.error} />
      {adding && <AddDrawer d={d} onClose={() => setAdding(false)} />}
      {line && <LineDrawer d={d} line={line} onClose={() => setLine(null)} />}
      {actualOf && <ActualDrawer d={d} line={actualOf} now={actuals.get(actualOf.refId)?.actual ?? null} override={actuals.get(actualOf.refId)?.override ?? false} onClose={() => setActualOf(null)} />}
    </div>
  );
}

function ActualDrawer({ d, line, now, override, onClose }: { d: CostDetailResponse; line: CostLineRow; now: number | null; override: boolean; onClose: () => void }) {
  const initial = now == null ? '' : String(now);
  const [value, setValue] = useState(initial);
  const put = useApiMutation('costActualPut', ['costProject', 'costCalibration']);
  const save = (actual: number | null) => put.mutate({ params: { estId: d.project.estId, refId: line.refId }, body: { actual } }, { onSuccess: onClose });
  const n = numOrNull(value);
  const valid = n != null && Number.isFinite(n) && n > 0 && n <= 100_000;
  return (
    <Drawer open title={A.title(line.refId)} onClose={onClose} dirty={value !== initial}>
      <form className="ds-stack" onSubmit={(event) => { event.preventDefault(); if (valid) save(n); }}>
        <Field label={A.field} hint={A.hint}>
          <input className="ds-input" type="number" min="0" max="100000" step="any" value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <ErrorNote error={put.error} />
        <div>
          <Button type="submit" variant="primary" disabled={put.isPending || !valid}>{A.save}</Button>{' '}
          <Button disabled={put.isPending || !override} onClick={() => save(null)}>{A.clear}</Button>
        </div>
      </form>
    </Drawer>
  );
}

function AddDrawer({d,onClose}:{d:CostDetailResponse;onClose:()=>void}) {
 const add=useApiMutation('costReferenceAdd',['costProject','costProjects']);
 return <Drawer open title={T.addTitle} onClose={onClose}><CostReferencePicker basisVersion={d.project.basisVersion} excluded={d.lines.map(l=>l.refId)} pending={add.isPending} onChoose={selection=>add.mutate({params:{estId:d.project.estId},body:selection},{onSuccess:onClose})}/><ErrorNote error={add.error}/></Drawer>;
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
