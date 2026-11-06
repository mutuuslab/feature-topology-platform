// Fleet 실시간 적용 현황(D02-03, GET /api/fleet/runtime) — 차량별 '미수신' flag(pending).
// 회귀(2026-11-06): 다른 차종 전용 flag(GN7 adas_00004_assist)가 생기자 NX4 lead-01의 그 칸이 '미수신'으로 나와 긴급 차단 e2e가 깨지고
// 표 전체가 거짓 미확인이었다. 마지막 정책 게시본의 대상인데 꾸러미가 없는 flag만 pending이고, 대상이 아닌 flag는 넣지 않는다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { INestApplication } from '@nestjs/common';
import type { Publication } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublicationRepo } from '../../src/domains/d06-qsec/secure-deploy/publication.repo';
import { actor, bootApp } from '../helpers';

const OPERATOR = actor('seo.ops', 'OPERATOR');

describe('Fleet 실시간 적용 현황 — 미수신 flag (D02-03)', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => ({ app, http, get } = await bootApp()));
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
});
