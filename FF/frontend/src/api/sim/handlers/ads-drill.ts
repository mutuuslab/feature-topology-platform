import { supportEndDrill } from '../../../../../contracts/src/rules/lifecycle-isolation';
import { registerSimReader } from '../engine';
import type { SimReadContext } from '../types';
import { fail, feature, items, LOCAL, merge, write } from './ads-shared';
const DRILL = 'adsSupportDrill';
async function drills(ctx: SimReadContext, id: string, ver: string) {
  await feature(ctx, id, ver);
  return merge(await items(ctx, 'supportDrills', { id, ver }), ctx.list<any>(DRILL).filter(d => d.featureId === id && d.version === ver), 'drillId');
}
registerSimReader('supportDrills', async ctx => ({ items: await drills(ctx, ctx.req.params.id, ctx.req.params.ver) }));
write('runSupportDrill', 'SUPPORT_END_DRILL', 'D01-01', async ctx => {
  const { id, ver } = ctx.req.params, f = await feature(ctx, id, ver), b = ctx.req.body;
  const policies = await ctx.read<any>('listPolicies'), publications = await ctx.read<any>('publications'), kills = await ctx.read<any>('killRequests'), keys = await ctx.read<any>('pkiKeys');
  for (const [name, result] of Object.entries({ policies, publications, kills, keys })) if (!Array.isArray(result?.items)) fail('INTERNAL', `Support drill ${name} source is unavailable.`);
  const policy = policies.items.filter((p: any) => p.featureId === id && p.featureVersion === ver && p.status === 'DEPLOYED').at(-1) ?? null;
  const pub = policy ? publications.items.filter((p: any) => p.kind === 'POLICY' && p.payload?.policy?.policyId === policy.policyId).at(-1) ?? null : null;
  const kill = kills.items.find((k: any) => k.status === 'ACTIVE' && k.featureIds?.includes(id)) ?? null;
  let verifiedPublication = false;
  if (pub) {
    const detail = await ctx.read<any>('publicationDetail', { id: pub.publicationId });
    verifiedPublication = detail.verification?.valid === true;
    if (!Array.isArray(pub.payload?.targets) || !Array.isArray(pub.nodes) || !pub.signature?.keyId) fail('INTERNAL', 'Publication source lacks target or signature metadata.');
  }
  const vehicles = (pub?.payload.targets ?? []).map((vin: string) => {
    const trusted = verifiedPublication && pub.nodes.find((n: any) => n.nodeId === vin)?.state === 'CONFIRMED';
    return { vin, actuator: 'IDLE' as const, acceptedPolicyHash: trusted ? pub.payload.desired : null, installedSw: null, flagValue: !!trusted && !kill, shadowLog: [], trustedKeys: [pub.signature.keyId], lastVerified: trusted ? { policyHash: pub.payload.desired, value: !kill, keyId: pub.signature.keyId } : null };
  });
  const result = supportEndDrill({ featureId: id, version: ver, lifecycle: f.lifecycle, baseline: policy ? { policyId: policy.policyId, contentHash: policy.contentHash, safeDefault: policy.safeDefault } : null, kill: kill ? { active: true, killId: kill.killId } : null, keys: keys.items, vehicles, now: ctx.now().getTime(), horizonDays: b.horizonDays });
  const fs = await ctx.read<any>('listFeatures', {}, { latestOnly: false });
  if (!Array.isArray(fs?.items)) fail('INTERNAL', 'Feature history is unavailable.');
  const all = (await Promise.all(fs.items.map((f: any) => drills(ctx, f.featureId, f.version)))).flat();
  const row = { drillId: ctx.nextId('DRL', all.map(d => d.drillId)), featureId: id, version: ver, lifecycle: f.lifecycle, horizonDays: b.horizonDays, runBy: ctx.actor.id, runAt: ctx.iso(), publicationId: pub?.publicationId ?? null, reason: b.reason, ...result, provenance: LOCAL, vehicleApplicationPerformed: false, sourceBoundary: 'Captured or locally simulated verified receipt facts; no vehicle execution is performed.' };
  ctx.put(DRILL, row.drillId, row, { created: true }); return row;
});
