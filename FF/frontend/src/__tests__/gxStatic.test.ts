import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { decisionPayload, GX_SOURCE_SCHEMA, gxFeatureFacts, jcs } from '@ff/contracts';
import { gxActiveKills, gxDeploySources, gxForDeploy, gxStageGuard } from '../api/sim/gx-deploy';
import { GX, gxRelease, sweepGx } from '../api/sim/gx-state';
import { signLocalGate, verifyGateBytes } from '../api/sim/gate-signatures';

const F = 'FEAT-00022', V = '1.0.0', P = 'POL-00001', NOW = '2026-11-09T00:00:00.000Z';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const digest = (x: unknown) => 'sha256:' + createHash('sha256').update(jcs(x)).digest('hex');
const signature = (x: unknown) => ({ alg: 'EdDSA', kid: 'NATIVE-GATE-TEST', value: sign(null, Buffer.from(jcs(x)), privateKey).toString('base64url') });
let ctx: any, snapshots: Map<string, any>, now: Date, feature: any, policy: any, facts: any, gates: any[], audit: any[], events: any[];
const key = (name: string, p: any = {}) => name + ':' + jcs(p);
const set = (name: string, value: any, params = {}) => snapshots.set(key(name, params), value);
const reseal = () => set('policyExceptionSources', { payload: { schema: GX_SOURCE_SCHEMA, observedAt: NOW, validUntil: '2026-11-10T00:00:00.000Z', sourceRevision: digest(facts), ...facts }, signature: signature({ schema: GX_SOURCE_SCHEMA, observedAt: NOW, validUntil: '2026-11-10T00:00:00.000Z', sourceRevision: digest(facts), ...facts }) }, { id: P });
const exception = (id = 'EXC-00001', extra: any = {}) => ({ exceptionId: id, kind: 'BYPASS', featureId: F, featureVersion: V, policyId: P, checks: ['FLAG_CODE'], gates: [], ruleIds: [], restriction: 'PILOT', reason: 'Explicit test waiver', periodHours: 24, dueDate: null, residualRisk: null, status: 'ACTIVE', requestedBy: 'requester', requestedAt: NOW, appliedAt: NOW, expiresAt: '2026-11-09T20:00:00.000Z', closedAt: null, rejection: null, revert: null, approvals: [{ by: 'review1', role: 'SAFETY_OFFICER', expiresAt: '2026-11-09T20:00:00.000Z' }, { by: 'review2', role: 'OPS_LEAD', expiresAt: '2026-11-09T20:00:00.000Z' }], applications: [], ...extra });
const input = () => ({ policy, feature, gates: {}, entitlementProductOk: true } as any);
async function addGate(gate = 'G8', status = 'PASS') {
  const record: any = { gateRecordId: 'GR-' + gate, featureId: F, featureVersion: V, gate, inputResult: status, status, evidenceRef: 'EV-' + gate, rationale: 'Actual signed evidence', judgedAt: NOW };
  const payload = decisionPayload(record, { id: 'judge', role: 'GATE_JUDGE' }, 'PLATFORM', feature.baselineId);
  const row = gates.find((x) => x.gate === gate); row.latest = record; row.decisionRecord = { payload, signature: signature(payload), signedAt: NOW };
  (await ctx.read('featureDetail', { id: F, ver: V })).gates[gate] = record;
  return row;
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); now = new Date(NOW); snapshots = new Map(); audit = []; events = [];
  feature = { featureId: F, version: V, baselineId: 'BL-00001', country: 'KR', vehicleModel: 'NX', trim: 'Base', asil: 'QM', lifecycle: 'RELEASED', requirementIds: [], swIds: [], swVersions: [], ecuPnos: [], controlPoints: ['Flag'], tags: [] };
  policy = { policyId: P, revision: 1, contentHash: 'sha256:test-body', featureId: F, featureVersion: V, flagKey: 'gx-test', status: 'APPROVED', safeDefault: false, enabled: true, strategies: [], rollout: { mode: 'ALL', basisPoints: 10000, salt: 'gx-test' }, entitlementCatalogId: null, stageBasisPoints: 100 };
  gates = Array.from({ length: 9 }, (_, i) => ({ gate: 'G' + (i + 1), latest: null, decisionRecord: null }));
  const overlay = { version: 'test-version', data: {}, entities: {}, created: {} } as any;
  ctx = { overlay, req: { name: 'deployPolicy', body: {} }, actor: { id: 'release', role: 'RELEASE_MANAGER' }, now: () => now, iso: () => now.toISOString(), snapshot: async (n: string, p: any = {}) => snapshots.get(key(n, p)) ?? null,
    read: async (n: string, p: any = {}) => snapshots.get(key(n, p)) ?? null, get: (c: string, id: string) => overlay.entities[c]?.[id], list: (c: string) => Object.values(overlay.entities[c] ?? {}), put: (c: string, id: string, v: any) => { (overlay.entities[c] ??= {})[id] = v; }, state: (k: string, init: any) => overlay.data[k] ??= init(), audit: (a: any) => audit.push(a), emit: (...e: any[]) => events.push(e), later: vi.fn(), fail: (code: string, message: string, details: any) => { throw Object.assign(new Error(message), { code, details }); } };
  set('featureDetail', { feature, gates: {} }, { id: F, ver: V }); set('gates', { gates }, { id: F, ver: V }); set('policyDetail', { policy }, { id: P }); set('listPolicies', { items: [policy] }); set('exceptionPolicies', { items: [] }); set('killRequests', { items: [] });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  set('pkiKeys', { items: [{ keyId: 'NATIVE-GATE-TEST', alg: 'Ed25519', purpose: 'gate', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), fingerprint: 'sha256:' + createHash('sha256').update(der).digest('hex').slice(0, 16) }] });
  facts = { policy: Object.fromEntries(['policyId', 'revision', 'contentHash', 'featureId', 'featureVersion', 'flagKey'].map((k) => [k, policy[k]])), feature: gxFeatureFacts(feature), compliance: { rules: [], market: 'KR', cal: null, at: NOW }, flagCode: { connected: false, row: { flagKey: policy.flagKey, featureId: F, version: V, findings: [], waiver: null } }, ads: { settings: [], profile: null, classification: null, sets: [], baselines: [], fClass: null, enforced: false, vehicles: [] } }; reseal();
});
afterEach(() => vi.unstubAllGlobals());

