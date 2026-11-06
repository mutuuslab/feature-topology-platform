// 차량 기능 앱 생성 계획(20-97 §5) — 현재 등록 데이터(모델)에서 Flag 계획·의도적 이상 상태·커밋/PR 이력·평가 지표·대사 요약을 정한다.
// 순수 함수(입출력 없음). 같은 모델이면 같은 결과 — 시각은 등록 데이터의 게이트 판정 시각이나 Feature 번호로만 정한다.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF } from '../lib.ts';

const require = createRequire(import.meta.url);
export const C = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../../contracts/src/index');

export type CP = 'Flag' | 'Parameter' | 'Signal' | 'DTC';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
/** 대사 요약·평가 구간의 기준 시각(백엔드는 windowEnd를 시드 시각으로 옮긴다) */
export const NOW = '2026-11-06T00:00:00.000Z';
export const REPO_START = Date.parse('2026-01-02T09:00:00+09:00');
const FALLBACK_APPROVAL = Date.parse('2026-01-05T09:00:00+09:00');
const RETIRE_LATEST = Date.parse('2026-10-01T09:00:00+09:00');
/** 기존 6개 시연 Flag의 Feature — 의도적 이상 상태를 넣지 않는다(20-96 화면·e2e 근거 유지) */
export const DEMO_FEATURES = new Set(['FEAT-00022', 'FEAT-00024', 'FEAT-00027']);
/** §5.5 Unleash 불일치 — 시연 동기화 기록을 r2로 둔다(정책은 데모 활동으로 r3까지 간다) */
export const UNLEASH_MISMATCH = { flagKey: 'ivi_00027_detail', revision: 2 } as const;
const AT = (s: string) => Date.parse(s);
export const ANOMALY_AT = {
  callDeleted: [AT('2026-10-20T10:00:00+09:00'), AT('2026-10-27T10:00:00+09:00')],
  unregistered: AT('2026-10-29T10:00:00+09:00'),
  dynamic: AT('2026-10-30T10:00:00+09:00'),
  removalApproved: ['2026-04-01T09:00:00+09:00', '2026-10-15T09:00:00+09:00'],
};

export interface RepoDef { key: 'main' | 'fleet'; repoId: string; name: string; displayName: string; repository: string; showcase: boolean }
export const REPOS: RepoDef[] = [
  { key: 'main', repoId: 'FREPO-001', name: 'vehicle-feature-apps', displayName: '차량 기능 앱', repository: 'https://github.com/mutuuslab/vehicle-feature-apps', showcase: false },
  { key: 'fleet', repoId: 'FREPO-002', name: 'vehicle-feature-apps-fleet', displayName: '차량 기능 앱 — 전시 차량군', repository: 'https://github.com/mutuuslab/vehicle-feature-apps-fleet', showcase: true },
];

// ── 모델(백엔드 GET에서 읽은 것) ──────────────────────────
export interface VersionM {
  featureId: string;
  version: string;
  isLatest: boolean;
  name: string;
  description: string;
  lifecycle: string;
  ownerId: string | null;
  tags: string[];
  asil: string | null;
  controlPoints: CP[];
  refId: string | null;
  domainAbbr: string | null;
  /** G1~G3 PASS 판정 시각 중 가장 늦은 값(기준 데이터 기록만) */
  approvedAt: string | null;
  /** 모든 PASS 판정 중 가장 늦은 값(기준 데이터 기록만) — 퇴역 시각 계산 */
  lastGateAt: string | null;
  showcase: boolean;
}
export interface PolicyM {
  policyId: string;
  flagKey: string;
  featureId: string;
  featureVersion: string;
  controlPoint: CP;
  status: string;
  revision: number;
  basisPoints: number | null;
  /** 기준 데이터의 승인 시각(실행 중 만든 정책은 null) */
  approvedAt: string | null;
  /** 실행 중(전시·데모 활동) 만든 정책 — 같은 실행에서 승인된 Version의 계획보다 뒤에 생긴다 */
  runtime: boolean;
}
export interface Model {
  versions: VersionM[];
  policies: PolicyM[];
  /** Retirement가 진행 중인 Flag(데모 활동) */
  retiring: string[];
}

// ── 계획 ─────────────────────────────────────────────
export type PlanItem = import('../../contracts/src/index').FlagPlanEntry & { plannedAt: string };
export interface VersionP { v: VersionM; approvedAt: number; mergeAt: number; retiredAt: number | null }
export interface FeatureP {
  featureId: string;
  num: number;
  repo: 'main' | 'fleet';
  pkg: string;
  versions: VersionP[];
  latest: VersionM;
  plan: PlanItem[];
  policies: PolicyM[];
  lastMergeAt: number;
}
export const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const semverCmp = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
export const numOf = (featureId: string) => Number(featureId.slice(5));
/** 구현 커밋 — 승인 + (1~3일, 번호로) + 1시간, 병합은 그 2시간 뒤 */
export const implementAt = (approvedAt: number, num: number) => approvedAt + (1 + (num % 3)) * DAY + HOUR;
export const mergeAt = (approvedAt: number, num: number) => implementAt(approvedAt, num) + 2 * HOUR;
const CODE_LIFECYCLES = new Set(['APPROVED', 'DEVELOPING', 'VERIFIED', 'RELEASED', 'DEPRECATED']);

