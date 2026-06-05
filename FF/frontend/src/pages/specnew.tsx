import { ReactNode, useEffect, useState } from 'react';
import { byFamily, familyName } from '../data/spec';
import { coverageOf, STATUS_COLOR } from '../data/specCoverage';
import { useToast, useApp } from '../store';
import TopoLink from '../components/TopoLink';

// ── 실동작 위젯 (store 연동) ──
function ExperimentWidget() {
  const { state, dispatch } = useApp();
  return (
    <div><b>실험 (store 연동)</b>
      <div className="row mt"><button className="btn primary" onClick={() => dispatch({ t: 'ADD_EXPERIMENT', exp: { id: `EXP-${1000 + state.experiments.length}`, feature: 'FEAT-BDC-001', variant: '신규 A/B', metric: '활성화율', status: 'Draft', uplift: 0 } })}>+ 실험 생성</button></div>
      <div className="table-wrap mt"><table><thead><tr><th>ID</th><th>Feature</th><th>Variant</th><th>Metric</th><th>Uplift</th><th>상태</th><th>제어</th></tr></thead>
        <tbody>{state.experiments.map(e => (<tr key={e.id}><td className="mono">{e.id}</td><td className="mono">{e.feature}</td><td>{e.variant}</td><td>{e.metric}</td>
          <td style={{ color: e.uplift > 0 ? 'var(--pass)' : 'var(--muted)' }}>{e.uplift ? '+' + e.uplift + '%' : '-'}</td>
          <td><span className="badge" style={{ background: e.status === 'Running' ? 'var(--pass)' : e.status === 'Stopped' ? 'var(--fail)' : 'var(--pending)' }}>{e.status}</span></td>
          <td>{e.status !== 'Running' ? <button className="btn" onClick={() => dispatch({ t: 'EXP_STATUS', id: e.id, status: 'Running' })}>▶ 시작</button> : <button className="btn danger" onClick={() => dispatch({ t: 'EXP_STATUS', id: e.id, status: 'Stopped' })}>■ 중단</button>}</td></tr>))}</tbody></table></div>
      <p className="small muted mt">안전 기준 미충족 시 실험 운영 차단(FR-EXP-003). 변경은 저장·유지됩니다.</p>
    </div>
  );
}
function ExceptionWidget() {
  const { state, dispatch } = useApp();
  return (
    <div><b>예외 정책 (긴급 우회·만료 관리)</b>
      <div className="row mt"><button className="btn primary" onClick={() => dispatch({ t: 'ADD_EXCEPTION', exc: { id: `EXC-2026-${100 + state.exceptions.length}`, feature: 'FEAT-BDC-001', reason: '긴급 우회', approver: state.role, expiry: '2026-06-20', active: true } })}>+ 예외 승인 요청</button></div>
      <div className="table-wrap mt"><table><thead><tr><th>ID</th><th>Feature</th><th>사유</th><th>승인자</th><th>만료</th><th>상태</th><th></th></tr></thead>
        <tbody>{state.exceptions.map(e => (<tr key={e.id}><td className="mono">{e.id}</td><td className="mono">{e.feature}</td><td>{e.reason}</td><td>{e.approver}</td><td>{e.expiry}</td>
          <td><span className="badge" style={{ background: e.active ? 'var(--pending)' : 'var(--muted)' }}>{e.active ? 'Active' : 'Revoked'}</span></td>
          <td>{e.active && <button className="btn" onClick={() => dispatch({ t: 'EXC_REVOKE', id: e.id })}>해제</button>}</td></tr>))}</tbody></table></div>
    </div>
  );
}
function ConflictWidget() {
  const { state } = useApp();
  const conflicts = state.edges.filter(e => e.type === 'excludes' || e.type === 'overrides');
  return (
    <div><b>정책 충돌 탐지 (excludes/overrides 자동 산출)</b>
      <div className="table-wrap mt"><table><thead><tr><th>Source</th><th>Type</th><th>Target</th><th>해소</th></tr></thead>
        <tbody>{conflicts.map(c => (<tr key={c.id}><td className="mono">{c.source}</td>
          <td><span className="badge" style={{ background: 'var(--fail)' }}>{c.type}</span></td><td className="mono">{c.target}</td>
          <td className="small">{c.type === 'overrides' ? '우선순위 상위 적용' : '동시활성 차단 → 배포 Gate 차단'}</td></tr>))}
          {!conflicts.length && <tr><td colSpan={4} className="muted">충돌 없음</td></tr>}</tbody></table></div>
      <p className="small muted mt">Edge Editor에서 excludes/overrides 추가 시 즉시 반영 (FR-CON · Topology Consistency).</p>
    </div>
  );
}

