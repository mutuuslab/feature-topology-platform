// Flag 코드 연결 대사(20-97 §3) — 등록·코드·Unleash·배포·회신 5원천을 한 Flag로 맞춰 상태를 판정하는 순수 함수.
// 백엔드 대사판·출시 관문·PR 검사와 시연 데이터 생성기가 같은 판정을 쓴다. 입력에 없는 원천은 추측하지 않는다.
import type { ControlPointType, Lifecycle } from '../enums';
import type { PolicyStatus } from '../schemas/policy';
import type { PublicationStatus } from '../schemas/ops';
import { jcs } from './jcs';
import type {
  FlagCoverageFinding,
  FlagCoverageSeverity,
  FlagCoverageStatus,
  FlagLane,
  FlagLaneState,
  FlagPackage,
  FlagPlanEntry,
  FlagPrCheckFinding,
  FlagPrCheckResult,
  FlagPrState,
  FlagSourceManifestV2,
} from '../schemas/flag-code';

const DAY = 86_400_000;
/** 전면 배포(100%) 뒤 이 기간이 지나도 코드에 남은 Flag, 또는 이 기간 평가가 없는 Flag = 오래된 Flag */
export const FLAG_STALE_AFTER_DAYS = 90;
/** Flag PR이 열린 뒤 이 기간 안이면 '검토 중', 지나면 '코드 없음' */
export const FLAG_PR_GRACE_DAYS = 10;
/** 코드 연결이 필요한 Feature Lifecycle — 승인 뒤부터 퇴역 전까지(DEPRECATED도 차량에 남아 있으므로 포함) */
export const FLAG_CODE_REQUIRED_LIFECYCLES: readonly Lifecycle[] = ['APPROVED', 'DEVELOPING', 'VERIFIED', 'RELEASED', 'DEPRECATED'];
/** 출시를 막는 Feature Lifecycle 판단 — 출시 직전·출시 뒤에 코드가 없으면 즉시 BLOCKER */
const RELEASE_STAGE: readonly Lifecycle[] = ['VERIFIED', 'RELEASED', 'DEPRECATED'];
/** 정책이 Unleash에 있어야 하는 상태 */
const UNLEASH_EXPECTED: readonly PolicyStatus[] = ['APPROVED', 'DEPLOYED'];
/** 출시 관문이 막는 상태(해제 승인이 있으면 통과) */
export const FLAG_RELEASE_BLOCKING: readonly FlagCoverageStatus[] = ['NO_CODE', 'CALL_DELETED', 'PR_OPEN', 'UNLEASH_MISMATCH', 'UNREGISTERED_KEY'];
/** 주 상태 우선순위 — 앞이 이긴다 */
export const FLAG_STATUS_PRIORITY: readonly FlagCoverageStatus[] = ['UNREGISTERED_KEY', 'CALL_DELETED', 'NO_CODE', 'UNLEASH_MISMATCH', 'REMOVAL_DUE', 'PR_OPEN', 'STALE', 'DYNAMIC_KEY', 'OK'];

// ── Flag 계획(등록) ─────────────────────────────────────
export const CONTROL_POINT_SUFFIX: Record<ControlPointType, string> = { Flag: 'enable', Parameter: 'param', Signal: 'signal', DTC: 'dtc' };

/** 공식 도메인 약어(30-95 domain-alias) → 차량 SW 패키지 */
const DOMAIN_PACKAGE: Record<string, FlagPackage> = { AD: 'adas', IN: 'ivi', BC: 'body', CH: 'chassis', PC: 'powertrain', PE: 'powertrain', SF: 'safety', CO: 'connectivity', PL: 'platform', BE: 'connectivity' };
/** 기준 행 연결이 없을 때 담당 조직, 그다음 태그의 낱말로 고른다(표의 앞 줄이 이긴다) */
const WORD_PACKAGE: [RegExp, FlagPackage][] = [
  [/adas|parking|주차|distance/i, 'adas'],
  [/driving성능|vehicle dynamics|차량제어|chassis|steering|brake|suspension/i, 'chassis'],
  [/\bivi|infotainment|\bux|navigation|hmi|audio/i, 'ivi'],
  [/cabin안전|regulation|safety|airbag/i, 'safety'],
  [/digital key|climate|body|seat|door|light/i, 'body'],
  [/\bev|energy|battery|charging|powertrain/i, 'powertrain'],
  [/legacy service|telematics|connect|\bota/i, 'connectivity'],
];

