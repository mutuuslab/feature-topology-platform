import { useState } from 'react';
import { variantMatrix } from '../data/model';
import SpecLink from '../components/SpecLink';
import { useToast } from '../store';
import { RightPanel } from '../components/patterns';
import TopoLink from '../components/TopoLink';
import { Donut, tally, dist } from '../components/charts';

export default function VariantMatrix() {
  const toast = useToast();
  const [sel, setSel] = useState<any>(null);
  return (
    <div>
      <div className="breadcrumb">배포·운영 ▸ Variant Matrix & Rule Builder</div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">Variant Matrix · FEAT-BDC-001</h1>
        <TopoLink />
      </div>
      <p className="page-sub">구조적 적용가능성 (Variant ≠ Control) · 행 클릭 → 판정 상세</p>
      <SpecLink families={['FR-VAR', 'FR-TGT']} />
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>적용성 Status 분포</b>
          <Donut size={120} center={`${variantMatrix.length}`}
            segments={dist(tally(variantMatrix, r => r.status), { Allowed: 'var(--pass)', Review: 'var(--pending)', Blocked: 'var(--fail)' })} /></div>
        <div className="col card" style={{ flex: 2, justifyContent: 'center' }}>
          <div className="small muted">총 {variantMatrix.length}개 Variant 조합 중 Allowed {variantMatrix.filter(r => r.status === 'Allowed').length} · Review {variantMatrix.filter(r => r.status === 'Review').length} · Blocked {variantMatrix.filter(r => r.status === 'Blocked').length}</div>
        </div>
      </div>
      <div className="row">
        <div className="col card">
          <b>Applicability Matrix</b>
          <table className="mt"><thead><tr><th>Platform</th><th>MY</th><th>Region</th><th>Trim</th><th>HW</th><th>SW</th><th>Status</th></tr></thead>
            <tbody>{variantMatrix.map((r,i)=>(
              <tr key={i} role="button" tabIndex={0} onClick={()=>setSel(r)} onKeyDown={e=>{if(e.key==='Enter')setSel(r);}}><td>{r.platform}</td><td>{r.my}</td><td>{r.region}</td><td>{r.trim}</td><td>{r.hw}</td><td>{r.sw}</td>
              <td><span className="badge" style={{background:r.status==='Allowed'?'var(--pass)':r.status==='Review'?'var(--pending)':'var(--fail)'}}>{r.status}</span></td></tr>
            ))}</tbody></table>
        </div>
        <div className="col card">
          <b>Rule Builder</b>
          <pre className="mono small" style={{background:'var(--surface-2)',padding:12,borderRadius:6}}>{`IF   region IN [KR, EU]
AND  modelYear >= 2027
AND  trim IN [Premium]
AND  bdc.hw.generation == Gen3
AND  bdc.sw.version >= 3.2.0
THEN applicability = allowed
ELSE applicability = blocked`}</pre>
          <div className="mt"><span className="pill">Cohort: 142,300대</span> <span className="pill">Conflict: 0</span></div>
          <button className="btn primary mt" onClick={() => toast('Variant Rule → Runtime Policy 변환·Export (Policy Lifecycle Draft 등록)')}>Export to Runtime Policy</button>
        </div>
      </div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel ? `${sel.platform}·MY${sel.my}·${sel.region}` : ''}>
        {sel && <div className="kv">
          <div>Platform</div><div>{sel.platform}</div><div>Model Year</div><div>{sel.my}</div>
          <div>Region</div><div>{sel.region}</div><div>Trim</div><div>{sel.trim}</div>
          <div>HW / SW</div><div>{sel.hw} / {sel.sw}</div>
          <div>적용성</div><div><span className="badge" style={{ background: sel.status === 'Allowed' ? 'var(--pass)' : sel.status === 'Review' ? 'var(--pending)' : 'var(--fail)' }}>{sel.applicability || sel.status}</span></div>
          <div>Effective</div><div>{sel.effectiveRange || '-'}</div>
          <div>판정</div><div className="small">{sel.status === 'Allowed' ? 'region∈[KR,EU]∧MY≥2027∧Gen3∧SW≥3.2 충족' : sel.status === 'Review' ? '조건 일부 미충족 — 검토 필요' : 'Variant 조건 미충족 → Blocked'}</div>
        </div>}
      </RightPanel>
    </div>
  );
}
