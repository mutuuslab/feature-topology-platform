// 시연 데이터(브라우저 안 쓰기) 공용 형 — 설계: docs/20-architecture/20-61-browser-simulator.md
// 정적 공개 사이트에서 쓰기 요청을 서버 대신 이 브라우저 안에서 처리한다. 바뀐 것만 오버레이에 두고 스냅샷 위에 덮어 보인다.
import type { Role, RouteDef } from '@ff/contracts';
import type { PlatformEvent } from '../shared-event-source';

/** 감사 한 줄 — 서버 audit 행과 같은 칸(+ 시연 해시 체인) */
export interface SimAudit {
  id: number;
  at: string;
  actorId: string;
  actorRole: string;
  action: string;
  target: string;
  result: 'ALLOWED' | 'DENIED' | 'FAILED';
  reason: string | null;
  before: unknown;
  after: unknown;
  correlationId: string | null;
  componentId: string | null;
  prevHash?: string;
  hash?: string;
}

/** 알림 한 건 — contracts Notification + 계정별 읽음은 overlay.reads */
export interface SimNotification {
  notificationId: string;
  eventSeq: number;
  eventType: string;
  aggregate: string;
  createdAt: string;
  category: string;
  severity: string;
  title: string;
  fields: { label: string; value: string }[];
  link: string;
  recipients: ({ kind: 'user'; id: string } | { kind: 'role'; role: Role } | { kind: 'team'; team: string })[];
  exclude: string[];
  requirementIds: string[];
}

/** 예약 작업(차량 회신처럼 시간이 지나 들어오는 것) — 새로고침 뒤에도 이어서 돈다 */
export interface SimTask {
  id: string;
  at: number;
  kind: string;
  args: Record<string, unknown>;
}

/** 브라우저에 남는 오버레이 — 스냅샷과 다른 것만 */
export interface SimOverlay {
  /** 스냅샷 판(감사 체인 끝 해시) — 배포가 바뀌면 다르다 → 자동 초기화 */
  version: string;
  /** 컬렉션 → ID → 엔터티(바뀐 것·새로 만든 것 전체 값) */
  entities: Record<string, Record<string, any>>;
  /** 컬렉션 → 새로 만든 ID(최신이 앞) — 목록 앞쪽에 붙인다 */
  created: Record<string, string[]>;
  /** 감사(최신이 앞) */
  audit: SimAudit[];
  /** 알림(최신이 앞) */
  notifications: SimNotification[];
  /** 이벤트(순번 오름차순) */
  events: PlatformEvent[];
  /** 계정 → 읽은 알림 ID(스냅샷 알림 포함) */
  reads: Record<string, string[]>;
  /** 계정 → '모두 읽음' 시각(그 전 알림은 읽음) */
  readAllAt: Record<string, string>;
  /** 순번(키별 마지막 값) — event·audit·KILL·PUB… */
  seq: Record<string, number>;
  /** 시연 감사 체인 끝 */
  chain: { head: string | null; count: number };
  tasks: SimTask[];
  /** 도메인별 자유 상태(원장·명령·회신 등) */
  data: Record<string, any>;
}

export interface SimActor {
  id: string;
  /** 이 요청에서 맡은 플랫폼 역할(서버 X-Actor-Role과 같은 규칙으로 고름) */
  role: Role;
  /** 화면 역할 전환기의 계정 키(operator 등) */
  persona: string;
}

export interface SimRequest {
  name: string;
  route: RouteDef;
  url: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
}

export interface SimAuditInput {
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  componentId?: string | null;
  result?: SimAudit['result'];
  /** 시스템이 한 일(이벤트 구독 — 이상 대응·자동 롤백)은 서버처럼 시스템 행위자로 남긴다. 없으면 요청 행위자 */
  actorId?: string;
  actorRole?: string;
}

