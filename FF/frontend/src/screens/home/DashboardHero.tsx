// 내 대시보드 히어로 — 플랫폼의 약속과 업무 절차 흐름을 모션으로 보여 준다(장식, aria-hidden).
// 핵심 메시지 아래 보조 요소 — 본문 테마를 따른다. 어두운 관제실 톤이면 화면에서 가장 진한 요소가 되어 핵심 메시지를 눌렀다(UX3-15).
import { dashboard as D } from '../../copy/dashboard';
import './DashboardHero.css';

const PATH = 'M 42 112 C 132 92 142 48 236 52 S 360 96 452 46';

export function DashboardHero() {
  return (
    <section className="dh" aria-label={D.label}>
      <div className="dh__copy">
        <p className="ds-eyebrow">{D.eyebrow}</p>
        <h2>{D.title}</h2>
        <div className="dh-flag">
          <span className="dh-flag__icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 21V4" />
              <path d="M6 5h10l-2.5 3.5L16 12H6" />
            </svg>
          </span>
          <span className="dh-flag__label">{D.flag.label}</span>
          <span className="dh-flag__track" aria-hidden>
            <i />
          </span>
          <span className="dh-flag__state">{D.flag.state}</span>
          <span className="dh-flag__flow">{D.flag.flow}</span>
        </div>
      </div>

      <svg className="dh__motion" viewBox="0 0 520 160" preserveAspectRatio="xMidYMid meet" role="presentation">
        <defs>
          <pattern id="dh-grid" width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M26 0H0V26" className="dh-grid" />
          </pattern>
        </defs>
        <rect width="520" height="160" fill="url(#dh-grid)" />
        <path d={PATH} className="dh-path" />
        <path d={PATH} className="dh-flow" pathLength={1} />
        <circle r="4" className="dh-pulse">
          <animateMotion dur="6s" repeatCount="indefinite" path={PATH} />
        </circle>
        {[
          [42, 112, 'G1'],
          [236, 52, 'G5'],
          [452, 46, 'G8'],
        ].map(([x, y, g], i) => (
          <g key={String(g)} className="dh-node" style={{ animationDelay: `${i * 0.6}s` }}>
            <circle cx={Number(x)} cy={Number(y)} r="11" />
            <circle cx={Number(x)} cy={Number(y)} r="3" className="dh-dot" />
            <text x={Number(x) + 16} y={Number(y) - 16} className="dh-gate">{g}</text>
          </g>
        ))}
        <text x="42" y="154" className="dh-axis">{D.flow}</text>
      </svg>
    </section>
  );
}
