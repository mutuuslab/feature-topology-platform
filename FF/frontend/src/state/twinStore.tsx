/**
 * §16 — Twin 상태 Provider.
 *
 * 화면은 오직 이 컨텍스트를 통해서만 Twin 계층에 접근한다. 내부는
 * `MockTwinProvider`(인메모리)이지만 포트 경계를 지키므로 Eclipse Ditto /
 * AWS IoT Device Shadow / KUKSA 어댑터로 교체해도 화면은 그대로 동작한다.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { MockTwinProvider } from '../data/twin/simulator';
import type { RolloutState, TwinStoreSnapshot } from '../data/twin/port';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';
import { useAppApi, useAppShell } from '../store';

/** 결정적 데모 기준 시각 — 시드 Fleet 의 상대 시각이 모두 여기서 파생된다. */
export const TWIN_NOW_MS = Date.parse('2026-09-13T10:00:00Z');

export function createTwinProvider(opts: { nowMs?: number; rate?: 0 | 1 | 5 } = {}): MockTwinProvider {
  return new MockTwinProvider({ nowMs: opts.nowMs ?? TWIN_NOW_MS, rate: opts.rate ?? 0 });
}

export type TwinTone = 'PASS' | 'PENDING' | 'FAIL' | 'INFO';
export type TwinScope = 'CANARY' | 'WAVE' | 'FLEET';

export interface TwinContextValue {
  snapshot: TwinStoreSnapshot;
  provider: MockTwinProvider;
  rate: 0 | 1 | 5;
  setRate: (rate: 0 | 1 | 5) => void;
  step: (seconds?: number) => void;
  scope: TwinScope;
  setScope: (scope: TwinScope) => void;
  targetRule: T.TargetRule;
  setTargetRule: (rule: T.TargetRule) => void;
  impact: T.TwinImpactResult;
  setGate: (gate: Partial<T.ImpactGate>) => void;
  simInputs: T.SimulationInputs;
  applyPreset: (presetId: string) => void;
  patchSimInputs: (patch: Partial<T.SimulationInputs>) => void;
  simResult: T.SimulationResult;
  runSim: (inputs?: T.SimulationInputs) => T.SimulationResult;
  /** §13 5단계 Canary 활성화 → §13 6단계 수렴 모니터링. */
  activate: (scope?: TwinScope) => RolloutState;
  pause: (reason?: T.Localized) => void;
  resume: () => void;
  rollback: (vins?: string[]) => string[];
  /** §15 Kill-Switch — Feature ID / Policy Version / Safe State / 영향 VIN 이 함께 기록된다. */
  kill: (vins: string[] | 'ALL', reason: T.Localized, incidentId?: string) => string[];
  releaseKill: () => void;
  inject: (fault: T.FaultType, vins?: string[]) => T.TwinIncident;
  advanceLoop: (incidentId: string, current: number, detail?: T.Localized) => void;
  closeIncident: (incidentId: string) => T.TwinIncident | null;
  recover: (incidentId: string, vins: string[]) => void;
  reset: () => void;
}

/**
 * 틱과 무관한 Twin API 슬라이스 — 스냅샷/엔진 인스턴스/파생 impact 는 제외한다.
 * 이 값은 사용자가 조작(rate·scope·targetRule·simInputs)할 때만 새로 만들어진다.
 */
export type TwinApiValue = Omit<TwinContextValue, 'snapshot' | 'provider' | 'impact'>;

const Ctx = createContext<TwinContextValue | null>(null);
/**
 * 실시간 스냅샷에서 분리된 컨텍스트.
 * - ProviderCtx  : 엔진 인스턴스(앱 수명 동안 1개). 셀렉터 구독의 기반.
 * - ApiCtx       : 액션 + 사용자 설정(rate/scope/targetRule/simInputs). 틱마다 바뀌지 않는다.
 */
const ProviderCtx = createContext<MockTwinProvider | null>(null);
const ApiCtx = createContext<TwinApiValue | null>(null);

const PERSIST_KEY = 'fp.twin.v1';

