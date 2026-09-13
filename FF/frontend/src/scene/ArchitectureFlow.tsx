/**
 * 레이어드 아키텍처 데이터 플로우 — "Fleet 평면도" 탭의 NOC(관제실) 스타일 시각화.
 *
 * 6개 레이어(피처 카탈로그 → 정책 엔진 → 수렴 게이트 → 커넥티비티/OTA → 차량 에지 → 관측)를
 * 쌓아두고, 레이어 사이를 흐르는 실제 데이터(정책/보고/텔레메트리/감사)를 애니메이션 패킷으로
 * 보여준다. 모든 수치·색·차단 여부는 `scene/architectureFlow.ts` 의 순수 함수가 스냅샷에서
 * 계산한 값을 그대로 그린다 — 이 화면은 렌더러일 뿐 판정 로직을 갖지 않는다.
 *
 * 모션 규칙:
 *  - `snapshot.clock.rate === 0` 이면 패킷·라인 애니메이션이 완전히 멈춘다(`data-paused`).
 *  - 차단된 엣지(Local Guard 차단 / Rollout Pause / Critical Drift / Kill-Switch)는 rate 와
 *    무관하게 항상 멈춰 있고 빨간색 + "■" 정지 표식을 함께 보여준다(색만으로 의미를 전달하지 않음).
 *  - duration/delay/play-state 는 인라인 스타일로 직접 지정한다 — 그래야 애니메이션이 실제로
 *    CSS 키프레임과 무관하게 이 컴포넌트만으로도 테스트 가능하고, 실제 브라우저에서도 즉시 반영된다.
 */
import type { JSX } from 'react';
import type { TwinStoreSnapshot } from '../data/twin/port';
import * as T from '../data/twin/types';
import type { Lang } from '../data/twin/types';
import {
  LEGEND,
  buildArchitectureModel,
  layoutNodes,
  packetDelayMs,
  packetDurationMs,
  type ArchEdge,
  type ArchLayer,
} from './architectureFlow';
import './architectureFlow.css';

export interface ArchitectureFlowProps {
  snapshot: TwinStoreSnapshot;
  lang: Lang;
  selectedVin?: string;
  onSelectVin?: (vin: string) => void;
  onOpenVehicle?: (vin: string) => void;
}

const pick = (l: T.Localized, lang: Lang): string => T.pick(l, lang);

