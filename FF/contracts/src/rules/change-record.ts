// AI 생성 코드 변경 기록 (보고서 v1.1 · FFG-CODE-030) — AI 도구가 생성·수정한 코드도 사람이 쓴 코드와 같은 검토·정적 분석·시험·커버리지 기준을 통과해야 하고,
// 생성 도구·Version·생성 범위를 변경 기록에 남긴다. 변경 기록은 CI/CD(IF-13)가 SW Version마다 등록한다. 판정은 AI 여부와 무관하게 같다 —
// AI 표시가 있으면 도구·Version·범위가 필수일 뿐이다. 커버리지 기준값은 프로젝트가 정한 값(required)을 기록과 함께 받는다(플랫폼이 정하지 않음).
import { z } from 'zod';

export const ChangeRecordBody = z
  .object({
    changeId: z.string().regex(/^CHG-[A-Za-z0-9-]{3,40}$/),
    swId: z.string().regex(/^SW-[A-Z0-9-]+$/),
    swVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    summary: z.string().trim().min(2).max(300),
    /** AI 도구가 생성·수정한 변경 — 도구·Version·생성 범위 */
    aiGenerated: z.object({ tool: z.string().trim().min(2).max(80), toolVersion: z.string().trim().min(1).max(40), scope: z.string().trim().min(2).max(300) }).strict().nullable(),
    /** 같은 절차의 근거 — 기록 ID(리뷰·정적 분석·시험 실행), 커버리지 달성/기준(%) */
    evidence: z
      .object({
        review: z.string().trim().min(2).nullable(),
        staticAnalysis: z.string().trim().min(2).nullable(),
        tests: z.string().trim().min(2).nullable(),
        coverage: z.object({ achieved: z.number().min(0).max(100), required: z.number().min(0).max(100) }).strict().nullable(),
      })
      .strict(),
  })
  .strict();
export type ChangeRecordBody = z.infer<typeof ChangeRecordBody>;

/**
 * 변경 기록 감사 — 검토·정적 분석·시험·커버리지 근거가 빠졌거나 커버리지가 기준 미달인 항목.
 * @rule FFG-CODE-030 — AI 생성 변경도 같은 검토·분석·시험·커버리지 기준(AI 표시 변경 100%에 기록), 도구·Version·범위 기록
 */
export function changeRecordFindings(r: Pick<ChangeRecordBody, 'aiGenerated' | 'evidence'>): string[] {
  const out: string[] = [];
  const e = r.evidence;
  if (!e.review) out.push('검토 기록 없음');
  if (!e.staticAnalysis) out.push('정적 분석 기록 없음');
  if (!e.tests) out.push('시험 기록 없음');
  if (!e.coverage) out.push('커버리지 기록 없음');
  else if (e.coverage.achieved < e.coverage.required) out.push(`커버리지 ${e.coverage.achieved}% < 기준 ${e.coverage.required}%`);
  return out;
}
