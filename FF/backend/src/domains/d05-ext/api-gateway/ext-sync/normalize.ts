// webhook 수신 — 서명 확인과 정규화. 실서버·모의 서버가 같은 함수를 지난다.
//   GitLab: X-Gitlab-Token(비밀 토큰 그대로) · X-Gitlab-Event-UUID
//   JIRA: X-Hub-Signature: sha256=<HMAC(원문)> · X-Atlassian-Webhook-Identifier
//   codeBeamer: X-CB-Signature: sha256=<HMAC(원문)> · X-CB-Delivery (codeBeamer 쪽 webhook 설정에서 같은 모양으로 보낸다)
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { parseRefs, type ExtChange, type ExtSystem } from '@ff/contracts';
import { DomainError } from '../../../../kernel/errors';
import { modeOf } from './adapters';
import { extUrl, JIRA_EPIC_FIELDS, JIRA_PROJECTS, JIRA_REF_FIELD, WEBHOOK_SECRET } from './mock-ext.store';

export const hmac = (system: ExtSystem, raw: string) => `sha256=${createHmac('sha256', WEBHOOK_SECRET[system]()).update(raw).digest('hex')}`;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** 서명이 맞지 않으면 401 — 위조 요청으로 상태가 바뀌지 않게 */
export function verifyWebhook(system: ExtSystem, headers: Record<string, string | undefined>, raw: string): void {
  const h = (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? '';
  // 비밀값이 비었으면(운영 모드에서 설정 안 함) 어떤 요청도 받지 않는다 — 빈 서명 헤더와 같다고 통과시키지 않는다
  if (!WEBHOOK_SECRET[system]()) throw new DomainError('UNAUTHENTICATED', `${system} webhook 비밀값이 설정되지 않아 받지 않습니다.`);
  const ok = system === 'GITLAB' ? same(h('x-gitlab-token'), WEBHOOK_SECRET.GITLAB()) : same(h(system === 'JIRA' ? 'x-hub-signature' : 'x-cb-signature'), hmac(system, raw));
  if (!ok) throw new DomainError('UNAUTHENTICATED', `${system} webhook 서명이 맞지 않습니다 — 외부 시스템의 webhook 비밀값 설정을 확인하세요.`);
}

export function deliveryIdOf(system: ExtSystem, headers: Record<string, string | undefined>, raw: string): string {
  const k = system === 'GITLAB' ? 'x-gitlab-event-uuid' : system === 'JIRA' ? 'x-atlassian-webhook-identifier' : 'x-cb-delivery';
  return headers[k] || createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});
const rev = (iso: unknown) => {
  const t = Date.parse(str(iso));
  return Number.isFinite(t) ? t : 0;
};

