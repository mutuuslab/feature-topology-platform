// SUMS 기록 (D06-08, 보고서 v1.1 FFG-LCY-008) — 수용 기준: 표본 명령 100%에 RXSWIN·형식승인 영향 평가·사용자 고지·결과가 있고,
// 보존 기간 설정이 Profile 최대값(중국 GB 44496 생산 중단 후 10년) 이상이다. 기록은 추가만.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp, killV2, restoreV2 } from '../helpers';

describe('SUMS 기록 (FFG-LCY-008)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  const advance = (ms: number) => {
    const clock = b.get(Clock);
    const until = clock.now().getTime() + ms;
    b.get(Scheduler).flush(ms);
    clock.set(new Date(until));
  };
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });

  it('발행된 차단·복원 명령마다 네 항목 기록, 회신 집계가 끝나면 결과가 덧붙는다', async () => {
    const http = b.http;
    const k = await killV2(http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: 'SUMS 시험', confirm: 'FEAT-00022' });
    let s = (await http().get('/api/sums?featureId=FEAT-00022').expect(200)).body;
    expect(s.retention).toMatchObject({ yearsAfterProductionEnd: 10, basis: expect.stringMatching(/GB 44496/) });
    const kill = s.items.find((x: any) => x.request === 'deactivate');
    expect(kill).toMatchObject({ featureId: 'FEAT-00022', vehicles: 2, rxswin: expect.any(String), typeApproval: { r156AssessmentId: expect.any(String) }, userNotice: { required: expect.any(Boolean) }, missing: [], result: null });
    expect(kill.retention.yearsAfterProductionEnd).toBeGreaterThanOrEqual(10);
    advance(8_000); // DC2 인계 + 램프 → DISABLED 회신
    s = (await http().get('/api/sums?featureId=FEAT-00022').expect(200)).body;
    expect(s.items.find((x: any) => x.commandId === kill.commandId).result).toMatchObject({ status: 'CONFIRMED', confirmed: 2, denominator: 2 });
    expect((await http().get(`/api/kill-requests/${k.killId}`).expect(200)).body.delivery.status).toBe('CONFIRMED');

    await restoreV2(http, k.killId, '결함 해소', actor('park.safety', 'SAFETY_OFFICER'));
    s = (await http().get('/api/sums?featureId=FEAT-00022').expect(200)).body;
    expect(s.items.map((x: any) => x.request)).toEqual(['deactivate', 'restore']);
    expect(s.items.every((x: any) => x.missing.length === 0)).toBe(true);
    expect(() => b.get<Db>(DB).run('DELETE FROM sums_record')).toThrow(/추가만/);
  });
});