interface Persisted {
  rate?: 0 | 1 | 5;
  scope?: TwinScope;
  targetRule?: T.TargetRule;
  simInputs?: T.SimulationInputs;
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw) return JSON.parse(raw) as Persisted;
  } catch {
    /* 손상된 캐시는 무시하고 기본값으로 시작한다 */
  }
  return {};
}

function clockish(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return '2026-09-13 10:00';
  }
}

export function TwinProvider({ children }: { children: ReactNode }) {
  const { dispatch } = useAppApi();
  const { role: actor } = useAppShell();
  const [provider] = useState(() => createTwinProvider());
  const persisted = useMemo(loadPersisted, []);

  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => provider.subscribe(listener), [provider]),
    useCallback(() => provider.getSnapshot(), [provider]),
  );

  const [rate, setRateState] = useState<0 | 1 | 5>(persisted.rate ?? 1);
  const [scope, setScope] = useState<TwinScope>(persisted.scope ?? 'CANARY');
  const [targetRule, setTargetRule] = useState<T.TargetRule>(persisted.targetRule ?? T.DEMO_TARGET_RULE);
  const [simInputs, setSimInputs] = useState<T.SimulationInputs>(persisted.simInputs ?? E.DEFAULT_SIM_INPUTS);
  const [simResult, setSimResult] = useState<T.SimulationResult>(() =>
    E.runSimulation(persisted.simInputs ?? E.DEFAULT_SIM_INPUTS, TWIN_NOW_MS),
  );

  // 실시간 시뮬레이션 — rate 0 이면 정지 (Step 버튼은 수동 진행)
  useEffect(() => {
    provider.setRate(rate);
    if (rate === 0) return;
    const id = setInterval(() => provider.tick(1000), 1000);
    return () => clearInterval(id);
  }, [provider, rate]);

  useEffect(() => {
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify({ rate, scope, targetRule, simInputs }));
    } catch {
      /* 저장 실패는 데모 동작에 영향을 주지 않는다 */
    }
  }, [rate, scope, targetRule, simInputs]);

  const audit = useCallback(
    (action: string, target: string, detail: string) =>
      dispatch({ t: 'AUDIT', entry: { ts: clockish(provider.getSnapshot().clock.simTimeMs), actor, action, target, detail } }),
    [dispatch, actor, provider],
  );

  const setRate = useCallback((next: 0 | 1 | 5) => setRateState(next), []);

  const step = useCallback(
    (seconds = 5) => {
      provider.step(seconds);
      audit('TWIN_STEP', T.FEATURE_ID, `simTick +1 (${seconds}s)`);
    },
    [provider, audit],
  );

  const setGate = useCallback(
    (gate: Partial<T.ImpactGate>) => {
      provider.setGate(gate);
      audit('TWIN_GATE', T.DEMO_ROLLOUT_ID, JSON.stringify(gate));
    },
    [provider, audit],
  );

  const activate = useCallback(
    (nextScope: TwinScope = scope) => {
      const rollout = provider.activatePolicy(nextScope);
      setScope(nextScope);
      audit(
        'TWIN_ACTIVATE',
        T.FEATURE_ID,
        `${nextScope} · Policy-only ${rollout.activatedVins.length}대 · Binary OTA ${rollout.binaryOtaVins.length}대`,
      );
      return rollout;
    },
    [provider, scope, audit],
  );

  const pause = useCallback(
    (reason?: T.Localized) => {
      const text = reason ?? { ko: '운영자 판단에 의한 일시정지', en: 'Paused by operator decision' };
      provider.pauseRollout(text);
      audit('TWIN_PAUSE', T.DEMO_ROLLOUT_ID, text.ko);
    },
    [provider, audit],
  );

  const resume = useCallback(() => {
    provider.resumeRollout();
    audit('TWIN_RESUME', T.DEMO_ROLLOUT_ID, '신규 Rollout 재개');
  }, [provider, audit]);

  const rollback = useCallback(
    (vins?: string[]) => {
      const rolled = provider.rollback(vins);
      audit('TWIN_ROLLBACK', T.FEATURE_ID, `${rolled.length}대 Desired=OFF`);
      return rolled;
    },
    [provider, audit],
  );

  const kill = useCallback(
    (vins: string[] | 'ALL', reason: T.Localized, incidentId?: string) => {
      const affected = provider.killSwitch(vins === 'ALL' ? 'ALL' : vins, reason, incidentId);
      audit('TWIN_KILL_SWITCH', T.FEATURE_ID, `Safe State=OFF · ${affected.length}대 · ${reason.ko}`);
      return affected;
    },
    [provider, audit],
  );

  const releaseKill = useCallback(() => {
    provider.releaseKillSwitch();
    audit('TWIN_KILL_SWITCH_RELEASE', T.FEATURE_ID, 'Kill-Switch 해제 — 재수렴 확인 필요');
  }, [provider, audit]);

  const inject = useCallback(
    (fault: T.FaultType, vins?: string[]) => {
      const incident = provider.injectFault(fault, vins);
      audit('TWIN_FAULT_INJECT', incident.incidentId, `${fault} · ${incident.affectedVins.length}대 영향`);
      return incident;
    },
    [provider, audit],
  );

  const advanceLoop = useCallback(
    (incidentId: string, current: number, detail?: T.Localized) => {
      provider.advanceClosedLoop(incidentId, current, detail);
      audit('TWIN_CLOSED_LOOP', incidentId, `단계 ${current + 1}/${E.CLOSED_LOOP_STEPS.length}`);
    },
    [provider, audit],
  );

  const closeIncident = useCallback(
    (incidentId: string) => {
      const incident = provider.closeIncident(incidentId);
      if (incident) audit('TWIN_INCIDENT_CLOSE', incidentId, `복구 완료 · Evidence ${incident.evidence.length}건`);
      return incident;
    },
    [provider, audit],
  );

  const recover = useCallback(
    (incidentId: string, vins: string[]) => {
      provider.recoverCohort(incidentId, vins);
      audit('TWIN_RECOVER', incidentId, `${vins.length}대 재수렴 시작`);
    },
    [provider, audit],
  );

  const reset = useCallback(() => {
    provider.resetAll();
    setRateState(0);
    audit('TWIN_RESET', T.FEATURE_ID, 'Twin 스냅샷 초기화');
  }, [provider, audit]);

  const runSim = useCallback(
    (inputs?: T.SimulationInputs) => {
      const next = inputs ?? simInputs;
      setSimInputs(next);
      const result = provider.runSimulation(next);
      setSimResult(result);
      return result;
    },
    [provider, simInputs],
  );

  const patchSimInputs = useCallback(
    (patch: Partial<T.SimulationInputs>) => {
      const next = { ...simInputs, ...patch };
      setSimInputs(next);
      setSimResult(provider.runSimulation(next));
    },
    [provider, simInputs],
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = E.SIM_PRESETS.find((p) => p.id === presetId) ?? E.SIM_PRESETS[0];
      runSim(E.simInputsFor(preset));
    },
    [runSim],
  );

  const impact = useMemo(
    () => provider.queryTargetFacts(targetRule),
    [provider, targetRule, snapshot.revision],
  );

  // 스냅샷을 뺀 API 슬라이스 — 덕분에 액션만 쓰는 화면은 1초 틱마다 리렌더되지 않는다.
  const api = useMemo<TwinApiValue>(
    () => ({
      rate,
      setRate,
      step,
      scope,
      setScope,
      targetRule,
      setTargetRule,
      setGate,
      simInputs,
      applyPreset,
      patchSimInputs,
      simResult,
      runSim,
      activate,
      pause,
      resume,
      rollback,
      kill,
      releaseKill,
      inject,
      advanceLoop,
      closeIncident,
      recover,
      reset,
    }),
    [
      rate, setRate, step, scope, targetRule, setGate, simInputs, applyPreset, patchSimInputs,
      simResult, runSim, activate, pause, resume, rollback, kill, releaseKill, inject,
      advanceLoop, closeIncident, recover, reset,
    ],
  );

  const value = useMemo<TwinContextValue>(
    () => ({ snapshot, provider, impact, ...api }),
    [snapshot, provider, impact, api],
  );

  return (
    <ProviderCtx.Provider value={provider}>
      <ApiCtx.Provider value={api}>
        <Ctx.Provider value={value}>{children}</Ctx.Provider>
      </ApiCtx.Provider>
    </ProviderCtx.Provider>
  );
}

