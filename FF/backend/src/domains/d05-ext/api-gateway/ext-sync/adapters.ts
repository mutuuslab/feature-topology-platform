// 외부 시스템 쓰기 어댑터 — 모의(mock)와 실제(live)가 같은 인터페이스. 연결 방식은 IF_MODE_01(codeBeamer)·IF_MODE_13(GitLab)·IF_MODE_14(JIRA).
// 쓰기는 늘 "기대 개정 번호"를 함께 보낸다: 바깥 값이 그사이 바뀌었으면 덮어쓰지 않고 충돌로 돌려준다(사람이 고름).
// live는 각 도구의 REST를 쓴다(live-adapters.ts) — GitLab v4, JIRA REST v2, codeBeamer REST v3. 주소·토큰은 환경 변수(GITLAB_URL/GITLAB_TOKEN 등).
import { Injectable } from '@nestjs/common';
import { EXT_SYSTEM_IF, type ExtKind, type ExtSystem } from '@ff/contracts';
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
  /** GitLab commit status · codeBeamer 검증 결과 — 목록에 덧붙인다 */
  append?: { field: 'commitStatuses' | 'verifications'; value: Record<string, unknown> };
}

export type WriteResult = { ok: true; item: RemoteItem } | { ok: false; conflict: RemoteItem };

export interface ExtAdapter {
  readonly system: ExtSystem;
  mode(): AdapterMode;
  read(key: string): Promise<RemoteItem | null>;
  /** codeBeamer — 요구 ID(플랫폼 Feature의 requirementIds)로 요구 항목 찾기 */
  findRequirement(reqId: string): Promise<RemoteItem | null>;
  create(kind: ExtKind, f: { title: string; body: string; status: string; fields?: Record<string, unknown> }): Promise<RemoteItem>;
  /** expectedRevision가 null이면 개정을 묻지 않는다(댓글·덧붙이기처럼 겹쳐도 안전한 쓰기) */
  write(key: string, patch: WritePatch, expectedRevision: number | null): Promise<WriteResult>;
}

export const modeOf = (system: ExtSystem, env: Record<string, string | undefined> = process.env): AdapterMode => {
  const v = env[`IF_MODE_${EXT_SYSTEM_IF[system].slice(3)}`];
  return v === 'off' ? 'off' : v === 'live' ? 'live' : 'mock';
};

/** 플랫폼 이름으로 쓴다 — 바깥에서 누가 되쓴 것인지 보이게 */
export const PLATFORM_USER = 'feature-platform';

const view = (it: MockItem): RemoteItem => ({ system: it.system, kind: it.kind, key: it.key, url: extUrl(it.system, it.kind, it.key), title: it.title, status: it.status, revision: it.system === 'CODEBEAMER' ? it.revision : Date.parse(it.updatedAt), fields: it.fields });

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
    const fields = patch.append ? { [patch.append.field]: [...((it.fields[patch.append.field] as unknown[]) ?? []), patch.append.value] } : undefined;
    return { ok: true, item: view(this.store.update(this.system, key, PLATFORM_USER, { status: patch.status, comment: patch.comment, fields })) };
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