export function buildFeatures(m: Model): FeatureP[] {
  const byFeature = new Map<string, VersionM[]>();
  for (const v of m.versions) byFeature.set(v.featureId, [...(byFeature.get(v.featureId) ?? []), v]);
  const out: FeatureP[] = [];
  for (const [featureId, all] of [...byFeature].sort(([a], [b]) => a.localeCompare(b))) {
    const num = numOf(featureId);
    const approved = all.filter((v) => v.lifecycle !== 'PROPOSED').map((v) => {
      const at = v.approvedAt ? Date.parse(v.approvedAt) : FALLBACK_APPROVAL + (num % 60) * DAY;
      return { v, approvedAt: Math.max(at, REPO_START + DAY), mergeAt: 0, retiredAt: null as number | null };
    }).sort((a, b) => semverCmp(a.v.version, b.v.version));
    if (!approved.length) continue;
    // 같은 Feature의 새 Version은 앞 Version 승인 뒤 — 판정 기록이 없는 새 Version(데모 활동)도 앞 Version보다 하루 이상 늦게
    for (let i = 1; i < approved.length; i++) approved[i].approvedAt = Math.max(approved[i].approvedAt, approved[i - 1].approvedAt + DAY);
    for (const p of approved) {
      p.mergeAt = mergeAt(p.approvedAt, num);
      if (p.v.lifecycle === 'RETIRED') {
        const base = p.v.lastGateAt ? Date.parse(p.v.lastGateAt) + 30 * DAY : p.approvedAt + 120 * DAY;
        p.retiredAt = Math.max(Math.min(base, RETIRE_LATEST), p.mergeAt + 5 * DAY);
      }
    }
    const latest = all.find((v) => v.isLatest) ?? approved[approved.length - 1].v;
    const first = approved[0].v;
    const pkg = C.flagPackageOf({ domainAbbr: first.domainAbbr, ownerId: first.ownerId, tags: first.tags });
    // 정책 — 같은 flagKey의 개정은 첫 정책(가장 낮은 ID) 하나로 본다
    const firstOf = new Map<string, PolicyM>();
    for (const p of m.policies.filter((x) => x.featureId === featureId).sort((a, b) => a.policyId.localeCompare(b.policyId))) if (!firstOf.has(p.flagKey)) firstOf.set(p.flagKey, p);
    const pol = [...firstOf.values()];
    const plan: PlanItem[] = [];
    for (const p of approved) {
      // 실행 중 승인된 Version(판정 기록 없음)은 승인 때 FF가 계획을 등록했다 — 그 뒤에 만든 실행 중 정책은 그 계획에 없다(백엔드 승인 훅과 같은 결과)
      const known = p.v.approvedAt === null ? pol.filter((x) => !x.runtime) : pol;
      for (const e of C.planFeatureFlags({ featureId, version: p.v.version, controlPoints: p.v.controlPoints }, pkg, known.map((x) => ({ flagKey: x.flagKey, controlPoint: x.controlPoint })))) {
        if (!plan.some((x) => x.flagKey === e.flagKey)) plan.push({ ...e, plannedAt: new Date(p.approvedAt).toISOString() });
      }
    }
    // 계획 뒤에 생긴 정책 키 — 같은 Feature의 Flag로 등록하고 코드도 둔다(정책 Version의 다음 순번)
    for (const x of pol) {
      if (plan.some((e) => e.flagKey === x.flagKey)) continue;
      const p = approved.find((a) => a.v.version === x.featureVersion) ?? approved[approved.length - 1];
      const ordinal = plan.filter((e) => e.controlPoint === x.controlPoint).length + 1;
      plan.push({ flagKey: x.flagKey, featureId, version: p.v.version, controlPoint: x.controlPoint, ordinal, package: pkg, source: 'POLICY', plannedAt: new Date(p.approvedAt).toISOString() });
    }
    out.push({ featureId, num, repo: approved[0].v.showcase ? 'fleet' : 'main', pkg, versions: approved, latest, plan, policies: pol, lastMergeAt: Math.max(...approved.map((p) => p.mergeAt)) });
  }
  return out;
}

/** Version에서 계획된 Flag(누적) — 같은 Feature의 새 Version은 앞 Version 키를 다시 쓰고 새 제어점 키를 더한다 */
export const planUpTo = (f: FeatureP, version: string) => {
  const idx = f.versions.findIndex((p) => p.v.version === version);
  const versions = new Set(f.versions.slice(0, idx + 1).map((p) => p.v.version));
  return f.plan.filter((e) => versions.has(e.version));
};

