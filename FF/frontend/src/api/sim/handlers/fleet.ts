// 시연 흐름의 차량 반영 — 차단·복원 회신이 들어오면 차량 화면들이 같은 상태를 보게 한다(서버 vehicle-runtime·operation-summary·fleet-map과 같은 규칙).
//  · 판단 근거는 한 곳: overlay.data.vehicleKill[vin][featureId] = 회신으로 확인된 차량 상태(DISABLED·INACTIVE)
//    + 진행 중 차단(kill 엔터티 ACTIVE·대상 차량, 복원한 차량 제외) = 서버 판단(server)
//  · flags[i].local.reason === 'KILL_SWITCH' 하나가 Fleet 현황·지도 활성화 렌즈(activationState)·홈 수신 현황(receivedState → SAFE)을 정한다
//  · 홈 수신 현황은 서버와 같은 operationSummary(contracts)로 다시 센다(입력은 화면이 쓰는 목록들 — 스냅샷 + 시연 데이터)
import { activationState, operationSummary, type OperationInput } from '@ff/contracts';
import { registerSimReader } from '../engine';
import type { SimReadContext } from '../types';

interface VehicleKill {
  killId: string;
  state: string;
  at: string;
  publicationId: string;
  kind: 'KILL' | 'RESTORE';
  deactClass: string | null;
}
type Flag = { flagKey: string; publicationId: string | null; sequence: number | null; local: Record<string, any>; server: Record<string, any> | null; drift: boolean };

const vehicleKills = (ctx: SimReadContext): Record<string, Record<string, VehicleKill>> => ctx.overlay.data.vehicleKill ?? {};
/** 시연에서 바뀐 차량이 있는가 — 없으면 스냅샷 그대로(엔진을 거쳐도 같은 값) */
const touched = (ctx: SimReadContext) => Object.keys(vehicleKills(ctx)).length > 0 || ctx.list('kill').some((k) => k.status === 'ACTIVE');

/** 이 차량을 서버가 차단 중으로 보는 Feature·flag(진행 중 차단, 복원한 차량 제외) */
function serverKills(ctx: SimReadContext, vin: string) {
  const out: { featureIds: string[]; flagKeys: string[] }[] = [];
  for (const k of ctx.list('kill')) if (k.status === 'ACTIVE' && k.vins?.includes(vin) && !k.restoredVins?.includes(vin)) out.push({ featureIds: k.featureIds ?? [k.featureId], flagKeys: k.flagKeys ?? [] });
  return out;
}
/** flag → Feature(차단 기록의 flagKeys로) */
function flagFeature(ctx: SimReadContext): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of ctx.list('kill')) for (const f of k.flagKeys ?? []) m.set(f, k.featureId);
  return m;
}
async function safeDefaults(ctx: SimReadContext): Promise<Map<string, boolean>> {
  const p = await ctx.read<{ items: { flagKey: string; safeDefault?: boolean }[] }>('listPolicies').catch(() => ({ items: [] }));
  return new Map(p.items.map((x) => [x.flagKey, !!x.safeDefault] as const));
}

/** 런타임 행(Fleet 현황·지도 상세 공용) — flags·featureState·kills·last */
function patchRow<T extends { vin: string; flags?: Flag[]; featureState?: Record<string, string>; kills?: string[]; last?: any }>(ctx: SimReadContext, row: T, safe: Map<string, boolean>, feat: Map<string, string>): T {
  const mine = vehicleKills(ctx)[row.vin] ?? {};
  const server = serverKills(ctx, row.vin);
  if (!Object.keys(mine).length && !server.length) return row;
  const killedFeatures = new Set(Object.entries(mine).filter(([, v]) => v.state === 'DISABLED').map(([f]) => f));
  const flags = (row.flags ?? []).map((f) => {
    const featureId = feat.get(f.flagKey);
    if (!featureId) return f;
    const sd = safe.get(f.flagKey) ?? false;
    const local = killedFeatures.has(featureId) ? { ...f.local, value: sd, reason: 'KILL_SWITCH' } : f.local;
    const srv = server.some((s) => s.featureIds.includes(featureId)) ? { ...(f.server ?? {}), value: sd, reason: 'KILL_SWITCH' } : f.server;
    return { ...f, local, server: srv, drift: !!srv && srv.value !== local.value };
  });
  const featureState = { ...(row.featureState ?? {}) };
  const kills = new Set(row.kills ?? []);
  let last = row.last;
  for (const [f, v] of Object.entries(mine)) {
    featureState[f] = v.state;
    if (v.state === 'DISABLED') kills.add(f);
    else kills.delete(f);
    if (!last || v.at > last.at) last = { at: v.at, publicationId: v.publicationId, kind: v.kind, result: 'APPLIED', detail: v.kind === 'KILL' ? `deactivate ${v.deactClass ?? ''} 수락`.trim() : 'restore 수락' };
  }
  return { ...row, flags, featureState, kills: [...kills], last };
}

