import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as S from '../data/spec';
import { coverage, coverageOf, STATUS_COLOR, CovStatus } from '../data/specCoverage';
import { RightPanel } from '../components/patterns';

// ── 개요 (시트 00) ─────────────────────────────
export function SpecOverview() {
  const nav = useNavigate();
  const cats = [...new Set(S.components.map(c => c.category))].filter(Boolean);
  const [sel, setSel] = useState<any>(null);
  const compFRs = (comp: string) => S.requirements.filter(r => r.component === comp);
  return (
    <div>
      <div className="breadcrumb">기능명세 / Functional Spec ▸ Overview</div>
      <h1 className="page-title">기능명세서 Overview</h1>
      <p className="page-sub">Feature Flag 플랫폼 기능명세서 2차 revision · {S.counts.requirements} FR · {S.counts.components} 컴포넌트 · {S.counts.families} family</p>
      <div className="kpis">
        <div className="kpi"><div className="v">{S.counts.requirements}</div><div className="l">요구사항(FR)</div></div>
        <div className="kpi"><div className="v">{S.counts.components}</div><div className="l">컴포넌트</div></div>
        <div className="kpi"><div className="v">{S.counts.families}</div><div className="l">FR Family</div></div>
        <div className="kpi"><div className="v">6</div><div className="l">기능 카테고리</div></div>
      </div>
      {cats.map(cat => (
        <div className="card" key={cat}>
          <b>{cat}</b>
          <table className="mt"><thead><tr><th>No</th><th>개발항목</th><th>컴포넌트</th><th>내용</th><th>담당</th></tr></thead>
            <tbody>{S.components.filter(c => c.category === cat).map((c, i) => (
              <tr key={i} role="button" tabIndex={0} onClick={() => setSel(c)} onKeyDown={e => { if (e.key === 'Enter') setSel(c); }}><td>{c.no}</td><td>{c.devItem}</td><td><b>{c.component}</b></td><td className="small muted">{c.desc}</td><td>{c.owner}</td></tr>
            ))}</tbody></table>
        </div>
      ))}
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.component || ''}>
        {sel && <div>
          <div className="kv"><div>카테고리</div><div>{sel.category}</div><div>개발항목</div><div>{sel.devItem}</div><div>담당</div><div>{sel.owner}</div></div>
          <p className="mt">{sel.desc}</p>
          <p className="small mt"><b>관련 FR ({compFRs(sel.component).length})</b></p>
          <ul className="small">{compFRs(sel.component).slice(0, 12).map(r => <li key={r.id} className="mono" style={{ cursor: 'pointer' }} onClick={() => nav(`/spec/explorer?family=${r.family}`)}>{r.id} · {r.name}</li>)}</ul>
        </div>}
      </RightPanel>
    </div>
  );
}

// ── Explorer (시트 01-06) ──────────────────────
export function SpecExplorer() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [area, setArea] = useState('');
  const [fam, setFam] = useState(sp.get('family') || '');
  const [sel, setSel] = useState<S.Requirement | null>(null);

  const rows = useMemo(() => {
    let r = S.search(q);
    if (cat) r = r.filter(x => x.category === cat);
    if (area) r = r.filter(x => x.area.includes(area));
    if (fam) r = r.filter(x => x.family === fam);
    return r;
  }, [q, cat, area, fam]);

  return (
    <div>
      <div className="breadcrumb">기능명세 ▸ Explorer</div>
      <h1 className="page-title">FR Explorer</h1>
      <p className="page-sub">{rows.length} / {S.counts.requirements} 건</p>
      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <input placeholder="🔍 검색 (FR-REG, 카탈로그…)" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 200, padding: 8, border: '1px solid var(--line)', borderRadius: 6 }} />
          <select value={cat} onChange={e => setCat(e.target.value)} style={{ padding: 7 }}><option value="">카테고리 전체</option>{S.categories.map(c => <option key={c}>{c}</option>)}</select>
          <select value={fam} onChange={e => setFam(e.target.value)} style={{ padding: 7 }}><option value="">Family 전체</option>{S.families.map(f => <option key={f}>{f}</option>)}</select>
          <select value={area} onChange={e => setArea(e.target.value)} style={{ padding: 7 }}><option value="">적용영역 전체</option>{S.areas.map(a => <option key={a}>{a}</option>)}</select>
          {(q || cat || fam || area) && <button className="btn" onClick={() => { setQ(''); setCat(''); setFam(''); setArea(''); }}>초기화</button>}
        </div>
        <table className="mt"><thead><tr><th>FR ID</th><th>요구사항명</th><th>컴포넌트</th><th>영역</th><th>구현</th></tr></thead>
          <tbody>{rows.slice(0, 200).map(r => {
            const cov = coverageOf(r.family);
            return (<tr key={r.id} onClick={() => setSel(r)}>
              <td className="mono">{r.id}</td><td>{r.name}</td><td className="small muted">{r.component}</td>
              <td><span className="pill">{r.area || '-'}</span></td>
              <td><span className="badge" style={{ background: STATUS_COLOR[cov.status] }}>{cov.status}</span></td>
            </tr>);
          })}</tbody></table>
        {rows.length > 200 && <p className="small muted mt">상위 200건 표시 — 필터로 좁히세요.</p>}
      </div>

      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel ? sel.id : ''}>
        {sel && <div>
          <h3>{sel.name}</h3>
          <div className="kv small">
            <div>Family</div><div className="mono">{sel.family}</div>
            <div>카테고리</div><div>{sel.category}</div>
            <div>컴포넌트</div><div>{sel.component}{sel.sub ? ` ▸ ${sel.sub}` : ''}</div>
            <div>적용영역</div><div>{sel.area || '-'}</div>
            <div>시트</div><div className="small">{sel.sheet}</div>
          </div>
          <p className="mt"><b>상세설명</b><br />{sel.desc}</p>
          {sel.impl && <p><b>구현방식</b><br />{sel.impl}</p>}
          {sel.note && <p className="small muted"><b>비고</b> · {sel.note}</p>}
          <div className="mt"><b>구현 화면</b>
            <div className="row mt">{coverageOf(sel.family).screens.map(s => <button key={s.to} className="btn" onClick={() => nav(s.to)}>{s.label} →</button>)}</div>
          </div>
        </div>}
      </RightPanel>
    </div>
  );
}

