/**
 * §17.4 — Twin 수렴 실시간 모니터 (순수 모델 + 훅).
 *
 * 배경: `TwinFleet` 의 KPI/도넛/게이지는 "현재값"만 그리기 때문에 정상 수렴
 * 구간에서는 화면이 멈춘 것처럼 보인다. 실제로 매 tick 변하는 것은
 *   1) 각 차량의 신호 수신 시각(`link.lastSeenAt`, `context[*].observedAt`)
 *   2) 정책 전달이 도착하며 뒤집히는 reconciliation 개수
 *   3) journal 이벤트 수
 * 이다. 이 모듈은 그 세 가지를 **tick 단위 샘플**로 누적해 화면이 항상
 * "움직이는 근거"를 갖도록 한다. 시각화는 파생 계산만 하며, 없는 데이터를
 * 만들어내지 않는다(rate 0 이면 이력도 그대로 정지한다).
 */
import { useEffect, useState } from 'react';
import type { TwinClock, TwinStoreSnapshot } from '../data/twin/port';
import { fmtDuration } from '../data/twin/engine';
import type { Reconciliation } from '../data/twin/types';

const RECONCILIATIONS: Reconciliation[] = [
  'CONVERGED',
  'PENDING',
  'GUARDED',
  'REJECTED',
  'CRITICAL_DRIFT',
  'UNKNOWN',
];

/** 신호가 "이번 tick 에 도착했다"고 볼 최대 나이(초). */
export const FRESH_WINDOW_S = 4;

export interface TickSample {
  tick: number;
  at: number;
  rate: 0 | 1 | 5;
  revision: number;
  total: number;
  converged: number;
  ratePct: number;
  threshold: number;
  counts: Record<Reconciliation, number>;
  /** 이번 tick 에 신호가 갱신된 VIN 수. */
  fresh: number;
  offline: number;
  /** 가장 오래된 신호 나이(초). */
  ageMaxS: number;
  /** journal 누적 이벤트 수. */
  events: number;
  /** 최근 창 안에서 관측된 이벤트 발생 수(직전 샘플 대비). */
  newEvents: number;
}

export interface VinPulse {
  vin: string;
  reconciliation: Reconciliation;
  online: boolean;
  /** `link.lastSeenAt` 기준 신호 나이(초). tick 마다 0 으로 되감긴다. */
  heartbeatS: number;
  health: string;
  reasonCode: string;
  /** Desired(의도) / Reported(차량 보고) / Effective(가드 통과 후 실제) — §9 3층 비교. */
  desiredState: string;
  reportedState: string;
  effectiveState: string;
  policyVersion: string | null;
  twinVersion: number;
}

export interface DeltaRow {
  key: string;
  label: string;
  from: number;
  to: number;
  delta: number;
}

function pct(n: number, d: number): number {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function ageSecondsOf(snapshot: TwinStoreSnapshot, lastSeenAt: string | undefined): number {
  if (!lastSeenAt) return Number.POSITIVE_INFINITY;
  const t = Date.parse(lastSeenAt);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((snapshot.clock.simTimeMs - t) / 1000));
}

function emptyCounts(): Record<Reconciliation, number> {
  return RECONCILIATIONS.reduce((acc, k) => {
    acc[k] = 0;
    return acc;
  }, {} as Record<Reconciliation, number>);
}

export function sampleTick(snapshot: TwinStoreSnapshot, prevEvents?: number): TickSample {
  const counts = emptyCounts();
  let fresh = 0;
  let offline = 0;
  let ageMaxS = 0;

  snapshot.twins.forEach((twin) => {
    const verdict = snapshot.verdicts.find((v) => v.twin.vin === twin.vin);
    const rec: Reconciliation = verdict?.reconciliation?.result ?? 'UNKNOWN';
    counts[rec] += 1;

    if (!twin.link.online) {
      offline += 1;
      return;
    }
    const age = ageSecondsOf(snapshot, twin.link.lastSeenAt);
    if (age <= FRESH_WINDOW_S) fresh += 1;
    if (Number.isFinite(age)) ageMaxS = Math.max(ageMaxS, age);
  });

  const total = snapshot.twins.length;
  const converged = counts.CONVERGED;
  const events = snapshot.events.length;

  return {
    tick: snapshot.clock.simTick,
    at: snapshot.clock.simTimeMs,
    rate: snapshot.clock.rate,
    revision: snapshot.revision,
    total,
    converged,
    ratePct: pct(converged, total),
    threshold: snapshot.convergence.threshold,
    counts,
    fresh,
    offline,
    ageMaxS,
    events,
    newEvents: prevEvents === undefined ? 0 : Math.max(0, events - prevEvents),
  };
}

/** 값이 완전히 같은 두 샘플인지 (동일 tick 재렌더 시 상태 갱신을 막기 위함). */
export function sameSample(a: TickSample, b: TickSample): boolean {
  if (
    a.tick !== b.tick ||
    a.at !== b.at ||
    a.rate !== b.rate ||
    a.revision !== b.revision ||
    a.converged !== b.converged ||
    a.total !== b.total ||
    a.fresh !== b.fresh ||
    a.offline !== b.offline ||
    a.ageMaxS !== b.ageMaxS ||
    a.events !== b.events
  ) {
    return false;
  }
  return RECONCILIATIONS.every((k) => a.counts[k] === b.counts[k]);
}

/**
 * 화면에 표시할 "이번 tick 변화". 변화가 없으면 빈 배열이며, 화면은
 * 그 사실 자체를 정직하게 표시한다.
 */