// ── 의도적 이상 상태(§5.5) ──────────────────────────────
export interface Anomalies {
  /** Flag PR 검토 중 — `${featureId}@${version}` */
  prOpen: string[];
  noCode: string[];
  callDeleted: { flagKey: string; featureId: string; at: number }[];
  unregistered: { featureId: string; flagKey: string }[];
  dynamic: string;
  stale: string[];
  removalDue: { flagKey: string; featureId: string; featureVersion: string; approvedAt: string }[];
  signatureSpike: string;
}
const bySha = <T>(xs: T[], key: (x: T) => string) => [...xs].sort((a, b) => sha(key(a)).localeCompare(sha(key(b))));
const allIn = (f: FeatureP, lc: string) => f.versions.every((p) => p.v.lifecycle === lc) && f.latest.lifecycle === lc;

export function selectAnomalies(features: FeatureP[]): Anomalies {
  const main = features.filter((f) => f.repo === 'main' && !DEMO_FEATURES.has(f.featureId) && f.plan.length > 0);
  const used = new Set<string>();
  const take = (f: FeatureP) => used.add(f.featureId);
  const free = (f: FeatureP) => !used.has(f.featureId);
  /** 후보 Flag를 sha256(flagKey) 순으로 — Feature마다 하나 */
  const pickFlags = (cands: FeatureP[], n: number, ok: (e: PlanItem, f: FeatureP) => boolean) => {
    const flags = bySha(cands.filter(free).flatMap((f) => f.plan.filter((e) => ok(e, f)).map((e) => ({ e, f }))), (x) => x.e.flagKey);
    const out: { e: PlanItem; f: FeatureP }[] = [];
    for (const x of flags) {
      if (out.length >= n) break;
      if (!free(x.f)) continue;
      take(x.f);
      out.push(x);
    }
    if (out.length < n) throw new Error(`의도적 이상 상태 후보가 모자랍니다(${n}개 중 ${out.length}개).`);
    return out;
  };

  const prOpen = main.filter((f) => f.versions.length === 1 && allIn(f, 'DEVELOPING'))
    .sort((a, b) => b.versions[0].approvedAt - a.versions[0].approvedAt || a.featureId.localeCompare(b.featureId)).slice(0, 2);
  if (prOpen.length < 2) throw new Error('Flag PR 검토 중 후보(DEVELOPING Version)가 모자랍니다.');
  prOpen.forEach(take);
  const noCode = [
    ...pickFlags(main.filter((f) => allIn(f, 'DEVELOPING') && f.plan.length >= 2), 2, (e) => e.source === 'PLANNED'),
    ...pickFlags(main.filter((f) => allIn(f, 'VERIFIED') && f.plan.length >= 2), 1, () => true),
  ].map((x) => x.e.flagKey);
  const callDeleted = pickFlags(main.filter((f) => allIn(f, 'RELEASED') && f.plan.length >= 2 && f.lastMergeAt < ANOMALY_AT.callDeleted[0]), 2, () => true)
    .map((x, i) => ({ flagKey: x.e.flagKey, featureId: x.f.featureId, at: ANOMALY_AT.callDeleted[i] }));
  const expKey = (f: FeatureP) => `${f.pkg}_${f.featureId.slice(5)}_experiment`;
  const unregistered = bySha(main.filter((f) => free(f) && CODE_LIFECYCLES.has(f.latest.lifecycle) && f.lastMergeAt < ANOMALY_AT.unregistered), expKey).slice(0, 2);
  if (unregistered.length < 2) throw new Error('미등록 키 후보가 모자랍니다.');
  unregistered.forEach(take);
  const dyn = bySha(main.filter((f) => free(f) && f.pkg === 'ivi' && CODE_LIFECYCLES.has(f.latest.lifecycle) && f.lastMergeAt < ANOMALY_AT.dynamic), (f) => f.plan[0].flagKey)[0];
  if (!dyn) throw new Error('동적 키 후보(ivi 패키지 Feature)가 없습니다.');
  take(dyn);
  const deployed = (f: FeatureP, key: string) => f.policies.some((p) => p.flagKey === key && (p.status === 'DEPLOYED' || p.status === 'APPROVED'));
  const staleCands = bySha(main.filter((f) => free(f) && allIn(f, 'RELEASED')).flatMap((f) => f.plan.filter((e) => !deployed(f, e.flagKey)).map((e) => ({ e, f }))), (x) => x.e.flagKey).slice(0, 5);
  if (staleCands.length < 5) throw new Error('오래된 Flag 후보가 모자랍니다.');
  staleCands.forEach((x) => take(x.f));
  const removal = pickFlags(main.filter((f) => allIn(f, 'DEPRECATED')), 2, () => true);
  const anomalies: Omit<Anomalies, 'signatureSpike'> = {
    prOpen: prOpen.map((f) => `${f.featureId}@${f.versions[0].v.version}`),
    noCode,
    callDeleted,
    unregistered: unregistered.map((f) => ({ featureId: f.featureId, flagKey: expKey(f) })),
    dynamic: dyn.featureId,
    stale: staleCands.map((x) => x.e.flagKey),
    removalDue: removal.map((x, i) => ({ flagKey: x.e.flagKey, featureId: x.f.featureId, featureVersion: x.f.latest.version, approvedAt: new Date(Date.parse(ANOMALY_AT.removalApproved[i])).toISOString() })),
  };
  const targets = evaluationTargets(features, { ...anomalies, signatureSpike: '' }).filter((t) => !DEMO_FEATURES.has(t.featureId) && !used.has(t.featureId));
  const spike = bySha(targets, (t) => t.flagKey)[0];
  if (!spike) throw new Error('평가 이상 시연 Flag 후보가 없습니다.');
  return { ...anomalies, signatureSpike: spike.flagKey };
}

