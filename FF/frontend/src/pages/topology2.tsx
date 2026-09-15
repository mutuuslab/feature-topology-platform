import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { metamodel, relationshipsList } from '../data/refdata';
import { consistency, wouldCycle } from '../data/engine';
import { useApp } from '../store';
import { RightPanel } from '../components/patterns';
import { Donut, Bars, tally, dist } from '../components/charts';
import { SeverityBadge, SeverityLegend, severityMeta } from '../components/ui';
import { Breadcrumb } from '../components/Breadcrumb';

const SEV_COLOR = { Blocking: '#D64545', Warning: '#D9822B', Info: '#3B82F6' };

const ENT_DESC: Record<string, { group: string; desc: string; attrs: string; rel: string }> = {
  Feature: { group: 'Master', desc: '고객/차량 동작 기능 단위(기준 L2)', attrs: 'id·level·owner·lifecycle·safety·deployType', rel: 'parent_of·implemented_by·verified_by…' },
  FeatureBOM: { group: 'Master', desc: '11영역 구성 목록', attrs: 'feature_id·baseline_ver', rel: 'contains BOMItem' },
  BOMItem: { group: 'Master', desc: 'Artifact 포인터+관계 메타', attrs: 'artifact_id·domain·criticality·evidence_uri', rel: 'belongs FeatureBOM' },
  Requirement: { group: 'Master', desc: '시스템/SW/보안 요구사항', attrs: 'kind·source_system·reqif_ref', rel: 'derives→Feature' },
  TaxonomyNode: { group: 'Master', desc: 'L0~L5 분류 노드', attrs: 'level·parent_id·node_type', rel: 'classifies Feature' },
  SWComponent: { group: 'Arch&IF', desc: 'SW 컴포넌트', attrs: 'ecu_id·supplier_id·version', rel: 'implemented_by(Feature)' },
  ECU: { group: 'Arch&IF', desc: '전자제어장치', attrs: 'hw_generation·capability', rel: 'hosts SWC' },
  APIService: { group: 'Arch&IF', desc: 'API 서비스', attrs: 'contract_uri·version·breaking', rel: 'uses_api(Feature)' },
  Signal: { group: 'Arch&IF', desc: 'CAN/API 신호', attrs: 'bus·api_field', rel: 'exposes' },
  DTC: { group: 'Arch&IF', desc: '진단 코드', attrs: 'diagnostic_event', rel: 'reports' },
  VariantRule: { group: 'Control&Deploy', desc: '구조적 적용조건', attrs: 'condition·dimensions·result', rel: 'applies_to' },
  ControlPoint: { group: 'Control&Deploy', desc: '제어점(Policy/Flag/Kill)', attrs: 'type·safe_default·rollback', rel: 'controlled_by' },
  DeploymentUnit: { group: 'Control&Deploy', desc: '배포 단위', attrs: 'deploy_type·package_ref·rollout', rel: 'deployed_as' },
  RollbackPlan: { group: 'Control&Deploy', desc: '복구 계획', attrs: 'target_state·trigger·guard', rel: 'recovers' },
  TestCase: { group: 'Verify&Ops', desc: '검증 케이스', attrs: 'method·mandatory_for', rel: 'verified_by' },
  TestEvidence: { group: 'Verify&Ops', desc: '검증 증적', attrs: 'result·coverage·uri', rel: 'produces' },
  SupplierFunction: { group: 'Verify&Ops', desc: '협력사 기능', attrs: 'supplier_id·oem_feature_id·acceptance', rel: 'realized_by' },
  TelemetryEvent: { group: 'Verify&Ops', desc: '운영 이벤트', attrs: 'event_type·cohort·ts', rel: 'emits_event' },
};

