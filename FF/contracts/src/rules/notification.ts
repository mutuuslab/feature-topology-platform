// 수신자 지정 알림 (D04-04 이벤트 이력 추적) — 기능명세서 공통 요구 "관련 담당자에게 Web 알림 또는 이메일(하나 이상)".
// 커밋되는 플랫폼 이벤트마다 아래 규칙표가 알림 하나(내용·수신자·링크)를 만든다. 순수 함수 — 백엔드가 이벤트와 같은 트랜잭션에서
// 부르고(알림만 남고 변경이 롤백되는 일이 없다), 화면은 같은 범주·심각도 표기를 쓴다.
// 수신자: 개인(요청자·작성자·배포자), 역할(승인 대상자·운영 담당자, 본인·직무 분리 제외 계정 빼고), 팀(Feature Owner = ownerId 팀).
// 채널: 화면(Web) 알림만 — 사용자 결정 D-RD-7(2026-10-24, 메일 채널 없음). 끄는 설정이 없어 승인 요청·긴급(CRITICAL)을 포함한
// 모든 알림이 받는 사람의 알림 목록에 항상 남는다(읽음·안 읽음은 계정별).
import { z } from 'zod';
import { HUMAN_ROLES, KILL_APPROVER_ROLES } from './access';
import { DEMO_PERSONAS } from './duty-separation';
import type { Role } from '../enums';
import { isAppPath, isRecipient, NOTIFICATION_SENT_EVENT, NotificationCategory, type NotificationSeverity } from './notification-keys';

// 범주·심각도는 notification-keys.ts — 상단바 종(첫 화면)이 이 규칙표 없이 읽는다

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
  /** Feature DB 변경 요청(이벤트 payload에 요청자가 없는 검토 의견 알림용) */
  refChange?: { changeId: string; refId: string; kind: string; requestedBy: string; reason: string } | null;
}

export interface NotificationRule {
  /** 맥락에 필요한 기록 */
  needs: ('feature' | 'policy' | 'kill' | 'refChange')[];
  /** 알림을 만들지 않으면 null (예: 검증 GO가 아닌 NO-GO만 차단 알림) */
  build: (ctx: NotificationContext) => NotificationDraft | null;
}

const owner = (ctx: NotificationContext): Recipient[] => (ctx.feature?.ownerId ? [{ kind: 'team', team: ctx.feature.ownerId }] : []);
const featureLabel = (ctx: NotificationContext, featureId: string) => (ctx.feature && ctx.feature.featureId === featureId ? `${featureId} ${ctx.feature.name}` : featureId);
const scopeOf = (k: NonNullable<NotificationContext['kill']>) => `차량 ${k.vins.length}대 · flag ${k.flagKeys.join(', ') || '-'}${k.featureIds.length > 1 ? ` · 의존 Feature ${k.featureIds.filter((f) => f !== k.featureId).join(', ')}` : ''}`;
const reasonOf = (k: NonNullable<NotificationContext['kill']>) => [k.reasonCategory && k.reasonCode ? `${k.reasonCategory}/${k.reasonCode}` : null, k.reason].filter(Boolean).join(' — ');
const roles = (rs: readonly Role[]): Recipient[] => rs.map((role) => ({ kind: 'role', role }));
/** 이벤트 payload의 플랫폼 역할 문자열 → 수신자(모르는 역할은 버린다 — 절차 모델의 org 역할을 서버가 플랫폼 역할로 풀어 넘긴다) */
const roleNames = (rs: unknown): Recipient[] =>
  (Array.isArray(rs) ? rs : [])
    .filter((r): r is Role => typeof r === 'string' && (HUMAN_ROLES as readonly string[]).includes(r))
    .map((role) => ({ kind: 'role', role }));

/** Feature DB 알림 이벤트 — 출처 정기 점검 기한 지남 · 추가 요청 반려(요청 중 행 폐기) */
export const REFDB_REVIEW_DUE_EVENT = 'refdb.source.review-due';
export const REFDB_REF_REJECTED_EVENT = 'refdb.ref.rejected';

