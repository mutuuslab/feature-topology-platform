// This verifier accepts only the exact FF scaffold/removal templates generated here. It is not an arbitrary-source AST scanner.
import { canonicalJson } from '../../../../../contracts/src/rules/canonical';
import { flagConstantName, flagFeatureDir, flagScanSigningPayload } from '../../../../../contracts/src/rules/flag-coverage';
import { flagScaffoldFiles } from '../../../../../contracts/src/rules/flag-scaffold';
import { FlagPlanEntry } from '../../../../../contracts/src/schemas/flag-code';
import { sha256 } from '../../software';
import { SimError } from '../engine';
import type { SimReadContext, SimWriteContext } from '../types';

export const FLAG_LOCAL_SOURCE = 'LOCAL_SIMULATION';
const SCAN_DOMAIN = 'FF-LOCAL-FLAG-DEMO/1\nSCAN\n', APPROVAL_DOMAIN = 'FF-LOCAL-FLAG-DEMO/1\nAPPROVAL\n';
export interface DemoBundle { feature: { featureId: string; version: string; name: string }; plan: any[]; removed: { entry: any; finalValue: boolean }[]; files: { path: string; content: string; sha256: string }[]; }
export function templateFiles(feature: DemoBundle['feature'], plan: any[], removed: DemoBundle['removed'] = []) {
  if (!/^FEAT-\d{5}$/.test(feature.featureId) || !/^\d+\.\d+\.\d+$/.test(feature.version) || typeof feature.name !== 'string' || /[\x00-\x1f\x7f\u2028\u2029]/.test(feature.name)) throw new SimError('VALIDATION', 'DEMO scaffold parameters must not inject source lines or control characters.');
  for (const p of [...plan, ...removed.map(r => r.entry)]) if (!FlagPlanEntry.safeParse(p).success || p.featureId !== feature.featureId) throw new SimError('VALIDATION', 'DEMO scaffold requires validated Flag plan entries for the same Feature.');
  if (removed.some(r => typeof r.finalValue !== 'boolean')) throw new SimError('VALIDATION', 'DEMO removal final values must be booleans.');
  const kept = flagScaffoldFiles(feature, plan), origin = plan[0] ?? removed[0]?.entry;
  if (!origin) return [];
  if (!removed.length) return kept;
  const dir = flagFeatureDir(origin.package, feature.featureId), flags = kept.find(f => f.path.endsWith('/flags.ts'))?.content ?? `// FF가 만든 Flag 상수 — ${feature.featureId}의 Flag가 모두 퇴역했다.\nexport {};\n`;
  let guards = kept.find(f => f.path.endsWith('/flag-guards.ts'))?.content ?? "import type { FlagClient, FlagContext } from '../../../../runtime/src/flag-client.ts';\n\n";
  for (const r of removed) {
    const declaration = flagScaffoldFiles(feature, [r.entry])[1].content.split('\n').find(l => l.startsWith('export function'))!.replace(/\{$/, '');
    guards += `${declaration}{\n  // Retirement 최종 값 — ${flagConstantName(r.entry.flagKey)} 호출을 지웠다\n  return Promise.resolve(${r.finalValue});\n}\n`;
  }
  return [{ path: `${dir}/flags.ts`, content: flags }, { path: `${dir}/flag-guards.ts`, content: guards }];
}
export async function makeBundle(feature: DemoBundle['feature'], plan: any[], removed: DemoBundle['removed'] = []): Promise<DemoBundle> {
  const target = { featureId: feature.featureId, version: feature.version, name: feature.name };
  const files = await Promise.all(templateFiles(target, plan, removed).map(async f => ({ ...f, sha256: 'sha256:' + await sha256(f.content) })));
  return { feature: target, plan, removed, files };
}
export async function verifyBundle(bundle: DemoBundle) {
  const expected = templateFiles(bundle.feature, bundle.plan, bundle.removed), seen = new Set<string>();
  if (bundle.files.length !== expected.length) throw new SimError('GUARD_FAILED', 'DEMO source file count does not match its exact template.');
  for (const f of bundle.files) {
    if (seen.has(f.path) || !expected.some(e => e.path === f.path && e.content === f.content) || f.sha256 !== 'sha256:' + await sha256(f.content)) throw new SimError('GUARD_FAILED', 'DEMO source bytes, path or hash differ from the exact FF template.');
    seen.add(f.path);
  }
  return true;
}
export async function scanDemoBundles(bundles: DemoBundle[], paths: string[] = []) {
  const usages: any[] = [], unresolved: any[] = [], files: DemoBundle['files'] = [];
  const included = (path: string) => !paths.length || paths.some(p => path === p || path.startsWith(p.replace(/\/+$/, '') + '/'));
  for (const bundle of bundles) {
    await verifyBundle(bundle);
    const selected = bundle.files.filter(f => included(f.path)); files.push(...selected);
    const guard = selected.find(f => f.path.endsWith('/flag-guards.ts')), constants = selected.find(f => f.path.endsWith('/flags.ts'));
    if (!guard) continue;
    const lines = guard.content.split('\n');
    for (const entry of bundle.plan) {
      const call = `  return client.getBooleanValue(${flagConstantName(entry.flagKey)}, false, ctx);`, at = lines.indexOf(call);
      if (at < 0 || lines.lastIndexOf(call) !== at) throw new SimError('GUARD_FAILED', 'The exact DEMO template has an ambiguous SDK call.');
      const location = { path: guard.path, line: at + 1, symbol: 'client.getBooleanValue', method: 'getBooleanValue' };
      if (!constants) unresolved.push(location); else usages.push({ ...location, flagKey: entry.flagKey, safeDefault: 'EXPLICIT_FALSE', contentHash: guard.sha256, via: 'CONST' });
    }
  }
  if (new Set(files.map(f => f.path)).size !== files.length) throw new SimError('CONFLICT', 'DEMO bundles contain duplicate source paths.');
  return { usages, unresolved, files };
}
const b64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const payload = (purpose: 'SCAN' | 'APPROVAL', value: any) => (purpose === 'SCAN' ? SCAN_DOMAIN + flagScanSigningPayload(value) : APPROVAL_DOMAIN + canonicalJson(value));
export async function signLocalFlag(ctx: SimWriteContext, purpose: 'SCAN' | 'APPROVAL', value: any) {
  const keyName = purpose + ':' + (purpose === 'SCAN' ? 'scanner' : ctx.actor.id), keys = ctx.state<Record<string, any>>('flagLocalSigning', () => ({}));
  if (!keys[keyName]) {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    keys[keyName] = { keyId: 'LOCAL-FLAG-' + purpose + '-' + crypto.randomUUID(), privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey), purpose, ownerId: purpose === 'SCAN' ? 'local-scanner' : ctx.actor.id, provenance: FLAG_LOCAL_SOURCE };
  }
  const anchor = keys[keyName], key = await crypto.subtle.importKey('jwk', anchor.privateKey, 'Ed25519', false, ['sign']);
  return { keyId: anchor.keyId, signature: b64(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(payload(purpose, value)))), purpose, provenance: FLAG_LOCAL_SOURCE };
}
export async function verifyLocalFlag(ctx: SimReadContext, purpose: 'SCAN' | 'APPROVAL', value: any, signature: any) {
  if (!signature?.keyId?.startsWith('LOCAL-FLAG-' + purpose + '-') || signature.purpose !== purpose || signature.provenance !== FLAG_LOCAL_SOURCE) return false;
  const anchors = Object.values('state' in ctx ? (ctx as SimWriteContext).state<Record<string, any>>('flagLocalSigning', () => ({})) : ctx.overlay.data.flagLocalSigning ?? {}) as any[], anchor = anchors.find(k => k.keyId === signature.keyId);
  if (!anchor || anchor.purpose !== purpose || anchor.provenance !== FLAG_LOCAL_SOURCE) return false;
  if (purpose === 'APPROVAL' && anchor.ownerId !== value.by) return false;
  try { const key = await crypto.subtle.importKey('jwk', anchor.publicKey, 'Ed25519', false, ['verify']); return await crypto.subtle.verify('Ed25519', key, decode(signature.signature), new TextEncoder().encode(payload(purpose, value))); } catch { return false; }
}