export function flagPackageOf(f: { domainAbbr?: string | null; ownerId?: string | null; tags?: readonly string[] }): FlagPackage {
  const byDomain = f.domainAbbr ? DOMAIN_PACKAGE[f.domainAbbr] : undefined;
  if (byDomain) return byDomain;
  // 담당 조직이 먼저 — 태그는 다른 도메인 낱말(예: EV 기능의 climate)이 섞여 있어 조직으로 못 정할 때만 본다
  for (const words of [f.ownerId ?? '', (f.tags ?? []).join(' ')]) {
    const hit = WORD_PACKAGE.find(([re]) => re.test(words));
    if (hit) return hit[1];
  }
  return 'platform';
}

/**
 * Feature Version의 제어점마다 Flag 키를 정한다. 같은 Feature에 같은 제어점 유형의 정책이 있으면 그 키를 쓰고(정책 키 우선),
 * 없으면 `<패키지>_<번호5>_<접미사>[_순번]`을 만든다. 제어점에 대응하지 않는 정책 키도 뒤에 붙인다. 결과는 결정적이다.
 */
export function planFeatureFlags(
  f: { featureId: string; version: string; controlPoints: readonly ControlPointType[] },
  pkg: FlagPackage,
  policies: readonly { flagKey: string; controlPoint: ControlPointType }[],
): FlagPlanEntry[] {
  const num = f.featureId.slice(5);
  const unused = [...policies].sort((a, b) => a.flagKey.localeCompare(b.flagKey));
  const out: FlagPlanEntry[] = [];
  const seen = new Map<ControlPointType, number>();
  for (const cp of f.controlPoints) {
    const ordinal = (seen.get(cp) ?? 0) + 1;
    seen.set(cp, ordinal);
    const i = unused.findIndex((p) => p.controlPoint === cp);
    if (i >= 0) {
      out.push({ flagKey: unused[i].flagKey, featureId: f.featureId, version: f.version, controlPoint: cp, ordinal, package: pkg, source: 'POLICY' });
      unused.splice(i, 1);
    } else {
      const key = `${pkg}_${num}_${CONTROL_POINT_SUFFIX[cp]}${ordinal > 1 ? `_${ordinal}` : ''}`;
      out.push({ flagKey: key, featureId: f.featureId, version: f.version, controlPoint: cp, ordinal, package: pkg, source: 'PLANNED' });
    }
  }
  for (const p of unused) {
    const ordinal = (seen.get(p.controlPoint) ?? 0) + 1;
    seen.set(p.controlPoint, ordinal);
    out.push({ flagKey: p.flagKey, featureId: f.featureId, version: f.version, controlPoint: p.controlPoint, ordinal, package: pkg, source: 'POLICY' });
  }
  return out;
}

/** 코드 상수 이름 — care_00022_param → CARE_00022_PARAM */
export const flagConstantName = (flagKey: string) => flagKey.toUpperCase();
/** Feature 폴더 — packages/<패키지>/src/features/feat-00022 */
export const flagFeatureDir = (pkg: FlagPackage, featureId: string) => `packages/${pkg}/src/features/${featureId.toLowerCase()}`;
/** FF가 여는 Flag PR 브랜치 */
export const flagScaffoldBranch = (featureId: string, version: string) => `ff/flags/${featureId.toLowerCase()}-${version}`;
export const flagRemovalBranch = (flagKey: string) => `ff/remove/${flagKey}`;

