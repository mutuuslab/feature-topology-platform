// 검토함 대기열(W2, 담당자 E2E P2-3·P1-4·P3-6) — 서버(/api/work-queues)가 모으고 화면이 내 차례·부서·급한 순서를 정한다.
// 대기열에 들어가는 조건만 여기 둔다(프론트·백엔드 공용). 실제 승인·서명·판정은 각 대상 화면이 같은 직무 분리 규칙으로 다시 막는다.
import { GATE_META, GATES, type GateId, type Lifecycle } from '../enums';

type Gates = Partial<Record<string, string | null | undefined>>;
const pass = (gates: Gates, ids: readonly GateId[]) => ids.every((g) => gates[g] === 'PASS' || gates[g] === 'N/A');

/** 정의 승인 대기 — PROPOSED이고 G1~G3이 모두 PASS(정의 승인 전이 조건의 Gate 몫) */
export const DEFINITION_GATES: readonly GateId[] = ['G1', 'G2', 'G3'];
export const definitionReady = (f: { lifecycle: string; gates: Gates }) => f.lifecycle === 'PROPOSED' && pass(f.gates, DEFINITION_GATES);

/** Release Sign-off 대기 — VERIFIED이고 G8·G9가 PASS인데 유효한 서명이 없다(Feature Owner 몫) */
export const SIGNOFF_GATES: readonly GateId[] = ['G8', 'G9'];
export const signoffReady = (f: { lifecycle: string; gates: Gates }, signed: boolean) => f.lifecycle === 'VERIFIED' && pass(f.gates, SIGNOFF_GATES) && !signed;

/** 지금 단계에서 판정을 기다리는 Gate — 그 Lifecycle 단계의 Gate 중 PASS가 아닌 것(APPROVED는 Gate 없음) */
export const pendingGates = (lifecycle: Lifecycle | string, gates: Gates): GateId[] => GATES.filter((g) => GATE_META[g].stage === lifecycle && gates[g] !== 'PASS' && gates[g] !== 'N/A');

export interface WorkQueueFeature {
  featureId: string;
  version: string;
  name: string;
  lifecycle: Lifecycle;
  ownerId: string;
  /** 만든 사람(계정) — 시드 Feature는 null */
  createdBy: string | null;
  /** 대기열에 들어온 시각 — 조건이 갖춰진 마지막 판정 시각, 없으면 만든 시각 */
  since: string | null;
}

export interface WorkQueues {
  /** 정의 승인 대기(FEATURE_APPROVER) */
  definitions: WorkQueueFeature[];
  /** Release Sign-off 대기(FEATURE_AUTHOR) — stale: 서명했지만 G8·G9가 다시 판정돼 효력이 없다 */
  signoffs: (WorkQueueFeature & { stale: boolean })[];
  /** 출시 가능(RELEASE_MANAGER) — VERIFIED·G8·G9 PASS·유효한 Sign-off */
  releasable: (WorkQueueFeature & { signedBy: string; signedAt: string })[];
  /** Gate 판정 대기(GATE_JUDGE·SAFETY_OFFICER) — 지금 단계 Gate 중 PASS가 아닌 것 */
  gates: (WorkQueueFeature & { gate: GateId; status: string | null })[];
  /** 안전 분류 확정 대기(SAFETY_OFFICER) — 분류가 DRAFT인 최신 Version */
  classifications: (WorkQueueFeature & { fClass: string })[];
  /** 형식승인 영향 판단 대기(REGULATORY_OWNER) — 편집 가능한 최신 Version에 유효한 판단 기록이 없음 */
  homologations: WorkQueueFeature[];
  /** 최근 Feature — 최신 Version을 만든 시각이 늦은 순(같으면 ID 큰 순), 끝난 Feature 제외. 홈 '내 Feature'(작성자) */
  recent: WorkQueueFeature[];
}

/** 홈 '내 Feature'·'최근 Feature'에 보이는 수 */
export const RECENT_FEATURES = 12;
