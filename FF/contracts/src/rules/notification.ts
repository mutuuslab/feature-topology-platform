// 수신자 지정 알림 (D04-04 이벤트 이력 추적) — 기능명세서 공통 요구 "관련 담당자에게 Web 알림 또는 이메일".
// 커밋되는 플랫폼 이벤트마다 아래 규칙표가 알림 하나(내용·수신자·링크)를 만든다. 순수 함수 — 백엔드가 이벤트와 같은 트랜잭션에서
// 부르고(알림만 남고 변경이 롤백되는 일이 없다), 화면은 같은 범주·심각도 표기를 쓴다.
// 수신자: 개인(요청자·작성자·배포자), 역할(승인 대상자·운영 담당자, 본인·직무 분리 제외 계정 빼고), 팀(Feature Owner = ownerId 팀).
// 채널: Web 알림은 항상, 이메일은 수신자 설정(범주별)에 따른다 — 승인 요청·긴급(CRITICAL)은 끌 수 없다.
import { z } from 'zod';
import { KILL_APPROVER_ROLES } from './access';
import { DEMO_PERSONAS } from './duty-separation';
import type { Role } from '../enums';

export const NOTIFICATION_CATEGORIES = ['APPROVAL', 'SAFETY', 'DEPLOY', 'GATE', 'OPS', 'INTEGRATION'] as const;
export const NotificationCategory = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  APPROVAL: '승인 요청',
  SAFETY: '긴급 차단·복원',
  DEPLOY: '정책 배포',
  GATE: 'Gate 판정',
  OPS: '이상 징후',
  INTEGRATION: '외부 연계',
};

export const NotificationSeverity = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export type NotificationSeverity = z.infer<typeof NotificationSeverity>;

export type Recipient = { kind: 'user'; id: string } | { kind: 'role'; role: Role } | { kind: 'team'; team: string };

export interface NotificationDraft {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  /** 명세서가 요구하는 내용 항목 — 표시 순서대로 */
  fields: { label: string; value: string }[];
  /** 화면 경로(앱 안 링크) */
  link: string;
  recipients: Recipient[];
  /** 수신자에서 빼는 계정 — 요청 본인, 직무 분리로 승인할 수 없는 사람(SOD-09) */
  exclude: string[];
  /** 이 알림이 충족하는 기능명세서 요구사항 */
  requirementIds: string[];
}

export interface Notification extends NotificationDraft {
  notificationId: string;
  eventSeq: number;
  eventType: string;
  aggregate: string;
  createdAt: string;
}

/** 알림 규칙이 읽는 맥락 — 백엔드가 이벤트 종류에 맞춰 Feature·정책·차단 기록을 채운다 */
export interface NotificationContext {
  event: { seq: number; type: string; at: string; aggregate: string; payload: Record<string, any> };
  feature?: { featureId: string; version: string; name: string; ownerId: string } | null;
  policy?: { policyId: string; flagKey: string; controlPoint: string; featureId: string; featureVersion: string; createdBy: string; approvedBy: string | null; deployedBy?: string | null } | null;
  kill?: {
    killId: string;
    featureId: string;
    featureIds: string[];
    flagKeys: string[];
    vins: string[];
    reason: string;
    reasonCategory?: string;
    reasonCode?: string;
    requestedBy: string;
    requestedAt: string;
    approvals?: { approverId: string }[];
    restoreRequest?: { requestedBy: string; requestedAt: string; reason: string; approvals: { approverId: string }[] } | null;
  } | null;
}

export interface NotificationRule {
  /** 맥락에 필요한 기록 */
  needs: ('feature' | 'policy' | 'kill')[];
  /** 알림을 만들지 않으면 null (예: 검증 GO가 아닌 NO-GO만 차단 알림) */
  build: (ctx: NotificationContext) => NotificationDraft | null;
}

const owner = (ctx: NotificationContext): Recipient[] => (ctx.feature?.ownerId ? [{ kind: 'team', team: ctx.feature.ownerId }] : []);
const featureLabel = (ctx: NotificationContext, featureId: string) => (ctx.feature && ctx.feature.featureId === featureId ? `${featureId} ${ctx.feature.name}` : featureId);
const scopeOf = (k: NonNullable<NotificationContext['kill']>) => `차량 ${k.vins.length}대 · flag ${k.flagKeys.join(', ') || '-'}${k.featureIds.length > 1 ? ` · 의존 Feature ${k.featureIds.filter((f) => f !== k.featureId).join(', ')}` : ''}`;
const reasonOf = (k: NonNullable<NotificationContext['kill']>) => [k.reasonCategory && k.reasonCode ? `${k.reasonCategory}/${k.reasonCode}` : null, k.reason].filter(Boolean).join(' — ');
const roles = (rs: readonly Role[]): Recipient[] => rs.map((role) => ({ kind: 'role', role }));