// ── 대사 판정 ──────────────────────────────────────────
export interface FlagCoverageInput {
  now: string;
  flagKey: string;
  /** 등록 원장 — Flag 계획 또는 정책. 없으면 코드에만 있는 키다 */
  registry: {
    featureId: string;
    version: string;
    lifecycle: Lifecycle;
    /** Flag 계획이 등록된 시각(Feature Version 승인) */
    plannedAt: string | null;
    policy: { policyId: string; status: PolicyStatus; revision: number } | null;
    /** Flag Retirement — 승인됐으면 코드 삭제가 목표가 된다 */
    retirement: { approvedAt: string; codeRemovalDueAt: string | null; codeRemoved: boolean } | null;
    registryRetiredAt: string | null;
  } | null;
  code: {
    /** 연결된 저장소들의 최신 서명 스캔(기본 브랜치)에서 찾은 호출 수 */
    current: number;
    /** 현재엔 없지만 이전 스캔에서 마지막으로 본 근거 */
    lastSeen: { commit: string; at: string } | null;
    lastScanAt: string | null;
  };
  pullRequest: { state: FlagPrState; openedAt: string } | null;
  /** configured=false면 Unleash 원천을 보지 않는다 */
  unleash: { configured: boolean; present: boolean; revision: number | null; archived: boolean };
  deploy: { status: PublicationStatus; policyRevision: number } | null;
  report: { confirmed: number; denominator: number } | null;
  /** 전면 배포 시작 시각(100%), 마지막 평가 시각 — 오래된 Flag 판단 */
  rollout: { percent: number; since: string | null } | null;
  lastEvaluatedAt: string | null;
  /** 승인된 출시 차단 해제(만료 전, 요청 당시 상태와 같을 때만 유효) */
  waiver: { waiverId: string; expiresAt: string; coverageStatus: FlagCoverageStatus } | null;
}

export interface FlagCoverageResult {
  status: FlagCoverageStatus;
  severity: FlagCoverageSeverity;
  findings: FlagCoverageFinding[];
  lanes: Record<FlagLane, FlagLaneState>;
  codeRequired: boolean;
  releaseBlocking: boolean;
  waived: boolean;
}

const older = (at: string | null, now: string, days: number) => !!at && Date.parse(now) - Date.parse(at) > days * DAY;

