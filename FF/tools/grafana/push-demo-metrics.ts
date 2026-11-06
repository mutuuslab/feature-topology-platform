// node tools/grafana/push-demo-metrics.ts [--window 30] [--events 15] [--dry-run] [--now ISO]
// 공개 데모용 — 결정적 시연 시계열(demo-generator)을 '지금' 기준으로 Grafana Cloud OTLP 게이트웨이에 보낸다(지표·로그·추적).
// GitHub Actions grafana-demo.yml이 15분마다 부른다. 비밀(GRAFANA_OTLP_URL·_INSTANCE_ID·_TOKEN)이 없으면 '비밀 없음'으로 실패(종료 2) —
// 건너뛰기로 성공 처리하지 않는다. --dry-run은 보내지 않고 크기·시계열 수만 본다(비밀 필요 없음).
import { readCatalog } from './demo-catalog.ts';
import { generate, windowTimes } from './demo-generator.ts';
import { otlpTarget, OTLP_SECRETS, sendLogs, sendMetrics, sendTraces } from './otlp-send.ts';
import { encodeMetrics } from '../../backend/src/kernel/otlp/otlp-proto.ts';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

/** 시연 자원 속성 — 서버 설치(Alloy)와 같은 job 이름(ff/ff-platform·ff/ff-datalake), instance는 시연 표시 */
export const DEMO_RESOURCES = {
  platform: { 'service.name': 'ff-platform', 'service.namespace': 'ff', 'service.instance.id': 'ff-public-demo', 'deployment.environment': 'demo' },
  lake: { 'service.name': 'ff-datalake', 'service.namespace': 'ff', 'service.instance.id': 'ff-public-demo', 'deployment.environment': 'demo' },
} as const;

export async function main(argv = process.argv, env = process.env, fetchImpl: typeof fetch = fetch): Promise<number> {
  const dry = argv.includes('--dry-run');
  const windowMin = Number(arg('--window', '30'));
  const eventsMin = Number(arg('--events', '15'));
  const now = Date.parse(arg('--now', new Date().toISOString()));
  if (!Number.isFinite(now) || !(windowMin >= 1 && windowMin <= 60) || !(eventsMin >= 0 && eventsMin <= windowMin)) {
    console.error('인자 오류 — --window 1~60(분), --events 0~window(분), --now ISO 시각');
    return 2;
  }
  const { target, missing, problems } = otlpTarget(env);
  if (!dry && (missing.length || problems.length)) {
    if (missing.length) console.error(`비밀 없음: ${missing.join(', ')} — Grafana Cloud 스택 'OpenTelemetry' 설정 화면의 값을 GitHub 저장소 비밀로 넣는다(gh secret set ${OTLP_SECRETS[0]} …). 보내지 않았다.`);
    for (const p of problems) console.error(`비밀 형식 오류: ${p}`);
    if (env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(env.GITHUB_STEP_SUMMARY, `### Grafana 시연 전송 실패\n\n${missing.length ? `비밀 없음: \`${missing.join('`, `')}\`` : problems.join('\n')}\n`);
    }
    return 2;
  }
  const catalog = readCatalog();
  const t0 = performance.now();
  const batch = generate(catalog, windowTimes(now, windowMin), now - eventsMin * 60_000);
  const gen = Math.round(performance.now() - t0);
  const summary = [`시각 ${new Date(now).toISOString()} · 창 ${windowMin}분 · 시계열 ${batch.activeSeries}(Prometheus 기준) · 점 ${batch.points} · 로그 ${batch.events.logs.length} · span ${batch.events.spans.length} · 생성 ${gen}ms`];
  if (dry) {
    const bytes = encodeMetrics(DEMO_RESOURCES.platform, { name: 'ff-grafana-demo' }, batch.platform).length + encodeMetrics(DEMO_RESOURCES.lake, { name: 'ff-grafana-demo' }, batch.lake).length;
    console.log(`${summary[0]} · 지표 본문 ${(bytes / 1024).toFixed(0)} KiB(압축 전) — dry-run, 보내지 않음`);
    return 0;
  }
  const results = [
    await sendMetrics(target!, DEMO_RESOURCES.platform, batch.platform, fetchImpl),
    await sendMetrics(target!, DEMO_RESOURCES.lake, batch.lake, fetchImpl),
    await sendLogs(target!, DEMO_RESOURCES.platform, batch.events.logs, fetchImpl),
    await sendTraces(target!, DEMO_RESOURCES.platform, batch.events.spans, fetchImpl),
  ];
  for (const r of results) summary.push(`${r.signal}: 요청 ${r.requests} · ${(r.bytes / 1024).toFixed(0)} KiB · 거부 ${r.rejected}${r.soft ? ` · 일부 거부 요청 ${r.soft}(겹친 창의 같은 시각 다른 값 등)` : ''}${r.messages.length ? ` · ${r.messages.join(' / ').slice(0, 300)}` : ''}`);
  console.log(summary.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Grafana 시연 전송\n\n${summary.map((s) => `- ${s}`).join('\n')}\n`);
  }
  // 일부 거부(겹친 창의 같은 점 등)는 경고로 남기고, 전부 거부되면 실패
  const rejected = results.reduce((n, r) => n + r.rejected, 0);
  if (rejected && rejected >= batch.points) {
    console.error('보낸 점이 모두 거부되었다 — 위 메시지를 확인한다');
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`전송 실패: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
