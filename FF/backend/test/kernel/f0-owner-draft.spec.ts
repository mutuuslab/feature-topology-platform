// F0 권한 기반·공용 규칙 — 시스템 관리자 역할·계정 상태(D-GAP-1), 컴플라이언스 룰 소유자 이관(B13), 초안 삭제 공용 서비스(B2).
// 관리자는 소유자가 없거나 비활성일 때만 이관하고 내용은 고치지 않는다. 초안 삭제는 승인 이력·참조가 없을 때만, 지운 ID는 묘비로 다시 쓰지 않는다.
import { INestApplication } from '@nestjs/common';
import { ROUTES } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { DraftDeletionService } from '../../src/kernel/draft-deletion';
import { assertRecordOwner } from '../../src/kernel/owner-guard';
import { AuditService } from '../../src/kernel/audit.service';
import { actor, bootApp } from '../helpers';

const ADMIN = actor('usr-sysadmin', 'SYSTEM_ADMIN');
const REG = actor('usr-steward', 'REGULATORY_OWNER');
const FORMER = actor('usr-reg-former', 'REGULATORY_OWNER'); // 데모 계정 표 밖 — 떠난 법규 담당
const FSM = actor('usr-quality', 'SAFETY_OFFICER');

const rule = (ruleId: string) => ({
  ruleId,
  name: '차량 식별자 대상 지정 금지',
  type: 'PRIVACY',
  scope: { markets: ['KR'] },
  criteria: [{ check: 'NO_VEHICLE_ID_TARGETING' }],
  approverIds: ['usr-quality'],
  evidence: { url: 'https://www.law.go.kr/법령/개인정보보호법', docName: '개인정보 보호법', clause: '제23조' },
  validFrom: '2026-01-01',
  validTo: null,
});

