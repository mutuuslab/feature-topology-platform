// ADS 발행 검사 — 순수 규칙(첫 화면 import 가능, zod 없음). 백엔드 정책 배포·게시본·차량 증명과 화면이 같은 함수를 쓴다.
// ADS-BE09 정책 컴파일이 승인 상한(ODD) 밖 배포 설정을 거부 · ADS-BE10 발행 후보를 승인 조합으로 거르고 복구 메타데이터를 재검증
// ADS-BE11 결정적 빌드 digest 입력(발행 메타 제외 + 컴파일러 버전) · ADS-BE16 분류 미등록 거부·시장 기준선 제외
// 적용 범위: 'ADS 구성 대상'(ODD 프로파일·승인 조합이 있거나 ADS Feature) Version만 — 기존 Feature 일괄 차단을 피하는 2단계 전환(설계 phases 2).
import { canonicalJson } from './canonical';
import { classifyVehicleConfig, compareDeploySettings, recoveryCandidateVerdict, validateOddProfile, type CompatClass, type ConfigSet, type DeploySetting, type OddCondition, type OddProfile, type VehicleConfigReport } from './ads-config';
import { classificationCompleteness, type AdsClassification, type MarketBaseline } from './ads-change';

/** 정책 컴파일러(게시본 빌더) 판 — 게시본 build 기록에 남는다(FFP-F013 '빌드 도구 버전 추적') */
export const POLICY_COMPILER_VERSION = 'ff-policy-compiler/1.0.0';

export interface PublishBlocker {
  code: string;
  message: string;
  ref: string;
}

// ───────────────────────── 정책 컴파일 — 승인 상한 (ADS-BE09) ─────────────────────────

/** ODD 프로파일 참조 — 정책·게시본 build·판정 로그(odd_ref)·집계 키에 같은 값을 쓴다(서로 다른 승인 ODD를 섞지 않는다, FFP-F025) */
export const oddProfileRef = (p: Pick<OddProfile, 'profileId'> | null | undefined): string | null => p?.profileId ?? null;

/**
 * 정책 컴파일 검사 — 이 Flag의 배포 설정을 승인된 ODD 프로파일의 승인 상한과 대조한다(FFP-F016).
 * 상한 초과(속도·지역·경계 포함 오기) → ODD_ENVELOPE_EXCEEDED, 값·단위를 해석하지 못하면 ODD_UNDECIDABLE(통과로 보지 않는다),
 * 배포 설정이 있는데 승인 프로파일이 없으면 ODD_PROFILE_MISSING. 배포 설정이 없는 Flag는 보지 않는다.
 */
export function oddCompileBlockers(i: { flagKey: string; settings: DeploySetting[]; profile: OddProfile | null }): PublishBlocker[] {
  const own = i.settings.filter((s) => s.flagKey === i.flagKey);
  if (!own.length) return [];
  if (!i.profile || i.profile.status !== 'APPROVED')
    return [{ code: 'ODD_PROFILE_MISSING', message: `${i.flagKey} 배포 설정 ${own.length}건을 대조할 승인된 ODD 프로파일이 없습니다 — 프로파일을 승인한 뒤 배포하세요.`, ref: i.flagKey }];
  const out: PublishBlocker[] = [];
  for (const c of compareDeploySettings(own, i.profile.envelope)) {
    if (c.verdict === 'EXCEEDS') out.push({ code: 'ODD_ENVELOPE_EXCEEDED', message: `${c.label} ${c.reason} — 승인 상한(${i.profile.profileId})보다 넓은 정책은 빌드하지 않습니다.`, ref: c.settingId });
    else if (c.verdict === 'UNDECIDABLE') out.push({ code: 'ODD_UNDECIDABLE', message: `${c.label} 판단 불가 — ${c.reason}`, ref: c.settingId });
  }
  return out;
}

/** 필수 조건 — 승인 상한에 required로 표시한 조건은 프로파일 조건에 반드시 있어야 한다(FFP-F026 '필수 조건', 의미 검증 validateOddProfile에 포함) */
export const validateOddRequired = (p: { envelope: OddCondition[]; conditions: OddCondition[] }) => validateOddProfile(p).filter((i) => i.code === 'REQUIRED_MISSING');