// ── 커밋·PR 이력 계획(§5.4) ─────────────────────────────
export type Action =
  | { type: 'scaffold'; featureId: string; version: string }
  | { type: 'implement'; featureId: string; version: string; omit: string[] }
  | { type: 'removeCalls'; featureId: string; flagKey: string }
  | { type: 'experiment'; featureId: string; flagKey: string }
  | { type: 'dynamic'; featureId: string }
  | { type: 'retire'; featureId: string }
  /** 정책 원장과 키 맞춤 — 같은 제어점의 생성 규칙 키를 정책 키로 바꾸고(rename), 대응 제어점이 없는 정책 키를 더한다(added) */
  | { type: 'align'; featureId: string; rename: [string, string][]; added: string[] };
export interface Person { name: string; email: string }
export const BOT: Person = { name: 'FF Flag Bot', email: 'ff-flags@mutuuslab.example' };
export const GITHUB: Person = { name: 'GitHub', email: 'noreply@github.com' };
export const dev = (pkg: string): Person => ({ name: `${pkg} 구현 담당`, email: `dev-${pkg}@mutuuslab.example` });
export interface CommitP { at: number; author: Person; message: string; actions: Action[] }
export interface PrP {
  kind: 'SCAFFOLD' | 'DEV';
  branch: string;
  title: string;
  featureId: string;
  version: string;
  flagKeys: string[];
  commits: CommitP[];
  /** 병합 시각 — null이면 열림(OPEN) 또는 닫힘(CLOSED) */
  mergeAt: number | null;
  state: 'MERGED' | 'OPEN' | 'CLOSED';
  merger: Person;
  /** 머리 커밋을 PR 계기로 스캔하고 검사 결과를 남긴다 */
  scanHead: boolean;
  /** 정책 키 맞춤 PR — 이미 올린 이력 뒤에 덧붙이고, 현재 계획으로 그린다 */
  align?: boolean;
}
export type Event = { at: number; seq: number } & ({ kind: 'pr-commit'; pr: PrP; index: number } | { kind: 'merge'; pr: PrP } | { kind: 'main-commit'; commit: CommitP });

