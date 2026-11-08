// Fleet 실시간 적용 현황(D02-03, GET /api/fleet/runtime) — 차량별 '미수신' flag(pending).
// 회귀(2026-11-06): 다른 차종 전용 flag(GN7 adas_00004_assist)가 생기자 NX4 lead-01의 그 칸이 '미수신'으로 나와 긴급 차단 e2e가 깨지고
// 표 전체가 거짓 미확인이었다. 마지막 정책 게시본의 대상인데 꾸러미가 없는 flag만 pending이고, 대상이 아닌 flag는 넣지 않는다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { INestApplication } from '@nestjs/common';
import type { Publication } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PublicationRepo, RuntimeRepo } from '../../src/domains/d06-qsec/secure-deploy/publication.repo';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { actor, bootApp } from '../helpers';

const OPERATOR = actor('seo.ops', 'OPERATOR');

describe('Fleet 실시간 적용 현황 — 미수신 flag (D02-03)', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => ({ app, http, get } = await bootApp({ at: '2026-11-09T00:00:00.000Z' })));
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });

  const rows = async () => (await http().get('/api/fleet/runtime').set(OPERATOR).expect(200)).body.items as { vin: string; flags: { flagKey: string }[]; pending: string[] }[];

  it('대상인데 꾸러미가 없는 flag만 미수신 — 대상이 아닌 차량은 그 flag가 없어도 넣지 않는다', async () => {
    const repo = get<PublicationRepo>(PublicationRepo);
    // 전달 기록만 남은 정책 게시본(차량 회신 전) — lead-01만 대상
    const pub = { publicationId: repo.nextId(), kind: 'POLICY', status: 'DISPATCHED', createdAt: new Date().toISOString(), payload: { kind: 'POLICY', flagKey: 'zz_pending_probe', featureId: 'FEAT-00022', featureVersion: '2.0.0', sequence: 1, targets: ['lead-01'] } } as unknown as Publication;
    repo.insert(pub, 'flag:zz_pending_probe');
    const items = await rows();
    const lead = items.find((r) => r.vin === 'lead-01')!;
    expect(lead.pending).toContain('zz_pending_probe');
    expect(lead.flags.some((f) => f.flagKey === 'zz_pending_probe')).toBe(false);
    // 대상이 아닌 차량(ego-01)은 그 flag가 없어도 미수신이 아니다
    expect(items.find((r) => r.vin === 'ego-01')!.pending).not.toContain('zz_pending_probe');
    // 모든 pending은 그 차량에 없는 flag다
    for (const r of items) for (const k of r.pending) expect(r.flags.some((f) => f.flagKey === k)).toBe(false);
  });

  it('한 VIN은 전체와 같은 pending/오프라인 상태를 내고 다른 차량 런타임을 전개하지 않는다', async () => {
    const service = get<VehicleRuntimeService>(VehicleRuntimeService);
    const all = await service.fleetStatus();
    for (const vin of ['lead-01', 'ego-01', 'KMH-NX4-0003']) {
      const view = vi.spyOn(service, 'view');
      try {
        expect((await service.fleetStatus('FLEET', vin)).items).toEqual(all.items.filter(v => v.vin === vin));
        expect(view.mock.calls.map(args => args[0])).toEqual([vin]);
      } finally { view.mockRestore(); }
    }
    const view = vi.spyOn(service, 'view');
    try { expect((await service.fleetStatus('FLEET', 'UNKNOWN-VIN')).items).toEqual([]); expect(view).not.toHaveBeenCalled(); }
    finally { view.mockRestore(); }
  });

  it('실제 런타임의 차단·꾸러미·미수신 정보는 한 대 조회에서도 손실되지 않는다', async () => {
    const service = get<VehicleRuntimeService>(VehicleRuntimeService), repo = get<RuntimeRepo>(RuntimeRepo);
    const policy = get<PolicyRepo>(PolicyRepo).all()[0];
    const state = repo.get('lead-01');
    state.kills[policy.featureId] = { killId: 'KILL-STATE-FIXTURE', safeMode: 'DISABLED', publicationId: 'PUB-STATE-FIXTURE' };
    state.featureState[policy.featureId] = 'DISABLED';
    state.bundles[policy.flagKey] = { publicationId: 'PUB-STATE-FIXTURE', sequence: 1, payloadHash: policy.contentHash, policy };
    repo.save(state);
    const all = await service.fleetStatus(), single = (await service.fleetStatus('FLEET', state.vin)).items[0];
    expect(single).toEqual(all.items.find(v => v.vin === state.vin));
    expect(single.kills).toContain(policy.featureId); expect(single.featureState[policy.featureId]).toBe('DISABLED');
    expect(single.pending).toContain('zz_pending_probe');
    expect(single.flags.find(f => f.flagKey === policy.flagKey)?.publicationId).toBe('PUB-STATE-FIXTURE');
  });

  it('Shadow 봉투를 조회해도 전체·단일 차량의 출력 상태는 변하지 않는다', async () => {
    const service = get<VehicleRuntimeService>(VehicleRuntimeService), before = (await service.fleetStatus('FLEET', 'ego-01')).items;
    const experiment = (await http().post('/api/experiments').set(actor('usr-author', 'FEATURE_AUTHOR')).send({ policyId: 'POL-00002', type: 'SHADOW', hypothesis: '가상 회귀 — 출력 없는 Shadow 대조', metric: 'DECISION_AGREEMENT', treatmentBp: 1000, minSamples: 100 }).expect(201)).body;
    const envelope = (await http().get(`/api/experiments/${experiment.experimentId}/shadow-envelope`).expect(200)).body;
    expect(envelope.capabilities).toEqual({ output: false, activation: false, install: false });
    const single = (await service.fleetStatus('FLEET', 'ego-01')).items;
    expect(single).toEqual(before); expect(single).toEqual((await service.fleetStatus()).items.filter(v => v.vin === 'ego-01'));
  });
});
