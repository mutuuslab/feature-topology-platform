// AI 생성 코드 변경 기록 — FFG-CODE-030: AI 표시 변경은 도구·Version·범위가 필수이고, 근거 판정은 사람 변경과 같다
import { describe, expect, it } from 'vitest';
import { ChangeRecordBody, changeRecordFindings } from './change-record';

const full = { review: 'PR-1', staticAnalysis: 'SA-1', tests: 'T-1', coverage: { achieved: 85, required: 80 } };
const rec = (ai: unknown, evidence: unknown) => ({ changeId: 'CHG-1-A', swId: 'SW-CARE-SDIST-APP', swVersion: '1.2.1', commit: 'abcdef1', summary: '수정', aiGenerated: ai, evidence });

describe('AI 생성 코드 변경 기록 (FFG-CODE-030)', () => {
  it('FFG-CODE-030 AI 표시는 도구·Version·범위가 모두 있어야 기록된다', () => {
    expect(ChangeRecordBody.safeParse(rec({ tool: 'Claude Code', toolVersion: '1.0', scope: 'distance.c' }, full)).success).toBe(true);
    expect(ChangeRecordBody.safeParse(rec({ tool: 'Claude Code', toolVersion: '1.0' }, full)).success).toBe(false);
    expect(ChangeRecordBody.safeParse(rec(null, full)).success).toBe(true);
  });

  it('FFG-CODE-030 근거 누락·커버리지 미달은 AI 여부와 무관하게 같은 발견', () => {
    const none = { review: null, staticAnalysis: null, tests: null, coverage: null };
    const ai = { tool: 'X', toolVersion: '1', scope: 's' };
    expect(changeRecordFindings({ aiGenerated: ai, evidence: full })).toEqual([]);
    expect(changeRecordFindings({ aiGenerated: ai, evidence: none })).toEqual(['검토 기록 없음', '정적 분석 기록 없음', '시험 기록 없음', '커버리지 기록 없음']);
    expect(changeRecordFindings({ aiGenerated: null, evidence: none })).toEqual(changeRecordFindings({ aiGenerated: ai, evidence: none }));
    expect(changeRecordFindings({ aiGenerated: ai, evidence: { ...full, coverage: { achieved: 79.5, required: 80 } } })).toEqual(['커버리지 79.5% < 기준 80%']);
  });
});