// 공통: spec 기반 신규 화면 — family FR 목록 + 대표 위젯 + 시뮬레이션 실행
function SpecScreen({ crumb, title, sub, families, widget }:
  { crumb: string; title: string; sub: string; families: string[]; widget?: ReactNode }) {
  const toast = useToast();
  const [prog, setProg] = useState(-1); // -1 idle, 0..100 running
  useEffect(() => { if (prog >= 0 && prog < 100) { const t = setTimeout(() => setProg(Math.min(100, prog + 20)), 200); return () => clearTimeout(t); } if (prog === 100) { toast(`${title} 시뮬레이션 완료`); const t = setTimeout(() => setProg(-1), 800); return () => clearTimeout(t); } }, [prog]);
  return (
    <div>
      <div className="breadcrumb">{crumb}</div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="page-title">{title}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => setProg(0)} disabled={prog >= 0 && prog < 100}>{prog >= 0 && prog < 100 ? `실행 중 ${prog}%` : '▶ 시뮬레이션'}</button>
          <TopoLink />
        </div>
      </div>
      <p className="page-sub">{sub}</p>
      {prog >= 0 && <div style={{ background: 'var(--surface-3)', borderRadius: 6, height: 8, marginBottom: 12 }}><div style={{ width: `${prog}%`, background: 'var(--brand)', height: '100%', borderRadius: 6, transition: 'width .2s' }} /></div>}
      {widget && <div className="card">{widget}</div>}
      {families.map(f => {
        const reqs = byFamily(f);
        if (!reqs.length) return null;
        const cov = coverageOf(f);
        return (
          <div className="card" key={f}>
            <b>{f} · {familyName(f)}</b> <span className="badge" style={{ background: STATUS_COLOR[cov.status] }}>{cov.status}</span> <span className="muted small">{reqs.length}건</span>
            <table className="mt"><thead><tr><th>FR ID</th><th>요구사항명</th><th>영역</th></tr></thead>
              <tbody>{reqs.map(r => <tr key={r.id}><td className="mono">{r.id}</td><td>{r.name}<div className="small muted">{r.desc}</div></td><td><span className="pill">{r.area || '-'}</span></td></tr>)}</tbody></table>
          </div>
        );
      })}
    </div>
  );
}

const W = (rows: [string, string][]) => (
  <table><tbody>{rows.map(([k, v], i) => <tr key={i}><td style={{ width: 180, color: 'var(--muted)' }}>{k}</td><td>{v}</td></tr>)}</tbody></table>
);

export const Experiment = () => <SpecScreen crumb="의사결정 ▸ 실험·효과검증" title="실험 · 효과 검증 (Experiments)" sub="타겟팅 · 효과 측정 · 안전 기준 기반 실험 운영 (FR-EXP)" families={['FR-EXP']} widget={<ExperimentWidget />} />;

export const Conflict = () => <SpecScreen crumb="의사결정 ▸ 정책 충돌" title="정책 충돌 탐지·해소 (Policy Conflict)" sub="중복·충돌 정책 자동 탐지 + 우선순위 해소 (FR-CON · Topology Consistency Rule 연계)" families={['FR-CON']} widget={<ConflictWidget />} />;

export const Exception = () => <SpecScreen crumb="의사결정 ▸ 예외 정책" title="예외 정책 관리 (Exception Policy)" sub="긴급 예외 승인 · 임시 우회 · 만료 자동 관리 (FR-EXC)" families={['FR-EXC']} widget={<ExceptionWidget />} />;

