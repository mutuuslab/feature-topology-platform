import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../store';
import { catalogStats, health, impact } from '../data/engine';
import { LifecycleBadge, DeployBadge, Health } from '../components/ui';
import { RightPanel } from '../components/patterns';
import { Donut, Bars, RadialProgress, CountUp, tally, dist } from '../components/charts';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageTitle } from '../components/PageTitle';

const LC_COLOR: Record<string, string> = { Proposed: '#8895A7', Approved: '#3B82F6', Developing: '#6366F1', Verified: '#0EA5E9', Released: '#1F9D55', Retired: '#9CA3AF' };

type SortKey = 'id' | 'displayName' | 'level' | 'lifecycle' | 'health';
const PAGE = 6;

export default function Catalog() {
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const all = state.features;
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [f, setF] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'id', dir: 1 });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);

  const uniq = (key: keyof typeof all[0]) => [...new Set(all.map(x => String(x[key])))];
  const facets: [string, string[]][] = [
    ['domain', uniq('domain')], ['level', uniq('level')], ['lifecycle', uniq('lifecycle')],
    ['ownerOrg', uniq('ownerOrg')], ['deployType', uniq('deployType')], ['safety', uniq('safety')],
  ];

  const rows = useMemo(() => {
    let r = all.filter(x =>
      (!q || x.id.toLowerCase().includes(q.toLowerCase()) || x.displayName.toLowerCase().includes(q.toLowerCase())) &&
      Object.entries(f).every(([k, v]) => !v || String((x as any)[k]) === v));
    r = [...r].sort((a, b) => {
      const av = sort.k === 'health' ? health(a.id) : String((a as any)[sort.k]);
      const bv = sort.k === 'health' ? health(b.id) : String((b as any)[sort.k]);
      return (av > bv ? 1 : av < bv ? -1 : 0) * sort.dir;
    });
    return r;
  }, [all, q, f, sort]);

  const stats = catalogStats();
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(rows.length / PAGE) || 1;
  const th = (k: SortKey, label: string) => (
    <th style={{ cursor: 'pointer' }} onClick={() => setSort(s => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
      {label}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  const pf = preview ? state.features.find(x => x.id === preview) : null;

  return (
    <div>
      <Breadcrumb />
      <PageTitle fallback="Feature Catalog" />
      <p className="page-sub">전체 {all.length} Feature · 검색·필터·정렬·대량작업·Health</p>
      <div className="row mt">
        <Link className="btn primary" to="/master/define">＋ 신규 Feature 등록 (R0 최초 초안)</Link>
        <span className="small muted">
          등록은 R0 필수 입력과 7개 등록 기준을 통과해야 하며, Feature Registry 와 리비전 레지스트리에 같은 Revision 으로 기록됩니다.
        </span>
      </div>

      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>Lifecycle 분포</b>
          <Donut size={120} center={`${all.length}`} segments={dist(tally(all, x => x.lifecycle), LC_COLOR)} />
        </div>
        <div className="col card" style={{ flex: 2 }}><b>도메인별 Feature 수</b>
          <div className="mt"><Bars data={tally(all, x => x.domain)} /></div>
        </div>
        <div className="col card" style={{ maxWidth: 200, alignItems: 'center' }}><b>Health 정상 비율</b>
          <RadialProgress size={110} color="#1F9D55" value={Math.round(all.filter(x => health(x.id) >= 80).length / (all.length || 1) * 100)} label={`${all.filter(x => health(x.id) >= 80).length}/${all.length} ≥80`} />
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <input placeholder="🔍 Search ID/Name…" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} style={{ flex: 1, minWidth: 200, padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
          {facets.map(([key, opts]) => (
            <select key={key} value={f[key] || ''} onChange={e => { setF(p => ({ ...p, [key]: e.target.value })); setPage(0); }} style={{ padding: 7 }}>
              <option value="">{key}: 전체</option>
              {opts.map(o => <option key={o}>{o}</option>)}
            </select>
          ))}
        </div>

        {sel.size > 0 && (
          <div className="row mt" style={{ alignItems: 'center', background: 'var(--surface-3)', padding: 8, borderRadius: 6 }}>
            <b>{sel.size}건 선택</b>
            <button className="btn" onClick={() => { const t = [...sel][0]; impact(t); dispatch({ t: 'TOAST', toast: { msg: `${sel.size}건 Impact 분석 실행`, kind: 'ok' } }); }}>Run Impact</button>
            <button className="btn" onClick={() => {
              const picked = all.filter(x => sel.has(x.id));
              const header = ['id', 'displayName', 'level', 'domain', 'ownerOrg', 'lifecycle', 'deployType', 'health'];
              const csv = [header.join(','), ...picked.map(x => [x.id, x.displayName, x.level, x.domain, x.ownerOrg, x.lifecycle, x.deployType, health(x.id)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
              const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
              const a = document.createElement('a'); a.href = url; a.download = `features_${picked.length}.csv`; a.click(); URL.revokeObjectURL(url);
              dispatch({ t: 'TOAST', toast: { msg: `CSV ${picked.length}건 다운로드`, kind: 'ok' } });
            }}>Export CSV</button>
            <button className="btn" onClick={() => setSel(new Set())}>선택 해제</button>
          </div>
        )}

        <table className="mt">
          <thead><tr>
            <th style={{ width: 28 }}><input type="checkbox" checked={sel.size === pageRows.length && pageRows.length > 0} onChange={e => setSel(e.target.checked ? new Set(pageRows.map(r => r.id)) : new Set())} /></th>
            {th('id', 'Display ID')}{th('displayName', 'Name')}{th('level', 'Lv')}<th>Domain</th><th>Owner</th>{th('lifecycle', 'Lifecycle')}<th>Deploy</th>{th('health', 'Health')}<th></th>
          </tr></thead>
          <tbody>
            {pageRows.map(x => (
              <tr key={x.id}>
                <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel.has(x.id)} onChange={() => setSel(s => { const n = new Set(s); n.has(x.id) ? n.delete(x.id) : n.add(x.id); return n; })} /></td>
                <td className="mono" onClick={() => nav(`/feature/${x.id}`)}>{x.id}</td>
                <td onClick={() => nav(`/feature/${x.id}`)}>{x.displayName}</td>
                <td>{x.level}</td><td>{x.domain}</td><td>{x.ownerOrg}</td>
                <td><LifecycleBadge value={x.lifecycle} /></td><td><DeployBadge value={x.deployType} /></td>
                <td><Health n={health(x.id)} /></td>
                <td><button className="btn" onClick={() => setPreview(x.id)}>👁</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row mt" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted small">Total <b><CountUp value={stats.total} /></b> · Approved {stats.approved} · Developing {stats.developing} · Released {stats.released} · Missing Trace {stats.missingTrace}</span>
          <span>
            <button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>←</button>
            <span className="small" style={{ margin: '0 8px' }}>{page + 1} / {pages}</span>
            <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>→</button>
          </span>
        </div>
      </div>

      <RightPanel open={!!pf} onClose={() => setPreview(null)} title={pf ? `${pf.id} 미리보기` : ''}>
        {pf && <div>
          <div className="kv">
            <div>Name</div><div>{pf.displayName}</div>
            <div>Level</div><div>{pf.level}</div>
            <div>Owner</div><div>{pf.ownerOrg}</div>
            <div>Lifecycle</div><div><LifecycleBadge value={pf.lifecycle} /></div>
            <div>Deploy</div><div><DeployBadge value={pf.deployType} /></div>
            <div>Health</div><div><Health n={health(pf.id)} /></div>
          </div>
          <div className="mt"><button className="btn primary" onClick={() => nav(`/feature/${pf.id}`)}>상세 열기 →</button></div>
        </div>}
      </RightPanel>
    </div>
  );
}
