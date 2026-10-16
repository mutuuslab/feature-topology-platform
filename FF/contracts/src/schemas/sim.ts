// 가상검증 실행기 출력 계약 (IF-09 가상검증 공급자: CARLA 0.9.16 실행기 sim/carla/ffcarla_cli.py, 시험 대역 backend/test/fixtures/fake-carla).
// stdin 패키지 → --out Evidence → stdout JSON 한 줄. FF는 이 스키마로 읽어서, 실행기가 형식·기준 ID를 바꾸면 조용히 잘못 읽지 않고
// "계약 위반"으로 실행을 거부한다(Evidence 불인정). 실행기는 FF 저장소 안에 있으므로 계약과 함께 바뀐다(sim/carla/tests).
import { z } from 'zod';

export const SimCriterionStatus = z.enum(['pass', 'fail', 'pending', 'na']);

export const SimCriterion = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    unit: z.string(),
    op: z.enum(['<=', '>=', '<', '>', '==']),
    limit: z.number(),
    status: SimCriterionStatus,
    /** 기준을 끝까지 못 채우면(미반영·미복귀) null — status가 fail을 말한다 */
    value: z.number().nullable(),
    at: z.number().nullable(),
    role: z.enum(['gate', 'info']).optional(),
  })
  .passthrough();
export type SimCriterion = z.infer<typeof SimCriterion>;

export const SimRunOutput = z
  .object({
    scenarioId: z.string().nullable(),
    testId: z.string().min(1),
    overall: z.enum(['PASS', 'FAIL', 'RUNNING']),
    criteria: z.array(SimCriterion).min(1),
    minTimeGap: z.number().nullable(),
    evaluation: z.object({ value: z.boolean(), decision: z.string(), reason: z.string() }).passthrough().nullable(),
    /** 재현 정보 — 없으면 FF는 실행을 거부하지 않지만 G5 근거로 인정하지 않는다(rules/virtual.ts judgeVirtual) */
    repro: z.record(z.unknown()).nullable().optional(),
    dir: z.string().min(1),
    files: z.array(z.object({ name: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().min(0) })).min(1),
  })
  .passthrough();
export type SimRunOutput = z.infer<typeof SimRunOutput>;

export const SimCliOutput = z.object({ tool: z.literal('ff-carla'), simulator: z.string().min(1), runs: z.array(SimRunOutput).min(1) }).passthrough();
export type SimCliOutput = z.infer<typeof SimCliOutput>;

/** FF가 Gate 판정(rules/virtual.ts deciding)에 쓰는 기준 ID — 실행기는 시나리오마다 이것을 모두 내야 한다 */
export const SIM_REQUIRED_CRITERIA = ['kill_latency', 'deact_time', 'detect_latency', 'ftti_margin', 'misjudge', 'danger_time', 'min_ttc', 'max_decel', 'recovery'] as const;

/** Evidence로 반드시 남아야 하는 파일 — carla_recording.log는 같은 주행을 CARLA로 다시 재생하는 재현 근거 */
export const SIM_REQUIRED_FILES = ['verdict.json', 'report.html', 'carla_recording.log'] as const;

/** 실행기 연결 상태 (GET /api/sim/status) */
export interface SimStatus {
  available: boolean;
  mode: 'auto' | 'off';
  simulator: 'CARLA';
  host: string;
  port: number;
  /** 서버가 응답했을 때 — 버전·맵·동기 모드·FF가 만들지 않은 차량 수(0이어야 전용 서버) */
  server: { version: string; map: string; synchronous: boolean; vehicles: number; foreignVehicles: number } | null;
  runner: string;
  python: string;
  reason: string | null;
  /** 지금 돌고 있는 실행 수·대기 수 — 서버 하나를 같이 쓰므로 한 번에 하나 */
  queue: { running: number; waiting: number };
}
