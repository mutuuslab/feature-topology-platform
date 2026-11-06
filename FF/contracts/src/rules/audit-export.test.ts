// 감사·이력 조회 보강(B4) — 기간 조건·민감 값 가림·변경 전후 값·CSV 파일 형식.
import { describe, expect, it } from 'vitest';
import { csvBody, csvCell, csvFile, fieldChanges, LEGACY_MONEY_MASK, maskSensitive, periodBounds, SENSITIVE_MASK } from './audit-export';

describe('기간 조건', () => {
  it('날짜 끝은 그날 끝까지(다음 날 0시 미만), 시각은 그대로', () => {
    expect(periodBounds('2026-11-01', '2026-11-05')).toEqual({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' });
    expect(periodBounds(undefined, '2026-11-05T10:00:00Z')).toEqual({ to: '2026-11-05T10:00:00.000Z' });
  });
  it('읽을 수 없거나 거꾸로면 오류', () => {
    expect(periodBounds('2026-13-01').error).toBeTruthy();
    expect(periodBounds('어제').error).toBeTruthy();
    expect(periodBounds('2026-11-05', '2026-11-01').error).toBeTruthy();
  });
});

describe('민감 값 가림', () => {
  it('금액·벤치마크 키는 값 대신 가림 자리, 중첩·배열 안까지. 빈 값은 그대로', () => {
    expect(maskSensitive({ name: 'A', benchmarkEur: 1200, nested: { unitPrice: 3, label: 'x' }, list: [{ totalCost: 9 }], kearneyNote: '' })).toEqual({
      name: 'A',
      benchmarkEur: SENSITIVE_MASK,
      nested: { unitPrice: SENSITIVE_MASK, label: 'x' },
      list: [{ totalCost: SENSITIVE_MASK }],
      kearneyNote: '',
    });
  });
});

describe('변경 전후 값', () => {
  it('바뀐 필드만 점 경로로, 배열은 통째로', () => {
    expect(fieldChanges({ rollout: { mode: 'COHORT', basisPoints: 500 }, tags: ['a'] }, { rollout: { mode: 'COHORT', basisPoints: 2500 }, tags: ['a', 'b'] })).toEqual([
      { field: 'rollout.basisPoints', before: 500, after: 2500, masked: false },
      { field: 'tags', before: ['a'], after: ['a', 'b'], masked: false },
    ]);
  });
  it('민감 키·이미 가린 값은 바뀐 사실만(값은 가림)', () => {
    expect(fieldChanges({ benchmarkEur: 100 }, { benchmarkEur: 200 })).toEqual([{ field: 'benchmarkEur', before: SENSITIVE_MASK, after: SENSITIVE_MASK, masked: true }]);
    expect(fieldChanges({ note: LEGACY_MONEY_MASK }, { note: 'x' })[0].masked).toBe(true);
    expect(fieldChanges({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe('CSV 파일', () => {
  it('쉼표·따옴표·줄바꿈은 따옴표로, 수식 시작 글자는 작은따옴표를 붙인다', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(null)).toBe('');
  });
  it('머리글 # 줄에 범위·행 수·SHA-256·서명, 그 뒤 데이터 줄(CRLF)', () => {
    const body = csvBody(['id', 'action'], [{ id: 1, action: 'POLICY_VIEW' }]);
    expect(body).toBe('id,action\r\n1,POLICY_VIEW\r\n');
    const f = csvFile({ kind: 'audit', generatedAt: 'T', generatedBy: 'usr-viewer', period: { from: 'F', to: null }, integrity: { rows: 1, sha256: 'h', chainFrom: 'p', chainTo: 'q', signature: { keyId: 'KEY-1', alg: 'Ed25519', payloadHash: 'x', signature: 's' } } }, body);
    expect(f.split('\r\n').filter((l) => l.startsWith('#'))).toEqual([
      '# Feature Flag Platform 감사 이력 내보내기',
      '# generatedAt=T generatedBy=usr-viewer',
      '# period=F.. rows=1',
      '# sha256=h (아래 데이터 줄 전체)',
      '# chain=p..q',
      '# signature=Ed25519:KEY-1:s',
    ]);
    expect(f.endsWith(body)).toBe(true);
  });
});