/** 적용 장소 추가 — 같은 Feature Version의 변경 영향(인증·안전 판단) 범위가 확정(CONFIRMED)일 때만 승인, 아니면 승인 대기(HT02) */
export function siteAdditionVerdict(
  impact: { impactId: string; featureId: string; version: string; scopeStatus: 'CONFIRMED' | 'REVIEW_REQUIRED' } | null,
  profile: Pick<OddProfile, 'featureId' | 'featureVersion'>,
): { status: 'APPROVED' | 'PENDING'; code: string | null; reason: string } {
  if (!impact) return { status: 'PENDING', code: 'IMPACT_REVIEW_OPEN', reason: '승인 대기 — 변경 영향(인증·안전 판단) 참조 없음' };
  if (impact.featureId !== profile.featureId || impact.version !== profile.featureVersion)
    return { status: 'PENDING', code: 'IMPACT_OTHER_FEATURE', reason: `승인 대기 — 변경 영향 ${impact.impactId}은(는) ${impact.featureId} ${impact.version}의 영향입니다` };
  if (impact.scopeStatus !== 'CONFIRMED') return { status: 'PENDING', code: 'IMPACT_REVIEW_OPEN', reason: `승인 대기 — 변경 영향 ${impact.impactId} 범위 확정 전` };
  return { status: 'APPROVED', code: null, reason: `승인됨 — 변경 영향 ${impact.impactId} 범위 확정` };
}

// ───────────────────────── 발행 후보 — 승인 조합·시장 기준선 (ADS-BE10·BE16) ─────────────────────────

/** 차량 국가 → 시장 기준선의 시장 코드(EU 회원국은 EU) */
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
export const marketOf = (country: string): string => (EU.has(country) ? 'EU' : country);

export type CandidateExclusion = 'CONFIG_SET_NOT_APPROVED' | 'CONFIG_UNCONFIRMED' | 'RECOVERY_PARTIAL' | 'SECURITY_MIN_VIOLATION' | 'MARKET_NOT_APPROVED' | 'ODD_NOT_APPROVED';
export const CANDIDATE_EXCLUSION_LABEL: Record<CandidateExclusion, string> = {
  CONFIG_SET_NOT_APPROVED: '승인 조합 밖',
  CONFIG_UNCONFIRMED: '형상 미확인',
  RECOVERY_PARTIAL: '부분 복구',
  SECURITY_MIN_VIOLATION: '보안 최소 버전 미달',
  MARKET_NOT_APPROVED: '미승인 시장',
  ODD_NOT_APPROVED: '승인 ODD 아님',
};
const FROM_COMPAT: Record<Exclude<CompatClass, 'MATCH'>, CandidateExclusion> = { MISMATCH: 'CONFIG_SET_NOT_APPROVED', UNCONFIRMED: 'CONFIG_UNCONFIRMED', PARTIAL_RECOVERY: 'RECOVERY_PARTIAL', BELOW_SECURITY_MIN: 'SECURITY_MIN_VIOLATION' };

export interface PublishScope {
  /** ADS 구성 대상 Version(ODD 프로파일·승인 조합이 있거나 ADS Feature) — 아니면 기존 범위 그대로 */
  adsScope: boolean;
  fClass: string | null;
  sets: ConfigSet[];
  baselines: MarketBaseline[];
  approvedOddProfileId: string | null;
  classification: AdsClassification | null;
  now: number;
}
export interface CandidateVehicle {
  vin: string;
  country: string;
  report: VehicleConfigReport | null;
}
export interface PublishCandidates {
  targets: string[];
  excluded: { vin: string; code: CandidateExclusion; reason: string }[];
  /** 승인 조합 없이 허용한 차량 수(F0·F1) — '조합 미검증' */
  unverifiedCombo: number;
  /** 발행 자체를 막는 사유 */
  blockers: PublishBlocker[];
}

const fRankOf = (f: string | null) => (f && /^F[0-4]$/.test(f) ? Number(f[1]) : -1);

/** 분류 미등록 — 확정 전·DDT 영향 등 축 빈칸·상태별 책임자 미지정(출처는 보지 않는다) */
export function classificationReleaseBlocker(i: { adsScope: boolean; classification: AdsClassification | null }): PublishBlocker | null {
  if (!i.adsScope) return null;
  const c = classificationCompleteness(i.classification);
  if (c.classified) return null;
  return { code: 'CLS_UNREGISTERED', message: `ADS 분류 미등록(${c.gaps.length}칸: ${c.gaps.join('·')}) — Feature 작성자가 분류를 입력하고 기능안전 담당자가 확정해야 출시·발행할 수 있습니다.`, ref: i.classification ? `${i.classification.featureId}@${i.classification.version}` : 'classification' };
}