/**
 * 이벤트 종류 → 알림 규칙. 없는 이벤트는 알림을 만들지 않는다(이벤트 이력에만 남는다).
 * @req FR-REG-005-014, FR-CRC-002-009, FR-DSV-001-011, FR-KSW-003-003, FR-KSW-004-005, FR-EVT-003-003, FR-DSYN-001-004, FR-RBK-001-007, FR-RBK-004-005, FR-RBK-005-003, FR-RBK-005-004
 * @req FR-CON-001-003, FR-QGV-003-005, FR-DSV-003-005, FR-CICD-001-006, FR-LGCY-001-008, FR-BIL-001-004
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
        // F2 이상 안전·보안 차단은 FSM + CSM만 칸을 채운다(2026-11-04 결정) — 승인할 수 없는 역할에게 '내 차례'를 보내지 않는다(P4-1)
        recipients: roles(ctx.event.payload.fsmRequired ? ['SAFETY_OFFICER', 'SECURITY_OFFICER'] : KILL_APPROVER_ROLES),
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
        // 감사(AUDITOR) — 긴급 권한 사용은 24시간 안에 사후 독립 검토(FFG-PLT-016, SOD-11)
        recipients: [...owner(ctx), ...roles(['OPERATOR', 'OPS_LEAD', 'AUDITOR'])],
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
          // 재검증 Evidence·이번 단계 Cohort(FPW.8-A08), 지금 승인할 수 있는 사람(P4-1) — 이전 이벤트에는 없다
          ...(ctx.event.payload.evidenceRef ? [{ label: '재검증 Evidence', value: String(ctx.event.payload.evidenceRef) }] : []),
          ...(Array.isArray(ctx.event.payload.candidates) ? [{ label: '승인 가능', value: (ctx.event.payload.candidates as string[]).join(', ') || '없음 — 상위 대응 필요' }] : []),
        ],
        link: `/ops/kill?id=${k.killId}`,
        recipients: roles(KILL_APPROVER_ROLES),
        // 직전 차단 승인자(이 차단과 원장의 마지막 차단)는 복원을 승인할 수 없다(SOD-09) — 승인 대상자가 아니므로 받지 않는다
        exclude: [rr.requestedBy, ...(k.approvals ?? []).map((a) => a.approverId), ...(Array.isArray(ctx.event.payload.excluded) ? (ctx.event.payload.excluded as string[]) : [])],
        requirementIds: ['FR-KSW-004-005'],
      };
    },
  },
  // 롤백(D03-04) — 승인 요청은 지정 승인대상자에게(요청자 제외), 결과는 요청자·승인자·배포 요청자·Feature Owner에게
  'rollback.plan.requested': { needs: ['feature'], build: (ctx) => rollbackApproval(ctx, 'plan') },
  'rollback.requested': { needs: ['feature'], build: (ctx) => rollbackApproval(ctx, 'manual') },
  'rollback.completed': { needs: ['feature'], build: (ctx) => rollbackResult(ctx, true) },
  'rollback.failed': { needs: ['feature'], build: (ctx) => rollbackResult(ctx, false) },
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
  // 업무 절차(docs/65-workflows) — 활동 완료가 다음 활동의 수행(R)·책임(A) 역할에 인계되고, 기한 초과는 담당 역할에 경고한다.
  // 수신자 역할은 서버(ProcedureService)가 절차 모델의 org 역할을 플랫폼 역할로 풀어 payload에 싣는다(맥락 조회 불필요).
  'procedure.activity.completed': {
    needs: [],
    build: (ctx) => {
      const p = ctx.event.payload;
      const next: { id: string; name: string; platformRoles?: string[] }[] = Array.isArray(p.next) ? p.next : [];
      const recipients = roleNames([...new Set(next.flatMap((n) => n.platformRoles ?? []))]);
      if (!next.length || !recipients.length) return null;
      return {
        category: 'PROCEDURE',
        severity: 'INFO',
        title: `이어서 할 일 — ${p.activityName} 완료`,
        fields: [
          { label: '완료 활동', value: `${p.activityId} ${p.activityName}` },
          { label: '다음 활동', value: next.map((n) => `${n.id} ${n.name}`).join(', ') },
          { label: '담당 역할', value: String(p.nextRoleNames ?? '-') },
          { label: '완료자', value: String(p.by ?? '-') },
        ],
        link: `/procedures/${p.processId}?a=${next[0].id}`,
        recipients,
        exclude: [String(p.by ?? '')].filter(Boolean),
        requirementIds: [],
      };
    },
  },
  'procedure.activity.overdue': {
    needs: [],
    build: (ctx) => {
      const p = ctx.event.payload;
      const recipients = roleNames([...new Set((p.platformRoles as string[]) ?? [])]);
      if (!recipients.length) return null;
      return {
        category: 'PROCEDURE',
        severity: 'WARNING',
        title: `기한 초과 — ${p.activityId} ${p.activityName}`,
        fields: [
          { label: '활동', value: `${p.activityId} ${p.activityName}` },
          { label: '절차', value: `${p.processId} ${p.processName}` },
          { label: '책임 역할', value: String(p.roleNames ?? '-') },
          { label: '기한', value: String(p.dueAt ?? '-') },
        ],
        link: `/procedures/${p.processId}?a=${p.activityId}`,
        recipients,
        exclude: [],
        requirementIds: [],
      };
    },
  },
  // Feature DB(30-95 §8.5) — 출처 다음 점검일이 지남 → Feature DB 관리자 역할
  [REFDB_REVIEW_DUE_EVENT]: {
    needs: [],
    build: (ctx) => {
      const p = ctx.event.payload;
      return {
        category: 'PROCEDURE',
        severity: 'WARNING',
        title: `출처 정기 점검 기한 지남 — ${p.sourceId} ${p.title ?? ''}`.trim(),
        fields: [
          { label: '출처', value: `${p.sourceId} ${p.title ?? ''}`.trim() },
          { label: '발행처', value: String(p.publisher || '-') },
          { label: '다음 점검일', value: String(p.nextReviewAt) },
          { label: '최종 확인일', value: String(p.checkedAt ?? '-') },
        ],
        link: `/master/feature-db?tab=sources&source=${p.sourceId}`,
        recipients: roles(['REFDB_ADMIN']),
        exclude: [],
        requirementIds: [],
      };
    },
  },
  // Feature DB(30-95 §6.4) — 추가 요청 반려로 요청 중 행이 폐기됨 → 그 행을 연결한 Feature의 Owner 팀(다른 행으로 다시 연결해야 승인 가능)
  [REFDB_REF_REJECTED_EVENT]: {
    needs: ['feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const f = ctx.feature;
      if (!f?.ownerId) return null;
      return {
        category: 'APPROVAL',
        severity: 'WARNING',
        title: `기준 기능 추가 요청 반려 — ${p.refId} (다른 기준 행으로 다시 연결)`,
        fields: [
          { label: 'Feature', value: `${f.featureId} ${f.name} ${f.version}` },
          { label: '기준 행', value: `${p.refId} ${p.nameKo ?? ''}`.trim() },
          { label: '변경 요청', value: String(p.changeId) },
          { label: '반려 사유', value: String(p.reason ?? '-') },
          { label: '발행', value: String(p.release ?? '-') },
        ],
        link: `/features/${f.featureId}/${f.version}`,
        recipients: owner(ctx),
        exclude: [String(p.by ?? '')].filter(Boolean),
        requirementIds: [],
      };
    },
  },
  // ── 담당자 웨이브 W2(P2-7·P1-4): 다음 담당자에게 차례를 알린다 ──
  // Baseline 확정 요청 → BOM 승인자(요청자 본인 제외)
  'baseline.requested': {
    needs: ['feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      return {
        category: 'APPROVAL',
        severity: 'INFO',
        title: `Baseline 확정 요청 — ${p.featureId} ${p.version}`,
        fields: [
          { label: 'Feature', value: `${featureLabel(ctx, String(p.featureId))} ${p.version}` },
          { label: '요청', value: String(p.requestId) },
          { label: '요청자', value: String(p.by ?? '-') },
          { label: '요청 일시', value: ctx.event.at },
        ],
        link: `/baselines?request=${p.requestId}`,
        recipients: roles(['BOM_APPROVER']),
        exclude: [String(p.by ?? '')].filter(Boolean),
        requirementIds: [],
      };
    },
  },
  // Feature DB 변경 요청 작성 → 도메인 검토자(의견)·Feature DB 관리자(승인), 요청자 본인 제외(SOD-13·14)
  'refdb.change.created': {
    needs: [],
    build: (ctx) => {
      const p = ctx.event.payload;
      return {
        category: 'APPROVAL',
        severity: 'INFO',
        title: `Feature DB 변경 요청 — ${p.changeId} ${REF_KIND_KO[String(p.kind)] ?? p.kind} ${p.refId}`,
        fields: [
          { label: '변경 요청', value: String(p.changeId) },
          { label: '종류', value: REF_KIND_KO[String(p.kind)] ?? String(p.kind) },
          { label: '기준 행', value: String(p.refId) },
          { label: '요청자', value: String(p.by ?? '-') },
        ],
        link: `/master/feature-db/changes/${p.changeId}`,
        recipients: roles(['DOMAIN_REVIEWER', 'REFDB_ADMIN']),
        exclude: [String(p.by ?? '')].filter(Boolean),
        requirementIds: [],
      };
    },
  },
  // 도메인 검토 의견 — 보완·반대는 요청자에게(고쳐서 다시), 동의는 Feature DB 관리자에게(승인 차례). 의견 낸 본인 제외(SOD-15)
  'refdb.change.reviewed': {
    needs: ['refChange'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const c = ctx.refChange;
      const agree = p.opinion === 'AGREE';
      if (!agree && !c?.requestedBy) return null;
      return {
        category: 'APPROVAL',
        severity: agree ? 'INFO' : 'WARNING',
        title: agree ? `Feature DB 변경 요청 동의 — ${p.changeId} 승인 차례` : `Feature DB 변경 요청 ${REF_OPINION_KO[String(p.opinion)] ?? p.opinion} 의견 — ${p.changeId} 보완 필요`,
        fields: [
          { label: '변경 요청', value: `${p.changeId}${c ? ` · ${REF_KIND_KO[c.kind] ?? c.kind}` : ''}` },
          { label: '기준 행', value: String(p.refId) },
          { label: '의견', value: REF_OPINION_KO[String(p.opinion)] ?? String(p.opinion) },
          { label: '검토자', value: String(p.by ?? '-') },
        ],
        link: `/master/feature-db/changes/${p.changeId}`,
        recipients: agree ? roles(['REFDB_ADMIN']) : [{ kind: 'user', id: c!.requestedBy }],
        exclude: [String(p.by ?? ''), ...(agree && c?.requestedBy ? [c.requestedBy] : [])].filter(Boolean),
        requirementIds: [],
      };
    },
  },
  // Release Sign-off → 출시 담당(출시 전이 차례)·Feature Owner 팀·상품 Owner(고객 출시 준비)·감사(서명 기록), 서명한 본인 제외
  'release.signed': {
    needs: ['feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const fid = String(p.featureId);
      return {
        category: 'APPROVAL',
        severity: 'INFO',
        title: `Release Sign-off 완료 — ${fid} ${p.version} 출시 차례`,
        fields: [
          { label: 'Feature', value: `${featureLabel(ctx, fid)} ${p.version}` },
          { label: '서명자', value: String(p.signedBy ?? '-') },
          { label: '서명 일시', value: ctx.event.at },
          { label: '다음', value: '출시 담당이 출시(RELEASED) 전이' },
        ],
        link: `/features/${fid}/${p.version}`,
        recipients: [...(p.ownerId || ctx.feature?.ownerId ? [{ kind: 'team', team: String(p.ownerId ?? ctx.feature?.ownerId) } as Recipient] : []), ...roles(['RELEASE_MANAGER', 'PRODUCT_APPROVER', 'AUDITOR'])],
        exclude: [String(p.signedBy ?? '')].filter(Boolean),
        requirementIds: [],
      };
    },
  },
  // ── 담당자 웨이브 W1(P4-1·P4-6): 관제 ──
  // 복원 막힘 — 차단 승인자를 빼면 복원 2인 승인을 끝낼 수 없다(예: FSM 없음) → 운영 리더·Safety Manager에게 상위 대응 요청
  'kill.restore-blocked': {
    needs: ['feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const missing = (Array.isArray(p.missing) ? p.missing : []).map((r: string) => APPROVER_ROLE_KO[r] ?? r).join(', ') || '승인자 2인';
      return {
        category: 'SAFETY',
        severity: 'WARNING',
        title: `복원 승인자 부족 — ${p.killId} ${featureLabel(ctx, String(p.featureId))}`,
        fields: [
          { label: '차단', value: String(p.killId) },
          { label: '없는 승인', value: missing },
          { label: '복원 승인에서 빠지는 사람', value: (Array.isArray(p.excluded) ? p.excluded : []).join(', ') || '-' },
          { label: '상위 대응', value: '기능안전 조직장이 이 차단을 승인하지 않은 Safety Manager를 지정(IAM 역할 부여)하고 복원 승인을 맡긴다' },
        ],
        link: `/ops/kill?id=${p.killId}`,
        recipients: roles(['OPS_LEAD', 'SAFETY_OFFICER']),
        exclude: [],
        requirementIds: [],
      };
    },
  },
  // 서명 키 교체 → 품질(Gate·Safety Manager)·운영 담당 — 새 키로 서명되는 게시본과 검증 전용이 된 이전 키를 알린다. 교체한 본인 제외
  'pki.key.rotated': {
    needs: [],
    build: (ctx) => {
      const p = ctx.event.payload;
      const purpose = KEY_PURPOSE_KO[String(p.purpose)] ?? String(p.purpose);
      return {
        category: 'DEPLOY',
        severity: 'INFO',
        title: `서명 키 교체 — ${purpose} 키 ${p.keyId}`,
        fields: [
          { label: '용도', value: purpose },
          { label: '새 키', value: String(p.keyId) },
          { label: '이전 키', value: p.retired ? `${p.retired} (검증 전용 — 이미 배포한 게시본은 계속 검증)` : '-' },
          { label: '교체자', value: String(p.by ?? '-') },
          { label: '사유', value: String(p.reason ?? '-') },
        ],
        link: '/admin/security',
        recipients: roles(['GATE_JUDGE', 'SAFETY_OFFICER', 'OPERATOR']),
        exclude: [String(p.by ?? '')].filter(Boolean),
        requirementIds: [],
      };
    },
  },
  // ─── 수신자 지정 알림 보강(기능명세서 B1) — 충돌·품질 Gate·배포 중단·파이프라인·연계·과금·서명 실패, 직접 보낸 알림 ───
  // 정책 충돌 탐지 → 정책 Owner 팀·관리자(정책 승인 역할)·작성자. 충돌 내용은 검증기(D06-01)의 충돌 발견 그대로
  'policy.conflict.detected': {
    needs: ['policy', 'feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const pol = ctx.policy;
      if (!pol) return null;
      const items = (Array.isArray(p.conflicts) ? p.conflicts : []).map(String);
      return {
        category: 'DEPLOY',
        severity: 'WARNING',
        title: `정책 충돌 탐지 — ${pol.policyId} (${pol.flagKey})`,
        fields: [
          { label: '정책', value: `${pol.policyId} · ${pol.flagKey}` },
          { label: 'Feature', value: `${featureLabel(ctx, pol.featureId)} ${pol.featureVersion}` },
          { label: '충돌 내용', value: items.join(' / ') || '-' },
          { label: '탐지 시점', value: ctx.event.at },
          { label: '검증 실행', value: String(p.runId ?? '-') },
        ],
        link: `/policies/${pol.policyId}`,
        recipients: [...owner(ctx), ...roles(['FEATURE_APPROVER']), { kind: 'user', id: pol.createdBy }],
        exclude: [],
        requirementIds: ['FR-CON-001-003'],
      };
    },
  },
  // 품질 Gate(D04-02) 실패 → 산출물(정책 개정본) 담당: Owner 팀·Gate 판정 역할·작성자
  'quality.gate.failed': {
    needs: ['policy', 'feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const pol = ctx.policy;
      if (!pol) return null;
      return {
        category: 'GATE',
        severity: 'WARNING',
        title: `품질 Gate 실패 — ${pol.policyId} r${p.revision ?? '-'}`,
        fields: [
          { label: '산출물', value: `정책 ${pol.policyId} r${p.revision ?? '-'} · 내용 해시 ${String(p.contentHash ?? '').slice(0, 12) || '-'}` },
          { label: 'Feature', value: `${featureLabel(ctx, pol.featureId)} ${pol.featureVersion}` },
          { label: '실패 항목', value: `품질 기준 검증 ${p.result ?? 'FAIL'}` },
          { label: '실패 사유', value: (Array.isArray(p.reasons) ? p.reasons : []).map(String).join(' / ') || '-' },
        ],
        link: `/policies/${pol.policyId}`,
        recipients: [...owner(ctx), ...roles(['GATE_JUDGE']), { kind: 'user', id: pol.createdBy }],
        exclude: [],
        requirementIds: ['FR-QGV-003-005'],
      };
    },
  },
  // 단계 확대 판정이 중단 기준(열린 이상 징후·진행 중 차단·관측 기간)에 걸림 → Owner 팀·배포 요청자(배포자)·확대 요청자
  'rollout.halt-required': {
    needs: ['policy', 'feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      const pol = ctx.policy;
      if (!pol) return null;
      const people = [pol.deployedBy, typeof p.requestedBy === 'string' ? p.requestedBy : null].filter((x): x is string => !!x);
      return {
        category: 'DEPLOY',
        severity: 'CRITICAL',
        title: `배포 중단 필요 — ${pol.policyId} (${pol.flagKey})`,
        fields: [
          { label: '배포', value: `${pol.policyId} · ${pol.flagKey} · 현재 ${Number(p.current ?? 0) / 100}%` },
          { label: 'Feature', value: `${featureLabel(ctx, pol.featureId)} ${pol.featureVersion}` },
          { label: '중단 사유', value: (Array.isArray(p.reasons) ? p.reasons : []).map(String).join(' / ') || '-' },
          { label: '요청한 확대', value: `${Number(p.current ?? 0) / 100}% → ${Number(p.to ?? 0) / 100}%` },
          { label: '판정 시점', value: ctx.event.at },
        ],
        link: `/policies/${pol.policyId}`,
        recipients: [...owner(ctx), ...[...new Set(people)].map((id) => ({ kind: 'user', id }) as Recipient)],
        exclude: [],
        requirementIds: ['FR-DSV-003-005'],
      };
    },
  },
  // CI/CD 파이프라인 실행 실패(IF-13 실행 결과 수신) → 구현·출시 담당, Feature가 있으면 Owner 팀
  'pipeline.run.failed': {
    needs: ['feature'],
    build: (ctx) => {
      const p = ctx.event.payload;
      return {
        category: 'INTEGRATION',
        severity: 'WARNING',
        title: `파이프라인 실패 — ${p.runId} (${p.stage})`,
        fields: [
          { label: '실행', value: `${p.runId} · ${p.pipeline ?? '-'}${p.environment ? ` · ${p.environment}` : ''}` },
          { label: '실패 단계', value: String(p.stage ?? '-') },
          { label: '실패 사유', value: String(p.reason ?? '-') },
          ...(p.featureId ? [{ label: 'Feature', value: featureLabel(ctx, String(p.featureId)) }] : []),
          { label: '발생 시점', value: String(p.finishedAt ?? ctx.event.at) },
        ],
        link: '/integration/connectors?tab=errors',
        recipients: [...owner(ctx), ...roles(['IMPLEMENTER', 'RELEASE_MANAGER'])],
        exclude: [],
        requirementIds: ['FR-CICD-001-006'],
      };
    },
  },
  // Legacy 연계(IF-12 해외공장 ERP) 오류 → 연계 담당·운영
  'legacy.import.failed': {
    needs: [],
    build: (ctx) => integrationError(ctx, 'Legacy 연계 오류', roles(['IMPLEMENTER', 'OPERATOR']), ['FR-LGCY-001-008']),
  },
  // 과금 시스템 연계 오류 → 상품 권리(상품 작성) 담당·운영
  'billing.call.failed': {
    needs: [],
    build: (ctx) => integrationError(ctx, '과금 시스템 연계 오류', roles(['PRODUCT_AUTHOR', 'OPERATOR']), ['FR-BIL-001-004']),
  },
  // 정책 서명 실패(배포 거부) → 사이버보안 담당·배포 시도한 사람
  'signing.failed': {
    needs: [],
    build: (ctx) => {
      const p = ctx.event.payload;
      return integrationError(ctx, '정책 서명 실패', [...roles(['SECURITY_OFFICER']), ...(p.actorId ? [{ kind: 'user', id: String(p.actorId) } as Recipient] : [])], []);
    },
  },
  // 직접 보낸 알림 — 보낸 사람이 고른 사람·역할·팀(본인 제외)
  [NOTIFICATION_SENT_EVENT]: {
    needs: [],
    build: (ctx) => {
      const p = ctx.event.payload;
      const recipients = (Array.isArray(p.recipients) ? p.recipients : []).filter(isRecipient);
      if (!recipients.length) return null;
      return {
        category: 'DIRECT',
        severity: p.severity === 'CRITICAL' || p.severity === 'WARNING' ? p.severity : 'INFO',
        title: String(p.title ?? '알림'),
        fields: [
          { label: '내용', value: String(p.message ?? '-') },
          { label: '보낸 사람', value: String(p.sentBy ?? '-') },
        ],
        link: isAppPath(p.link) ? p.link : '/notifications',
        recipients,
        exclude: [String(p.sentBy ?? '')].filter(Boolean),
        requirementIds: [],
      };
    },
  },
};

/** 보고서 승인 역할 → 업무 이름(알림 문구) */
const APPROVER_ROLE_KO: Record<string, string> = { FSM: '기능안전(Safety Manager)', CSM: '사이버보안', OPS_LEAD: '운영 리더', PRODUCT_OWNER: '상품 Owner', QA: '품질', REGULATORY: '법규' };
/** 서명 키 용도 → 업무 이름 */
export const KEY_PURPOSE_KO: Record<string, string> = { policy: '정책 배포', activate: '기능 활성화', kill: '긴급 차단', restore: '복원', sync: '상태 동기화', gate: '정책 게이트 판정', export: '감사·이력 내보내기' };

