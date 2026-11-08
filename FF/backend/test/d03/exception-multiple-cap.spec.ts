Object.assign(process.env, { FF_SCHEDULER: 'manual' });
import { afterAll, describe, expect, it } from 'vitest';
import { type ExceptionPolicy } from '@ff/contracts';
import { ExceptionPolicyService, ExceptionRepo } from '../../src/domains/d03-safety/exception-policy/exception-policy.service';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { bootApp } from '../helpers';
import { DB, type Db } from '../../src/kernel/db';

afterAll(() => { delete process.env.FF_SCHEDULER; });
describe('GX multiple applied exception limits', () => {
  it('completes only its own Gate scope, retains stricter BYPASS and its later revoke stop', async () => {
    const { app } = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
    try {
      const repo = app.get(ExceptionRepo), policies = app.get(PolicyRepo), service = app.get(ExceptionPolicyService);
      const p = policies.get('POL-00001')!;
      const common = { featureId: p.featureId, featureVersion: p.featureVersion, reason: 'multiple exceptions regression', periodHours: 24, dueDate: '2026-10-13', residualRisk: 'pending work', status: 'ACTIVE', requestedBy: 'usr-coordinator', requestedAt: '2026-10-12T01:00:00.000Z', appliedAt: '2026-10-12T01:00:00.000Z', expiresAt: '2026-10-12T20:00:00.000Z', closedAt: null, rejection: null, revert: null, approvals: [{ by: 'usr-quality', role: 'SAFETY_OFFICER', reason: 'review', at: '2026-10-12T01:00:00.000Z', expiresAt: '2026-10-12T20:00:00.000Z' }, { by: 'usr-opslead', role: 'OPS_LEAD', reason: 'review', at: '2026-10-12T01:00:00.000Z', expiresAt: '2026-10-12T20:00:00.000Z' }], applications: [{ policyId: p.policyId, flagKey: p.flagKey, at: '2026-10-12T01:00:00.000Z', by: 'usr-coordinator', prior: null, capBasisPoints: 100 }] };
      const gate = { ...common, exceptionId: 'EXC-99001', kind: 'GATE_PENDING', policyId: null, checks: [], ruleIds: [], gates: ['G8'], restriction: 'LIMITED' } as ExceptionPolicy;
      const bypass = { ...common, exceptionId: 'EXC-99002', kind: 'BYPASS', policyId: p.policyId, checks: ['FLAG_CODE'], ruleIds: [], gates: [], restriction: 'PILOT' } as ExceptionPolicy;
      repo.save(gate); repo.save(bypass);
      policies.update({ ...p, status: 'DEPLOYED', stageBasisPoints: 100, exceptionScope: { exceptionIds: [gate.exceptionId, bypass.exceptionId], restriction: 'PILOT', capBasisPoints: 100 } });
      // Completion is reached only after trusted PASS checks in sweep; exercise the mutation itself.
      app.get<Db>(DB).tx(() => (service as any).complete(gate));
      expect(repo.get(gate.exceptionId)?.status).toBe('COMPLETED');
      expect(policies.get(p.policyId)?.exceptionScope).toEqual({ exceptionIds: [bypass.exceptionId], restriction: 'PILOT', capBasisPoints: 100 });
      expect(repo.get(bypass.exceptionId)).toMatchObject({ status: 'ACTIVE', applications: bypass.applications });
      app.get<Db>(DB).tx(() => (service as any).close({ id: 'usr-quality', role: 'SAFETY_OFFICER', correlationId: 'multi-cap' }, repo.get(bypass.exceptionId), 'REVOKED', 'remaining bypass revoked'));
      expect(policies.get(p.policyId)?.stageBasisPoints).toBe(0);
      expect(repo.get(bypass.exceptionId)?.revert?.message).toMatch(/0%/);
    } finally { await app.close(); }
  });
});
