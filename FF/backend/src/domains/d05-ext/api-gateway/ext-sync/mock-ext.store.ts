// 모의 외부 시스템(GitLab · JIRA · codeBeamer) — 실서버가 없을 때 "바깥 세상" 역할. 항목·상태·댓글·개정 번호를 따로 갖고,
// 사람이 바깥에서 한 일(상태 변경·편집·병합)은 각 도구의 실제 webhook 본문 모양으로 만들어 플랫폼 수신 창구로 보낸다
// (실서버와 같은 정규화·서명 검증 경로를 탄다). 실제 연결(IF_MODE_xx=live)이면 이 저장소를 쓰지 않는다.
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ExtKind, ExtSystem } from '@ff/contracts';
import { Clock } from '../../../../kernel/clock';
import { DB, type Db } from '../../../../kernel/db';

export interface MockComment {
  at: string;
  by: string;
  text: string;
}

export interface MockItem {
  system: ExtSystem;
  key: string;
  kind: ExtKind;
  title: string;
  body: string;
  status: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  comments: MockComment[];
  /** JIRA: parentKey(Epic)·featureId/version·policyId · GitLab: sha·sourceBranch·targetBranch·pipeline·commitStatuses · codeBeamer: tracker·verifications */
  fields: Record<string, unknown>;
}

/** 모의 서버 주소 — 링크가 실제 도구 주소 모양이 되게(환경 변수로 바꿀 수 있다) */
export const EXT_BASE_URL: Record<ExtSystem, () => string> = {
  GITLAB: () => process.env.GITLAB_URL ?? 'https://gitlab.ff.example',
  JIRA: () => process.env.JIRA_URL ?? 'https://jira.ff.example',
  CODEBEAMER: () => process.env.CODEBEAMER_URL ?? 'https://codebeamer.ff.example',
};
export const GITLAB_PROJECT = () => process.env.GITLAB_PROJECT ?? 'vehicle/feature-sw';
export const JIRA_PROJECTS = { EPIC: () => process.env.JIRA_EPIC_PROJECT ?? 'FFE', CHANGE_REQUEST: () => process.env.JIRA_CR_PROJECT ?? 'FFCR', DEFECT: () => process.env.JIRA_DEFECT_PROJECT ?? 'FFD' };
export const CODEBEAMER_TRACKER = () => Number(process.env.CODEBEAMER_REQ_TRACKER ?? 4711);

export function extUrl(system: ExtSystem, kind: string, key: string): string {
  const base = EXT_BASE_URL[system]();
  if (system === 'JIRA') return `${base}/browse/${key}`;
  if (system === 'CODEBEAMER') return `${base}/cb/issue/${key.replace(/^CB-/, '')}`;
  if (kind === 'PIPELINE') return `${base}/${GITLAB_PROJECT()}/-/pipelines/${key.split('/').pop()}`;
  return `${base}/${GITLAB_PROJECT()}/-/merge_requests/${key.split('!').pop()}`;
}

/** webhook 비밀값 — 모의는 기본값, 실서버는 환경 변수 */
export const WEBHOOK_SECRET: Record<ExtSystem, () => string> = {
  GITLAB: () => process.env.GITLAB_WEBHOOK_TOKEN ?? 'ff-mock-gitlab-token',
  JIRA: () => process.env.JIRA_WEBHOOK_SECRET ?? 'ff-mock-jira-secret',
  CODEBEAMER: () => process.env.CODEBEAMER_WEBHOOK_SECRET ?? 'ff-mock-codebeamer-secret',
};

export interface WebhookDelivery {
  system: ExtSystem;
  headers: Record<string, string>;
  body: unknown;
}

