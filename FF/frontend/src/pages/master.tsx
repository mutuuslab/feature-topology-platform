import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { taxonomyTree } from '../data/refdata';
import { artifacts, relations } from '../data/model';
import { useApp, useToast } from '../store';
import { RightPanel } from '../components/patterns';
import { Donut, Bars, RadialProgress, Steps, tally, dist } from '../components/charts';

const ID_RULE: Record<string, string> = {
  L0: 'TAX-{DOMAIN}', L1: 'Feature Cluster', L2: 'FEAT-{DOMAIN}-{NNN}', L3: 'FEAT-{DOMAIN}-{SW}-{NNN}',
  L4: 'CP-{FEATURE}-{TYPE}', L5: 'API/Signal/DTC',
};
export function TaxonomyBrowser() {
  const [sel, setSel] = useState<number | null>(null);
  const n = sel != null ? taxonomyTree[sel] : null;
  return (
    <div>
      <div className="breadcrumb">기준정보 ▸ Taxonomy Browser</div>
      <h1 className="page-title">Taxonomy Browser (L0~L5)</h1>
      <p className="page-sub">기준 Feature = L2. 레벨 경계·ID 규칙 · 노드 클릭 → 상세</p>
      <div className="card">
        <b>레벨 경계 (L0 → L5) · 기준 Feature = L2</b>
        <Steps steps={['L0 분류', 'L1 클러스터', 'L2 기준 Feature', 'L3 구현', 'L4 Control', 'L5 Artifact']} current={2} />
      </div>
      <div className="card">
        {taxonomyTree.map((nn, i) => (
          <div key={nn.level} role="button" tabIndex={0} onClick={() => setSel(i)} onKeyDown={e => { if (e.key === 'Enter') setSel(i); }}
            style={{ marginLeft: i * 22, padding: '6px 8px', cursor: 'pointer', borderRadius: 6 }} className="evt">
            <span className="pill" style={{ background: nn.level === 'L2' ? 'var(--brand)' : '', color: nn.level === 'L2' ? '#fff' : '' }}>{nn.level}</span>{' '}
            <b>{nn.name}</b> <span className="muted small">— {nn.note}</span>
          </div>
        ))}
      </div>
      <RightPanel open={!!n} onClose={() => setSel(null)} title={n ? `${n.level} 상세` : ''}>
        {n && <div className="kv">
          <div>Level</div><div>{n.level}{n.level === 'L2' ? ' (기준 Feature)' : ''}</div>
          <div>명칭</div><div>{n.name}</div>
          <div>관리 목적</div><div>{n.note}</div>
          <div>ID 규칙</div><div className="mono">{ID_RULE[n.level]}</div>
          <div>경계</div><div className="small">{n.level === 'L0' || n.level === 'L1' ? '분류·상품가치 (배포 대상 아님)' : n.level === 'L2' ? '요구사항·검증·Variant·Gate 기준' : n.level === 'L3' ? '구현·협력사 책임' : 'Control/Implementation Artifact'}</div>
        </div>}
      </RightPanel>
    </div>
  );
}

