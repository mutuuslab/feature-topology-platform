// 시험 대역 — 계약에서 벗어난 실행기 (기준 필드 이름이 바뀌고 Evidence 해시가 빠짐). FF 어댑터가 "계약 위반"으로 거부하는지 본다.
import { readFileSync } from 'node:fs';

if (process.argv.includes('--probe')) {
  process.stdout.write(JSON.stringify({ tool: 'ff-carla', server: '0.9.16', map: 'Town04', synchronous: false, vehicles: 0, foreignVehicles: 0 }) + '\n');
  process.exit(0);
}
const pkg = JSON.parse(readFileSync(0, 'utf8'));
const runs = pkg.scenarios.map((sc) => ({
  scenarioId: sc.scenarioId,
  testId: `TEST-${sc.scenarioId}-DRIFT`,
  overall: 'PASS',
  criteria: [{ key: 'kill_latency', result: 'pass', measured: 0.3 }],
  minTimeGap: 1.2,
  evaluation: null,
  dir: '.',
  files: [{ name: 'verdict.json', bytes: 10 }],
}));
process.stdout.write(JSON.stringify({ tool: 'ff-carla', simulator: 'drifted (test double)', runs }) + '\n');