export const Compliance = () => <SpecScreen crumb="검증 ▸ 컴플라이언스" title="컴플라이언스 룰 체커 (Compliance)" sub="지역 법규·개인정보·안전/보안 룰 → 배포 전 자동 검증·차단 (FR-CRC)" families={['FR-CRC']}
  widget={<div><b>지역별 룰 체크 · FEAT-BDC-001</b>
    <div className="evt">✅ KR 개인정보 · 자동차관리법</div><div className="evt">✅ EU GDPR · UNECE R156</div><div className="evt">⛔ US — 적용 차단(Variant Blocked)</div>
  </div>} />;

export const Scenario = () => <SpecScreen crumb="검증 ▸ 시나리오 검증" title="차량 시나리오 검증 (Scenario)" sub="차종·상태·권한 조합 대량 시나리오 사전 실행 (FR-SCN · FR-SVL)" families={['FR-SCN', 'FR-SVL']}
  widget={W([['등록 시나리오', '128건 (KR/EU × Premium/Standard × Gen3)'], ['최근 실행', 'PASS 124 / FAIL 4'], ['연동 검증', 'Feature 활성화 흐름 데이터 전달 OK']])} />;

export const CICD = () => <SpecScreen crumb="배포·운영 ▸ CI/CD" title="CI/CD 파이프라인 · 품질 Gate" sub="SW배포/Feature출시 분리 · 단계적 배포 · 품질 Gate (FR-RDD/CICD/PDA/QGV)" families={['FR-RDD', 'FR-CICD', 'FR-PDA', 'FR-QGV']}
  widget={<div><b>파이프라인</b>
    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>{['Build', 'Verify', 'Package', 'Quality Gate', 'Staged Deploy(5→20→100)', 'Release'].map((s, i) => <span key={s} className="pill" style={{ background: i < 4 ? 'var(--pass)' : '', color: i < 4 ? '#fff' : '' }}>{s}</span>)}</div>
    <p className="small muted mt">SW 배포 ≠ Feature 출시 분리 (FR-RDD-001)</p>
  </div>} />;

export const Billing = () => <SpecScreen crumb="연동 ▸ 과금" title="과금 시스템 연계 (Billing)" sub="구독·옵션 과금 · 사용량 정산 연계 (FR-BIL)" families={['FR-BIL']}
  widget={<div><b>구독·과금</b>
    <table className="mt"><thead><tr><th>Feature</th><th>권한</th><th>구독</th><th>사용량</th></tr></thead>
      <tbody><tr><td>FEAT-BDC-001</td><td>구독</td><td>Premium</td><td>142,300대</td></tr><tr><td>FEAT-PARK-001</td><td>옵션</td><td>ADAS Pack</td><td>38,200대</td></tr></tbody></table>
  </div>} />;

export const Business = () => <SpecScreen crumb="분석 ▸ 글로벌·현장·사업" title="글로벌 출시 · 현장 지원 · 사업 지표" sub="권역/법규/브랜드 차등 · 판매·정비 포털 · 사업 KPI (FR-GLB/FSP/BIZ)" families={['FR-GLB', 'FR-FSP', 'FR-BIZ']}
  widget={<div className="kpis">
    <div className="kpi"><div className="v">3권역</div><div className="l">KR·EU·US 차등 정책</div></div>
    <div className="kpi"><div className="v">78%</div><div className="l">기능 활성화율</div></div>
    <div className="kpi"><div className="v">-32%</div><div className="l">출시 리드타임</div></div>
  </div>} />;

export const Security = () => <SpecScreen crumb="관리자 ▸ 보안 운영" title="보안 운영 (Security Ops)" sub="안전 요구사항 추적 · 보안 배포 · 인증·키 · 취약점 · 이상징후 (보안 family)" families={['FR-SRT', 'FR-SDM', 'FR-CIV', 'FR-VHM', 'FR-SVS', 'FR-PVL']}
  widget={<div><b>보안 현황</b>
    <div className="evt">🔐 정책 서명·무결성 검증: 적용</div><div className="evt">📜 인증서/키 수명주기: 정상 (만료 임박 0)</div><div className="evt">⚠️ 취약점 모니터링: Medium 1건 추적 중</div>
  </div>} />;