const REF_KIND_KO: Record<string, string> = { ADD: '추가', MODIFY: '수정', DEPRECATE: '폐기 예정', RETIRE: '폐기' };
const REF_OPINION_KO: Record<string, string> = { AGREE: '동의', REVISE: '보완', OPPOSE: '반대' };

/** 롤백 승인 요청 — 이벤트가 알림에 필요한 값을 모두 싣는다(Plan·수동 요청 기록을 다시 읽지 않는다) */
function rollbackApproval(ctx: NotificationContext, kind: 'plan' | 'manual'): NotificationDraft {
  const p = ctx.event.payload;
  const plan = kind === 'plan';
  return {
    category: 'APPROVAL',
    severity: 'WARNING',
    title: `${plan ? 'Rollback Plan' : '수동 롤백'} 승인 요청 — ${featureLabel(ctx, String(p.featureId))}`,
    fields: [
      { label: plan ? 'Rollback Plan ID' : '수동 롤백 요청 ID', value: String(plan ? p.planId : p.requestId) },
      { label: '배포 ID', value: String(p.deploymentId) },
      { label: 'Feature', value: featureLabel(ctx, String(p.featureId)) },
      { label: '배포 버전', value: String(p.deployedVersion) },
      { label: '롤백 대상 유형', value: String(p.targetTypes) },
      ...(plan ? [{ label: '롤백 조건', value: String(p.conditions) }] : []),
      { label: '복구 기준 버전', value: String(p.recoveryVersion) },
      { label: '적용 대상 범위', value: String(p.scope) },
      ...(plan ? [] : [{ label: '복구 사유', value: String(p.reason) }]),
      { label: '요청자', value: String(p.requestedBy) },
      { label: '요청 일시', value: String(p.requestedAt) },
    ],
    link: `/ops/rollback?${plan ? 'plan' : 'request'}=${plan ? p.planId : p.requestId}`,
    recipients: (p.approvers as string[]).map((id) => ({ kind: 'user', id }) as Recipient),
    exclude: [String(p.requestedBy)],
    requirementIds: [plan ? 'FR-RBK-001-007' : 'FR-RBK-004-005'],
  };
}

