// 안전 프로파일 초안 — 데이터셋 v0.81(ASIL·연결 SW safetyClass)에서 Feature Version마다 보고서 5.7 속성 초안을 만든다.
//   node tools/dataset/safety-infer.ts   → data/fixtures/safety/profiles.json (결정적: 같은 입력이면 같은 바이트, data:check가 재생성 일치를 검사)
// 초안(DRAFT·INFERRED)은 Safety Manager가 화면에서 확정해야 원천이 된다. 보고서 예시가 있는 Feature(FEAT-00022)는 부록 D.6 값으로 확정 시드.
// 추정은 과소평가를 막도록 ASIL과 SW 등급 중 높은 쪽(inferFClass), 시간값은 보고서 7.4 예제 파라미터.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { FF, readJson } from '../lib.ts';

const require = createRequire(import.meta.url);
const C = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../../contracts/src/index');

export const PROFILES = join(FF, 'data', 'fixtures', 'safety', 'profiles.json');
const SEED_AT = '2026-10-13T00:00:00.000Z';
/** 보고서 7.4 예제 파라미터(실제 값은 Item의 HARA·FSC가 정한다) */
const EXAMPLE = { takeoverMs: 4000, rampMs: 3000, faultRampMs: 1500, faultTolerantTimeMs: 5000, maxPendingMs: 600000, maxCycleWaitMs: 28800000 };

type P = import('../../contracts/src/index').SafetyProfile;

export function buildProfiles(): P[] {
  const features = readJson<any[]>(join(FF, 'data', 'fixtures', 'v0.81', 'features.json'));
  const sw = Object.fromEntries(readJson<any[]>(join(FF, 'data', 'fixtures', 'v0.81', 'swMaster.json')).map((s) => [s.swId, s.safetyClass]));
  const report = readJson<any>(join(FF, 'harness', 'guide', 'schema', 'examples', 'registry.json')).features;
  const out: P[] = features.map((f) => {
    const fClass = C.inferFClass(f.asil, (f.swIds ?? []).map((id: string) => sw[id]).filter(Boolean));
    const r = C.fRank(fClass);
    const deactClass = r === 0 ? 'DC0' : r === 1 ? 'DC1' : 'DC2';
    const flagType = r >= 2 ? 'OPS' : (f.catalogIds ?? []).length ? 'PERMISSION' : 'RELEASE';
    const p: P = {
      featureId: f.featureId,
      version: f.version,
      status: 'DRAFT',
      source: 'INFERRED',
      fClass,
      deactClass,
      regClass: r >= 2 ? 'R1' : 'R0',
      flagType,
      adsFeature: false,
      adsfType: null,
      gsrMandatory: false,
      itemIds: [],
      haraRef: null,
      asilRef: (['QM', 'A', 'B', 'C', 'D'].includes(f.asil) ? f.asil : 'QM') as P['asilRef'],
      safetyGoalIds: [],
      safeState: r >= 2 ? 'BASE_ONLY' : null,
      endState: r >= 2 ? 'DISABLED' : null,
      takeoverMs: deactClass === 'DC2' ? EXAMPLE.takeoverMs : 0,
      rampMs: deactClass === 'DC2' ? EXAMPLE.rampMs : 0,
      faultRampMs: r >= 2 ? EXAMPLE.faultRampMs : 0,
      faultTolerantTimeMs: r >= 2 ? EXAMPLE.faultTolerantTimeMs : 0,
      maxPendingMs: deactClass === 'DC1' ? EXAMPLE.maxPendingMs : 0,
      maxCycleWaitMs: deactClass === 'DC0' ? 0 : EXAMPLE.maxCycleWaitMs,
      maxActivationScope: { vehicles: 50000, perWindow: 5000 },
      markets: r >= 2 ? [f.country] : [],
      rxswin: [],
      approvalProfile: null,
      evidenceManifestId: null,
      sbomRef: null,
      rollbackTarget: null,
      expiresAt: null,
      retirementPlan: null,
      confirmedBy: null,
      confirmedAt: null,
      confirmSig: null,
    };
    // 보고서 부록 D.6 예시가 있는 Feature Version은 그 값으로 확정 시드(출처 표기)
    const e = report[f.featureId];
    if (e && e.version === f.version) {
      Object.assign(p, {
        status: 'CONFIRMED',
        source: 'REPORT_EXAMPLE',
        fClass: e.f_class,
        deactClass: e.deact_class,
        regClass: e.type_approval_relevant ? 'R1' : 'R0',
        flagType: 'OPS',
        gsrMandatory: e.gsr_mandatory,
        adsFeature: e.ads_feature,
        itemIds: e.item ? [e.item] : [],
        haraRef: 'HARA-SCC-01',
        safetyGoalIds: ['SG-SCC-01'],
        takeoverMs: e.profile.takeover_ms,
        rampMs: e.profile.ramp_ms,
        faultRampMs: e.profile.fault_ramp_ms,
        maxPendingMs: e.profile.max_pending_ms,
        maxCycleWaitMs: e.profile.max_cycle_wait_ms,
        maxActivationScope: { vehicles: e.max_vehicles, perWindow: e.max_per_window },
        markets: e.markets_approved,
        approvalProfile: 'AP-F3',
        confirmedBy: 'report:FFP-FS-STR-001 v1.1 D.6',
        confirmedAt: SEED_AT,
      } satisfies Partial<P>);
    }
    return C.SafetyProfile.parse(p);
  });
  return out.sort((a, b) => `${a.featureId}@${a.version}`.localeCompare(`${b.featureId}@${b.version}`));
}

export const serializeProfiles = (p: P[]) => JSON.stringify(p, null, 2) + '\n';

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/dataset/safety-infer.ts')) {
  const p = buildProfiles();
  mkdirSync(dirname(PROFILES), { recursive: true });
  writeFileSync(PROFILES, serializeProfiles(p));
  const confirmed = p.filter((x) => x.status === 'CONFIRMED').length;
  console.log(`safety-infer  ${p.length}개 Feature Version 프로파일(확정 ${confirmed} · 초안 ${p.length - confirmed}) → data/fixtures/safety/profiles.json`);
}
