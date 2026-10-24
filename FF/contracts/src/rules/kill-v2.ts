// Kill·복원 v2 (D03-03·D03-04, 보고서 v1.1 7·8·9장) — 요청 → 2인 승인(개인 서명) → 게이트 → 차량별 봉투.
// 승인 규칙은 게이트 FFG-PLT-005와 같은 조건을 승인 시점에 먼저 막는다(마지막 칸에 FSM이 없으면 거부 등).
// 요청 프레임은 보고서 9.2절 ICD 예제(56바이트, big endian) — 플랫폼은 4~35바이트 블록에 cmd_auth(AES-CMAC)를 계산하고, 차량 LPC가 링크 필드·CRC를 채운다.
import type { ApproverRole, DeactClass, FClass, KillRequestType, ReasonCategory } from '../schemas/safety';

// ── 코드값(9.2절, 패키지 c/include/ff_types.h) — 필드마다 다른 해밍 잉여류, 그 밖의 값은 무효 ──
export const REQUEST_CODES: Record<KillRequestType, number> = { deactivate: 0x3c, restore: 0xc3, activate: 0x5a, sync: 0x69 };
export const REASON_CODES: Record<ReasonCategory, number> = { SAFETY: 0x1e, SECURITY: 0x2d, REGULATORY: 0x4b, COMMERCIAL: 0x87, OPERATIONAL: 0xb4 };
export const DC_CODES: Record<DeactClass, number> = { DC0: 0x35, DC1: 0x53, DC2: 0x6f, DC3: 0x90, DC4: 0xca };

export interface AuthBlockInput {
  featureId: string; // FEAT-00022
  version: string; // 1.0.0 — 프레임에는 major.minor만
  request: KillRequestType;
  reason: ReasonCategory;
  deactClass: DeactClass;
  keyEpoch: number;
  vehicleSeq: number;
  notBefore: string;
  expiresAt: string;
  /** SHA-256(VIN ‖ ECU 부품 번호 ‖ SW 버전) 앞 4바이트(ICD 예제) — 해시는 호출자가 계산 */
  targetHash: number;
  approverRefs: readonly [number, number];
  resyncRef?: number;
}

const u16 = (b: Uint8Array, o: number, v: number) => ((b[o] = (v >>> 8) & 0xff), (b[o + 1] = v & 0xff));
const u32 = (b: Uint8Array, o: number, v: number) => ((b[o] = (v >>> 24) & 0xff), (b[o + 1] = (v >>> 16) & 0xff), (b[o + 2] = (v >>> 8) & 0xff), (b[o + 3] = v & 0xff));
const unixS = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Feature 번호(FEAT-00022 → 22)와 Version(major << 8 | minor) — 부록 D.5 */
export const featureNumber = (id: string) => Number(/^FEAT-(\d{5})$/.exec(id)?.[1] ?? NaN);
export const featureVersionCode = (v: string) => {
  const [major, minor] = v.split('.').map(Number);
  return ((major & 0xff) << 8) | (minor & 0xff);
};

/**
 * cmd_auth 대상 블록 — 프레임 4~35바이트(32바이트).
 * @rule FFG-VEH-002 — 플랫폼 쪽: 차량 키 CMAC 대상 블록을 9.2절 배치로 만든다(Guard 쪽 검증은 차량 SW)
 */
export function authBlock(i: AuthBlockInput): Uint8Array {
  const n = featureNumber(i.featureId);
  if (!Number.isInteger(n)) throw new Error(`Feature ID 형식 오류: ${i.featureId}`);
  const b = new Uint8Array(32);
  u32(b, 0, n); // 4~7
  u16(b, 4, featureVersionCode(i.version)); // 8~9
  b[6] = REQUEST_CODES[i.request]; // 10
  b[7] = REASON_CODES[i.reason]; // 11
  b[8] = DC_CODES[i.deactClass]; // 12
  b[9] = i.keyEpoch & 0xff; // 13
  u32(b, 10, i.vehicleSeq); // 14~17
  u32(b, 14, unixS(i.notBefore)); // 18~21
  u32(b, 18, unixS(i.expiresAt)); // 22~25
  u32(b, 22, i.targetHash >>> 0); // 26~29
  u16(b, 26, i.approverRefs[0]); // 30~31
  u16(b, 28, i.approverRefs[1]); // 32~33
  u16(b, 30, i.resyncRef ?? 0); // 34~35
  return b;
}