export function useTwin(): TwinContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTwin must be used inside <TwinProvider>');
  return ctx;
}

/**
 * 기존 화면(Fleet/Release/Incident)에서 Twin 연계 UI를 선택적으로 붙일 때 사용한다.
 * Twin 계층 없이 렌더되는 기존 테스트를 깨지 않기 위해 null 을 허용한다.
 */
export function useTwinOptional(): TwinContextValue | null {
  return useContext(Ctx);
}

/** Per-VIN verdict 조회 — 상세 화면이 반복 계산하지 않도록 한 곳에 모은다. */
export function useTwinVerdict(vin: string | undefined): E.TwinVerdict | null {
  const { snapshot } = useTwin();
  return useMemo(() => (vin ? snapshot.verdicts.find((v) => v.twin.vin === vin) ?? null : null), [snapshot, vin]);
}

/* ------------------------------------------------------------------ */
/* 셀렉터 기반 구독 — 1초 틱마다 무관한 컴포넌트가 리렌더되지 않게 한다.        */
/* ------------------------------------------------------------------ */

/** 얕은 동등 비교 — 셀렉터가 객체 리터럴을 돌려줄 때 사용한다. */
export function twinShallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** 배열 원소 단위 비교 — identity 가 매 틱 바뀌는 투영 결과용. */
export function twinArrayEqual<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/**
 * 구조 비교 — 셀렉터가 작은 중첩 슬라이스(집계 객체, wave 목록)를 돌려줄 때 쓴다.
 * 깊이를 제한해 실수로 스냅샷 전체를 순회하는 비용을 막는다.
 */