// Fleet 실시간 적용 현황
registerSimReader('fleetRuntime', async (ctx) => {
  if (!touched(ctx)) return undefined;
  const base = await ctx.snapshot<{ items: any[] }>();
  if (!base) return undefined;
  const [safe, feat] = [await safeDefaults(ctx), flagFeature(ctx)];
  return { ...base, items: base.items.map((r) => patchRow(ctx, r, safe, feat)) };
});

// 차량 런타임 상세 — 평가 결과(local은 판단 단계까지), 차량 차단 표
registerSimReader('vehicleRuntime', async (ctx) => {
  const vin = ctx.req.params.vin;
  if (!vehicleKills(ctx)[vin] && !serverKills(ctx, vin).length) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  const [safe, feat] = [await safeDefaults(ctx), flagFeature(ctx)];
  const row = patchRow(ctx, { vin, flags: base.evaluations.map((e: any) => ({ flagKey: e.flagKey, publicationId: null, sequence: null, local: e.local, server: e.server, drift: e.drift })), featureState: base.runtime.featureState, kills: Object.keys(base.runtime.kills ?? {}) }, safe, feat);
  const mine = vehicleKills(ctx)[vin] ?? {};
  const kills = Object.fromEntries(row.kills!.map((f) => [f, base.runtime.kills?.[f] ?? { killId: 'v2', safeMode: 'DISABLED', publicationId: '-' }]));
  const log = [...(base.runtime.log ?? []), ...Object.values(mine).map((v) => ({ at: v.at, publicationId: v.publicationId, kind: v.kind, result: 'APPLIED', detail: v.kind === 'KILL' ? 'deactivate 수락' : 'restore 수락' }))];
  const evaluations = base.evaluations.map((e: any, i: number) => {
    const f = row.flags![i];
    if (f.local === e.local) return { ...e, server: f.server, drift: f.drift };
    const trace = (e.local.trace ?? []).map((t: any) => (t.step === 'KILL' ? { ...t, result: 'TRUE', detail: '긴급 차단 적용' } : t));
    return { ...e, local: { ...e.local, value: f.local.value, variant: f.local.value ? 'on' : 'off', decision: 'SAFE_DEFAULT', reason: 'KILL_SWITCH', trace }, server: f.server, drift: f.drift };
  });
  return { ...base, runtime: { ...base.runtime, kills, featureState: row.featureState, log }, evaluations };
});

// 지도 — 활성화 렌즈 색(activationState)·국가별 집계
registerSimReader('fleetMap', async (ctx) => {
  if (!touched(ctx)) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base?.items) return undefined;
  const runtime = await ctx.read<{ items: any[] }>('fleetRuntime').catch(() => null);
  if (!runtime) return undefined;
  const rows = new Map<string, any>(runtime.items.map((r) => [r.vin, r] as const));
  const summary = (base.summary ?? []).map((s: any) => ({ ...s, activation: { ...s.activation } }));
  const flagKey = ctx.req.query.flagKey || undefined;
  const items = base.items.map((v: any) => {
    const r = rows.get(v.vin);
    if (!r || v.activation == null) return v;
    const activation = activationState({ link: r.link, kills: r.kills ?? [], flags: r.flags }, flagKey);
    if (activation === v.activation) return { ...v, kills: r.kills ?? [] };
    const row = summary.find((s: any) => s.country === v.country);
    if (row) {
      row.activation[v.activation] = Math.max(0, (row.activation[v.activation] ?? 0) - 1);
      row.activation[activation] = (row.activation[activation] ?? 0) + 1;
    }
    return { ...v, activation, kills: r.kills ?? [] };
  });
  return { ...base, generatedAt: new Date().toISOString(), items, summary };
});