/** CRC-32/ISO-HDLC (반사형 0xEDB88320, 초기·최종 XOR 0xFFFFFFFF) — "123456789" → 0xCBF43926 */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of bytes) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 56바이트 프레임(LPC가 만드는 모양) — 시험·차량 시뮬레이터용. data_id 0x0F22 예제 */
export function requestFrame(block: Uint8Array, cmdAuth: Uint8Array, counter = 0, dataId = 0x0f22): Uint8Array {
  if (block.length !== 32 || cmdAuth.length !== 16) throw new Error('블록 32바이트·cmd_auth 16바이트');
  const f = new Uint8Array(56);
  u16(f, 0, dataId);
  u16(f, 2, counter);
  f.set(block, 4);
  f.set(cmdAuth, 36);
  u32(f, 52, crc32(f.subarray(0, 52)));
  return f;
}

/** 승인자 16비트 참조(approver_ref) — 사용자 ID의 FNV-1a를 16비트로 접는다(0은 쓰지 않는다) */
export function approverRef(userId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 16) ^ (h & 0xffff) || 1;
}

// ── 승인 규칙 ─────────────────────────────────────────
export interface ApprovalPlan {
  count: 2;
  /** F2 이상 안전·보안 사유의 비활성화·복원 — FSM(Safety Manager) 필수 */
  fsm: boolean;
}
export const approvalPlan = (fClass: FClass, request: KillRequestType, reason: ReasonCategory): ApprovalPlan => ({
  count: 2,
  fsm: ['F2', 'F3', 'F4'].includes(fClass) && (request === 'deactivate' || request === 'restore') && (reason === 'SAFETY' || reason === 'SECURITY'),
});

export interface ApprovalSoFar {
  requestedBy: string;
  approvals: readonly { approverId: string; role: ApproverRole }[];
  plan: ApprovalPlan;
  /** 복원 — 직전 Kill 승인자(원장)와 겹치면 안 된다 */
  excluded?: readonly string[];
}
export type ApprovalProblemCode = 'SELF_APPROVAL' | 'DUPLICATE' | 'NO_APPROVER_ROLE' | 'FSM_REQUIRED' | 'KILL_APPROVER' | 'COMPLETE';

/**
 * 이 사람이 지금 승인할 수 있는가, 할 수 있으면 어느 보고서 역할로 서명하는가.
 * @rule FFG-PLT-005, FFG-DEAC-008, FFG-SEC-008 — 승인 시점 차단(게이트가 같은 조건을 다시 판정)
 */
export function approvalCheck(
  s: ApprovalSoFar,
  approver: { id: string; roles: readonly ApproverRole[] },
): { ok: true; role: ApproverRole } | { ok: false; code: ApprovalProblemCode; message: string } {
  if (s.approvals.length >= s.plan.count) return { ok: false, code: 'COMPLETE', message: '승인이 이미 끝났습니다' };
  if (approver.id === s.requestedBy) return { ok: false, code: 'SELF_APPROVAL', message: '요청자는 같은 명령을 승인할 수 없습니다(직무 분리)' };
  if (s.approvals.some((a) => a.approverId === approver.id)) return { ok: false, code: 'DUPLICATE', message: '같은 사람이 두 번 승인할 수 없습니다(서로 다른 2인)' };
  if (s.excluded?.includes(approver.id)) return { ok: false, code: 'KILL_APPROVER', message: '직전 차단을 승인한 사람은 복원을 승인할 수 없습니다' };
  if (!approver.roles.length) return { ok: false, code: 'NO_APPROVER_ROLE', message: '승인 역할(FSM·CSM·OPS_LEAD·PRODUCT_OWNER·QA·REGULATORY)이 없습니다' };
  const hasFsm = s.approvals.some((a) => a.role === 'FSM');
  const last = s.approvals.length === s.plan.count - 1;
  if (s.plan.fsm && !hasFsm) {
    if (approver.roles.includes('FSM')) return { ok: true, role: 'FSM' };
    if (last) return { ok: false, code: 'FSM_REQUIRED', message: 'F2 이상 안전·보안 조치는 Safety Manager(FSM) 승인이 필요합니다 — 남은 한 칸은 FSM만' };
  }
  return { ok: true, role: approver.roles.find((r) => r !== 'FSM') ?? approver.roles[0] };
}

