// 설정 탭 — 엑셀 02_프로젝트설정 1·2·4·5·6절. 작성 중(DRAFT) 과제의 작성 역할만 고친다. 목록 값은 과제가 고정한 계수 표에서 온다.
// 새 계수 표가 발행되었으면 '최신 계수 표로 맞추기'(§6.4). 단가(직접경비)는 금액을 보는 역할에만 서버가 준다.
import { useState } from 'react';
import type { CostSettingsInput } from '@ff/contracts';
import { useApiMutation } from '../../api/hooks';
import { costSettings as T,costReference as R } from '../../copy/cost';
import { Button, ErrorNote, Field, KeyValue, Panel, Select, whyDisabled } from '../../design';
import { usePermission } from '../shared';
import { COST_WRITERS, money, type CostDetailResponse } from './common';

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

export function CostSettingsTab({ d }: { d: CostDetailResponse }) {
  const p = d.project;
  const perm = usePermission(COST_WRITERS);
  const editable = perm.ok && p.status === 'DRAFT';
  const [name, setName] = useState(p.name);
  const [target, setTarget] = useState(p.target);
  const [currency, setCurrency] = useState(p.currency);
  const [s, setS] = useState<CostSettingsInput>(p.settings);
  const save = useApiMutation('costProjectUpdate', ['costProject', 'costProjects']);
  const latest = useApiMutation('costProjectUpdate', ['costProject', 'costProjects']);
  const o = d.options;
  const set = <K extends keyof CostSettingsInput>(k: K, v: CostSettingsInput[K]) => setS((x) => ({ ...x, [k]: v }));
  const expenses = o.directExpenseItems.map((it, i) => s.directExpenses[i] ?? { item: it.item, qty: null, unitPrice: null });
  const setExpense = (i: number, patch: Partial<{ qty: number | null; unitPrice: number | null }>) =>
    set(
      'directExpenses',
      expenses.map((e, k) => (k === i ? { ...e, ...patch } : e)),
    );
  const dirty = name !== p.name || target !== p.target || currency !== p.currency || JSON.stringify(s) !== JSON.stringify(p.settings);
  const why = whyDisabled([!perm.ok, perm.hint], [p.status !== 'DRAFT', T.readOnly], [!dirty, T.save]);
  const sourceStale=p.refRelease!==p.latestRefRelease || d.lines.some(line=>!line.sourceRevision || line.source?.stale);
  const stale = p.basisVersion !== p.latestBasisVersion || sourceStale;
  const full = d.view === 'FULL';
  return (
    <form
      className="ds-stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ params: { estId: p.estId }, body: { name, target, currency, settings: { ...s, directExpenses: full ? expenses : s.directExpenses } } });
      }}
    >
      <p className="ds-field__hint">{T.basis(p.basisVersion, p.refRelease)}</p>
      {stale && (
        <p className="ds-field__hint">
          {sourceStale?R.stale:T.stale(p.latestBasisVersion)}{' '}
          <Button disabled={!editable || latest.isPending} reason={whyDisabled([!editable, T.readOnly])} onClick={() => latest.mutate({ params: { estId: p.estId }, body: { useLatestBasis: true } })}>
            {R.latestSource}
          </Button>
        </p>
      )}
      <ErrorNote error={latest.error} />
      <div className="ds-split">
        <Panel title={T.info}>
          <Field label={T.name}>
            <input className="ds-input" value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </Field>
          <Field label={T.target}>
            <input className="ds-input" value={target} disabled={!editable} onChange={(e) => setTarget(e.target.value)} maxLength={300} />
          </Field>
          <Select label={T.currency} value={currency} disabled={!editable} onChange={(e) => setCurrency(e.target.value)}>
            {o.currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <p className="ds-field__hint">{T.currencyHint}</p>
        </Panel>
        <Panel title={T.estimate}>
          <Select label={T.aace} value={s.aace} disabled={!editable} onChange={(e) => set('aace', e.target.value)}>
            {o.aace.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <Select label={T.confidence} value={s.confidence} disabled={!editable} onChange={(e) => set('confidence', e.target.value)}>
            {o.confidence.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </Panel>
      </div>
      <Panel title={T.rate}>
        <div className="ds-split">
          <div className="ds-stack">
            <Select label={T.rateBasis} value={s.rateBasis} disabled={!editable} onChange={(e) => set('rateBasis', e.target.value as CostSettingsInput['rateBasis'])}>
              {o.rateBases.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <Select label={T.method} value={s.method} disabled={!editable} onChange={(e) => set('method', e.target.value)}>
              {o.methods.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </div>
          <div className="ds-stack">
            <Field label={T.oh} hint={T.rateHint}>
              <input className="ds-input" type="number" step="0.01" min="0" value={s.ohOverride ?? ''} disabled={!editable} onChange={(e) => set('ohOverride', numOrNull(e.target.value))} />
            </Field>
            <Field label={T.fee} hint={T.rateHint}>
              <input className="ds-input" type="number" step="0.01" min="0" value={s.feeOverride ?? ''} disabled={!editable} onChange={(e) => set('feeOverride', numOrNull(e.target.value))} />
            </Field>
          </div>
        </div>
      </Panel>
      <Panel title={T.drivers}>
        <Select label={T.preset} value={s.preset} disabled={!editable} onChange={(e) => set('preset', e.target.value)}>
          {o.presets.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        <p className="ds-field__hint">{T.presetHint}</p>
        <details>
          <summary>{T.drivers}</summary>
          <div className="ds-form-grid">
            {o.drivers.map((dr) => (
              <Select key={dr.key} label={`${dr.key} · ${dr.label}`} value={s.drivers[dr.key] ?? 'N'} disabled={!editable} onChange={(e) => set('drivers', { ...s.drivers, [dr.key]: e.target.value })}>
                {dr.ratings.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            ))}
          </div>
        </details>
      </Panel>
      <Panel title={T.common}>
        <div className="ds-split">
          <fieldset className="ds-choices" aria-label={T.common}>
            {(['pm', 'scm', 'pi'] as const).map((k) => (
              <label key={k}>
                <input type="checkbox" checked={s.common[k]} disabled={!editable} onChange={(e) => set('common', { ...s.common, [k]: e.target.checked })} />
                {T[k]}
              </label>
            ))}
          </fieldset>
          <div className="ds-stack">
            {(['qa', 'fs', 'cs', 'hil'] as const).map((k) => (
              <Field key={k} label={T[k]}>
                <input className="ds-input" type="number" step="0.1" min="0" value={s.common[k] ?? ''} disabled={!editable} onChange={(e) => set('common', { ...s.common, [k]: numOrNull(e.target.value) })} />
              </Field>
            ))}
          </div>
        </div>
      </Panel>
      {full && (
        <Panel title={T.expenses}>
          <KeyValue
            rows={o.directExpenseItems.map((it, i) => ({
              k: `${it.item} (${it.unit})`,
              v: (
                <span className="ds-split">
                  <input className="ds-input" aria-label={`${it.item} ${T.qty}`} type="number" min="0" value={expenses[i].qty ?? ''} disabled={!editable} onChange={(e) => setExpense(i, { qty: numOrNull(e.target.value) })} />
                  <input className="ds-input" aria-label={`${it.item} ${T.unitPrice}`} type="number" min="0" value={expenses[i].unitPrice ?? ''} disabled={!editable} onChange={(e) => setExpense(i, { unitPrice: numOrNull(e.target.value) })} />
                </span>
              ),
              note: money((expenses[i].qty ?? 0) * (expenses[i].unitPrice ?? 0)),
            }))}
          />
        </Panel>
      )}
      <ErrorNote error={save.error} />
      <Button type="submit" variant="primary" disabled={!!why || save.isPending} reason={why}>
        {T.save}
      </Button>
    </form>
  );
}
