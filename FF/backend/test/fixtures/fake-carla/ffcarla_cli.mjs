// 시험 대역 — sim/carla/ffcarla_cli.py(ff-carla 1.0)와 같은 입출력 계약(stdin 패키지 → --out Evidence → stdout JSON 한 줄, --probe 서버 상태).
// 실제 판정은 CARLA 검증 서버(2100)에서 실행기가 하고, 이 대역은 CI(CARLA 없음)에서 연동 경로를 결정적으로 시험한다.
// 실제 실행기처럼: 차량 내 감지(onboard) 시나리오는 감지·FTTI 기준을 통과하고, 원격 차단만 쓴 오류 시나리오는 위험·오판단·FTTI 여유가
// 기준을 넘는다(원격 경로 자체는 통과). 감지 한계는 패키지 safety(Registry)에서 계산한다. 판단(evaluation)은 패키지의 FF 평가 결과를 그대로 싣는다.
// FAKE_SIM_FAIL=<기준ID>로 실패를 강제하고, FAKE_SIM_NO_REPRO=1이면 재현 정보를 빼고 낸다. FAKE_SIM_DELAY_MS=<ms>는 실행을 늦춘다(비동기 시험),
// FAKE_SIM_PROBE_FAIL=1이면 서버 연결 불가(종료 3)를 흉내 낸다.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = 'ff-carla';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const emit = (o, code = 0) => {
  process.stdout.write(JSON.stringify(o) + '\n');
  process.exit(code);
};

if (process.argv.includes('--probe')) {
  if (process.env.FAKE_SIM_PROBE_FAIL) emit({ tool: TOOL, error: 'CARLA 서버 연결 불가 (fake)' }, 3);
  emit({ tool: TOOL, host: '127.0.0.1', port: 2100, server: '0.9.16', client: '0.9.16', map: 'Town04', synchronous: false, vehicles: 0, foreignVehicles: Number(process.env.FAKE_SIM_FOREIGN ?? 0) });
}

const out = process.argv[process.argv.indexOf('--out') + 1];
const pkg = JSON.parse(readFileSync(0, 'utf8'));
if (!pkg.fleet.some((v) => v.vin === pkg.vehicle)) emit({ tool: TOOL, error: `vehicle ${pkg.vehicle} is not in fleet[]` }, 2);
if (process.env.FAKE_SIM_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SIM_DELAY_MS)));

const S = { deactClass: 'DC2', takeoverMs: 4000, rampMs: 3000, faultRampMs: 1500, faultTolerantTimeMs: 5000, ...(pkg.safety ?? {}) };
const IDS = [
  ['kill_latency', '원격 차단 → 차량 Guard 수락', 's', '<=', 1.0],
  ['deact_time', '수락 → 기능 꺼짐 (DISABLED, 인계+램프)', 's', '<=', (S.takeoverMs + S.rampMs) / 1000 + 0.05],
  ['remote_refused', 'DC4 원격 차단 거부 (차량 Guard)', '건', '>=', 1],
  ['detect_latency', '고장 시작 → 차량 내 감지 확정', 's', '<=', (S.faultTolerantTimeMs - S.faultRampMs) / 1000],
  ['ftti_margin', 'FTTI 여유 (FTTI 끝 − 기능 효과 제거)', 's', '>=', 0],
  ['misjudge', '기능 오판단 최장 지속', 's', '<=', 2.0],
  ['danger_time', "실제 '위험' 단계 누적", 's', '<=', 0],
  ['min_ttc', '최소 TTC', 's', '>=', 2.0],
  ['max_decel', '최대 감속', 'm/s²', '<=', 2.8],
  ['recovery', "BASE_ONLY 후 실제 '정상' 복귀", 's', '<=', 15],
];
const SCRIPT_HASH = sha(readFileSync(fileURLToPath(import.meta.url)));
const runs = pkg.scenarios.map((sc, i) => {
  const fault = !!sc.fault;
  const onboard = !!sc.onboard;
  const criteria = IDS.map(([id, label, unit, op, limit]) => {
    const na =
      id === 'remote_refused' ||
      ((id === 'kill_latency' || id === 'deact_time') && !sc.kill) ||
      (id === 'detect_latency' && !(fault && onboard)) ||
      (id === 'ftti_margin' && !fault) ||
      (id === 'recovery' && !sc.kill && !(fault && onboard));
    const failed = (fault && !onboard && ['danger_time', 'misjudge', 'ftti_margin'].includes(id)) || process.env.FAKE_SIM_FAIL === id;
    const value = id === 'detect_latency' ? 2.1 : id === 'ftti_margin' ? (failed ? -33.3 : 1.4) : id === 'deact_time' ? 7 : failed ? 3.1 : 0.32;
    return { id, label, unit, op, limit, status: na ? 'na' : failed ? 'fail' : 'pass', value: na ? null : value, at: na ? null : 20 };
  });
  const testId = `TEST-${pkg.policy.flagKey}-${sc.scenarioId}-FAKE${i}`;
  const dir = join(out, testId);
  mkdirSync(dir, { recursive: true });
  const overall = criteria.some((c) => c.status === 'fail') ? 'FAIL' : 'PASS';
  const recording = resolve(dir, 'carla_recording.log');
  const repro = process.env.FAKE_SIM_NO_REPRO
    ? null
    : { toolVersion: 'ff-carla 1.0 (test double) · CARLA 0.9.16 · Town04', scenarioHash: sha(JSON.stringify(sc)), scriptHash: SCRIPT_HASH, seed: sc.seed ?? 0, stepS: 0.05, map: 'Town04', replay: `client.replay_file('${recording}', 0, 0, 0)`, safety: S };
  const evaluation = pkg.evaluation ?? null;
  writeFileSync(join(dir, 'verdict.json'), JSON.stringify({ testId, overall, policy: { contentHash: pkg.policy.contentHash }, vehicle: pkg.fleet.find((v) => v.vin === pkg.vehicle), evaluation, criteria, repro }));
  writeFileSync(join(dir, 'report.html'), `<html><body><h1>${testId}</h1></body></html>`);
  writeFileSync(recording, `fake recorder ${testId}`);
  const files = ['verdict.json', 'report.html', 'carla_recording.log'].map((name) => {
    const buf = readFileSync(join(dir, name));
    return { name, sha256: sha(buf), bytes: buf.length };
  });
  return { scenarioId: sc.scenarioId, testId, overall, criteria, minTimeGap: 1.2, evaluation, repro, dir: resolve(dir), files };
});
emit({ tool: TOOL, simulator: 'fake-carla (test double)', runs });
