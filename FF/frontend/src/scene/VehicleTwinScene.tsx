/**
 * §17.3 — 차량 디지털 트윈 3D 뷰(2세대) — 관제실/엔지니어링 스타일 씬 + HUD.
 *
 * `pages/twinLive.tsx` 의 1세대 `VehicleModel`/`PartMesh`/`TwinScene`/`CameraRig`/
 * `Schematic2D`/`buildVehicleParts` 를 대체하기 위한 모듈. 이 파일은 오직
 * `scene/vehicleParts.ts`(순수 데이터) 와 `scene/vehicleGeometry.tsx`(절차적 형상) 를
 * 조립할 뿐 Twin 판정을 재계산하지 않는다(§8 단일 원천 원칙).
 *
 * 모든 모션은 `clock.simTimeMs` / `clock.simTick` / `clock.rate` 로만 구동한다.
 * `clock.rate === 0` 이면 부품 펄스 · 흐름 패킷 · 카메라 투어가 전부 멈춘다.
 */
import { Component, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Twin, Lang } from '../data/twin/types';
import { pick } from '../data/twin/types';
import type { TwinClock } from '../data/twin/port';
import type { TwinVerdict } from '../data/twin/engine';
import {
  buildVehicleParts,
  flowEdges,
  CAMERA_PRESETS,
  CAMERA_TOUR,
  TOUR_DWELL_MS,
  PART_STATE_HEX,
  PART_STATE_LABEL,
  type CameraPreset,
  type Layer,
  type PartId,
  type VehiclePart,
} from './vehicleParts';
import {
  SimClockContext,
  SceneFloor,
  CarShell,
  BatteryPackNode,
  HeaterPadNode,
  EcuBoxNode,
  GuardNode,
  ChargePortNode,
  AntennaNode,
  CloudNode,
  HvJunctionBox,
  CoolantLoop,
  FlowEdgeView,
} from './vehicleGeometry';
import { LabelManager } from './labels';
import './vehicleTwin.css';

export interface VehicleTwinSceneProps {
  twin: Twin;
  verdict?: TwinVerdict;
  /** 모든 모션의 유일한 시간 원천 — simTimeMs/simTick/rate 만 읽는다(벽시계 금지). */
  clock: TwinClock;
  lang: Lang;
  /** false 면 `<Canvas>` 대신 `fallback` 을 그대로 렌더한다(오류 화면 없음). */
  webgl: boolean;
  fallback?: ReactNode;
  selected?: PartId;
  onSelect?: (id: PartId) => void;
  /** 렌더 실패를 부모에 알리고 싶을 때만 쓴다(선택). */
  onSceneFail?: (error: unknown) => void;
  height?: number;
}

/* ------------------------------------------------------------------ */
/* 레이어 필터 칩                                                        */
/* ------------------------------------------------------------------ */

type LayerFilter = Layer | 'ALL';

const LAYER_CHIPS: Array<{ id: LayerFilter; label: string }> = [
  { id: 'ALL', label: '전체' },
  { id: 'CLOUD', label: 'CLOUD' },
  { id: 'VEHICLE_EDGE', label: 'EDGE' },
  { id: 'ECU', label: 'ECU' },
  { id: 'ACTUATOR', label: 'ACTUATOR' },
  { id: 'SENSOR', label: 'SENSOR' },
];

/* ------------------------------------------------------------------ */
/* 3D 렌더가 실패해도 화면 전체를 잃지 않도록 씬 단위로 격리한다.          */
/* ------------------------------------------------------------------ */

class SceneBoundary extends Component<
  { fallback: ReactNode; onSceneFail?: (error: unknown) => void; children: ReactNode },
  { failed: boolean }