@Injectable()
export class MockExtStore {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  get(system: ExtSystem, key: string): MockItem | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM mock_ext_item WHERE system = ? AND ext_key = ?', system, key);
    return r ? (JSON.parse(r.doc) as MockItem) : null;
  }
  all(system: ExtSystem, kind?: ExtKind): MockItem[] {
    return this.db.all<{ doc: string }>(`SELECT doc FROM mock_ext_item WHERE system = ?${kind ? ' AND kind = ?' : ''} ORDER BY rowid`, ...(kind ? [system, kind] : [system])).map((r) => JSON.parse(r.doc) as MockItem);
  }
  private save(it: MockItem) {
    this.db.run('INSERT INTO mock_ext_item (system, ext_key, kind, revision, doc) VALUES (?, ?, ?, ?, ?) ON CONFLICT(system, ext_key) DO UPDATE SET revision = excluded.revision, doc = excluded.doc', it.system, it.key, it.kind, it.revision, JSON.stringify(it));
  }
  private next(scope: string, start: number): number {
    const cur = this.db.get<{ n: number }>('SELECT n FROM mock_ext_seq WHERE scope = ?', scope)?.n;
    const n = cur === undefined ? start : cur + 1;
    this.db.run('INSERT INTO mock_ext_seq (scope, n) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET n = excluded.n', scope, n);
    return n;
  }
  /** 고친 시각 — 같은 밀리초에 여러 번 바뀌어도 늘 커진다(JIRA·GitLab은 updated 시각이 개정 번호 구실) */
  private stamp(prev: string | null): string {
    const now = this.clock.now().getTime();
    const t = prev ? Math.max(now, Date.parse(prev) + 1) : now;
    return new Date(t).toISOString();
  }

  create(system: ExtSystem, kind: ExtKind, f: { title: string; body?: string; status: string; by: string; fields?: Record<string, unknown>; key?: string }): MockItem {
    const key =
      f.key ??
      (system === 'JIRA'
        ? `${JIRA_PROJECTS[kind as 'EPIC' | 'CHANGE_REQUEST' | 'DEFECT']()}-${this.next(`JIRA:${kind}`, 1)}`
        : system === 'CODEBEAMER'
          ? `CB-${this.next('CB', 10001)}`
          : kind === 'PIPELINE'
            ? `pipeline/${this.next('GL:PIPELINE', 50001)}`
            : `${GITLAB_PROJECT()}!${this.next('GL:MR', 101)}`);
    const it: MockItem = { system, key, kind, title: f.title, body: f.body ?? '', status: f.status, revision: 1, updatedAt: this.stamp(null), updatedBy: f.by, comments: [], fields: f.fields ?? {} };
    this.save(it);
    return it;
  }

  /** 바깥에서(사람·모의 화면) 또는 플랫폼 되쓰기로 바꾼다 — 개정 번호가 오른다 */
  update(system: ExtSystem, key: string, by: string, patch: { status?: string; title?: string; body?: string; comment?: string; fields?: Record<string, unknown> }): MockItem {
    const it = this.get(system, key);
    if (!it) throw new Error(`${system} ${key} 없음`);
    const next: MockItem = {
      ...it,
      title: patch.title ?? it.title,
      body: patch.body ?? it.body,
      status: patch.status ?? it.status,
      revision: it.revision + 1,
      updatedAt: this.stamp(it.updatedAt),
      updatedBy: by,
      comments: patch.comment ? [...it.comments, { at: this.clock.iso(), by, text: patch.comment }] : it.comments,
      fields: { ...it.fields, ...(patch.fields ?? {}) },
    };
    this.save(next);
    return next;
  }

  /** 항목의 현재 모습을 그 도구의 webhook 본문으로 — 수신 창구가 실서버와 같은 경로로 받는다 */
  webhook(it: MockItem, change: { fromStatus: string | null; created: boolean; action?: string }): WebhookDelivery {
    const deliveryId = createHash('sha256').update(`${it.system}:${it.key}:${it.revision}:${change.action ?? ''}`).digest('hex').slice(0, 32);
    if (it.system === 'JIRA') {
      const body = {
        webhookEvent: change.created ? 'jira:issue_created' : 'jira:issue_updated',
        timestamp: Date.parse(it.updatedAt),
        user: { accountId: it.updatedBy, displayName: it.updatedBy },
        issue: {
          key: it.key,
          self: `${EXT_BASE_URL.JIRA()}/rest/api/2/issue/${it.key}`,
          fields: {
            summary: it.title,
            description: it.body,
            issuetype: { name: it.kind === 'EPIC' ? 'Epic' : it.kind === 'DEFECT' ? 'Bug' : 'Change Request' },
            status: { name: it.status },
            updated: it.updatedAt,
            ...(it.fields.parentKey ? { parent: { key: it.fields.parentKey } } : {}),
          },
        },
        ...(change.fromStatus !== null && change.fromStatus !== it.status ? { changelog: { items: [{ field: 'status', fromString: change.fromStatus, toString: it.status }] } } : {}),
      };
      return { system: 'JIRA', headers: { 'x-atlassian-webhook-identifier': deliveryId, 'x-hub-signature': '' }, body };
    }
    if (it.system === 'GITLAB') {
      const project = { path_with_namespace: GITLAB_PROJECT(), web_url: `${EXT_BASE_URL.GITLAB()}/${GITLAB_PROJECT()}` };
      const body =
        it.kind === 'PIPELINE'
          ? {
              object_kind: 'pipeline',
              user: { username: it.updatedBy },
              project,
              object_attributes: { id: Number(it.key.split('/').pop()), status: it.status, sha: it.fields.sha, ref: it.fields.ref, finished_at: it.updatedAt, coverage: it.fields.coverage ?? null, url: extUrl('GITLAB', 'PIPELINE', it.key) },
              merge_request: it.fields.mrKey ? { iid: Number(String(it.fields.mrKey).split('!').pop()), title: it.fields.mrTitle ?? '' } : null,
            }
          : {
              object_kind: 'merge_request',
              event_type: 'merge_request',
              user: { username: it.updatedBy },
              project,
              object_attributes: {
                iid: Number(it.key.split('!').pop()),
                title: it.title,
                description: it.body,
                state: it.status,
                action: change.action ?? (change.created ? 'open' : 'update'),
                source_branch: it.fields.sourceBranch,
                target_branch: it.fields.targetBranch ?? 'main',
                merge_commit_sha: it.status === 'merged' ? it.fields.sha : null,
                last_commit: { id: it.fields.sha },
                url: extUrl('GITLAB', 'MERGE_REQUEST', it.key),
                updated_at: it.updatedAt,
              },
            };
      return { system: 'GITLAB', headers: { 'x-gitlab-event-uuid': deliveryId, 'x-gitlab-token': WEBHOOK_SECRET.GITLAB(), 'x-gitlab-event': it.kind === 'PIPELINE' ? 'Pipeline Hook' : 'Merge Request Hook' }, body };
    }
    const body = {
      event: change.created ? 'ITEM_CREATED' : 'ITEM_UPDATED',
      item: {
        id: Number(it.key.replace(/^CB-/, '')),
        name: it.title,
        description: it.body,
        status: { name: it.status },
        version: it.revision,
        tracker: { id: CODEBEAMER_TRACKER(), name: 'System Requirements' },
        modifiedAt: it.updatedAt,
        modifiedBy: { name: it.updatedBy },
      },
    };
    return { system: 'CODEBEAMER', headers: { 'x-cb-delivery': deliveryId, 'x-cb-signature': '' }, body };
  }
}