export function buildEvents(features: FeatureP[], a: Anomalies, repo: 'main' | 'fleet'): Event[] {
  const fs = features.filter((f) => f.repo === repo);
  const byId = new Map(fs.map((f) => [f.featureId, f]));
  const events: Event[] = [];
  let seq = 0;
  const addPr = (pr: PrP) => {
    pr.commits.forEach((c, index) => events.push({ at: c.at, seq: seq++, kind: 'pr-commit', pr, index }));
    if (pr.mergeAt !== null) events.push({ at: pr.mergeAt, seq: seq++, kind: 'merge', pr });
  };
  const versions = fs.flatMap((f) => f.versions.map((p) => ({ f, p }))).sort((x, y) => x.p.approvedAt - y.p.approvedAt || x.f.featureId.localeCompare(y.f.featureId) || semverCmp(x.p.v.version, y.p.v.version));
  const noCode = new Set(a.noCode);
  const prOpen = new Set(a.prOpen);
  for (const { f, p } of versions) {
    const keys = planUpTo(f, p.v.version);
    if (!keys.length) continue;
    const info = { featureId: f.featureId, version: p.v.version, name: p.v.name };
    const title = C.flagPrText('SCAFFOLD', info, keys.map((k) => k.flagKey), 'https://ff.mutuuslab.example').title;
    const scaffold: CommitP = {
      at: p.approvedAt + 5 * MIN, author: BOT,
      message: `${title}\n\n「${p.v.name}」 승인으로 등록된 Flag의 상수·호출 뼈대입니다. 기본값은 OFF입니다.\n\n${keys.map((k) => `- ${k.flagKey} (${k.controlPoint})`).join('\n')}\n`,
      actions: [{ type: 'scaffold', featureId: f.featureId, version: p.v.version }],
    };
    const key = `${f.featureId}@${p.v.version}`;
    const omit = keys.filter((k) => noCode.has(k.flagKey)).map((k) => k.flagKey);
    const implement: CommitP = {
      at: implementAt(p.approvedAt, f.num), author: dev(f.pkg),
      message: `feat(${f.pkg}): ${f.featureId} ${p.v.version} 「${p.v.name}」 기능 분기 구현\n\n제어점별 분기와 시험(기본 OFF·켜짐·Guard·오류 시 OFF)을 더한다.\n`,
      actions: [{ type: 'implement', featureId: f.featureId, version: p.v.version, omit }],
    };
    const base = { featureId: f.featureId, version: p.v.version, flagKeys: keys.map((k) => k.flagKey), merger: dev(f.pkg) };
    if (prOpen.has(key)) {
      addPr({ ...base, kind: 'SCAFFOLD', branch: C.flagScaffoldBranch(f.featureId, p.v.version), title, commits: [scaffold], mergeAt: null, state: 'OPEN', scanHead: true });
    } else if (omit.length) {
      // 뼈대 PR을 닫고 구현 담당이 자기 PR로 구현했다 — 계획 Flag 하나를 빠뜨렸다(코드 없음)
      addPr({ ...base, kind: 'SCAFFOLD', branch: C.flagScaffoldBranch(f.featureId, p.v.version), title, commits: [scaffold], mergeAt: null, state: 'CLOSED', scanHead: true });
      const t = `feat(${f.pkg}): ${f.featureId} ${p.v.version} 기능 분기 직접 구현`;
      addPr({ ...base, kind: 'DEV', branch: `feat/${f.featureId.toLowerCase()}-${p.v.version}`, title: t, commits: [{ ...implement, message: `${t}\n\nFF 뼈대 PR 대신 같은 구조로 직접 구현한다.\n` }], mergeAt: implement.at + 2 * HOUR, state: 'MERGED', scanHead: false });
    } else {
      addPr({ ...base, kind: 'SCAFFOLD', branch: C.flagScaffoldBranch(f.featureId, p.v.version), title, commits: [scaffold, implement], mergeAt: mergeAt(p.approvedAt, f.num), state: 'MERGED', scanHead: false });
    }
    if (p.retiredAt !== null) events.push({ at: p.retiredAt, seq: seq++, kind: 'main-commit', commit: { at: p.retiredAt, author: dev(f.pkg), message: `chore: 퇴역 Flag 제거 — ${f.featureId} 「${p.v.name}」\n\nFeature가 퇴역해 Flag 호출과 기능 분기를 지운다.\n`, actions: [{ type: 'retire', featureId: f.featureId }] } });
  }
  if (repo === 'main') {
    for (const c of a.callDeleted) {
      const f = byId.get(c.featureId)!;
      const t = `refactor(${f.pkg}): ${f.featureId} ${c.flagKey} 분기 정리`;
      addPr({ kind: 'DEV', branch: `refactor/${c.flagKey}-cleanup`, title: t, featureId: f.featureId, version: f.latest.version, flagKeys: [c.flagKey], merger: dev(f.pkg), mergeAt: c.at + HOUR, state: 'MERGED', scanHead: true,
        commits: [{ at: c.at, author: dev(f.pkg), message: `${t}\n\n새 경로를 걷어내고 기존 경로로 고정한다.\n`, actions: [{ type: 'removeCalls', featureId: f.featureId, flagKey: c.flagKey }] }] });
    }
    const first = byId.get(a.unregistered[0].featureId)!;
    const tu = `feat(${first.pkg}): 비교 실험 스위치 추가`;
    addPr({ kind: 'DEV', branch: 'feat/experiment-switches', title: tu, featureId: first.featureId, version: first.latest.version, flagKeys: a.unregistered.map((u) => u.flagKey), merger: dev(first.pkg), mergeAt: ANOMALY_AT.unregistered + HOUR, state: 'MERGED', scanHead: true,
      commits: [{ at: ANOMALY_AT.unregistered, author: dev(first.pkg), message: `${tu}\n\n${a.unregistered.map((u) => `- ${u.featureId}: ${u.flagKey}`).join('\n')}\n`, actions: a.unregistered.map((u) => ({ type: 'experiment' as const, featureId: u.featureId, flagKey: u.flagKey })) }] });
    const d = byId.get(a.dynamic)!;
    const td = `feat(ivi): ${d.featureId} 지역별 안내 배너 실험`;
    addPr({ kind: 'DEV', branch: 'feat/ivi-regional-banner', title: td, featureId: d.featureId, version: d.latest.version, flagKeys: [d.plan[0].flagKey], merger: dev('ivi'), mergeAt: ANOMALY_AT.dynamic + HOUR, state: 'MERGED', scanHead: true,
      commits: [{ at: ANOMALY_AT.dynamic, author: dev('ivi'), message: `${td}\n\n지역 코드로 키를 조합해 배너·간략 표시를 켠다.\n`, actions: [{ type: 'dynamic', featureId: d.featureId }] }] });
  }
  return events.sort((x, y) => x.at - y.at || x.seq - y.seq);
}

