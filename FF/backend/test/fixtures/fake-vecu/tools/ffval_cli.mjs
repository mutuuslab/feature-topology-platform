// 시험 대역 — vECU tools/ffval_cli.mjs와 같은 입출력 계약(stdin 패키지 → --out 증적 → stdout JSON 한 줄).
// 실제 판정은 C:\project\2026-10-11_vECU가 하고, 이 대역은 CI(vECU 없음)에서 연동 경로를 결정적으로 시험한다.
// 오류 주입 시나리오는 실제 vECU처럼 위험·오판단이 기준을 넘고 Kill 경로는 통과한다. FAKE_VECU_FAIL=<기준ID>로 실패를 강제한다.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = process.argv[process.argv.indexOf('--out') + 1];
const pkg = JSON.parse(readFileSync(0, 'utf8'));
if (!pkg.fleet.some((v) => v.vin === pkg.vehicle)) {
  process.stderr.write(`ffval_cli: vehicle ${pkg.vehicle} is not in fleet[]\n`);
  process.exit(2);
}
const IDS = [
  ['kill_latency', 'Kill → Safe Default 적용', 's', '<=', 1.0],
  ['misjudge', '기능 오판단 최장 지속', 's', '<=', 2.0],
  ['danger_time', "실제 '위험' 단계 누적", 's', '<=', 0],
  ['min_ttc', '최소 TTC', 's', '>=', 2.0],
  ['max_decel', '최대 감속', 'm/s²', '<=', 2.8],
  ['recovery', "Safe Default 후 실제 '정상' 복귀", 's', '<=', 15],
];
const runs = pkg.scenarios.map((sc, i) => {
  const fault = !!sc.fault;
  const criteria = IDS.map(([id, label, unit, op, limit]) => {
    const failed = (fault && (id === 'danger_time' || id === 'misjudge')) || process.env.FAKE_VECU_FAIL === id;
    const na = !sc.kill && (id === 'kill_latency' || id === 'recovery');
    return { id, label, unit, op, limit, status: na ? 'na' : failed ? 'fail' : 'pass', value: na ? null : failed ? 3.1 : 0.32, at: na ? null : 20 };
  });
  const testId = `TEST-${pkg.policy.flagKey}-${sc.scenarioId}-FAKE${i}`;
  const dir = join(out, testId);
  mkdirSync(dir, { recursive: true });
  const overall = criteria.some((c) => c.status === 'fail') ? 'FAIL' : 'PASS';
  const verdict = JSON.stringify({ testId, overall, policy: { contentHash: pkg.policy.contentHash }, vehicle: pkg.fleet.find((v) => v.vin === pkg.vehicle), criteria });
  writeFileSync(join(dir, 'verdict.json'), verdict);
  writeFileSync(join(dir, 'report.html'), `<html><body><h1>${testId}</h1></body></html>`);
  const files = ['verdict.json', 'report.html'].map((name) => {
    const buf = readFileSync(join(dir, name));
    return { name, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  });
  return { scenarioId: sc.scenarioId, testId, overall, criteria, minTimeGap: 1.2, evaluation: { value: true, decision: 'ALLOW', reason: 'POLICY_MATCH' }, dir: resolve(dir), files };
});
process.stdout.write(JSON.stringify({ tool: 'vecu-ffval', simulator: 'fake-vecu (test double)', runs }) + '\n');
