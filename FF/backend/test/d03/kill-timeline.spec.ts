// 종료·복원 시간 기록 (D03-03·D04-04, 보고서 v1.1 FFG-ADS-007·TEL-004·TEL-010) — 수용 기준: 표본 종료 건 100%에서 다섯 시각과 명령 ID가
// 연결되고(ADS가 아니면 MRC는 해당 없음), 원격 Kill과 고장이 구분되며, 신뢰 시간이 없는 전이는 불확실로 표시된다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp, killV2, restoreV2 } from '../helpers';

describe('종료·복원 시간 기록 (FFG-ADS-007)', () => {
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

  it('차단 → DISABLED → 복원 → 다음 시동 ACTIVE: 차량마다 네 시각(+MRC 해당 없음)과 명령 ID, 원격 Kill, EDR 정합 상태', async () => {
    const http = b.http;
    const k = await killV2(http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], reason: '시간 기록 시험', confirm: 'FEAT-00022' });
    advance(8_000); // DC2 인계 4 s + 램프 3 s
    await restoreV2(http, k.killId, '복구', actor('park.safety', 'SAFETY_OFFICER'));
    advance(3_000); // 다음 시동
    const t = (await http().get(`/api/kill-requests/${k.killId}/timeline`).expect(200)).body;
    const env = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body.envelopes;
    expect(t.items).toHaveLength(2);
    for (const x of t.items) {
      const ids = env.filter((e: any) => e.scope.vehicle_ids[0] === x.vin).map((e: any) => e.command_id);
      expect(ids).toContain(x.deactivate.commandId);
      expect(ids).toContain(x.restore.commandId);
      expect(x.deactivate).toMatchObject({ accepted: { trust: 'TRUSTED' }, completed: { trust: 'TRUSTED' }, mrc: null, mrcApplicable: false });
      expect(x.restore).toMatchObject({ accepted: { trust: 'TRUSTED' }, effective: { trust: 'TRUSTED' } });
      expect(Date.parse(x.deactivate.completed.at)).toBeGreaterThanOrEqual(Date.parse(x.deactivate.accepted.at)); // 수동 스케줄러는 단계 시각을 당겨 기록한다 — 순서만 본다
      expect(x).toMatchObject({ cause: 'REMOTE_KILL', edrAtCompletion: 'OFF_BY_COMMAND', uncertain: [] });
    }
  });
});
