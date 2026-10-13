// vECU 가상검증 실행기 출력 계약 (IF-09 공급자: C:\project\2026-10-11_vECU tools/ffval_cli.mjs, 시험 대역 backend/test/fixtures/fake-vecu).
// stdin 패키지 → --out 증적 → stdout JSON 한 줄. FF는 이 스키마로 읽어서, vECU가 형식·기준 ID를 바꾸면 조용히 잘못 읽지 않고
// "계약 위반"으로 실행을 거부한다(증적 불인정). vECU 쪽 약속: verdict items 필드(id·status·value·limit·role)·기준 ID를 바꾸면 미리 알린다.
import { z } from 'zod';

export const VecuCriterionStatus = z.enum(['pass', 'fail', 'pending', 'na']);

export const VecuCriterion = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    unit: z.string(),
    op: z.enum(['<=', '>=', '<', '>', '==']),
    limit: z.number(),
    status: VecuCriterionStatus,
    /** 기준을 끝까지 못 채우면 Infinity → JSON에서 null */
    value: z.number().nullable(),
    at: z.number().nullable(),
    /** 시나리오가 criteria:{gate, info}를 주면 붙는다 — 없으면 전부 판정 기준 */
    role: z.enum(['gate', 'info']).optional(),
  })
  .passthrough();
export type VecuCriterion = z.infer<typeof VecuCriterion>;

export const VecuRunOutput = z
  .object({
    scenarioId: z.string().nullable(),
    testId: z.string().min(1),
    overall: z.enum(['PASS', 'FAIL', 'RUNNING']),
    criteria: z.array(VecuCriterion).min(1),
    minTimeGap: z.number().nullable(),
    evaluation: z.object({ value: z.boolean(), decision: z.string(), reason: z.string() }).passthrough().nullable(),
    dir: z.string().min(1),
    files: z.array(z.object({ name: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().min(0) })).min(1),
  })
  .passthrough();
export type VecuRunOutput = z.infer<typeof VecuRunOutput>;

export const VecuCliOutput = z.object({ tool: z.literal('vecu-ffval'), simulator: z.string().min(1), runs: z.array(VecuRunOutput).min(1) }).passthrough();
export type VecuCliOutput = z.infer<typeof VecuCliOutput>;

/** FF가 Gate 판정(rules/virtual.ts deciding)에 쓰는 기준 ID — 실제 vECU는 시나리오마다 이것을 모두 내야 한다 */
export const VECU_REQUIRED_CRITERIA = ['kill_latency', 'misjudge', 'danger_time', 'min_ttc', 'max_decel', 'recovery'] as const;

/** 증적으로 반드시 남아야 하는 파일 (시험 대역은 verdict·report만 쓴다) */
export const VECU_REQUIRED_FILES = ['verdict.json', 'report.html'] as const;