export default function ArchitectureFlow({
  snapshot,
  lang,
  selectedVin = '',
  onSelectVin,
  onOpenVehicle,
}: ArchitectureFlowProps): JSX.Element {
  const model = buildArchitectureModel(snapshot);
  const paused = snapshot.clock.rate === 0;
  const duration = packetDurationMs(snapshot.clock.rate);
  const { stats, rollout, convergence } = snapshot;

  const simDate = new Date(snapshot.clock.simTimeMs);
  const simClockText = `T${simDate.toISOString().slice(0, 19).replace('T', ' ')} · tick ${snapshot.clock.simTick}`;

  return (
    <div className={`arch-root ${paused ? 'arch-paused' : ''}`} data-testid="architecture-flow" data-paused={paused}>
      {/* ------------------------------------------------------------ 헤더 */}
      <div className="arch-header">
        <div className="arch-header-title">
          <b>레이어드 아키텍처 데이터 플로우</b>
          <span className="arch-rev mono">revision {snapshot.revision}</span>
        </div>
        <div className="arch-header-clock mono">{simClockText}</div>
        <div className={`arch-live-badge ${paused ? 'paused' : 'live'}`} role="status">
          <span className="arch-live-dot" aria-hidden />
          {paused ? '⏸ PAUSED' : `▶ LIVE ×${snapshot.clock.rate}`}
        </div>
        {selectedVin && (
          <button
            type="button"
            className="arch-open-vehicle"
            onClick={() => onOpenVehicle?.(selectedVin)}
            disabled={!onOpenVehicle}
          >
            {selectedVin} · 차량 상세 보기
          </button>
        )}
      </div>

      {/* ------------------------------------------------------ 접근성 요약 */}
      <div className="arch-summary" role="status" aria-live="polite">
        <ul>
          <li>
            정책 {rollout.policyVersion} · 단계 {rollout.scope} · {rollout.paused ? '일시정지' : '진행 중'}
          </li>
          <li>
            수렴률 {Math.round(convergence.convergenceRate * 100)}% (임계 {Math.round(convergence.threshold * 100)}%)
          </li>
          <li>Local Guard 차단 {stats.guardBlocked}대 · Critical Drift {stats.drift}대 · Stale {stats.stale}대</li>
          <li>
            오픈 인시던트 {snapshot.incidents.filter((i) => i.status === 'OPEN' || i.status === 'MITIGATING').length}건
            (전체 {snapshot.incidents.length}건)
          </li>
        </ul>
      </div>

      {/* ------------------------------------------------------------ 다이어그램 */}
      <div className="arch-diagram-scroll">
        <svg
          className="arch-svg"
          viewBox={`0 0 1080 ${model.height}`}
          role="img"
          aria-label="레이어드 아키텍처 데이터 플로우 다이어그램"
        >
          {model.layers.map((layer) => (
            <LayerBand key={layer.id} layer={layer} lang={lang} />
          ))}
          {model.edges.map((edge, i) => (
            <EdgeView key={edge.id} edge={edge} index={i} duration={duration} paused={paused} lang={lang} />
          ))}
        </svg>
      </div>

      {/* ------------------------------------------------------------ 범례 */}
      <div className="arch-legend" aria-label="범례">
        <b className="small">범례</b>
        {LEGEND.map((item) => (
          <span className="arch-legend-item" key={item.key}>
            <span className={`arch-legend-swatch ${item.swatchClass}`} aria-hidden />
            {pick(item.label, lang)}
          </span>
        ))}
      </div>

      {/* ------------------------------------------------------ Cohort 스윔레인 */}
      <div className="arch-swimlanes" data-testid="arch-swimlanes">
        <b className="small">Cohort 수렴 현황</b>
        {model.swimlanes.map((lane) => (
          <div className="arch-lane" key={lane.wave}>
            <div className="arch-lane-head">
              <span className="mono">{lane.wave}</span>
              <span className="small muted">
                {lane.converged}/{lane.total} · {Math.round(lane.rate * 100)}%
              </span>
            </div>
            <div className="arch-lane-bar">
              <div className="arch-lane-bar-fill" style={{ width: `${Math.round(lane.rate * 100)}%` }} />
            </div>
            <div className="arch-lane-chips">
              {lane.chips.map((chip) => {
                const sel = chip.vin === selectedVin;
                return (
                  <button
                    type="button"
                    key={chip.vin}
                    className={`arch-chip arch-chip-${T.RECONCILIATION_TOKEN[chip.reconciliation]} ${sel ? 'active' : ''}`}
                    aria-pressed={sel}
                    title={`더블클릭 = 차량 상세\n${T.RECONCILIATION_LABEL[chip.reconciliation].ko}`}
                    onClick={() => onSelectVin?.(chip.vin)}
                    onDoubleClick={() => onOpenVehicle?.(chip.vin)}
                  >
                    <span className="mono">{chip.vin.replace('VIN-DEMO-', '#')}</span>
                    <span aria-hidden>{T.RECONCILIATION_ICON[chip.reconciliation]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ------------------------------------------------------ Reason code 분해 */}
      <div className="arch-reason-chips" data-testid="arch-reason-chips">
        <b className="small">Reason Code 분포</b>
        <div className="arch-reason-chip-row">
          {model.reasonChips.map((rc) => (
            <span className={`arch-reason-chip arch-tone-${toneFromSeverity(rc.severity)}`} key={rc.code}>
              {pick(rc.label, lang)} × {rc.count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function toneFromSeverity(sev: T.ReasonSeverity): string {
  switch (sev) {
    case 'PASS':
      return 'pass';
    case 'FAIL':
      return 'fail';
    case 'PENDING':
      return 'pending';
    default:
      return 'info';
  }
}

/* ------------------------------------------------------------------ */
/* 레이어 밴드 + 노드                                                    */
/* ------------------------------------------------------------------ */

function LayerBand({ layer, lang }: { layer: ArchLayer; lang: Lang }) {
  const boxes = layoutNodes(layer);
  const band = boxes[0] ? { top: boxes[0].y, height: boxes[0].h } : { top: 0, height: 96 };
  return (
    <g className="arch-layer" data-testid={`arch-layer-${layer.id}`}>
      <rect
        className="arch-layer-band"
        x={8}
        y={band.top}
        width={1064}
        height={band.height}
        rx={12}
      />
      <text className="arch-layer-title" x={24} y={band.top + 18}>
        {pick(layer.title, lang)}
      </text>
      {boxes.map(({ node, x, y, w, h }) => (
        <g className={`arch-node arch-tone-${node.tone}`} key={node.id} transform={`translate(${x},${y + 28})`}>
          <rect className="arch-node-box" width={w} height={h - 36} rx={8} />
          <text className="arch-node-title" x={10} y={18}>
            {pick(node.title, lang)}
          </text>
          <text className="arch-node-metric" x={10} y={38}>
            {node.metricValue}
          </text>
          <text className="arch-node-metric-label" x={10} y={52}>
            {pick(node.metricLabel, lang)}
          </text>
        </g>
      ))}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* 엣지 + 패킷                                                          */
/* ------------------------------------------------------------------ */

function EdgeView({
  edge,
  index,
  duration,
  paused,
  lang,
}: {
  edge: ArchEdge;
  index: number;
  duration: number;
  paused: boolean;
  lang: Lang;
}) {
  const delay = packetDelayMs(index, duration);
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const running = !paused && !edge.blocked;
  const radius = Math.max(4, Math.min(14, 4 + edge.packetCount * 0.4));
  const midX = (edge.x1 + edge.x2) / 2;
  const midY = (edge.y1 + edge.y2) / 2;

  return (
    <g
      className={`arch-edge arch-kind-${edge.kind} ${edge.blocked ? 'arch-blocked' : ''}`}
      data-testid={`arch-edge-${edge.id}`}
      data-blocked={edge.blocked}
      data-direction={edge.direction}
    >
      <title>
        {pick(edge.label, lang)} — {edge.packetCount}
        {edge.blocked ? ` · 차단: ${edge.blockReason ? pick(edge.blockReason, lang) : ''}` : ''}
      </title>
      <line className="arch-edge-line" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
      <circle
        className="arch-packet"
        data-paused={!running}
        data-blocked={edge.blocked}
        cx={edge.x1}
        cy={edge.y1}
        r={radius}
        style={{
          ['--arch-dx' as string]: `${dx}px`,
          ['--arch-dy' as string]: `${dy}px`,
          animationDuration: `${duration}ms`,
          animationDelay: `${delay}ms`,
          animationPlayState: running ? 'running' : 'paused',
        }}
      />
      <text className="arch-edge-count" x={midX + 10} y={midY - 8}>
        {edge.packetCount}
      </text>
      <text className="arch-edge-label" x={midX + 10} y={midY + 14}>
        {pick(edge.label, lang)}
      </text>
      {edge.blocked && (
        <text className="arch-edge-blocked-mark" x={midX - 22} y={midY + 5} aria-hidden>
          ■
        </text>
      )}
      {edge.blocked && edge.blockReason && (
        <text className="arch-edge-blocked-reason" x={midX + 10} y={midY + 30}>
          {pick(edge.blockReason, lang)}
        </text>
      )}
    </g>
  );
}
