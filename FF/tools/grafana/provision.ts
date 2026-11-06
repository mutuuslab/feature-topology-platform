// node tools/grafana/provision.ts [--dry-run] [--skip-alerts] [--skip-public]
// Grafana Cloud 스택에 FF 운영 대시보드·경보를 올린다(80-80) — GitHub Actions grafana-provision.yml(수동 실행)이 부른다.
//   1) 스택 기본 데이터 소스(grafanacloud-<stack>-prom·-logs·-traces)를 /api/datasources에서 이름으로 찾는다
//   2) 폴더 'FF 운영'·'FF 운영 (공개 시연)' → 대시보드 7개(로그인용)·공개본 7개(변수 없음) 업로드
//   3) 공개본마다 공개 대시보드(외부 공유)를 켜고 공개 URL을 출력한다(실행 요약에도)
//   4) 경보 규칙 그룹·연락처(FF webhook·메일, 값이 있을 때)·알림 정책(ff_source=feature-platform 경로)
// 비밀: GRAFANA_STACK_URL·GRAFANA_SA_TOKEN(서비스 계정, Admin). 없으면 '비밀 없음'으로 실패(종료 2).
// 선택: FF_PUBLIC_URL(데이터 링크가 여는 FF 주소, 기본 공개 데모) · FF_GRAFANA_WEBHOOK_URL + FF_GRAFANA_WEBHOOK_SECRET/TOKEN · GRAFANA_ALERT_EMAIL
import { appendFileSync } from 'node:fs';
import { alertRuleJson, alertRules, dashboards, FF_URL_DEFAULT, FOLDER, PUBLIC_FOLDER, publicVariant, RULE_GROUP_INTERVAL, type Dashboard } from './dashboards.ts';

type Env = Record<string, string | undefined>;
type Json = Record<string, any>;

export const PROVISION_SECRETS = ['GRAFANA_STACK_URL', 'GRAFANA_SA_TOKEN'] as const;
const FF_ROUTE_MATCHER = ['ff_source', '=', 'feature-platform'];

