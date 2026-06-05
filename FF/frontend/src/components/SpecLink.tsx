import { useNavigate } from 'react-router-dom';
import { byFamily } from '../data/spec';
import { coverageOf, STATUS_COLOR } from '../data/specCoverage';

// 기존 화면에 "관련 FR" 칩 — 클릭 시 Spec Explorer로 해당 family 필터 이동
export default function SpecLink({ families }: { families: string[] }) {
  const nav = useNavigate();
  return (
    <div className="row" style={{ gap: 6, alignItems: 'center', margin: '4px 0 12px' }}>
      <span className="small muted">관련 기능명세(FR):</span>
      {families.map(f => {
        const n = byFamily(f).length;
        const cov = coverageOf(f);
        return (
          <span key={f} className="pill" style={{ cursor: 'pointer', borderColor: STATUS_COLOR[cov.status] }}
            title={`${cov.status} · ${n}건`} onClick={() => nav(`/spec/explorer?family=${f}`)}>
            {f} <span style={{ color: STATUS_COLOR[cov.status] }}>●</span> {n}
          </span>
        );
      })}
    </div>
  );
}
