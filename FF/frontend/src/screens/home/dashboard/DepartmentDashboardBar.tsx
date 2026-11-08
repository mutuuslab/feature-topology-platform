import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../../api/client';
import { dashboardDepartment as T } from '../../../copy/dashboard-department';
import { DEPARTMENTS, departmentById } from '../../../data/departments';
import { Button, ErrorNote, Field } from '../../../design';
import { departmentDefaults } from './department-defaults';
import { SYSTEM_ID, type DashboardsApi } from './store';

export default function DepartmentDashboardBar({ api, role }: { api: DashboardsApi; role: string }) {
  const admin = api.roles.includes('SYSTEM_ADMIN');
  const [target, setTarget] = useState(api.departmentId ?? DEPARTMENTS.departments[0].id);
  const departmentId = api.departmentId ?? target;
  const dept = departmentById(departmentId)!;
  const backend = departmentDefaults(role, admin, departmentId, api.items);
  const q = useQuery({ queryKey: ['departmentDashboardDefault', departmentId, api.me.id], queryFn: () => backend.get(), retry: false });
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [search] = useSearchParams();
  const location = useLocation();
  const applied = useRef('');
  useEffect(() => { setSelected(q.data?.dashboardId ?? ''); }, [departmentId, q.data?.version]);
  // Apply an explicit navigation choice once; users can then select their own board without being forced back.
  useEffect(() => {
    const mode = search.get('dashboard');
    const key = `${location.key}:${api.departmentId}:${mode}`;
    if (!api.departmentId || applied.current === key || !mode || mode === 'department' && !q.data || api.listPending) return;
    applied.current = key;
    api.select(mode === 'department' && q.data?.mode === 'DEPARTMENT' && q.data.dashboardId && api.items.some((d) => d.id === q.data!.dashboardId) ? q.data.dashboardId : SYSTEM_ID);
  }, [location.key, api.departmentId, api.listPending, api.items, api.select, search, q.data]);
  const perform = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null); setSaved(false);
    try { await work(); } catch (e) { setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', T.failed)); } finally { setBusy(false); }
  };
  return <section className="jd-department" aria-label={T.region}>
    <div className="jd-department__head"><h2>{T.title}</h2><nav aria-label={T.region}>
      {!!api.departmentId && <><Link to="/?dashboard=department">{T.department}</Link><Link to="/?dashboard=role">{T.role}</Link></>}
      <Button variant="ghost" disabled={busy} onClick={() => void perform(() => api.create(T.personalName(dept.name), api.current.board))}>{T.personal}</Button>
    </nav></div>
    <p className="ds-field__hint">{T.personalHint}</p>
    {q.isError && <div><ErrorNote error={q.error} /><Button onClick={() => void q.refetch()}>{T.retry}</Button></div>}
    {q.data?.mode === 'ROLE' && !!api.departmentId && <p className="ds-field__hint">{T.none}</p>}
    {admin && <details className="jd-department__admin"><summary>{T.admin}</summary>
      <p className="ds-field__hint">{T.adminHint}</p>
      {!api.departmentId && <Field label={T.team}><select className="ds-input" value={target} onChange={(e) => setTarget(e.target.value)}>{DEPARTMENTS.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
      <Field label={T.default}><select className="ds-input" value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">{T.roleDefault}</option>{api.items.filter((d) => d.departmentId === departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <div className="jd-department__actions"><Button disabled={busy} onClick={() => void perform(async () => { const doc = await api.createDepartment(T.createName(dept.name), departmentId); setSelected(doc.id); })}>{T.create}</Button>
      <Button variant="primary" disabled={busy || !q.data} onClick={() => void perform(async () => { await backend.put({ mode: selected ? 'DEPARTMENT' : 'ROLE', dashboardId: selected || null, version: q.data!.version }); await q.refetch(); setSaved(true); })}>{T.assign}</Button></div>
    </details>}
    {error && <ErrorNote error={error} />}
    {saved && <p role="status">{T.saved}</p>}
  </section>;
}
