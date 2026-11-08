import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FleetRepo, PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
describe('Shadow missing evidence cannot authorize ADOPT', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({app, http} = await bootApp({ at: '2026-10-12T01:00:00Z', showcaseFill: false })));
  afterAll(() => app.close());
  it.each(['no baseline', 'no vehicles'] as const)('%s rejects adoption without changing running state', async kind => {
    app.get(Clock).set('2026-10-12T01:00:00Z');
    const repo = app.get(PolicyRepo);
    const source = repo.get('POL-00002')!;
    const policyId = kind === 'no baseline' ? 'POL-99990' : source.policyId;
    if (kind === 'no baseline') repo.insert({...source, policyId, flagKey: 'shadow_no_baseline', status: 'DRAFT'});
    const e = (await http().post('/api/experiments').set(AUTHOR).send({policyId, type:'SHADOW', hypothesis:'비교 근거가 없으면 채택을 보류한다', metric:'DECISION_AGREEMENT', treatmentBp:5000, minSamples:100}).expect(201)).body;
    await http().post(`/api/experiments/${e.experimentId}/start`).set(RELEASE).send({}).expect(200);
    app.get(Clock).set('2026-10-15T01:00:00Z');
    const empty = kind === 'no vehicles' ? vi.spyOn(app.get(FleetRepo), 'vehicles').mockReturnValue([]) : null;
    try {
      const r = (await http().get(`/api/experiments/${e.experimentId}`).expect(200)).body.results;
      expect(r).toMatchObject({enough:true, verdict:'INSUFFICIENT', fleet:{agreement:0, comparableVehicles:0, comparisonStatus:kind === 'no baseline' ? 'NO_BASELINE' : 'NO_VEHICLES'}});
      const rejected = await http().post(`/api/experiments/${e.experimentId}/conclude`).set(RELEASE).send({decision:'ADOPT', reason:'검토 완료'}).expect(422);
      expect(rejected.body.error.details.verdict).toBe('INSUFFICIENT');
      expect((await http().get(`/api/experiments/${e.experimentId}`).expect(200)).body.status).toBe('RUNNING');
    } finally { empty?.mockRestore(); }
  });
});
