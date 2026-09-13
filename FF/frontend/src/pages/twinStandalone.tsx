/**
 * §18 독립 Twin 콘솔 — `http://localhost:9001/twin.html`
 *
 * Feature Platform 크롬(Sidebar/Topbar/라우터) 바깥에서 단독으로 뜬다.
 * 레이아웃은 RFTwin 관제 화면과 같은 4단 구조를 따른다.
 *   [헤더]      브랜드 · 버전/리비전 식별자 · LIVE/PAUSED · 시뮬레이터 클럭 · 역할
 *   [뷰 전환바] 7개 중앙 뷰
 *   [본문]      좌(운영) · 중앙(스테이지) · 우(관측)
 *   [하단]      KPI 타일 · 수렴 스파크라인 · 티커
 *
 * 모든 움직임의 시간 원천은 `snapshot.clock` 하나다. 벽시계 타이머를 만들지 않는다.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { useTwin } from '../state/twinStore';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';
import { ClassificationBanner } from '../components/twin';
import { simClockLabel } from '../components/liveMonitor';
import { webglSupported } from '../scene/webgl';
import { roles, roleLabel } from '../data/refdata';
import { TwinBottomBar, TwinLeftPanel, TwinRightPanel } from '../components/twinPanels';
import {
  ArchView,
  FleetView,
  IncidentView,
  PlantView,
  RevisionView,
  SimulationView,
  VehicleView,
  type TwinViewProps,
} from '../components/twinViews';

/* ------------------------------------------------------------------ */
/* 뷰 정의 — 라벨과 컴포넌트를 한 곳에서 관리한다.                       */
/* ------------------------------------------------------------------ */

type ViewId = 'factory' | 'vehicle' | 'fleet' | 'arch' | 'simulation' | 'incident' | 'revision';

interface ViewDef {
  id: ViewId;
  ko: string;
  en: string;
  glyph: string;
  /** 이 뷰가 WebGL 캔버스를 쓰는가 — 쓸 수 없으면 2D 로 내려간다. */
  webgl?: boolean;
  Component: (props: TwinViewProps) => JSX.Element;
}

const VIEWS: ViewDef[] = [
  { id: 'factory', ko: '3D 공장', en: '3D Plant', glyph: '🏭', webgl: true, Component: PlantView },
  { id: 'vehicle', ko: '3D 차량', en: '3D Vehicle', glyph: '🚗', webgl: true, Component: VehicleView },
  { id: 'fleet', ko: 'Fleet 수렴', en: 'Fleet', glyph: '📡', Component: FleetView },
  { id: 'arch', ko: '아키텍처 플로우', en: 'Architecture', glyph: '🧱', Component: ArchView },
  { id: 'simulation', ko: 'What-if', en: 'What-if', glyph: '🧪', Component: SimulationView },
  { id: 'incident', ko: 'Closed-Loop', en: 'Closed-Loop', glyph: '🚨', Component: IncidentView },
  { id: 'revision', ko: 'Revision SoT', en: 'Revision', glyph: '🧬', Component: RevisionView },
];

// 기준 패키지 9 역할 (refdata.roles) — 콘솔의 권한 게이트도 이 키를 쓴다.
const ROLES = roles;

/* ================================================================== */

