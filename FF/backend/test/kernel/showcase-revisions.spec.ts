import { describe, expect, it, vi } from 'vitest';
import { type ModuleRef } from '@nestjs/core';
import { PolicySpec, type Publication } from '@ff/contracts';
import { ShowcaseFillSeeder } from '../../src/demo-activity/showcase-fill.seeder';
import { CarlaAdapter } from '../../src/adapters/sim/carla.adapter';
import { Clock } from '../../src/kernel/clock';
import { type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { PolicyService } from '../../src/domains/d01-policy/policy-store/policy.service';
import { SafetyProfileService } from '../../src/domains/d01-policy/registry/safety-profile.service';
import { RollbackService } from '../../src/domains/d03-safety/restore/rollback.service';
import { PublicationRepo } from '../../src/domains/d06-qsec/secure-deploy/publication.repo';

/** Queue-order regression only. Actual signatures/vehicle replies/guards remain covered by showcase-fill.spec. */
function fixture(results: Publication['status'][]) {
  const order: string[] = [];
  const statuses = new Map<string, Publication['status']>();
  const old = results.map((_, i) => ({ ...PolicySpec.parse({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: `care_00022_test${i}`, description: 'Original' }), policyId: `POL-${String(i + 1).padStart(5, '0')}`, status: 'DEPLOYED' }));
  const created = new Map<string, number>();
  let sequence = 0;
  const requestPolicyRollback = vi.fn((_actor, policyId, body) => {
    order.push(`request:${policyId}`);
    expect(['CONFIRMED', 'PARTIAL']).toContain(statuses.get(body.expectedDeploymentId));
    return { requestId: `RR-${policyId}`, status: 'REQUESTED' };
  });
  const services = new Map<unknown, unknown>([
    [Scheduler, { manual: false }], [CarlaAdapter, { installed: false }],
    [SafetyProfileService, { list: () => [{ version: '1.0.0', fClass: 'F0' }] }],
    [PolicyRepo, { all: () => old }],
    [RollbackService, { candidates: () => [], requestPolicyRollback }],
    [PublicationRepo, { get: (id: string) => statuses.has(id) ? { status: statuses.get(id) } : undefined }],
    [PolicyService, {
      create: (_actor: unknown, spec: object) => {
        const index = sequence++, policyId = `POL-${String(index + 10).padStart(5, '0')}`;
        created.set(policyId, index); order.push(`create:${index}`);
        return { ...spec, policyId };
      },
      validate: async (_actor: unknown, policyId: string) => {
        order.push(`validate:${created.get(policyId)}`);
        return { run: { decision: 'GO', reasons: [] } };
      },
      decide: vi.fn(),
      deploy: (_actor: unknown, policyId: string) => {
        const index = created.get(policyId)!, publicationId = `PUB-${index}`;
        statuses.set(publicationId, 'DISPATCHED'); order.push(`deploy:${index}`);
        setTimeout(() => { statuses.set(publicationId, results[index]); order.push(`reply:${index}`); }, 10);
        return { publicationId, stageBasisPoints: null };
      },
    }],
  ]);
  const ref = { get: (type: unknown) => {
    if (!services.has(type)) throw new Error('Unexpected service');
    return services.get(type);
  } } as unknown as ModuleRef;
  const seed = new ShowcaseFillSeeder({} as Db, ref, {} as Clock);
  return { run: () => (seed as unknown as { revisions(): Promise<string> }).revisions(),
    exhaustWait: () => vi.spyOn(seed as unknown as { until(): Promise<boolean> }, 'until').mockResolvedValue(false),
    order, requestPolicyRollback };
}

describe('showcase revisions actual-publication barrier', () => {
  it('waits for the first real terminal reply before validating/deploying the next revision', async () => {
    const f = fixture(['CONFIRMED', 'PARTIAL']);
    const result = await f.run();
    expect(f.order.indexOf('reply:0')).toBeLessThan(f.order.indexOf('create:1'));
    expect(f.order.indexOf('reply:0')).toBeLessThan(f.order.indexOf('validate:1'));
    expect(f.order.indexOf('reply:1')).toBeLessThan(f.order.indexOf('request:POL-00010'));
    expect(f.requestPolicyRollback).toHaveBeenCalledTimes(2);
    expect(result.match(/REQUESTED/g)).toHaveLength(2);
    expect(f.requestPolicyRollback.mock.calls[0][2]).toMatchObject({ recovery: { policyId: 'POL-00001' }, expectedDeploymentId: 'PUB-0', approvers: ['usr-opslead'] });
  });

  it.each(['TIMEOUT', 'DIVERGED'] as const)('propagates %s as an incomplete step and never manufactures a rollback request', async status => {
    const f = fixture([status]);
    await expect(f.run()).rejects.toThrow(`회신 미완(${status})`);
    expect(f.requestPolicyRollback).not.toHaveBeenCalled();
  });

  it('stops before the next revision when the bounded wait returns false', async () => {
    const f = fixture(['CONFIRMED', 'CONFIRMED']);
    const wait = f.exhaustWait();
    await expect(f.run()).rejects.toThrow('회신 미완(DISPATCHED)');
    expect(wait).toHaveBeenCalledTimes(1);
    expect(f.order).not.toContain('create:1');
    expect(f.requestPolicyRollback).not.toHaveBeenCalled();
  });
});
