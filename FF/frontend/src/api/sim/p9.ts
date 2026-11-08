// OTA server observations in the browser are explicitly LOCAL_SIMULATION.
// Reconciliation consumes a separately recorded observation; invoking it never invents a delivery receipt.
import { isOtaVehicleOutcome, OtaJobActionBody, OTA_STICKY_OUTCOMES, OTA_SERVER_JOB_STATES } from '@ff/contracts';
import { registerSimHandler, registerSimTask } from './engine';
import type { SimWriteContext } from './types';

export function scheduleOtaObservation(ctx: SimWriteContext, publicationId: string) {
  const store = ctx.state<Record<string, any>>('killDelivery', () => ({}))[publicationId];
  if (!store?.job) return;
  ctx.later(250, 'ota.server-observation', { publicationId, jobId: store.job.jobId, attempt: store.job.attempts, offline: [...(store.offline ?? [])] });
}

registerSimTask('ota.server-observation', (ctx, args) => {
  const store = ctx.state<Record<string, any>>('killDelivery', () => ({}))[String(args.publicationId)];
  if (!store?.job || store.job.jobId !== args.jobId || store.job.attempts !== args.attempt) return;
  const offline = new Set(args.offline as string[]);
  // An independent simulated OTA response. It does not update FF delivery or vehicle application results.
  store.otaServerObservation = {
    source: 'LOCAL_SIMULATION', jobId: args.jobId, attempt: args.attempt, observedAt: ctx.iso(), state: 'COMPLETED',
    vehicles: store.job.vehicles.map((v: { vin: string }) => ({ vin: v.vin, outcome: offline.has(v.vin) ? 'NO_RESPONSE' : 'DELIVERED', at: ctx.iso() })),
  };
});

registerSimHandler('otaJobReconcile', (ctx) => {
  const jobId = ctx.req.params.jobId;
  const all = ctx.state<Record<string, any>>('killDelivery', () => ({}));
  const publicationId = Object.keys(all).find(id => all[id].job?.jobId === jobId);
  if (!publicationId) ctx.fail('GUARD_FAILED', '이 브라우저의 OTA 작업 원천이 없습니다. 실제 OTA 작업은 연결된 서버에서 조회해 주세요.');
  const store = all[publicationId!], job = store.job, source = store.otaServerObservation;
  if (!source || source.source !== 'LOCAL_SIMULATION' || source.jobId !== jobId || source.attempt !== job.attempts || !Number.isFinite(Date.parse(source.observedAt)) || !Array.isArray(source.vehicles) || !OTA_SERVER_JOB_STATES.includes(source.state))
    ctx.fail('GUARD_FAILED', '대사할 OTA 서버 관측이 없습니다. 전달 완료로 추정하지 않습니다.');
  const before = job.state;
  const facts = new Map<string, { outcome: string; at: string }>();
  for (const v of source.vehicles) if (typeof v.vin === 'string' && isOtaVehicleOutcome(v.outcome) && Number.isFinite(Date.parse(v.at))) facts.set(v.vin, v);
  let filled = 0;
  job.vehicles = job.vehicles.map((v: { vin: string; outcome: string }) => {
    const fact = facts.get(v.vin);
    if (!fact || fact.outcome === v.outcome || OTA_STICKY_OUTCOMES.includes(v.outcome as any) || (v.outcome !== 'DELIVERING' && fact.outcome === 'DELIVERING')) return v;
    filled++;
    return { ...v, outcome: fact.outcome, at: fact.at, detail: 'LOCAL_SIMULATION: OTA 관측 대사' };
  });
  job.counts = job.vehicles.reduce((m: Record<string, number>, v: { outcome: string }) => ((m[v.outcome] = (m[v.outcome] ?? 0) + 1), m), {});
  const closed = ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(job.state);
  if (!closed && ['COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(source.state)) job.state = source.state;
  job.serverState = source.state;
  if (job.state === 'SUBMITTED' && job.vehicles.every((v: { outcome: string }) => v.outcome !== 'DELIVERING')) job.state = 'COMPLETED';
  const result = { jobId, filled, state: job.state, serverState: job.serverState, source: source.source, observedAt: source.observedAt };
  ctx.audit({ action: 'OTA_JOB_RECONCILE', target: jobId, before: { state: before }, after: result, reason: ctx.req.body.reason, componentId: 'D04-01' });
  ctx.emit('ota.job.reconciled', jobId, { ...result, publicationId }, { componentId: 'D04-01' });
  return result;
}, { body: OtaJobActionBody });
