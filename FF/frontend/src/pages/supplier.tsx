import { useNavigate } from 'react-router-dom';
import { supplierCost, fmtWon } from '../data/engine';
import { useToast, useApp } from '../store';
import { RadialProgress, Donut, Steps, tally, dist } from '../components/charts';

const PKG_ITEMS = [
  ['1 API Contract (OpenAPI/Protobuf)','valid'],['2 Human Documentation','valid'],
  ['3 Feature Mapping (Supplier↔OEM)','valid'],['4 Capability Manifest','valid'],
  ['5 Variant Compatibility','partial'],['6 Diagnostics/Telemetry','valid'],
  ['7 Safety/Security','valid'],['8 SDK/Stub/Mock','valid'],
  ['9 Test Evidence','partial'],['10 Release Note','valid'],
];

export function SupplierPortal() {
  const nav = useNavigate();
  const { state, dispatch } = useApp();
  const validCount = PKG_ITEMS.filter(([, s]) => s === 'valid').length;
  const pct = Math.round((validCount / (PKG_ITEMS.length || 1)) * 100);
  const acc = state.supplierAcceptance;
  const accepted = acc.filter(a => a.status === 'accepted').length;
  const accPct = Math.round(accepted / (acc.length || 1) * 100);
  return (
    <div>
      <div className="breadcrumb">협력사 ▸ Supplier Portal</div>
      <h1 className="page-title">Supplier Portal · SUP-BDC-A</h1>
      <p className="page-sub">협력사 전용 워크스페이스 (RBAC 외부 스코프)</p>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>패키지 준비율</b>
          <RadialProgress size={120} color={pct >= 100 ? '#1F9D55' : '#D9822B'} value={pct} label={`${validCount}/${PKG_ITEMS.length} valid`} /></div>
        <div className="col card" style={{ maxWidth: 220, alignItems: 'center' }}><b>책임·인수 승인율</b>
          <RadialProgress size={120} color={accPct >= 100 ? '#1F9D55' : '#D9822B'} value={accPct} label={`${accepted}/${acc.length} 승인`} /></div>
        <div className="col card"><b>담당 Feature</b><div className="evt"><span className="mono">FEAT-BDC-001</span><span className="muted">BDC Policy Control · BDC_FUNC_032</span></div>
          <button className="btn primary mt" onClick={() => nav('/supplier/package')}>패키지 인수 →</button></div>
      </div>

      <div className="card">
        <b>책임 범위 · 인수 기준 (FR-SUP)</b>
        <p className="small muted">OEM/Supplier 책임 구분 · 인수 기준 승인 흐름 (승인은 Audit 기록·저장)</p>
        <div className="table-wrap mt"><table><thead><tr><th>Feature</th><th>인수 기준 항목</th><th>책임</th><th>상태</th><th>승인</th></tr></thead>
          <tbody>{acc.map((a, i) => (<tr key={i}>
            <td className="mono">{a.feature}</td><td>{a.item}</td>
            <td><span className="pill" style={{ background: a.owner === 'Supplier' ? 'var(--brand)' : 'var(--surface-3)', color: a.owner === 'Supplier' ? '#fff' : 'var(--ink)' }}>{a.owner}</span></td>
            <td><span className="badge" style={{ background: a.status === 'accepted' ? 'var(--pass)' : 'var(--pending)' }}>{a.status === 'accepted' ? '승인' : '대기'}</span></td>
            <td>{a.status === 'pending' ? <button className="btn" onClick={() => dispatch({ t: 'ACCEPT_SUPPLIER', feature: a.feature, item: a.item })}>승인</button> : '✓'}</td></tr>))}</tbody></table></div>
        {accepted < acc.length
          ? <div className="decision HOLD mt">미승인 {acc.length - accepted}건 → Supplier Gate 불통과</div>
          : <div className="decision RELEASE mt" style={{ background: '#EAF2FF', color: 'var(--brand)', border: '1px solid var(--brand)' }}>전 항목 승인 완료 → Supplier Gate 통과</div>}
      </div>
    </div>
  );
}

export function APIReleasePackage() {
  const incomplete = PKG_ITEMS.filter(([,s])=>s==='partial').length;
  const valid = PKG_ITEMS.filter(([,s])=>s==='valid').length;
  const completionPct = Math.round((valid / (PKG_ITEMS.length || 1)) * 100);
  const statusCounts = tally(PKG_ITEMS, ([, s]) => s);
  const statusSegments = dist(statusCounts, { valid: '#1F9D55', partial: '#D9822B' });
  const toast = useToast();
  const nav = useNavigate();
  return (
    <div>
      <div className="breadcrumb">협력사 ▸ API Release Package</div>
      <h1 className="page-title">API Release Package Intake (10항목)</h1>
      <p className="page-sub">Mapped: FEAT-BDC-001 ↔ BDC_FUNC_032</p>
      <div className="row analytics-strip">
        <div className="col card" style={{ maxWidth: 230, alignItems: 'center' }}><b>인수 완료율</b>
          <RadialProgress size={120} color={completionPct >= 100 ? '#1F9D55' : '#D9822B'} value={completionPct} label={`${valid}/${PKG_ITEMS.length} valid`} /></div>
        <div className="col card"><b>항목 상태 분포</b>
          <Donut segments={statusSegments} center={String(PKG_ITEMS.length)} /></div>
      </div>
      <div className="card">
        {PKG_ITEMS.map(([name,status])=>(
          <div className="evt" key={name}><span style={{flex:1}}>{name}</span>
            <span className="badge" style={{background:status==='valid'?'var(--pass)':'var(--pending)'}}>{status==='valid'?'✅ valid':'🟠 partial'}</span></div>
        ))}
        <div className="decision HOLD mt">Supplier Gate (⑥): 🟠 {incomplete} items incomplete → 불통과</div>
        {(() => { const sc = supplierCost('SUP-BDC-A'); return sc && (
          <p className="small mt">💰 협력사 개발비(추정): {sc.contractMM} M/M · <b className="mono">{fmtWon(sc.contractWon)}</b> <span className="muted">— {sc.note}</span></p>
        ); })()}
        <button className="btn mt" onClick={() => toast(incomplete ? `패키지 검증: ${incomplete}건 미완 → Supplier Gate 불통과` : '패키지 검증 통과 → Supplier Gate 통과', incomplete ? 'warn' : 'ok')}>Validate</button> <button className="btn primary mt" onClick={() => nav('/decisions/supplier')}>Run Supplier Engine →</button>
      </div>
    </div>
  );
}

export function PackageDetail() {
  return (
    <div>
      <div className="breadcrumb">협력사 ▸ Package Detail</div>
      <h1 className="page-title">Package Detail · BDC_FUNC_032</h1>
      <div className="card"><b>매핑 경로</b>
        <Steps done steps={['FEAT-BDC-001', 'BDC_FUNC_032', 'SWC-BDC-ADAPTER', 'ECU-BDC', 'API-BDC-POLICY-CONTROL', 'HIL-BDC-001', 'Acceptance']} />
        <div className="mono small mt">FEAT-BDC-001 → BDC_FUNC_032 → SWC-BDC-ADAPTER → ECU-BDC → API-BDC-POLICY-CONTROL → HIL-BDC-001 → Acceptance(API v1.5 준수)</div>
      </div>
    </div>
  );
}