/** 롤백 완료·실패 — 관련 담당자: 요청자·승인자·배포 요청자·Feature Owner */
function rollbackResult(ctx: NotificationContext, ok: boolean): NotificationDraft {
  const p = ctx.event.payload;
  const people = [p.requestedBy, p.approvedBy, p.deploymentRequestedBy].filter((x): x is string => !!x && x !== 'system');
  return {
    category: 'DEPLOY',
    severity: ok ? 'INFO' : 'CRITICAL',
    title: `롤백 ${ok ? '완료' : '실패'} — ${featureLabel(ctx, String(p.featureId))} → ${p.recoveryVersion}`,
    fields: [
      { label: '배포 ID', value: String(p.deploymentId) },
      { label: 'Feature', value: featureLabel(ctx, String(p.featureId)) },
      { label: '롤백 대상 유형', value: String(p.targetTypes) },
      { label: '복구 기준 버전', value: String(p.recoveryVersion) },
      ...(ok
        ? [
            { label: '롤백 후 상태', value: String(p.afterState) },
            { label: '롤백 결과', value: '성공' },
          ]
        : [
            { label: '실패 사유', value: String(p.failureReason) },
            { label: '실패 발생 시점', value: String(p.failedAt) },
          ]),
    ],
    link: `/ops/rollback?execution=${p.executionId}`,
    recipients: [...new Set(people)].map((id) => ({ kind: 'user', id }) as Recipient).concat(owner(ctx), roles(['RELEASE_MANAGER'])),
    exclude: [],
    requirementIds: [ok ? 'FR-RBK-005-003' : 'FR-RBK-005-004'],
  };
}

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

