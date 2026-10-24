// 가젯 데이터 원천 — 필터 결과·원형 차트·2차원 통계·생성 대 해결이 같은 행 모양(키·요약·상태·필드)으로 읽는다.
// 원천마다 고를 수 있는 열·통계 기준·상태가 다르다. 이 모듈은 가젯 본문·구성 양식과 함께 필요할 때만 읽힌다.
import type { ReactNode } from 'react';
import { actorFor } from '../../../api/actor';
import { useApi } from '../../../api/hooks';
import type { ApiError } from '../../../api/client';
import { dashboard } from '../../../copy/dashboard';
import { ko } from '../../../copy/ko';
import { useInbox } from '../Inbox';
import { useAppShell } from '../../../store';

const F = dashboard.board.fields;

export type FieldKey = keyof typeof F;
export type SourceId = 'features' | 'policies' | 'myReviews' | 'kills' | 'anomalies' | 'audit';

export interface Row {
  key: string;
  /** 키 링크 */
  to: string;
  summary: string;
  status: string;
  /** 나와 관련된 것(내가 만들었거나 요청했거나 처리했거나 내 차례) */
  mine: boolean;
  /** 생긴 때·닫힌 때 — 생성 대 해결 */
  at: string | null;
  closedAt: string | null;
  fields: Partial<Record<FieldKey, string>>;
}

export interface SourceDef {
  id: SourceId;
  /** 표에 고를 수 있는 열(키는 늘 첫 열) */
  columns: FieldKey[];
  /** 원형·2차원 통계 기준 */
  groups: FieldKey[];
  /** 상태 거르기 — 'open'은 아직 닫히지 않은 것 */
  statuses: string[];
  /** '나와 관련된 것만'이 뜻이 있는가 */
  mineFilter: boolean;
  /** 목록 화면으로 — 그 화면이 같은 조건을 받을 때만 */
  listUrl?: (field: FieldKey, value: string) => string | undefined;
  /** 머리 '전체 보기' */
  screen: string;
}

const OPEN_ANOMALY = ['OPEN', 'ACKNOWLEDGED'];

export const SOURCES: Record<SourceId, SourceDef> = {
  features: {
    id: 'features',
    columns: ['summary', 'status', 'asil', 'country', 'vehicleModel', 'owner'],
    groups: ['lifecycle', 'asil', 'country', 'vehicleModel', 'owner'],
    statuses: ['PROPOSED', 'APPROVED', 'DEVELOPING', 'VERIFIED', 'RELEASED', 'DEPRECATED', 'RETIRED'],
    mineFilter: false,
    listUrl: (f, v) => (f === 'lifecycle' || f === 'status' ? `/features?lifecycle=${encodeURIComponent(v)}` : f === 'country' ? `/features?country=${encodeURIComponent(v)}` : undefined),
    screen: '/features',
  },
  policies: {
    id: 'policies',
    columns: ['flagKey', 'feature', 'status', 'controlPoint', 'createdBy', 'created'],
    groups: ['status', 'controlPoint', 'createdBy'],
    statuses: ['DRAFT', 'VALIDATED', 'APPROVED', 'DEPLOYED', 'REJECTED', 'RETIRED'],
    mineFilter: true,
    screen: '/policies',
  },
  myReviews: {
    id: 'myReviews',
    columns: ['summary', 'queue', 'status', 'requestedBy', 'created'],
    groups: ['queue', 'status'],
    statuses: [],
    mineFilter: true,
    screen: '/admin/approval',
  },
  kills: {
    id: 'kills',
    columns: ['feature', 'status', 'reason', 'fClass', 'requestedBy', 'created'],
    groups: ['status', 'reason', 'fClass'],
    statuses: ['open', 'REQUESTED', 'ACTIVE', 'RELEASED', 'REJECTED', 'EXPIRED'],
    mineFilter: true,
    screen: '/ops/kill',
  },
  anomalies: {
    id: 'anomalies',
    columns: ['kind', 'feature', 'severity', 'status', 'opened'],
    groups: ['status', 'severity', 'kind'],
    statuses: ['open', 'OPEN', 'ACKNOWLEDGED', 'MITIGATED', 'DISMISSED'],
    mineFilter: true,
    screen: '/ops/anomalies',
  },
  audit: {
    id: 'audit',
    columns: ['actor', 'action', 'target', 'result', 'at'],
    groups: ['result', 'action', 'actor'],
    statuses: ['ALLOWED', 'DENIED', 'FAILED'],
    mineFilter: true,
    screen: '/audit',
  },
};

