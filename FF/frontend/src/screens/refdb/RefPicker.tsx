// Feature 제안 ① — Feature DB 기준 행 고르기(30-95 §6.1). 대표 1 + 포함 N, 없는 기능은 추가 요청으로 요청 중 행을 바로 만든다.
import { useMemo, useState } from 'react';
import type { FeatureRefLink, TaxonomyNodeRow } from '@ff/contracts';
import { useApi, useApiMutation } from '../../api/hooks';
import { fieldErrors } from '../../api/field-errors';
import { refPicker as R, featureDb as D } from '../../copy/refdbCost';
import { Button, ErrorNote, Field, Panel, Select } from '../../design';

export interface RefSummary {
  refId: string;
  status: string;
  replacedBy: string | null;
  domain: string;
  cluster: string;
  component: string;
  swStack: string;
  nameEn: string;
  nameKo: string;
  aliases: string[];
  lifecycle: string;
  asilRep: string;
  tshirt: string;
  summary: string | null;
}

const MIN_QUERY = 2;

export function RefPicker({ value, picked, onChange, disabled }: { value: FeatureRefLink[]; picked: Record<string, RefSummary>; onChange: (links: FeatureRefLink[], picked: Record<string, RefSummary>) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [requesting, setRequesting] = useState(false);
  const query = q.trim();
  const found = useApi<{ items: RefSummary[]; total: number }>('refdbRefs', { query: { q: query, limit: 8 } }, { enabled: query.length >= MIN_QUERY });
  const hasPrimary = value.some((l) => l.role === 'PRIMARY');

  const add = (r: RefSummary, role: FeatureRefLink['role']) => {
    const rest = value.filter((l) => l.refId !== r.refId).map((l) => (role === 'PRIMARY' && l.role === 'PRIMARY' ? { ...l, role: 'INCLUDED' as const } : l));
    onChange(role === 'PRIMARY' ? [{ refId: r.refId, role }, ...rest] : [...rest, { refId: r.refId, role }], { ...picked, [r.refId]: r });
  };
  const remove = (refId: string) => {
    const next = value.filter((l) => l.refId !== refId);
    // 대표를 빼면 남은 첫 행을 대표로 올리지 않는다 — 사람이 다시 고른다
    onChange(next, picked);
  };

  return (
    <Panel id="propose-refs" title={R.title}>
      <p className="ds-field__hint">{R.lead}</p>
      <Field label={R.search} hint={R.searchHint}>
        <input className="ds-input" name="refSearch" type="search" value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled} autoComplete="off" />
      </Field>
      {query.length >= MIN_QUERY && (
        <ul className="ds-stack" aria-label={R.search} data-ui="refResults">
          {(found.data?.items ?? []).map((r) => (
            <li key={r.refId} className="ds-toolbar">
              <span>
                <span className="ds-mono">{r.refId}</span> {r.nameKo} <span className="ds-field__hint">{`${r.component} · ${r.asilRep} · ${r.tshirt} · ${D.statusLabel[r.status] ?? r.status}`}</span>
              </span>
              <span className="ds-toolbar">
                <Button onClick={() => add(r, 'PRIMARY')} disabled={disabled || r.status === 'RETIRED'}>{R.asPrimary}</Button>
                <Button onClick={() => add(r, 'INCLUDED')} disabled={disabled || r.status === 'RETIRED' || !hasPrimary}>{R.asIncluded}</Button>
              </span>
            </li>
          ))}
          {found.data && found.data.items.length === 0 && <li className="ds-field__hint">{R.none}</li>}
        </ul>
      )}
      <h3 className="ds-field__label">{R.selected}</h3>
      {value.length === 0 ? (
        <p className="ds-field__hint" data-ui="refNone">{R.noneSelected}</p>
      ) : (
        <ul className="ds-stack" data-ui="refSelected">
          {value.map((l) => {
            const r = picked[l.refId];
            return (
              <li key={l.refId} className="ds-toolbar">
                <span>
                  <strong>{l.role === 'PRIMARY' ? R.primary : R.included}</strong> <span className="ds-mono">{l.refId}</span> {r?.nameKo}
                  {r && R.warn[r.status] && <span className="ds-field__hint"> — {R.warn[r.status]}{r.replacedBy ? ` (${D.detail.replacedBy(r.replacedBy)})` : ''}</span>}
                </span>
                <Button onClick={() => remove(l.refId)} disabled={disabled}>{R.remove}</Button>
              </li>
            );
          })}
        </ul>
      )}
      {requesting ? (
        <RefRequestForm
          onCancel={() => setRequesting(false)}
          onCreated={(r) => {
            setRequesting(false);
            add(r, 'PRIMARY');
          }}
        />
      ) : (
        <Button onClick={() => setRequesting(true)} disabled={disabled} data-ui="refRequestOpen">
          {R.request.open}
        </Button>
      )}
    </Panel>
  );
}

