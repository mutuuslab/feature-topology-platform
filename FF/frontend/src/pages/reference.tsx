import { useMemo, useState } from 'react';
import {
  SPEC_BASELINE, SPEC_DATE, SPEC_MENU_BASELINE, SPEC_P0_BASELINE,
  SPEC_VERSIONS, SPEC_COUNTS, SPEC_COVERAGE,
} from '../data/specNav';
import { platformGlossary } from '../data/platformGlossary';

// 기준 문서(AR/SW/UX/…) 라벨 — 산출물 패키지 파일 체계와 일치
const DOC_LABEL: Record<string, string> = {
  AR: '아키텍처 요구사양 (Architecture Requirements)',
  SW: '소프트웨어 상세설계 (Detailed Design)',
  UX: 'UX 설계 (UX Design)',
  TD: '기술설계 (Technical Design)',
  UI: '화면 설계 (Screen Design)',
  UIHTML: '화면 HTML (Screen HTML)',
  MENU: '메뉴 인벤토리 (Menu Inventory)',
  FRI: 'Feature 등록 정보 사전 (Registration Dictionary)',
  OPA: '운영 속성 사전 (Operational Attributes)',
  AAOS: '차량 AAOS 연계 (Vehicle AAOS)',
};

// ── 참조 ▸ Change Log ─────────────────────────────
export function SpecChangeLog() {
  const rows = Object.entries(SPEC_VERSIONS);
  return (
    <div>
      <div className="breadcrumb">참조 ▸ Change Log</div>
      <h1 className="page-title">기준 개정 이력 (Change Log)</h1>
      <p className="page-sub">
        기준 패키지 {SPEC_BASELINE} · 메뉴 {SPEC_MENU_BASELINE} · 기준일 {SPEC_DATE}
      </p>
      <div className="kpis">
        <div className="kpi"><div className="v">{SPEC_COUNTS.groups}</div><div className="l">업무 그룹</div></div>
        <div className="kpi"><div className="v">{SPEC_COUNTS.screens}</div><div className="l">화면</div></div>
        <div className="kpi"><div className="v">{SPEC_COUNTS.submenus}</div><div className="l">상세 영역</div></div>
        <div className="kpi"><div className="v">{SPEC_COUNTS.tasks}</div><div className="l">Task</div></div>
      </div>
      <div className="card">
        <b>문서 버전</b>
        <table className="mt"><thead><tr><th>문서</th><th>버전</th></tr></thead>
          <tbody>{rows.map(([k, v]) => (
            <tr key={k}><td>{DOC_LABEL[k] || k}</td><td className="mono">{v}</td></tr>
          ))}</tbody></table>
      </div>
      <div className="card">
        <b>기준선</b>
        <div className="kv mt">
          <div>기준 패키지</div><div className="mono">{SPEC_BASELINE}</div>
          <div>메뉴 기준선</div><div className="mono">{SPEC_MENU_BASELINE}</div>
          <div>등록 사전 기준선</div><div className="mono">{SPEC_P0_BASELINE}</div>
          <div>기준일</div><div className="mono">{SPEC_DATE}</div>
          <div>구현 현황</div><div>부분 {SPEC_COVERAGE.part} · 설계 {SPEC_COVERAGE.design}</div>
        </div>
      </div>
    </div>
  );
}

// ── 참조 ▸ Glossary ──────────────────────────────
export function SpecGlossary() {
  const [q, setQ] = useState('');
  const merged = useMemo(
    () => [...platformGlossary].sort((a, b) => a.term.localeCompare(b.term)),
    [],
  );
  const rows = merged.filter(g => !q
    || g.term.toLowerCase().includes(q.toLowerCase())
    || g.def.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="breadcrumb">참조 ▸ Glossary</div>
      <h1 className="page-title">용어집 ({merged.length})</h1>
      <p className="page-sub">Feature 플랫폼 용어 · 검색·정렬</p>
      <div className="card">
        <input placeholder="🔍 용어·정의 검색" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', maxWidth: 360, padding: 8, border: '1px solid var(--line)', borderRadius: 6, marginBottom: 10 }} />
        <div className="table-wrap"><table><thead><tr><th>용어</th><th>정의</th></tr></thead>
          <tbody>{rows.map((g, i) => (
            <tr key={i}><td><b>{g.term}</b></td><td className="small">{g.def}</td></tr>
          ))}</tbody></table></div>
        {!rows.length && <p className="muted small mt">검색 결과 없음</p>}
      </div>
    </div>
  );
}
