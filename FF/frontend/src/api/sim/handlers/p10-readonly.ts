// 공개 정적본의 P10 기록 조회. 승인·폐기·삭제는 백엔드에서만 실행하며 성공으로 가장하지 않는다.
import { canonicalJson, changeSetSummary, compareBaselines, periodBounds, POLICY_SPEC_STAGE_LABEL, POLICY_SPEC_STAGE_STATUSES, POLICY_SPEC_STAGES, policySpecStage, snapshotContent } from '@ff/contracts';
import { errors as E } from '../../../copy/errors';
import { registerSimHandler, registerSimReader, SimError } from '../engine';
import type { SimReadContext } from '../types';

export const P10_READ_ONLY_WRITES = ['requestGateNa', 'decideGateNa', 'rejectFeature', 'requestFeatureRetire', 'decideFeatureRetire', 'deleteFeatureDraft', 'deleteRelationDraft'] as const;
for (const name of P10_READ_ONLY_WRITES) registerSimHandler(name, (ctx) => ctx.fail('GUARD_FAILED', E.readOnlyDemo, { code: 'STATIC_DEMO_READ_ONLY' }, { action: name, target: Object.values(ctx.req.params)[0] ?? ctx.req.url, reason: E.readOnlyDemo, componentId: ctx.req.route.component }));

const rows = (value: any): any[] => Array.isArray(value) ? value : value?.items ?? [];
const base = async (ctx: SimReadContext, name: string, params: Record<string, string> = {}) => (await ctx.snapshot<any>(name, params, {})) ?? { items: [] };
const query = (ctx: SimReadContext, key: string) => ctx.req.query[key]?.trim() || undefined;
const hash = async (value: unknown) => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value))))].map((b) => b.toString(16).padStart(2, '0')).join('');

registerSimReader('gateNaRequests', async (ctx) => base(ctx, 'gateNaRequests', ctx.req.params));
registerSimReader('featureReviews', async (ctx) => {
  const original = await base(ctx, 'featureReviews', ctx.req.params);
  const version = query(ctx, 'version');
  return { ...original, items: rows(original).filter((r) => !version || r.version === version) };
});
registerSimReader('featureRetireRequests', async (ctx) => {
  const original = await base(ctx, 'featureRetireRequests');
  return { ...original, items: rows(original).filter((r) => (!query(ctx, 'featureId') || r.featureId === query(ctx, 'featureId')) && (!query(ctx, 'status') || r.status === query(ctx, 'status'))) };
});

const changedItems = (before: any, after: any) => {
  const b = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const a = after && typeof after === 'object' && !Array.isArray(after) ? after : {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).sort();
};
registerSimReader('featureHistory', async (ctx) => {
  const id = ctx.req.params.id;
  const original = await base(ctx, 'featureHistory', { id });
  const period = periodBounds(query(ctx, 'from'), query(ctx, 'to'));
  if (period.error) throw new SimError('VALIDATION', period.error, { field: 'from' });
  const from = period.from ? Date.parse(period.from) : null, to = period.to ? Date.parse(period.to) : null;
  const local = ctx.overlay.audit.filter((a) => a.result === 'ALLOWED' && (a.target === id || a.target.startsWith(`${id}@`) || a.target.startsWith(`${id}:`))).map((a) => ({ ...a, id: String(a.id), source: 'AUDIT', version: a.target.startsWith(`${id}@`) ? a.target.slice(id.length + 1).split('#')[0] : null, items: changedItems(a.before, a.after) }));
  const actorId = query(ctx, 'actorId'), version = query(ctx, 'version'), item = query(ctx, 'item');
  const items = [...local, ...rows(original)].filter((r) => (!actorId || r.actorId === actorId) && (!version || r.version === version) && (!item || r.items?.includes(item) || r.action?.includes(item)) && (from === null || Date.parse(r.at) >= from) && (to === null || Date.parse(r.at) < to)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || String(b.id).localeCompare(String(a.id)));
  return { ...original, featureId: id, filter: { actorId: actorId ?? null, version: version ?? null, item: item ?? null, from: period.from ?? null, to: period.to ?? null }, items };
});

registerSimReader('featureBaselines', async (ctx) => {
  const original = await base(ctx, 'featureBaselines', ctx.req.params);
  const all = rows(await ctx.read('baselines'));
  const items = await Promise.all(all.filter((b) => b.featureId === ctx.req.params.id).map(async (b) => ({ ...b, verified: !!b.snapshot && (await hash(snapshotContent(b.snapshot))) === b.contentHash })));
  return { ...original, featureId: ctx.req.params.id, items };
});
registerSimReader('compareBaselines', async (ctx) => {
  const leftId = query(ctx, 'left'), rightId = query(ctx, 'right');
  if (!leftId || !rightId) throw new SimError('VALIDATION', '비교할 두 Baseline을 고르세요.');
  const all = rows(await ctx.read('baselines'));
  const left = all.find((b) => b.baselineId === leftId), right = all.find((b) => b.baselineId === rightId);
  if (!left || !right) throw new SimError('NOT_FOUND', `${!left ? leftId : rightId}을(를) 찾을 수 없습니다.`);
  const items = compareBaselines(left.snapshot, right.snapshot);
  const ref = (b: any) => ({ baselineId: b.baselineId, featureId: b.featureId, version: b.version, contentHash: b.contentHash, approvedAt: b.approvedAt });
  return { left: ref(left), right: ref(right), sameFeature: left.featureId === right.featureId, items, summary: changeSetSummary(items) };
});
registerSimReader('baselineChangesets', async (ctx) => {
  const original = await base(ctx, 'baselineChangesets');
  return { ...original, items: rows(original).filter((r) => !query(ctx, 'featureId') || r.featureId === query(ctx, 'featureId')) };
});
registerSimReader('releaseCandidate', async (ctx) => {
  const original = await ctx.snapshot<any>('releaseCandidate', ctx.req.params, {});
  if (original) return original;
  await ctx.read('featureDetail', ctx.req.params);
  return { snapshot: null, verified: null };
});
registerSimReader('releaseCandidates', async (ctx) => {
  const original = await base(ctx, 'releaseCandidates');
  return { ...original, items: rows(original).filter((r) => !query(ctx, 'featureId') || (r.featureId ?? r.snapshot?.featureId) === query(ctx, 'featureId')) };
});
registerSimReader('deletedDrafts', async (ctx) => {
  const original = await base(ctx, 'deletedDrafts');
  return { ...original, items: rows(original).filter((r) => !query(ctx, 'entity') || r.entity === query(ctx, 'entity')) };
});
registerSimReader('policyStages', async (ctx) => {
  const stage = query(ctx, 'stage'), featureId = query(ctx, 'featureId');
  if (stage && !(POLICY_SPEC_STAGES as readonly string[]).includes(stage)) throw new SimError('VALIDATION', `알 수 없는 정책 생애주기 값입니다: ${stage}`);
  const all = rows(await ctx.read('listPolicies')).filter((p) => !featureId || p.featureId === featureId).map((p) => ({ policyId: p.policyId, flagKey: p.flagKey, featureId: p.featureId, featureVersion: p.featureVersion, status: p.status, stage: policySpecStage(p) }));
  return { stages: POLICY_SPEC_STAGES.map((s) => ({ stage: s, label: POLICY_SPEC_STAGE_LABEL[s], statuses: POLICY_SPEC_STAGE_STATUSES[s], count: all.filter((p) => p.stage === s).length })), stage: stage ?? null, items: stage ? all.filter((p) => p.stage === stage) : all };
});
