import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { taxonomyTree } from '../data/refdata';
import { artifacts, baseRef, relations } from '../data/model';
import {
  ARTIFACT_RECORDS, BOM_AREAS, BOM_AREA_KO, CONTROL_POINTS, FLAG_BINDINGS, FLAG_PURPOSES, IMPLEMENTATION_BOMS, RUNTIME_BINDINGS,
  SOURCE_SYNC, VIOLATIONS, artifactStats, controlPointStats, deliveryLabel, kindLabel, roleLabel,
  type ArtifactRecord, type ControlPointRecord,
} from '../data/implementation';
import { groupDigest, shortDigest } from '../data/sha256';
import { useApp, useToast } from '../store';
import { GButton, RightPanel } from '../components/patterns';
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
  'Safety/Security': ['Rule'], Operation: ['TelemetryEvent', 'ObservationPoint'],
};

export function BOMEditor() {
  const { dispatch, state } = useApp();
  const nav = useNavigate();
  const areas = Object.keys(AREA_KINDS);
  const [active, setActive] = useState('Requirement');
  const [added, setAdded] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState<{ type: string; area: string; detail: string }[]>([]);

  const kinds = AREA_KINDS[active] || [];
  const base = relations.map(r => artifacts.find(a => a.id === baseRef(r.target))).filter((a: any) => a && kinds.includes(a.kind)) as any[];
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
          const baseN = relations.map(r => artifacts.find(x => x.id === baseRef(r.target))).filter((x: any) => x && k.includes(x.kind)).length;
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

// ── UI03 Feature별 구현 구성 — 구현 Artifact 레지스트리 ──
// 화면 계약: MODEL Artifact 필수 필드를 그대로 보여주고, 위반은 필드에서 계산한다(설명문 아님).
export function ArtifactCatalog() {
  const nav = useNavigate();
  const toast = useToast();
  const { state, dispatch } = useApp();
  const [sel, setSel] = useState<ArtifactRecord | null>(null);
  const [kind, setKind] = useState('ALL');
  const [res, setRes] = useState('ALL');
  const [sys, setSys] = useState('ALL');
  const [q, setQ] = useState('');

  const rows = ARTIFACT_RECORDS.filter(a =>
    (kind === 'ALL' || a.artifactKind === kind)
    && (res === 'ALL' || a.resolution === res)
    && (sys === 'ALL' || a.sourceRef.system === sys)
    && (!q || `${a.id} ${a.name} ${a.artifactId} ${a.version}`.toLowerCase().includes(q.toLowerCase())));

  const st = artifactStats(ARTIFACT_RECORDS);
  const violationsOf = (id: string) => VIOLATIONS.filter(v => v.target === id);

  const reResolve = () => {
    dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:12', actor: state.role, action: 'ARTIFACT_RESOLVE', target: `${sys === 'ALL' ? 'ALM·PLM·Git·CI' : sys}`, detail: `원천 재해석 요청 ${rows.length}건` } });
    toast(`원천 재해석 요청 접수 — ${rows.length}건 (미해석 ${rows.filter(a => a.resolution === 'UNRESOLVED').length}건 포함)`);
  };

  return (
    <div>
      <div className="breadcrumb">구성과 PLM ▸ UI03 Feature별 구현 구성 ▸ Artifact 레지스트리</div>
      <h1 className="page-title">Artifact 레지스트리 — FEAT-BDC-001@1.1.0</h1>
      <p className="page-sub">
        정확 버전·digest·배치 기준 구성 — 승인 차단 <b style={{ color: 'var(--fail)' }}>{VIOLATIONS.filter(v => v.blocking && v.code === 'UNRESOLVED_ARTIFACT').length}건</b> (미해석 Artifact)
      </p>

      <div className="card" style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <b className="small">원천 동기화</b>
        {SOURCE_SYNC.map(s => (
          <span key={s.system} className="small">
            <span className="pill" style={s.state === 'STALE' ? { background: 'var(--pending)', color: '#fff' } : {}}>{s.system}</span>{' '}
            {s.detail} <span className="muted">· {s.at}</span>
          </span>
        ))}
        {SOURCE_SYNC.some(s => s.state === 'STALE') && <span className="small" style={{ color: 'var(--pending)' }}>⚠ CI 원천 지연 — 승인 참조 시 재수집 필요</span>}
      </div>

      <div className="kpis mt">
        <div className="kpi"><div className="v">{st.total}</div><div className="l">Artifact 전체</div></div>
        <div className="kpi"><div className="v">{st.resolved}</div><div className="l">RESOLVED (승인 가능)</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--fail)' }}>{st.unresolved}</div><div className="l">UNRESOLVED → 승인 차단</div></div>
        <div className="kpi"><div className="v">{st.deployable}</div><div className="l">배포 콘텐츠</div></div>
        <div className="kpi"><div className="v">{st.physical}</div><div className="l">물리 설치 (HW)</div></div>
      </div>

      <div className="card mt">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={sys} onChange={e => setSys(e.target.value)} style={{ padding: 6 }} aria-label="원천 시스템">
            <option value="ALL">원천 전체</option>
            {['ALM', 'PLM', 'Git', 'CI'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={kind} onChange={e => setKind(e.target.value)} style={{ padding: 6 }} aria-label="Artifact kind">
            <option value="ALL">kind 전체</option>
            {[...new Set(ARTIFACT_RECORDS.map(a => a.artifactKind))].map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <select value={res} onChange={e => setRes(e.target.value)} style={{ padding: 6 }} aria-label="resolution">
            <option value="ALL">resolution 전체</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="UNRESOLVED">UNRESOLVED</option>
          </select>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Artifact ID · artifactId · 이름 · 버전" style={{ padding: 6, minWidth: 240 }} />
          <span className="muted small">{rows.length} / {ARTIFACT_RECORDS.length}건</span>
          <span style={{ flex: 1 }} />
          <GButton verb="edit" onClick={reResolve}>원천 재해석 실행</GButton>
          <GButton verb="approve" onClick={() => nav('/ui/UI04')}>BOM 기준선에서 승인 심사 →</GButton>
        </div>
      </div>

      <div className="card mt"><div className="table-wrap"><table>
        <thead><tr>
          <th>Artifact</th><th>artifactKind</th><th>정확 version</th><th>resolution</th>
          <th>contentDigest</th><th>delivery</th><th>배포 콘텐츠</th><th>sourceRef</th><th>위반</th>
        </tr></thead>
        <tbody>{rows.map(a => {
          const vs = violationsOf(a.id);
          return (
            <tr key={a.id} role="button" tabIndex={0} onClick={() => setSel(a)} onKeyDown={e => { if (e.key === 'Enter') setSel(a); }}>
              <td><div className="mono">{a.id}</div><div className="muted small">{a.name}</div></td>
              <td><span className="pill">{a.artifactKind}</span></td>
              <td className="mono">{a.version}</td>
              <td><span className="pill" style={a.resolution === 'UNRESOLVED' ? { background: 'var(--fail)', color: '#fff' } : { background: 'var(--pass)', color: '#fff' }}>{a.resolution}</span></td>
              <td className="mono small" title={a.contentDigest}>{shortDigest(a.contentDigest)}</td>
              <td className="small">{a.delivery === 'PHYSICAL_INSTALL' ? '물리 설치' : a.delivery === 'OTA' ? 'OTA' : '참조 전용'}</td>
              <td>{a.deploymentContent ? '예' : '아니오'}</td>
              <td className="small muted">{a.sourceRef.system} · {a.sourceRef.object}@{a.sourceRef.version}</td>
              <td>{vs.length ? <span className="pill" style={{ background: vs.some(v => v.blocking) ? 'var(--fail)' : 'var(--pending)', color: '#fff' }}>{vs.length}</span> : <span className="muted small">—</span>}</td>
            </tr>
          );
        })}</tbody>
      </table></div></div>

      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.id || ''}>
        {sel && <div>
          <div className="kv">
            <div>id</div><div className="mono">{sel.id}</div>
            <div>artifactId</div><div className="mono">{sel.artifactId} <span className="muted small">— 공유 재사용 가능</span></div>
            <div>version</div><div className="mono">{sel.version} <span className="muted small">— 정확 버전(latest·범위 금지)</span></div>
            <div>artifactKind</div><div>{sel.artifactKind}</div>
            <div>resolution</div><div>{sel.resolution}{sel.resolution === 'UNRESOLVED' && <span className="small" style={{ color: 'var(--fail)' }}> → 이 구성을 포함한 승인 차단</span>}</div>
            <div>sourceRef</div><div className="mono small">{sel.sourceRef.system} / {sel.sourceRef.object} / {sel.sourceRef.version}</div>
            <div>delivery</div><div>{deliveryLabel[sel.delivery]}{sel.artifactKind === 'HW' && <span className="small" style={{ color: 'var(--fail)' }}> · OTA 전송 대상 지정 금지</span>}</div>
            <div>배포 콘텐츠</div><div>{sel.deploymentContent ? '예 — 실행 패키지에 포함' : '아니오 — 참조 전용'}</div>
            <div>Feature 버전</div><div className="mono">{sel.featureVersionRef}</div>
          </div>
          <p className="mt small"><b>contentDigest (SHA-256 · 64자리 원문)</b></p>
          <div className="mono small" style={{ wordBreak: 'break-all', background: 'var(--surface-2)', padding: 8, borderRadius: 6 }}>{groupDigest(sel.contentDigest)}</div>

          <p className="mt small"><b>구현 구성 참조</b></p>
          {IMPLEMENTATION_BOMS.filter(b => b.artifactRefs.includes(`${sel.id}@${sel.version}`)).map(b => (
            <div key={b.id} className="small">
              <span className="mono">{b.id}</span> v{b.version} · sourceProfile {b.sourceProfile} · 항목 {b.items.filter(i => i.presence === 'PRESENT').length}/{BOM_AREAS.length} 영역 해당
              {b.predecessor && <span className="muted"> · predecessor {b.predecessor}</span>}
            </div>
          ))}
          {!IMPLEMENTATION_BOMS.some(b => b.artifactRefs.includes(`${sel.id}@${sel.version}`)) && (
            <p className="small" style={{ color: 'var(--fail)' }}>IMPLEMENTATION_ITEM_DRIFT — 어느 구현 구성도 이 정확 버전을 참조하지 않음</p>
          )}

          <p className="mt small"><b>검증 결과</b></p>
          {violationsOf(sel.id).length
            ? violationsOf(sel.id).map(v => (
              <div key={v.code} className="small" style={{ color: v.blocking ? 'var(--fail)' : 'var(--pending)' }}>
                {v.blocking ? '⛔' : '⚠'} <span className="mono">{v.code}</span> — {v.detail}
              </div>))
            : <p className="small" style={{ color: 'var(--pass)' }}>✓ 위반 없음 — 승인 참조 가능</p>}

          <p className="mt small"><b>연결 Feature</b></p>
          {[...new Set(relations
            .filter(r => baseRef(r.target) === sel.id || r.source === sel.id)
            // 산출물끼리의 관계도 있으므로 양 끝점을 모두 보고 Feature 쪽만 고른다.
            .map(r => (r.source.startsWith('FEAT') ? r.source : baseRef(r.target)))
            .filter(f => f.startsWith('FEAT')))].map(f => (
            <button key={f} className="btn" onClick={() => nav(`/feature/${f}`)}>{f} →</button>
          ))}
        </div>}
      </RightPanel>
    </div>
  );
}

// ── UI02-S04 구현과 제어 — ControlPoint 레지스트리 ──
// FeatureVersion → ControlPoint → FlagBinding → RuntimeBinding 을 연결하고, 제어 계약 필수 필드와
// Guard/Binding 위반을 필드에서 계산해 보여준다. 활성화 기본값을 OFF 로 두는 규칙은 없다.
export function ControlPointCatalog() {
  const nav = useNavigate();
  const toast = useToast();
  const { state, dispatch } = useApp();
  const [sel, setSel] = useState<ControlPointRecord | null>(null);
  const [kind, setKind] = useState('ALL');

  const rows = CONTROL_POINTS.filter(c => kind === 'ALL' || c.kind === kind);
  const st = controlPointStats();
  const violationsOf = (id: string) => VIOLATIONS.filter(v => v.target === id || v.target.includes(id));

  const verify = () => {
    dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:14', actor: state.role, action: 'CP_CONTRACT_VERIFY', target: `CP ${rows.length}건`, detail: `계약 필드 검증 · Guard/Binding 위반 ${VIOLATIONS.length}건` } });
    toast(`제어 계약 검증 완료 — 위반 ${VIOLATIONS.length}건 (차단 ${st.blocking}건)`);
  };
  const publish = () => {
    dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 10:15', actor: state.role, action: 'POLICY_PUBLISH_REQUEST', target: 'FEAT-BDC-001@1.1.0', detail: `ControlPoint ${CONTROL_POINTS.length}건 · FlagBinding ${st.flags}건 발행 요청` } });
    toast('정책 발행 요청 — 위반 해소 전에는 발행되지 않습니다', 'warn');
  };

  return (
    <div>
      <div className="breadcrumb">Feature 관리 ▸ UI02 Feature Registry ▸ UI02-S04 구현과 제어</div>
      <h1 className="page-title">Feature 제어점 · 실행 구성 — FEAT-BDC-001@1.1.0</h1>
      <p className="page-sub">
        FeatureVersion → ControlPoint → FlagBinding → RuntimeBinding · 호출 계약 <span className="mono small">/api/ui/v1/features/FEAT-BDC-001@1.1.0/control-points</span>
      </p>

      <div className="kpis">
        <div className="kpi"><div className="v">{st.total}</div><div className="l">제어점 전체</div></div>
        <div className="kpi"><div className="v">{st.kinds}</div><div className="l">종 구분 (FLAG·PARAM·SIGNAL·DTC·API)</div></div>
        <div className="kpi"><div className="v">{st.writeGuarded}/{st.write}</div><div className="l">쓰기 요청 · Guard 보유</div></div>
        <div className="kpi"><div className="v">{st.observe}</div><div className="l">관측 (제어 권한 없음)</div></div>
        <div className="kpi"><div className="v">{st.flags}</div><div className="l">FlagBinding</div></div>
        <div className="kpi"><div className="v">{st.runtimes}</div><div className="l">RuntimeBinding</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--fail)' }}>{st.blocking}</div><div className="l">차단 위반 (발행 불가)</div></div>
      </div>

      <div className="card mt">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="tabs">{['ALL', ...Object.keys(kindLabel)].map(k => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{k === 'ALL' ? '전체' : k}</button>
          ))}</div>
          <span style={{ flex: 1 }} />
          <GButton verb="run-engine" onClick={verify}>제어 계약 검증 실행</GButton>
          <GButton verb="deploy" onClick={publish}>정책 발행 요청</GButton>
        </div>
        <p className="small muted mt">
          Guard 확인 대상: 현재 차량 상태 · 사용 권리 · 서명 · TTL. RuntimeBinding 은 actuator 직접 쓰기 인터페이스를 제공하지 않는다.
        </p>
      </div>

      {VIOLATIONS.length > 0 && (
        <div className="card mt" style={{ borderColor: 'var(--fail)' }}>
          <b>발행 차단 사유 ({VIOLATIONS.length})</b>
          <div className="table-wrap mt"><table>
            <thead><tr><th>코드</th><th>대상</th><th>내용</th><th>차단</th></tr></thead>
            <tbody>{VIOLATIONS.map((v, i) => (
              <tr key={`${v.code}-${i}`}>
                <td className="mono small">{v.code}</td><td className="small">{v.target}</td>
                <td className="small">{v.detail}</td>
                <td><span className="pill" style={v.blocking ? { background: 'var(--fail)', color: '#fff' } : { background: 'var(--pending)', color: '#fff' }}>{v.blocking ? '차단' : '경고'}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div className="card mt"><div className="table-wrap"><table>
        <thead><tr>
          <th>제어점</th><th>kind</th><th>role</th><th>valueType</th><th>단위 · 허용 범위</th>
          <th>accessMode</th><th>bindingRef (정확 버전)</th><th>guardRef</th><th>flagClass</th><th>현재 관측값</th>
        </tr></thead>
        <tbody>{rows.map(c => (
          <tr key={c.id} role="button" tabIndex={0} onClick={() => setSel(c)} onKeyDown={e => { if (e.key === 'Enter') setSel(c); }}>
            <td className="mono">{c.id}</td>
            <td><span className="pill">{c.kind}</span></td>
            <td className="small">{roleLabel[c.role]}</td>
            <td className="small">{c.valueType}</td>
            <td className="small">{c.unit ? `${c.unit} · ${c.allowedRange ? `${c.allowedRange[0]}~${c.allowedRange[1]}` : '범위 미지정'}` : <span className="muted">—</span>}</td>
            <td className="small">{c.accessMode}</td>
            <td className="mono small">{c.bindingRef}</td>
            <td className="small">{c.guardRef ? <span className="mono">{c.guardRef}</span> : (c.role === 'WRITE_REQUEST' ? <span style={{ color: 'var(--fail)' }}>누락</span> : <span className="muted">—</span>)}</td>
            <td className="small">{c.flagClass ? <span className="pill">{c.flagClass.purpose}</span> : <span className="muted">—</span>}</td>
            <td className="mono small">{String(c.observedValue)}</td>
          </tr>
        ))}</tbody>
      </table></div></div>

      <RightPanel open={!!sel} onClose={() => setSel(null)} title={sel?.id || ''}>
        {sel && <div>
          <div className="kv">
            <div>kind</div><div>{sel.kind} <span className="muted small">— {kindLabel[sel.kind]}</span></div>
            <div>role</div><div>{roleLabel[sel.role]}</div>
            <div>valueType</div><div>{sel.valueType}</div>
            <div>unit</div><div>{sel.unit || <span className="muted">수치 아님</span>}</div>
            <div>allowedRange</div><div>{sel.allowedRange ? `${sel.allowedRange[0]} ~ ${sel.allowedRange[1]} ${sel.unit || ''}` : <span className="muted">—</span>}</div>
            <div>accessMode</div><div>{sel.accessMode}{sel.role === 'OBSERVE' && <span className="muted small"> — 관측 항목에 실행 제어 권한 부여 금지</span>}</div>
            <div>bindingRef</div><div className="mono small">{sel.bindingRef}</div>
            <div>guardRef</div><div className="mono small">{sel.guardRef || <span style={{ color: 'var(--fail)' }}>없음 — 쓰기 요청에 필수</span>}</div>
            <div>Feature 버전</div><div className="mono">{sel.featureVersionRef}</div>
            <div>현재 관측값</div><div className="mono">{String(sel.observedValue)}{sel.unit ? ` ${sel.unit}` : ''}</div>
          </div>

          {sel.flagClass ? (
            <>
              <p className="mt small"><b>flagClass (UL-009 FlagTypePolicy 6종)</b></p>
              <div className="kv">
                <div>purpose</div><div><span className="pill">{sel.flagClass.purpose}</span> {FLAG_PURPOSES.find(p => p.purpose === sel.flagClass!.purpose)?.ko}</div>
                <div>lifetimeDays</div><div>{sel.flagClass.lifetimeDays}{sel.flagClass.lifetimeDays === 0 && <span className="muted small"> — 기한 없음(정책 서명 만료 면제 아님)</span>}</div>
                <div>reviewDueAt</div><div className="mono">{sel.flagClass.reviewDueAt}</div>
                <div>ownerRef</div><div className="mono">{sel.flagClass.ownerRef}</div>
              </div>
            </>
          ) : <p className="mt small muted">Flag 가 아니므로 flagClass 없음 (수명·검토기한 미적용)</p>}

          <p className="mt small"><b>Binding 연결</b></p>
          {FLAG_BINDINGS.filter(f => f.controlPointRef === sel.id).map(f => (
            <div key={f.id} className="small" style={{ marginBottom: 6 }}>
              <div><span className="mono">{f.id}</span> · flagVersion <span className="mono">{f.flagVersionRef}</span> · tool <span className="mono">{f.toolBindingRef}</span></div>
              <div className="muted">적용 조건 <span className="mono">{f.applicabilityRef}</span> · 도구 기본 수명 {f.toolDefaultLifetimeDays}일 <span className="muted small">(OEM 값으로 승격 금지)</span></div>
              {RUNTIME_BINDINGS.filter(r => r.flagBindingRef === f.id).map(r => (
                <div key={r.id} className="muted">↳ <span className="mono">{r.id}</span> · bom <span className="mono">{r.bomRef}</span> · topology <span className="mono">{r.topologyRef}</span></div>
              ))}
            </div>
          ))}
          {!FLAG_BINDINGS.some(f => f.controlPointRef === sel.id) && <p className="small muted">FlagBinding 없음 — 관측·평가 전용 제어점</p>}

          <p className="mt small"><b>검증 결과</b></p>
          {violationsOf(sel.id).length
            ? violationsOf(sel.id).map(v => (
              <div key={v.code} className="small" style={{ color: v.blocking ? 'var(--fail)' : 'var(--pending)' }}>
                {v.blocking ? '⛔' : '⚠'} <span className="mono">{v.code}</span> — {v.detail}
              </div>))
            : <p className="small" style={{ color: 'var(--pass)' }}>✓ 계약 위반 없음</p>}

          <p className="mt small"><b>연결 화면</b></p>
          <button className="btn" onClick={() => nav('/ui/UI02/UI02-S04')}>UI02-S04 구현과 제어 →</button>
        </div>}
      </RightPanel>
    </div>
  );
}