> {
  constructor(props: { fallback: ReactNode; onSceneFail?: (error: unknown) => void; children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onSceneFail?.(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/* 카메라 리그 — 프리셋으로 프레임 델타 기반 이징(시뮬레이션 상태 아님).   */
/* ------------------------------------------------------------------ */

function CameraRig({ preset }: { preset: CameraPreset }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => (s as unknown as { controls?: { target: THREE.Vector3; update?: () => void } }).controls);
  const cfg = CAMERA_PRESETS[preset];
  const wantPos = useRef(new THREE.Vector3(cfg.pos[0], cfg.pos[1], cfg.pos[2]));
  const wantTarget = useRef(new THREE.Vector3(cfg.target[0], cfg.target[1], cfg.target[2]));
  wantPos.current.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  wantTarget.current.set(cfg.target[0], cfg.target[1], cfg.target[2]);
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    if (!camera) return;
    const k = Math.min(1, dt * 3.2);
    camera.position.lerp(wantPos.current, k);
    target.lerp(wantTarget.current, k);
    if (controls?.target) {
      controls.target.copy(target);
      controls.update?.();
    } else {
      camera.lookAt(target);
    }
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* 시뮬레이션 시각을 컨텍스트 ref 로 매 프레임 갱신 — Math.random/Date.now 금지 */
/* ------------------------------------------------------------------ */

function ClockDriver({
  clock,
  node,
}: {
  clock: TwinClock;
  node: { current: number; tick: number; rate: 0 | 1 | 5 };
}) {
  useFrame(() => {
    node.current = clock.simTimeMs;
    node.tick = clock.simTick;
    node.rate = clock.rate;
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* 폭발/컷어웨이 오프셋 — 부품 앵커의 수평 방향으로 밀어낸다.             */
/* ------------------------------------------------------------------ */

function explodeOffset(anchor: [number, number, number], factor: number): [number, number, number] {
  if (factor <= 0) return [0, 0, 0];
  const [x, , z] = anchor;
  const horiz = Math.hypot(x, z) || 1;
  return [(x / horiz) * 0.9 * factor, 0.45 * factor, (z / horiz) * 0.9 * factor];
}

/* ------------------------------------------------------------------ */
/* 차량 모델 — 절차적 지오메트리를 조립한다.                             */
/* ------------------------------------------------------------------ */

function VehicleModel({
  parts,
  selected,
  onSelect,
  xray,
  flowing,
  explode,
  layerActive,
  lang,
}: {
  parts: VehiclePart[];
  selected: PartId;
  onSelect: (id: PartId) => void;
  xray: boolean;
  flowing: boolean;
  explode: number;
  layerActive: (layer: Layer) => boolean;
  lang: Lang;
}) {
  const byId = useMemo(() => {
    const map = {} as Record<PartId, VehiclePart>;
    for (const p of parts) map[p.id] = p;
    return map;
  }, [parts]);
  const edges = useMemo(() => flowEdges(parts), [parts]);
  if (!byId.body) return null;

  const factor = explode / 100;
  const dim = (id: PartId) => !layerActive(byId[id].layer);
  const off = (id: PartId) => explodeOffset(byId[id].anchor, factor);
  const anchorOf = (id: PartId): [number, number, number] => {
    const a = byId[id].anchor;
    const o = off(id);
    return [a[0] + o[0], a[1] + o[1], a[2] + o[2]];
  };

  let calloutBudget = 2;
  const cloudPos: [number, number, number] = [byId.antenna.anchor[0], byId.antenna.anchor[1] + 1.35, byId.antenna.anchor[2] - 1.5];

  return (
    <group>
      <CarShell xray={xray} />
      {byId.battery && <BatteryPackNode part={byId.battery} selected={selected === 'battery'} onSelect={onSelect} dim={dim('battery')} explode={off('battery')} />}
      {byId.heater && <HeaterPadNode part={byId.heater} selected={selected === 'heater'} onSelect={onSelect} dim={dim('heater')} explode={off('heater')} />}
      {byId.bms && <EcuBoxNode part={byId.bms} selected={selected === 'bms'} onSelect={onSelect} dim={dim('bms')} explode={off('bms')} />}
      {byId.vcu && <EcuBoxNode part={byId.vcu} selected={selected === 'vcu'} onSelect={onSelect} dim={dim('vcu')} explode={off('vcu')} />}
      {byId.cgw && <EcuBoxNode part={byId.cgw} selected={selected === 'cgw'} onSelect={onSelect} dim={dim('cgw')} explode={off('cgw')} />}
      {byId.hvac && <EcuBoxNode part={byId.hvac} selected={selected === 'hvac'} onSelect={onSelect} dim={dim('hvac')} explode={off('hvac')} withFan />}
      {byId.guard && <GuardNode part={byId.guard} selected={selected === 'guard'} onSelect={onSelect} dim={dim('guard')} explode={off('guard')} />}
      {byId.charge && <ChargePortNode part={byId.charge} selected={selected === 'charge'} onSelect={onSelect} dim={dim('charge')} explode={off('charge')} />}
      {byId.antenna && <AntennaNode part={byId.antenna} selected={selected === 'antenna'} onSelect={onSelect} dim={dim('antenna')} explode={off('antenna')} />}

      {byId.battery && byId.bms && byId.hvac && (
        <HvJunctionBox battery={anchorOf('battery')} bms={anchorOf('bms')} hvac={anchorOf('hvac')} dim={dim('bms')} />
      )}
      {byId.battery && byId.heater && byId.hvac && <CoolantLoop battery={anchorOf('battery')} heater={anchorOf('heater')} hvac={anchorOf('hvac')} />}

      {layerActive('CLOUD') && <CloudNode position={cloudPos} />}
      {layerActive('CLOUD') && byId.antenna && (
        <FlowEdgeView
          edge={{ id: 'cloud->antenna', from: 'antenna', to: 'antenna', kind: 'command', blocked: false }}
          from={cloudPos}
          to={anchorOf('antenna')}
          flowing={flowing}
          dim={false}
          showCallout={false}
          lang={lang}
        />
      )}

      {edges.map((e) => {
        const edgeDim = dim(e.from) && dim(e.to);
        const callout = e.blocked && calloutBudget > 0;
        if (callout) calloutBudget--;
        return (
          <FlowEdgeView
            key={e.id}
            edge={e}
            from={anchorOf(e.from)}
            to={anchorOf(e.to)}
            flowing={flowing}
            dim={edgeDim}
            showCallout={callout}
            lang={lang}
          />
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* HUD — 레이어 · 폭발 · 흐름 · X-ray · 카메라 · 투어 · 부품 목록 · 범례   */
/* ------------------------------------------------------------------ */

function Hud({
  parts,
  selected,
  onSelect,
  activeLayers,
  toggleLayer,
  explode,
  setExplode,
  flowing,
  setFlowing,
  xray,
  setXray,
  preset,
  onPreset,
  touring,
  onToggleTour,
  paused,
}: {
  parts: VehiclePart[];
  selected: PartId;
  onSelect: (id: PartId) => void;
  activeLayers: Set<LayerFilter>;
  toggleLayer: (id: LayerFilter) => void;
  explode: number;
  setExplode: (n: number) => void;
  flowing: boolean;
  setFlowing: (b: boolean) => void;
  xray: boolean;
  setXray: (b: boolean) => void;
  preset: CameraPreset;
  onPreset: (p: CameraPreset) => void;
  touring: boolean;
  onToggleTour: () => void;
  paused: boolean;
}) {
  return (
    <div className="veh-hud" data-testid="veh-hud">
      <div className="veh-hud-row" role="group" aria-label="레이어 필터">
        <span className="veh-hud-label">레이어</span>
        {LAYER_CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="veh-chip"
            aria-pressed={activeLayers.has(c.id)}
            onClick={() => toggleLayer(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="veh-hud-row" role="group" aria-label="카메라 프리셋">
        <span className="veh-hud-label">카메라</span>
        {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((id) => (
          <button
            key={id}
            type="button"
            className="veh-camera-btn"
            aria-pressed={!touring && preset === id}
            title={CAMERA_PRESETS[id].hint}
            onClick={() => onPreset(id)}
          >
            {CAMERA_PRESETS[id].label}
          </button>
        ))}
        <button type="button" className="veh-tour-btn" aria-pressed={touring} onClick={onToggleTour}>
          ▶ 투어{touring ? ' 진행 중' : ''}
        </button>
      </div>

      <div className="veh-hud-row">
        <label className="veh-slider">
          <span className="veh-hud-label">Explode</span>
          <input
            type="range"
            min={0}
            max={100}
            value={explode}
            aria-label="explode 비율"
            onChange={(e) => setExplode(Number(e.target.value))}
          />
          <span>{explode}%</span>
        </label>
        <button type="button" className="veh-toggle" aria-pressed={flowing} onClick={() => setFlowing(!flowing)}>
          흐름 표시 {flowing ? 'ON' : 'OFF'}
        </button>
        <button type="button" className="veh-toggle" aria-pressed={xray} onClick={() => setXray(!xray)}>
          X-ray 차체 {xray ? 'ON' : 'OFF'}
        </button>
        {paused && (
          <span className="veh-toggle" aria-live="polite">
            ⏸ 시뮬레이션 정지 — 모든 흐름/펄스가 멈췄습니다
          </span>
        )}
      </div>

      <div className="veh-hud-row veh-part-list" role="group" aria-label="부품 목록">
        {parts.map((p) => (
          <button
            key={p.id}
            type="button"
            className="veh-part-btn"
            aria-pressed={selected === p.id}
            onClick={() => onSelect(p.id)}
            title={p.note}
          >
            <span className="veh-part-dot" style={{ background: PART_STATE_HEX[p.state] }} />
            {p.label} · {PART_STATE_LABEL[p.state]}
          </button>
        ))}
      </div>

      <div className="veh-legend" data-testid="veh-legend">
        {(Object.keys(PART_STATE_LABEL) as Array<keyof typeof PART_STATE_LABEL>).map((s) => (
          <span key={s} className="veh-legend-item">
            <span className="veh-legend-swatch" style={{ background: PART_STATE_HEX[s] }} />
            {PART_STATE_LABEL[s]}
          </span>
        ))}
        <span className="veh-legend-item">
          <span className="veh-legend-line" style={{ borderTopColor: '#3B82F6' }} /> Desired(하강)
        </span>
        <span className="veh-legend-item">
          <span className="veh-legend-line" style={{ borderTopColor: '#33C27A' }} /> Reported(상승)
        </span>
        <span className="veh-legend-item">
          <span className="veh-legend-line blocked" style={{ borderTopColor: '#D64545' }} /> 차단(사유 코드 표시)
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 메인 컴포넌트                                                        */
/* ------------------------------------------------------------------ */

export default function VehicleTwinScene({
  twin,
  verdict,
  clock,
  lang,
  webgl,
  fallback,
  selected,
  onSelect,
  onSceneFail,
  height = 520,
}: VehicleTwinSceneProps) {
  const killActive = !!twin.killSwitch?.active;
  const parts = useMemo(() => buildVehicleParts(twin, verdict, killActive), [twin, verdict, killActive]);

  const [internalSelected, setInternalSelected] = useState<PartId>('body');
  const activeSelected = selected ?? internalSelected;
  const handleSelect = useCallback(
    (id: PartId) => {
      setInternalSelected(id);
      onSelect?.(id);
    },
    [onSelect],
  );

  const [activeLayers, setActiveLayers] = useState<Set<LayerFilter>>(() => new Set(['ALL']));
  const toggleLayer = useCallback((id: LayerFilter) => {
    setActiveLayers((prev) => {
      if (id === 'ALL') return new Set<LayerFilter>(['ALL']);
      const next = new Set(prev);
      next.delete('ALL');
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) next.add('ALL');
      return next;
    });
  }, []);
  const layerActive = useCallback((layer: Layer) => activeLayers.has('ALL') || activeLayers.has(layer), [activeLayers]);

  const [explode, setExplode] = useState(0);
  const [flowing, setFlowing] = useState(true);
  const [xray, setXray] = useState(false);
  const [manualPreset, setManualPreset] = useState<CameraPreset>('exterior');
  const [touring, setTouring] = useState(false);

  const activePreset = touring ? CAMERA_TOUR[Math.floor(clock.simTimeMs / TOUR_DWELL_MS) % CAMERA_TOUR.length] : manualPreset;
  const selectPreset = useCallback((p: CameraPreset) => {
    setManualPreset(p);
    setTouring(false);
  }, []);
  const toggleTour = useCallback(() => setTouring((t) => !t), []);

  const clockNode = useRef({ current: clock.simTimeMs, tick: clock.simTick, rate: clock.rate });
  clockNode.current.current = clock.simTimeMs;
  clockNode.current.tick = clock.simTick;
  clockNode.current.rate = clock.rate;

  const paused = clock.rate === 0;

  if (!webgl) {
    return (
      <div className="veh-root veh-fallback" data-testid="veh-fallback">
        {fallback}
      </div>
    );
  }

  return (
    <div className={`veh-root${paused ? ' veh-paused' : ''}`} data-paused={paused ? 'true' : 'false'} data-testid="veh-scene-root">
      <div className="veh-canvas-wrap" style={{ height }}>
        {paused && (
          <span className="veh-paused-banner" data-testid="veh-paused-banner">
            {pick({ ko: '⏸ 일시정지 — Rate 0', en: '⏸ Paused — rate 0' }, lang)}
          </span>
        )}
        <SceneBoundary fallback={fallback} onSceneFail={onSceneFail}>
          <Canvas
            data-testid="veh-canvas"
            dpr={[1, 2]}
            camera={{ position: CAMERA_PRESETS[activePreset].pos, fov: 42 }}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            onCreated={({ gl }) => gl.setClearColor('#0a0d13')}
          >
            <SimClockContext.Provider value={clockNode.current}>
              <ClockDriver clock={clock} node={clockNode.current} />
              <CameraRig preset={activePreset} />
              <ambientLight intensity={0.55} />
              <directionalLight position={[6, 9, 5]} intensity={0.95} />
              <hemisphereLight args={['#3a4a66', '#05070b', 0.4]} />
              <SceneFloor />
              <VehicleModel
                parts={parts}
                selected={activeSelected}
                onSelect={handleSelect}
                xray={xray}
                flowing={flowing && !paused}
                explode={explode}
                layerActive={layerActive}
                lang={lang}
              />
              <LabelManager mode="auto" />
              <OrbitControls target={CAMERA_PRESETS[activePreset].target} enablePan={false} minDistance={1.2} maxDistance={20} maxPolarAngle={Math.PI / 2.05} />
            </SimClockContext.Provider>
          </Canvas>
        </SceneBoundary>
      </div>
      <Hud
        parts={parts}
        selected={activeSelected}
        onSelect={handleSelect}
        activeLayers={activeLayers}
        toggleLayer={toggleLayer}
        explode={explode}
        setExplode={setExplode}
        flowing={flowing}
        setFlowing={setFlowing}
        xray={xray}
        setXray={setXray}
        preset={activePreset}
        onPreset={selectPreset}
        touring={touring}
        onToggleTour={toggleTour}
        paused={paused}
      />
    </div>
  );
}