export function reconcileFlag(i: FlagCoverageInput): FlagCoverageResult {
  const r = i.registry;
  const findings: FlagCoverageFinding[] = [];
  const add = (status: FlagCoverageStatus, severity: FlagCoverageSeverity, message: string, since: string | null = null, dueAt: string | null = null) => findings.push({ status, severity, message, since, dueAt });
  const retiring = !!r?.retirement;
  const codeRequired = !!r && !r.registryRetiredAt && !retiring && FLAG_CODE_REQUIRED_LIFECYCLES.includes(r.lifecycle);
  const prActive = !!i.pullRequest && (i.pullRequest.state === 'OPEN' || i.pullRequest.state === 'PLANNED');

  if (!r) {
    if (i.code.current > 0) add('UNREGISTERED_KEY', 'BLOCKER', `등록되지 않은 키가 코드 ${i.code.current}곳에서 쓰입니다 — Feature에 등록하거나 호출을 지우세요.`, i.code.lastScanAt);
  } else if (retiring) {
    const ret = r.retirement!;
    if (i.code.current > 0) {
      const overdue = !!ret.codeRemovalDueAt && Date.parse(i.now) > Date.parse(ret.codeRemovalDueAt);
      add('REMOVAL_DUE', overdue ? 'BLOCKER' : 'WARNING', overdue ? `코드 삭제 기한이 지났습니다 — 제거 PR을 병합하세요(남은 호출 ${i.code.current}곳).` : `Retirement가 승인돼 코드 ${i.code.current}곳을 지워야 합니다.`, ret.approvedAt, ret.codeRemovalDueAt);
    }
  } else if (codeRequired && i.code.current === 0) {
    if (i.code.lastSeen) add('CALL_DELETED', 'BLOCKER', `등록된 Flag의 호출이 커밋 ${i.code.lastSeen.commit.slice(0, 8)} 이후 사라졌습니다 — Retirement 없이 지울 수 없습니다.`, i.code.lastSeen.at);
    else if (prActive && !older(i.pullRequest!.openedAt, i.now, FLAG_PR_GRACE_DAYS)) add('PR_OPEN', 'INFO', 'FF가 연 Flag PR이 병합을 기다립니다.', i.pullRequest!.openedAt);
    else {
      const blocking = RELEASE_STAGE.includes(r.lifecycle) || (!!r.policy && UNLEASH_EXPECTED.includes(r.policy.status));
      add('NO_CODE', blocking ? 'BLOCKER' : 'WARNING', prActive ? `Flag PR이 ${FLAG_PR_GRACE_DAYS}일 넘게 병합되지 않았습니다.` : '연결된 저장소의 최신 스캔에 이 Flag 호출이 없습니다.', i.pullRequest?.openedAt ?? r.plannedAt);
    }
  }

  // Unleash — 정책이 승인·배포 상태면 같은 개정이 있어야 하고, 퇴역한 Flag는 보관(archive)되어야 한다
  let unleashLane: FlagLaneState = 'NOT_APPLICABLE';
  if (i.unleash.configured) {
    const expected = !!r?.policy && UNLEASH_EXPECTED.includes(r.policy.status) && !r.registryRetiredAt;
    const shouldBeGone = !!r?.registryRetiredAt;
    if (expected) {
      const ok = i.unleash.present && !i.unleash.archived && i.unleash.revision === r!.policy!.revision;
      unleashLane = ok ? 'OK' : 'MISMATCH';
      if (!ok) add('UNLEASH_MISMATCH', 'BLOCKER', !i.unleash.present || i.unleash.archived ? 'Unleash에 이 Flag가 없습니다 — 정책 동기화를 실행하세요.' : `Unleash 개정(${i.unleash.revision ?? '없음'})이 정책 개정 r${r!.policy!.revision}과 다릅니다.`);
    } else if (shouldBeGone || !r) {
      const live = i.unleash.present && !i.unleash.archived;
      unleashLane = live ? 'MISMATCH' : 'NOT_APPLICABLE';
      if (live) add('UNLEASH_MISMATCH', shouldBeGone ? 'WARNING' : 'BLOCKER', shouldBeGone ? '퇴역한 Flag가 Unleash에 남아 있습니다 — 보관하세요.' : '등록 원장에 없는 Flag가 Unleash에 있습니다.');
    } else unleashLane = 'PENDING';
  }

  // 오래된 Flag — 코드가 남은 채 (정책 전면 배포 뒤 90일) 또는 (출시된 Feature인데 90일 평가 없음). Retirement 요청 전만
  if (codeRequired && i.code.current > 0) {
    const full = r!.policy?.status === 'DEPLOYED' && !!i.rollout && i.rollout.percent >= 100 && older(i.rollout.since, i.now, FLAG_STALE_AFTER_DAYS);
    const silent = (r!.lifecycle === 'RELEASED' || r!.lifecycle === 'DEPRECATED') && older(i.lastEvaluatedAt, i.now, FLAG_STALE_AFTER_DAYS);
    if (full) add('STALE', 'WARNING', `전면 배포 뒤 ${FLAG_STALE_AFTER_DAYS}일이 지났습니다 — Retirement를 검토하세요.`, i.rollout!.since);
    else if (silent) add('STALE', 'WARNING', `${FLAG_STALE_AFTER_DAYS}일 동안 평가가 없습니다 — 사용 여부를 확인하세요.`, i.lastEvaluatedAt);
  }

  const status = FLAG_STATUS_PRIORITY.find((s) => findings.some((f) => f.status === s)) ?? 'OK';
  const severity: FlagCoverageSeverity = (['BLOCKER', 'WARNING', 'INFO'] as const).find((s) => findings.some((f) => f.severity === s)) ?? 'OK';
  const blockingFindings = findings.filter((f) => FLAG_RELEASE_BLOCKING.includes(f.status) && (f.severity === 'BLOCKER' || f.status === 'PR_OPEN'));
  const waived = !!i.waiver && Date.parse(i.waiver.expiresAt) > Date.parse(i.now) && blockingFindings.length > 0 && blockingFindings.every((f) => f.status === i.waiver!.coverageStatus);
  return { status, severity, findings, lanes: lanesOf(i, codeRequired, prActive, unleashLane), codeRequired, releaseBlocking: blockingFindings.length > 0 && !waived, waived };
}