/** 연계·과금·서명 오류 알림 공통 — 오류 이력(D04-04 오류 이력) 한 건의 유형·시점·대상·내용 */
function integrationError(ctx: NotificationContext, what: string, recipients: Recipient[], requirementIds: string[]): NotificationDraft {
  const p = ctx.event.payload;
  return {
    category: 'INTEGRATION',
    severity: 'WARNING',
    title: `${what} — ${p.systemName ?? p.system} (${p.errorType})`,
    fields: [
      { label: '오류 유형', value: String(p.errorType ?? '-') },
      { label: '발생 시점', value: String(p.at ?? ctx.event.at) },
      { label: '대상 시스템', value: `${p.systemName ?? p.system}${p.target ? ` · ${p.target}` : ''}` },
      { label: '오류 내용', value: String(p.message ?? '-') },
    ],
    link: `/integration/connectors?tab=errors`,
    recipients,
    exclude: [],
    requirementIds,
  };
}

// ─── 수신 계정 ───────────────────────────────────────────────

export interface NotificationAccount {
  id: string;
  roles: Role[];
  /** Feature Owner 팀 — '*'는 모든 Owner 팀(데모: Feature 설계 계정이 기획팀을 대신 받는다) */
  teams: string[] | '*';
}

/** 데모 IAM 계정(usr-<persona>) — 역할은 DEMO_PERSONAS와 같다. 실제 배치는 전사 IAM 디렉터리·조직도에서 읽는다 */
export const NOTIFICATION_ACCOUNTS: NotificationAccount[] = Object.entries(DEMO_PERSONAS).map(([key, rs]) => ({
  id: `usr-${key}`,
  roles: [...rs],
  teams: key === 'author' ? '*' : [],
}));

