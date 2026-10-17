// 5년 운영 재생 — "플랫폼을 5년 운영했다"(사용자 결정 2026-10-17)를 실제 서비스 코드로 만든다.
// 시계를 개시일(5년 전)에 두고 하루씩 넘기며, 사람(역할·직무 분리)과 차량·연계 시스템이 하는 일을 API로 그대로 부른다:
// 신차 커넥티드 등록(IF-06 모의) → 정책 작성·가상검증·검증·승인·배포·단계 확대 → 체험 제안·수락·구매 → 고장 보고 → 이상 징후 확인·조치
// → 긴급 차단 2인 승인·복구 → 수동 롤백 → 매일 만료·보존 sweep. 직접 DB에 이력을 넣지 않는다(가드·감사·이벤트가 실제로 걸린다).
// 예외는 두 가지 데이터 준비뿐이다: 데이터셋 표시(meta.dataset)와 상품 판매 시작일을 출시 일정(가정)으로 맞추는 것.
// 비율·일정은 모두 가정값(data/fixtures/ops5y/launches.json, contracts/rules/population). 시드 PRNG로 결정적이다.
import {
  inService,
  ONBOARD_MAX_PROFILES,
  platformStart,
  sampleVehicles,
  trialPrng,
  trialPropensity,
  VIRTUAL_SCENARIOS,
  type VehicleProfile,
} from '@ff/contracts';
import type { Clock } from '../kernel/clock';
import type { Db } from '../kernel/db';
import type { Scheduler } from '../kernel/scheduler';

export interface ApiResponse {
  status: number;
  body: any;
}
/** HTTP 한 번 — 시험은 supertest, CLI는 fetch로 같은 앱을 부른다 */
export type Api = (method: 'GET' | 'POST', path: string, headers: Record<string, string>, body?: unknown) => Promise<ApiResponse>;

export interface ReplayHandles {
  clock: Clock;
  scheduler: Scheduler;
  db: Db;
  /** 하루 한 번 — 체험 만료 sweep */
  trialSweep: (today: string) => unknown;
  /** 하루 한 번 — 보존 sweep(보존 기간이 지난 상태 보고·readback·차량 발신 기록 삭제) */
  retentionSweep: () => unknown;
}

export interface Launches {
  features: { month: number; featureId: string; version: string; catalogId: string | null; flags?: Record<string, string> }[];
  trialCampaigns: { fromMonth: number; catalogId: string; monthlyShare: number }[];
  incidents: { month: number; day: number; featureId: string; code: string; kill: boolean }[];
  rollbacks: { month: number; day: number; featureId: string; reason: string }[];
}

export interface ReplayOptions {
  /** 재생이 끝나는 날(KST) — 보통 오늘 */
  end: string;
  /** 재생할 일수 — 생략하면 개시일부터 end까지(5년) */
  days?: number;
  sample: number;
  receivers: number;
  seed?: number;
  launches: Launches;
  log?: (line: string) => void;
}

export interface ReplayReport {
  start: string;
  end: string;
  days: number;
  sample: number;
  receivers: number;
  /** 연도별 작업 수 — 종류 → 성공·거부 */
  years: Record<string, Record<string, { ok: number; refused: number }>>;
  /** 거부(4xx) 사유 — 가드가 실제로 막은 것. 결함이 아니라 운영 기록 */
  refusals: { at: string; op: string; status: number; code: string | null; message: string }[];
  /** 5xx — 결함. 0이어야 한다 */
  errors: { at: string; op: string; status: number; message: string }[];
  policies: { policyId: string; flagKey: string; featureId: string; version: string; deployedAt: string | null; publicationId: string | null }[];
  kills: { killId: string; featureId: string; at: string; restoredAt: string | null }[];
  /** 운영 중 드러난 문제 — 요청은 받아들여졌지만 결과가 막힌 것(예: 복원 게이트 FAIL), 키 교체 기록 */
  findings: { at: string; kind: string; detail: string }[];
  elapsedMs: number;
}

