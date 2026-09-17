/**
 * §17.3 Feature Flag 데이터 로그 — 터미널이 읽는 **순수 모델**.
 *
 * 로그는 새로 지어내지 않는다. Twin 계층이 실제로 발행/기록한 두 원천만 합친다.
 *   1. `snapshot.events`      — DigitalTwinPort.journal (차량·정책·Twin 서비스가 발행한 이벤트)
 *      · 시뮬레이터는 매 tick 마다 `vehicle.context.updated` 를 발행하므로, 재생 중에는
 *        로그가 실제로 흘러간다(가짜 heartbeat 를 만들 필요가 없다).
 *   2. `twins[].auditTrail`   — Twin 에 기록된 운영/서비스 이력(EOL · 정책 승인 등).
 *
 * 정렬은 (시각, 원천, 원본 순서) 로 결정적이다. 화면은 이 배열만 그린다.
 */
import type { TwinStoreSnapshot } from '../data/twin/port';
import * as T from '../data/twin/types';

/** 터미널 표시 레벨 — `ReasonSeverity` 를 그대로 쓰지 않고 로그 관례에 맞춘다. */
export type LogLevel = 'TRACE' | 'INFO' | 'WARN' | 'ERROR' | 'PASS';

/** 로그 채널 = 이벤트가 흐르는 계층. */
export type LogChannel = 'POLICY' | 'OTA' | 'VEHICLE' | 'GUARD' | 'TWIN' | 'OBSERV' | 'OPERATOR' | 'SIM';

export type LogScope = 'VIN' | 'FLEET';

export interface LogLine {
  /** 전체 로그에서의 1-based 순번. 윈도우(tail)로 잘려도 값이 변하지 않는다. */
  seq: number;
  /** 이벤트 고유 키 — React key 이자 중복 제거 키. */
  id: string;
  /** `Y-M-DThh:mm:ss.sssZ` (시뮬레이션 시각 기반, 실제 벽시계 아님). */
  at: string;
  ms: number;
  simTick: number;
  level: LogLevel;
  channel: LogChannel;
  /** 원천 라벨 — JOURNAL(이벤트) / AUDIT(Twin 이력). */
  origin: 'JOURNAL' | 'AUDIT';
  /** 실제 VIN 또는 브로드캐스트를 나타내는 표시용 라벨(존재하지 않는 VIN 을 만들지 않는다). */
  vin: string;
  scope: LogScope;
  /** 이벤트 타입 또는 감사 액션 코드. */
  event: string;
  message: T.Localized;
  /** `k=v` 요약(정렬됨). 없으면 빈 문자열. */
  detail: string;
}

export const LOG_LEVEL_HEX: Record<LogLevel, string> = {
  TRACE: '#8895A7',
  INFO: '#7FB2FF',
  WARN: '#D9822B',
  ERROR: '#D64545',
  PASS: '#1F9D55',
};

export const LOG_LEVEL_LABEL: Record<LogLevel, string> = {
  TRACE: 'TRACE',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  PASS: 'PASS',
};

export const LOG_CHANNEL_LABEL: Record<LogChannel, string> = {
  POLICY: 'POLICY',
  OTA: 'OTA',
  VEHICLE: 'VEH',
  GUARD: 'GUARD',
  TWIN: 'STATE',
  OBSERV: 'OBS',
  OPERATOR: 'OPS',
  SIM: 'SIM',
};

export const LOG_CHANNELS: LogChannel[] = ['POLICY', 'OTA', 'VEHICLE', 'GUARD', 'TWIN', 'OBSERV', 'OPERATOR', 'SIM'];
export const LOG_LEVELS: LogLevel[] = ['ERROR', 'WARN', 'INFO', 'TRACE', 'PASS'];

/** 터미널이 보관하는 최대 라인 수 — 초과분은 오래된 것부터 버린다. */
export const LOG_LINE_LIMIT = 800;

const SEVERITY_TO_LEVEL: Record<T.ReasonSeverity, LogLevel> = {
  PASS: 'PASS',
  INFO: 'INFO',
  PENDING: 'WARN',
  FAIL: 'ERROR',
};

/** 이벤트 타입 접두사 → 채널. 도메인 의미가 접두사보다 우선하는 것만 예외 처리한다. */
function channelOf(type: T.TwinEventType, source: T.TwinEventSource): LogChannel {
  if (type === 'vehicle.guard.blocked') return 'GUARD';
  if (type === 'kill-switch.requested' || type === 'kill-switch.applied' || type === 'rollback.requested' || type === 'rollback.completed') {
    return 'OPERATOR';
  }
  const prefix = type.split('.')[0];
  switch (prefix) {
    case 'policy':
      return 'POLICY';
    case 'ota':
      return 'OTA';
    case 'vehicle':
      return 'VEHICLE';
    case 'twin':
      return 'TWIN';
    case 'rollout':
    case 'incident':
      return 'OBSERV';
    default:
      break;
  }
  return source === 'SIMULATOR' ? 'SIM' : 'TWIN';
}

function msOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * 저널은 최신순으로 저장되므로 배열 위치를 순서로 쓸 수 없다. `eventId` 의
 * 일련번호(`EVT-000123`)가 발행 순서의 단일 원천이다.
 */
