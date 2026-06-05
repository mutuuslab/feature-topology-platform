import { useNavigate } from 'react-router-dom';
import SpecLink from '../components/SpecLink';
import { supplierCost, fmtWon } from '../data/engine';
import { useToast } from '../store';

const PKG_ITEMS = [
  ['1 API Contract (OpenAPI/Protobuf)','valid'],['2 Human Documentation','valid'],
  ['3 Feature Mapping (Supplier↔OEM)','valid'],['4 Capability Manifest','valid'],
  ['5 Variant Compatibility','partial'],['6 Diagnostics/Telemetry','valid'],
  ['7 Safety/Security','valid'],['8 SDK/Stub/Mock','valid'],
  ['9 Test Evidence','partial'],['10 Release Note','valid'],
];

export function SupplierPortal() {
  const nav = useNavigate();
  return (
    <div>
      <div className="breadcrumb">협력사 ▸ Supplier Portal</div>
      <h1 className="page-title">Supplier Portal · SUP-BDC-A</h1>
      <p className="page-sub">협력사 전용 워크스페이스 (RBAC 외부 스코프)</p>
      <div className="row">
        <div className="col card"><b>담당 Feature</b><div className="evt"><span className="mono">FEAT-BDC-001</span><span className="muted">BDC Policy Control · BDC_FUNC_032</span></div></div>
        <div className="col card"><b>패키지 상태</b><p>2/10 항목 미완 → Supplier Gate 불통과</p><button className="btn primary" onClick={()=>nav('/supplier/package')}>패키지 인수 →</button></div>
      </div>
    </div>
  );
}

export function APIReleasePackage() {
  const incomplete = PKG_ITEMS.filter(([,s])=>s==='partial').length;
  const toast = useToast();
  return (
    <div>
      <div className="breadcrumb">협력사 ▸ API Release Package</div>
      <h1 className="page-title">API Release Package Intake (10항목)</h1>
      <p className="page-sub">Mapped: FEAT-BDC-001 ↔ BDC_FUNC_032</p>
      <SpecLink families={['FR-SPM']} />
      <div className="card">
        {PKG_ITEMS.map(([name,status])=>(
          <div className="evt" key={name}><span style={{flex:1}}>{name}</span>
            <span className="badge" style={{background:status==='valid'?'var(--pass)':'var(--pending)'}}>{status==='valid'?'✅ valid':'🟠 partial'}</span></div>
        ))}
        <div className="decision HOLD mt">Supplier Gate (⑥): 🟠 {incomplete} items incomplete → 불통과</div>
        {(() => { const sc = supplierCost('SUP-BDC-A'); return sc && (
          <p className="small mt">💰 협력사 개발비(추정): {sc.contractMM} M/M · <b className="mono">{fmtWon(sc.contractWon)}</b> <span className="muted">— {sc.note}</span></p>
        ); })()}
        <button className="btn mt" onClick={() => toast(`패키지 검증: ${incomplete}건 미완 → Supplier Gate 불통과`, incomplete ? 'warn' : 'ok')}>Validate</button> <button className="btn primary mt" onClick={() => toast('Supplier Engine 실행 → SUP-BDC-A 책임범위 산출')}>Run Supplier Engine</button>
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
        <div className="mono small mt">FEAT-BDC-001 → BDC_FUNC_032 → SWC-BDC-ADAPTER → ECU-BDC → API-BDC-POLICY-CONTROL → HIL-BDC-001 → Acceptance(API v1.5 준수)</div>
      </div>
    </div>
  );
}
