/**
 * §18.5 독립 Twin 콘솔 — 중앙 스테이지의 7개 뷰.
 *
 * 각 뷰는 자기 완결적이다. 좌/우 패널과 통신할 때도 Router 나 URL 이 아니라
 * prop 콜백만 쓴다(콘솔은 플랫폼 크롬 바깥에서 단독으로 뜬다).
 *
 * 원칙: 화면에 있는 모든 움직임의 시간 원천은 `snapshot.clock` 뿐이다.
 * 타이머·`Date.now()`·`Math.random()` 을 여기서 새로 만들지 않는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { useTwin, useTwinVerdict } from '../state/twinStore';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';
import { Sparkline } from './charts';
import { RecBadge, ReasonChip, StateChip } from './twin';
import { closedLoopView, loopLine, LOOP_STEP_MS } from './closedLoop';
import { series, simClockLabel, useTickHistory } from './liveMonitor';
import LiveConvergenceMonitor from './LiveConvergenceMonitor';
import WhatIfRunner from './WhatIfRunner';
import FlagLogTerminal from './FlagLogTerminal';
import ArchitectureFlow from '../scene/ArchitectureFlow.tsx';
import { PlantScene, PlantSchematic2D, type PlantLang } from '../scene/PlantScene';
import VehicleTwinScene from '../scene/VehicleTwinScene';
import type { LabelsMode } from '../scene/labels';
import {
  CELLS,
  PLANT_PRESETS,
  PLANT_STATUS_HEX,
  PLANT_STATUS_LABEL,
  PLANT_TOUR,
  RECONCILIATION_LEGEND,
  TOKEN_HEX,
  TOUR_DWELL_MS,
  cellReason,
  cellStatus,
  followPreset,
  plantCounts,
  presetById,
  yardSlots,
  type PlantPresetId,
} from '../scene/plantLayout';
import './twinViews.css';

export interface TwinViewProps {
  lang: T.Lang;
  /** 좌측/우측 패널과 공유하는 단일 선택 VIN. */
  vin: string;
  onSelectVin: (vin: string) => void;
  /** 중앙 뷰를 차량 상세로 전환한다. */
  onOpenVehicle: (vin: string) => void;
  /** WebGL 가용 여부 — false 면 2D 대체 화면을 그린다. */
  webgl: boolean;
}

const LABELS_MODE_LABEL: Record<LabelsMode, string> = {
  auto: '자동',
  all: '전체',
  alerts: '알림만',
  off: '숨김',
};

/** 셀 → 카메라 프리셋. 3D 안의 Andon 을 눌러도 같은 프리셋으로 날아간다. */
const CELL_PRESET: Record<string, PlantPresetId> = {
  INBOUND: 'inbound',
  FLASH: 'flash',
  BATTERY: 'battery',
  CALIB: 'calib',
  EOL_TEST: 'eol',
};

/** `TwinIncident.fault` 는 열거형이므로 표시 문구는 `FAULTS` 정의에서 가져온다. */
function faultLabel(fault: T.FaultType, lang: T.Lang): string {
  const def = T.FAULTS.find((f) => f.id === fault);
  return def ? T.pick(def.label, lang) : fault;
}

/* ================================================================== */
/* 1. 공장 스케일 Plant Twin                                           */
/* ================================================================== */