function lanesOf(i: FlagCoverageInput, codeRequired: boolean, prActive: boolean, unleash: FlagLaneState): Record<FlagLane, FlagLaneState> {
  const r = i.registry;
  const registry: FlagLaneState = !r ? (i.code.current > 0 ? 'MISSING' : 'NOT_APPLICABLE') : r.policy ? 'OK' : 'PENDING';
  const code: FlagLaneState = i.code.current > 0 ? (r && !r.retirement ? 'OK' : 'MISMATCH') : codeRequired ? (prActive ? 'PENDING' : 'MISSING') : 'NOT_APPLICABLE';
  let deploy: FlagLaneState = 'NOT_APPLICABLE';
  if (i.deploy) {
    if (r?.policy && i.deploy.policyRevision !== r.policy.revision) deploy = 'MISMATCH';
    else if (i.deploy.status === 'DIVERGED' || i.deploy.status === 'TIMEOUT') deploy = 'MISMATCH';
    else if (i.deploy.status === 'SIGNED' || i.deploy.status === 'DISPATCHED') deploy = 'PENDING';
    else deploy = 'OK';
  } else if (r?.policy?.status === 'DEPLOYED') deploy = 'MISSING';
  const report: FlagLaneState = !i.deploy ? 'NOT_APPLICABLE' : i.report && i.report.confirmed > 0 ? 'OK' : 'PENDING';
  return { REGISTRY: registry, CODE: code, UNLEASH: unleash, DEPLOY: deploy, REPORT: report };
}

/** 출시 관문 — Feature Version의 Flag 대사 결과에서 출시를 막는 것과 해제된 것 */
export function flagReleaseGate(rows: readonly { flagKey: string; result: FlagCoverageResult; waiverId?: string | null; waiverExpiresAt?: string | null }[]) {
  const blockers = rows.filter((x) => x.result.releaseBlocking).map((x) => ({ flagKey: x.flagKey, status: x.result.status, message: x.result.findings.find((f) => FLAG_RELEASE_BLOCKING.includes(f.status))?.message ?? x.result.status }));
  const waived = rows.filter((x) => x.result.waived && x.waiverId && x.waiverExpiresAt).map((x) => ({ flagKey: x.flagKey, waiverId: x.waiverId!, expiresAt: x.waiverExpiresAt! }));
  return { pass: blockers.length === 0, blockers, waived };
}

/** 대사 요약 — 상태별 수, 코드 연결 비율의 분자·분모 */
export function summarizeFlagCoverage(results: readonly FlagCoverageResult[]) {
  const byStatus = Object.fromEntries((['OK', 'PR_OPEN', 'NO_CODE', 'CALL_DELETED', 'UNREGISTERED_KEY', 'DYNAMIC_KEY', 'UNLEASH_MISMATCH', 'STALE', 'REMOVAL_DUE'] as const).map((s) => [s, 0])) as Record<FlagCoverageStatus, number>;
  for (const r of results) byStatus[r.status]++;
  const required = results.filter((r) => r.codeRequired);
  return { flags: results.length, codeRequired: required.length, connected: required.filter((r) => r.lanes.CODE === 'OK').length, releaseBlocking: results.filter((r) => r.releaseBlocking).length, byStatus };
}

// ── PR 검사(Check Run) ─────────────────────────────────
export type FlagRegistryState = 'ACTIVE' | 'RETIRING' | 'RETIRED' | null;
export interface FlagPrCheckInput {
  base: readonly { flagKey: string; path: string; line: number }[];
  head: readonly { flagKey: string; path: string; line: number }[];
  baseUnresolved: readonly { path: string; line: number; symbol: string }[];
  headUnresolved: readonly { path: string; line: number; symbol: string }[];
  registryState: (flagKey: string) => FlagRegistryState;
}

