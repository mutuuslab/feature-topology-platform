// 다음 담당자 알림(담당자 E2E W2 — P2-7·P1-4·P4-6 일부) — 변경 요청·검토 의견·Baseline 확정 요청·Release Sign-off·긴급 차단 실행이
// 다음 차례인 사람에게 가는지, 본인은 빠지는지, 감사(조회) 계정이 사후 검토·서명 기록을 받는지.
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_ACCOUNTS, NOTIFICATION_RULES, receives, type NotificationContext } from './notification';

const feature = { featureId: 'FEAT-00196', version: '1.0.0', name: '야간 보행자 경고', ownerId: 'ADAS기획팀' };
const ev = (type: string, payload: Record<string, unknown>, aggregate = 'X'): NotificationContext['event'] => ({ seq: 1, type, at: '2026-11-05T01:00:00.000Z', aggregate, payload });
const build = (type: string, ctx: Omit<NotificationContext, 'event'> & { payload?: Record<string, unknown>; aggregate?: string }) => NOTIFICATION_RULES[type]?.build({ ...ctx, event: ev(type, ctx.payload ?? {}, ctx.aggregate) }) ?? null;
const who = (d: ReturnType<typeof build>) => NOTIFICATION_ACCOUNTS.filter((a) => receives(d!, a)).map((a) => a.id);

describe('다음 담당자 알림', () => {
  it('Feature DB 변경 요청 → 도메인 검토자와 Feature DB 관리자, 요청자 본인은 빼고', () => {
    const d = build('refdb.change.created', { payload: { changeId: 'CR-2026-010', refId: 'AD-LON-002', kind: 'MODIFY', by: 'usr-author' } });
    expect(d).toMatchObject({ category: 'APPROVAL', link: '/master/feature-db/changes/CR-2026-010', exclude: ['usr-author'] });
    expect(d!.recipients).toEqual([{ kind: 'role', role: 'DOMAIN_REVIEWER' }, { kind: 'role', role: 'REFDB_ADMIN' }]);
    expect(who(d)).toEqual(['usr-approver', 'usr-steward']);
    // 관리자가 요청했으면 관리자는 받지 않는다
    expect(who(build('refdb.change.created', { payload: { changeId: 'CR-2026-011', refId: 'AD-LON-002', kind: 'ADD', by: 'usr-steward' } }))).toEqual(['usr-approver']);
  });

  it('보완·반대 의견 → 요청자 한 사람에게, 동의 → Feature DB 관리자(승인 차례)', () => {
    const refChange = { changeId: 'CR-2026-010', refId: 'AD-LON-002', kind: 'MODIFY', requestedBy: 'usr-author', reason: '별칭 추가' };
    const revise = build('refdb.change.reviewed', { refChange, payload: { changeId: 'CR-2026-010', refId: 'AD-LON-002', opinion: 'REVISE', by: 'usr-approver' } });
    expect(revise).toMatchObject({ severity: 'WARNING', recipients: [{ kind: 'user', id: 'usr-author' }] });
    expect(revise!.title).toContain('보완');
    expect(who(revise)).toEqual(['usr-author']);
    const agree = build('refdb.change.reviewed', { refChange, payload: { changeId: 'CR-2026-010', refId: 'AD-LON-002', opinion: 'AGREE', by: 'usr-approver' } });
    expect(who(agree)).toEqual(['usr-steward']);
    // 요청 기록이 없으면 보완 의견을 보낼 곳이 없다 — 알림 없음
    expect(build('refdb.change.reviewed', { refChange: null, payload: { changeId: 'CR-X', refId: 'R', opinion: 'OPPOSE', by: 'usr-approver' } })).toBeNull();
  });

  it('Baseline 확정 요청 → BOM 승인자(PLM 기준정보), 요청자 제외', () => {
    const d = build('baseline.requested', { feature, aggregate: 'FEAT-00196@1.0.0', payload: { requestId: 'BR-00002', featureId: 'FEAT-00196', version: '1.0.0', by: 'usr-author' } });
    expect(d).toMatchObject({ category: 'APPROVAL', link: '/baselines?request=BR-00002' });
    expect(d!.fields[0].value).toBe('FEAT-00196 야간 보행자 경고 1.0.0');
    expect(who(d)).toEqual(['usr-steward']);
  });

  it('Release Sign-off → 출시 담당·상품 Owner·감사, 서명한 Feature Owner 본인은 빼고', () => {
    const d = build('release.signed', { feature, payload: { featureId: 'FEAT-00196', version: '1.0.0', ownerId: 'ADAS기획팀', signedBy: 'usr-author' } });
    expect(d).toMatchObject({ category: 'APPROVAL', link: '/features/FEAT-00196/1.0.0', exclude: ['usr-author'] });
    const to = who(d);
    expect(to).toContain('usr-coordinator');
    expect(to).toContain('usr-viewer');
    expect(to).not.toContain('usr-author');
  });

  it('긴급 차단 실행 → 감사(조회) 계정도 받는다 — 24시간 사후 검토 차례(조회 계정 알림이 비지 않게)', () => {
    const kill = { killId: 'KILL-00003', featureId: 'FEAT-00022', featureIds: ['FEAT-00022'], flagKeys: ['f'], vins: ['V1'], reason: '결함', requestedBy: 'usr-operator', requestedAt: '2026-11-05T00:00:00.000Z' };
    expect(who(build('kill.issued', { kill, payload: { commandId: 'CMD-1' } }))).toContain('usr-viewer');
  });
});
