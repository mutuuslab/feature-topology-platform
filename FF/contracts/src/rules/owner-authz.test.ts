// 시스템 관리자 역할·Feature Owner 인가(D-GAP-1)와 컴플라이언스 룰 소유자 이관(B13) — 관리자는 소유자가 없거나 비활성일 때 이관만, 내용은 고치지 않는다
import { describe, expect, it } from 'vitest';
import { ROLE_LABEL, ROLES } from '../enums';
import { HUMAN_ROLES } from './access';
import { DEMO_PERSONAS, dutiesOf } from './duty-separation';
import { accountStateOf, demoAccountIds, isRecordOwner, ownerOnlyBlocker, ownerTransferBlocker, TransferOwnerBody } from './owner-authz';

describe('시스템 관리자 역할(D-GAP-1)', () => {
  it('사람 역할로 추가되고 라벨이 있으며, 분리 직무(요구 승인·출시·Kill·복원)를 주지 않는다', () => {
    expect(ROLES.at(-1)).toBe('SYSTEM_ADMIN');
    expect(ROLE_LABEL.SYSTEM_ADMIN).toBe('시스템 관리자');
    expect(HUMAN_ROLES).toContain('SYSTEM_ADMIN');
    expect(dutiesOf(['SYSTEM_ADMIN'])).toEqual([]);
  });
  it('데모 계정 sysadmin 하나만 시스템 관리자다(겸직 없음)', () => {
    expect(Object.keys(DEMO_PERSONAS).filter((k) => DEMO_PERSONAS[k].includes('SYSTEM_ADMIN'))).toEqual(['sysadmin']);
    expect(DEMO_PERSONAS.sysadmin).toEqual(['SYSTEM_ADMIN']);
  });
});

describe('Feature Owner 인가 도우미', () => {
  it('소유자 본인만 — 소유자가 비어 있으면 아무도 소유자가 아니다', () => {
    expect(isRecordOwner({ ownerId: 'usr-author' }, 'usr-author')).toBe(true);
    expect(isRecordOwner({ ownerId: 'usr-author' }, 'usr-approver')).toBe(false);
    expect(isRecordOwner({ ownerId: null }, 'usr-author')).toBe(false);
    expect(isRecordOwner({ ownerId: '' }, '')).toBe(false);
    expect(ownerOnlyBlocker({ ownerId: 'usr-author' }, 'usr-author')).toBeNull();
    expect(ownerOnlyBlocker({ ownerId: 'usr-author' }, 'usr-sysadmin', '이 정책')).toBe('이 정책은 소유자(usr-author)만 수정할 수 있습니다');
    expect(ownerOnlyBlocker({ ownerId: null }, 'usr-author')).toMatch(/소유자가 없습니다/);
  });
});

describe('계정 상태', () => {
  const dir = { personaIds: demoAccountIds(DEMO_PERSONAS), seenIds: ['sub-1'], inactiveIds: ['usr-steward'] };
  it('데모 인증 — 데모 계정은 사용 중, 표 밖은 없음, 비활성 기록이 우선', () => {
    expect(dir.personaIds).toContain('usr-sysadmin');
    expect(accountStateOf('usr-author', dir, 'demo')).toBe('ACTIVE');
    expect(accountStateOf('usr-steward', dir, 'demo')).toBe('INACTIVE');
    expect(accountStateOf('usr-gone', dir, 'demo')).toBe('ABSENT');
  });
  it('회사 SSO — 로그인한 적 있는 계정만 사용 중, 모르는 계정은 확인 불가(없음으로 보지 않는다)', () => {
    expect(accountStateOf('sub-1', dir, 'oidc')).toBe('ACTIVE');
    expect(accountStateOf('sub-2', dir, 'oidc')).toBe('UNKNOWN');
    expect(accountStateOf('usr-steward', dir, 'oidc')).toBe('INACTIVE');
  });
});

describe('소유자 이관(B13)', () => {
  const base = {
    ownerId: 'usr-old',
    ownerState: 'INACTIVE' as const,
    toId: 'usr-steward',
    toState: 'ACTIVE' as const,
    toRoles: ['REGULATORY_OWNER'] as const,
    allowedRoles: ['REGULATORY_OWNER', 'SAFETY_OFFICER', 'SECURITY_OFFICER'] as const,
    actorId: 'usr-sysadmin',
    actorRole: 'SYSTEM_ADMIN' as const,
  };
  it('시스템 관리자가 비활성·없는 소유자의 기록을 룰 담당 역할의 사용 중 계정으로 옮긴다', () => {
    expect(ownerTransferBlocker(base)).toBeNull();
    expect(ownerTransferBlocker({ ...base, ownerState: 'ABSENT' })).toBeNull();
  });
  it('시스템 관리자만', () => {
    expect(ownerTransferBlocker({ ...base, actorRole: 'REGULATORY_OWNER' })).toBe('소유자 이관은 시스템 관리자만 할 수 있습니다');
  });
  it('소유자 계정이 사용 중이거나 확인할 수 없으면 거부 — 이관은 소유자가 없거나 비활성일 때만', () => {
    expect(ownerTransferBlocker({ ...base, ownerState: 'ACTIVE' })).toMatch(/소유자 계정이 사용 중/);
    expect(ownerTransferBlocker({ ...base, ownerState: 'UNKNOWN' })).toMatch(/확인할 수 없/);
  });
  it('새 소유자 — 사용 중 계정, 같은 소유자·관리자 자신 금지, 룰 담당 역할 필요', () => {
    expect(ownerTransferBlocker({ ...base, toState: 'INACTIVE' })).toMatch(/새 소유자는 사용 중인 계정/);
    expect(ownerTransferBlocker({ ...base, toId: 'usr-old' })).toMatch(/지금 소유자/);
    expect(ownerTransferBlocker({ ...base, toId: 'usr-sysadmin' })).toMatch(/시스템 관리자 자신/);
    expect(ownerTransferBlocker({ ...base, toRoles: ['AUDITOR'] })).toMatch(/룰 담당 역할/);
    expect(ownerTransferBlocker({ ...base, toRoles: [] })).toMatch(/룰 담당 역할/);
    expect(ownerTransferBlocker({ ...base, toRoles: null })).toBe('새 소유자의 담당 역할을 확인할 수 없습니다 — 계정 역할을 확인한 뒤 다시 시도하세요');
  });
  it('본문 — 새 소유자와 사유(4자 이상), 다른 칸 금지(내용 수정 불가)', () => {
    expect(TransferOwnerBody.parse({ toOwnerId: 'usr-steward', reason: '담당 퇴사 이관' })).toEqual({ toOwnerId: 'usr-steward', reason: '담당 퇴사 이관' });
    expect(TransferOwnerBody.safeParse({ toOwnerId: 'usr-steward', reason: '짧' }).success).toBe(false);
    expect(TransferOwnerBody.safeParse({ toOwnerId: 'usr-steward', reason: '담당 퇴사 이관', name: '바꾼 이름' }).success).toBe(false);
  });
});
