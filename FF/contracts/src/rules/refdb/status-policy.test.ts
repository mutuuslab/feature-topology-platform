// Feature DB 상태 정책(30-95 §5.2) — 상태별 등록 선택·경고·승인 막음·산정 사용, 연결 승인 막음 점검
import { describe, expect, it } from 'vitest';
import { REF_STATUSES } from '../../schemas/refdb';
import { REF_STATUS_POLICY, refLinksBlockApproval } from './status-policy';

describe('Feature DB 상태 정책', () => {
  it('§5.2 표 그대로 — 활성 선택, 검토 필요·폐기 예정 선택+경고, 폐기 선택 불가, 요청 중은 승인·산정 불가', () => {
    const row = (s: (typeof REF_STATUSES)[number]) => {
      const p = REF_STATUS_POLICY[s];
      return [p.selectable, p.warn, p.blocksApproval, p.costUsable];
    };
    expect(Object.keys(REF_STATUS_POLICY).sort()).toEqual([...REF_STATUSES].sort());
    expect(row('ACTIVE')).toEqual([true, false, false, true]);
    expect(row('REVIEW')).toEqual([true, true, false, true]);
    expect(row('DEPRECATED')).toEqual([true, true, false, true]);
    expect(row('RETIRED')).toEqual([false, true, true, false]);
    expect(row('PENDING')).toEqual([true, true, true, false]);
  });

  it('연결된 기준 행 중 요청 중·폐기·없는 행이 정의 승인을 막는다', () => {
    const status = { 'CH-BRK-009': 'ACTIVE', 'CH-BRK-006': 'PENDING', 'BC-BCM-001': 'RETIRED', 'BC-BCM-002': 'REVIEW' } as const;
    const links = [
      { refId: 'CH-BRK-009', role: 'PRIMARY' as const },
      { refId: 'CH-BRK-006', role: 'INCLUDED' as const },
      { refId: 'BC-BCM-001', role: 'INCLUDED' as const },
      { refId: 'BC-BCM-002', role: 'INCLUDED' as const },
      { refId: 'BC-BCM-999', role: 'INCLUDED' as const },
    ];
    const out = refLinksBlockApproval(links, (id) => status[id as keyof typeof status]);
    expect(out.map((b) => [b.refId, b.status])).toEqual([
      ['CH-BRK-006', 'PENDING'],
      ['BC-BCM-001', 'RETIRED'],
      ['BC-BCM-999', null],
    ]);
    expect(out[0].message).toMatch(/요청 중/);
    expect(refLinksBlockApproval(links.slice(0, 1), () => 'ACTIVE')).toEqual([]);
  });
});