/** 알림 규칙(NOTIFICATION_RULES)이 읽는 맥락 — 없으면 이벤트만 남는다 */
export interface SimNotifyContext {
  feature?: { featureId: string; version: string; name: string; ownerId: string } | null;
  policy?: Record<string, any> | null;
  kill?: Record<string, any> | null;
  refChange?: Record<string, any> | null;
}

/** 읽기 문맥 — 스냅샷 원본과 덮어쓴 결과를 고를 수 있다 */
export interface SimReadContext {
  req: SimRequest;
  actor: SimActor;
  overlay: SimOverlay;
  now(): Date;
  /** 이 요청(또는 다른 경로)의 스냅샷 원본 — 없으면 null */
  snapshot<T = any>(name?: string, params?: Record<string, string>, query?: Record<string, unknown>): Promise<T | null>;
  /** 다른 경로를 오버레이까지 덮어 읽는다(화면이 보는 값) */
  read<T = any>(name: string, params?: Record<string, string>, query?: Record<string, unknown>): Promise<T>;
  /** 오버레이 엔터티 */
  get<T = any>(collection: string, id: string): T | undefined;
  list<T = any>(collection: string): T[];
}

/** 쓰기 문맥 — 바꾼 것은 핸들러가 끝나야 한 번에 반영된다(서버 트랜잭션처럼). 실패하면 감사 실패 기록만 남는다 */
export interface SimWriteContext extends SimReadContext {
  iso(): string;
  /** 엔터티 넣기·바꾸기 — created면 목록 앞에 붙는 새 항목 */
  put(collection: string, id: string, entity: any, opts?: { created?: boolean }): void;
  /** 도메인 상태 읽기·바꾸기(overlay.data[key]) */
  state<T>(key: string, init: () => T): T;
  /** 다음 ID — 스냅샷에 있는 ID 다음부터. 예: nextId('KILL', ids) → KILL-00008 */
  nextId(prefix: string, existing: readonly string[], width?: number): string;
  audit(entry: SimAuditInput): void;
  /** 이벤트 발행 — 알림 규칙이 있으면 수신자를 계산해 알림도 만든다. 커밋 뒤 이벤트 버스로 흘러 SSE처럼 화면이 새로 읽는다 */
  emit(type: string, aggregate: string, payload: Record<string, unknown>, opts?: { componentId?: string | null; notify?: SimNotifyContext }): PlatformEvent;
  /** 이 사람(행위자 계정)의 알림 읽음 — 스냅샷 알림 ID도 된다 */
  markRead(notificationIds: readonly string[]): void;
  /** ms 뒤 예약 작업(registerSimTask로 등록한 kind) */
  later(ms: number, kind: string, args: Record<string, unknown>): void;
  /** 규칙 위반 — 서버와 같은 오류(상태 코드·code·문장). failAudit을 주면 거부도 감사에 남긴다(서버 audit.failed) */
  fail(code: string, message: string, details?: unknown, failAudit?: { action: string; target: string; reason: string; componentId?: string | null; /** 역할·직무 분리 거부는 DENIED(서버 audit.denied), 없으면 FAILED */ result?: 'FAILED' | 'DENIED' }): never;
}

export type SimHandler = (ctx: SimWriteContext) => unknown | Promise<unknown>;
export type SimReader = (ctx: SimReadContext) => unknown | Promise<unknown>;
export type SimTaskHandler = (ctx: SimWriteContext, args: Record<string, any>) => void | Promise<void>;

/** 스냅샷 목록·상세에 오버레이를 덮는 방법 */
export interface SimView {
  collection: string;
  /** 엔터티 ID 칸 */
  idKey: string;
  /** 목록이면 배열 칸(기본 items) — detailParam과 둘 중 하나 */
  listKey?: string;
  /** 상세면 경로 매개변수 이름(:id) */
  detailParam?: string;
  /** 목록 질의 거르기(status 등) */
  filter?: (entity: any, query: Record<string, string>) => boolean;
  /** 보여 줄 모양(계산 칸 붙이기) */
  project?: (entity: any, ctx: SimReadContext) => any;
}