export function TaxonomyEditor() {
  const toast = useToast();
  const { state, dispatch } = useApp();
  const save = () => { dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 09:45', actor: state.role, action: 'TAXONOMY_SAVE', target: 'TAX-node', detail: 'T-001~004 규칙 검증 통과' } }); toast('Taxonomy 노드 저장 — T-001~004 검증 통과 (Audit 기록)'); };
  return (
    <div>
      <div className="breadcrumb">기준정보 ▸ Taxonomy Editor</div>
      <h1 className="page-title">Taxonomy Editor</h1>
      <div className="card">
        <b>귀속 경로</b>
        <Steps steps={['L1 클러스터', 'L2 Parent', 'L3 신규 노드']} current={2} />
        <div className="kv mt" style={{ maxWidth: 520 }}>
          <div>Level</div><div><select style={{padding:6}}><option>L2</option><option>L3</option><option>L4</option></select></div>
          <div>Parent</div><div><input defaultValue="FEAT-BODY-001" style={{padding:6,width:'100%'}}/></div>
          <div>Display Name</div><div><input placeholder="고객/차량 관점 명칭" style={{padding:6,width:'100%'}}/></div>
        </div>
        <p className="small muted mt">저장 시 T-001~T-004 규칙 검증 (예: L4 Control Point는 L2/L3 귀속 필수)</p>
        <button className="btn primary" onClick={save}>저장 (규칙 검증)</button>
      </div>
    </div>
  );
}

const AREA_KINDS: Record<string, string[]> = {
  'Feature Master': ['Feature'], Requirement: ['Requirement'], Architecture: ['SWComponent', 'ECU'],
  Interface: ['APIService', 'Signal', 'DTC'], Variant: ['VariantRule'], Control: ['ControlPoint'],
  Deployment: ['DeploymentUnit'], Verification: ['TestCase', 'TestEvidence'], Supplier: ['SupplierFunction'],
  'Safety/Security': [], Operation: ['TelemetryEvent'],
};

export function BOMEditor() {
  const { dispatch, state } = useApp();
  const nav = useNavigate();
  const areas = Object.keys(AREA_KINDS);
  const [active, setActive] = useState('Requirement');
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState<{ type: string; area: string; detail: string }[]>([]);

  const kinds = AREA_KINDS[active] || [];
  const base = relations.map(r => artifacts.find(a => a.id === r.target)).filter((a: any) => a && kinds.includes(a.kind)) as any[];
  const extra = (added[active] || []).map(id => ({ id, kind: kinds[0] || '-', _new: true }));
  const items = [...base, ...extra];

  const addItem = () => {
    const id = `${(kinds[0] || 'ITEM').slice(0, 3).toUpperCase()}-NEW-${(added[active]?.length || 0) + 1}`;
    setAdded(p => ({ ...p, [active]: [...(p[active] || []), id] }));
    setPending(p => [...p, { type: 'ADD', area: active, detail: `${id} 추가` }]);
  };
  const save = () => {
    if (!pending.length) { dispatch({ t: 'TOAST', toast: { msg: '변경 없음', kind: 'warn' } }); return; }
    dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 08:35', actor: state.role, action: 'CHANGESET', target: 'FEAT-BDC-001', detail: `BOM ${pending.length}건 (${pending.map(p => p.type).join(',')})` } });
    dispatch({ t: 'TOAST', toast: { msg: `ChangeSet 생성 (${pending.length}건) → RULE-R12 Impact 트리거`, kind: 'ok' } });
    nav('/change/changeset');
  };

  return (
    <div>
      <div className="breadcrumb">기준정보 ▸ BOM Editor ▸ FEAT-BDC-001</div>
      <h1 className="page-title">Feature BOM Editor (11 영역)</h1>
      <div className="card analytics-strip">
        <b>영역별 BOM 항목 수</b>
        <div className="mt"><Bars data={Object.fromEntries(areas.map(a => {
          const k = AREA_KINDS[a];
          const baseN = relations.map(r => artifacts.find(x => x.id === r.target)).filter((x: any) => x && k.includes(x.kind)).length;
          return [a, baseN + (added[a]?.length || 0)];
        }).filter(([, v]) => (v as number) > 0))} /></div>
        {pending.length > 0 && <p className="small" style={{ color: 'var(--pass)' }}>대기 변경 {pending.length}건 (미저장)</p>}
      </div>
      <div className="tabs">{areas.map(a => <button key={a} className={active === a ? 'active' : ''} onClick={() => setActive(a)}>{a} {AREA_KINDS[a].length ? '' : '·'}</button>)}</div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <b>{active} 영역 · {items.length}건</b>
          <button className="btn" onClick={addItem}>+ 항목 추가</button>
        </div>
        <div className="table-wrap mt"><table><thead><tr><th>Artifact ID</th><th>Kind</th><th>source_system</th><th>상태</th></tr></thead>
          <tbody>{items.length ? items.map((a: any) => (<tr key={a.id}><td className="mono">{a.id}</td><td>{a.kind}</td><td className="muted">ALM/PLM</td><td><span className="pill" style={a._new ? { background: 'var(--pass)', color: '#fff' } : {}}>{a._new ? 'ADD(미저장)' : 'linked'}</span></td></tr>)) : <tr><td colSpan={4} className="muted">이 영역에 등록된 항목이 없습니다. + 항목 추가</td></tr>}</tbody></table></div>
        <p className="small muted mt">원천 복제 없이 ID·링크만 보유. 저장 시 ChangeSet 생성(RULE-R12). 대기 변경: <b>{pending.length}건</b></p>
        <button className="btn primary" onClick={save}>변경 저장 → ChangeSet</button>
      </div>
    </div>
  );
}

export function DefinitionWizard() {
  const { state, dispatch } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('Body Platform Team');
  const criteria = ['고객/차량 가치','요구사항화 가능','독립 검증 가능','적용 조건 존재','배포/활성화 제어','Owner 지정','운영 모니터링'];
  const [checked, setChecked] = useState<boolean[]>(Array(7).fill(false));
  const cnt = checked.filter(Boolean).length;

  const register = () => {
    const n = state.features.filter(f => f.id.startsWith('FEAT-NEW')).length + 1;
    const id = `FEAT-NEW-${String(n).padStart(3, '0')}`;
    dispatch({ t: 'ADD_FEATURE', f: { id, level: 'L2', displayName: name || '신규 Feature', domain: 'Body', ownerOrg: owner, lifecycle: 'Proposed', safety: 'QM', security: 'Low', deployType: 'TBD' } });
    dispatch({ t: 'AUDIT', entry: { ts: '2026-06-05 08:30', actor: state.role, action: 'REGISTER', target: id, detail: `7-criteria ${cnt}/7` } });
    nav('/catalog');
  };

  return (
    <div>
      <div className="breadcrumb">기준정보 ▸ Feature Definition Wizard</div>
      <h1 className="page-title">Feature 등록 (7-criteria)</h1>
      <div className="card">
        <Steps steps={['Candidate', '7 Criteria', '필수 속성', '등록 결정']} current={step} />
        <div className="mt" />
        {step===0 && <input placeholder="후보 기능명 (예: BDC Policy Control)" value={name} onChange={e=>setName(e.target.value)} style={{width:'100%',padding:8,border:'1px solid var(--line)',borderRadius:6}}/>}
        {step===1 && <div className="row" style={{ alignItems: 'center' }}>
          <div style={{ flex: 1 }}>{criteria.map((c,i)=>(<label key={c} style={{display:'block',padding:'4px 0'}}><input type="checkbox" checked={checked[i]} onChange={()=>setChecked(p=>p.map((v,j)=>j===i?!v:v))}/> {c}</label>))}<p className="small">충족 {cnt}/7 {cnt>=4?'✅ Feature 후보':'— BOM 하위/보류'}</p></div>
          <div style={{ textAlign: 'center' }}><RadialProgress size={120} color={cnt>=4?'#1F9D55':'#D9822B'} value={Math.round(cnt/7*100)} label={`${cnt}/7 기준`} /></div>
        </div>}
        {step===2 && <div className="kv" style={{maxWidth:480}}><div>Owner</div><div><input value={owner} onChange={e=>setOwner(e.target.value)} style={{padding:6,width:'100%'}}/></div><div>Verification</div><div><input defaultValue="HIL" style={{padding:6,width:'100%'}}/></div><div>Applicability</div><div><input defaultValue="KR" style={{padding:6,width:'100%'}}/></div></div>}
        {step===3 && <div>
          <div className="decision RELEASE" style={{background:'#EAF2FF',color:'var(--brand)',border:'1px solid var(--brand)'}}>{cnt>=4?`Feature 등록 가능 (Lifecycle=Proposed) — "${name||'신규'}"`:'기준 미달 → BOM 하위요소 / 보류'}</div>
          {cnt>=4 && (name.trim()
            ? <button className="btn primary mt" onClick={register}>등록 확정 → Catalog</button>
            : <p className="small mt" style={{color:'var(--fail)'}}>※ Candidate 단계에서 기능명 입력 필수</p>)}
        </div>}
        <div className="mt"><button className="btn" disabled={step===0} onClick={()=>setStep(s=>s-1)}>← 이전</button>{' '}<button className="btn primary" disabled={step===3} onClick={()=>setStep(s=>s+1)}>다음 →</button></div>
      </div>
    </div>
  );
}

export function ArtifactCatalog() {
  const nav = useNavigate();
  const [sel, setSel] = useState<any>(null);
  const rows = artifacts.filter(a => ['Requirement', 'SWComponent', 'ECU', 'APIService', 'Signal', 'DTC'].includes(a.kind));
  const linkedFeatures = (id: string) => relations.filter(r => r.target === id || r.source === id).map(r => (r.source.startsWith('FEAT') ? r.source : r.target));
  return (
    <div>
      <div className="breadcrumb">기준정보 ▸ Artifact Catalog</div>
      <h1 className="page-title">Artifact Catalog</h1>
      <p className="page-sub">행 클릭 → 산출물 상세·연결 Feature</p>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 250, alignItems: 'center' }}><b>Kind 분포</b>
          <Donut size={130} center={`${rows.length}`} segments={dist(tally(rows, a => a.kind))} />
        </div>
        <div className="col card" style={{ flex: 2 }}><b>Kind별 산출물 수</b><div className="mt"><Bars data={tally(rows, a => a.kind)} /></div></div>
      </div>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>ID</th><th>Kind</th><th>Name</th></tr></thead>
        <tbody>{rows.map(a => (
          <tr key={a.id} role="button" tabIndex={0} onClick={() => setSel(a)} onKeyDown={e => { if (e.key === 'Enter') setSel(a); }}><td className="mono">{a.id}</td><td>{a.kind}</td><td>{a.displayName}</td></tr>))}</tbody></table></div></div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.id || ''}>
        {sel && <div><div className="kv">
          <div>Kind</div><div>{sel.kind}</div><div>Name</div><div>{sel.displayName}</div>
          <div>source_system</div><div>ALM/PLM</div><div>verification</div><div><span className="pill">linked</span></div>
          {sel.meta?.version && <><div>version</div><div className="mono">{sel.meta.version}</div></>}
        </div>
          <p className="mt small"><b>연결 Feature</b></p>
          {[...new Set(linkedFeatures(sel.id))].map(f => <button key={f} className="btn" onClick={() => nav(`/feature/${f}`)}>{f} →</button>)}
        </div>}
      </RightPanel>
    </div>
  );
}