// ── 정책 키 맞춤(GitHub에 올린 이력 뒤에 덧붙임) ──────────
/** 맞춤 PR 시작 — 고정 이력의 마지막 커밋 뒤, 시연 기준 시각(NOW) 전 */
export const ALIGN_START = Date.parse('2026-11-05T10:00:00+09:00');
export interface Alignment { featureId: string; repo: 'main' | 'fleet'; pkg: string; version: string; rename: [string, string][]; added: string[] }

/**
 * 고정 이력(이미 GitHub에 올린 저장소를 만든 등록 데이터)의 계획과 현재 계획을 Feature마다 비교한다.
 * 계획 규칙은 정책 키를 먼저 쓰므로, 이력 뒤에 생긴 정책은 같은 제어점(유형·순번)의 생성 규칙 키를 대신하거나(rename) 뒤에 붙는다(added).
 * 이력의 키가 대응 없이 사라지거나, 열린 Flag PR·이력에 없는 Feature는 덧붙이기로 맞출 수 없다 — 이력 고정 모델을 다시 정해야 한다(오류).
 */
export function alignmentOf(history: FeatureP[], current: FeatureP[], a: Pick<Anomalies, 'prOpen'>): Alignment[] {
  const hist = new Map(history.map((f) => [f.featureId, f]));
  const out: Alignment[] = [];
  for (const f of current) {
    const h = hist.get(f.featureId);
    const hKeys = new Set(h?.plan.map((e) => e.flagKey) ?? []);
    const cKeys = new Set(f.plan.map((e) => e.flagKey));
    if (h && hKeys.size === cKeys.size && [...hKeys].every((k) => cKeys.has(k))) continue;
    if (!h) throw new Error(`${f.featureId}: 고정 이력에 없는 Feature입니다 — 덧붙이기로 맞출 수 없습니다(이력 고정 모델 갱신 필요).`);
    if (f.latest.lifecycle === 'RETIRED') continue;
    if (a.prOpen.some((k) => k.startsWith(f.featureId + '@'))) throw new Error(`${f.featureId}: Flag PR이 열린 Feature의 키가 바뀌었습니다 — 덧붙이기로 맞출 수 없습니다.`);
    const dropped = h.plan.filter((e) => !cKeys.has(e.flagKey));
    const fresh = f.plan.filter((e) => !hKeys.has(e.flagKey));
    const rename: [string, string][] = [];
    for (const d of dropped) {
      const i = fresh.findIndex((n) => n.controlPoint === d.controlPoint && n.ordinal === d.ordinal);
      if (i < 0) throw new Error(`${f.featureId}: 이력의 ${d.flagKey}(${d.controlPoint})를 대신할 정책 키가 없습니다 — 덧붙이기로 맞출 수 없습니다.`);
      rename.push([d.flagKey, fresh[i].flagKey]);
      fresh.splice(i, 1);
    }
    out.push({ featureId: f.featureId, repo: f.repo, pkg: f.pkg, version: f.versions[f.versions.length - 1].v.version, rename, added: fresh.map((e) => e.flagKey) });
  }
  return out.sort((x, y) => x.featureId.localeCompare(y.featureId));
}

/**
 * 이상 상태의 키를 맞춤 뒤 키로. 호출을 지운 키(삭제된 호출)가 정책 키로 바뀌면 새 키는 코드에 한 번도 없었으므로 '코드 없음'이 된다
 * (백엔드 대사도 키별 이전 스캔만 본다).
 */
export function renameAnomalies(a: Anomalies, rename: Map<string, string>): Anomalies {
  const r = (k: string) => rename.get(k) ?? k;
  const moved = a.callDeleted.filter((c) => rename.has(c.flagKey));
  return {
    ...a,
    noCode: [...a.noCode.map(r), ...moved.map((c) => r(c.flagKey))],
    callDeleted: a.callDeleted.filter((c) => !rename.has(c.flagKey)),
    stale: a.stale.map(r),
    removalDue: a.removalDue.map((x) => ({ ...x, flagKey: r(x.flagKey) })),
    signatureSpike: r(a.signatureSpike),
  };
}

/** 맞춤 PR — Feature마다 FF Flag Bot 커밋 하나, 10분 뒤 병합. 고정 이력의 마지막 이벤트 뒤에 온다 */
export function alignEvents(al: Alignment[], history: Event[]): Event[] {
  if (!al.length) return [];
  const last = Math.max(...history.map((e) => e.at));
  const start = Math.max(ALIGN_START, last + HOUR);
  let seq = Math.max(0, ...history.map((e) => e.seq)) + 1;
  const out: Event[] = [];
  al.forEach((x, i) => {
    const at = start + i * 30 * MIN;
    if (at + 10 * MIN >= Date.parse(NOW)) throw new Error(`정책 키 맞춤 PR이 시연 기준 시각(${NOW})을 넘습니다 — ${al.length}건`);
    const keys = [...x.rename.map(([, to]) => to), ...x.added];
    const title = `chore(${x.pkg}): ${x.featureId} Flag 키를 정책 원장과 맞춤`;
    const body = [...x.rename.map(([from, to]) => `- ${from} → ${to}`), ...x.added.map((k) => `- ${k} 추가`)].join('\n');
    const pr: PrP = {
      kind: 'SCAFFOLD', align: true, branch: `ff/flags/align-${x.featureId.toLowerCase()}`, title, featureId: x.featureId, version: x.version, flagKeys: keys, merger: dev(x.pkg),
      commits: [{ at, author: BOT, message: `${title}\n\n정책 원장에 등록된 키로 Flag 상수·호출을 맞춘다. 기능 분기와 기본값(OFF)은 그대로다.\n\n${body}\n`, actions: [{ type: 'align', featureId: x.featureId, rename: x.rename, added: x.added }] }],
      mergeAt: at + 10 * MIN, state: 'MERGED', scanHead: false,
    };
    out.push({ at, seq: seq++, kind: 'pr-commit', pr, index: 0 }, { at: at + 10 * MIN, seq: seq++, kind: 'merge', pr });
  });
  return out;
}