function eventSeqOf(eventId: string): number {
  const n = Number.parseInt(eventId.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/** payload 를 `k=v` 한 줄로 — 키를 정렬해 같은 이벤트는 언제나 같은 문자열이 되게 한다. */
function detailOf(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  return Object.keys(payload)
    .sort()
    .map((k) => {
      const v = payload[k];
      const text = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
      return `${k}=${text}`;
    })
    .join(' ');
}

/** 감사 actor 를 이벤트 코드 조각으로 — 기호는 버리고 앞뒤 구분자는 지운다. */
function slug(actor: string): string {
  return actor.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'system';
}

interface Draft {
  at: string;
  ms: number;
  simTick: number;
  level: LogLevel;
  channel: LogChannel;
  origin: LogLine['origin'];
  vin: string;
  scope: LogScope;
  event: string;
  message: T.Localized;
  detail: string;
  /** 같은 시각일 때의 정렬 보조키(원본 순서). */
  ordinal: number;
  id: string;
}

/**
 * Twin 이벤트 + Twin 감사 이력을 하나의 시간순 로그로 합친다.
 * 순수 함수 — 같은 스냅샷이면 언제나 같은 배열이 나온다.
 */
export function buildLogLines(snapshot: TwinStoreSnapshot, opts: { limit?: number } = {}): LogLine[] {
  const limit = opts.limit ?? LOG_LINE_LIMIT;
  const known = new Set(snapshot.twins.map((t) => t.vin));
  const scopeOf = (vin: string): LogScope => (known.has(vin) ? 'VIN' : 'FLEET');
  /** `VIN-DEMO-* (28)` 처럼 차량이 아닌 브로드캐스트는 수량만 노출한다. */
  const labelOf = (vin: string, scope: LogScope): string => {
    if (scope === 'VIN') return vin.replace('VIN-DEMO-', '#');
    const n = /\((\d+)\)/.exec(vin)?.[1];
    return n ? `전체 ${n}대` : '전체';
  };

  const drafts: Draft[] = [];
  let ordinal = 0;

  for (const e of snapshot.events) {
    const scope = scopeOf(e.vin);
    const extra: Record<string, unknown> = { ...(e.payload ?? {}) };
    if (e.policyVersion) extra.policyVersion = e.policyVersion;
    if (typeof e.twinVersion === 'number') extra.twinVersion = e.twinVersion;
    drafts.push({
      at: e.occurredAt,
      ms: msOf(e.occurredAt),
      simTick: e.simTick,
      level: SEVERITY_TO_LEVEL[e.severity],
      channel: channelOf(e.eventType, e.source),
      origin: 'JOURNAL',
      vin: labelOf(e.vin, scope),
      scope,
      event: e.eventType,
      message: e.desc,
      detail: detailOf(extra),
      ordinal: eventSeqOf(e.eventId),
      id: `J:${e.eventId}`,
    });
  }

  for (const t of snapshot.twins) {
    for (const a of t.auditTrail) {
      drafts.push({
        at: a.at,
        ms: msOf(a.at),
        simTick: 0,
        level: 'TRACE',
        channel: 'OPERATOR',
        origin: 'AUDIT',
        vin: labelOf(t.vin, 'VIN'),
        scope: 'VIN',
        event: a.actor.trim() ? `audit.${slug(a.actor)}` : 'audit',
        message: a.action,
        detail: a.detail ?? '',
        ordinal: 1_000_000 + ordinal++,
        id: `A:${t.vin}:${a.at}:${a.action.ko}`,
      });
    }
  }

  // 같은 시각·같은 tick 이면 발행 순서(저널 일련번호)로 결정한다. 감사 이력은
  // 저널보다 뒤에 오도록 큰 ordinal 을 준다(이벤트가 조치를 유발한 순서와 같다).
  drafts.sort((a, b) => a.ms - b.ms || a.simTick - b.simTick || a.ordinal - b.ordinal);

  const lines: LogLine[] = drafts.map((d, i) => ({
    seq: i + 1,
    id: d.id,
    at: d.at,
    ms: d.ms,
    simTick: d.simTick,
    level: d.level,
    channel: d.channel,
    origin: d.origin,
    vin: d.vin,
    scope: d.scope,
    event: d.event,
    message: d.message,
    detail: d.detail,
  }));

  return lines.length > limit ? lines.slice(lines.length - limit) : lines;
}

export interface LogFilter {
  level?: LogLevel | 'ALL';
  channel?: LogChannel | 'ALL';
  /** 표시용 VIN 라벨(`#029`) 또는 실제 VIN. 'ALL' 이면 전체. */
  vin?: string | 'ALL';
  /** 대소문자 무시 부분 문자열 — event/message/detail/vin 을 모두 검색한다. */
  query?: string;
  /** 이 순번 이하의 라인은 숨긴다(clear). */
  afterSeq?: number;
}

export function filterLog(lines: LogLine[], f: LogFilter = {}, lang: T.Lang = 'ko'): LogLine[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return lines.filter((l) => {
    if (f.afterSeq != null && l.seq <= f.afterSeq) return false;
    if (f.level && f.level !== 'ALL' && l.level !== f.level) return false;
    if (f.channel && f.channel !== 'ALL' && l.channel !== f.channel) return false;
    if (f.vin && f.vin !== 'ALL' && l.vin !== f.vin) return false;
    if (!q) return true;
    const hay = `${l.event} ${l.message[lang]} ${l.message.ko} ${l.detail} ${l.vin} ${l.channel}`.toLowerCase();
    return hay.includes(q);
  });
}

/** 터미널 상단 배지용 집계. */
export function logCounts(lines: LogLine[]): { total: number; error: number; warn: number; pass: number } {
  let error = 0;
  let warn = 0;
  let pass = 0;
  for (const l of lines) {
    if (l.level === 'ERROR') error++;
    else if (l.level === 'WARN') warn++;
    else if (l.level === 'PASS') pass++;
  }
  return { total: lines.length, error, warn, pass };
}

/** `hh:mm:ss.SSS` — 로그 라인의 타임스탬프 컬럼. */
export function logClock(at: string): string {
  if (!at || at.length < 23) return at.slice(11, 19) || '--:--:--';
  return at.slice(11, 23);
}