export default function TwinStandalone() {
  const { state, dispatch, can } = useApp();
  const lang = state.lang;
  const { snapshot, rate, setRate, step, scope, setScope, activate, pause, resume, reset, impact } = useTwin();

  const [viewId, setViewId] = useState<ViewId>('factory');
  const [vin, setVin] = useState('');
  const [webgl] = useState(() => webglSupported());

  const clock = snapshot.clock;
  const paused = rate === 0 || !clock.running;
  const openIncidents = snapshot.incidents.filter((i) => i.status !== 'CLOSED');

  /* 선택 VIN 은 스냅샷에서만 고른다 — 없는 VIN 을 만들어내지 않는다. */
  useEffect(() => {
    if (vin && snapshot.twins.some((t) => t.vin === vin)) return;
    setVin(
      snapshot.verdicts.find((v) => v.reconciliation.result !== 'CONVERGED')?.twin.vin ?? snapshot.twins[0]?.vin ?? '',
    );
  }, [vin, snapshot]);

  const viewDef = VIEWS.find((v) => v.id === viewId) ?? VIEWS[0];
  const webglBlocked = !!viewDef.webgl && !webgl;
  const ViewComponent = viewDef.Component;

  const openVehicle = (nextVin: string) => {
    if (nextVin) setVin(nextVin);
    setViewId('vehicle');
  };

  const viewProps: TwinViewProps = { lang, vin, onSelectVin: setVin, onOpenVehicle: openVehicle, webgl };

  return (
    <div className={`tshell ${paused ? 'is-paused' : ''}`} data-testid="twin-standalone" data-lang={lang}>
      <ClassificationBanner extra={`DIGITAL TWIN CONSOLE · revision ${snapshot.revision} · tick ${clock.simTick}`} />

      {/* ------------------------------------------------------- 헤더 */}
      <header className="tshell-head">
        <div className="tshell-head-row">
          <span className="tshell-mark" aria-hidden="true">
            ◈
          </span>
          <div className="tshell-title">
            <span className="nm">Twin Control Room</span>
            <span className="sub">Digital Twin 운영 콘솔 · Vehicle Feature Lifecycle</span>
          </div>

          <span className="tshell-idchips">
            <span className="tsc mono">FEATURE {T.FEATURE_ID}</span>
            <span className="tsc mono">v{T.FEATURE_VERSION}</span>
            <span className="tsc mono">POLICY {T.DEMO_POLICY.policyVersion}</span>
            <span className="tsc mono">ROLLOUT {T.DEMO_ROLLOUT_ID}</span>
            <span className="tsc mono">rev {snapshot.revision}</span>
          </span>

          <div className="tshell-controls">
            <span
              className={`tshell-live ${paused ? 'is-paused' : ''}`}
              role="status"
              data-testid="tshell-live"
              data-paused={paused}
            >
              <i className="dot" aria-hidden="true" />
              {paused ? 'PAUSED' : `LIVE ×${rate}`}
            </span>

            <span className="tshell-clock mono" data-testid="tshell-clock" title="시뮬레이터 시각 — 벽시계와 무관">
              {simClockLabel(clock).text}
            </span>

            <span className="tshell-rate" role="group" aria-label="시뮬레이터 클럭 배율">
              {([0, 1, 5] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={rate === r ? 'tbtn is-on' : 'tbtn'}
                  aria-pressed={rate === r}
                  onClick={() => setRate(r)}
                  title={r === 0 ? '시뮬레이터 정지 — 화면의 모든 움직임이 멈춥니다' : `×${r} 배속`}
                >
                  ×{r}
                </button>
              ))}
            </span>

            <button type="button" className="tbtn" onClick={() => step(1)} title="시뮬레이터 시각 1초 진행">
              +1s
            </button>
            <button
              type="button"
              className="tbtn"
              onClick={() => activate()}
              disabled={!can('run-engine') || snapshot.rollout.active}
              title="Fleet 전체에 기능을 활성화합니다"
            >
              ▶ Fleet Activate
            </button>
            <button
              type="button"
              className="tbtn"
              onClick={() =>
                snapshot.rollout.paused
                  ? resume()
                  : pause({ ko: '운영자 수동 Pause', en: 'Manual operator pause' })
              }
              disabled={!can('run-engine')}
            >
              {snapshot.rollout.paused ? '⏵ Resume' : '⏸ Pause'}
            </button>
            <button
              type="button"
              className="tbtn"
              onClick={() => reset()}
              disabled={!can('kill')}
              title="모든 상태를 초기 스냅샷으로 되돌립니다"
            >
              ⟲ Reset
            </button>

            <span className="tshell-tools">
              <select
                className="tselect"
                aria-label="역할"
                value={state.role}
                onChange={(e) => dispatch({ t: 'ROLE', role: e.target.value })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="tbtn"
                onClick={() => dispatch({ t: 'LANG', lang: lang === 'ko' ? 'en' : 'ko' })}
                aria-label="언어 전환"
              >
                {lang === 'ko' ? '한' : 'EN'}
              </button>
            </span>
          </div>
        </div>

        {/* ------------------------------------------------ 뷰 전환바 */}
        <div className="tshell-views" role="tablist" aria-label="Twin 뷰">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={viewId === v.id}
              className={viewId === v.id ? 'tshell-viewbtn is-on' : 'tshell-viewbtn'}
              onClick={() => setViewId(v.id)}
              data-testid={`tshell-view-${v.id}`}
            >
              <span className="vi" aria-hidden="true">
                {v.glyph}
              </span>
              <span className="vn">{lang === 'en' ? v.en : v.ko}</span>
              {v.id === 'incident' && openIncidents.length > 0 && (
                <span className="vb">{openIncidents.length}</span>
              )}
            </button>
          ))}
          <span className="tshell-views-right">
            <span className="tsc mono">scope {scope}</span>
            <span className="tsc mono">대상 {impact.totalMatched}대</span>
            <button
              type="button"
              className="tbtn"
              onClick={() => setScope(scope === 'FLEET' ? 'CANARY' : 'FLEET')}
              title="분석 범위 전환"
            >
              ⇄ scope
            </button>
          </span>
        </div>
      </header>

      {/* ------------------------------------------------------- 본문 */}
      <div className="tshell-mid">
        <aside className="tshell-panel" data-testid="tshell-left" aria-label="운영 패널">
          <TwinLeftPanel lang={lang} onOpenVehicle={openVehicle} />
        </aside>

        <main className="tshell-center" data-testid="tshell-center">
          <div className={`tshell-stage ${paused ? '' : 'is-live'}`} data-testid="tshell-stage" data-view={viewId}>
            {/*
              WebGL 미지원 시에도 뷰를 숨기지 않는다. 각 뷰(공장/차량)가 자체적인
              2D 개략도 폴백을 갖고 있어서, 여기서 통째로 가리면 정보가 오히려 사라진다.
              대신 왜 3D 가 아닌지를 알리는 띠만 위에 얹는다.
            */}
            {webglBlocked && (
              <div className="tshell-glnote" data-testid="tshell-webgl-note">
                <span className="tshell-glnote-dot" aria-hidden="true" />
                <span>
                  {lang === 'en'
                    ? 'WebGL unavailable — showing the 2D schematic instead of the 3D scene.'
                    : 'WebGL 을 사용할 수 없어 3D 씬 대신 2D 개략도로 표시합니다.'}
                </span>
                <span className="mono small muted">{simClockLabel(clock).text}</span>
              </div>
            )}
            <ViewComponent {...viewProps} />
          </div>
        </main>

        <aside className="tshell-panel" data-testid="tshell-right" aria-label="관측 패널">
          <TwinRightPanel lang={lang} vin={vin} onSelectVin={setVin} onOpenVehicle={() => openVehicle(vin)} />
        </aside>
      </div>

      {/* ------------------------------------------------------- 하단 */}
      <footer className="tshell-foot-wrap" data-testid="tshell-bottom">
        <TwinBottomBar lang={lang} />
      </footer>
    </div>
  );
}
