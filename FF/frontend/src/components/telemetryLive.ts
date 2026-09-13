/**
 * §17.5 — 차량(VIN) 단위 실시간 텔레메트리 모델. 순수 함수 + 누적 훅.
 *
 * 배경: `TwinVehicle` 상세 화면은 "live" 라고 표시되지만 화면에서 실제로
 * 변하는 값이 신호 나이 한 칸뿐이었다. 그런데 시뮬레이터가 매 tick 실제로
 * 바꾸는 것은 분명히 있다:
 *   1) 각 신호의 수신 시각(`context[*].observedAt`) → **TTL 잔여 시간**
 *   2) 차량 접속 시각(`link.lastSeenAt`) → **수신 이벤트**
 *   3) 결함이 주입되면 텔레메트리가 **멈추고** TTL 이 소진되어 STALE→차단
 *
 * 이 모듈은 그 세 가지를 시간의 함수로만 계산한다. 타이머도, 난수도, 없는
 * 데이터도 없다. rate 0 이면 시각이 멈추므로 화면도 함께 멈춘다.
 */
import { useEffect, useState } from 'react';
import type { TwinStoreSnapshot } from '../data/twin/port';
import * as T from '../data/twin/types';
import * as E from '../data/twin/engine';

/* ------------------------------------------------------------------ */
/* 1. 신호 신선도 (TTL 카운트다운)                                      */
/* ------------------------------------------------------------------ */

export interface SignalFreshness {
  key: T.SignalKey;
  label: T.Localized;
  vss: string;
  /** 표시용 값 — `28.4 °C` / `PLUGGED` */
  value: string;
  quality: T.SignalQuality | 'MISSING';
  /** 수신 이후 경과(초). 신호가 없으면 null. */
  ageS: number | null;
  ttlS: number;
  /** TTL 만료까지 남은 초(음수면 이미 만료). 신호가 없으면 null. */
  remainS: number | null;
  /** 0..1 — 게이지 채움 비율(1 이상이면 만료). */
  ratio: number;
  /** 차량이 판단을 거부해야 하는 상태인가(없음/만료/품질 불량). */
  unusable: boolean;
}

/**
 * 신호별 TTL 잔여 시간. `nowMs` 가 흐르면 잔여가 줄고, 새 텔레메트리가
 * 도착하면(= observedAt 갱신) 0 으로 되감긴다.
 */
export function signalFreshness(twin: T.Twin, nowMs: number): SignalFreshness[] {
  return T.SIGNAL_SPECS.map((spec) => {
    const s = twin.context[spec.key];
    if (!s) {
      return {
        key: spec.key,
        label: spec.label,
        vss: spec.vss,
        value: '–',
        quality: 'MISSING' as const,
        ageS: null,
        ttlS: spec.ttlSeconds,
        remainS: null,
        ratio: 1,
        unusable: true,
      };
    }
    const ageS = E.secondsSince(s.observedAt, nowMs);
    const remainS = spec.ttlSeconds - ageS;
    return {
      key: spec.key,
      label: spec.label,
      vss: spec.vss,
      value: `${s.value}${s.unit ? ` ${s.unit}` : ''}`,
      quality: s.quality,
      ageS,
      ttlS: spec.ttlSeconds,
      remainS: Math.round(remainS),
      ratio: Math.max(0, Math.min(1, ageS / spec.ttlSeconds)),
      /* 만료 판정은 엔진과 같은 함수를 쓴다 — 카드가 판정과 어긋나면 안 된다. */
      unusable: E.isSampleStale(s, nowMs) || s.quality === 'BAD' || s.quality === 'UNKNOWN',
    };
  });
}

export interface FreshnessSummary {
  usable: number;
  total: number;
  stale: number;
  /** 가장 급한(잔여가 가장 적은) 신호. 전부 만료면 null. */
  next: SignalFreshness | null;
  /** `4/6 신선 · STALE 1 · 다음 만료 41s` */
  text: string;
}

/** 화면 상단에 한 줄로 요약한다 — 이 줄 자체가 매 초 바뀐다. */
export function freshnessSummary(rows: SignalFreshness[], lang: T.Lang = 'ko'): FreshnessSummary {
  const total = rows.length;
  const stale = rows.filter((r) => r.unusable).length;
  const usable = total - stale;
  const pending = rows
    .filter((r) => !r.unusable && r.remainS != null)
    .sort((a, b) => (a.remainS ?? 0) - (b.remainS ?? 0));
  const next = pending[0] ?? null;
  const head = lang === 'en' ? `fresh ${usable}/${total}` : `신선 ${usable}/${total}`;
  const stalePart = stale ? `${lang === 'en' ? 'STALE' : '만료'} ${stale}` : lang === 'en' ? 'no expiry' : '만료 없음';
  const nextPart =
    next && next.remainS != null
      ? `${lang === 'en' ? 'next expiry' : '다음 만료'} ${next.remainS}s`
      : lang === 'en'
        ? 'all expired'
        : '전부 만료';
  return { usable, total, stale, next, text: `${head} · ${stalePart} · ${nextPart}` };
}

/* ------------------------------------------------------------------ */
/* 2. 수신 이벤트 스트림                                                */
/* ------------------------------------------------------------------ */

