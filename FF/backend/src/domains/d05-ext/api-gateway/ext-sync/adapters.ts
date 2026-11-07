// 외부 시스템 쓰기 어댑터 — 모의(mock)와 실제(live)가 같은 인터페이스. 연결 방식은 IF_MODE_01(codeBeamer)·IF_MODE_13(GitLab)·IF_MODE_14(JIRA).
// 쓰기는 늘 "기대 개정 번호"를 함께 보낸다: 바깥 값이 그사이 바뀌었으면 덮어쓰지 않고 충돌로 돌려준다(사람이 고름).
// live는 각 도구의 REST를 쓴다(live-adapters.ts) — GitLab v4, JIRA REST v2, codeBeamer REST v3. 주소·토큰은 환경 변수(GITLAB_URL/GITLAB_TOKEN 등).
import { Injectable } from '@nestjs/common';
import { CHILD_FIELD_KEYS, EXT_SYSTEM_IF, type ExtKind, type ExtSystem, type JiraFieldKey } from '@ff/contracts';
import { LiveAdapter } from './live-adapters';
import { extUrl, GITLAB_PROJECT, MockExtStore, type MockItem } from './mock-ext.store';

export type AdapterMode = 'mock' | 'live' | 'off';

/** 외부 항목의 현재 모습(어댑터가 읽어 온 값) */
export interface RemoteItem {
  system: ExtSystem;
  kind: ExtKind;
  key: string;
  url: string;
  title: string;
  status: string;
  revision: number;
  fields: Record<string, unknown>;
}

export interface WritePatch {
  status?: string;
  comment?: string;
  /** 제목(JIRA summary) — Epic 제목은 FF가 주인(80-50 §4.2) */
  title?: string;
  /** Epic 사용자 필드(FF 키) — 필드 ID로 바꿔 쓴다(epic-fields.ts) */
  fields?: Partial<Record<JiraFieldKey, unknown>>;
  /** 그 밖의 사용자 필드(필드 ID 그대로 — Story의 FF Function ID 등) */
  custom?: Record<string, unknown>;
  /** 라벨 더하기(JIRA 라벨은 빈칸 없이) */
  labelsAdd?: string[];
  /** 이 이슈가 다른 이슈의 중복이라고 잇는다(JIRA 'Duplicate' 링크) */
  duplicateOf?: string;
  /** GitLab commit status · codeBeamer 검증 결과 — 목록에 덧붙인다 */
  append?: { field: 'commitStatuses' | 'verifications'; value: Record<string, unknown> };
}

export type WriteResult = { ok: true; item: RemoteItem } | { ok: false; conflict: RemoteItem };

/** 대사(80-50 §4.5) — 최근 바뀐 이슈의 지금 모습과 변경 이력. 서비스가 webhook 본문 모양으로 바꿔 같은 정규화·가드를 태운다 */
export interface RecentIssue {
  key: string;
  revision: number;
  /** JIRA 이슈 JSON(webhook의 issue와 같은 모양) */
  issue: { key: string; fields: Record<string, unknown> };
  /** 변경 이력(오래된 것부터) — 이력을 주지 않는 연결은 마지막 수정자 한 줄 */
  histories: { author: string; created: number; items: { field: string; fromString: string | null; toString: string | null }[] }[];
  reporter: string;
}

export interface ExtAdapter {
  readonly system: ExtSystem;
  mode(): AdapterMode;
  read(key: string): Promise<RemoteItem | null>;
  /** codeBeamer — 요구 ID(플랫폼 Feature의 requirementIds)로 요구 항목 찾기 */
  findRequirement(reqId: string): Promise<RemoteItem | null>;
  create(kind: ExtKind, f: { title: string; body: string; status: string; fields?: Record<string, unknown> }): Promise<RemoteItem>;
  /** expectedRevision가 null이면 개정을 묻지 않는다(댓글·덧붙이기처럼 겹쳐도 안전한 쓰기) */
  write(key: string, patch: WritePatch, expectedRevision: number | null): Promise<WriteResult>;
  /** JIRA — 최근 minutes분 안에 바뀐 연계 프로젝트 이슈(증분 대사). 다른 시스템은 빈 목록 */
  recent(minutes: number): Promise<RecentIssue[]>;
}

export const modeOf = (system: ExtSystem, env: Record<string, string | undefined> = process.env): AdapterMode => {
  const v = env[`IF_MODE_${EXT_SYSTEM_IF[system].slice(3)}`];
  return v === 'off' ? 'off' : v === 'live' ? 'live' : 'mock';
};

/** 플랫폼 이름으로 쓴다 — 바깥에서 누가 되쓴 것인지 보이게 */
export const PLATFORM_USER = 'feature-platform';