export function ControlPointCatalog() {
  const [sel, setSel] = useState<any>(null);
  const rows = [...artifacts.filter(a => a.kind === 'ControlPoint').map(a => ({ id: a.id, type: a.id.includes('KILL') ? 'KILL' : 'POLICY', name: a.displayName })),
    { id: 'CP-BDC-001-SAFE', type: 'SAFE', name: 'Safe Default: disabled' }];
  return (
    <div>
      <div className="breadcrumb">기준정보 ▸ Control Point Catalog</div>
      <h1 className="page-title">Control Point Catalog</h1>
      <p className="page-sub">Flag·Policy·Kill·Safe Default — 행 클릭 → 상세</p>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 250, alignItems: 'center' }}><b>Control Point 유형</b>
          <Donut size={130} center={`${rows.length}`} segments={dist(tally(rows, c => c.type), { KILL: '#D64545', POLICY: '#0EA5E9', SAFE: '#1F9D55' })} />
        </div>
        <div className="col card" style={{ flex: 2 }}><b>유형별 수</b><div className="mt"><Bars data={tally(rows, c => c.type)} /></div></div>
      </div>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>ID</th><th>Type</th><th>Name</th></tr></thead>
        <tbody>{rows.map(c => (
          <tr key={c.id} role="button" tabIndex={0} onClick={() => setSel(c)} onKeyDown={e => { if (e.key === 'Enter') setSel(c); }}><td className="mono">{c.id}</td><td><span className="pill">{c.type}</span></td><td>{c.name}</td></tr>))}</tbody></table></div></div>
      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.id || ''}>
        {sel && <div className="kv">
          <div>Type</div><div>{sel.type}</div><div>Name</div><div>{sel.name}</div>
          <div>귀속 Feature</div><div className="mono">FEAT-BDC-001 (T-002)</div>
          <div>Safe Default</div><div>disabled</div>
          <div>Rollback</div><div>RB-BDC-001 → previous stable</div>
          <div>비고</div><div className="small">{sel.type === 'KILL' ? '긴급 즉시 비활성화' : sel.type === 'SAFE' ? '평가 실패/오프라인 기본값' : '정책 기반 활성화 제어'}</div>
        </div>}
      </RightPanel>
    </div>
  );
}