/** 본문 → 정규화 변경. 이 연계와 무관한 이벤트(다른 이슈 유형·push 등)는 null */
export function normalize(system: ExtSystem, deliveryId: string, body: unknown): ExtChange | null {
  const b = obj(body);
  if (system === 'JIRA') {
    const issue = obj(b.issue);
    const f = obj(issue.fields);
    const type = str(obj(f.issuetype).name);
    const kind = type === 'Epic' ? 'EPIC' : type === 'Change Request' ? 'CHANGE_REQUEST' : type === 'Bug' ? 'DEFECT' : null;
    if (!kind || !issue.key) return null;
    const statusChange = (obj(b.changelog).items ?? []).find((x: any) => x?.field === 'status');
    const text = `${str(f.summary)}\n${str(f.description)}`;
    const policy = /\b(POL-\d{5})\b/.exec(text)?.[1];
    return {
      system,
      deliveryId,
      kind,
      key: str(issue.key),
      url: extUrl('JIRA', kind, str(issue.key)),
      title: str(f.summary),
      status: str(obj(f.status).name),
      fromStatus: statusChange ? str(statusChange.fromString) : null,
      revision: rev(f.updated),
      externalUser: str(obj(b.user).accountId),
      refs: { ...parseRefs(text, JIRA_PROJECTS.CHANGE_REQUEST()), ...(policy ? { policyId: policy } : {}), ...(obj(f.parent).key ? { epicKey: str(obj(f.parent).key) } : {}) },
      extra: { created: b.webhookEvent === 'jira:issue_created', description: str(f.description).slice(0, 2000), ...(kind === 'EPIC' ? { scope: epicScope(f) } : {}) },
    };
  }
  if (system === 'GITLAB') {
    const a = obj(b.object_attributes);
    const project = str(obj(b.project).path_with_namespace);
    if (b.object_kind === 'merge_request') {
      const key = `${project}!${a.iid}`;
      return {
        system,
        deliveryId,
        kind: 'MERGE_REQUEST',
        key,
        url: str(a.url) || extUrl('GITLAB', 'MERGE_REQUEST', key),
        title: str(a.title),
        status: str(a.state),
        fromStatus: null,
        revision: rev(a.updated_at),
        externalUser: str(obj(b.user).username),
        refs: parseRefs(`${str(a.title)}\n${str(a.description)}\n${str(a.source_branch)}`, JIRA_PROJECTS.CHANGE_REQUEST()),
        extra: { action: str(a.action), sourceBranch: str(a.source_branch), targetBranch: str(a.target_branch), sha: str(a.merge_commit_sha) || str(obj(a.last_commit).id), description: str(a.description).slice(0, 2000) },
      };
    }
    if (b.object_kind === 'pipeline') {
      const key = `pipeline/${a.id}`;
      const mr = obj(b.merge_request);
      return {
        system,
        deliveryId,
        kind: 'PIPELINE',
        key,
        url: str(a.url) || extUrl('GITLAB', 'PIPELINE', key),
        title: `파이프라인 #${a.id} (${str(a.ref)})`,
        status: str(a.status),
        fromStatus: null,
        revision: rev(a.finished_at),
        externalUser: str(obj(b.user).username),
        refs: parseRefs(`${str(a.ref)}\n${str(mr.title)}`, JIRA_PROJECTS.CHANGE_REQUEST()),
        extra: { sha: str(a.sha), ref: str(a.ref), mrKey: mr.iid ? `${project}!${mr.iid}` : null, coverage: a.coverage === null || a.coverage === undefined || a.coverage === '' ? null : Number(a.coverage) },
      };
    }
    return null;
  }
  const item = obj(b.item);
  if (!item.id) return null;
  const key = `CB-${item.id}`;
  return {
    system,
    deliveryId,
    kind: 'REQUIREMENT',
    key,
    url: extUrl('CODEBEAMER', 'REQUIREMENT', key),
    title: str(item.name),
    status: str(obj(item.status).name),
    fromStatus: null,
    revision: Number(item.version) || 0,
    externalUser: str(obj(item.modifiedBy).name),
    refs: {},
    extra: { created: b.event === 'ITEM_CREATED', description: str(item.description).slice(0, 2000), tracker: obj(item.tracker).name ?? null },
  };
}

/** Epic 사용자 정의 필드 → 적용 범위(문자열 또는 선택 목록 { value }·{ name }) — 비어 있는 값은 뺀다. 기준 기능 ID는 refIds(대표 먼저) */
function epicScope(f: Record<string, any>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, id] of Object.entries(JIRA_EPIC_FIELDS)) {
    const raw = f[id()];
    const v = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? (raw.value ?? raw.name) : undefined;
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  const refIds = epicRefIds(f);
  if (refIds.length) out.refIds = refIds;
  return out;
}

/**
 * Epic의 기준 기능 ID(30-95 §7, D-REF-16, 80-50 §4) — JIRA 안의 FF 앱이 쓰는 사용자 필드(JIRA_FIELD_FEATURE_DB)가 기준이다:
 * 필드에 값이 있으면 필드 값만 쓴다(첫 값이 대표). 같은 ID는 한 번만.
 * 실제 연결(IF_MODE_14=live)은 필드만 읽는다 — 비면 등록하지 않고 댓글로 알린다(라벨은 인정하지 않음).
 * 모의·데모(live가 아님)만 필드가 비었을 때 라벨 `ref-primary:<ID>`(대표) → `ref:<ID>`(포함)을 읽는다.
 */
export function epicRefIds(f: Record<string, any>, labelFallback = modeOf('JIRA') !== 'live'): string[] {
  const labels: string[] = Array.isArray(f.labels) ? f.labels.filter((l: unknown): l is string => typeof l === 'string') : [];
  const fromLabels = (prefix: string) => labels.filter((l) => l.toLowerCase().startsWith(prefix)).map((l) => l.slice(prefix.length).trim());
  const fieldId = JIRA_REF_FIELD();
  const raw = fieldId ? f[fieldId] : undefined;
  const items: unknown[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const fromField = items.flatMap((x) => {
    const v = typeof x === 'string' ? x : x && typeof x === 'object' ? ((x as any).value ?? (x as any).name) : undefined;
    return typeof v === 'string' ? v.split(/[\s,;]+/) : [];
  });
  const norm = (xs: string[]) => [...new Set(xs.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const field = norm(fromField);
  return field.length || !labelFallback ? field : norm([...fromLabels('ref-primary:'), ...fromLabels('ref:')]);
}