// ── 평가 지표(§5.6) ────────────────────────────────────
export const EVAL_WINDOW_END = NOW;
const WINDOW_HOURS = 7 * 24;
export interface EvalTarget { flagKey: string; featureId: string; basisPoints: number }
/** 평가 대상 — 차량에 실린 Flag: 승인·배포된 정책이 있거나 RELEASED·DEPRECATED Feature(초안·반려 정책은 차량에 가지 않아 뺀다) */
export function evaluationTargets(features: FeatureP[], _a?: Anomalies): EvalTarget[] {
  const out: EvalTarget[] = [];
  for (const f of features) for (const e of f.plan) {
    const p = f.policies.find((x) => x.flagKey === e.flagKey && (x.status === 'DEPLOYED' || x.status === 'APPROVED'));
    if (!p && f.latest.lifecycle !== 'RELEASED' && f.latest.lifecycle !== 'DEPRECATED') continue;
    out.push({ flagKey: e.flagKey, featureId: f.featureId, basisPoints: p?.basisPoints ?? 0 });
  }
  return out.sort((x, y) => x.flagKey.localeCompare(y.flagKey));
}
export interface EvalBucket { bucketStart: string; source: 'UNLEASH_EDGE' | 'VEHICLE_REPORT'; evaluations: number; enabled: number; disabled: number; errors: number; vehicles: number; fallbacks: { reason: string; count: number }[]; variants: { name: string; count: number }[] }
export interface EvalFlag { flagKey: string; lastEvaluatedAt: string | null; buckets: EvalBucket[] }
const n32 = (s: string) => parseInt(sha(s).slice(0, 8), 16);

export function buildEvaluations(features: FeatureP[], a: Anomalies): { windowEnd: string; flags: EvalFlag[] } {
  const end = Date.parse(EVAL_WINDOW_END);
  const start = end - WINDOW_HOURS * HOUR;
  const stale = new Set(a.stale);
  const flags: EvalFlag[] = [];
  for (const t of evaluationTargets(features, a)) {
    if (stale.has(t.flagKey)) {
      // 오래된 Flag — 7일 구간 평가 0, 마지막 평가는 2026-07 이전
      flags.push({ flagKey: t.flagKey, lastEvaluatedAt: new Date(Date.parse('2026-05-04T09:00:00+09:00') + (n32(`last:${t.flagKey}`) % 50) * DAY).toISOString(), buckets: [] });
      continue;
    }
    const vehicles = 24 + (n32(`veh:${t.flagKey}`) % 97);
    const phase = n32(`phase:${t.flagKey}`) % 24;
    const rate = t.basisPoints / 10_000;
    const buckets: EvalBucket[] = [];
    for (let h = 0; h < WINDOW_HOURS; h++) {
      const at = start + h * HOUR;
      const day = new Date(at).getUTCDay();
      const weekly = day === 0 || day === 6 ? 0.8 : 1;
      const curve = (0.7 + 0.3 * Math.sin((2 * Math.PI * (h + phase)) / 24)) * weekly;
      const edge = Math.round(vehicles * 4 * curve);
      const spike = t.flagKey === a.signatureSpike && new Date(at).toISOString().startsWith('2026-11-04');
      for (const source of ['UNLEASH_EDGE', 'VEHICLE_REPORT'] as const) {
        const evaluations = source === 'UNLEASH_EDGE' ? edge : Math.round(edge * 0.92);
        const fallbacks = source === 'VEHICLE_REPORT'
          ? [
            { reason: 'TTL_EXPIRED', count: Math.round(evaluations * 0.004) },
            { reason: 'DEFAULT_NO_SNAPSHOT', count: Math.round(evaluations * 0.002) },
            { reason: 'SIGNATURE_INVALID', count: spike ? Math.round(evaluations * 0.12) : 0 },
          ].filter((x) => x.count > 0)
          : [];
        const fb = fallbacks.reduce((s, x) => s + x.count, 0);
        const errors = Math.round(evaluations * 0.0005);
        const enabled = Math.round(Math.max(0, evaluations - fb - errors) * rate);
        buckets.push({ bucketStart: new Date(at).toISOString(), source, evaluations, enabled, disabled: evaluations - enabled - errors, errors, vehicles: source === 'UNLEASH_EDGE' ? vehicles : Math.round(vehicles * 0.92), fallbacks, variants: [] });
      }
    }
    flags.push({ flagKey: t.flagKey, lastEvaluatedAt: new Date(end - MIN).toISOString(), buckets });
  }
  return { windowEnd: new Date(end).toISOString(), flags };
}