const DAY = 86_400_000;
const ymd = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
/** 그날 KST 09:00 = UTC 00:00 */
const morning = (day: string) => Date.parse(`${day}T00:00:00.000Z`);
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const h = (id: string, role: string) => ({ 'X-Actor-Id': id, 'X-Actor-Role': role });

/** 운영 조직 — 같은 역할을 두 사람씩, 직무 분리 규칙(작성자≠승인자, 배포자≠확대자, 차단 요청자≠승인자, 복원 승인자≠차단 승인자)을 지킨다 */
export const OPS_PEOPLE = {
  authors: [h('kim.author', 'FEATURE_AUTHOR'), h('nam.author', 'FEATURE_AUTHOR')],
  approvers: [h('lee.approver', 'FEATURE_APPROVER'), h('jung.approver', 'FEATURE_APPROVER')],
  release: [h('han.release', 'RELEASE_MANAGER'), h('yoon.release', 'RELEASE_MANAGER')],
  operators: [h('seo.ops', 'OPERATOR'), h('kang.ops', 'OPERATOR')],
  leads: [h('park.lead', 'OPS_LEAD'), h('choi.lead', 'OPS_LEAD')],
  safety: [h('usr-safety', 'SAFETY_OFFICER'), h('oh.safety', 'SAFETY_OFFICER')],
  security: h('usr-csm', 'SECURITY_OFFICER'),
  system: h('fleet-if06', 'SYSTEM'),
};

interface PolicyTrack {
  policyId: string;
  flagKey: string;
  featureId: string;
  version: string;
  deployedAt: string | null;
  publicationId: string | null;
  /** 다음 단계 확대 — [날짜, 목표 bp] */
  stages: [string, number][];
}

