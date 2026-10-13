import { LEGACY_PAL } from '../design/legacy-palette';
// 공통 UI 컴포넌트 — 상태/라이프사이클/배포 배지, Health
export function GateBadge({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{status}</span>;
}
export function LifecycleBadge({ value }: { value: string }) {
  const map: any = { Proposed:LEGACY_PAL['lg-8895a7'], Approved:LEGACY_PAL['lg-3b82f6'], Developing:LEGACY_PAL['lg-6366f1'], Verified:LEGACY_PAL['lg-0ea5e9'], Released:LEGACY_PAL['lg-1f9d55'], Retired:LEGACY_PAL['lg-9ca3af'] };
  return <span className="badge" style={{ background: map[value] || LEGACY_PAL['lg-9ca3af'] }}>{value}</span>;
}
export function DeployBadge({ value }: { value: string }) {
  const map: any = { Binary:LEGACY_PAL['lg-7c3aed'], 'Policy-only':LEGACY_PAL['lg-0ea5e9'], Calibration:LEGACY_PAL['lg-d9822b'], Manual:LEGACY_PAL['lg-d64545'], TBD:LEGACY_PAL['lg-9ca3af'] };
  return <span className="badge" style={{ background: map[value] || LEGACY_PAL['lg-9ca3af'] }}>{value}</span>;
}
export function Health({ n }: { n: number }) {
  const color = n >= 6 ? 'var(--pass)' : n >= 4 ? 'var(--pending)' : 'var(--fail)';
  const mark = n >= 6 ? '✓' : n >= 4 ? '⚠' : '✗';
  return <span style={{ color, fontWeight: 600 }}>{n}/6 {mark}</span>;
}

// ── Consistency Rule Severity (출처: PPT S14 · B=blocking/W=warning/I=info) ──
export const SEVERITY: Record<string, { label: string; ko: string; color: string; desc: string; why: string }> = {
  B: { label: 'Blocking', ko: '차단', color: LEGACY_PAL['lg-d64545'], desc: '구조 완전성·안전·릴리스 게이트에 직결되는 위반', why: '미해소 시 데이터 무결성·안전을 보장할 수 없어 릴리스/양산 활성화를 강제 차단' },
  W: { label: 'Warning', ko: '경고', color: LEGACY_PAL['lg-d9822b'], desc: '품질·추적성 권장사항 미충족', why: '진행은 가능하나 리스크가 누적되므로 검토·보완 권장' },
  I: { label: 'Info', ko: '정보', color: LEGACY_PAL['lg-3b82f6'], desc: '위반이 아닌 자동 처리·영향분석 대상 안내', why: '조치는 불필요하며 인지(awareness)용 정보' },
};
// 코드(B/W/I) 또는 풀네임(blocking…)·라벨 무엇이 들어와도 메타로 정규화
export function severityMeta(v: string) {
  if (SEVERITY[v]) return SEVERITY[v];
  const k = Object.keys(SEVERITY).find(c => SEVERITY[c].label.toLowerCase() === String(v).toLowerCase());
  return k ? SEVERITY[k] : { label: String(v), ko: '', color: LEGACY_PAL['lg-9ca3af'], desc: '', why: '' };
}

export function SeverityBadge({ code }: { code: string }) {
  const m = severityMeta(code);
  return <span className="badge" style={{ background: m.color }} title={`${m.label} · ${m.desc}`}>{m.label}{SEVERITY[code] ? `(${code})` : ''}</span>;
}

export function SeverityLegend() {
  return (
    <div>
      {(['B', 'W', 'I'] as const).map(c => { const m = SEVERITY[c]; return (
        <div key={c} className="evt" style={{ alignItems: 'flex-start' }}>
          <span className="badge" style={{ background: m.color, minWidth: 92, textAlign: 'center' }}>{m.label}({c})</span>
          <span className="small"><b>{m.ko}</b> · {m.desc}<br /><span className="muted">왜? {m.why}</span></span>
        </div>
      ); })}
      <p className="small muted mt">처리 정책: <b style={{ color: SEVERITY.B.color }}>Blocking</b> 릴리스/활성화 차단 · <b style={{ color: SEVERITY.W.color }}>Warning</b> 검토 권장 · <b style={{ color: SEVERITY.I.color }}>Info</b> 인지용</p>
    </div>
  );
}
