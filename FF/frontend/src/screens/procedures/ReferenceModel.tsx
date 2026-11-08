import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { RaciKey, WorkflowActivity, WorkflowDoc, WorkflowProcess } from '@ff/contracts';
import { Panel, Select } from '../../design';
import { workflowReference as W } from '../../copy/workflowReference';
import { WorkProductButton } from './WorkProduct';
import './reference-model.css';

const PARTS: RaciKey[] = ['R', 'A', 'C', 'I'];
const ids = (a: WorkflowActivity, k: RaciKey) => k === 'A' ? [a.raci.A] : a.raci[k];
const participates = (a: WorkflowActivity, roles: Set<string>) => PARTS.some((k) => ids(a, k).some((id) => roles.has(id)));
const definitionPath = (pid: string, dept?: string, bp?: string) => `/procedures/${pid}?docview=reference${dept ? `&dept=${encodeURIComponent(dept)}` : ''}${bp ? `#${encodeURIComponent(bp)}` : ''}`;

/** Only source-declared evidence links count. An activity's other outcomes are never inferred. */
export function referenceEvidence(p: WorkflowProcess) {
  const rows = new Map<string, Set<string>>();
  for (const bp of p.basePractices ?? []) for (const evidence of bp.evidence) {
    const row = rows.get(evidence.workProduct) ?? new Set<string>();
    evidence.outcomes.forEach((oid) => row.add(oid));
    rows.set(evidence.workProduct, row);
  }
  return [...rows].map(([id, outcomes]) => ({ id, outcomes: [...outcomes] }));
}

export function ReferenceModel({ doc }: { doc: WorkflowDoc }) {
  const [sp, setSp] = useSearchParams();
  const dept = doc.departments.find((d) => d.id === sp.get('dept'));
  const query = sp.get('q') ?? '';
  const roles = useMemo(() => new Set(dept?.roles ?? []), [dept]);
  const roleName = (id: string) => doc.roles.find((r) => r.id === id)?.name ?? id;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value); else next.delete(key);
    setSp(next, { replace: true });
  };
  const matches = doc.processes.flatMap((p) => {
    const activities = dept ? p.activities.filter((a) => participates(a, roles)) : p.activities;
    if (!activities.length) return [];
    const terms = [p.id, p.name, p.purpose, ...(p.basePractices ?? []).flatMap((bp) => [bp.name, bp.definition])].join(' ').toLocaleLowerCase();
    if (query.trim() && !terms.includes(query.trim().toLocaleLowerCase())) return [];
    const aids = new Set(activities.map((a) => a.id));
    const practices = (p.basePractices ?? []).filter((bp) => bp.activityIds.some((id) => aids.has(id)));
    return [{ p, activities, practices }];
  });
  return <div className="wr-model" data-reference-model={doc.referenceModel?.id}>
    <div className="wr-notice">
      <span className="ds-eyebrow">{doc.referenceModel?.version} · {W.draft}</span>
      <p>{doc.referenceModel?.scope ?? W.scope}</p>
      <p className="ds-field__hint">{W.boundary}</p>
      {doc.referenceModel && <a href={doc.referenceModel.benchmark.url} target="_blank" rel="noreferrer">{W.benchmark}</a>}
    </div>
    <div className="wr-filters">
      <Select label={W.department} value={dept?.id ?? ''} onChange={(e) => set('dept', e.target.value)}>
        <option value="">{W.allDepartments}</option>
        {doc.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>
      <label className="wr-search">{W.search}<input value={query} onChange={(e) => set('q', e.target.value)} placeholder={W.placeholder} /></label>
    </div>
    <p className="ds-field__hint">{W.browseHint}</p>
    {dept && <Panel title={dept.name} eyebrow={W.roles}>
      <p>{dept.desc}</p>
      <ul className="wr-roles">{dept.roles.map((id) => {
        const r = doc.roles.find((x) => x.id === id)!;
        return <li key={id}><strong>{roleName(id)}</strong><span>{r.desc}</span>{!r.platformRoles.length && <small>{W.noAuthority}</small>}</li>;
      })}</ul>
    </Panel>}
    <p className="wr-count" role="status">{W.stats(matches.length, matches.reduce((n, x) => n + x.practices.length, 0), dept ? 1 : doc.departments.length)}</p>
    {!matches.length && <p>{W.noMatch}</p>}
    <div className="wr-catalog">{matches.map(({ p, activities, practices }) => <article className="wr-process" key={p.id} data-process-reference={p.id}>
      <div className="wr-process__identity"><span>{p.id}</span><span>{p.group}</span></div>
      <h2><Link to={definitionPath(p.id, dept?.id)}>{p.name}</Link></h2>
      <p>{p.purpose}</p>
      {dept && <details className="wr-department-bps"><summary>{W.departmentPractices} · {practices.length}</summary><ul>{practices.map((bp) => <li key={bp.id}><Link to={definitionPath(p.id, dept.id, bp.id)}>{bp.id} · {bp.name}</Link><small>{PARTS.filter((k) => activities.some((a) => bp.activityIds.includes(a.id) && ids(a, k).some((id) => roles.has(id)))).map((k) => `${k} ${W.role[k]}`).join(' · ')}</small></li>)}</ul></details>}
      <div className="wr-process__foot"><span>{W.counts(practices.length, activities.length)}</span><Link to={definitionPath(p.id, dept?.id)}>{W.open}<span className="ds-sr"> · {p.name}</span></Link></div>
    </article>)}</div>
  </div>;
}

