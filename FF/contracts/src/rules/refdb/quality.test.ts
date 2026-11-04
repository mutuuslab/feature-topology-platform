// Feature DB 품질 지표(30-95 §8.4, 엑셀 15_DB운영 4절)
import { describe, expect, it } from 'vitest';
import type { RefChange } from '../../schemas/refdb';
import { refRow } from '../../testing/refdb';
import { compareRelease, refQuality } from './quality';

const change = (status: RefChange['status'], n: number): RefChange => ({
  changeId: `CR-2026-0${10 + n}`,
  kind: 'MODIFY',
  refId: 'CH-BRK-009',
  before: { tshirt: 'S' },
  after: { tshirt: 'M' },
  reason: '실적 반영',
  requestedBy: 'usr-author',
  requestedAt: '2026-11-01T00:00:00.000Z',
  status,
  reviews: [],
  decision: null,
  release: null,
});
const HASH = 'a'.repeat(64);

describe('Feature DB 품질 지표', () => {
  it('행 수·상태별 수·출처 없음·근거 확인 12개월 경과·D 비중·발행 대기를 센다', () => {
    const rows = [
      refRow({ refId: 'CH-BRK-001', sizeEvidenceGrade: 'D' }),
      refRow({ refId: 'CH-BRK-002', sizeEvidenceGrade: 'D', status: 'REVIEW', evidenceCheckedAt: '2025-10-01' }),
      refRow({ refId: 'CH-BRK-003', sizeEvidenceGrade: 'C', status: 'DEPRECATED', sourceIds: [] }),
      refRow({ refId: 'CH-BRK-004', sizeEvidenceGrade: 'A', status: 'PENDING', evidenceCheckedAt: null }),
      refRow({ refId: 'CH-BRK-005', status: 'RETIRED', evidenceCheckedAt: null }),
    ];
    const q = refQuality(
      rows,
      [
        { release: 'v1.10', publishedBy: 'usr-steward', publishedAt: '2026-11-02T00:00:00Z', changeIds: [], hash: HASH },
        { release: 'v1.3', publishedBy: 'usr-steward', publishedAt: '2026-11-01T00:00:00Z', changeIds: [], hash: HASH },
      ],
      [change('APPROVED', 1), change('APPROVED', 2), change('REVIEW', 3), change('DRAFT', 4), change('PUBLISHED', 5), change('REJECTED', 6)],
      '2026-11-04T00:00:00.000Z',
    );
    expect(q).toEqual({
      total: 5,
      byStatus: { ACTIVE: 1, REVIEW: 1, DEPRECATED: 1, RETIRED: 1, PENDING: 1 },
      statusMissing: 0,
      noSource: 1,
      evidenceStale: 2, // 2025-10-01(12개월 넘음) + 확인일 없는 요청 중 행 — 폐기 행은 점검 대상이 아니다
      sizeGradeDShare: 2 / 5,
      awaitingPublish: 2,
      openChanges: 2,
      latestRelease: 'v1.10',
    });
  });

  it('빈 Feature DB — 비중 0, 최신 발행 없음', () => {
    expect(refQuality([], [], [], '2026-11-04T00:00:00Z')).toMatchObject({ total: 0, sizeGradeDShare: 0, latestRelease: null });
  });

  it('발행 버전은 숫자로 비교한다(v1.3 < v1.10)', () => {
    expect(compareRelease('v1.3', 'v1.10')).toBeLessThan(0);
    expect(compareRelease('v2.0', 'v1.10')).toBeGreaterThan(0);
  });
});
