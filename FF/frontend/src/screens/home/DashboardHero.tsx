// 내 대시보드 히어로 — 플랫폼의 약속과 업무 절차 흐름을 모션으로 보여 준다(장식, aria-hidden).
import { dashboard as D } from '../../copy/dashboard';
import './DashboardHero.css';

const PATH = 'M 42 112 C 132 92 142 48 236 52 S 360 96 452 46';

export function DashboardHero() {
  return (
    <section className="dh" data-zone="ops" aria-label={D.label}>
      <div className="dh__copy">
        <p className="ds-eyebrow">{D.eyebrow}</p>
        <h2>{D.title}</h2>
        <p className="dh__lead">{D.lead}</p>
        <span className="dh__live">
          <i aria-hidden /> {D.live}
        </span>
      </div>

      <svg className="dh__motion" viewBox="0 0 520 160" role="presentation">
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
            <text x={Number(x) + 18} y={Number(y) + 4} className="dh-gate">{g}</text>
          </g>
        ))}
        <text x="42" y="148" className="dh-axis">{D.flow}</text>
      </svg>
    </section>
  );
}
