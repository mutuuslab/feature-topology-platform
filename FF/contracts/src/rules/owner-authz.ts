// Feature Owner 인가·계정 상태·소유자 이관(D-GAP-1, B13 — 2026-11-07 확정).
//  · 역할 정의는 계약 고정(enums ROLES). 인가는 역할 + 그 기록의 소유자(ownerId) 본인 — 뒤 묶음(정책·지원 조건·타겟·Variant·분류)이 이 도우미를 쓴다
//  · 시스템 관리자(SYSTEM_ADMIN)는 기록 내용을 고치지 않는다. 소유자 계정이 없거나 비활성일 때만 소유자를 다른 사용 중 계정으로 옮긴다(감사)
//  · 계정 상태: 비활성 기록(시스템 관리자) 우선. 데모 인증은 데모 계정 표 안이면 사용 중·밖이면 없음, 회사 SSO는 로그인한 적 있으면 사용 중·모르면 확인 불가
import { z } from 'zod';
import type { Role } from '../enums';

export type AccountState = 'ACTIVE' | 'INACTIVE' | 'ABSENT' | 'UNKNOWN';
export const ACCOUNT_STATE_LABEL: Record<AccountState, string> = { ACTIVE: '사용 중', INACTIVE: '비활성', ABSENT: '없는 계정', UNKNOWN: '확인 불가' };
/** 계정 상태·소유자 이관을 맡는 역할 */
export const SYSTEM_ADMIN_ROLES: Role[] = ['SYSTEM_ADMIN'];

/** 그 기록의 소유자 본인인가 — 소유자가 비어 있으면 아무도 아니다 */
export function isRecordOwner(rec: { ownerId?: string | null }, actorId: string): boolean {
  return !!rec.ownerId && rec.ownerId === actorId;
}

/** 소유자만 고칠 수 있는 기록 — 막히면 화면·오류에 쓸 사유, 아니면 null */
export function ownerOnlyBlocker(rec: { ownerId?: string | null }, actorId: string, what = '이 기록'): string | null {
  if (!rec.ownerId) return `${what}은 소유자가 없습니다 — 시스템 관리자에게 소유자 이관을 요청하세요`;
  return isRecordOwner(rec, actorId) ? null : `${what}은 소유자(${rec.ownerId})만 수정할 수 있습니다`;
}

/** 데모 계정 표 → 행위자 ID(usr-<계정>) */
export const demoAccountIds = (personas: Record<string, readonly Role[]>): string[] => Object.keys(personas).map((k) => `usr-${k}`);

/** 계정 상태 — 비활성 기록이 먼저. 데모 인증은 표 안/밖, 회사 SSO는 로그인 기록이 있으면 사용 중, 없으면 확인 불가(없음으로 보지 않는다) */
export function accountStateOf(id: string, dir: { personaIds: readonly string[]; seenIds: readonly string[]; inactiveIds: readonly string[] }, mode: 'demo' | 'oidc'): AccountState {
  if (dir.inactiveIds.includes(id)) return 'INACTIVE';
  if (mode === 'demo') return dir.personaIds.includes(id) ? 'ACTIVE' : 'ABSENT';
  return dir.seenIds.includes(id) ? 'ACTIVE' : 'UNKNOWN';
}

/**
 * 소유자 이관 — 시스템 관리자만, 지금 소유자 계정이 없거나 비활성일 때만, 새 소유자는 사용 중이고 그 기록의 담당 역할을 가진 다른 계정.
 * toRoles가 null이면 담당 역할을 확인할 수 없어 이관을 거부한다. 막히면 사유, 아니면 null
 */
export function ownerTransferBlocker(x: {
  ownerId: string | null;
  ownerState: AccountState;
  toId: string;
  toState: AccountState;
  toRoles: readonly Role[] | null;
  allowedRoles: readonly Role[];
  actorId: string;
  actorRole: Role;
}): string | null {
  if (!SYSTEM_ADMIN_ROLES.includes(x.actorRole)) return '소유자 이관은 시스템 관리자만 할 수 있습니다';
  if (x.ownerId && x.ownerState === 'ACTIVE') return '소유자 계정이 사용 중입니다 — 이관은 소유자 계정이 없거나 비활성일 때만 합니다';
  if (x.ownerId && x.ownerState === 'UNKNOWN') return '소유자 계정 상태를 확인할 수 없습니다 — 먼저 그 계정을 비활성으로 기록하세요';
  if (x.toId === x.ownerId) return '새 소유자가 지금 소유자와 같습니다';
  if (x.toId === x.actorId) return '시스템 관리자 자신에게는 이관할 수 없습니다 — 관리자는 기록 내용을 고치지 않습니다';
  if (x.toState !== 'ACTIVE') return '새 소유자는 사용 중인 계정이어야 합니다';
  if (x.toRoles === null) return '새 소유자의 담당 역할을 확인할 수 없습니다 — 계정 역할을 확인한 뒤 다시 시도하세요';
  if (!x.toRoles.some((r) => x.allowedRoles.includes(r))) return '새 소유자는 룰 담당 역할을 가진 계정이어야 합니다';
  return null;
}

export const TransferOwnerBody = z.object({ toOwnerId: z.string().trim().min(1).max(120), reason: z.string().trim().min(4).max(500) }).strict();
export type TransferOwnerBody = z.infer<typeof TransferOwnerBody>;
export const AccountStatusBody = z.object({ reason: z.string().trim().min(4).max(500) }).strict();
export type AccountStatusBody = z.infer<typeof AccountStatusBody>;

/** 계정 상태 목록의 한 줄 */
export interface AccountView {
  id: string;
  state: AccountState;
  roles: Role[] | null;
  changedAt: string | null;
  changedBy: string | null;
  reason: string | null;
}

/** 소유자 이관 기록(추가만) */
export interface OwnerTransfer {
  entity: string;
  recordId: string;
  fromOwnerId: string | null;
  fromState: AccountState;
  toOwnerId: string;
  by: string;
  at: string;
  reason: string;
}
