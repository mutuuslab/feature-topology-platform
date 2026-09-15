// UI19 Feature 제안 — 상류 후보 접수·단계 관리 모델.
//
// Feature Registry(UI02)가 **Feature ID·정확 버전이 발급된 정본**을 다루는 것과 달리,
// 제안은 아직 Feature 가 아닌 후보를 받아 검토·협의하고 담당 조직으로 넘긴다.
// 그래서 여기서는 Feature Lifecycle(Proposed/Approved/…)을 쓰지 않는다 — 제안 단계는 따로 있다.
//
// 5단계(초안·접수·검토·결정·이관)와 3개 경로(Feature 전환·보류·반려)를 구분한다.
// **개발 이관은 투자·개발 착수 승인이 아니다** — 이관은 접수(ACK)로만 확인하고, 착수 판단은 별도 절차다.
import { BOM_CONDITION_PROFILES } from './featureBom';

export const PROPOSAL_STAGES = ['DRAFT', 'RECEIVED', 'REVIEWING', 'DECISION', 'HANDOFF'] as const;
export type ProposalStage = (typeof PROPOSAL_STAGES)[number];
export const PROPOSAL_STATES = [...PROPOSAL_STAGES, 'REJECTED'] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export const STAGE_KO: Record<ProposalState, string> = {
  DRAFT: '초안',
  RECEIVED: '접수',
  REVIEWING: '검토',
  DECISION: '결정',
  HANDOFF: '이관',
  REJECTED: '반려',
};
export const STAGE_EN: Record<ProposalState, string> = {
  DRAFT: 'Draft',
  RECEIVED: 'Received',
  REVIEWING: 'Reviewing',
  DECISION: 'Decision',
  HANDOFF: 'Handoff',
  REJECTED: 'Rejected',
};
export const STAGE_TONE: Record<ProposalState, string> = {
  DRAFT: 'var(--muted, #8a8f98)',
  RECEIVED: 'var(--pending, #b8860b)',
  REVIEWING: 'var(--pending, #b8860b)',
  DECISION: 'var(--accent, #2b6cb0)',
  HANDOFF: 'var(--pass, #2f855a)',
  REJECTED: 'var(--fail, #c53030)',
};