/**
 * 이벤트 종류 → 알림 규칙. 없는 이벤트는 알림을 만들지 않는다(이벤트 이력에만 남는다).
 * @req FR-REG-005-014, FR-CRC-002-009, FR-DSV-001-011, FR-KSW-003-003, FR-KSW-004-005, FR-EVT-003-003, FR-DSYN-001-004
 */
export const NOTIFICATION_RULES: Record<string, NotificationRule> = {
  'gate.judged': {
    needs: ['feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const [featureId, version] = ctx.event.aggregate.split('@');
      return {
        category: 'GATE',
        severity: p.status === 'FAIL' ? 'WARNING' : 'INFO',
        title: `${p.gate} ${p.status} — ${featureId} ${version}`,
        fields: [
          { label: 'Feature', value: `${featureLabel(ctx, featureId)} ${version}` },
          { label: 'Gate', value: String(p.gate) },
          { label: '판정', value: String(p.status) },
          { label: '판정자', value: String(p.by ?? '-') },
        ],
        link: `/features/${featureId}/${version}?tab=gates`,
        recipients: [...owner(ctx), ...roles(['FEATURE_APPROVER'])],
        exclude: [String(p.by ?? '')].filter(Boolean),
        requirementIds: ['FR-REG-005-014'],
      };
    },
  },
  'policy.validated': {
    needs: ['policy', 'feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const pol = ctx.policy;
      if (!pol) return null;
      if (p.decision === 'GO')
        return {
          category: 'APPROVAL',
          severity: 'INFO',
          title: `정책 승인 요청 — ${pol.policyId} (${pol.flagKey})`,
          fields: [
            { label: '정책', value: `${pol.policyId} · ${pol.flagKey}` },
            { label: 'Feature', value: `${featureLabel(ctx, pol.featureId)} ${pol.featureVersion}` },
            { label: 'Control Point', value: pol.controlPoint },
            { label: '검증', value: `GO (${p.runId})` },
            { label: '요청자', value: pol.createdBy },
          ],
          link: `/policies/${pol.policyId}`,
          recipients: roles(['FEATURE_APPROVER']),
          exclude: [pol.createdBy],
          requirementIds: [],
        };
      const failed = (p.results ?? []).filter((r: any) => r.result !== 'PASS').map((r: any) => `${r.componentId} ${r.result}`);
      return {
        category: 'DEPLOY',
        severity: 'WARNING',
        title: `배포 차단 — ${pol.policyId} 정책 검증 ${p.decision}`,
        fields: [
          { label: '배포 대상 정책', value: `${pol.policyId} · ${pol.flagKey}` },
          { label: 'Feature', value: `${featureLabel(ctx, pol.featureId)} ${pol.featureVersion}` },
          { label: '실패 항목', value: failed.join(', ') || '-' },
          { label: '차단 사유', value: `검증 실행 ${p.runId} 판정 ${p.decision} — 실패 항목을 해결해야 승인·배포할 수 있다` },
        ],
        link: `/policies/${pol.policyId}`,
        recipients: [...owner(ctx), { kind: 'user', id: pol.createdBy }],
        exclude: [],
        requirementIds: ['FR-CRC-002-009', 'FR-DSV-001-011'],
      };
    },
  },
  'policy.deployed': {
    needs: ['policy', 'feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const pol = ctx.policy;
      if (!pol) return null;
      return {
        category: 'DEPLOY',
        severity: 'INFO',
        title: `Control Point 상태 변경 — ${pol.controlPoint} ${pol.flagKey} 정책 배포`,
        fields: [
          { label: 'Control Point', value: `${pol.featureId} ${pol.controlPoint} (${pol.flagKey})` },
          { label: '변경 내용', value: `${pol.policyId} 배포${p.replaced ? ` · 이전 ${p.replaced} 대체(RETIRED)` : ''} · 게시본 ${p.publicationId}` },
          { label: '제어 사유', value: String(p.reason ?? '-') },
          { label: '배포자', value: pol.deployedBy ?? '-' },
        ],
        link: `/policies/${pol.policyId}`,
        recipients: [...owner(ctx), ...roles(['OPERATOR'])],
        exclude: [pol.deployedBy ?? ''].filter(Boolean),
        requirementIds: [],
      };
    },
  },
  'kill.requested': {
    needs: ['kill', 'feature'],
    build: (ctx) => {
      const k = ctx.kill;
      if (!k) return null;
      return {
        category: 'APPROVAL',
        severity: 'CRITICAL',
        title: `긴급 차단 승인 요청 — ${k.killId} ${k.featureId}`,
        fields: [
          { label: 'Feature', value: featureLabel(ctx, k.featureId) },
          { label: '차단 대상 범위', value: scopeOf(k) },
          { label: '차단 사유', value: reasonOf(k) },
          { label: '요청자', value: k.requestedBy },
          { label: '요청 일시', value: k.requestedAt },
        ],
        link: `/ops/kill?id=${k.killId}`,
        recipients: roles(KILL_APPROVER_ROLES),
        exclude: [k.requestedBy],
        requirementIds: [],
      };
    },
  },
  'kill.issued': {
    needs: ['kill', 'feature'],
    build: (ctx) => {
      const k = ctx.kill;
      if (!k) return null;
      return {
        category: 'SAFETY',
        severity: 'CRITICAL',
        title: `긴급 차단 실행 — ${k.featureId} (${k.killId})`,
        fields: [
          { label: 'Feature', value: featureLabel(ctx, k.featureId) },
          { label: '차단 대상 범위', value: scopeOf(k) },
          { label: '차단 사유', value: reasonOf(k) },
          { label: '명령', value: String(ctx.event.payload.commandId ?? '-') },
        ],
        link: `/ops/kill?id=${k.killId}`,
        recipients: [...owner(ctx), ...roles(['OPERATOR', 'OPS_LEAD'])],
        exclude: [],
        requirementIds: ['FR-KSW-003-003'],
      };
    },
  },
  'kill.restore-requested': {
    needs: ['kill', 'feature'],
    build: (ctx) => {
      const k = ctx.kill;
      const rr = k?.restoreRequest;
      if (!k || !rr) return null;
      return {
        category: 'APPROVAL',
        severity: 'WARNING',
        title: `차단 해제(복원) 승인 요청 — ${k.featureId} (${k.killId})`,
        fields: [
          { label: 'Feature', value: featureLabel(ctx, k.featureId) },
          { label: '해제 대상 범위', value: scopeOf(k) },
          { label: '해제 사유', value: rr.reason },
          { label: '요청자', value: rr.requestedBy },
          { label: '요청 일시', value: rr.requestedAt },
        ],
        link: `/ops/kill?id=${k.killId}`,
        recipients: roles(KILL_APPROVER_ROLES),
        // 직전 차단 승인자는 복원을 승인할 수 없다(SOD-09) — 승인 대상자가 아니므로 받지 않는다
        exclude: [rr.requestedBy, ...(k.approvals ?? []).map((a) => a.approverId)],
        requirementIds: ['FR-KSW-004-005'],
      };
    },
  },
  'anomaly.opened': { needs: ['feature'], build: (ctx) => anomaly(ctx, '발생') },
  'anomaly.escalated': { needs: ['feature'], build: (ctx) => anomaly(ctx, '격상') },
  'sync.completed': {
    needs: [],
    build: (ctx) => {
      const p = ctx.event.payload;
      if (p.status !== 'FAILED') return null;
      return {
        category: 'INTEGRATION',
        severity: 'WARNING',
        title: `데이터 동기화 실패 — ${p.targetId} (${p.ifId})`,
        fields: [
          { label: '실패 유형', value: `동기화 ${p.status}${p.reason ? ` — ${p.reason}` : ''}` },
          { label: '발생 시점', value: ctx.event.at },
          { label: '대상 외부 시스템', value: `${p.targetId} · ${p.ifId}${p.market ? ` · 시장 ${p.market}` : ''}` },
        ],
        link: '/integration/sync',
        recipients: roles(['IMPLEMENTER']),
        exclude: [],
        requirementIds: ['FR-DSYN-001-004'],
      };
    },
  },
};