export function PlantView({ lang, vin, onSelectVin, onOpenVehicle, webgl }: TwinViewProps) {
  const { snapshot } = useTwin();
  const [presetId, setPresetId] = useState<PlantPresetId>('overview');
  const [tour, setTour] = useState(false);
  const [follow, setFollow] = useState(false);
  const [labels, setLabels] = useState<LabelsMode>('auto');
  const [showLog, setShowLog] = useState(true);
  const [sceneFailed, setSceneFailed] = useState(false);
  const fpsRef = useRef<HTMLSpanElement | null>(null);
  const tourRef = useRef(0);

  const counts = useMemo(
    () => plantCounts(snapshot, snapshot.incidents.filter((i) => i.killSwitch.active).length),
    [snapshot],
  );
  const selected = snapshot.twins.find((t) => t.vin === vin);
  const selectedPos = useMemo<[number, number] | null>(() => {
    if (!selected) return null;
    const slot = yardSlots(snapshot.verdicts).find((y) => y.vin === selected.vin);
    return slot ? [slot.x, slot.z] : null;
  }, [selected, snapshot.verdicts]);

  /* 투어는 시뮬레이션 시계로 돈다 — 정지하면 투어도 멈춘다. */
  const effectivePresetId: PlantPresetId =
    follow && selectedPos ? 'yard' : tour ? PLANT_TOUR[tourRef.current % PLANT_TOUR.length] : presetId;
  const preset = useMemo(() => {
    const base = presetById(effectivePresetId);
    if (!follow || !selectedPos || !selected) return base;
    return followPreset(selected.vin, selectedPos);
  }, [effectivePresetId, follow, selected, selectedPos]);

  const { simTimeMs, simTick, rate } = snapshot.clock;
  const clockText = simClockLabel(snapshot.clock).text;
  useEffect(() => {
    if (!tour || rate === 0) return;
    const step = Math.floor(simTimeMs / TOUR_DWELL_MS);
    if (step !== tourRef.current) tourRef.current = step;
  }, [tour, simTimeMs, rate]);

  return (
    <div className="tsview-pad tshell-plant" data-testid="tsview-plant">
      <div className="tshell-plant-hud">
        <b>공장 스케일 차량 운영</b>
        <span className="small muted">
          EOL · 출하 Plant 116 m × 60 m · 차량 {counts.total}대 · 수렴 {counts.converged}대 · 미수렴 {counts.pending}대
        </span>
        <div className="toolbar-group" role="group" aria-label="공장 카메라 프리셋">
          {PLANT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={effectivePresetId === p.id && !follow ? 'tbtn is-on' : 'tbtn'}
              onClick={() => {
                setFollow(false);
                setTour(false);
                setPresetId(p.id);
              }}
            >
              {T.pick(p.label, lang)}
            </button>
          ))}
        </div>
        <button type="button" className={tour ? 'tbtn is-on' : 'tbtn'} aria-pressed={tour} onClick={() => setTour((v) => !v)}>
          {tour
            ? `⏸ 투어 (${tourRef.current % PLANT_TOUR.length + 1}/${PLANT_TOUR.length}) 정지`
            : `▶ 투어 (${tourRef.current % PLANT_TOUR.length + 1}/${PLANT_TOUR.length})`}
        </button>
        <button
          type="button"
          className={follow ? 'tbtn is-on' : 'tbtn'}
          aria-pressed={follow}
          title="선택한 VIN 을 출하 야드에서 추적합니다"
          onClick={() => setFollow((v) => !v)}
        >
          📍 선택 VIN 추적
        </button>
        <span className="toolbar-group" role="group" aria-label="라벨 표시 모드">
          <span className="small muted">라벨</span>
          {(['auto', 'all', 'alerts', 'off'] as LabelsMode[]).map((m) => (
            <button key={m} type="button" className={labels === m ? 'tbtn is-on' : 'tbtn'} aria-pressed={labels === m} onClick={() => setLabels(m)}>
              {LABELS_MODE_LABEL[m]}
            </button>
          ))}
        </span>
        <span className="mono small muted" ref={fpsRef} data-testid="tsview-plant-fps">
          – fps
        </span>
        <button type="button" className={showLog ? 'tbtn is-on' : 'tbtn'} aria-pressed={showLog} onClick={() => setShowLog((v) => !v)}>
          ⌨ Feature Flag 로그
        </button>
      </div>

      <div className="tshell-legend">
        {RECONCILIATION_LEGEND.map((l) => (
          <span key={l.token} className="tshell-legend-item">
            <i style={{ background: TOKEN_HEX[l.token] }} />
            {T.pick(l.label, lang)}
          </span>
        ))}
        <span className="tshell-legend-item muted">클릭 = VIN 선택 · 더블클릭 = 차량 상세 · 드래그 = 회전 · 휠 = 줌</span>
      </div>

      <div className="tshell-stage is-fill" data-testid="tsview-plant-stage">
        <div className="plant-focus-readout" role="status" aria-live="polite" data-testid="plant-focus-readout">
          <span>{lang === 'en' ? 'CURRENT FOCUS' : '현재 초점'}</span>
          <b>{T.pick(preset.label, lang)}</b>
          <small>{T.pick(preset.hint, lang)}</small>
        </div>
        {webgl && !sceneFailed ? (
          <PlantScene
            snapshot={snapshot}
            counts={counts}
            selectedVin={vin}
            preset={preset}
            labels={labels}
            lang={lang as PlantLang}
            onSelectVin={onSelectVin}
            onOpenVehicle={onOpenVehicle}
            onSceneFail={() => setSceneFailed(true)}
            fpsNode={fpsRef}
          />
        ) : (
          <PlantSchematic2D
            snapshot={snapshot}
            counts={counts}
            selectedVin={vin}
            onSelectVin={onSelectVin}
            onOpenVehicle={onOpenVehicle}
          />
        )}
      </div>

      <div className="plant-cells" role="group" aria-label="공정 셀 상태">
        {CELLS.map((c) => {
          const st = cellStatus(counts, c);
          const reason = T.pick(cellReason(counts, c), lang);
          return (
            <button
              key={c.id}
              type="button"
              className="plant-cell"
              title={reason}
              onClick={() => {
                setFollow(false);
                setTour(false);
                setPresetId(CELL_PRESET[c.stage] ?? 'overview');
              }}
            >
              <span className="plant-cell-name">{c.short}</span>
              <span className="plant-cell-status" style={{ background: PLANT_STATUS_HEX[st] }}>
                {T.pick(PLANT_STATUS_LABEL[st], lang)}
              </span>
              <span className="plant-cell-reason">{reason}</span>
            </button>
          );
        })}
      </div>

      <div className="small muted mono" style={{ padding: '2px 8px' }}>
        {clockText} · rate ×{rate}
      </div>

      {showLog && (
        <div className="tshell-dock">
          <FlagLogTerminal snapshot={snapshot} lang={lang} />
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* 2. 3D 차량 Twin                                                     */
/* ================================================================== */

export function VehicleView({ lang, vin, onSelectVin, onOpenVehicle, webgl }: TwinViewProps) {
  const { snapshot } = useTwin();
  const verdict = useTwinVerdict(vin);
  const twin = snapshot.twins.find((t) => t.vin === vin);
  const history = useTickHistory(snapshot, 120);
  const ageSeriesData = series(history, (s) => s.ageMaxS);

  if (!twin) {
    return (
      <div className="tsview-pad tshell-stage-fallback" data-testid="tsview-vehicle-empty">
        <b>VIN 이 선택되지 않았습니다.</b>
        <span className="small muted">좌측 VIN 목록 또는 공장 뷰에서 차량을 클릭하세요.</span>
      </div>
    );
  }

  return (
    <div className="tsview-pad" data-testid="tsview-vehicle" data-vin={twin.vin}>
      <div className="tsview-bar">
        <b className="mono">{twin.vin}</b>
        <span className="tsc">{twin.identity.vehicleModel}</span>
        {verdict && <RecBadge value={verdict.reconciliation.result} />}
        {verdict && <ReasonChip def={verdict.verdictReason} />}
        <span className="small muted mono" style={{ marginLeft: 'auto' }}>
          3D 씬은 시뮬레이션 시계만 읽습니다 · 정지(×0)하면 함께 멈춥니다
        </span>
      </div>

      <div className="tshell-stage is-fill" data-testid="tsview-vehicle-stage">
        <VehicleTwinScene
          twin={twin}
          verdict={verdict}
          clock={snapshot.clock}
          lang={lang}
          webgl={webgl}
          fallback={
            <div className="tshell-stage-fallback" data-testid="tsview-vehicle-fallback">
              <b>WebGL 을 사용할 수 없습니다.</b>
              <span className="small muted">부품 표는 우측 패널에서 계속 볼 수 있습니다.</span>
            </div>
          }
        />
      </div>

      <div className="tsview-strip" data-testid="tsview-vehicle-strip">
        <div className="tstrip">
          <span>Desired</span>
          <b>{twin.featureInstances[T.FEATURE_ID]?.desired.state ?? '–'}</b>
        </div>
        <div className="tstrip">
          <span>Reported</span>
          <b>{twin.featureInstances[T.FEATURE_ID]?.reported.state ?? '–'}</b>
        </div>
        <div className="tstrip">
          <span>Effective</span>
          <b>{twin.featureInstances[T.FEATURE_ID]?.effective.state ?? '–'}</b>
        </div>
        <div className="tstrip">
          <span>Cached seq</span>
          <b className="mono">{TwinPolicy(twin)?.cachedVersionSeq ?? '–'}</b>
        </div>
        <div className="tstrip">
          <span>최근 텔레메트리</span>
          <b className="mono">{E.fmtDuration(E.secondsSince(twin.featureInstances[T.FEATURE_ID]?.observed.lastTelemetryAt, snapshot.clock.simTimeMs))} 전</b>
        </div>
      </div>

      <div className="tsview-kv" data-testid="tsview-vehicle-telemetry">
        <div className="trow gap">
          <span>최장 신호 나이 추이(초)</span>
          <span className="mono small muted">{ageSeriesData.length > 1 ? `${ageSeriesData[ageSeriesData.length - 1]}s` : '수집 대기'}</span>
        </div>
        {ageSeriesData.length > 1 ? <Sparkline data={ageSeriesData} height={40} color="var(--pending)" /> : null}
        <div className="trow gap">
          <button type="button" className="tbtn" onClick={() => onSelectVin(twin.vin)}>
            이 VIN 고정
          </button>
          <button type="button" className="tbtn" onClick={() => onOpenVehicle(twin.vin)}>
            상세 새로고침
          </button>
          <span className="small muted">
            {twin.link.online ? `LINK ONLINE · vehicle agent ${twin.link.vehicleAgentVersion}` : 'LINK OFFLINE — 벽시계가 아니라 시뮬레이터 시각으로 판정합니다'}
          </span>
        </div>
      </div>
    </div>
  );
}

function TwinPolicy(twin: T.Twin) {
  return twin.featureInstances[T.FEATURE_ID]?.policy;
}

/* ================================================================== */
/* 3. Fleet 수렴 (실시간 모니터)                                        */
/* ================================================================== */

export function FleetView({ lang, vin, onSelectVin, onOpenVehicle }: TwinViewProps) {
  const { snapshot } = useTwin();
  return (
    <div className="tsview-pad" data-testid="tsview-fleet">
      <LiveConvergenceMonitor snapshot={snapshot} lang={lang} />
      <div className="tsview-grid2">
        <section className="tblock">
          <h3 className="tsect">
            Wave 별 수렴
            <span className="r mono">{snapshot.convergence.waves.length} waves</span>
          </h3>
          <table className="twin-table small" data-testid="tsview-fleet-waves">
            <thead>
              <tr>
                <th>Wave</th>
                <th>수렴 / 대상</th>
                <th>수렴률</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.convergence.waves.map((w) => (
                <tr key={w.wave}>
                  <td className="mono">{w.wave}</td>
                  <td className="mono">
                    {w.converged} / {w.total}
                  </td>
                  <td>
                    <div className="tbar">
                      <i style={{ width: `${Math.min(100, w.rate)}%` }} />
                    </div>
                    <span className="mono small">{w.rate}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="tblock">
          <h3 className="tsect">수렴 안 된 VIN — 다음 조치</h3>
          <ul className="tlist" data-testid="tsview-fleet-attention">
            {snapshot.verdicts
              .filter((v) => v.reconciliation.result !== 'CONVERGED')
              .slice(0, 12)
              .map((v) => (
                <li key={v.twin.vin}>
                  <button type="button" className={v.twin.vin === vin ? 'trowbtn is-on' : 'trowbtn'} onClick={() => onSelectVin(v.twin.vin)}>
                    <span className="nm mono">{v.twin.vin}</span>
                    <RecBadge value={v.reconciliation.result} />
                    <span className="mt">{T.pick(v.verdictReason.label, lang)}</span>
                  </button>
                </li>
              ))}
          </ul>
          {vin && (
            <button type="button" className="tbtn" onClick={() => onOpenVehicle(vin)}>
              선택 VIN 3D 상세 →
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 4. 레이어드 아키텍처 데이터 플로우                                    */
/* ================================================================== */

export function ArchView({ lang, vin, onSelectVin, onOpenVehicle }: TwinViewProps) {
  const { snapshot } = useTwin();
  return (
    <div className="tsview-pad" data-testid="tsview-arch">
      <ArchitectureFlow snapshot={snapshot} lang={lang} selectedVin={vin} onSelectVin={onSelectVin} onOpenVehicle={onOpenVehicle} />
    </div>
  );
}

/* ================================================================== */
/* 5. What-if 시뮬레이션 러너                                           */
/* ================================================================== */

export function SimulationView({ lang }: TwinViewProps) {
  const { snapshot, simInputs, applyPreset, patchSimInputs, simResult, runSim, rate, setRate, step } = useTwin();
  const presets = useMemo(() => E.SIM_PRESETS as T.SimPreset[], []);
  const [presetId, setPresetId] = useState<string>(presets[0]?.id ?? '');
  const [rerun, setRerun] = useState<T.SimulationResult | null>(null);

  const result = rerun ?? simResult ?? null;
  const activePreset = presets.find((p) => p.id === presetId) ?? presets[0];

  return (
    <div className="tsview-pad" data-testid="tsview-simulation">
      <div className="tsview-bar">
        <b>What-if 시뮬레이션</b>
        <select
          className="tselect"
          aria-label="시뮬레이션 프리셋"
          value={presetId}
          onChange={(e) => {
            setPresetId(e.target.value);
            applyPreset(e.target.value);
          }}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {T.pick(p.label, lang)}
            </option>
          ))}
        </select>
        <button type="button" className="tbtn" onClick={() => setRerun(runSim())}>
          ▶ 엔진 재실행
        </button>
        <button type="button" className="tbtn" onClick={() => step(1)}>
          +1s
        </button>
        {([0, 1, 5] as const).map((r) => (
          <button key={r} type="button" className={rate === r ? 'tbtn is-on' : 'tbtn'} onClick={() => setRate(r)}>
            ×{r}
          </button>
        ))}
        <span className="small muted mono" style={{ marginLeft: 'auto' }}>
          {simClockLabel(snapshot.clock).text} · x{snapshot.clock.rate}
        </span>
      </div>

      {activePreset && (
        <div className="tblock">
          <h3 className="tsect">
            입력 조건
            <span className="r small muted">{T.pick(activePreset.desc, lang)}</span>
          </h3>
          <div className="tsview-inputs">
            {(
              [
                ['batteryTemperature', '배터리 온도(°C)'],
                ['ambientTemperature', '외기 온도(°C)'],
                ['batterySoc', 'SOC(%)'],
                ['telemetryAgeSeconds', '텔레메트리 나이(s)'],
                ['network', '네트워크'],
                ['oneBinaryVersion', 'One Binary'],
                ['bmsSoftwareVersion', 'BMS S/W'],
                ['policyVersion', '정책 버전'],
                ['entitlementStatus', '권리(Entitlement)'],
                ['connectorState', '충전 커넥터'],
              ] as Array<[keyof T.SimulationInputs, string]>
            ).map(([key, label]) => (
              <label key={String(key)} className="tsview-input">
                <span>{label}</span>
                {typeof simInputs[key] === 'number' ? (
                  <input
                    type="number"
                    value={simInputs[key] as number}
                    onChange={(e) => patchSimInputs({ [key]: Number(e.target.value) } as Partial<T.SimulationInputs>)}
                  />
                ) : (
                  <input
                    value={String(simInputs[key] ?? '')}
                    onChange={(e) => patchSimInputs({ [key]: e.target.value } as Partial<T.SimulationInputs>)}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {result ? (
        <WhatIfRunner
          result={result}
          simTimeMs={snapshot.clock.simTimeMs}
          simTick={snapshot.clock.simTick}
          rate={rate}
          onSetRate={setRate}
          onStep={step}
          onRerun={() => setRerun(runSim())}
          lang={lang}
        />
      ) : (
        <div className="tshell-stage-fallback">
          <b>시뮬레이션 결과가 없습니다.</b>
          <span className="small muted">엔진 재실행을 누르면 실행 로그가 시뮬레이션 시각에 맞춰 재생됩니다.</span>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* 6. Closed-Loop Incident — 시각 파생 진행                            */
/* ================================================================== */

export function IncidentView({ lang, vin, onSelectVin, onOpenVehicle }: TwinViewProps) {
  const { snapshot, advanceLoop, closeIncident, recover, inject, activate } = useTwin();
  const { can } = useApp();
  const open = snapshot.incidents.filter((i) => i.status !== 'CLOSED');
  const all = snapshot.incidents;
  const firstOpen = open[0]?.incidentId ?? all[0]?.incidentId ?? '';
  const [incidentId, setIncidentId] = useState(firstOpen);
  const [stepDetail, setStepDetail] = useState('');
  const canRun = can('run-engine');

  /* Activate 는 provider 를 동기적으로 바꾸므로, 같은 핸들러에서 바로
     inject 하면 활성 VIN 위에 결함이 실제로 주입된다. */
  const seedIncident = useCallback(() => {
    if (!snapshot.rollout.active) activate();
    inject('BATTERY_TEMP_STALE');
  }, [snapshot.rollout.active, activate, inject]);

  useEffect(() => {
    if (!incidentId && firstOpen) setIncidentId(firstOpen);
  }, [incidentId, firstOpen]);

  const incident = all.find((i) => i.incidentId === incidentId) ?? all[0];
  const view = useMemo(() => closedLoopView(incident, snapshot.clock.simTimeMs), [incident, snapshot.clock.simTimeMs]);

  /* Incident 가 하나도 없으면 파이프라인은 "빈 화면"이 아니라 "시작 대기"다.
     12단계 골격을 PENDING 상태로 그대로 보여주고, 한 번의 클릭으로 실제
     시뮬레이션(활성화 → 결함 주입)이 시작되게 한다. */
  if (!incident) {
    const preview = E.CLOSED_LOOP_STEPS;
    return (
      <div className="tsview-pad" data-testid="tsview-incident-empty">
        <div className="tsview-bar">
          <b>Closed-Loop Incident</b>
          <span className="tsc tone-pass">IDLE</span>
          <span className="small muted">
            탐지 → 진단 → 격리 → Kill-Switch → 복구 → 재수렴 → 종료. 진행은 시뮬레이터 시각에서 파생됩니다.
          </span>
          <button
            type="button"
            className="tbtn is-on"
            style={{ marginLeft: 'auto' }}
            data-testid="tsseed-incident"
            onClick={seedIncident}
            disabled={!canRun}
          >
            ▶ Closed-Loop 데모 개시
          </button>
        </div>

        <div className="tsloop" data-testid="tsloop">
          <div className="tsloop-head">
            <span className="small muted">아직 개시 전 — 단계별 소요 {LOOP_STEP_MS / 1000}s</span>
            <div className="tbar">
              <i style={{ width: '0%' }} />
            </div>
            <span className="mono small" data-testid="tsloop-pct">
              0%
            </span>
          </div>
          <div className="tsloop-rail">
            {preview.map((label, i) => (
              <div key={i} className="tsloop-step is-pending" data-status="PENDING">
                <span className="ix">{i + 1}</span>
                <b className="lb">{T.pick(label, lang)}</b>
                <span className="small muted">대기</span>
                <span className="mono small">PENDING</span>
              </div>
            ))}
          </div>
          <div className="tsloop-count">
            대기 중 · Activate 후 결함을 주입하면 이 파이프라인이 실제로 전진합니다.
          </div>
        </div>

        <div className="tsview-grid3">
          <section className="tblock">
            <h3 className="tsect">주입 가능한 결함</h3>
            <ul className="tlist">
              {T.FAULTS.map((f) => (
                <li key={f.id}>
                  <div className="trow gap">
                    <span className="mono small">{f.id}</span>
                    <b className="small">{T.pick(f.label, lang)}</b>
                  </div>
                  <div className="small muted">{T.pick(f.desc, lang)}</div>
                </li>
              ))}
            </ul>
          </section>
          <section className="tblock">
            <h3 className="tsect">현재 상태</h3>
            <div className="tkv">
              <div className="tkv-row">
                <span>Rollout</span>
                <span className="mono">{snapshot.rollout.active ? 'ACTIVE' : 'INACTIVE'}</span>
              </div>
              <div className="tkv-row">
                <span>활성 VIN</span>
                <span className="mono">{snapshot.rollout.activatedVins.length}대</span>
              </div>
              <div className="tkv-row">
                <span>Sim 시각</span>
                <span className="mono">{simClockLabel(snapshot.clock).text}</span>
              </div>
            </div>
          </section>
          <section className="tblock">
            <h3 className="tsect">왜 먼저 Activate 인가</h3>
            <p className="small muted">
              결함은 <b>이미 배포된 차량</b>에서만 관측될 수 있습니다. 활성 차량이 없으면 차량 상태는
              “영향 없음”이 정답이며, Incident 를 만들어내지 않습니다.
            </p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="tsview-pad" data-testid="tsview-incident" data-incident={incident.incidentId}>
      <div className="tsview-bar">
        <b className="mono">{incident.incidentId}</b>
        <span className={`tsc ${incident.severity === 'SEV-1' ? 'tone-fail' : incident.severity === 'SEV-2' ? 'tone-pending' : 'tone-info'}`}>
          {incident.severity}
        </span>
        <span className="tsc">{incident.status}</span>
        <span className="small muted">{faultLabel(incident.fault, lang)}</span>
        <select className="tselect" aria-label="Incident 선택" value={incident.incidentId} onChange={(e) => setIncidentId(e.target.value)}>
          {all.map((i) => (
            <option key={i.incidentId} value={i.incidentId}>
              {i.incidentId} · {i.status}
            </option>
          ))}
        </select>
        <span className="mono small muted" style={{ marginLeft: 'auto' }} data-testid="tsview-incident-countdown">
          {loopLine(view, lang)}
        </span>
      </div>

      <div className="tsloop" data-testid="tsloop">
        <div className="tsloop-head">
          <span className="small muted">시뮬레이터 시각 파생 진행률</span>
          <div className="tbar">
            <i style={{ width: `${Math.round(view.pct * 100)}%` }} />
          </div>
          <span className="mono small" data-testid="tsloop-pct">
            {Math.round(view.pct * 100)}%
          </span>
        </div>
        <div className="tsloop-rail">
          {view.steps.map((s, i) => (
            <div
              key={s.id}
              className={`tsloop-step ${s.status === 'DONE' ? 'is-done' : s.status === 'ACTIVE' ? 'is-active' : 'is-pending'}`}
              data-status={s.status}
            >
              <span className="ix">{i + 1}</span>
              <b className="lb">{T.pick(s.label, lang)}</b>
              <span className="small muted">{T.pick(s.detail, lang)}</span>
              <span className="mono small">
                {s.status}
                {i === view.done && view.nextInS != null ? ` · ${view.nextInS}s` : ''}
              </span>
            </div>
          ))}
        </div>
        <div className="tsloop-count">
          {view.done}/{view.steps.length} 단계 · 경과 {Math.floor(view.elapsedS)}s · 자동 진행 {view.auto ? 'ON' : 'OFF'} · 단계 주기{' '}
          {LOOP_STEP_MS / 1000}s
        </div>
      </div>

      <div className="tsloop-actions">
        <input
          className="tinput"
          placeholder="단계 메모(증거·조치)"
          value={stepDetail}
          onChange={(e) => setStepDetail(e.target.value)}
          aria-label="단계 메모"
        />
        <button
          type="button"
          className="tbtn is-on"
          disabled={!view.open || view.done >= view.steps.length - 1}
          title="마지막 단계(Incident Close)는 자동/수동 진행 대상이 아닙니다 — 종료는 운영자 행위입니다"
          onClick={() => {
            advanceLoop(
              incident.incidentId,
              view.done,
              stepDetail ? ({ ko: stepDetail, en: stepDetail } as T.Localized) : undefined,
            );
            setStepDetail('');
          }}
        >
          다음 단계 +
        </button>
        <button type="button" className="tbtn" onClick={() => recover(incident.incidentId, incident.affectedVins)}>
          재수렴
        </button>
        <button type="button" className="tbtn" onClick={() => closeIncident(incident.incidentId)} disabled={incident.status === 'CLOSED'}>
          Incident 종료
        </button>
      </div>

      <div className="tsview-grid3">
        <section className="tblock">
          <h3 className="tsect">근본 원인</h3>
          <p className="small">{T.pick(incident.rootCause, lang)}</p>
          <div className="tkv">
            <div className="tkv-row">
              <span>Reason Code</span>
              <span className="mono">{incident.reasonCode}</span>
            </div>
            <div className="tkv-row">
              <span>탐지 주체</span>
              <span className="mono">{incident.detectedBy}</span>
            </div>
            <div className="tkv-row">
              <span>Rollout 일시정지</span>
              <span className="mono">{incident.rolloutPaused ? 'YES' : 'NO'}</span>
            </div>
            <div className="tkv-row">
              <span>Kill Switch</span>
              <span className="mono">
                {incident.killSwitch.active ? `ACTIVE · 영향 ${incident.killSwitch.affectedVins}대` : 'inactive'}
              </span>
            </div>
            <div className="tkv-row">
              <span>Policy / Rollout</span>
              <span className="mono">
                {incident.policyVersion} / {incident.rolloutId}
              </span>
            </div>
          </div>
        </section>

        <section className="tblock">
          <h3 className="tsect">
            증거 <span className="r mono">{incident.evidence.length}</span>
          </h3>
          <ul className="tlist" data-testid="tsview-incident-evidence">
            {incident.evidence.map((e) => (
              <li key={e.id}>
                <div className="trow gap">
                  <span className="mono small">{e.kind}</span>
                  <b className="small">{T.pick(e.label, lang)}</b>
                  <span className="mono small muted" style={{ marginLeft: 'auto' }}>
                    {e.capturedAt.slice(11, 19)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="tblock">
          <h3 className="tsect">
            영향 VIN <span className="r mono">{incident.affectedVins.length}</span>
          </h3>
          <ul className="tlist">
            {incident.affectedVins.slice(0, 10).map((v) => (
              <li key={v}>
                <button type="button" className={v === vin ? 'trowbtn is-on' : 'trowbtn'} onClick={() => onSelectVin(v)}>
                  <span className="nm mono">{v}</span>
                  <span className="mt mono small">선택</span>
                </button>
              </li>
            ))}
          </ul>
          {vin && (
            <button type="button" className="tbtn" onClick={() => onOpenVehicle(vin)}>
              선택 VIN 3D 상세 →
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 7. Revision / SoT (Single Source of Truth)                          */
/* ================================================================== */

export function RevisionView({ lang, vin, onSelectVin }: TwinViewProps) {
  const { snapshot } = useTwin();
  const [filter, setFilter] = useState<'all' | 'drift' | 'stale'>('all');

  const rows = useMemo(() => {
    const list = snapshot.twins.map((t) => {
      const v = snapshot.verdicts.find((x) => x.twin.vin === t.vin);
      const inst = t.featureInstances[T.FEATURE_ID];
      return {
        vin: t.vin,
        twinVersion: t.twinVersion,
        featureVersion: inst?.featureVersion ?? '–',
        policyVersion: inst?.policy.policyVersion ?? '–',
        cachedSeq: inst?.policy.cachedVersionSeq ?? 0,
        signature: inst?.policy.signatureStatus ?? 'UNKNOWN',
        receivedPolicy: inst?.reported.receivedPolicyVersion ?? null,
        one: t.asDeployed.oneBinaryVersion,
        bms: t.asDeployed.bmsSoftwareVersion,
        install: t.asDeployed.installationStatus,
        reconciliation: v?.reconciliation.result ?? 'UNKNOWN',
        drift: v?.reconciliation.result === 'CRITICAL_DRIFT' || v?.reconciliation.result === 'REJECTED',
        stale: v?.health === 'STALE' || v?.health === 'OFFLINE',
      };
    });
    if (filter === 'drift') return list.filter((r) => r.drift);
    if (filter === 'stale') return list.filter((r) => r.stale);
    return list;
  }, [snapshot, filter]);

  const driftCount = snapshot.verdicts.filter((v) => v.reconciliation.result === 'CRITICAL_DRIFT').length;
  const staleCount = snapshot.verdicts.filter((v) => v.health === 'STALE' || v.health === 'OFFLINE').length;

  return (
    <div className="tsview-pad" data-testid="tsview-revision">
      <div className="tsview-bar">
        <b>Revision · SoT 대조</b>
        <span className="tsc mono">revision {snapshot.revision}</span>
        <span className="tsc mono">tick {snapshot.clock.simTick}</span>
        <select className="tselect" aria-label="필터" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">전체 VIN ({snapshot.twins.length})</option>
          <option value="drift">Effective Drift ({driftCount})</option>
          <option value="stale">Stale / Offline ({staleCount})</option>
        </select>
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          Desired ≠ Effective 인 행은 색과 함께 사유가 표시됩니다
        </span>
      </div>

      <div className="tsrev-grid">
        {(
          [
            ['Feature', T.FEATURE_ID, T.FEATURE_VERSION],
            ['Policy (Release SoT)', T.DEMO_POLICY.policyId, T.DEMO_POLICY.policyVersion],
            ['Rollout', T.DEMO_ROLLOUT_ID, snapshot.rollout.scope],
            ['State revision', `#${snapshot.revision}`, `tick ${snapshot.clock.simTick}`],
          ] as Array<[string, string, string]>
        ).map(([k, a, b]) => (
          <div key={k} className="tblock tsrev-card">
            <div className="small muted">{k}</div>
            <div className="mono">{a}</div>
            <div className="small mono muted">{b}</div>
          </div>
        ))}
      </div>

      <div className="table-wrap">
        <table className="twin-table small" data-testid="tsrev-table">
          <thead>
            <tr>
              <th>VIN</th>
              <th>State Ver</th>
              <th>정책(SoT)</th>
              <th>차량 수신</th>
              <th>seq</th>
              <th>서명</th>
              <th>One / BMS</th>
              <th>설치</th>
              <th>수렴</th>
              <th>판정 사유</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 60).map((r) => {
              const v = snapshot.verdicts.find((x) => x.twin.vin === r.vin);
              const mismatch = r.receivedPolicy != null && r.receivedPolicy !== r.policyVersion;
              return (
                <tr key={r.vin} className={r.drift ? 'row-fail' : r.stale ? 'row-pending' : ''} data-mismatch={mismatch}>
                  <td>
                    <button type="button" className={r.vin === vin ? 'trowbtn is-on' : 'trowbtn'} onClick={() => onSelectVin(r.vin)}>
                      <span className="nm mono">{r.vin}</span>
                    </button>
                  </td>
                  <td className="mono">#{r.twinVersion}</td>
                  <td className="mono">
                    {r.policyVersion}
                    <span className="small muted"> · {r.featureVersion}</span>
                  </td>
                  <td className="mono">
                    {r.receivedPolicy ?? '–'}
                    {mismatch && <span className="tag tag-fail">MISMATCH</span>}
                  </td>
                  <td className="mono">{r.cachedSeq}</td>
                  <td className="mono">{r.signature}</td>
                  <td className="mono">
                    {r.one} / {r.bms}
                  </td>
                  <td className="mono">{r.install}</td>
                  <td>
                    <RecBadge value={r.reconciliation} />
                  </td>
                  <td>{v ? T.pick(v.verdictReason.label, lang) : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="small muted">
        표시 {rows.slice(0, 60).length} / {rows.length} 행 · 정책 SoT 는 Release 레지스트리, 차량 수신 값은 Deployment 결과입니다.
        두 값이 다르면 차량은 <StateChip kind="E" value="DRIFT" /> 로 판정됩니다.
      </div>
    </div>
  );
}