/**
 * 정책 게시 대상 — Feature 적용 범위 안 차량을 승인 조합·시장 기준선으로 거른다.
 * 순서: 시장(기준선이 있으면 승인 시장만, 기준선의 승인 ODD가 지금 승인 프로파일과 다르면 제외) → 승인 조합(같은 Feature의 조합 중 하나라도 부합).
 * 승인 조합이 없으면 F2 이상은 발행 거부(CONFIG_SET_MISSING), F0·F1은 허용하고 조합 미검증 수를 센다.
 */
export function publishCandidates(s: PublishScope, vehicles: CandidateVehicle[]): PublishCandidates {
  if (!s.adsScope) return { targets: vehicles.map((v) => v.vin), excluded: [], unverifiedCombo: 0, blockers: [] };
  const blockers: PublishBlocker[] = [];
  const cls = classificationReleaseBlocker({ adsScope: true, classification: s.classification });
  if (cls) blockers.push(cls);
  if (!s.sets.length && fRankOf(s.fClass) >= 2) blockers.push({ code: 'CONFIG_SET_MISSING', message: `${s.fClass} Feature에 승인 구성 조합이 없어 발행할 수 없습니다 — 차량 사양·Variant 담당자가 승인 조합을 등록하세요.`, ref: 'config-set' });
  const targets: string[] = [];
  const excluded: PublishCandidates['excluded'] = [];
  let unverified = 0;
  for (const v of vehicles) {
    if (s.baselines.length) {
      const m = marketOf(v.country);
      const bl = s.baselines.find((b) => b.market === m || b.market === v.country);
      if (!bl || bl.approvalStatus !== 'APPROVED') {
        excluded.push({ vin: v.vin, code: 'MARKET_NOT_APPROVED', reason: `${m} 시장 기준선 ${bl ? (bl.approvalStatus === 'UNKNOWN' ? '판단 불가' : '승인 대기') : '없음'}` });
        continue;
      }
      if (bl.oddProfileRef && bl.oddProfileRef !== s.approvedOddProfileId) {
        excluded.push({ vin: v.vin, code: 'ODD_NOT_APPROVED', reason: `${m} 승인 ODD ${bl.oddProfileRef} — 지금 승인 프로파일 ${s.approvedOddProfileId ?? '없음'}` });
        continue;
      }
    }
    if (!s.sets.length) {
      unverified++;
      targets.push(v.vin);
      continue;
    }
    const verdicts = s.sets.map((set) => classifyVehicleConfig(set, v.report, s.now));
    const best = verdicts.find((x) => x.cls === 'MATCH') ?? verdicts[0];
    if (best.cls === 'MATCH') targets.push(v.vin);
    else excluded.push({ vin: v.vin, code: FROM_COMPAT[best.cls], reason: best.reasons.join(' · ') });
  }
  return { targets, excluded, unverifiedCombo: unverified, blockers };
}

/** 분류 확정 서명 대상 — 축 값·담당·상태별 책임자(출처·확정 시각은 넣지 않는다). 확정 뒤 이 값이 바뀌면 재확정 필요 */
export function classificationConfirmHash(c: Pick<AdsClassification, 'featureId' | 'version' | 'adsFeature' | 'ddtImpact' | 'safetyRelated' | 'owner' | 'lifecycleOwners'>): string {
  return canonicalJson({ featureId: c.featureId, version: c.version, adsFeature: c.adsFeature, ddtImpact: c.ddtImpact, safetyRelated: c.safetyRelated, owner: c.owner, lifecycleOwners: c.lifecycleOwners ?? {} });
}

// ───────────────────────── 결정적 빌드 digest (ADS-BE11) ─────────────────────────

/**
 * 게시본 build digest 입력 — 승인 내용(정책 명세·내용 해시·기대 회신 값·차단 내용)과 ODD 프로파일 참조·컴파일러 판만.
 * publicationId·issuedAt·sequence·대상 차량(배포 범위)은 발행 메타라 넣지 않는다 — 같은 승인 입력이면 재빌드해도 digest가 같다.
 */
export function buildDigestInput(d: { kind: string; featureId: string; featureVersion: string; flagKey: string | null; spec: unknown; contentHash: string | null; desired: string; kill: unknown; oddProfileRef: string | null }): string {
  return canonicalJson({ compiler: POLICY_COMPILER_VERSION, kind: d.kind, featureId: d.featureId, featureVersion: d.featureVersion, flagKey: d.flagKey, spec: d.spec ?? null, contentHash: d.contentHash, desired: d.desired, kill: d.kill ?? null, oddProfileRef: d.oddProfileRef });
}