/** Epic 필드 — JIRA에서 만든 Epic의 범위(scope)와 FF가 쓴 값(epic)을 FF 키로 합친다 */
const epicOf = (it: MockItem): Record<string, unknown> => {
  const scope = (it.fields.scope ?? {}) as Record<string, unknown> & { refIds?: unknown };
  const { refIds, ...rest } = scope;
  return { ...rest, ...(Array.isArray(refIds) && refIds.length ? { featureDb: refIds } : {}), ...((it.fields.epic ?? {}) as Record<string, unknown>) };
};
const view = (it: MockItem): RemoteItem => ({ system: it.system, kind: it.kind, key: it.key, url: extUrl(it.system, it.kind, it.key), title: it.title, status: it.status, revision: it.system === 'CODEBEAMER' ? it.revision : Date.parse(it.updatedAt), fields: it.kind === 'EPIC' ? { ...it.fields, description: it.body, epic: epicOf(it) } : { ...it.fields, description: it.body } });

class MockAdapter implements ExtAdapter {
  constructor(
    readonly system: ExtSystem,
    private readonly store: MockExtStore,
  ) {}
  mode() {
    return modeOf(this.system);
  }
  async read(key: string) {
    const it = this.store.get(this.system, key);
    return it ? view(it) : null;
  }
  async findRequirement(reqId: string) {
    const it = this.store.all('CODEBEAMER', 'REQUIREMENT').find((x) => x.fields.reqId === reqId);
    return it ? view(it) : null;
  }
  async create(kind: ExtKind, f: { title: string; body: string; status: string; fields?: Record<string, unknown> }) {
    return view(this.store.create(this.system, kind, { ...f, by: PLATFORM_USER }));
  }
  async write(key: string, patch: WritePatch, expectedRevision: number | null): Promise<WriteResult> {
    const it = this.store.get(this.system, key);
    if (!it) throw new Error(`${this.system} ${key}이(가) 외부 시스템에 없습니다.`);
    if (expectedRevision !== null && view(it).revision !== expectedRevision) return { ok: false, conflict: view(it) };
    const fields: Record<string, unknown> = {
      ...(patch.append ? { [patch.append.field]: [...((it.fields[patch.append.field] as unknown[]) ?? []), patch.append.value] } : {}),
      // Epic 칸은 epic, 아래 이슈의 FF 칸(기능 ID 등)은 child
      ...(patch.fields && it.kind === 'EPIC' ? { epic: { ...((it.fields.epic ?? {}) as Record<string, unknown>), ...patch.fields } } : {}),
      ...(patch.fields && it.kind !== 'EPIC' ? { child: { ...((it.fields.child ?? {}) as Record<string, unknown>), ...Object.fromEntries(Object.entries(patch.fields).filter(([k]) => (CHILD_FIELD_KEYS as readonly string[]).includes(k))) } } : {}),
      ...(patch.custom ? { custom: { ...((it.fields.custom ?? {}) as Record<string, unknown>), ...patch.custom } } : {}),
      ...(patch.labelsAdd ? { labels: [...new Set([...((it.fields.labels as string[] | undefined) ?? []), ...patch.labelsAdd])] } : {}),
      ...(patch.duplicateOf ? { duplicateOf: patch.duplicateOf } : {}),
    };
    return { ok: true, item: view(this.store.update(this.system, key, PLATFORM_USER, { status: patch.status, comment: patch.comment, title: patch.title, fields: Object.keys(fields).length ? fields : undefined })) };
  }
  /** 모의 JIRA — 변경 이력이 없어 마지막 수정자 한 줄로 */
  async recent(minutes: number): Promise<RecentIssue[]> {
    if (this.system !== 'JIRA') return [];
    const since = this.store.now() - minutes * 60_000;
    return this.store
      .all('JIRA')
      .filter((it) => Date.parse(it.updatedAt) >= since)
      .map((it) => {
        const body = this.store.webhook(it, { fromStatus: null, created: false }).body as { issue: RecentIssue['issue'] };
        return { key: it.key, revision: Date.parse(it.updatedAt), issue: body.issue, histories: [{ author: it.updatedBy, created: Date.parse(it.updatedAt), items: [] }], reporter: it.updatedBy };
      });
  }
}

@Injectable()
export class ExtAdapters {
  private readonly mock: Record<ExtSystem, MockAdapter>;
  private readonly live: Record<ExtSystem, LiveAdapter>;
  constructor(readonly store: MockExtStore) {
    this.mock = { GITLAB: new MockAdapter('GITLAB', store), JIRA: new MockAdapter('JIRA', store), CODEBEAMER: new MockAdapter('CODEBEAMER', store) };
    this.live = { GITLAB: new LiveAdapter('GITLAB', () => modeOf('GITLAB')), JIRA: new LiveAdapter('JIRA', () => modeOf('JIRA')), CODEBEAMER: new LiveAdapter('CODEBEAMER', () => modeOf('CODEBEAMER')) };
  }
  of(system: ExtSystem): ExtAdapter {
    return modeOf(system) === 'live' ? this.live[system] : this.mock[system];
  }
  project() {
    return GITLAB_PROJECT();
  }
}