export class Grafana {
  readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  constructor(base: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.base = base.replace(/\/+$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
  }
  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: any }> {
    const r = await this.fetchImpl(this.base + path, { method, headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }), ...extra }, ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { message: text.slice(0, 300) };
    }
    return { status: r.status, json };
  }
  async must(method: string, path: string, body?: unknown, extra: Record<string, string> = {}, ok: number[] = [200, 201, 202, 204]) {
    const r = await this.call(method, path, body, extra);
    if (!ok.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json)?.slice(0, 400)}${r.status === 401 || r.status === 403 ? ' (GRAFANA_SA_TOKEN 권한: 서비스 계정 Admin)' : ''}`);
    return r.json;
  }
}

export interface DataSources {
  prom: { uid: string; name: string };
  loki: { uid: string; name: string } | null;
  tempo: { uid: string; name: string } | null;
}

/** 스택 기본 데이터 소스 — grafanacloud-<스택>-prom·-logs·-traces(usage·ml 등 다른 것은 피한다) */
export function pickDataSources(list: { uid: string; name: string; type: string }[]): DataSources {
  const pick = (type: string, suffix: string) => list.find((d) => d.type === type && new RegExp(`^grafanacloud-.+-${suffix}$`).test(d.name) && !/usage|ml-metrics|alert-state/.test(d.name)) ?? list.find((d) => d.type === type && !/usage|ml-metrics|alert-state/.test(d.name)) ?? null;
  const prom = pick('prometheus', 'prom');
  if (!prom) throw new Error('Prometheus 데이터 소스(grafanacloud-<스택>-prom)를 찾지 못했다 — 스택의 Connections → Data sources를 확인한다');
  const p = (x: { uid: string; name: string } | null) => (x ? { uid: x.uid, name: x.name } : null);
  return { prom: { uid: prom.uid, name: prom.name }, loki: p(pick('loki', 'logs')), tempo: p(pick('tempo', 'traces')) };
}

/** 자리표시(${DS_*})·FF 주소를 실제 값으로 */
export function bindDashboard(d: Dashboard, ds: DataSources, ffUrl: string): Json {
  const { __inputs: _drop, ...rest } = d as Json;
  let s = JSON.stringify(rest);
  s = s.replaceAll('${DS_PROMETHEUS}', ds.prom.uid).replaceAll('${DS_LOKI}', ds.loki?.uid ?? ds.prom.uid).replaceAll('${DS_TEMPO}', ds.tempo?.uid ?? ds.prom.uid).replaceAll(FF_URL_DEFAULT, ffUrl.replace(/\/+$/, ''));
  return { ...JSON.parse(s), id: null };
}

async function ensureFolder(g: Grafana, f: { uid: string; title: string }) {
  const r = await g.call('GET', `/api/folders/${f.uid}`);
  if (r.status === 200) return;
  await g.must('POST', '/api/folders', { uid: f.uid, title: f.title });
}

async function publicDashboard(g: Grafana, uid: string): Promise<string> {
  const cfg = { isEnabled: true, share: 'public', timeSelectionEnabled: true, annotationsEnabled: true };
  const cur = await g.call('GET', `/api/dashboards/uid/${uid}/public-dashboards`);
  let pd: Json;
  if (cur.status === 200 && cur.json?.uid) pd = await g.must('PATCH', `/api/dashboards/uid/${uid}/public-dashboards/${cur.json.uid}`, cfg);
  else pd = await g.must('POST', `/api/dashboards/uid/${uid}/public-dashboards`, cfg);
  const token = pd?.accessToken ?? cur.json?.accessToken;
  if (!token) throw new Error(`${uid} 공개 대시보드 accessToken이 응답에 없다`);
  return `${g.base}/public-dashboards/${token}`;
}

export function contactPoints(env: Env): Json[] {
  const out: Json[] = [];
  if (env.FF_GRAFANA_WEBHOOK_URL) {
    const settings: Json = { url: env.FF_GRAFANA_WEBHOOK_URL, httpMethod: 'POST', maxAlerts: 100 };
    if (env.FF_GRAFANA_WEBHOOK_TOKEN) Object.assign(settings, { authorization_scheme: 'Bearer', authorization_credentials: env.FF_GRAFANA_WEBHOOK_TOKEN });
    if (env.FF_GRAFANA_WEBHOOK_SECRET) settings.hmacConfig = { secret: env.FF_GRAFANA_WEBHOOK_SECRET, header: 'X-Grafana-Alerting-Signature', timestampHeader: 'X-Grafana-Alerting-Timestamp' };
    out.push({ uid: 'ff-webhook', name: 'FF 운영 관찰 webhook', type: 'webhook', settings, disableResolveMessage: false });
  }
  if (env.GRAFANA_ALERT_EMAIL) out.push({ uid: 'ff-email', name: 'FF 운영 메일', type: 'email', settings: { addresses: env.GRAFANA_ALERT_EMAIL, singleEmail: true }, disableResolveMessage: false });
  return out;
}

/** 공개 시연처럼 FF webhook·메일이 없을 때 — 경보는 Grafana 경보 목록에만 보이고 알림은 보내지 않는다(관리자 메일함을 채우지 않게) */
export const QUIET_TIMING = 'ff-quiet-no-receiver';

/** 알림 정책 — 기존 트리는 두고 ff_source=feature-platform 경로만 바꿔 넣는다. 개선 후보(IMPROVEMENT)는 하루 한 번 다시 알림 */
export function mergePolicy(tree: Json, receivers: string[], fallback: string, quiet = false): Json {
  const isOurs = (r: Json) => (r.object_matchers ?? []).some((m: string[]) => m.join('|') === FF_ROUTE_MATCHER.join('|'));
  const receiver = receivers[0] ?? fallback;
  const ours = {
    receiver,
    object_matchers: [FF_ROUTE_MATCHER],
    group_by: ['alertname', 'feature', 'feature_version'],
    group_wait: '30s',
    group_interval: '5m',
    repeat_interval: '4h',
    continue: false,
    ...(quiet && { mute_time_intervals: [QUIET_TIMING] }),
    routes: [
      { receiver, object_matchers: [['ff_axis', '=', 'IMPROVEMENT']], repeat_interval: '24h', group_interval: '30m' },
      ...receivers.slice(1).map((r) => ({ receiver: r, object_matchers: [['severity', '=', 'critical']], continue: true })),
    ],
  };
  return { ...tree, routes: [ours, ...(tree.routes ?? []).filter((r: Json) => !isOurs(r))] };
}

export interface ProvisionResult {
  datasources: DataSources;
  dashboards: string[];
  publicUrls: Record<string, string>;
  alertGroups: string[];
  contactPoints: string[];
  /** 경보 단계에서 난 오류 — 대시보드·공개 URL은 이미 끝났으므로 모아 보이고 종료 1 */
  errors: string[];
  /** 받을 곳이 없어 알림을 막았는가 */
  quiet?: boolean;
}

export async function provision(env: Env, opts: { skipAlerts?: boolean; skipPublic?: boolean; dryRun?: boolean } = {}, fetchImpl: typeof fetch = fetch): Promise<ProvisionResult> {
  const g = new Grafana(env.GRAFANA_STACK_URL!.trim(), env.GRAFANA_SA_TOKEN!.trim(), fetchImpl);
  const ffUrl = env.FF_PUBLIC_URL?.trim() || FF_URL_DEFAULT;
  // 토큰 확인(권한 없는 토큰은 여기서 멈춘다)
  await g.must('GET', '/api/search?limit=1');
  const ds = pickDataSources(await g.must('GET', '/api/datasources'));
  const result: ProvisionResult = { datasources: ds, dashboards: [], publicUrls: {}, alertGroups: [], contactPoints: [], errors: [] };
  if (opts.dryRun) return result;
  await ensureFolder(g, FOLDER);
  await ensureFolder(g, PUBLIC_FOLDER);
  const message = `FF provision ${env.GITHUB_SHA?.slice(0, 7) ?? 'local'}`;
  for (const d of dashboards()) {
    await g.must('POST', '/api/dashboards/db', { dashboard: bindDashboard(d, ds, ffUrl), folderUid: FOLDER.uid, overwrite: true, message });
    result.dashboards.push(d.uid);
    const p = publicVariant(d, ffUrl);
    await g.must('POST', '/api/dashboards/db', { dashboard: bindDashboard(p, ds, ffUrl), folderUid: PUBLIC_FOLDER.uid, overwrite: true, message });
    result.dashboards.push(p.uid);
    if (!opts.skipPublic) result.publicUrls[d.uid] = await publicDashboard(g, p.uid);
  }
  if (!opts.skipAlerts) await provisionAlerting(g, env, ds, result).catch((e) => result.errors.push((e as Error).message));
  return result;
}

/** 경보 규칙 그룹·연락처·알림 정책 — Grafana 13에서 /api/v1/provisioning은 동작하지만 /apis로 옮겨 가는 중(80-80 한계) */
async function provisionAlerting(g: Grafana, env: Env, ds: DataSources, result: ProvisionResult) {
  {
    const noProv = { 'X-Disable-Provenance': 'true' };
    for (const [group, interval] of Object.entries(RULE_GROUP_INTERVAL)) {
      const rules = alertRules()
        .filter((r) => r.group === group)
        .map((r) => alertRuleJson(r, ds.prom.uid, FOLDER.uid));
      await g.must('PUT', `/api/v1/provisioning/folder/${FOLDER.uid}/rule-groups/${group}`, { title: group, folderUid: FOLDER.uid, interval, rules }, noProv);
      result.alertGroups.push(group);
    }
    const existing: Json[] = (await g.must('GET', '/api/v1/provisioning/contact-points')) ?? [];
    for (const cp of contactPoints(env)) {
      if (existing.some((x) => x.uid === cp.uid)) await g.must('PUT', `/api/v1/provisioning/contact-points/${cp.uid}`, cp, noProv);
      else await g.must('POST', '/api/v1/provisioning/contact-points', cp, noProv);
      result.contactPoints.push(cp.name);
    }
    const quiet = result.contactPoints.length === 0;
    if (quiet) {
      // 하루 종일(00:00~24:00) = 언제나 — 알림만 막고 경보 평가·상태 기록은 그대로
      const timing = { name: QUIET_TIMING, time_intervals: [{ times: [{ start_time: '00:00', end_time: '24:00' }] }] };
      const cur = await g.call('GET', `/api/v1/provisioning/mute-timings/${QUIET_TIMING}`);
      if (cur.status === 200) await g.must('PUT', `/api/v1/provisioning/mute-timings/${QUIET_TIMING}`, timing, noProv);
      else await g.must('POST', '/api/v1/provisioning/mute-timings', timing, noProv);
      result.quiet = true;
    }
    const tree = await g.must('GET', '/api/v1/provisioning/policies');
    await g.must('PUT', '/api/v1/provisioning/policies', mergePolicy(tree, result.contactPoints, tree.receiver, quiet), noProv);
  }
}

/** 공개 URL을 FF 빌드 변수로 — 코디네이터가 저장소 변수로 넣는다 */
export function buildVariables(r: ProvisionResult, stack: string): Record<string, string> {
  return {
    ...(r.publicUrls['ff-vehicle-telemetry'] && { GRAFANA_PUBLIC_URL: r.publicUrls['ff-vehicle-telemetry'] }),
    ...(r.publicUrls['ff-feature-health'] && { GRAFANA_FEATURE_PUBLIC_URL: r.publicUrls['ff-feature-health'] }),
    ...(r.publicUrls['ff-ops-overview'] && { GRAFANA_OVERVIEW_PUBLIC_URL: r.publicUrls['ff-ops-overview'] }),
    GRAFANA_URL: stack.replace(/\/+$/, ''),
  };
}

/** 확인용 대표 쿼리 — 시연 데이터(또는 설치 서버 지표)가 실제로 들어왔는가 */
export const CHECK_QUERIES: Record<string, string> = {
  '상태 보고 수락(1시간)': 'sum(increase(ff_vehicle_status_reports_total{result="accepted"}[1h]))',
  '등록 차량': 'sum(ff_vehicles_registered)',
  'Feature 활성 차량': 'sum(ff_feature_active_vehicles)',
};

/** 올린 뒤 실제 상태 — FF 경보 규칙 수(GET)와 대표 쿼리 값(/api/ds/query) */
export async function verifyStack(g: Grafana, ds: DataSources) {
  const rules: Json[] = (await g.must('GET', '/api/v1/provisioning/alert-rules')) ?? [];
  const ff = rules.filter((r) => r.labels?.ff_source === 'feature-platform');
  const values: Record<string, number | null> = {};
  const now = Date.now();
  const res = await g.must('POST', '/api/ds/query', {
    from: String(now - 3_600_000),
    to: String(now),
    queries: Object.values(CHECK_QUERIES).map((expr, i) => ({ refId: `Q${i}`, datasource: { type: 'prometheus', uid: ds.prom.uid }, expr, instant: true, range: false, intervalMs: 60000, maxDataPoints: 1 })),
  });
  Object.keys(CHECK_QUERIES).forEach((name, i) => {
    const frames: Json[] = res?.results?.[`Q${i}`]?.frames ?? [];
    const nums = frames.flatMap((f) => (f.data?.values ?? []).slice(1).flat()).filter((v: unknown) => typeof v === 'number') as number[];
    values[name] = nums.length ? nums.reduce((a, b) => a + b, 0) : null;
  });
  return { ffRules: ff.length, expectedRules: alertRules().length, missingRules: alertRules().map((r) => r.uid).filter((u) => !ff.some((x) => x.uid === u)), values };
}

export async function main(argv = process.argv, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  const missing = PROVISION_SECRETS.filter((k) => !env[k]?.trim());
  if (missing.length) {
    const msg = `비밀 없음: ${missing.join(', ')} — Grafana Cloud 스택 주소(https://<스택>.grafana.net)와 스택의 서비스 계정 토큰(Admin)을 GitHub 저장소 비밀로 넣는다. 아무것도 바꾸지 않았다.`;
    console.error(msg);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Grafana 프로비저닝 실패\n\n${msg}\n`);
    return 2;
  }
  if (!/^https:\/\/[^/]+$/.test(env.GRAFANA_STACK_URL!.trim().replace(/\/+$/, '')) && !/^http:\/\/127\.0\.0\.1:\d+$/.test(env.GRAFANA_STACK_URL!.trim())) {
    console.error('비밀 형식 오류: GRAFANA_STACK_URL은 https://<스택>.grafana.net 모양이어야 한다');
    return 2;
  }
  const r = await provision(env, { dryRun: argv.includes('--dry-run'), skipAlerts: argv.includes('--skip-alerts'), skipPublic: argv.includes('--skip-public') }, fetchImpl);
  const vars = buildVariables(r, env.GRAFANA_STACK_URL!);
  let check: Awaited<ReturnType<typeof verifyStack>> | null = null;
  if (!argv.includes('--dry-run')) {
    try {
      check = await verifyStack(new Grafana(env.GRAFANA_STACK_URL!.trim(), env.GRAFANA_SA_TOKEN!.trim(), fetchImpl), r.datasources);
    } catch (e) {
      r.errors.push(`확인 실패: ${(e as Error).message}`);
    }
    if (check && !argv.includes('--skip-alerts') && check.missingRules.length) r.errors.push(`경보 규칙이 없다: ${check.missingRules.join(', ')}`);
  }
  const lines = [
    `데이터 소스: 지표 ${r.datasources.prom.name} · 로그 ${r.datasources.loki?.name ?? '— (로그 패널은 지표 소스로 대체)'} · 추적 ${r.datasources.tempo?.name ?? '—'}`,
    `대시보드 ${r.dashboards.length}개 · 경보 그룹 ${r.alertGroups.join(', ') || '건너뜀'} · 연락처 ${r.contactPoints.join(', ') || (r.quiet ? `없음 — 알림 보내지 않음(묵음 ${QUIET_TIMING}, Grafana 경보 목록에만)` : '스택 기본')}`,
    ...(check ? [`확인: FF 경보 규칙 ${check.ffRules}/${check.expectedRules}개 · ${Object.entries(check.values).map(([k, v]) => `${k} ${v === null ? '값 없음' : Math.round(v * 10) / 10}`).join(' · ')}`] : []),
    ...Object.entries(r.publicUrls).map(([uid, url]) => `공개 ${uid}: ${url}`),
    '',
    'FF 빌드 변수(코디네이터가 실행):',
    ...Object.entries(vars).map(([k, v]) => `  gh variable set ${k} --body "${v}"`),
  ];
  if (r.errors.length) lines.push('', '경보 단계 오류(대시보드·공개 URL은 위와 같이 끝남):', ...r.errors.map((e) => `  ${e}`));
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Grafana 프로비저닝\n\n${lines.map((l) => (l.startsWith('  gh ') ? `    ${l.trim()}` : l ? `- ${l}` : '')).join('\n')}\n`);
  return r.errors.length ? 1 : 0;
}

if (import.meta.main) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`프로비저닝 실패: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
