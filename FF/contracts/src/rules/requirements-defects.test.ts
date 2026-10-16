// 기능명세서 결함 기록 — harness/requirements/review.json의 defects와 짝을 이룬다(tools/requirements.ts가 맞춰 본다).
// it.fails: 결함이 그대로면 통과한다. 고치면 이 시험이 실패한다 → it(으로 바꾸고, review.json 결함 목록에서 빼고, 판정을 갱신한다.
import { describe, expect, it } from 'vitest';
import { GATES, type GateStatus } from '../enums';
import { loadDataset } from '../testing/fixtures';
import { evaluateTransition } from './lifecycle';

const ds = loadDataset();
const base = ds.features.find((f) => f.featureId === 'FEAT-00022')!;

describe('기능명세서 결함 기록 — Feature Lifecycle', () => {
  it.fails('FR-REG-002-008 FR-REG-002-009 출시는 9 Gate가 모두 PASS여야 한다 — VERIFIED에서 G3를 FAIL로 다시 판정하면 RELEASED로 갈 수 없다', () => {
    const latestGates = Object.fromEntries(GATES.map((g) => [g, (g === 'G3' ? 'FAIL' : 'PASS') as GateStatus]));
    const r = evaluateTransition({ ...base, lifecycle: 'VERIFIED' }, 'RELEASED', { latestGates, dependencies: [], policyCoverage: 99, actor: { id: 'han.release', role: 'RELEASE_MANAGER' }, reason: '출시' });
    expect(r.blockers).toContainEqual(expect.objectContaining({ code: 'GATE_NOT_PASSED', ref: 'G3' }));
  });
});
