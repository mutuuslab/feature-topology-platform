import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as S from '../data/spec';
import { coverage, coverageOf, howOf, STATUS_COLOR, CovStatus } from '../data/specCoverage';
import { RightPanel } from '../components/patterns';
import { RadialProgress, Donut } from '../components/charts';

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
      <p className="page-sub">Feature Flag 플랫폼 기능명세서 (v0.3 · 플랫폼 구현 반영) · {S.counts.requirements} FR · {S.counts.components} 컴포넌트 · {S.counts.families} family</p>
      <div className="kpis">
        <div className="kpi"><div className="v">{S.counts.requirements}</div><div className="l">요구사항(FR)</div></div>
        <div className="kpi"><div className="v">{S.counts.components}</div><div className="l">컴포넌트</div></div>
        <div className="kpi"><div className="v">{S.counts.families}</div><div className="l">FR Family</div></div>
        <div className="kpi"><div className="v">6</div><div className="l">기능 카테고리</div></div>
      </div>

      {(() => {
        const st = S.families.map(f => coverageOf(f).status);
        const cnt = (x: CovStatus) => st.filter(s => s === x).length;
        const done = cnt('완료'), part = cnt('부분');
        const pct = Math.round((done + part * 0.5) / (S.families.length || 1) * 100);
        const frDone = S.families.filter(f => coverageOf(f).status === '완료').reduce((a, f) => a + S.byFamily(f).length, 0);
        return (
          <div className="row analytics-strip">
            <div className="col card" style={{ maxWidth: 240, alignItems: 'center' }}><b>플랫폼 구현 반영률</b>
              <RadialProgress size={120} color="#1F9D55" value={pct} label={`완료 ${done}/${S.families.length} family`} />
              <div className="small muted mt">FR 기준 완료 {frDone}/{S.counts.requirements}</div>
            </div>
            <div className="col card" style={{ maxWidth: 240, alignItems: 'center' }}><b>family 구현 상태</b>
              <Donut size={130} center={`${S.families.length}`} segments={(['완료', '부분', '백엔드', '미구현'] as CovStatus[]).map(s => ({ label: s, value: cnt(s), color: STATUS_COLOR[s] }))} />
            </div>
            <div className="col card" style={{ justifyContent: 'center' }}>
              <b>구현 현황 (v0.3 반영)</b>
              <p className="small mt">전 family 동작/시뮬 구현 완료 — 부분·백엔드·미구현 0. 화면별 매핑은 Coverage에서 확인.</p>
              <div className="row mt"><button className="btn primary" onClick={() => nav('/spec/coverage')}>구현 커버리지 →</button><button className="btn" onClick={() => nav('/spec/changelog')}>Change Log →</button></div>
            </div>
          </div>
        );
      })()}
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
          {sel.impl && <p><b>명세상 구현방식</b><br />{sel.impl}</p>}
          {sel.note && <p className="small muted"><b>비고</b> · {sel.note}</p>}
          <div className="mt card" style={{ background: 'var(--surface-2)' }}>
            <div><b>플랫폼 반영 현황</b> <span className="badge" style={{ background: STATUS_COLOR[coverageOf(sel.family).status] }}>{coverageOf(sel.family).status}</span></div>
            <p className="small mt"><b>어디에</b> — {coverageOf(sel.family).screens.map(s => s.label).join(' · ')}</p>
            <p className="small"><b>어떻게</b> — {howOf(sel.family)}</p>
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
      <div className="kpis reveal">
        {(Object.keys(tally) as CovStatus[]).map(s => (
          <div className="kpi" key={s}><div className="v" style={{ color: STATUS_COLOR[s] }}>{tally[s]}</div><div className="l">{s} family</div></div>
        ))}
      </div>
      <div className="row">
        <div className="col card" style={{ maxWidth: 240, alignItems: 'center' }}><b>전체 구현 진척</b>
          <RadialProgress size={120} color="#1F9D55"
            value={Math.round((tally['완료'] + tally['부분'] * 0.5) / allFams.length * 100)}
            label={`완료+부분 / ${allFams.length}`} />
        </div>
        <div className="col card" style={{ alignItems: 'center' }}><b>상태 분포</b>
          <Donut size={140} center={`${allFams.length}`} segments={(Object.keys(tally) as CovStatus[]).map(s => ({ label: s, value: tally[s], color: STATUS_COLOR[s] }))} />
        </div>
        <div className="col card"><b>카테고리별 구현률</b>
          <div className="mt">{Object.entries(fbc).map(([cat, fams]) => {
            const done = fams.filter(f => coverageOf(f).status === '완료').length;
            const part = fams.filter(f => coverageOf(f).status === '부분').length;
            const pct = Math.round((done + part * 0.5) / fams.length * 100);
            return (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '5px 0' }}>
                <span className="small" style={{ width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cat}>{cat}</span>
                <div style={{ flex: 1, background: 'var(--surface-3)', borderRadius: 4, height: 12 }}>
                  <div style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#0B5FFF,#16A34A)', height: 12, borderRadius: 4, transition: 'width .8s ease' }} />
                </div>
                <span className="small mono" style={{ width: 38, textAlign: 'right' }}>{pct}%</span>
              </div>
            );
          })}</div>
        </div>
      </div>
      {Object.entries(fbc).map(([cat, fams]) => (
        <div className="card" key={cat}>
          <b>{cat}</b>
          <table className="mt"><thead><tr><th>Family</th><th>컴포넌트</th><th>FR수</th><th>상태</th><th>구현 화면</th><th>반영 방식 (어떻게)</th></tr></thead>
            <tbody>{fams.map(f => {
              const cov = coverageOf(f);
              return (<tr key={f}>
                <td className="mono">{f}</td><td className="small">{S.familyName(f)}</td><td>{S.byFamily(f).length}</td>
                <td><span className="badge" style={{ background: STATUS_COLOR[cov.status] }}>{cov.status}</span></td>
                <td>{cov.screens.map(s => <span key={s.to} className="pill" style={{ cursor: 'pointer', marginRight: 4 }} onClick={() => nav(s.to)}>{s.label}</span>)}</td>
                <td className="small muted">{howOf(f)}</td>
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