// 지도 차량 상세 — 런타임 칸
registerSimReader('fleetMapVehicle', async (ctx) => {
  const vin = ctx.req.params.vin;
  if (!vehicleKills(ctx)[vin] && !serverKills(ctx, vin).length) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base?.runtime) return undefined;
  return { ...base, runtime: patchRow(ctx, { vin, ...base.runtime }, await safeDefaults(ctx), flagFeature(ctx)) };
});

// 차량 상태 보고 v2 — Feature별 마지막 보고·최근 보고
registerSimReader('vehicleStatusView', async (ctx) => {
  const vin = ctx.req.params.vin;
  const mine = vehicleKills(ctx)[vin];
  if (!mine) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  const features = [...(base.features ?? [])];
  const recent = [...(base.recent ?? [])];
  for (const [featureId, v] of Object.entries(mine)) {
    const i = features.findIndex((f: any) => f.featureId === featureId);
    const prev = i >= 0 ? features[i] : { featureId, reportSeq: 0, report: {} };
    const reportSeq = (prev.reportSeq ?? 0) + 1;
    const report = {
      ...prev.report,
      state: v.state,
      reason: { category: 'SAFETY', source: 'REMOTE' },
      request_result: 'ACCEPTED',
      hmi: v.kind === 'KILL' ? 'INFO_DISABLED' : 'NONE',
      edr_aligned_state: v.kind === 'KILL' ? 'OFF_BY_COMMAND' : 'AVAILABLE',
      received_at: v.at,
      applied_at: v.at,
      observed_at: v.at,
      time_sync: 'SYNCED',
      report_seq: reportSeq,
    };
    const next = { ...prev, state: v.state, reportSeq, report, updatedAt: v.at };
    if (i >= 0) features[i] = next;
    else features.push(next);
    recent.unshift({ featureId, state: v.state, reportSeq, accepted: true, violation: null, via: 'SIM', at: v.at });
  }
  return { ...base, features, recent: recent.slice(0, 20) };
});

// 차량 회신 기록 — 시연 게시본의 회신을 덧붙인다
registerSimReader('readbacks', async (ctx) => {
  const all = ctx.overlay.data.killDelivery as Record<string, { readbacks: any[] }> | undefined;
  const mine = Object.values(all ?? {}).flatMap((d) => d.readbacks ?? []);
  if (!mine.length) return undefined;
  const base = (await ctx.snapshot<{ items: any[] }>()) ?? { items: [] };
  const q = ctx.req.query;
  return { ...base, items: [...base.items, ...mine.filter((r) => (!q.publicationId || r.publicationId === q.publicationId) && (!q.vin || r.vin === q.vin))] };
});

// 홈 수신 현황 — 서버와 같은 operationSummary(contracts)로 다시 센다
registerSimReader('operationSummary', async (ctx) => {
  if (!touched(ctx) && !ctx.list('publication').length) return undefined;
  const base = await ctx.snapshot<any>();
  if (!base) return undefined;
  try {
    const items = async (name: string, query: Record<string, unknown> = {}) => ((await ctx.read<{ items: any[] }>(name, {}, query)).items ?? []) as any[];
    const input: OperationInput = {
      runtime: await items('fleetRuntime'),
      vehicles: await items('vehicles'),
      policies: await items('listPolicies'),
      features: await items('listFeatures'),
      publications: await items('publications'),
      readbacks: base.readbacks ? await items('readbacks') : [],
      syncs: await items('integrationCalls', { ifId: 'IF-04' }),
    };
    return operationSummary(input, new Date().toISOString(), !!base.readbacks);
  } catch {
    return undefined;
  }
});
