// Feature DB 등록 기준(30-95 §8.2, 엑셀 15_DB운영 2절) — 자동 점검과 새 ID 부여(재사용 금지)
import { describe, expect, it } from 'vitest';
import { advisoryFailures, blockingFailures, checkRegistration, nextRefId } from './registration-criteria';
import { refRow } from '../../testing/refdb';

const ctx = { kind: 'ADD' as const, usedIds: ['CH-BRK-006', 'CH-BRK-007', 'CH-BRK-008'], sourceIds: ['S01', 'S02'] };
const failed = (r: ReturnType<typeof checkRegistration>) => r.filter((x) => !x.ok).map((x) => x.id);

describe('Feature DB 등록 기준', () => {
  it('기준을 모두 채운 새 행은 통과한다', () => {
    const r = checkRegistration(refRow(), ctx);
    expect(failed(r)).toEqual([]);
    expect(r.map((x) => x.id)).toEqual(['ID_FORMAT', 'ID_REUSE', 'ID_DOMAIN', 'REQUIRED_INFO', 'PRIMARY_SOURCE', 'SIZE_EVIDENCE', 'DUPLICATE_REF', 'REQUIRES_TARGETS', 'SOURCE_REGISTERED', 'ADMIN_INFO']);
  });

  it('ID 형식·재사용은 막는다 — 폐기한 ID도 다시 쓰지 않는다', () => {
    expect(blockingFailures(checkRegistration(refRow({ refId: 'CHBRK-9' }), ctx)).map((x) => x.id)).toEqual(['ID_FORMAT']);
    expect(blockingFailures(checkRegistration(refRow({ refId: 'CH-BRK-007' }), ctx)).map((x) => x.id)).toEqual(['ID_REUSE']);
    // 수정은 반대로 있는 행이어야 한다
    expect(failed(checkRegistration(refRow({ refId: 'CH-BRK-007' }), { ...ctx, kind: 'MODIFY' }))).toEqual([]);
    expect(failed(checkRegistration(refRow({ refId: 'CH-BRK-099' }), { ...ctx, kind: 'RETIRE' }))).toEqual(['ID_REUSE']);
  });

  it('ID 형식은 엑셀 값(숫자 든 컴포넌트 약어 V2X, 4글자 SOVD)을 받는다', () => {
    for (const id of ['CO-V2X-003', 'PL-SOVD-001', 'BC-HVAC-002', 'PL-AP-021']) expect(failed(checkRegistration(refRow({ refId: id, domain: undefined }), ctx))).not.toContain('ID_FORMAT');
  });

  it('필수 정보 누락은 막고, 나머지는 보완 필요로만 표시한다', () => {
    const r = checkRegistration(refRow({ nameKo: '', sourceIds: [], sourceDetail: '', sizeEvidenceGrade: null, duplicateOf: 'CH-BRK-001', requires: ['PL-AP-001'], evidenceCheckedAt: null }), ctx);
    expect(blockingFailures(r).map((x) => x.id)).toEqual(['REQUIRED_INFO']);
    expect(blockingFailures(r)[0].message).toBe('필수 정보 누락: 한글 기능명·출처 ID');
    expect(advisoryFailures(r).map((x) => x.id)).toEqual(['PRIMARY_SOURCE', 'SIZE_EVIDENCE', 'DUPLICATE_REF', 'REQUIRES_TARGETS', 'ADMIN_INFO']);
  });

  it('등록 화면 추가 요청(ADD)은 출처 ID 대신 근거 메모로 필수 정보를 채운다 — 수정 요청은 여전히 출처 ID가 필요하다', () => {
    // 회귀: 근거 메모만 있는 추가 요청이 승인 단계에서 '필수 정보 누락: 출처 ID'로 막혀 반려 말고는 끝낼 길이 없었다(2026-11-04 e2e)
    const basis = refRow({ sourceIds: [], sourceDetail: '', basisType: '근거 메모', remark: '협력사 사양서 2026-10판 4.2절' });
    expect(blockingFailures(checkRegistration(basis, ctx))).toEqual([]);
    expect(advisoryFailures(checkRegistration(basis, ctx)).map((x) => x.id)).toContain('PRIMARY_SOURCE');
    expect(blockingFailures(checkRegistration(refRow({ refId: 'CH-BRK-007', sourceIds: [], basisType: '근거 메모', remark: '메모' }), { ...ctx, kind: 'MODIFY' })).map((x) => x.id)).toEqual(['REQUIRED_INFO']);
    expect(blockingFailures(checkRegistration(refRow({ sourceIds: [], basisType: '근거 메모', remark: '' }), ctx)).map((x) => x.id)).toEqual(['REQUIRED_INFO']);
  });

  it('출처 표에 없는 출처·도메인과 맞지 않는 ID 약어는 보완 필요', () => {
    const r = checkRegistration(refRow({ refId: 'BC-BRK-001', sourceIds: ['S99'] }), ctx);
    expect(blockingFailures(r)).toEqual([]);
    expect(advisoryFailures(r).map((x) => x.id)).toEqual(['ID_DOMAIN', 'SOURCE_REGISTERED']);
  });

  it('규모 근거 C·D는 비교 행 메모(비고)가 있어야 한다', () => {
    expect(failed(checkRegistration(refRow({ sizeEvidenceGrade: 'D', remark: '' }), ctx))).toEqual(['SIZE_EVIDENCE']);
    expect(failed(checkRegistration(refRow({ sizeEvidenceGrade: 'A', remark: '' }), ctx))).toEqual([]);
  });

  it('새 ID는 같은 접두 최대 번호 다음 — 빈 번호(폐기·반려)를 채우지 않는다', () => {
    expect(nextRefId('CH', 'BRK', ['CH-BRK-001', 'CH-BRK-009', 'CH-STR-020', 'BC-BCM-050'])).toBe('CH-BRK-010');
    expect(nextRefId('CH', 'BRK', ['CH-BRK-002'])).toBe('CH-BRK-003'); // 001 이 비었어도 다시 쓰지 않는다
    expect(nextRefId('SF', 'AIS', [])).toBe('SF-AIS-001');
    expect(nextRefId('CO', 'V2X', ['CO-V2X-020'])).toBe('CO-V2X-021');
    expect(() => nextRefId('CH', 'BRK', ['CH-BRK-999'])).toThrow(/999/);
    expect(() => nextRefId('ch', 'brk', [])).toThrow(/형식/);
  });
});