/**
 * 승인 서명(approval_sig) 형식 검사 — FFP-F059. 길이만 보지 않는다:
 *  · RFC 4648 §5 정준 base64url(패딩 없음)로 정확히 64바이트(Ed25519 서명) — 남는 비트가 0이 아닌 표기는 어떤 서명의 표기도 아니다
 *  · 서로 다른 승인자의 서명 값이 같으면 개인 서명이 아니다(같은 대상에 다른 키로 서명하면 값이 다르다 — 복사·위조)
 * 대상 집합 결속(서명 검증)은 플랫폼 게이트가 등록된 승인자 공개키로 한다(commandApprovalSubject).
 */
export function approvalSigProblems(approvals: readonly { approver_id: string; approval_sig?: string | null }[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  for (const a of approvals) {
    const s = a.approval_sig ?? '';
    // 64바이트 = 86자(마지막 글자는 4비트만 의미 — 나머지 2비트 0). 정준 표기만 받는다
    if (!/^[A-Za-z0-9_-]{85}[AQgw]$/.test(s)) out.push(`${a.approver_id}: approval_sig가 64바이트 서명의 정준 base64url 표기가 아닙니다`);
    const dup = seen.get(s);
    if (s && dup && dup !== a.approver_id) out.push(`${a.approver_id}: ${dup}와 같은 서명 값 — 승인자마다 개인 서명이어야 합니다`);
    if (s && !dup) seen.set(s, a.approver_id);
  }
  return out;
}

/**
 * 승인 서명 대상 — 명령만으로 다시 만들 수 있는 핵심 필드(JCS로 정규화해 승인자 개인 키로 서명).
 * 결정(2026-10-24 사용자, 승인자 키 등록 의무 — 20-90 D-RD-5): 게이트는 플랫폼이 발행한 명령이든 외부에서 제출한 명령이든
 * 승인마다 이 대상을 명령에서 다시 만들어 등록된 승인자 공개키로 검증한다. 그래서 Kill 요청 ID(플랫폼 안 기록)는 넣지 않고,
 * 대상 집합(Feature·요청·사유·차량)과 그 승인 칸(승인자·역할·서명 시각)을 묶는다 — 다른 대상·다른 칸으로 옮기면 서명이 맞지 않는다.
 */
export function approvalSubject(k: { featureId: string; featureVersion: string; request: KillRequestType; reasonCategory: ReasonCategory; vins: readonly string[]; approverId: string; role: string; signedAt: string }) {
  return { feature: `${k.featureId}@${k.featureVersion}`, request: k.request, reason: k.reasonCategory, vehicles: [...k.vins].sort(), approver: k.approverId, role: k.role, signed_at: k.signedAt };
}

/** kill_command v2 안의 승인 한 칸이 서명해야 하는 대상 — 명령에서 다시 만든다(게이트 검증·외부 서명 도구 공용) */
export function commandApprovalSubject(
  cmd: { feature: { id: string; version: string }; request: KillRequestType; reason: { category: ReasonCategory }; scope: { vehicle_ids: readonly string[] } },
  a: { approver_id: string; role: string; signed_at: string },
) {
  return approvalSubject({ featureId: cmd.feature.id, featureVersion: cmd.feature.version, request: cmd.request, reasonCategory: cmd.reason.category, vins: cmd.scope.vehicle_ids, approverId: a.approver_id, role: a.role, signedAt: a.signed_at });
}

/** 요청 유형별 서명 키 용도(FFG-SEC-002) — 비활성화는 kill, 복원·활성화·SYNC는 각자의 키. 차량은 이 용도의 kid로 서명된 봉투만 받는다 */
export const COMMAND_KEY_PURPOSE: Record<KillRequestType, 'kill' | 'restore' | 'activate' | 'sync'> = { deactivate: 'kill', restore: 'restore', activate: 'activate', sync: 'sync' };
