// Shared browser-local ADS transactions. Captured evidence is immutable and missing source is never success.
import { registerSimHandler, SimError } from '../engine';
import { ApproveOddProfileBody, CreateConfigSetBody, ApproveConfigSetBody, ProposeSecurityMinBody, ApproveSecurityMinBody } from '../../../../../contracts/src/schemas/ads-config';
import { AdsDeterminationBody, AdsReviewFindingBody } from '../../../../../contracts/src/schemas/ads-evidence';
import { CloseImpactPathBody } from '../../../../../contracts/src/schemas/ads-change';
import { CreateOddSiteBody, ApproveOddSiteBody, RecoveryDecisionBody, UpdateClassificationBody, ConfirmClassificationBody, PutMarketBaselineBody, SupportDrillBody } from '../../../../../contracts/src/schemas/ads-p5';
import type { SimReadContext, SimWriteContext } from '../types';
export const LOCAL = 'LOCAL_SIMULATION';
export const fail = (code: string, message: string, details?: unknown): never => { throw new SimError(code, message, details); };
export async function source(ctx: SimReadContext, name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}): Promise<any> {
  return await ctx.snapshot(name, params, query) ?? fail('INTERNAL', `ADS source is unavailable: ${name}`);
}
export async function items(ctx: SimReadContext, name: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}): Promise<any[]> {
  const result = await source(ctx, name, params, query);
  return Array.isArray(result.items) ? result.items : fail('INTERNAL', `ADS item source is unavailable: ${name}`);
}
export const merge = (base: any[], local: any[], key: string) => [...new Map([...base, ...local].map(row => [row[key], row])).values()];
export async function feature(ctx: SimReadContext, id: string, ver: string) {
  const result = await ctx.read<any>('featureDetail', { id, ver });
  return result?.feature ?? fail('NOT_FOUND', `Feature ${id}@${ver} is missing.`);
}
const bodies: Record<string, any> = { approveOddProfile: ApproveOddProfileBody, createConfigSet: CreateConfigSetBody, approveConfigSet: ApproveConfigSetBody, proposeSecurityMin: ProposeSecurityMinBody, approveSecurityMin: ApproveSecurityMinBody, adsIncidentDetermination: AdsDeterminationBody, adsReviewFindingCreate: AdsReviewFindingBody, adsCloseImpactPath: CloseImpactPathBody, addOddSite: CreateOddSiteBody, approveOddSite: ApproveOddSiteBody, createRecoveryDecision: RecoveryDecisionBody, updateAdsClassification: UpdateClassificationBody, confirmAdsClassification: ConfirmClassificationBody, putMarketBaseline: PutMarketBaselineBody, runSupportDrill: SupportDrillBody };
export function write(name: string, action: string, component: string, fn: (ctx: SimWriteContext) => Promise<any>) {
  registerSimHandler(name, async ctx => {
    const target = ctx.req.params.id ?? ctx.req.body.featureId ?? ctx.req.body.swId ?? name;
    try {
      const result = await fn(ctx);
      ctx.audit({ action, target, after: { saved: true, provenance: LOCAL }, reason: ctx.req.body.reason ?? ctx.req.body.rationale ?? null, componentId: component });
      ctx.emit(action.toLowerCase().replaceAll('_', '.'), target, { provenance: LOCAL, by: ctx.actor.id }, { componentId: component });
      return result;
    } catch (e) {
      if (e instanceof SimError) ctx.fail(e.code, e.message, e.details, { action, target, reason: e.message, componentId: component, result: ['FORBIDDEN', 'SEPARATION_OF_DUTY'].includes(e.code) ? 'DENIED' : 'FAILED' });
      throw e;
    }
  }, { body: bodies[name] });
}