// ───────────────────────── 복구 결정 (ADS-BE10 · FFP-F039·F040) ─────────────────────────

export const RECOVERY_PATHS = ['RESTORE_PREVIOUS', 'APPLY_FIX', 'SAFE_STATE', 'SERVICE'] as const;
export type RecoveryPath = (typeof RECOVERY_PATHS)[number];
export const RECOVERY_PATH_LABEL: Record<RecoveryPath, string> = { RESTORE_PREVIOUS: '승인 조합으로 복구', APPLY_FIX: '수정본 적용', SAFE_STATE: '정지 유지', SERVICE: '정비 입고' };

/** 복구 후보 정책 메타데이터 재검증 — 서명 유효기간·키 epoch·형상 참조를 지금 기준으로(오래된 메타데이터 우회 거부) */
export function recoveryMetadataVerdict(
  m: { keyNotAfter: string | null; keyEpoch: number | null; configSetRef: string | null },
  ctx: { now: number; currentEpoch: number; approvedSetIds: string[] },
): { ok: boolean; reasons: { code: string; message: string }[] } {
  const reasons: { code: string; message: string }[] = [];
  if (!m.keyNotAfter || !(Date.parse(m.keyNotAfter) > ctx.now)) reasons.push({ code: 'SIGNATURE_EXPIRED', message: `복구 후보의 서명 유효기간이 지났습니다(${m.keyNotAfter?.slice(0, 10) ?? '기록 없음'}) — 새 승인·새 서명으로 다시 게시하세요.` });
  if (m.keyEpoch === null || m.keyEpoch < ctx.currentEpoch) reasons.push({ code: 'EPOCH_STALE', message: `복구 후보의 키 epoch ${m.keyEpoch ?? '기록 없음'} < 현재 ${ctx.currentEpoch} — 이전 epoch 메타데이터는 받지 않습니다.` });
  if (!m.configSetRef || !ctx.approvedSetIds.includes(m.configSetRef)) reasons.push({ code: 'CONFIG_SET_NOT_APPROVED', message: `복구 형상 참조 ${m.configSetRef ?? '없음'}이(가) 승인 조합이 아닙니다.` });
  return { ok: reasons.length === 0, reasons };
}

/** 복구 결정 거부 사유 — 이전 버전 복구는 보안 최소 버전·메타데이터를, 모든 경로는 부분 복구 보고를 '복구 완료'로 두지 않는다 */
export function recoveryDecisionBlockers(i: { path: RecoveryPath; set: ConfigSet; report: VehicleConfigReport | null; metadata: { ok: boolean; reasons: { code: string; message: string }[] }; now: number }): PublishBlocker[] {
  if (i.path !== 'RESTORE_PREVIOUS') return [];
  const out: PublishBlocker[] = [];
  const cand = recoveryCandidateVerdict(i.set, i.report?.recoveryCandidate ?? null);
  if (cand.allowed === false) out.push({ code: 'SECURITY_MIN_VIOLATION', message: cand.reason, ref: i.report?.recoveryCandidate?.swId ?? '' });
  if (cand.allowed === null) out.push({ code: 'RECOVERY_CANDIDATE_MISSING', message: '복구 후보 없음 — 차량이 복구 후보를 보고하지 않았습니다.', ref: i.report?.vin ?? '' });
  for (const r of i.metadata.reasons) out.push({ code: r.code, message: r.message, ref: i.set.setId });
  return out;
}

/** 복구 뒤 재활성화 후보 — 승인 조합과 부합일 때만(부분 복구·불일치·미확인은 '복구 완료'로 보이지 않는다, TC17) */
export function reactivationCandidate(verdict: { cls: CompatClass; code: string }): { eligible: boolean; reason: string } {
  if (verdict.cls === 'MATCH') return { eligible: true, reason: '승인 조합과 같음 — 재활성화 후보' };
  if (verdict.cls === 'PARTIAL_RECOVERY') return { eligible: false, reason: '조건 부족 — 부분 복구(일부 ECU만 복구), 복구 뒤 재검증' };
  if (verdict.cls === 'UNCONFIRMED') return { eligible: false, reason: '조건 부족 — 형상 미확인, 복구 뒤 재검증' };
  return { eligible: false, reason: '조건 부족 — 승인 조합 밖(복구 뒤 재검증)' };
}