export function EdgeEditor() {
  const { state, dispatch } = useApp();
  const nav = useNavigate();
  const types = ['parent_of','child_of','composed_of','requires','excludes','overrides','fallback_to','degrades_to','replaces','duplicates'];
  const [source, setSource] = useState('FEAT-BDC-001');
  const [target, setTarget] = useState('FEAT-RUNTIME-001');
  const [type, setType] = useState('requires');
  const [err, setErr] = useState('');

  const save = () => {
    setErr('');
    if (source === target) { setErr('Source와 Target이 동일할 수 없습니다'); return; }
    if (wouldCycle(source, target, type)) { setErr(`EQ1 위반: ${type} 순환(No Cycle) 감지 — 저장 차단`); return; }
    const id = 'E' + (state.edges.length + 1);
    dispatch({ t: 'ADD_EDGE', e: { id, source, target, type: type as any } });
    nav(`/topology/${source}`);
  };

  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Edge Editor (Typed Edge)</h1>
      <div className="card">
        <div className="kv" style={{ maxWidth: 560 }}>
          <div>Source</div><div><select value={source} onChange={e=>setSource(e.target.value)} style={{padding:6,width:'100%'}}>{state.features.map(f=><option key={f.id}>{f.id}</option>)}</select></div>
          <div>Relationship</div><div><select value={type} onChange={e=>setType(e.target.value)} style={{padding:6}}>{types.map(t=><option key={t}>{t}</option>)}</select></div>
          <div>Target</div><div><select value={target} onChange={e=>setTarget(e.target.value)} style={{padding:6,width:'100%'}}>{state.features.map(f=><option key={f.id}>{f.id}</option>)}</select></div>
          <div>Criticality</div><div><select style={{padding:6}}><option>high</option><option>med</option><option>low</option></select></div>
        </div>
        <p className="small muted mt">저장 시 EQ1(No Cycle)·EQ2(Dependency Gate)·EQ3(Conflict)·EQ4(Recovery) 검증 — 순환 시 차단</p>
        {err && <div className="decision HOLD">{err}</div>}
        <button className="btn primary mt" onClick={save}>엣지 저장 (품질 규칙 검증)</button>
        <p className="small muted mt">예: FEAT-RUNTIME-001 → requires → FEAT-BDC-001 추가 시 순환 차단됨</p>
      </div>
      <div className="card"><b>현재 등록된 관계 타입 분포 ({state.edges.length})</b>
        <div className="mt"><Bars data={tally(state.edges, (e: any) => e.type)} /></div>
      </div>
    </div>
  );
}

export function ViolationDetail() {
  const all = consistency();
  const v = all[0];
  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Violation Detail</h1>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>전체 위반 Severity</b>
          <Donut size={120} center={`${all.length}`} segments={dist(tally(all, x => severityMeta(x.severity).label), SEV_COLOR)} />
        </div>
        <div className="col card"><b>Rule별 위반</b><div className="mt"><Bars data={tally(all, x => x.rule)} /></div></div>
      </div>
      <div className="card"><b>Severity 범례</b><div className="mt"><SeverityLegend /></div></div>
      <div className="card">
        {v ? <div className="kv">
          <div>Rule</div><div className="mono">{v.rule}</div>
          <div>Feature</div><div className="mono">{v.featureId}</div>
          <div>Severity</div><div><SeverityBadge code={v.severity} /> <span className="muted small">— {severityMeta(v.severity).why}</span></div>
          <div>Message</div><div>{v.message}</div>
          <div>해소</div><div><button className="btn">Open Feature</button> <button className="btn primary">Resolve</button></div>
        </div> : <p className="muted">위반 없음</p>}
      </div>
    </div>
  );
}

export function MetamodelViewer() {
  const [sel, setSel] = useState<string | null>(null);
  const d = sel ? ENT_DESC[sel] : null;
  return (
    <div>
      <Breadcrumb />
      <h1 className="page-title">Metamodel — 18 Entity / 4 Group</h1>
      <p className="page-sub">엔티티 클릭 → 속성·관계 상세</p>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>그룹별 엔티티</b>
          <Donut size={130} center={`${Object.values(metamodel).flat().length}`} segments={dist(Object.fromEntries(Object.entries(metamodel).map(([g, e]) => [g, (e as string[]).length])))} />
        </div>
        <div className="col card" style={{ flex: 2 }}><b>그룹별 엔티티 수</b>
          <div className="mt"><Bars data={Object.fromEntries(Object.entries(metamodel).map(([g, e]) => [g, (e as string[]).length]))} /></div>
        </div>
      </div>
      <div className="row">
        {Object.entries(metamodel).map(([group, ents]) => (
          <div className="col card" key={group}>
            <b>{group}</b>
            <ul className="small" style={{ listStyle: 'none', padding: 0 }}>{(ents as string[]).map(e => (
              <li key={e}><button className="pill mono" style={{ cursor: 'pointer', margin: '2px 0', border: '1px solid var(--line)' }} onClick={() => setSel(e)}>{e}</button></li>))}</ul>
          </div>
        ))}
      </div>
      <div className="card"><b>대표 Relationship (9)</b><div className="row mt">{relationshipsList.map(r => <span key={r} className="pill">{r}</span>)}</div></div>
      <RightPanel open={!!d} onClose={() => setSel(null)} title={sel ? `ENT-${sel}` : ''}>
        {d && <div className="kv">
          <div>Group</div><div>{d.group}</div>
          <div>설명</div><div>{d.desc}</div>
          <div>대표 속성</div><div className="mono small">{d.attrs}</div>
          <div>관계</div><div className="small">{d.rel}</div>
        </div>}
      </RightPanel>
    </div>
  );
}