describe('actual WebCrypto signed read-fact and Gate boundaries', () => {
  it('accepts signed current facts and actual native Gate bytes; read-fact signature cannot replace Gate approval', async () => {
    await expect(gxDeploySources(ctx, policy)).resolves.toMatchObject({ schema: GX_SOURCE_SCHEMA });
    const row = await addGate();
    expect((await gxRelease(ctx, policy)).allowed).toBe(true);
    row.decisionRecord = { payload: snapshots.get(key('policyExceptionSources', { id: P })).payload, signature: snapshots.get(key('policyExceptionSources', { id: P })).signature, signedAt: NOW };
    expect((await gxRelease(ctx, policy)).allowed).toBe(false);
  });
  it.each(['missing-key', 'wrong-purpose', 'expired-key', 'revoked-key', 'bad-fingerprint', 'corrupt-signature', 'expired-facts', 'wrong-schema', 'wrong-feature', 'wrong-revision', 'changed-feature', 'bad-digest'])('%s fails closed', async (which) => {
    const source = snapshots.get(key('policyExceptionSources', { id: P })), keys = snapshots.get(key('pkiKeys')).items;
    if (which === 'missing-key') snapshots.delete(key('pkiKeys'));
    if (which === 'wrong-purpose') keys[0].purpose = 'policy';
    if (which === 'expired-key') keys[0].notAfter = NOW;
    if (which === 'revoked-key') keys[0].status = 'REVOKED';
    if (which === 'bad-fingerprint') keys[0].fingerprint += '0';
    if (which === 'corrupt-signature') source.signature.value = 'A'.repeat(86);
    if (which === 'expired-facts') now = new Date('2026-11-10T00:00:01Z');
    if (which === 'changed-feature') feature.tags.push('changed');
    if (which === 'wrong-revision') policy.revision++;
    if (which === 'wrong-schema') { source.payload.schema = 'ffp-gate-decision/1'; source.signature = signature(source.payload); }
    if (which === 'wrong-feature') { source.payload.policy.featureId = 'FEAT-99999'; source.signature = signature(source.payload); }
    if (which === 'bad-digest') { source.payload.sourceRevision = 'sha256:wrong'; source.signature = signature(source.payload); }
    await expect(gxDeploySources(ctx, policy)).rejects.toThrow();
  });
  it('refuses newer or changed latest Gate records and missing raw decisions despite SIGNED text', async () => {
    const row = await addGate(); row.decision = { state: 'SIGNED' }; row.decisionRecord = null;
    expect((await gxRelease(ctx, policy)).allowed).toBe(false);
    await addGate(); row.latest.rationale = 'changed after signing'; expect((await gxRelease(ctx, policy)).allowed).toBe(false);
    await addGate(); (await ctx.read('featureDetail', { id: F, ver: V })).gates.G8 = { ...row.latest, gateRecordId: 'NEWER' }; expect((await gxRelease(ctx, policy)).allowed).toBe(false);
  });
  it('real browser-local keys verify only their own namespace and overlay version', async () => {
    const row = await addGate(), signed = await signLocalGate(ctx, row.decisionRecord.payload);
    expect(signed.signature.kid).toMatch(/^SIM-GATE-/);
    expect((await verifyGateBytes(ctx, row.latest, signed, feature.baselineId, true)).valid).toBe(true);
    expect((await verifyGateBytes(ctx, row.latest, signed, feature.baselineId, false)).valid).toBe(false);
    ctx.overlay.version = 'another-snapshot'; expect((await verifyGateBytes(ctx, row.latest, signed, feature.baselineId, true)).valid).toBe(false);
  });
});