export const accountOf = (id: string, fallbackRole?: Role): NotificationAccount =>
  NOTIFICATION_ACCOUNTS.find((a) => a.id === id) ?? { id, roles: fallbackRole ? [fallbackRole] : [], teams: [] };

/** 이 계정이 알림을 받는가 — 제외 계정이면 역할이 맞아도 받지 않는다 */
export function receives(n: Pick<NotificationDraft, 'recipients' | 'exclude'>, a: Pick<NotificationAccount, 'id' | 'roles' | 'teams'>): boolean {
  if (n.exclude.includes(a.id)) return false;
  return n.recipients.some((r) => (r.kind === 'user' ? r.id === a.id : r.kind === 'role' ? a.roles.includes(r.role) : a.teams === '*' || a.teams.includes(r.team)));
}

/** 수신자 저장 키 — 'user:usr-author' · 'role:OPERATOR' · 'team:ADAS기획팀' */
export const recipientKey = (r: Recipient) => (r.kind === 'user' ? `user:${r.id}` : r.kind === 'role' ? `role:${r.role}` : `team:${r.team}`);

/** 계정이 볼 수신자 키(팀 '*'는 'team:*'로 표기 — 저장소가 모든 팀으로 해석) */
export const accountKeys = (a: Pick<NotificationAccount, 'id' | 'roles' | 'teams'>) => [`user:${a.id}`, ...a.roles.map((r) => `role:${r}`), ...(a.teams === '*' ? ['team:*'] : a.teams.map((t) => `team:${t}`))];

// ─── 읽음 처리 ───────────────────────────────────────────────

export const NotificationReadAllBody = z.object({ category: NotificationCategory.optional() }).strict();
export type NotificationReadAllBody = z.infer<typeof NotificationReadAllBody>;