export const PROPOSAL_KINDS = ['NEW', 'CHANGE'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const KIND_KO: Record<ProposalKind, string> = { NEW: '신규', CHANGE: '변경' };

// 작성 양식 — 정본 제안 양식 4종
export const FORM_TYPES = ['STANDARD', 'CHANGE', 'FOD', 'SERVICE'] as const;
export type FormType = (typeof FORM_TYPES)[number];
export const FORM_KO: Record<FormType, string> = {
  STANDARD: '표준 제안서',
  CHANGE: '변경 제안서',
  FOD: 'FOD(기능 정의서)',
  SERVICE: '서비스 제안서',
};

/** 3개 경로 — 결정(DECISION)에서만 갈라진다. */
export type DecisionRoute = 'FEATURE' | 'HOLD' | 'REJECT';
export const DECISION_ROUTES: { key: DecisionRoute; ko: string; en: string; to: ProposalState; note: string }[] = [
  { key: 'FEATURE', ko: 'Feature 전환', en: 'Convert to Feature', to: 'HANDOFF', note: 'Feature ID 를 발급해 정본 등록(UI02)으로 넘긴다. 착수 승인이 아니다.' },
  { key: 'HOLD', ko: '보류', en: 'Hold', to: 'DECISION', note: '결정 단계에 남긴다. 사유가 있어야 하고 정체 기한을 표시한다.' },
  { key: 'REJECT', ko: '반려', en: 'Reject', to: 'REJECTED', note: '후보 등록을 닫는다. 반려 사유가 필요하다.' },
];

/** 제안 ID 는 전역 유일 — 기존 최대 순번 + 1. */
export function nextProposalId(rows: { id: string }[], year = 2026): string {
  const used = rows.map(r => Number(/(\d{4})$/.exec(r.id)?.[1] || 0));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return `PRP-${year}-${String(n).padStart(4, '0')}`;
}

export interface ProfileDecision { profile: string; decision: 'INCLUDE' | 'EXCLUDE' | 'UNDECIDED'; reason: string }
export const PROFILE_DECISION_KO: Record<ProfileDecision['decision'], string> = {
  INCLUDE: '포함', EXCLUDE: '제외', UNDECIDED: '미정',
};

export function initialProfileDecisions(profileIds: string[] = BOM_CONDITION_PROFILES.map(p => p.id)): ProfileDecision[] {
  return profileIds.map(id => ({ profile: id, decision: 'UNDECIDED', reason: '' }));
}

/** 협의·이관 접수 상태 — 같은 correlation/command ID 로 접수·처리·결과를 연결한다. */
export interface HandoffAck {
  correlationId: string;
  commandId: string;
  requestedAt: string;
  state: 'REQUESTED' | 'ACKED' | 'FAILED';
  ackAt?: string;
  receiver: string;
  note?: string;
}

export interface ProposalHistory { ts: string; actor: string; from: ProposalState; to: ProposalState; note: string }

export interface Proposal {
  id: string;
  title: string;
  kind: ProposalKind;
  form: FormType;
  /** 분류 — 정본 목록 컬럼 */
  category: string;
  stage: ProposalState;
  /** 검토·이관 대상 조직 */
  org: string;
  due: string;
  owner: string;
  /** 고객 가치 */
  value: string;
  /** 정량 근거 — 비어 있으면 접수 불가 */
  quantitative: string;
  /** 기술 타당성 또는 협의 근거 */
  technical: string;
  salesTalk: 'YES' | 'NO';
  techReview: 'YES' | 'NO';
  /** 기술 검토자 (검토 단계 진입 시 필수) */
  reviewer?: string;
  /** 적용 후보 판정 (Profile 별 포함·제외·미정과 사유) */
  profiles: ProfileDecision[];
  route?: DecisionRoute;
  decisionReason?: string;
  /** Feature 전환 결과 — 정확 Feature ID */
  featureId?: string;
  handoff?: HandoffAck | null;
  history: ProposalHistory[];
}

// ── 단계 전이 규칙 ─────────────────────────────────────────────
// 허용 전이는 표로만 두고, 필수 조건은 proposalGate() 가 검사한다. 화면은 사유를 그대로 보여준다.
export const PROPOSAL_TRANSITIONS: Record<ProposalState, ProposalState[]> = {
  DRAFT: ['RECEIVED', 'REJECTED'],
  RECEIVED: ['REVIEWING', 'REJECTED'],
  REVIEWING: ['DECISION', 'REJECTED'],
  DECISION: ['HANDOFF', 'REJECTED'],
  HANDOFF: [],
  REJECTED: [],
};

export interface Gate { ok: boolean; reasons: string[] }

/** 제안이 그 단계로 갈 수 있는가 — 미충족 조건을 사유로 돌려준다(화면은 그대로 표시하고 서버에 다시 맡긴다). */
export function proposalGate(p: Proposal, to: ProposalState): Gate {
  const reasons: string[] = [];
  const need = (cond: boolean, msg: string) => { if (!cond) reasons.push(msg); };

  if (!PROPOSAL_TRANSITIONS[p.stage].includes(to)) {
    return { ok: false, reasons: [`${STAGE_KO[p.stage]} → ${STAGE_KO[to]} 전이는 허용되지 않는다`] };
  }
  switch (to) {
    case 'RECEIVED':
      need(!!p.title.trim(), '제안 제목 없음');
      need(!!p.value.trim(), '고객 가치 없음');
      need(!!p.quantitative.trim(), '정량 근거 없음 — 근거 없는 후보는 접수하지 않는다');
      need(!!p.form, '작성 양식 없음');
      need(!!p.org.trim(), '검토 조직 없음');
      need(!!p.due.trim(), '기한 없음');
      break;
    case 'REVIEWING':
      need(p.handoff?.state === 'ACKED', '접수 ACK 미확인 — 접수와 업무 착수를 구분한다');
      need(!!p.reviewer?.trim(), '기술 검토자 미지정');
      break;
    case 'DECISION':
      need(!!p.technical.trim(), '기술 검토 의견 없음');
      need(p.techReview === 'YES' || p.profiles.every(x => x.decision === 'EXCLUDE'),
        '법규·설계·아키텍처 검토(YES) 또는 전 Profile 제외 사유 필요');
      need(p.profiles.every(x => x.decision !== 'UNDECIDED'), '적용 후보 미정 Profile 있음 — 포함·제외를 확정한다');
      need(p.profiles.every(x => x.decision !== 'EXCLUDE' || !!x.reason.trim()), '제외 Profile 사유 누락');
      break;
    case 'REJECTED':
      need(!!p.decisionReason?.trim(), '반려 사유 없음');
      break;
    default:
      break;
  }
  // 이관은 항상 3개 경로 중 Feature 전환으로만 — 나머지 두 경로는 이관 단계로 가지 않는다.
  if (to === 'HANDOFF') {
    need(p.route === 'FEATURE', 'Feature 전환 경로가 아니다');
    need(!!p.featureId, 'Feature ID 미발급 — 전환은 정확 ID 발급과 함께만 성립한다');
  }
  return { ok: reasons.length === 0, reasons };
}

export const proposalStats = (rows: Proposal[]) => ({
  total: rows.length,
  open: rows.filter(r => r.stage !== 'HANDOFF' && r.stage !== 'REJECTED').length,
  draft: rows.filter(r => r.stage === 'DRAFT').length,
  review: rows.filter(r => r.stage === 'REVIEWING' || r.stage === 'RECEIVED').length,
  handedOff: rows.filter(r => r.stage === 'HANDOFF').length,
  rejected: rows.filter(r => r.stage === 'REJECTED').length,
  convertible: rows.filter(r => r.stage === 'DECISION' && r.route === 'FEATURE').length,
  ackPending: rows.filter(r => r.handoff?.state === 'REQUESTED').length,
});

const H = (ts: string, actor: string, from: ProposalState, to: ProposalState, note: string): ProposalHistory =>
  ({ ts, actor, from, to, note });

/** 접수·검토 단계의 초기 제안 — 화면이 곧바로 전이를 시험할 수 있도록 서로 다른 단계에 하나씩 둔다. */
export const SEED_PROPOSALS: Proposal[] = [
  {
    id: 'PRP-2026-0007', title: '원격 도어 잠금 정책 세분화', kind: 'CHANGE', form: 'CHANGE', category: 'Connectivity · Door',
    stage: 'DRAFT', org: 'Conn. Team', due: '2026-10-15', owner: 'author',
    value: '주차 중 도어 잠금 알림 지연을 줄여 고객 체감 응답성을 높인다.', quantitative: 'VOC 128건(지연 3초 이상) · 목표 p95 800ms 이하', technical: '',
    salesTalk: 'YES', techReview: 'NO',
    reviewer: '', profiles: initialProfileDecisions(), handoff: null, history: [H('2026-09-14 09:12', 'author', 'DRAFT', 'DRAFT', '초안 작성')],
  },
  {
    id: 'PRP-2026-0006', title: '좌석 열선 승인 정책 신설', kind: 'NEW', form: 'FOD', category: 'Body · Comfort',
    stage: 'RECEIVED', org: 'Body Platform Team', due: '2026-10-02', owner: 'author',
    value: '구독 상품과 연결된 좌석 기능의 무단 사용을 막는다.', quantitative: '무단 사용 추정 340건/월 · 예상 회수 ₩0.4억/월', technical: '',
    salesTalk: 'NO', techReview: 'NO', reviewer: '',
    profiles: initialProfileDecisions(), handoff: { correlationId: 'corr-9f21', commandId: 'cmd-a17', requestedAt: '2026-09-14 10:02', state: 'ACKED', ackAt: '2026-09-14 10:31', receiver: 'Body Platform Team' },
    history: [
      H('2026-09-13 16:40', 'author', 'DRAFT', 'DRAFT', '초안 작성'),
      H('2026-09-14 10:02', 'author', 'DRAFT', 'RECEIVED', '정량 근거 확인 후 접수'),
    ],
  },
  {
    id: 'PRP-2026-0005', title: 'AEB 목표물 분류 확장', kind: 'CHANGE', form: 'STANDARD', category: 'ADAS · Safety',
    stage: 'REVIEWING', org: 'ADAS Team', due: '2026-09-30', owner: 'author',
    value: '자전거·킥보드 인식률을 높여 도심 사고를 줄인다.', quantitative: '오검출 2.1% → 목표 1.2% · 시나리오 412건', technical: '센서 퓨전 재학습 필요, ASIL-D 안전 요구 재추적 대상.',
    salesTalk: 'NO', techReview: 'YES', reviewer: 'quality',
    profiles: initialProfileDecisions(), handoff: { correlationId: 'corr-7a03', commandId: 'cmd-b52', requestedAt: '2026-09-12 09:20', state: 'ACKED', ackAt: '2026-09-12 09:48', receiver: 'ADAS Team' },
    history: [
      H('2026-09-11 14:05', 'author', 'DRAFT', 'DRAFT', '초안 작성'),
      H('2026-09-12 09:20', 'author', 'DRAFT', 'RECEIVED', '정량 근거 확인 후 접수'),
      H('2026-09-12 13:11', 'quality', 'RECEIVED', 'REVIEWING', '기술 검토 착수'),
    ],
  },
];
