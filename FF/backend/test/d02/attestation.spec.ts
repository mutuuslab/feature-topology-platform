// 실제 구성 Attestation (D02-03·D04-03, 보고서 v1.1 · FFG-VEH-007) — 합격: 구성 1개를 변조하면 다음 보고 주기 안에 Incident(이상 건)가 생긴다.
// 차량 보고 ATTESTATION(Flag 정책마다 정책 해시·Feature Version·BOM)을 그 차량에 보낸 정책 게시본(기대 구성)과 비교한다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp } from '../helpers';

const VIN = 'ego-01';
const as = { 'X-Vehicle-Id': VIN };

describe('실제 구성 Attestation (FFG-VEH-007)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  let seq = 0;
  let configs: any[] = [];
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T01:00:00.000Z' });
    // 기대 구성 = 이 차량에 보낸 정책 게시본(Flag마다 최근 순번) — 차량이 적용한 그대로 보고하는 경우
    const pubs = (await b.http().get('/api/publications?kind=POLICY').expect(200)).body.items.filter((p: any) => p.status !== 'SIGNED' && p.payload.targets.includes(VIN));
    const latest = new Map<string, any>();
    for (const p of pubs) if (p.payload.sequence > (latest.get(p.payload.flagKey)?.payload.sequence ?? 0)) latest.set(p.payload.flagKey, p);
    const bom = async (f: string, v: string) => (await b.http().get(`/api/features/${f}/versions/${v}`).expect(200)).body.feature.baselineId ?? null;
    configs = await Promise.all([...latest.values()].map(async (p) => ({ featureId: p.payload.featureId, featureVersion: p.payload.featureVersion, flagKey: p.payload.flagKey, policyHash: p.signature.payloadHash, bomBaselineId: await bom(p.payload.featureId, p.payload.featureVersion) })));
  });
  afterAll(async () => b.app.close());
  const attest = (c: any[]) => b.http().post(`/vehicle/v1/${VIN}/reports`).set(as).send({ type: 'ATTESTATION', bootId: 'BOOT-ATT-1', sequence: ++seq, observedAt: '2026-10-15T01:00:00.000Z', configs: c });
  const anomalies = async () => (await b.http().get('/api/anomalies?kind=SECURITY').expect(200)).body.items.filter((a: any) => a.signals.some((s: any) => String(s.code).startsWith('CONFIG_')));

  it('FFG-VEH-007 기대 구성 그대로 보고하면 불일치 0건, 이상 건 없음', async () => {
    expect(configs.length).toBeGreaterThan(0);
    const r = (await attest(configs).expect(200)).body;
    expect(r).toMatchObject({ outcome: 'ACCEPTED', attestation: { compared: configs.length, mismatches: [] } });
    expect(await anomalies()).toEqual([]);
  });

  it('FFG-VEH-007 정책 해시 1개 변조 → 그 보고에서 바로 불일치·이상 건(CRITICAL), 빠진 정책·모르는 정책도 드러난다', async () => {
    const forged = configs.map((c, i) => (i === 0 ? { ...c, policyHash: 'sha256:' + 'f'.repeat(64) } : c));
    const r = (await attest(forged).expect(200)).body;
    expect(r.attestation.mismatches).toEqual([{ code: 'POLICY_HASH', featureId: configs[0].featureId, flagKey: configs[0].flagKey, expected: configs[0].policyHash, reported: 'sha256:' + 'f'.repeat(64) }]);
    const a = await anomalies();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'SECURITY', featureId: configs[0].featureId, severity: 'CRITICAL' });
    expect(a[0].signals.find((s: any) => s.code === 'CONFIG_POLICY_HASH')).toMatchObject({ vin: VIN, ref: `ATTESTATION:${configs[0].flagKey}` });
    const odd = (await attest([...configs.slice(1), { ...configs[0], flagKey: 'unknown_flag_x' }]).expect(200)).body.attestation.mismatches.map((m: any) => m.code);
    expect(odd.sort()).toEqual(['MISSING', 'UNEXPECTED']);
  });
});
