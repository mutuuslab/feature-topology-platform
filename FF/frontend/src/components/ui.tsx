// 공통 UI 컴포넌트 — 상태/라이프사이클/배포 배지, Health
export function GateBadge({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{status}</span>;
}
export function LifecycleBadge({ value }: { value: string }) {
  const map: any = { Proposed:'#8895A7', Approved:'#3B82F6', Developing:'#6366F1', Verified:'#0EA5E9', Released:'#1F9D55', Retired:'#9CA3AF' };
  return <span className="badge" style={{ background: map[value] || '#9CA3AF' }}>{value}</span>;
}
export function DeployBadge({ value }: { value: string }) {
  const map: any = { Binary:'#7C3AED', 'Policy-only':'#0EA5E9', Calibration:'#D9822B', Manual:'#D64545', TBD:'#9CA3AF' };
  return <span className="badge" style={{ background: map[value] || '#9CA3AF' }}>{value}</span>;
}
export function Health({ n }: { n: number }) {
  const color = n >= 6 ? 'var(--pass)' : n >= 4 ? 'var(--pending)' : 'var(--fail)';
  const mark = n >= 6 ? '✓' : n >= 4 ? '⚠' : '✗';
  return <span style={{ color, fontWeight: 600 }}>{n}/6 {mark}</span>;
}