export const sourceOf = (id: unknown): SourceDef => SOURCES[(String(id) as SourceId) in SOURCES ? (String(id) as SourceId) : 'features'];

/** 상태 거르기 — 'open'은 닫히지 않은 것(이상 건: 열림·확인됨, 긴급 차단: 요청·걸림) */
export function statusMatch(source: SourceId, status: string, want: string): boolean {
  if (!want) return true;
  if (want === 'open') return source === 'anomalies' ? OPEN_ANOMALY.includes(status) : source === 'kills' ? status === 'REQUESTED' || status === 'ACTIVE' : true;
  return status === want;
}

/** 상태 선택지 이름 */
export const statusLabel = (v: string) => (v === 'open' ? dashboard.board.statusOpen : v);

export interface SourceResult {
  rows: Row[];
  state: 'loading' | 'ready' | 'error';
  error: ApiError | null;
  retry: () => void;
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

interface FeatureItem { featureId: string; version: string; name: string; lifecycle: string; asil?: string; country?: string; vehicleModel?: string; ownerId?: string }
interface PolicyItem { policyId: string; flagKey: string; featureId: string; featureVersion: string; status: string; controlPoint?: string; createdBy: string; createdAt: string; approvedAt?: string | null; description?: string }
interface KillItem { killId: string; featureId: string; featureVersion: string; status: string; reasonCategory?: string; fClass?: string; requestedBy: string; requestedAt: string; restoredAt?: string | null; updatedAt?: string }
interface AnomalyItem { anomalyId: string; featureId: string; status: string; severity: string; kind: string; openedAt: string; closedAt: string | null; acknowledgedBy?: string | null; closedBy?: string | null }
interface AuditItem { id: number; at: string; actorId: string; actorRole: string; action: string; target: string; result: string }

const API: Record<Exclude<SourceId, 'myReviews'>, { name: string; query?: Record<string, string | number | boolean> }> = {
  features: { name: 'listFeatures', query: { latestOnly: true } },
  policies: { name: 'listPolicies' },
  kills: { name: 'killRequests' },
  anomalies: { name: 'anomalies' },
  audit: { name: 'audit', query: { limit: 200 } },
};

function toRows(source: Exclude<SourceId, 'myReviews'>, items: unknown[], me: string): Row[] {
  const A = ko.anomaly;
  switch (source) {
    case 'features':
      return (items as FeatureItem[]).map((f) => ({
        key: f.featureId,
        to: `/features/${f.featureId}/${f.version}`,
        summary: f.name,
        status: f.lifecycle,
        mine: false,
        at: null,
        closedAt: null,
        fields: { summary: f.name, status: f.lifecycle, lifecycle: f.lifecycle, asil: f.asil ? `ASIL ${f.asil}`.replace('ASIL QM', 'QM') : '', country: f.country ?? '', vehicleModel: f.vehicleModel ?? '', owner: f.ownerId ?? '' },
      }));
    case 'policies':
      return (items as PolicyItem[]).map((p) => ({
        key: p.policyId,
        to: `/policies/${p.policyId}`,
        summary: p.description || p.flagKey,
        status: p.status,
        mine: p.createdBy === me,
        at: p.createdAt,
        closedAt: p.approvedAt ?? null,
        fields: { summary: p.description || p.flagKey, flagKey: p.flagKey, feature: `${p.featureId} ${p.featureVersion}`, status: p.status, controlPoint: p.controlPoint ?? '', createdBy: p.createdBy, created: day(p.createdAt) },
      }));
    case 'kills':
      return (items as KillItem[]).map((k) => ({
        key: k.killId,
        to: `/ops/kill?id=${encodeURIComponent(k.killId)}`,
        summary: `${k.featureId} ${k.featureVersion}`,
        status: k.status,
        mine: k.requestedBy === me,
        at: k.requestedAt,
        closedAt: ['RELEASED', 'REJECTED', 'EXPIRED'].includes(k.status) ? (k.restoredAt ?? k.updatedAt ?? null) : null,
        fields: { summary: `${k.featureId} ${k.featureVersion}`, feature: `${k.featureId} ${k.featureVersion}`, status: k.status, reason: k.reasonCategory ?? '', fClass: k.fClass ?? '', requestedBy: k.requestedBy, created: day(k.requestedAt) },
      }));
    case 'anomalies':
      return (items as AnomalyItem[]).map((a) => {
        const kind = A.kind[a.kind as keyof typeof A.kind] ?? a.kind;
        return {
          key: a.anomalyId,
          to: `/ops/anomalies?id=${encodeURIComponent(a.anomalyId)}`,
          summary: `${kind} · ${a.featureId}`,
          status: a.status,
          mine: a.acknowledgedBy === me || a.closedBy === me,
          at: a.openedAt,
          closedAt: a.closedAt,
          fields: { summary: `${kind} · ${a.featureId}`, kind, feature: a.featureId, severity: a.severity, status: a.status, opened: day(a.openedAt) },
        };
      });
    case 'audit':
      return (items as AuditItem[]).map((e) => ({
        key: String(e.id),
        to: `/audit?target=${encodeURIComponent(e.target)}`,
        summary: `${e.action} — ${e.target}`,
        status: e.result,
        mine: e.actorId === me,
        at: e.at,
        closedAt: null,
        fields: { summary: `${e.action} — ${e.target}`, actor: e.actorId, action: e.action, target: e.target, result: e.result, at: e.at.slice(0, 16).replace('T', ' ') },
      }));
  }
}

function ApiSource({ source, children }: { source: Exclude<SourceId, 'myReviews'>; children: (r: SourceResult) => ReactNode }) {
  const { role } = useAppShell();
  const def = API[source];
  const q = useApi<{ items?: unknown[] }>(def.name, { query: def.query });
  const items = Array.isArray(q.data?.items) ? q.data!.items! : [];
  const rows = toRows(source, items, actorFor(role).id);
  return <>{children({ rows, state: q.isPending ? 'loading' : q.isError ? 'error' : 'ready', error: q.error ?? null, retry: () => void q.refetch() })}</>;
}

function InboxSource({ children }: { children: (r: SourceResult) => ReactNode }) {
  const inbox = useInbox();
  const Q = ko.master.inbox.queues;
  const rows: Row[] = inbox.items.map((i) => ({
    key: i.item,
    to: i.to,
    summary: i.detail,
    status: i.mine ? dashboard.board.mineState.yes : dashboard.board.mineState.no,
    mine: i.mine,
    at: i.since,
    closedAt: null,
    fields: { summary: i.detail, queue: Q[i.queue], status: i.mine ? dashboard.board.mineState.yes : dashboard.board.mineState.no, requestedBy: i.who ?? '', created: day(i.since) },
  }));
  return <>{children({ rows, state: inbox.loading ? 'loading' : inbox.error ? 'error' : 'ready', error: (inbox.error as ApiError | null) ?? null, retry: inbox.retry })}</>;
}

/** 원천의 행을 읽어 넘긴다 — 원천이 바뀌면 부르는 쪽이 key로 다시 그린다 */
export function SourceData({ source, children }: { source: SourceId; children: (r: SourceResult) => ReactNode }) {
  return source === 'myReviews' ? <InboxSource>{children}</InboxSource> : <ApiSource source={source}>{children}</ApiSource>;
}

/** 거르기 — 상태·나와 관련된 것만 */
export function filterRows(source: SourceId, rows: Row[], status: string, mine: boolean): Row[] {
  return rows.filter((r) => statusMatch(source, r.status, status) && (!mine || r.mine));
}

/** 값별 개수 — 큰 것부터, 같으면 이름 순 */
export function countBy(rows: Row[], field: FieldKey): { value: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = (field === 'status' ? r.status : r.fields[field]) || '';
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
}

export const fieldValue = (r: Row, f: FieldKey) => (f === 'key' ? r.key : f === 'status' ? r.status : (r.fields[f] ?? ''));
