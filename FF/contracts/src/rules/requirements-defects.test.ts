// 기능명세서 결함 기록 → 회귀 시험. readiness: RD-FN-01 — FR-REG-002-008/009(출시 시 9 Gate 재확인)를 고쳤다(it.fails → it).
// 새 결함은 it.fails로 기록하고 harness/requirements/review.json defects에 짝을 넣는다(tools/requirements.ts가 맞춰 본다).
import { describe, expect, it } from 'vitest';
import { GATES, type GateStatus } from '../enums';
import { loadDataset } from '../testing/fixtures';
import { evaluateTransition } from './lifecycle';

const ds = loadDataset();
const base = ds.features.find((f) => f.featureId === 'FEAT-00022')!;

describe('기능명세서 결함 기록 — Feature Lifecycle', () => {
  it('FR-REG-002-008 FR-REG-002-009 출시는 9 Gate가 모두 PASS여야 한다 — VERIFIED에서 G3를 FAIL로 다시 판정하면 RELEASED로 갈 수 없다', () => {
    const latestGates = Object.fromEntries(GATES.map((g) => [g, (g === 'G3' ? 'FAIL' : 'PASS') as GateStatus]));
    const r = evaluateTransition({ ...base, lifecycle: 'VERIFIED' }, 'RELEASED', { latestGates, dependencies: [], policyCoverage: 99, actor: { id: 'han.release', role: 'RELEASE_MANAGER' }, reason: '출시' });
    expect(r.blockers).toContainEqual(expect.objectContaining({ code: 'GATE_NOT_PASSED', ref: 'G3' }));
  });
});