const TSHIRT = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const ASILS = ['QM', 'A', 'B', 'C', 'D'];

function RefRequestForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (r: RefSummary) => void }) {
  const P = R.request;
  const tax = useApi<{ items: TaxonomyNodeRow[] }>('refdbTaxonomy');
  const req = useApiMutation<RefSummary & { definition: { summary: string | null } | null }>('refdbRequest', ['refdbRefs', 'refdbOverview']);
  const [f, setF] = useState({ domain: '', component: '', nameKo: '', nameEn: '', tshirt: 'S', asilRep: 'QM', evidence: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'domain' ? { component: '' } : {}) }));
  const nodes = tax.data?.items ?? [];
  const domains = nodes.filter((n) => n.level === 'DOMAIN');
  const components = useMemo(() => {
    const d = domains.find((x) => x.name === f.domain);
    if (!d) return [];
    const clusters = new Set(nodes.filter((n) => n.level === 'CLUSTER' && n.parentId === d.nodeId).map((n) => n.nodeId));
    return nodes.filter((n) => n.level === 'COMPONENT' && n.parentId && clusters.has(n.parentId));
  }, [nodes, domains, f.domain]);
  const fe = fieldErrors(req.error);
  const cluster = nodes.find((n) => n.nodeId === components.find((c) => c.name === f.component)?.parentId)?.name ?? '';
  const ready = f.domain && f.component && f.nameKo.trim() && f.nameEn.trim() && f.evidence.trim();
  return (
    <div className="ds-stack" data-ui="refRequest">
      <h3 className="ds-field__label">{P.title}</h3>
      <p className="ds-field__hint">{P.lead}</p>
      <div className="ds-split">
        <div className="ds-stack">
          <Select label={P.domain} value={f.domain} onChange={set('domain')} name="refDomain">
            <option value="">—</option>
            {domains.map((d) => (
              <option key={d.nodeId} value={d.name}>{d.name}</option>
            ))}
          </Select>
          <Select label={P.component} value={f.component} onChange={set('component')} name="refComponent" disabled={!f.domain}>
            <option value="">—</option>
            {components.map((c) => (
              <option key={c.nodeId} value={c.name}>{c.name}</option>
            ))}
          </Select>
          <Field label={P.nameKo} error={fe.nameKo}>
            <input className="ds-input" name="refNameKo" value={f.nameKo} onChange={set('nameKo')} />
          </Field>
          <Field label={P.nameEn} error={fe.nameEn}>
            <input className="ds-input" name="refNameEn" value={f.nameEn} onChange={set('nameEn')} />
          </Field>
        </div>
        <div className="ds-stack">
          <Select label={P.tshirt} value={f.tshirt} onChange={set('tshirt')} name="refTshirt">
            {TSHIRT.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
          <Select label={P.asil} value={f.asilRep} onChange={set('asilRep')} name="refAsil">
            {ASILS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
          <Field label={P.evidence} error={fe.evidence}>
            <textarea className="ds-input" name="refEvidence" rows={2} value={f.evidence} onChange={set('evidence')} />
          </Field>
        </div>
      </div>
      <ErrorNote error={req.error} />
      <span className="ds-toolbar">
        <Button
          variant="primary"
          disabled={!ready || req.isPending}
          onClick={() =>
            req.mutate(
              { body: { domain: f.domain, cluster, component: f.component, nameKo: f.nameKo.trim(), nameEn: f.nameEn.trim(), tshirt: f.tshirt, asilRep: f.asilRep, evidence: f.evidence.trim() } },
              { onSuccess: (r) => onCreated({ ...r, summary: r.definition?.summary ?? null }) },
            )
          }
        >
          {P.submit}
        </Button>
        <Button onClick={onCancel}>{P.cancel}</Button>
      </span>
    </div>
  );
}
