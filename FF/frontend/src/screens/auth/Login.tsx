// /login — 플랫폼 게이트. 실제 IAM이 아닌 데모 세션(auth.ts)이며, 정적 데모에서도 클라이언트에서 동작한다.
// 오른쪽은 업무 절차(Gate 흐름)를 모티프로 한 모션 그래픽 — CSS/SVG만 쓰고 prefers-reduced-motion에서 멈춘다.
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { login as authLogin } from '../../auth';
import { login as L } from '../../copy/login';
import { Button } from '../../design';
import './login.css';

const PATH = 'M 74 566 C 156 520 142 444 236 408 S 366 344 350 250 S 452 132 548 84';
const TRACE = 'M 34 860 C 24 700 28 520 44 380 S 70 170 190 70 S 420 34 600 34';

/** 왼쪽 종이 면의 플로터 모션 — ODD → ACTIVE → SAFE STOP → RECOVERY를 그린다(장식). */
function LeftMotion() {
  return (
    <div className="lg-blue" aria-hidden>
      <svg viewBox="0 0 640 900" preserveAspectRatio="xMidYMid slice" role="presentation">
        <defs>
          <pattern id="lg-blue-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M28 0H0V28" />
          </pattern>
        </defs>
        <rect width="640" height="900" fill="url(#lg-blue-grid)" className="lg-blue__grid" />
        <path d={TRACE} className="lg-blue__track" />
        <path d={TRACE} className="lg-blue__flow" pathLength={1} />
        <circle r="3.4" className="lg-blue__pulse">
          <animateMotion dur="9s" repeatCount="indefinite" path={TRACE} />
        </circle>
        {[
          { x: 34, y: 860 },
          { x: 44, y: 380 },
          { x: 190, y: 70 },
          { x: 600, y: 34 },
        ].map((n) => (
          <g key={`${n.x}-${n.y}`} className="lg-blue__node">
            <circle cx={n.x} cy={n.y} r="8" />
            <circle cx={n.x} cy={n.y} r="2.2" className="lg-blue__dot" />
          </g>
        ))}
        <g className="lg-blue__mark lg-blue__mark--tl">
          <path d="M0 10H20M10 0V20" />
        </g>
        <g className="lg-blue__mark lg-blue__mark--br">
          <path d="M0 10H20M10 0V20" />
        </g>
      </svg>
    </div>
  );
}

function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 21V3.5" />
      <path d="M6 4h11l-2.5 3.5L17 11H6" />
      <path d="M3 21h6M10 15v2M13 15v2M16 15v2M19 15v2" />
    </svg>
  );
}

/** 절차 흐름 그래픽 — 경로 위를 도는 펄스와 Gate 노드. 장식이므로 aria-hidden. */
function MotionGraphic() {
  const nodes = [
    { x: 74, y: 566, g: 'G1' },
    { x: 160, y: 500, g: 'G2' },
    { x: 236, y: 408, g: 'G3' },
    { x: 310, y: 360, g: 'G4' },
    { x: 350, y: 250, g: 'G5' },
    { x: 420, y: 190, g: 'G7' },
    { x: 548, y: 84, g: 'G8' },
  ];
  return (
    <svg className="lg-motion__svg" viewBox="0 0 620 660" role="presentation">
      <defs>
        <pattern id="lg-grid" width="34" height="34" patternUnits="userSpaceOnUse">
          <path d="M34 0H0V34" className="lg-motion__grid" />
        </pattern>
        <linearGradient id="lg-line" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="0.55" stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="620" height="660" fill="url(#lg-grid)" />
      <path d={PATH} className="lg-motion__path" />
      <path d={PATH} className="lg-motion__flow" pathLength={1} />
      <circle r="5" className="lg-motion__pulse">
        <animateMotion dur="7s" repeatCount="indefinite" path={PATH} />
      </circle>
      {nodes.map((n, i) => (
        <g key={n.g} className="lg-motion__node" style={{ animationDelay: `${i * 0.45}s` }}>
          <circle cx={n.x} cy={n.y} r="15" />
          <circle cx={n.x} cy={n.y} r="4" className="lg-motion__dot" />
          <text x={n.x + 24} y={n.y + 5} className="lg-motion__gate">{n.g}</text>
        </g>
      ))}
      <g className="lg-motion__orbit">
        <circle cx="310" cy="330" r="212" />
        <circle cx="310" cy="330" r="268" className="lg-motion__orbit-inner" />
      </g>
      <text x="74" y="620" className="lg-motion__axis">FEATURE</text>
      <text x="474" y="70" className="lg-motion__axis">FLEET</text>
    </svg>
  );
}

export function LoginScreen() {
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authLogin(id, pw)) {
      setErr(true);
      return;
    }
    nav(from && from !== '/login' ? from : '/', { replace: true });
  };

  return (
    <main id="main" className="lg" data-login>
      <section className="lg__form">
        <LeftMotion />
        <header className="lg__brand">
          <img className="lg__logo" src="/brand/mutuuslab_logo.png" alt="Mutuus Lab" width="788" height="101" />
          <span className="lg__divider" aria-hidden />
          <span className="lg__mark" aria-hidden>
            <BrandMark />
          </span>
          <span className="lg__brand-name">Feature Platform</span>
          <span className="lg__brand-sub">Feature · Gate · Fleet</span>
        </header>

        <div className="lg__intro">
          <p className="ds-eyebrow">{L.eyebrow}</p>
          <h1>{L.title}</h1>
          <span className="lg__rule" aria-hidden />
          <p className="lg__lead">{L.lead}</p>
        </div>

        <form className="lg__card" onSubmit={submit} noValidate>
          <h2>{L.formTitle}</h2>
          <label className="lg__field">
            <span>{L.id}</span>
            <input
              className="ds-input ds-input--mono"
              name="username"
              autoComplete="username"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoFocus
              aria-invalid={err || undefined}
            />
          </label>
          <label className="lg__field">
            <span>{L.password}</span>
            <span className="lg__pw">
              <input
                className="ds-input ds-input--mono"
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                aria-invalid={err || undefined}
              />
              <button type="button" className="lg__show" onClick={() => setShow(!show)} aria-label={show ? L.hide : L.show}>
                {show ? L.hide : L.show}
              </button>
            </span>
          </label>
          {err && (
            <p className="lg__error" role="alert">
              {L.error}
            </p>
          )}
          <Button type="submit" variant="primary" className="lg__submit">
            {L.submit}
          </Button>
        </form>

        <footer className="lg__foot">
          <span>{L.footer}</span>
          <span className="lg__contact">
            {L.contact.label} — {L.contact.name} · <a href={`mailto:${L.contact.email}`}>{L.contact.email}</a>
          </span>
        </footer>
      </section>

      <aside className="lg__motion" data-zone="ops" aria-labelledby="lg-brief-title">
        <div className="lg-motion__halo" />
        <MotionGraphic />
        <div className="lg-motion__caption">
          <p className="ds-eyebrow">{L.visual.eyebrow}</p>
          <h2>{L.visual.title}</h2>
          <p>{L.visual.caption}</p>
          <span className="lg-motion__live">
            <i aria-hidden /> {L.visual.live}
          </span>
        </div>
        <div className="lg-brief">
          <p className="ds-eyebrow lg-brief__eyebrow">{L.brief.eyebrow}</p>
          <h2 id="lg-brief-title">{L.brief.title}</h2>
          <p className="lg-brief__sub">{L.brief.sub}</p>
          <p className="lg-brief__body">{L.brief.body}</p>
          <ul className="lg-brief__chips">
            {L.brief.chips.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
