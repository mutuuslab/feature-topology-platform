// P10 integration regressions: explicit rework must require fresh verification;
// a source draft with approval history cannot lose its reviewed relation.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { FeatureRepo, GateRepo } from '../../src/domains/d01-policy/repos';
import { LifecycleService } from '../../src/domains/d01-policy/registry/lifecycle.service';
import { actor, bootApp, withRef } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');

describe('P10 integration: rework and draft deletion safeguards', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => { ({ app, http } = await bootApp({ at: '2026-10-18T01:00:00.000Z', showcaseFill: false })); });
  afterAll(async () => app?.close());

  it('explicit rework stays DEVELOPING across subsequent autoAdvance and preserves old Gate evidence', async () => {
    // Use the fully verified imported fixture; only its lifecycle is set to the
    // pre-release stage so stale PASS facts are sufficient to expose the bounce.
    const features = app.get(FeatureRepo);
    const gates = app.get(GateRepo);
    const f = features.get('FEAT-00022', '1.0.0')!;
    features.update({ ...f, lifecycle: 'VERIFIED' });
    const old = gates.latest(f.featureId, f.version);
    expect(['G4', 'G5', 'G6', 'G7'].map((g) => old[g as keyof typeof old]?.status)).toEqual(Array(4).fill('PASS'));

    const response = await http().post(`/api/features/${f.featureId}/versions/${f.version}/transitions`).set(JUDGE)
      .send({ to: 'DEVELOPING', reason: 'verification regression requires rework', issues: [{ item: 'warning omitted while stopped' }] }).expect(200);
    expect(response.body.lifecycle).toBe('DEVELOPING');
    expect(features.get(f.featureId, f.version)?.lifecycle).toBe('DEVELOPING');
    const db = app.get<Db>(DB);
    const current = db.tx(() => app.get(LifecycleService).autoAdvance(features.get(f.featureId, f.version)!, 'p10-rework-followup'));
    expect(current.lifecycle).toBe('DEVELOPING');

    const view = (await http().get(`/api/features/${f.featureId}/versions/${f.version}/gates`).expect(200)).body;
    for (const id of ['G4', 'G5', 'G6', 'G7', 'G8', 'G9']) {
      const gate = view.gates.find((g: any) => g.gate === id);
      expect(gate.specStatus).toBe('PENDING');
      expect(gate.history.map((r: any) => r.gateRecordId)).toContain(old[id as keyof typeof old]!.gateRecordId);
      expect(gate.decision.state).not.toMatch(/MISSING|INVALID/);
    }
    expect(view.gates.find((g: any) => g.gate === 'G1').latest.gateRecordId).toBe(old.G1!.gateRecordId);
  });

  it('another Feature Version referencing a draft relation prevents deletion', async () => {
    const source = (await http().post('/api/features').set(AUTHOR).send(withRef({
      name: 'P10 referenced relation', description: 'referenced relation must remain available', requirementIds: ['REQ-P10-REFERENCE'],
      country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: [],
    })).expect(201)).body;
    const relation = (await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: source.featureId, sourceVersion: source.version, targetFeatureId: 'FEAT-00022', targetVersion: '1.0.0' }).expect(201)).body;
    const next = (await http().post(`/api/features/${source.featureId}/versions`).set(AUTHOR).send({ baseVersion: source.version, bump: 'minor', changes: { description: 'next draft retains the relation reference' }, reason: 'create next draft' }).expect(201)).body.feature;
    expect(next.dependencyIds).toContain(relation.dependencyId);
    const denied = await http().delete(`/api/dependencies/${relation.dependencyId}`).set(AUTHOR).send({ reason: 'remove a referenced relation' }).expect(409);
    expect(denied.body.error.details).toMatchObject({ code: 'DRAFT_REFERENCED', alternative: 'MARK_UNUSED' });
    expect(denied.body.error.details.references).toContainEqual({ kind: 'Feature Version', id: `${source.featureId}@${next.version}` });
  });

  it('a previous Gate approval on a source draft prevents relation deletion even after a FAIL rejudgment', async () => {
    const source = (await http().post('/api/features').set(AUTHOR).send(withRef({
      name: 'P10 reviewed relation', description: 'approval history must remain reproducible', requirementIds: ['REQ-P10-DELETE'],
      country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: [],
    })).expect(201)).body;
    const relation = (await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: source.featureId, sourceVersion: source.version, targetFeatureId: 'FEAT-00022', targetVersion: '1.0.0' }).expect(201)).body;
    for (const inputResult of ['PASS', 'FAIL']) await http().post(`/api/features/${source.featureId}/versions/${source.version}/gates`).set(JUDGE)
      .send({ gate: 'G1', inputResult, rationale: 'reviewed source relation', evidenceRef: 'EV-P10-RELATION' }).expect(201);
    const denied = await http().delete(`/api/dependencies/${relation.dependencyId}`).set(AUTHOR).send({ reason: 'remove a reviewed relation' }).expect(409);
    expect(denied.body.error.details).toMatchObject({ code: 'DRAFT_HAS_APPROVAL', alternative: 'RETIRE' });
    expect(app.get(FeatureRepo).get(source.featureId, source.version)?.dependencyIds).toContain(relation.dependencyId);
    expect((await http().get('/api/dependencies').expect(200)).body.items.map((d: any) => d.dependencyId)).toContain(relation.dependencyId);
  });
});