function anomaly(ctx: NotificationContext, what: string): NotificationDraft {
  const p = ctx.event.payload;
  const critical = p.severity === 'CRITICAL';
  return {
    category: 'OPS',
    severity: critical ? 'CRITICAL' : p.severity === 'WARNING' ? 'WARNING' : 'INFO',
    title: `이상 이벤트 ${what} — ${p.featureId} ${p.kind} (${p.severity})`,
    fields: [
      { label: 'Feature', value: featureLabel(ctx, String(p.featureId)) },
      { label: '이벤트 유형', value: `${p.kind} · 권고 ${p.advice}` },
      { label: '발생 시점', value: ctx.event.at },
      { label: '발생 건수', value: `신호 ${p.signals ?? '-'}건 · 차량 ${p.vins ?? 0}대` },
    ],
    link: `/ops/anomalies?id=${p.anomalyId}`,
    recipients: [...owner(ctx), ...roles(critical ? ['OPERATOR', 'OPS_LEAD', 'SAFETY_OFFICER'] : ['OPERATOR', 'OPS_LEAD'])],
    exclude: [],
    requirementIds: ['FR-EVT-003-003'],
  };
}

// ─── 수신 계정 ───────────────────────────────────────────────

export interface NotificationAccount {
  id: string;
  roles: Role[];
  /** Feature Owner 팀 — '*'는 모든 Owner 팀(데모: Feature 설계 계정이 기획팀을 대신 받는다) */
  teams: string[] | '*';
  email: string;
}

