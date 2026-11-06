// /master/reference-values — 차종·판매국 기준 값 (D02-01, 출시 준비 RD-OPS-03). 판매국·지역·차종·트림은 설치마다 등록한다 —
// 데모 데이터셋 값은 시드(origin SEED)일 뿐이고 고객 설치는 빈 목록에서 시작한다. 쓰인 값은 지우지 않고 사용 중지만 한다.
import { useState } from 'react';
import { REFERENCE_KINDS, REFERENCE_PARENT, referenceCodes, type ReferenceKind, type ReferenceValue } from '@ff/contracts';
import { asyncState, useApi, useApiMutation } from '../../api/hooks';
import { reference as R } from '../../copy/privacy';
import { AsyncView, Button, DataTable, ErrorNote, Field, PageHeader, Panel, Select } from '../../design';
import { usePermission, when } from '../shared';

const keyOf = (v: Pick<ReferenceValue, 'kind' | 'code' | 'parent'>) => `${v.kind}|${v.parent ?? ''}|${v.code}`;

export function ReferenceValuesScreen() {
  const q = useApi<{ items: ReferenceValue[] }>('referenceValues');
  const items = q.data?.items ?? [];
  const active = items.filter((v) => v.status === 'ACTIVE').length;
  return (
    <div className="ds-screen">
      <PageHeader codes="D02-01 · RD-OPS-03" title={R.title} lead={R.lead} message={{ tone: 'neutral', value: q.data ? active : '—', text: R.key }} />
      <p className="ds-field__hint">{R.vehicleNote}</p>
      <AsyncView state={asyncState(q, items.length === 0)} empty={{ title: R.empty }} error={q.error} onRetry={() => q.refetch()}>
        <div className="ds-split">
          {REFERENCE_KINDS.map((kind) => (
            <KindTable key={kind} kind={kind} rows={items.filter((v) => v.kind === kind)} />
          ))}
        </div>
      </AsyncView>
      <div className="ds-split">
        <AddForm values={items} />
        <RetireForm values={items} />
      </div>
    </div>
  );
}

function KindTable({ kind, rows }: { kind: ReferenceKind; rows: ReferenceValue[] }) {
  const C = R.col;
  return (
    <Panel title={R.kinds[kind]} id={`ref-${kind.toLowerCase()}`} eyebrow={String(rows.length)}>
      <DataTable
        caption={R.kinds[kind]}
        rows={rows}
        rowKey={(r: ReferenceValue) => keyOf(r)}
        maxHeight="40vh"
        columns={[
          { key: 'c', header: C.code, cell: (r) => <span className="ds-mono ds-nowrap">{r.code}</span> },
          { key: 'l', header: C.label, cell: (r) => r.label },
          ...(REFERENCE_PARENT[kind] ? [{ key: 'p', header: C.parent, cell: (r: ReferenceValue) => <span className="ds-mono">{r.parent ?? '—'}</span> }] : []),
          { key: 'o', header: C.origin, cell: (r) => R.origin[r.origin] ?? r.origin },
          { key: 's', header: C.status, cell: (r) => R.status[r.status] ?? r.status },
          { key: 'a', header: C.at, cell: (r) => <span className="ds-mono ds-nowrap" title={r.createdBy}>{when(r.createdAt)}</span> },
        ]}
      />
    </Panel>
  );
}

function AddForm({ values }: { values: ReferenceValue[] }) {
  const perm = usePermission(['VARIANT_OWNER']);
  const add = useApiMutation('createReferenceValue', ['referenceValues', 'audit']);
  const [kind, setKind] = useState<ReferenceKind>('COUNTRY');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [parent, setParent] = useState('');
  const parentKind = REFERENCE_PARENT[kind];
  const parents = parentKind ? referenceCodes(values, parentKind) : [];
  const ready = code.trim().length > 0 && label.trim().length > 0 && (!parentKind || !!parent);
  return (
    <Panel title={R.add} id="ref-add">
      <div className="ds-split">
        <Select label={R.kind} value={kind} onChange={(e) => (setKind(e.target.value as ReferenceKind), setParent(''))}>
          {REFERENCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {R.kinds[k]}
            </option>
          ))}
        </Select>
        {parentKind && (
          <Select label={`${R.parent} · ${R.kinds[parentKind]}`} value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">—</option>
            {parents.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="ds-split">
        <Field label={R.code}>
          <input className="ds-input ds-input--mono" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label={R.label}>
          <input className="ds-input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      </div>
      <ErrorNote error={add.error} />
      <Button
        variant="primary"
        disabled={!perm.ok || !ready || add.isPending}
        title={perm.hint}
        onClick={() => add.mutate({ body: { kind, code: code.trim(), label: label.trim(), parent: parentKind ? parent : null } }, { onSuccess: () => (setCode(''), setLabel('')) })}
      >
        {R.submit}
      </Button>
    </Panel>
  );
}

function RetireForm({ values }: { values: ReferenceValue[] }) {
  const perm = usePermission(['VARIANT_OWNER']);
  const retire = useApiMutation('retireReferenceValue', ['referenceValues', 'audit']);
  const active = values.filter((v) => v.status === 'ACTIVE');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const pick = active.find((v) => keyOf(v) === target);
  return (
    <Panel title={R.retire} id="ref-retire">
      <Select label={R.retireTarget} value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">—</option>
        {active.map((v) => (
          <option key={keyOf(v)} value={keyOf(v)}>
            {`${R.kinds[v.kind]} · ${v.parent ? `${v.parent} / ` : ''}${v.code}`}
          </option>
        ))}
      </Select>
      <Field label={R.retireReason}>
        <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorNote error={retire.error} />
      <Button
        disabled={!perm.ok || !pick || reason.trim().length < 2 || retire.isPending}
        title={perm.hint}
        onClick={() =>
          pick &&
          retire.mutate({ params: { kind: pick.kind, code: pick.code }, body: { reason: reason.trim(), ...(pick.parent ? { parent: pick.parent } : {}) } }, { onSuccess: () => (setTarget(''), setReason('')) })
        }
      >
        {R.retireSubmit}
      </Button>
    </Panel>
  );
}