function TraceTable({ p, rows, title, names, firstColumn = W.output }: { p: WorkflowProcess; rows: { id: string; outcomes: string[] }[]; title: string; names: (id: string) => string; firstColumn?: string }) {
  return <div className="wr-table" role="region" aria-label={title} tabIndex={0}>
    <table className="ds-table"><caption>{title}</caption><thead><tr><th scope="col">{firstColumn}</th>{p.outcomes.map((o) => <th scope="col" key={o.id} title={o.text}>{o.id}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><th scope="row">{names(row.id)}</th>{p.outcomes.map((o) => <td key={o.id} aria-label={`${o.id} ${W.linked(row.outcomes.includes(o.id))}`}>{row.outcomes.includes(o.id) ? '●' : '—'}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export function ProcessReference({ doc, process: p }: { doc: WorkflowDoc; process: WorkflowProcess }) {
  const [sp] = useSearchParams();
  const dept = doc.departments.find((d) => d.id === sp.get('dept'));
  const deptRoles = new Set(dept?.roles ?? []);
  const practices = p.basePractices ?? [];
  const roleName = (id: string) => doc.roles.find((r) => r.id === id)?.name ?? id;
  const allProducts = doc.processes.flatMap((q) => q.workProducts.map((w) => ({ ...w, process: q })));
  const productName = (id: string) => allProducts.find((w) => w.key === id)?.name ?? id;
  const outputs = new Set(p.activities.flatMap((a) => a.outputs));
  const inputs = [...new Set(p.activities.flatMap((a) => a.inputs))].filter((id) => !outputs.has(id));
  const source = (key: string) => doc.processes.filter((q) => q.id !== p.id && q.activities.some((a) => a.outputs.includes(key)));
  const consumers = (key: string) => doc.processes.filter((q) => q.id !== p.id && q.activities.some((a) => a.inputs.includes(key)));
  const related = doc.processes.filter((q) => q.id !== p.id && (inputs.some((k) => q.activities.some((a) => a.outputs.includes(k))) || [...outputs].some((k) => q.activities.some((a) => a.inputs.includes(k)))));
  const processLink = (q: WorkflowProcess) => <Link key={q.id} to={definitionPath(q.id, dept?.id)}>{q.id} · {q.name}</Link>;
  return <article className="wr-sheet" data-process-sheet={p.id}>
    <header className="wr-sheet__identity"><span className="ds-eyebrow">{p.id} · {p.en}</span><p>{W.draft} · v{doc.referenceModel?.version}</p><p className="ds-field__hint">{W.boundary}</p></header>
    {dept && <p className="wr-department-context"><b>{dept.name}</b> · {W.departmentContext}</p>}
    <section aria-labelledby="wr-purpose"><h2 id="wr-purpose">{W.purpose}</h2><p className="wr-purpose">{p.purpose}</p></section>
    <section aria-labelledby="wr-outcomes"><h2 id="wr-outcomes">{W.outcomes}</h2><ol className="wr-outcomes">{p.outcomes.map((o) => <li key={o.id}><b>{o.id}</b><span>{o.text}</span></li>)}</ol></section>
    <div className="wr-criteria">{[[W.entry, p.entry], [W.exit, p.exit]].map(([title, items]) => <section key={title as string}><h3>{title}</h3><ul>{(items as string[]).map((x) => <li key={x}>{x}</li>)}</ul></section>)}</div>
    <section aria-labelledby="wr-practices"><h2 id="wr-practices">{W.practices}</h2><p className="ds-field__hint">{W.practiceHint}</p>
      <div className="wr-practices">{practices.map((bp) => {
        const activities = p.activities.filter((a) => bp.activityIds.includes(a.id));
        const departmentRelevant = !!dept && activities.some((a) => participates(a, deptRoles));
        return <details className="wr-practice" id={bp.id} key={bp.id} data-department-relevant={departmentRelevant || undefined}>
          <summary><span>{bp.id}</span><strong>{bp.name}</strong><small>{departmentRelevant && `${W.departmentMark} · `}{bp.outcomes.join(' · ')}</small></summary>
          <p>{bp.definition}</p>
          {bp.notes.map((note, n) => <p className="wr-note" key={n}><b>{W.note(n + 1)}</b> {note}</p>)}
          <p><b>{W.contributes}</b> {bp.outcomes.map((id) => `${id} ${p.outcomes.find((o) => o.id === id)?.text ?? ''}`).join(' · ')}</p>
          <h4>{W.activities}</h4><ul>{activities.map((a) => <li key={a.id}><Link to={`/procedures/${p.id}?a=${a.id}${dept ? `&dept=${encodeURIComponent(dept.id)}` : ''}`}>{a.id} · {a.name}</Link><div className="wr-raci">{PARTS.filter((k) => ids(a, k).length).map((k) => <span key={k}><b>{k} {W.role[k]}</b> {ids(a, k).map(roleName).join(', ')}</span>)}</div></li>)}</ul>
          <div className="wr-bp-io"><div><h4>{W.inputs}</h4>{[...new Set(activities.flatMap((a) => a.inputs))].map((id) => <WorkProductButton key={id} doc={doc} productKey={id} />)}</div><div><h4>{W.outputs}</h4>{[...new Set(activities.flatMap((a) => a.outputs))].map((id) => <WorkProductButton key={id} doc={doc} productKey={id} />)}</div></div>
        </details>;
      })}</div>
    </section>
    <section aria-labelledby="wr-interfaces"><h2 id="wr-interfaces">{W.inputs} / {W.outputs}</h2><div className="wr-interfaces"><div><h3>{W.inputs}</h3><p className="ds-field__hint">{W.inputHint}</p>{!inputs.length && <p>{W.noInput}</p>}<ul>{inputs.map((id) => <li key={id}><WorkProductButton doc={doc} productKey={id} /><div>{source(id).length ? source(id).map(processLink) : W.external}</div></li>)}</ul></div><div><h3>{W.outputs}</h3><p className="ds-field__hint">{W.outputHint}</p><ul>{[...outputs].map((id) => <li key={id}><WorkProductButton doc={doc} productKey={id} /><div>{consumers(id).length ? consumers(id).map(processLink) : W.noConsumer}</div></li>)}</ul></div></div></section>
    <section aria-labelledby="wr-traces"><h2 id="wr-traces">{W.bpMatrix}</h2><p className="ds-field__hint">{W.traceHint}</p><TraceTable p={p} rows={practices} title={W.bpMatrix} firstColumn={W.practice} names={(id) => `${id} ${practices.find((b) => b.id === id)?.name ?? ''}`} /><TraceTable p={p} rows={referenceEvidence(p)} title={W.evidenceMatrix} names={productName} /></section>
    {!!related.length && <section><h2>{W.related}</h2><div className="wr-related">{related.map(processLink)}</div></section>}
  </article>;
}