/** 데모 IAM 계정(usr-<persona>) — 역할은 DEMO_PERSONAS와 같다. 실제 배치는 전사 IAM 디렉터리·조직도에서 읽는다 */
export const NOTIFICATION_ACCOUNTS: NotificationAccount[] = Object.entries(DEMO_PERSONAS).map(([key, rs]) => ({
  id: `usr-${key}`,
  roles: [...rs],
  teams: key === 'author' ? '*' : [],
  email: `${key}@ff-demo.invalid`,
}));

export const accountOf = (id: string, fallbackRole?: Role): NotificationAccount =>
  NOTIFICATION_ACCOUNTS.find((a) => a.id === id) ?? { id, roles: fallbackRole ? [fallbackRole] : [], teams: [], email: '' };

/** 이 계정이 알림을 받는가 — 제외 계정이면 역할이 맞아도 받지 않는다 */
export function receives(n: Pick<NotificationDraft, 'recipients' | 'exclude'>, a: Pick<NotificationAccount, 'id' | 'roles' | 'teams'>): boolean {
  if (n.exclude.includes(a.id)) return false;
  return n.recipients.some((r) => (r.kind === 'user' ? r.id === a.id : r.kind === 'role' ? a.roles.includes(r.role) : a.teams === '*' || a.teams.includes(r.team)));
}

/** 수신자 저장 키 — 'user:usr-author' · 'role:OPERATOR' · 'team:ADAS기획팀' */
export const recipientKey = (r: Recipient) => (r.kind === 'user' ? `user:${r.id}` : r.kind === 'role' ? `role:${r.role}` : `team:${r.team}`);

/** 계정이 볼 수신자 키(팀 '*'는 'team:*'로 표기 — 저장소가 모든 팀으로 해석) */
export const accountKeys = (a: Pick<NotificationAccount, 'id' | 'roles' | 'teams'>) => [`user:${a.id}`, ...a.roles.map((r) => `role:${r}`), ...(a.teams === '*' ? ['team:*'] : a.teams.map((t) => `team:${t}`))];

// ─── 이메일 설정 ─────────────────────────────────────────────

/** 끌 수 없는 이메일 — 승인 요청(처리 기한이 있다)과 긴급(CRITICAL) */
export const EMAIL_LOCKED: NotificationCategory[] = ['APPROVAL', 'SAFETY'];
export const DEFAULT_EMAIL: Record<NotificationCategory, boolean> = { APPROVAL: true, SAFETY: true, DEPLOY: false, GATE: false, OPS: true, INTEGRATION: false };

export const NotificationPrefsBody = z.object({ email: z.record(NotificationCategory, z.boolean()) }).strict();
export type NotificationPrefsBody = z.infer<typeof NotificationPrefsBody>;
export const NotificationReadAllBody = z.object({ category: NotificationCategory.optional() }).strict();
export type NotificationReadAllBody = z.infer<typeof NotificationReadAllBody>;

export function emailEnabled(n: Pick<NotificationDraft, 'category' | 'severity'>, prefs: Partial<Record<NotificationCategory, boolean>> | null): boolean {
  if (n.severity === 'CRITICAL' || EMAIL_LOCKED.includes(n.category)) return true;
  return prefs?.[n.category] ?? DEFAULT_EMAIL[n.category];
}