/**
 * PR의 기준·머리 커밋 스캔을 비교한다. 실패: 미등록 키, 퇴역 키 재사용, Retirement 없이 등록 Flag의 마지막 호출 삭제, 새 동적 키.
 * 동적 키는 줄이 움직이므로 파일·호출식별 개수로 비교한다(기준보다 늘어난 만큼만 새 것으로 본다).
 */
export function evaluateFlagPrCheck(i: FlagPrCheckInput): FlagPrCheckResult {
  const findings: FlagPrCheckFinding[] = [];
  const headKeys = new Map<string, { path: string; line: number }>();
  for (const u of i.head) if (!headKeys.has(u.flagKey)) headKeys.set(u.flagKey, u);
  for (const [key, at] of [...headKeys].sort(([a], [b]) => a.localeCompare(b))) {
    const st = i.registryState(key);
    if (st === null) findings.push({ code: 'UNREGISTERED_KEY', level: 'FAILURE', flagKey: key, path: at.path, line: at.line, message: `${key}는 FF에 등록되지 않은 키입니다 — Feature Version에 등록한 뒤 쓰세요.` });
    else if (st === 'RETIRED') findings.push({ code: 'RETIRED_KEY_USED', level: 'FAILURE', flagKey: key, path: at.path, line: at.line, message: `${key}는 퇴역한 키입니다 — 같은 ID를 다시 쓸 수 없습니다.` });
  }
  const removed = new Map<string, { path: string; line: number }>();
  for (const u of i.base) if (!headKeys.has(u.flagKey) && !removed.has(u.flagKey)) removed.set(u.flagKey, u);
  for (const [key, at] of [...removed].sort(([a], [b]) => a.localeCompare(b))) {
    const st = i.registryState(key);
    if (st === 'ACTIVE') findings.push({ code: 'REGISTERED_CALL_REMOVED', level: 'FAILURE', flagKey: key, path: at.path, line: null, message: `등록된 Flag ${key}의 마지막 호출을 지웁니다 — Retirement 승인 뒤 FF 제거 PR로 지우세요.` });
    else if (st === 'RETIRING') findings.push({ code: 'REMOVAL_ALLOWED', level: 'NOTICE', flagKey: key, path: at.path, line: null, message: `Retirement가 승인된 ${key}의 호출 삭제입니다.` });
  }
  const sig = (c: { path: string; symbol: string }) => `${c.path}\u0000${c.symbol}`;
  const baseCount = new Map<string, number>();
  for (const c of i.baseUnresolved) baseCount.set(sig(c), (baseCount.get(sig(c)) ?? 0) + 1);
  for (const c of i.headUnresolved) {
    const left = baseCount.get(sig(c)) ?? 0;
    if (left > 0) {
      baseCount.set(sig(c), left - 1);
      findings.push({ code: 'EXISTING_DYNAMIC_KEY', level: 'WARNING', flagKey: null, path: c.path, line: c.line, message: '이미 있던 동적 키 호출입니다 — 문자열 상수로 바꾸세요.' });
    } else findings.push({ code: 'DYNAMIC_KEY', level: 'FAILURE', flagKey: null, path: c.path, line: c.line, message: 'Flag 키를 정적으로 알 수 없는 호출입니다 — 등록된 키의 문자열 상수를 쓰세요.' });
  }
  return { conclusion: findings.some((f) => f.level === 'FAILURE') ? 'failure' : 'success', findings };
}

/** FF 스캐너 서명 페이로드 — 도메인 분리 접두 + JCS(manifest). Ed25519로 서명하고 base64url로 싣는다 */
export const FLAG_SCAN_SIGNING_PREFIX = 'FF-FLAG-SCAN/1\n';
export const flagScanSigningPayload = (manifest: FlagSourceManifestV2) => FLAG_SCAN_SIGNING_PREFIX + jcs(manifest);