describe('F0 — 시스템 관리자·계정 상태·소유자 이관·초안 삭제', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => ({ app, http, get } = await bootApp({ at: '2026-11-07T01:00:00.000Z' })));
  afterAll(() => app.close());

  it('IAM 역할표에 시스템 관리자가 사람 역할로 있고 계정 상태·이관 권한만 받는다', async () => {
    const r = (await http().get('/api/iam/roles').expect(200)).body;
    const sa = r.roles.find((x: any) => x.role === 'SYSTEM_ADMIN');
    expect(sa).toMatchObject({ label: '시스템 관리자', human: true });
    expect(sa.allowed).toEqual(expect.arrayContaining(['deactivateAccount', 'reactivateAccount', 'transferComplianceRuleOwner']));
    // 몇 역할로 좁힌 경로 중 시스템 관리자가 들어간 것은 이 셋뿐(사람 역할 전체에 여는 개인 조회·요청 경로는 제외) — 기록 내용 수정·승인 경로에는 없다
    expect(ROUTES.filter((x) => x.roles?.includes('SYSTEM_ADMIN') && x.roles.length < 10).map((x) => x.name).sort()).toEqual(['deactivateAccount', 'reactivateAccount', 'transferComplianceRuleOwner']);
  });

  it('계정 목록 — 데모 계정 13개 사용 중, 시스템 관리자만 비활성·재활성(사유, 자기 계정 제외), 감사·이벤트', async () => {
    const list = (await http().get('/api/accounts').expect(200)).body.items;
    expect(list).toHaveLength(13);
    expect(list.every((a: any) => a.state === 'ACTIVE')).toBe(true);
    await http().post('/api/accounts/usr-safety2/deactivate').set(REG).send({ reason: '부서 이동' }).expect(403);
    await http().post('/api/accounts/usr-sysadmin/deactivate').set(ADMIN).send({ reason: '자기 계정' }).expect(409);
    await http().post('/api/accounts/usr-safety2/deactivate').set(ADMIN).send({ reason: '짧' }).expect(400);
    const off = (await http().post('/api/accounts/usr-safety2/deactivate').set(ADMIN).send({ reason: '부서 이동' }).expect(201)).body;
    expect(off).toMatchObject({ id: 'usr-safety2', state: 'INACTIVE', changedBy: 'usr-sysadmin', reason: '부서 이동' });
    await http().post('/api/accounts/usr-safety2/deactivate').set(ADMIN).send({ reason: '부서 이동' }).expect(409);
    await http().post('/api/accounts/usr-author/reactivate').set(ADMIN).send({ reason: '사용 중 계정' }).expect(409);
    expect((await http().post('/api/accounts/usr-safety2/reactivate').set(ADMIN).send({ reason: '부서 복귀' }).expect(201)).body.state).toBe('ACTIVE');
    const db = get<Db>(DB);
    expect(db.all("SELECT action FROM audit WHERE action IN ('ACCOUNT_DEACTIVATE','ACCOUNT_REACTIVATE') AND result = 'ALLOWED'")).toHaveLength(2);
    expect(db.all("SELECT type FROM events WHERE type IN ('account.deactivated','account.reactivated')")).toHaveLength(2);
  });

  it('소유자 이관 — 소유자 계정이 사용 중이면 거부, 없거나 비활성이면 시스템 관리자가 룰 담당 계정으로(내용·버전·상태 그대로, 이력·감사)', async () => {
    await http().post('/api/compliance-rules').set(FORMER).send(rule('CR-PRV-101')).expect(201);
    await http().post('/api/compliance-rules').set(REG).send(rule('CR-PRV-102')).expect(201);
    // 사용 중인 소유자의 룰은 이관할 수 없다
    const busy = await http().post('/api/compliance-rules/CR-PRV-102/owner-transfer').set(ADMIN).send({ toOwnerId: 'usr-quality', reason: '담당 변경' }).expect(409);
    expect(busy.body.error.message).toMatch(/소유자 계정이 사용 중/);
    // 시스템 관리자만
    await http().post('/api/compliance-rules/CR-PRV-101/owner-transfer').set(REG).send({ toOwnerId: 'usr-steward', reason: '퇴사 이관' }).expect(403);
    // 새 소유자 — 룰 담당 역할이 없는 계정·비활성 계정·관리자 자신은 안 된다
    await http().post('/api/compliance-rules/CR-PRV-101/owner-transfer').set(ADMIN).send({ toOwnerId: 'usr-author', reason: '퇴사 이관' }).expect(409);
    await http().post('/api/compliance-rules/CR-PRV-101/owner-transfer').set(ADMIN).send({ toOwnerId: 'usr-sysadmin', reason: '퇴사 이관' }).expect(409);
    // 내용을 바꾸는 칸은 받지 않는다
    await http().post('/api/compliance-rules/CR-PRV-101/owner-transfer').set(ADMIN).send({ toOwnerId: 'usr-steward', reason: '퇴사 이관', name: '바꾼 이름' }).expect(400);
    const before = (await http().get('/api/compliance-rules/CR-PRV-101').expect(200)).body;
    expect(before.ownerState).toBe('ABSENT');
    const r = (await http().post('/api/compliance-rules/CR-PRV-101/owner-transfer').set(ADMIN).send({ toOwnerId: 'usr-steward', reason: '퇴사 이관' }).expect(201)).body;
    expect(r).toMatchObject({ ruleId: 'CR-PRV-101', ownerId: 'usr-steward', version: '1.0', status: 'PROPOSED', name: before.rule?.name ?? r.name });
    const after = (await http().get('/api/compliance-rules/CR-PRV-101').expect(200)).body;
    expect(after.ownerState).toBe('ACTIVE');
    expect(after.ownerTransfers).toEqual([expect.objectContaining({ fromOwnerId: 'usr-reg-former', fromState: 'ABSENT', toOwnerId: 'usr-steward', by: 'usr-sysadmin', reason: '퇴사 이관' })]);
    // 새 소유자는 고칠 수 있고, 관리자는 내용을 고칠 수 없다(역할 밖)
    await http().patch('/api/compliance-rules/CR-PRV-101').set(ADMIN).send({ name: '관리자가 바꿈', reason: '시도' }).expect(403);
    await http().patch('/api/compliance-rules/CR-PRV-101').set(REG).send({ name: '차량 식별자 대상 지정 금지(개정)', reason: '이관 뒤 갱신' }).expect(200);
    const db = get<Db>(DB);
    expect(db.all("SELECT 1 FROM audit WHERE action = 'COMPLIANCE_RULE_OWNER_TRANSFER' AND result = 'ALLOWED'")).toHaveLength(1);
    expect(db.all("SELECT 1 FROM events WHERE type = 'compliance.rule.owner-transferred'")).toHaveLength(1);
  });

  it('비활성으로 기록된 소유자의 룰도 이관할 수 있다', async () => {
    await http().post('/api/compliance-rules').set(FSM).send({ ...rule('CR-PRV-103'), approverIds: ['usr-steward'] }).expect(201);
    await http().post('/api/compliance-rules/CR-PRV-103/owner-transfer').set(ADMIN).send({ toOwnerId: 'usr-safety2', reason: '담당 퇴사' }).expect(409);
    await http().post('/api/accounts/usr-quality/deactivate').set(ADMIN).send({ reason: '퇴사 처리' }).expect(201);
    const r = (await http().post('/api/compliance-rules/CR-PRV-103/owner-transfer').set(ADMIN).send({ toOwnerId: 'usr-safety2', reason: '담당 퇴사' }).expect(201)).body;
    expect(r.ownerId).toBe('usr-safety2');
    await http().post('/api/accounts/usr-quality/reactivate').set(ADMIN).send({ reason: '시험 정리' }).expect(201);
  });

  it('초안 삭제 공용 서비스 — 승인 이력·참조가 있으면 409(대안 안내), 지우면 묘비·감사·이벤트, 지운 ID·번호는 다시 쓰지 않는다', () => {
    const svc = get<DraftDeletionService>(DraftDeletionService);
    const who = { id: 'usr-author', role: 'FEATURE_AUTHOR' as const, correlationId: 'f0-test' };
    let removed = 0;
    const base = { entity: 'sample-draft', recordId: 'SMP-00002', snapshot: { name: '시험 초안' }, reason: '잘못 만든 초안', remove: () => void removed++, componentId: 'KERNEL' };
    expect(() => svc.deleteDraft(who, { ...base, facts: { status: 'DRAFT', draftStatuses: ['DRAFT'], approvals: 1, references: [] } })).toThrow(/승인 이력/);
    try {
      svc.deleteDraft(who, { ...base, facts: { status: 'DRAFT', draftStatuses: ['DRAFT'], approvals: 0, references: [{ kind: '배포 계획', id: 'RP-00001' }] } });
    } catch (e: any) {
      expect(e.details).toMatchObject({ code: 'DRAFT_REFERENCED', alternative: 'MARK_UNUSED' });
    }
    expect(removed).toBe(0);
    const t = svc.deleteDraft(who, { ...base, facts: { status: 'DRAFT', draftStatuses: ['DRAFT'], approvals: 0, references: [] } });
    expect(t).toMatchObject({ entity: 'sample-draft', recordId: 'SMP-00002', deletedBy: 'usr-author' });
    expect(removed).toBe(1);
    expect(() => svc.assertIdFree('sample-draft', 'SMP-00002')).toThrow(/삭제된 ID/);
    expect(() => svc.assertIdFree('sample-draft', 'SMP-00003')).not.toThrow();
    expect(svc.nextId('sample-draft', 'SMP-', 5, ['SMP-00001'])).toBe('SMP-00003');
    const db = get<Db>(DB);
    expect(db.all("SELECT result FROM audit WHERE action = 'SAMPLE_DRAFT_DRAFT_DELETE' ORDER BY id").map((r: any) => r.result)).toEqual(['FAILED', 'FAILED', 'ALLOWED']);
    expect(db.all("SELECT 1 FROM events WHERE type = 'sample-draft.draft.deleted'")).toHaveLength(1);
    expect(() => db.run("DELETE FROM deletion_tombstone WHERE record_id = 'SMP-00002'")).toThrow(/추가만/);
  });

  it('소유자 인가 도우미 — 소유자가 아니면 403·DENIED', () => {
    const audit = get<AuditService>(AuditService);
    const who = { id: 'usr-approver', role: 'FEATURE_APPROVER' as const, correlationId: 'f0-owner' };
    expect(() => assertRecordOwner(audit, who, { ownerId: 'usr-approver' }, { action: 'X', target: 'POL-1' })).not.toThrow();
    expect(() => assertRecordOwner(audit, who, { ownerId: 'usr-author' }, { action: 'POLICY_UPDATE', target: 'POL-1', what: '이 정책' })).toThrow('이 정책은 소유자(usr-author)만 수정할 수 있습니다');
    expect(get<Db>(DB).all("SELECT 1 FROM audit WHERE action = 'POLICY_UPDATE' AND result = 'DENIED'")).toHaveLength(1);
  });
});