export function twinDeepEqual<T>(a: T, b: T): boolean {
  return deepEqualAt(a, b, 0);
}

function deepEqualAt(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= 3 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!deepEqualAt(a[i], b[i], depth + 1)) return false;
    return true;
  }
  const ka = Object.keys(a as Record<string, unknown>);
  if (ka.length !== Object.keys(b as Record<string, unknown>).length) return false;
  for (const k of ka) {
    if (!deepEqualAt((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1)) return false;
  }
  return true;
}

/**
 * 엔진 스냅샷을 셀렉터로 구독한다. 선택된 값이 `isEqual` 로 같으면 리렌더되지 않는다.
 * `select` 는 매 렌더 새로 만들어도 되도록 ref 로 참조한다(재구독 없음).
 */
export function useTwinSel<T>(
  select: (snapshot: TwinStoreSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const provider = useContext(ProviderCtx);
  const selectRef = useRef(select);
  const eqRef = useRef(isEqual);
  const cache = useRef<{ v: T } | null>(null);
  selectRef.current = select;
  eqRef.current = isEqual;
  const subscribe = useCallback((listener: () => void) => provider!.subscribe(listener), [provider]);
  const getSnapshot = useCallback(() => {
    const next = selectRef.current(provider!.getSnapshot());
    const hit = cache.current;
    if (hit && eqRef.current(hit.v, next)) return hit.v;
    cache.current = { v: next };
    return next;
  }, [provider]);
  const value = useSyncExternalStore(subscribe, getSnapshot);
  if (!provider) throw new Error('useTwinSel must be used inside <TwinProvider>');
  return value;
}

/** 액션 + 사용자 설정 전용 구독 — 틱에 반응하지 않는다. */
export function useTwinApi(): TwinApiValue {
  const ctx = useContext(ApiCtx);
  if (!ctx) throw new Error('useTwinApi must be used inside <TwinProvider>');
  return ctx;
}

/** revision 이 바뀔 때만 재계산되는 사전 영향분석(Impact) — 스냅샷 전체 구독 회피용. */
export function useTwinImpact(): T.TwinImpactResult {
  const provider = useContext(ProviderCtx);
  const { targetRule } = useTwinApi();
  const revision = useTwinSel((s) => s.revision);
  return useMemo(
    () => provider!.queryTargetFacts(targetRule),
    // revision 이 바뀌면 조회 결과도 갱신된다.
    [provider, targetRule, revision],
  );
}