export interface VinTelemetryFrame {
  /** 이 수신이 일어난 시뮬레이터 tick. */
  tick: number;
  /** 시각 문자열(HH:MM:SS)과 에포크 ms. */
  at: string;
  atMs: number;
  /** 이번 수신으로 갱신된 신호 수. */
  received: number;
  /** 차량이 가진 신호 총수. */
  total: number;
  /** 수신 시점 기준 가장 오래된 신호 나이(초) — 수신이 끊기면 커진다. */
  ageMaxS: number;
  /** 이번 tick 에서 만료된 신호 키. */
  staleKeys: string[];
  online: boolean;
}

/**
 * "지금 시점의 수신" 한 건을 현재 스냅샷에서 파생한다.
 * `link.lastSeenAt` 을 수신 시각의 단일 출처로 삼는다.
 */
export function vinTelemetryFrame(snapshot: TwinStoreSnapshot, vin: string): VinTelemetryFrame | null {
  const twin = snapshot.twins.find((t) => t.vin === vin);
  if (!twin) return null;
  const nowMs = snapshot.clock.simTimeMs;
  const atMs = Date.parse(twin.link.lastSeenAt);
  const samples = Object.entries(twin.context).filter(
    (e): e is [string, T.SignalSample] => !!e[1],
  );
  const received = samples.filter(([, s]) => s.observedAt === twin.link.lastSeenAt).length;
  const ages = samples.map(([, s]) => E.secondsSince(s.observedAt, nowMs));
  /* 만료 목록은 엔진과 동일한 판정 함수에서 가져온다. */
  const staleKeys = E.staleSignals(twin, nowMs).map(String);
  return {
    tick: snapshot.clock.simTick,
    at: twin.link.lastSeenAt.slice(11, 19),
    atMs: Number.isNaN(atMs) ? nowMs : atMs,
    received,
    total: T.SIGNAL_SPECS.length,
    ageMaxS: ages.length ? Math.max(...ages) : 0,
    staleKeys,
    online: twin.link.online,
  };
}

function sameFrame(a: VinTelemetryFrame, b: VinTelemetryFrame): boolean {
  return (
    a.tick === b.tick &&
    a.at === b.at &&
    a.received === b.received &&
    a.ageMaxS === b.ageMaxS &&
    a.online === b.online &&
    a.staleKeys.length === b.staleKeys.length
  );
}

/**
 * tick 마다 "수신 이벤트"를 누적한다. 차량 텔레메트리가 끊기면(결함 주입)
 * `link.lastSeenAt` 이 갱신되지 않으므로 스트림이 **실제로 멈춘다** — 화면의
 * 정지가 곧 사실이다.
 */
export function useVinTelemetry(snapshot: TwinStoreSnapshot, vin: string, window = 40): VinTelemetryFrame[] {
  const [frames, setFrames] = useState<VinTelemetryFrame[]>([]);

  useEffect(() => {
    const frame = vinTelemetryFrame(snapshot, vin);
    setFrames((prev) => {
      if (!frame) return prev;
      const last = prev[prev.length - 1];
      if (last && sameFrame(last, frame)) {
        if (last.tick === frame.tick) return prev;
        return [...prev.slice(0, -1), frame];
      }
      // 같은 수신 시각을 공유하는 tick 이 여러 번 렌더되어도 한 줄만 남긴다.
      if (last && last.at === frame.at) return [...prev.slice(0, -1), frame];
      return [...prev, frame].slice(-window);
    });
  }, [snapshot, vin, window]);

  return frames;
}

/* ------------------------------------------------------------------ */
/* 3. 흐름 상태 — "지금 무엇이 멈춰 있는가"                             */
/* ------------------------------------------------------------------ */

export interface VehicleFlowState {
  online: boolean;
  /** 텔레메트리가 살아 있는가(= 최근 창 안에서 수신이 있었다). */
  streaming: boolean;
  /** 마지막 수신 이후 경과(초). */
  sinceLastRxS: number;
  /** 다음 TTL 만료까지 남은 초 — 없으면 null. */
  nextExpiryS: number | null;
  /** 안전 판단이 거부되는 이유(사람이 읽는 문장). */
  gate: T.Localized;
}

/** 신호 수신이 "살아 있다"고 볼 최대 나이(초). */
export const RX_WINDOW_S = 10;

export function vehicleFlowState(twin: T.Twin, nowMs: number, lang: T.Lang = 'ko'): VehicleFlowState {
  const rows = signalFreshness(twin, nowMs);
  const summary = freshnessSummary(rows, lang);
  const sinceLastRxS = E.secondsSince(twin.link.lastSeenAt, nowMs);
  const streaming = twin.link.online && sinceLastRxS <= RX_WINDOW_S;
  const gate: T.Localized = !twin.link.online
    ? { ko: '차량 오프라인 — 마지막 스냅샷으로만 판정', en: 'Vehicle offline — judged from last snapshot only' }
    : summary.stale > 0
      ? { ko: `TTL 만료 신호 ${summary.stale}건 — 안전 판단 거부`, en: `${summary.stale} signal(s) past TTL — safety decision refused` }
      : streaming
        ? { ko: '신호 수신 정상 — 판정 가능', en: 'Telemetry flowing — decision allowed' }
        : { ko: '수신 정지 — 다음 TTL 만료까지 대기', en: 'Telemetry stopped — waiting for next TTL expiry' };
  return {
    online: twin.link.online,
    streaming,
    sinceLastRxS,
    nextExpiryS: summary.next?.remainS ?? null,
    gate,
  };
}