// ── Coverage Dashboard ─────────────────────────
export function SpecCoverage() {
  const nav = useNavigate();
  const fbc = S.familiesByCategory();
  const allFams = S.families;
  const tally: Record<CovStatus, number> = { '완료': 0, '부분': 0, '백엔드': 0, '미구현': 0 };
  allFams.forEach(f => { tally[coverageOf(f).status]++; });

  return (
    <div>
      <div className="breadcrumb">기능명세 ▸ Coverage</div>
      <h1 className="page-title">구현 커버리지 / Traceability</h1>
      <p className="page-sub">{allFams.length} FR family · 구현상태 매핑</p>
      <div className="kpis">
        {(Object.keys(tally) as CovStatus[]).map(s => (
          <div className="kpi" key={s}><div className="v" style={{ color: STATUS_COLOR[s] }}>{tally[s]}</div><div className="l">{s} family</div></div>
        ))}
      </div>
      {Object.entries(fbc).map(([cat, fams]) => (
        <div className="card" key={cat}>
          <b>{cat}</b>
          <table className="mt"><thead><tr><th>Family</th><th>컴포넌트</th><th>FR수</th><th>상태</th><th>구현 화면</th></tr></thead>
            <tbody>{fams.map(f => {
              const cov = coverageOf(f);
              return (<tr key={f}>
                <td className="mono">{f}</td><td className="small">{S.familyName(f)}</td><td>{S.byFamily(f).length}</td>
                <td><span className="badge" style={{ background: STATUS_COLOR[cov.status] }}>{cov.status}</span></td>
                <td>{cov.screens.map(s => <span key={s.to} className="pill" style={{ cursor: 'pointer', marginRight: 4 }} onClick={() => nav(s.to)}>{s.label}</span>)}</td>
              </tr>);
            })}</tbody></table>
        </div>
      ))}
    </div>
  );
}

// ── Change Log / Glossary ──────────────────────
export function SpecChangeLog() {
  return (
    <div>
      <div className="breadcrumb">기능명세 ▸ Change Log</div>
      <h1 className="page-title">Change Log</h1>
      <div className="card"><table><thead><tr><th>Version</th><th>Date</th><th>Description</th><th>Author</th></tr></thead>
        <tbody>{S.changeLog.map((c, i) => <tr key={i}><td>{c.version}</td><td>{c.date}</td><td>{c.desc}</td><td>{c.author}</td></tr>)}</tbody></table></div>
    </div>
  );
}
export function SpecGlossary() {
  return (
    <div>
      <div className="breadcrumb">기능명세 ▸ Glossary</div>
      <h1 className="page-title">용어집 ({S.glossary.length})</h1>
      <div className="card"><table><thead><tr><th>용어</th><th>정의</th></tr></thead>
        <tbody>{S.glossary.map((g, i) => <tr key={i}><td><b>{g.term}</b></td><td className="small">{g.def}</td></tr>)}</tbody></table></div>
    </div>
  );
}