export function sampleDelta(prev: TickSample | undefined, cur: TickSample, lang: 'ko' | 'en' = 'ko'): DeltaRow[] {
  if (!prev) return [];
  const rows: DeltaRow[] = [];
  const push = (key: string, label: string, from: number, to: number) => {
    if (from !== to) rows.push({ key, label, from, to, delta: to - from });
  };
  const L = (ko: string, en: string) => (lang === 'ko' ? ko : en);

  push('converged', L('수렴 차량', 'Converged'), prev.converged, cur.converged);
  push('pending', L('전달 대기', 'Pending'), prev.counts.PENDING, cur.counts.PENDING);
  push('guarded', L('가드 차단', 'Guarded'), prev.counts.GUARDED, cur.counts.GUARDED);
  push('rejected', L('거부', 'Rejected'), prev.counts.REJECTED, cur.counts.REJECTED);
  push('drift', L('치명적 Drift', 'Critical drift'), prev.counts.CRITICAL_DRIFT, cur.counts.CRITICAL_DRIFT);
  push('unknown', L('Unknown', 'Unknown'), prev.counts.UNKNOWN, cur.counts.UNKNOWN);
  push('fresh', L('신호 수신', 'Telemetry'), prev.fresh, cur.fresh);
  push('newEvents', L('신규 로그', 'New events'), prev.newEvents, cur.newEvents);
  return rows;
}

/** tick 이력 요약 한 줄 (라이브 배너에 표시). */
export function describeTick(cur: TickSample, prev: TickSample | undefined, lang: 'ko' | 'en' = 'ko'): string {
  const L = (ko: string, en: string) => (lang === 'ko' ? ko : en);
  if (cur.rate === 0) return L('시뮬레이션 정지 — 데이터가 갱신되지 않습니다', 'Simulation paused — no data is advancing');
  if (!prev) return L(`tick ${cur.tick} 관측 시작`, `tick ${cur.tick} observation start`);
  const deltas = sampleDelta(prev, cur, lang);
  if (!deltas.length) {
    return L(
      `tick ${cur.tick} · 변화 없음(수렴 유지) — 신호 ${cur.fresh}대 수신`,
      `tick ${cur.tick} · no state change (converged) — ${cur.fresh} vehicles reporting`,
    );
  }
  const head = deltas
    .slice(0, 3)
    .map((d) => `${d.label} ${d.delta > 0 ? '+' : ''}${d.delta}`)
    .join(' · ');
  return `tick ${cur.tick} · ${head}${deltas.length > 3 ? ` 외 ${deltas.length - 3}건` : ''}`;
}

export function vinPulses(snapshot: TwinStoreSnapshot): VinPulse[] {
  return snapshot.twins
    .map((twin) => {
      const verdict = snapshot.verdicts.find((v) => v.twin.vin === twin.vin);
      return {
        vin: twin.vin,
        reconciliation: (verdict?.reconciliation?.result ?? 'UNKNOWN') as Reconciliation,
        online: twin.link.online,
        heartbeatS: ageSecondsOf(snapshot, twin.link.lastSeenAt),
        health: String(verdict?.health ?? 'UNKNOWN'),
        reasonCode: String(verdict?.reconciliation?.reasonCode ?? ''),
        desiredState: String(verdict?.reconciliation?.desired ?? 'UNKNOWN'),
        reportedState: String(verdict?.reconciliation?.reported ?? 'UNKNOWN'),
        effectiveState: String(verdict?.reconciliation?.effective ?? 'UNKNOWN'),
        policyVersion: verdict?.reconciliation?.policyVersion ?? null,
        twinVersion: twin.twinVersion,
      };
    })
    .sort((a, b) => a.vin.localeCompare(b.vin));
}

/**
 * tick 이력을 누적한다. 같은 tick 안에서 값이 바뀌면 마지막 샘플을
 * 갱신하고, 값이 그대로면 상태 참조를 유지해 무한 렌더를 만들지 않는다.
 */
export function useTickHistory(snapshot: TwinStoreSnapshot, window = 180): TickSample[] {
  const [history, setHistory] = useState<TickSample[]>(() => [sampleTick(snapshot)]);

  useEffect(() => {
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      const next = sampleTick(snapshot, last?.events);
      if (last && last.tick === next.tick) {
        if (sameSample(last, next)) return prev;
        return [...prev.slice(0, -1), next];
      }
      return [...prev, next].slice(-window);
    });
  }, [snapshot, window]);

  return history;
}

/** tick 이력에서 특정 시계열만 뽑는다(스파크라인/추세선용). */
export function series(history: TickSample[], pick: (s: TickSample) => number): number[] {
  return history.map(pick);
}

/* ------------------------------------------------------------------ */
/* 시뮬레이터 클럭 표기                                                */
/* ------------------------------------------------------------------ */

export interface SimClockLabel {
  /** 데모 시작 이후 경과 — `3m 40s`. */
  elapsed: string;
  /** 시뮬레이터 상의 절대 시각 `HH:MM:SS`. */
  at: string;
  tick: number;
  /** `T+3m 40s · 09:41:02 · tick 421` */
  text: string;
}

/**
 * `clock.simTimeMs` 는 **에포크 ms** 다(경과 시간이 아니다). 따라서 경과는
 * `simTimeMs - startedAtMs` 로만 구한다. 이걸 그냥 초로 나누면 "20709d" 같은
 * 값이 나온다 — 실제로 한 번 그렇게 표시됐던 버그다.
 */
export function simClockLabel(clock: TwinClock): SimClockLabel {
  const elapsedS = Math.max(0, (clock.simTimeMs - clock.startedAtMs) / 1000);
  const elapsed = fmtDuration(elapsedS);
  const at = new Date(clock.simTimeMs).toISOString().slice(11, 19);
  return { elapsed, at, tick: clock.simTick, text: `T+${elapsed} · ${at} · tick ${clock.simTick}` };
}