// ── 대사 요약(§3·§5.5) ─────────────────────────────────
export interface ScanFacts {
  repo: 'main' | 'fleet';
  ref: string;
  commit: string;
  at: string;
  usages: { flagKey: string }[];
  unresolved: { path: string }[];
}
export interface PrFacts { flagKeys: string[]; state: string; createdAt: string; openedAtOffsetHours?: number }
export interface UnleashRecord { flagKey: string; policyId: string; revision: number | null; outcome: 'SYNCED' | 'FAILED'; archived: boolean; at: string }

export function reconcileAll(features: FeatureP[], m: Model, a: Anomalies, mainScans: ScanFacts[], prs: PrFacts[], unleash: UnleashRecord[], evals: EvalFlag[], repos: ('main' | 'fleet')[]) {
  const now = NOW;
  const fs = features.filter((f) => repos.includes(f.repo));
  const scans = mainScans.filter((s) => repos.includes(s.repo));
  const latest = repos.map((r) => scans.filter((s) => s.repo === r).at(-1)).filter((s): s is ScanFacts => !!s);
  const count = (s: ScanFacts, key: string) => s.usages.filter((u) => u.flagKey === key).length;
  const retiring = new Map<string, { approvedAt: string; codeRemovalDueAt: string | null; codeRemoved: boolean }>();
  for (const k of m.retiring) retiring.set(k, { approvedAt: now, codeRemovalDueAt: C.codeRemovalDue(now, null), codeRemoved: false });
  for (const r of a.removalDue) retiring.set(r.flagKey, { approvedAt: r.approvedAt, codeRemovalDueAt: C.codeRemovalDue(r.approvedAt, null), codeRemoved: false });
  const keys = new Set<string>();
  for (const f of fs) for (const e of f.plan) keys.add(e.flagKey);
  for (const s of latest) for (const u of s.usages) keys.add(u.flagKey);
  const results: { flagKey: string; repo: 'main' | 'fleet' | null; result: ReturnType<typeof C.reconcileFlag> }[] = [];
  for (const key of [...keys].sort()) {
    const f = fs.find((x) => x.plan.some((e) => e.flagKey === key));
    const e = f?.plan.find((x) => x.flagKey === key);
    const pol = f?.policies.find((p) => p.flagKey === key) ?? null;
    const current = latest.reduce((s, x) => s + count(x, key), 0);
    let lastSeen: { commit: string; at: string } | null = null;
    if (current === 0) for (const s of scans) if (count(s, key) > 0) lastSeen = { commit: s.commit, at: s.at };
    const pr = prs.filter((p) => p.flagKeys.includes(key)).at(-1) ?? null;
    const sync = unleash.find((u) => u.flagKey === key);
    const ev = evals.find((x) => x.flagKey === key);
    const result = C.reconcileFlag({
      now, flagKey: key,
      registry: f && e ? {
        featureId: f.featureId, version: e.version, lifecycle: f.latest.lifecycle as never, plannedAt: e.plannedAt,
        policy: pol ? { policyId: pol.policyId, status: pol.status as never, revision: pol.revision } : null,
        retirement: retiring.get(key) ?? null, registryRetiredAt: null,
      } : null,
      code: { current, lastSeen, lastScanAt: latest[0]?.at ?? null },
      pullRequest: pr ? { state: pr.state as never, openedAt: pr.openedAtOffsetHours !== undefined ? new Date(Date.parse(now) + pr.openedAtOffsetHours * HOUR).toISOString() : pr.createdAt } : null,
      unleash: { configured: true, present: !!sync && sync.outcome === 'SYNCED', revision: sync?.revision ?? null, archived: sync?.archived ?? false },
      deploy: null, report: null,
      rollout: pol?.basisPoints != null ? { percent: pol.basisPoints / 100, since: pol.approvedAt ?? now } : null,
      lastEvaluatedAt: ev?.lastEvaluatedAt ?? null,
      waiver: null,
    });
    results.push({ flagKey: key, repo: f?.repo ?? null, result });
  }
  const dynamicFiles = new Map<string, number>();
  for (const s of latest) for (const u of s.unresolved) dynamicFiles.set(`${s.repo}:${u.path}`, (dynamicFiles.get(`${s.repo}:${u.path}`) ?? 0) + 1);
  return { results, summary: C.summarizeFlagCoverage(results.map((r) => r.result)), dynamic: { files: dynamicFiles.size, calls: [...dynamicFiles.values()].reduce((s, x) => s + x, 0) } };
}
