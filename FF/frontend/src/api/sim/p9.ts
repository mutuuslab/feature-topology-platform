// 시연 흐름(P9) — OTA 전달 대사(POST /api/ota/jobs/:jobId/reconcile). 서버 adapters/ota/ota-reconcile.service.ts와 같은 규칙:
// 접수(SUBMITTED) 뒤 전달 통보가 오지 않은 작업을 OTA 서버 조회로 맞춘다 — 아직 기록하지 않은 차량만 채우고, 끝 결과(DELIVERED 등)는 되돌리지 않는다.
// 적용 확인(회신 집계)은 바꾸지 않는다. 병합 때 index.ts HANDLERS 끝에 `() => import('./p9'),` 한 줄로 연결한다.
import { OtaJobActionBody } from '@ff/contracts';
import { registerSimHandler, simUnhandled } from './engine';

registerSimHandler(
  'otaJobReconcile',
  (ctx) => {
    const jobId = ctx.req.params.jobId;
    const all = ctx.state<Record<string, any>>('killDelivery', () => ({}));
    const publicationId = Object.keys(all).find((id) => all[id].job?.jobId === jobId);
    if (!publicationId) return simUnhandled(ctx);
    const job = all[publicationId].job;
    const before = job.state;
    let filled = 0;
    // 시연 OTA 서버는 전송 중인 차량을 모두 넘겼다고 답한다(조회 결과)
    job.vehicles = job.vehicles.map((v: any) => {
      if (v.outcome !== 'DELIVERING') return v;
      filled++;
      return { ...v, outcome: 'DELIVERED', detail: 'OTA 작업 조회로 대사', at: ctx.iso() };
    });
    job.counts = job.vehicles.reduce((m: Record<string, number>, v: any) => ((m[v.outcome] = (m[v.outcome] ?? 0) + 1), m), {});
    if (job.state === 'SUBMITTED' && job.vehicles.every((v: any) => v.outcome !== 'DELIVERING')) Object.assign(job, { state: 'COMPLETED', serverState: 'COMPLETED' });
    ctx.audit({ action: 'OTA_JOB_RECONCILE', target: jobId, before: { state: before }, after: { state: job.state, filled }, reason: ctx.req.body.reason, componentId: 'D04-01' });
    ctx.emit('ota.job.reconciled', jobId, { jobId, publicationId, filled, state: job.state, serverState: job.serverState }, { componentId: 'D04-01' });
    return { jobId, filled, state: job.state, serverState: job.serverState };
  },
  { body: OtaJobActionBody },
);