describe('native rule checks, limited exceptions and lifecycle', () => {
  it('starts independent deploy reads before awaiting source facts and does not stage writes', async () => {
    let resume!: () => void;
    const blockedSource = new Promise<void>((resolve) => { resume = resolve; });
    const started = new Set<string>();
    const snapshot = ctx.snapshot, read = ctx.read;
    ctx.snapshot = async (name: string, params = {}) => {
      if (name === 'policyExceptionSources') { started.add('source'); await blockedSource; }
      if (name === 'exceptionPolicies') started.add('exceptions');
      return snapshot(name, params);
    };
    ctx.read = async (name: string, params = {}) => { if (name === 'featureDetail') started.add('release'); return read(name, params); };
    const deploy = gxForDeploy(ctx, policy, input());
    try {
      await vi.waitFor(() => expect([...started].sort()).toEqual(['exceptions', 'release', 'source']));
      expect(ctx.overlay.entities).toEqual({});
      expect(audit).toEqual([]);
    } finally { resume(); }
    expect((await deploy).cap()).toBe(null);
    expect(ctx.overlay.entities).toEqual({});
  });
  it('retains signed-source refusal priority when release and exception reads also fail', async () => {
    snapshots.get(key('policyExceptionSources', { id: P })).signature.value = 'A'.repeat(86);
    snapshots.delete(key('exceptionPolicies'));
    const read = ctx.read;
    ctx.read = async (name: string, params = {}) => { if (name === 'featureDetail') throw new Error('release source unavailable'); return read(name, params); };
    await expect(gxForDeploy(ctx, policy, input())).rejects.toMatchObject({ code: 'GUARD_FAILED', message: '예외 배포 원천 사실의 서명을 검증하지 못했습니다.' });
    expect(ctx.overlay.entities).toEqual({});
    expect(audit).toEqual([]);
  });

  it.each(['COMPLIANCE_RULE', 'FLAG_CODE', 'ADS_PUBLISH'])('%s positive, refusal, two-person limited waiver; signature never waivable', async (check) => {
    expect((await gxForDeploy(ctx, policy, input())).cap()).toBe(null);
    if (check === 'COMPLIANCE_RULE') facts.compliance.rules = [{ ruleId: 'RULE-GX', name: 'Require trace', version: '1', type: 'INTERNAL', status: 'APPROVED', scope: { markets: ['KR'], featureIds: [], rolloutModes: [], asil: [], cal: [] }, criteria: [{ check: 'REQUIREMENT_TRACE' }], validFrom: '2026-01-01', validTo: null }];
    if (check === 'FLAG_CODE') { facts.flagCode.connected = true; facts.flagCode.row.findings = [{ severity: 'BLOCKER', status: 'OPEN', message: 'Code not linked' }]; }
    if (check === 'ADS_PUBLISH') facts.ads.settings = [{ flagKey: policy.flagKey, settingId: 'ODD-TEST' }];
    reseal(); await expect(gxForDeploy(ctx, policy, input())).rejects.toMatchObject({ code: 'GUARD_FAILED' });
    const e = exception('EXC-00001', { checks: [check], ruleIds: check === 'COMPLIANCE_RULE' ? ['RULE-GX'] : [] }); ctx.put(GX, e.exceptionId, e);
    const gx = await gxForDeploy(ctx, policy, input()); expect(gx.cap()).toBe(100);
    const applied = await gx.apply({ ...policy, status: 'DEPLOYED' }, undefined); expect(applied.exceptionScope).toMatchObject({ exceptionIds: [e.exceptionId], capBasisPoints: 100 });
    expect(ctx.get(GX, e.exceptionId).applications).toHaveLength(1);
    e.approvals[1].by = e.approvals[0].by; ctx.put(GX, e.exceptionId, e); await expect(gxForDeploy(ctx, policy, input())).rejects.toThrow();
    e.approvals[1].by = 'review2'; ctx.put(GX, e.exceptionId, e); const row = await addGate(); row.decisionRecord.signature.value = 'A'.repeat(86); await expect(gxForDeploy(ctx, policy, input())).rejects.toThrow();
  });
  it('missing sources never become success, stop 0 remains possible, cap expansion denied', async () => {
    snapshots.delete(key('policyExceptionSources', { id: P })); await expect(gxForDeploy(ctx, policy, input())).rejects.toThrow();
    policy.exceptionScope = { exceptionIds: ['missing'], capBasisPoints: 100, restriction: 'PILOT' }; snapshots.delete(key('gates', { id: F, ver: V }));
    await expect(gxStageGuard(ctx, policy, 0)).resolves.toBeUndefined(); await expect(gxStageGuard(ctx, policy, 500)).rejects.toThrow();
  });
  it('checks dependency Feature scopes, partial restore and commercial exceptions against actual remaining VINs', async () => {
    set('killRequests', { items: [{ killId: 'K1', featureId: 'FEAT-00001', featureIds: ['FEAT-00001', F], status: 'ACTIVE', reasonCategory: 'SAFETY', vins: ['A', 'B'], restoredVins: ['A'] }] });
    expect((await gxActiveKills(ctx, F)).map((k: any) => k.killId)).toEqual(['K1']);
    snapshots.get(key('killRequests')).items[0].restoredVins.push('B'); expect(await gxActiveKills(ctx, F)).toEqual([]);
    snapshots.delete(key('killRequests')); await expect(gxActiveKills(ctx, F)).rejects.toThrow();
  });
  it('completes only its own Gate waiver, retains tighter BYPASS, expiry stops once and keeps native gates intact', async () => {
    await addGate(); const app = { policyId: P, flagKey: policy.flagKey, at: NOW, by: 'release', prior: null, capBasisPoints: 100 };
    const gate = exception('EXC-00001', { kind: 'GATE_PENDING', policyId: null, checks: [], gates: ['G8'], restriction: 'LIMITED', applications: [app] }), bypass = exception('EXC-00002', { applications: [app] });
    ctx.overlay.data.gxHydrated = { complete: true }; ctx.put(GX, gate.exceptionId, gate); ctx.put(GX, bypass.exceptionId, bypass);
    ctx.put('policy', P, { ...policy, status: 'DEPLOYED', exceptionScope: { exceptionIds: [gate.exceptionId, bypass.exceptionId], restriction: 'PILOT', capBasisPoints: 100 } });
    await sweepGx(ctx); expect(ctx.get('policy', P).exceptionScope).toEqual({ exceptionIds: [bypass.exceptionId], restriction: 'PILOT', capBasisPoints: 100 }); expect(ctx.get(GX, bypass.exceptionId).applications).toEqual([app]);
    now = new Date('2026-11-09T20:00:01Z'); await sweepGx(ctx); expect(ctx.get('policy', P).stageBasisPoints).toBe(0); expect(ctx.get(GX, bypass.exceptionId).status).toBe('EXPIRED');
    const count = audit.length; await sweepGx(ctx); expect(audit).toHaveLength(count); expect(gates.find((g) => g.gate === 'G8').latest.status).toBe('PASS');
  });
});