export async function replay(api: Api, hd: ReplayHandles, o: ReplayOptions): Promise<ReplayReport> {
  const t0 = Date.now();
  const start = platformStart(o.end);
  const totalDays = Math.round((morning(o.end) - morning(start)) / DAY) + 1;
  const days = Math.min(o.days ?? totalDays, totalDays);
  const last = ymd(morning(start) + (days - 1) * DAY);
  const r = trialPrng(o.seed ?? 20211017);
  const log = o.log ?? (() => {});
  const report: ReplayReport = { start, end: last, days, sample: 0, receivers: 0, years: {}, refusals: [], errors: [], policies: [], kills: [], findings: [], elapsedMs: 0 };
  let today = start;

  /** API 한 번 + 연도별 집계. 4xx는 거부(운영 기록), 5xx는 결함 */
  async function call(op: string, method: 'GET' | 'POST', path: string, who: Record<string, string>, body?: unknown): Promise<ApiResponse> {
    const res = await api(method, path, who, body);
    const y = today.slice(0, 4);
    const slot = ((report.years[y] ??= {})[op] ??= { ok: 0, refused: 0 });
    if (res.status < 400) slot.ok++;
    else {
      slot.refused++;
      const msg = String(res.body?.error?.message ?? '').slice(0, 300);
      if (res.status >= 500) report.errors.push({ at: today, op, status: res.status, message: msg });
      else if (report.refusals.length < 5000) report.refusals.push({ at: today, op, status: res.status, code: res.body?.error?.code ?? null, message: msg });
    }
    return res;
  }

  // ---- 데이터 준비: 데이터셋 표시, 상품 판매 시작일을 출시 일정으로 ----
  hd.db.run("INSERT INTO meta (key, value) VALUES ('dataset', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ kind: 'ops5y', start }));
  const launchMonthOf = (catalogId: string) => {
    const ms = [...o.launches.features.filter((f) => f.catalogId === catalogId).map((f) => f.month), ...o.launches.trialCampaigns.filter((c) => c.catalogId === catalogId).map((c) => c.fromMonth)];
    return ms.length ? Math.min(...ms) : null;
  };
  const monthStart = (m: number) => {
    const d = new Date(`${start.slice(0, 7)}-01T00:00:00.000Z`);
    d.setUTCMonth(d.getUTCMonth() + m);
    return d.toISOString().slice(0, 10);
  };
  for (const row of hd.db.all<{ catalog_id: string; version: string; doc: string }>('SELECT catalog_id, version, doc FROM product')) {
    const m = launchMonthOf(row.catalog_id);
    if (m == null) continue;
    const p = JSON.parse(row.doc);
    hd.db.run('UPDATE product SET doc = ? WHERE catalog_id = ? AND version = ?', JSON.stringify({ ...p, validFrom: monthStart(m), validTo: '2031-12-31' }), row.catalog_id, row.version);
  }

  // ---- 모집단 표본: 판매월마다 등록. 수신 표본은 Feature 적용 범위 차량에서 고른다 ----
  const sample = sampleVehicles(o.sample, start, o.end, o.seed ?? 20211017);
  report.sample = sample.length;
  const scopes = new Set<string>();
  for (const f of hd.db.all<{ doc: string }>('SELECT doc FROM feature_version')) {
    const x = JSON.parse(f.doc);
    if (o.launches.features.some((l) => l.featureId === x.featureId)) scopes.add(`${x.country}|${x.vehicleModel}|${x.trim}`);
  }
  const inScope = sample.filter((p) => scopes.has(`${p.country}|${p.vehicleModel}|${p.trim}`) && !p.retiredAt);
  const receiverVins = new Set(inScope.filter((_, i) => i % Math.max(1, Math.floor(inScope.length / o.receivers)) === 0).slice(0, o.receivers).map((p) => p.vin));
  const template = hd.db.all<{ doc: string }>('SELECT doc FROM vehicle').map((x) => JSON.parse(x.doc));
  const asReceiver = (p: VehicleProfile) => {
    const t = template.find((v) => v.vehicleModel === p.vehicleModel && v.country === p.country) ?? template.find((v) => v.vehicleModel === p.vehicleModel) ?? template[0];
    return { vin: p.vin, label: `${p.country} ${p.vehicleModel} 표본`, country: p.country, vehicleModel: p.vehicleModel, trim: p.trim, modelYear: p.soldMonth!.slice(0, 4), upgVc: t.upgVc, swVersion: t.swVersion, link: r() < 0.06 ? 'OFFLINE' : 'ONLINE' };
  };
  const bySoldMonth = new Map<string, VehicleProfile[]>();
  for (const p of sample) {
    const xs = bySoldMonth.get(p.soldMonth!);
    if (xs) xs.push(p);
    else bySoldMonth.set(p.soldMonth!, [p]);
  }
  const byVin = new Map(sample.map((p) => [p.vin, p]));

  // ---- 일정 ----
  const plan = new Map<string, (() => Promise<void>)[]>();
  const at = (day: string, fn: () => Promise<void>) => {
    if (day > last) return;
    const xs = plan.get(day);
    if (xs) xs.push(fn);
    else plan.set(day, [fn]);
  };
  const plus = (day: string, n: number) => ymd(morning(day) + n * DAY);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

  const features = new Map(hd.db.all<{ feature_id: string; version: string; doc: string }>('SELECT feature_id, version, doc FROM feature_version').map((x) => [`${x.feature_id}@${x.version}`, JSON.parse(x.doc)]));
  const tracks: PolicyTrack[] = [];
  const flagOf = (featureId: string, cp: string) => `f${featureId.slice(-5)}_${cp.toLowerCase()}`;

  async function release(l: Launches['features'][number]) {
    const f = features.get(`${l.featureId}@${l.version}`);
    if (!f) return;
    const cps: string[] = l.flags ? Object.keys(l.flags) : [f.controlPoints.includes('Flag') ? 'Flag' : f.controlPoints[0]];
    for (const cp of cps) {
      const flagKey = l.flags?.[cp] ?? flagOf(l.featureId, cp);
      const author = pick(OPS_PEOPLE.authors);
      const asil = f.asil as string;
      const c = await call('정책 작성', 'POST', '/api/policies', author, {
        featureId: l.featureId,
        featureVersion: l.version,
        controlPoint: cp,
        flagKey,
        description: `${f.name} ${l.version} — ${cp}`,
        safeDefault: false,
        entitlementCatalogId: l.catalogId,
        rollout: { mode: asil === 'C' || asil === 'D' ? 'COHORT' : 'ALL', basisPoints: 10000 },
      });
      if (c.status !== 201) continue;
      const id = c.body.policyId as string;
      // CARLA 가상검증은 차량 측 런타임이 있는 Feature(시나리오 정의)만 — 나머지는 다른 검증기가 판정한다
      if (VIRTUAL_SCENARIOS.some((x) => x.featureId === l.featureId)) await call('가상검증', 'POST', '/api/virtual-validations', author, { policyId: id });
      const v = await call('정책 검증', 'POST', `/api/policies/${id}/validate`, author, {});
      const track: PolicyTrack = { policyId: id, flagKey, featureId: l.featureId, version: l.version, deployedAt: null, publicationId: null, stages: [] };
      tracks.push(track);
      if (v.body?.run?.decision !== 'GO') continue;
      const ap = await call('정책 승인', 'POST', `/api/policies/${id}/decision`, pick(OPS_PEOPLE.approvers), { decision: 'APPROVE', reason: '검증 GO 확인' });
      if (ap.status >= 400) continue;
      const deployer = pick(OPS_PEOPLE.release);
      const d = await call('정책 배포', 'POST', `/api/policies/${id}/deploy`, deployer, { reason: `${l.featureId} ${l.version} 출시` });
      if (d.status >= 400) continue;
      track.deployedAt = today;
      track.publicationId = d.body.publicationId;
      if (d.body.stageBasisPoints != null) {
        // F2 이상 Canary(5%)에서 시작 — 하루 관측 뒤 20%, 사흘 뒤 전체. 확대는 배포자가 아닌 운영자가
        const widen = (to: number, day: string, tries = 0): void =>
          at(day, async () => {
            const s = await call('단계 확대', 'POST', `/api/policies/${id}/rollout`, pick(OPS_PEOPLE.operators), { basisPoints: to, reason: tries ? `관측 재확인 뒤 ${to / 100}%` : `Canary 관측 이상 없음 — ${to / 100}%` });
            if (s.status >= 400 && tries < 20) widen(to, plus(day, 2), tries + 1); // 열린 이상 징후·진행 중 차단이 있으면 기다린다(중단 기준)
          });
        widen(2000, plus(today, 1));
        widen(10000, plus(today, 4));
      }
    }
  }

  for (const l of o.launches.features) at(plus(monthStart(l.month), Math.floor(r() * 20)), () => release(l));

  // 체험 캠페인 — 매월 1일, 상품 범위의 운행 중 표본 차량 중 일부에 제안. 수락·거절·구매는 성향 확률로 그 뒤 날짜에
  const campaignVehicles = (catalogId: string) => {
    const p = hd.db.get<{ doc: string }>('SELECT doc FROM product WHERE catalog_id = ? ORDER BY version DESC', catalogId);
    if (!p) return [] as VehicleProfile[];
    const prod = JSON.parse(p.doc);
    return sample.filter((v) => v.country === prod.country && v.vehicleModel === prod.vehicleModel && v.trim === prod.trim);
  };
  const scope = new Map(o.launches.trialCampaigns.map((c) => [c.catalogId, campaignVehicles(c.catalogId)]));
  async function campaign(c: Launches['trialCampaigns'][number]) {
    const pool = (scope.get(c.catalogId) ?? []).filter((v) => inService(v, today));
    const chosen = pool.filter(() => r() < c.monthlyShare).map((v) => v.vin);
    for (let i = 0; i < chosen.length; i += 200) {
      const res = await call('체험 제안', 'POST', '/api/trials/offers', pick(OPS_PEOPLE.operators), { catalogId: c.catalogId, vins: chosen.slice(i, i + 200), note: '월간 체험 캠페인' });
      for (const g of res.body?.offered ?? []) {
        const prof = byVin.get(g.vin)!;
        const { pAccept, pConvert } = trialPropensity(prof);
        if (r() < pAccept) {
          const acceptDay = plus(today, Math.floor(r() * 10));
          at(acceptDay, async () => {
            const a = await call('체험 수락', 'POST', `/api/trials/${g.grantId}/accept`, OPS_PEOPLE.system, {});
            if (a.status < 400 && r() < pConvert) at(plus(acceptDay, 5 + Math.floor(r() * 30)), async () => void (await call('구매 전환', 'POST', `/api/trials/${g.grantId}/purchase`, OPS_PEOPLE.system, { plan: r() < 0.7 ? '구독' : '구매' })));
          });
        } else if (r() < 0.6) at(plus(today, 1 + Math.floor(r() * 12)), async () => void (await call('체험 거절', 'POST', `/api/trials/${g.grantId}/decline`, OPS_PEOPLE.system, { reason: '운전자 거절' })));
      }
    }
  }

  // 고장·사고 — 계획된 사고는 FAULT 보고 → 이상 징후 → 긴급 차단(2인 승인) → 복구(다른 2인). 그 밖에 드문 일상 고장 보고
  const seqOf = new Map<string, number>();
  async function report_(vin: string, body: Record<string, unknown>) {
    const n = (seqOf.get(vin) ?? 0) + 1;
    seqOf.set(vin, n);
    const boot = `BOOT-${vin}-1`;
    if (n === 1) {
      await call('차량 보고', 'POST', `/vehicle/v1/${vin}/reports`, { 'X-Vehicle-Id': vin }, { type: 'HELLO', bootId: boot, sequence: 0, observedAt: new Date(hd.clock.now()).toISOString() });
    }
    return call('차량 보고', 'POST', `/vehicle/v1/${vin}/reports`, { 'X-Vehicle-Id': vin }, { bootId: boot, sequence: n, observedAt: new Date(hd.clock.now()).toISOString(), ...body });
  }
  const receiversOf = (featureId: string) => {
    const vs = [...features.values()].filter((f) => f.featureId === featureId).map((f) => `${f.country}|${f.vehicleModel}|${f.trim}`);
    return sample.filter((p) => receiverVins.has(p.vin) && vs.includes(`${p.country}|${p.vehicleModel}|${p.trim}`) && inService(p, today) && (p.soldMonth ?? '') <= today.slice(0, 7));
  };
  async function triage() {
    const list = await call('이상 징후 조회', 'GET', '/api/anomalies', OPS_PEOPLE.operators[0]);
    for (const a of (list.body?.items ?? list.body ?? []) as any[]) {
      if (a.status === 'OPEN') await call('이상 징후 확인', 'POST', `/api/anomalies/${a.anomalyId}/acknowledge`, pick(OPS_PEOPLE.operators), { reason: '현장 보고 확인' });
      else if (a.status === 'ACKNOWLEDGED' && r() < 0.5) await call('이상 징후 조치', 'POST', `/api/anomalies/${a.anomalyId}/mitigate`, pick(OPS_PEOPLE.safety), { reason: '원인 조치 완료' });
    }
  }
  for (const inc of o.launches.incidents) {
    const day = plus(monthStart(inc.month), inc.day - 1);
    at(day, async () => {
      const vs = receiversOf(inc.featureId).slice(0, 6);
      for (const v of vs) await report_(v.vin, { type: 'FAULT', featureId: inc.featureId, code: inc.code, severity: 'CRITICAL', detail: '현장 고장 보고' });
      if (!inc.kill) return;
      const f = [...features.values()].find((x) => x.featureId === inc.featureId)!;
      const live = tracks.filter((t) => t.featureId === inc.featureId && t.deployedAt).at(-1);
      const k = await call('긴급 차단 요청', 'POST', '/api/kill-requests', pick(OPS_PEOPLE.operators), {
        featureId: inc.featureId,
        featureVersion: live?.version ?? f.version,
        reason: `${inc.code} 현장 보고 — 원인 분석 전 봉쇄`,
        confirm: inc.featureId,
        reasonCategory: 'SAFETY',
        reasonCode: 'FIELD_FAULT',
        containmentJustification: '원인 분석 전 봉쇄',
        recallCampaignId: `RC-${day.replace(/-/g, '')}`,
      });
      if (k.status >= 400) return;
      const killId = k.body.killId as string;
      await call('긴급 차단 승인', 'POST', `/api/kill-requests/${killId}/approvals`, OPS_PEOPLE.safety[0], {});
      const ok = await call('긴급 차단 승인', 'POST', `/api/kill-requests/${killId}/approvals`, OPS_PEOPLE.leads[0], {});
      const entry = { killId, featureId: inc.featureId, at: day, restoredAt: null as string | null };
      report.kills.push(entry);
      if (ok.status >= 400) return;
      const back = plus(day, 3 + Math.floor(r() * 4));
      at(back, async () => {
        await triage();
        await call('복원 요청', 'POST', `/api/kill-requests/${killId}/restore`, OPS_PEOPLE.operators[1], { reason: '원인 조치·재검증 완료' });
        await call('복원 승인', 'POST', `/api/kill-requests/${killId}/restore/approvals`, OPS_PEOPLE.safety[1], {});
        await call('복원 승인', 'POST', `/api/kill-requests/${killId}/restore/approvals`, OPS_PEOPLE.security, {});
        const k2 = (await call('차단 조회', 'GET', `/api/kill-requests/${killId}`, OPS_PEOPLE.operators[0])).body;
        const kr = k2?.kill ?? k2;
        if (kr?.status === 'RELEASED' || kr?.restorePublicationId) entry.restoredAt = today;
        else report.findings.push({ at: today, kind: '복원 막힘', detail: `${killId} ${inc.featureId} — 복원 ${kr?.restoreRequest?.status ?? '?'}, 게이트 ${(kr?.restoreRequest?.gate?.failed ?? []).join('·') || '-'}` });
      });
    });
  }

  // 수동 롤백 — 같은 flag의 지금 배포를 이전 배포 정책으로
  for (const rb of o.launches.rollbacks) {
    at(plus(monthStart(rb.month), rb.day - 1), async () => {
      const mine = tracks.filter((t) => t.featureId === rb.featureId && t.deployedAt);
      const cur = mine.at(-1);
      const prev = mine.filter((t) => t.flagKey === cur?.flagKey).at(-2);
      if (!cur || !prev) return;
      const deps = await call('롤백 대상 조회', 'GET', '/api/rollbacks/deployments', OPS_PEOPLE.operators[0]);
      const dep = ((deps.body?.items ?? []) as any[]).find((x) => x.flagKey === cur.flagKey);
      if (!dep) return;
      const q = await call('롤백 요청', 'POST', '/api/rollback-requests', OPS_PEOPLE.operators[0], { deploymentId: dep.deploymentId, targetTypes: ['POLICY_VERSION'], recovery: { policyId: prev.policyId }, scope: { featureIds: [rb.featureId] }, reason: rb.reason, approvers: ['park.lead'] });
      if (q.status >= 400) return;
      const d = await call('롤백 승인', 'POST', `/api/rollback-requests/${q.body.requestId}/decision`, OPS_PEOPLE.leads[0], { decision: 'APPROVE', comment: '현장 보고 확인' });
      if (d.status < 400) await call('롤백 실행', 'POST', `/api/rollback-requests/${q.body.requestId}/execute`, OPS_PEOPLE.operators[0], {});
    });
  }

  // ---- 하루씩 ----
  for (let i = 0; i < days; i++) {
    today = ymd(morning(start) + i * DAY);
    hd.scheduler.advanceTo(morning(today));
    const m = monthsBetween(start, today);
    if (i === 0 || today.endsWith('-01')) {
      // 신차 커넥티드 등록 — 이번 달 판매분(첫날은 개시 전 판매분 없음)
      const sold = bySoldMonth.get(today.slice(0, 7)) ?? [];
      for (let k = 0; k < sold.length; k += ONBOARD_MAX_PROFILES) {
        const batch = sold.slice(k, k + ONBOARD_MAX_PROFILES);
        const rec = batch.filter((p) => receiverVins.has(p.vin)).map(asReceiver);
        report.receivers += rec.length;
        await call('신차 등록', 'POST', '/api/fleet/onboard', OPS_PEOPLE.system, { profiles: batch, receivers: rec });
      }
      for (const c of o.launches.trialCampaigns) if (m >= c.fromMonth) await campaign(c);
      // 서명 키 정기 점검 — 만료 30일 전 용도별 교체(안전 책임자). 교체하지 않으면 만료된 키로는 배포·차단을 서명할 수 없다
      const keys = (await call('서명 키 조회', 'GET', '/api/pki/keys', OPS_PEOPLE.safety[0])).body?.items ?? [];
      for (const k of keys as { keyId: string; purpose: string; status: string; notAfter: string }[]) {
        if (k.status !== 'ACTIVE' || Date.parse(k.notAfter) - morning(today) > 30 * DAY) continue;
        const rot = await call('서명 키 교체', 'POST', '/api/pki/rotate', pick(OPS_PEOPLE.safety), { reason: `정기 교체 — ${k.keyId} ${k.notAfter.slice(0, 10)} 만료 전`, purpose: k.purpose });
        if (rot.status < 400) report.findings.push({ at: today, kind: '키 교체', detail: `${k.purpose} ${k.keyId} → ${rot.body.keyId}` });
      }
    }
    for (const fn of plan.get(today) ?? []) await fn();
    // 일상 고장 보고 — 수신 표본의 드문 경고, 그다음 운영자 분류
    if (today.endsWith('5') || today.endsWith('0')) {
      const live = sample.filter((p) => receiverVins.has(p.vin) && inService(p, today) && (p.soldMonth ?? '9') <= today.slice(0, 7));
      for (const v of live) if (r() < 0.004) await report_(v.vin, { type: 'FAULT', featureId: pick(['FEAT-00022', 'FEAT-00001', 'FEAT-00004']), code: 'SENSOR_WARN', severity: 'WARNING', detail: '일시 경고' });
      await triage();
    }
    hd.scheduler.advanceTo(morning(today) + 12 * 3600_000); // 차량 회신·기한 처리(KST 21시까지)
    hd.trialSweep(today);
    // 체험 만료 고지 뒤 시스템이 만든 상업 비활성화 요청 — 운영 리더·안전 책임자가 그날 밤 승인한다(요청 유효 시간 안에)
    const pending = (await call('차단 요청 조회', 'GET', '/api/kill-requests?status=REQUESTED', OPS_PEOPLE.leads[1])).body;
    for (const k of ((pending?.items ?? pending ?? []) as any[]).filter((x) => x.reasonCategory === 'COMMERCIAL' && x.requestedBy === 'system')) {
      await call('상업 비활성화 승인', 'POST', `/api/kill-requests/${k.killId}/approvals`, OPS_PEOPLE.leads[1], { comment: '체험 만료 — 고지 확인' });
      await call('상업 비활성화 승인', 'POST', `/api/kill-requests/${k.killId}/approvals`, OPS_PEOPLE.safety[1], { comment: '체험 만료 — 고지 확인' });
    }
    hd.retentionSweep();
    if (today.endsWith('-01-01') || i === days - 1) log(`${today} — 정책 ${tracks.filter((t) => t.deployedAt).length}건 배포, 차단 ${report.kills.length}건, 결함 ${report.errors.length}건, ${Math.round((Date.now() - t0) / 1000)}초`);
  }
  hd.scheduler.advanceTo(morning(last) + DAY - 1);
  report.policies = tracks.map(({ stages: _s, ...t }) => t);
  report.elapsedMs = Date.now() - t0;
  return report;
}
